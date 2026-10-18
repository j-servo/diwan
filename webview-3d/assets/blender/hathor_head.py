# House of Life: the Hathor head of the capitals, from Yousef's TRELLIS2 model (2026-10-18).
#
#   Blender -b --factory-startup --python-exit-code 1 --python assets/blender/hathor_head.py \
#       -- <hathor-trellis.glb>
#
# The model is untrusted data and is only ever opened here, in Blender; it is never committed. It is
# TRELLIS's reading of the approved four-view sheet: four heads in a 2 x 2 grid in one mesh of ~291K
# triangles (a soup of ~3.7K fragments, ~86K open edges) with a 2K colour texture. Only the front of
# a head shows on a Dendera capital (four faces on a block, Pl. 12), so the head is taken as a
# height field: the sheet's upper-left head (the serene front view) is ray-cast from the front,
# which drops every fragment and seam behind the visible surface and is the cleaning step. Then:
#   - holes inside the silhouette are filled from their neighbours (no open cracks);
#   - the face is made exactly symmetric about its own mid-line (found by minimising the
#     depth mismatch with the mirror image, to a tenth of a sample), depth and colour alike;
#   - the broken base of the bust is cropped off (the capital's own collar band sits there).
# Writes (assets/worlds/house-of-life/src/, committed; derived data, not the model):
#   hathor_head_depth.npy   float16 (512 x 380): depth towards the viewer, metres of the model
#   hathor_head_color.png   RGBA (1024 x 760): the model's colour as seen from the front, alpha =
#                           inside the silhouette
# temple_parts.hathor_column meshes and decimates the height field per LOD; temple_textures paints
# the colour into Ptolemaic paint. Nothing here runs in the bake.
import os
import sys

import bpy
import mathutils
import numpy as np
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, '..', 'worlds', 'house-of-life', 'src')
ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
assert ARGS, 'usage: hathor_head.py -- <hathor-trellis.glb>'

# The upper-left cell of the sheet (model metres: y across, z up, the faces look along +x): the head
# spans y -0.358..-0.033 and z 0.02..0.495; the base of the bust below z 0.045 is broken stone.
CELL_Y = (-0.367, 0.0)
CROP_Z = (0.045, 0.497)
COLOR_HW = (1024, 760)
DEPTH_HW = (512, 380)


def load():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=ARGS[0])
    obs = [o for o in bpy.data.objects if o.type == 'MESH']
    assert len(obs) == 1, 'expected one mesh'
    ob = obs[0]
    me = ob.data
    M = ob.matrix_world
    verts = np.array([M @ v.co for v in me.vertices])
    tris = np.array([p.vertices[:] for p in me.polygons])
    assert tris.shape[1] == 3, 'expected triangles'
    loops = np.array([p.loop_indices[:] for p in me.polygons])
    uv = np.zeros((len(me.loops), 2))
    me.uv_layers[0].data.foreach_get('uv', uv.ravel())
    img = [i for i in bpy.data.images if i.colorspace_settings.name != 'Non-Color'][0]
    W, H = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(H, W, 4)[..., :3]   # sRGB values
    print('[head] model', len(verts), 'verts', len(tris), 'tris; texture', W, H, flush=True)
    return verts, tris, loops, uv, px


def cast(verts, tris, loops, uv, px, h, w, y0, y1, z0, z1):
    """Rays along -x over the cell: the first surface hit, its depth (x) and colour."""
    bvh = BVHTree.FromPolygons([tuple(v) for v in verts], [tuple(t) for t in tris])
    H, W = px.shape[:2]
    D = np.full((h, w), np.nan)
    col = np.zeros((h, w, 3))
    d = mathutils.Vector((-1.0, 0.0, 0.0))
    for j in range(h):
        z = z1 - (j + 0.5) / h * (z1 - z0)
        for i in range(w):
            y = y0 + (i + 0.5) / w * (y1 - y0)
            loc, _, idx, _ = bvh.ray_cast(mathutils.Vector((1.0, y, z)), d)
            if loc is None:
                continue
            a, b, c = verts[tris[idx]]
            v0, v1, v2 = b - a, c - a, np.array(loc) - a
            d00, d01, d11, d20, d21 = v0 @ v0, v0 @ v1, v1 @ v1, v2 @ v0, v2 @ v1
            den = d00 * d11 - d01 * d01
            if abs(den) < 1e-16:
                continue
            bv = (d11 * d20 - d01 * d21) / den
            bw = (d00 * d21 - d01 * d20) / den
            t = (1 - bv - bw) * uv[loops[idx][0]] + bv * uv[loops[idx][1]] + bw * uv[loops[idx][2]]
            D[j, i] = loc.x
            col[j, i] = px[int(np.clip(t[1], 0, 0.9999) * H), int(np.clip(t[0], 0, 0.9999) * W)]
    return D, col


def fill_holes(D, col, ok):
    """Close the silhouette (a binary closing), then fill every unknown texel inside it from its
    known neighbours (repeated 3 x 3 averaging)."""
    def dil(m, r):
        out = m.copy()
        for _ in range(r):
            g = out.copy()
            g[1:] |= out[:-1]
            g[:-1] |= out[1:]
            g[:, 1:] |= out[:, :-1]
            g[:, :-1] |= out[:, 1:]
            out = g
        return out
    inside = ~dil(~dil(ok, 3), 3)
    D = np.where(ok, D, 0.0)
    col = np.where(ok[..., None], col, 0.0)
    known = ok.copy()
    for _ in range(400):
        todo = inside & ~known
        if not todo.any():
            break
        acc = np.zeros_like(D)
        cacc = np.zeros_like(col)
        n = np.zeros_like(D)
        for dy, dx in ((-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (1, 1), (-1, 1), (1, -1)):
            s = np.roll(np.roll(known, dy, 0), dx, 1)
            acc += np.roll(np.roll(D, dy, 0), dx, 1) * s
            cacc += np.roll(np.roll(col, dy, 0), dx, 1) * s[..., None]
            n += s
        grow = todo & (n > 0)
        D[grow] = acc[grow] / n[grow]
        col[grow] = cacc[grow] / n[grow][:, None]
        known |= grow
    return D, col, inside


def mirror_axis(D, inside):
    """The face's mid-line, in samples: the shift that best matches the depth with its mirror."""
    k = 4                                           # searched on a quarter-size copy
    D, inside = D[::k, ::k], inside[::k, ::k]
    h, w = D.shape
    rows = slice(int(h * 0.25), int(h * 0.8))      # the face and lappets, not the dome or base
    xs = np.arange(w, dtype=np.float64)
    best = (1e9, w / 2)
    for s in np.arange(w * 0.4, w * 0.6, 0.025):
        xm = 2 * s - xs
        valid = (xm >= 0) & (xm <= w - 1)
        Dm = np.array([np.interp(xm[valid], xs, D[r]) for r in range(h)])[rows]
        im = np.array([np.interp(xm[valid], xs, inside[r].astype(float)) for r in range(h)])[rows]
        both = (inside[rows][:, valid]) & (im > 0.99)
        if both.sum() < 1000:
            continue
        err = np.abs(D[rows][:, valid] - Dm)[both].mean()
        if err < best[0]:
            best = (err, s)
    return best[0], best[1] * k + (k - 1) / 2


def symmetrize(a, s):
    """Average with the mirror about column s, resampled so the axis is the image's centre."""
    h, w = a.shape[:2]
    xs = np.arange(w, dtype=np.float64)
    half = min(s, w - 1 - s)
    xo = s + (np.arange(w) + 0.5 - w / 2) / (w / 2) * half
    flat = a.reshape(h, w, -1)
    out = np.empty_like(flat, dtype=np.float64)
    for c in range(flat.shape[2]):
        for r in range(h):
            f = np.interp(xo, xs, flat[r, :, c])
            out[r, :, c] = 0.5 * (f + f[::-1])
    return out.reshape(a.shape)


def resize(a, h, w):
    H, W = a.shape[:2]
    ys = np.clip((np.arange(h) + 0.5) * H / h - 0.5, 0, H - 1)
    xs = np.clip((np.arange(w) + 0.5) * W / w - 0.5, 0, W - 1)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, H - 1), np.minimum(x0 + 1, W - 1)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    if a.ndim == 3:
        fy, fx = fy[..., None], fx[..., None]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return top * (1 - fy) + bot * fy


def main():
    verts, tris, loops, uv, px = load()
    h, w = COLOR_HW
    # the cell is cast over a margin (the head is then centred on its axis)
    y0, y1 = CELL_Y
    D, col = cast(verts, tris, loops, uv, px, h, w, y0 + 0.0, y1 - 0.0, *CROP_Z)
    ok = ~np.isnan(D)
    print('[head] hit fraction', round(float(ok.mean()), 3), 'depth', float(np.nanmin(D)),
          float(np.nanmax(D)), flush=True)
    D, col, inside = fill_holes(D, col, ok)
    err, s = mirror_axis(D, inside)
    print(f'[head] mid-line at column {s:.1f} of {w} (mismatch {err * 1000:.2f} mm of the model)',
          flush=True)
    D = symmetrize(np.where(inside, D, np.nan_to_num(D)), s)
    col = symmetrize(col, s)
    alpha = symmetrize(inside.astype(np.float64), s)
    os.makedirs(SRC, exist_ok=True)
    dh, dw = DEPTH_HW
    depth = resize(np.where(alpha > 0.5, D, np.nan), dh, dw)
    a_small = resize(alpha, dh, dw)
    depth = np.where(a_small > 0.5, depth, np.nan)
    np.save(os.path.join(SRC, 'hathor_head_depth.npy'), depth.astype(np.float16))
    rgba = np.concatenate([np.clip(col, 0, 1), np.clip(alpha, 0, 1)[..., None]], -1)
    img = bpy.data.images.new('hathor_head_color', w, h, alpha=True)
    img.colorspace_settings.name = 'Non-Color'          # the values are already sRGB
    img.pixels.foreach_set(rgba[::-1].astype(np.float32).ravel())
    img.filepath_raw = os.path.join(SRC, 'hathor_head_color.png')
    img.file_format = 'PNG'
    img.save()
    print('[head] wrote', SRC, 'depth', depth.shape, 'colour', rgba.shape, flush=True)


main()
