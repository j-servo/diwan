# THROWAWAY SPIKE CODE (M1 pipeline spike, 2026-10-12). Not production.
# Stage 1: generate the high-poly Samarra stucco relief and baked-brick relief from the
# procedural patterns, bake them high -> low in Cycles on the Metal GPU (tangent normal +
# ambient occlusion) onto flat trim planes, and write the trim-sheet textures.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
#       --python-exit-code 1 --python spikes/m1-pipeline/blender/trim_bake.py
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import bl_common as C  # noqa: E402
import patterns as P  # noqa: E402

STATS = {}


def bake_trim(name, width_m, height_m, tex_w, tex_h, height_fn, wrap_v, hp_step,
              ao_dist, ao_samples):
    scene = C.reset_scene()
    C.use_metal_gpu(scene)
    pad = 0.04
    # ---- high poly: displaced grid, padded so the bake tiles seamlessly
    with C.timed(f'{name}: generate high-poly'):
        xs = np.arange(-pad, width_m + pad + 1e-9, hp_step)
        if wrap_v:
            ys = np.arange(-pad, height_m + pad + 1e-9, hp_step)
        else:
            ys = np.arange(0, height_m + 1e-9, hp_step)
        X, Y = np.meshgrid(xs, ys)
        Z = height_fn(X, np.mod(Y, height_m) if wrap_v else Y)
        high = C.grid_mesh(f'{name}_high', xs, ys, Z)
    STATS[f'{name}_high_tris'] = C.tri_count(high)

    # ---- low poly: one quad, UV 0..1
    verts = [(0, 0, 0), (width_m, 0, 0), (width_m, height_m, 0), (0, height_m, 0)]
    low = C.mesh_from_numpy(f'{name}_low', verts, [[0, 1, 2, 3]], smooth=False)
    uv = low.data.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', np.array([0, 0, 1, 0, 1, 1, 0, 1], dtype=np.float32))
    mat = bpy.data.materials.new(f'{name}_bake')
    low.data.materials.append(mat)
    STATS[f'{name}_low_tris'] = C.tri_count(low)

    C.select_only([high, low], low)
    scene.render.bake.margin = 0
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.cage_extrusion = 0.03
    scene.render.bake.max_ray_distance = 0.08

    # ---- tangent-space normal
    img_n = C.new_image(f'{name}_normal', tex_w, tex_h)
    C.bake_target(low, img_n)
    scene.cycles.samples = 8
    with C.timed(f'{name}: bake normal {tex_w}x{tex_h} (GPU)'):
        bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_selected_to_active=True,
                            cage_extrusion=0.03, margin=0, use_clear=True)
    n = C.image_to_numpy(img_n)[..., :3]
    P.write_png(os.path.join(C.TEX, f'{name}_normal.png'), P.to_u8(n))

    # ---- ambient occlusion (relief-scale distance)
    scene.world.light_settings.distance = ao_dist
    img_ao = C.new_image(f'{name}_ao', tex_w, tex_h)
    C.bake_target(low, img_ao)
    scene.cycles.samples = ao_samples
    with C.timed(f'{name}: bake AO {tex_w}x{tex_h} @{ao_samples}spp (GPU)'):
        bpy.ops.object.bake(type='AO', use_selected_to_active=True, cage_extrusion=0.03,
                            margin=0, use_clear=True)
    ao = C.image_to_numpy(img_ao)[..., 0]
    P.write_png(os.path.join(C.TEX, f'{name}_ao.png'), P.to_u8(ao))
    return n, ao


def texel_grid(width_m, height_m, w, h):
    u = (np.arange(w) + 0.5) / w * width_m
    v = (h - 1 - np.arange(h) + 0.5) / h * height_m  # row 0 = top
    return np.meshgrid(u, v)


def main():
    # ---------------- stucco band: 1.0 m x 0.5 m, 2048 x 1024 (2048 px/m)
    sw, sh = 2048, 1024
    C.TIMINGS.clear()
    with C.timed('stucco: numpy fields + colour'):
        U, V = texel_grid(P.STUCCO_W, P.STUCCO_H, sw, sh)
        h, d = P.stucco_height(U, V)
        P.write_png(os.path.join(C.TEX, 'stucco_basecolor.png'), P.to_u8(P.stucco_color(U, V, d)))
    with C.timed('stucco: numpy normal (comparison path)'):
        nn = P.height_to_normal(h, P.STUCCO_W / sw, P.STUCCO_H / sh, wrap_u=True)
        P.write_png(os.path.join(C.RAW, 'stucco_normal_numpy.png'), P.to_u8(nn))
    np.save(os.path.join(C.RAW, 'stucco_height.npy'), h.astype(np.float32))
    bake_trim('stucco', P.STUCCO_W, P.STUCCO_H, sw, sh,
              lambda x, y: P.stucco_height(x, y)[0], wrap_v=False, hp_step=0.00125,
              ao_dist=0.03, ao_samples=256)

    # ---------------- brick dado: 1.0 m x 1.0 m, 1024 x 1024 (1024 px/m), tiles both ways
    bw = 1024
    with C.timed('brick: numpy fields + colour'):
        U, V = texel_grid(1.0, 1.0, bw, bw)
        hb, cb = P.brick_maps(U, V)
        P.write_png(os.path.join(C.TEX, 'brick_basecolor.png'), P.to_u8(cb))
    bake_trim('brick', 1.0, 1.0, bw, bw, lambda x, y: P.brick_maps(np.mod(x, 1.0), y)[0],
              wrap_v=True, hp_step=0.002, ao_dist=0.02, ao_samples=256)

    # ---------------- plaster (numpy-only path: height -> normal, no Blender bake)
    with C.timed('plaster + cedar: numpy-only maps'):
        pw = 512
        U, V = texel_grid(1.0, 1.0, pw, pw)
        hp, cp = P.plaster_maps(U, V)
        P.write_png(os.path.join(C.TEX, 'plaster_basecolor.png'), P.to_u8(cp))
        P.write_png(os.path.join(C.TEX, 'plaster_normal.png'),
                    P.to_u8(P.height_to_normal(hp, 1 / pw, 1 / pw, wrap_u=True, wrap_v=True)))
        cw = 512
        U, V = texel_grid(1.0, 1.0, cw, cw)
        P.write_png(os.path.join(C.TEX, 'cedar_basecolor.png'), P.to_u8(P.cedar_color(U, V)))

    C.TIMINGS.update({k: v for k, v in STATS.items()})
    C.save_timings('trim')
    print('[stats]', STATS, flush=True)


main()
