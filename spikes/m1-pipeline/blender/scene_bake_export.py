# THROWAWAY SPIKE CODE (M1 pipeline spike, 2026-10-12). Not production.
# Stage 2: build the low-poly beauty corner (wall with pointed-arch niche, splayed window
# with a pierced-stucco grille, brick dado, Samarra band, plaster floor, cedar desk,
# turquoise-glaze hanging lamp), lay a lightmap UV set (TEXCOORD_1), bake the golden-hour
# lightmap in Cycles on the Metal GPU, generate the window gobo from the same grille
# pattern, and export GLB. Run trim_bake.py first.
#
#   /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup \
#       --python-exit-code 1 --python spikes/m1-pipeline/blender/scene_bake_export.py
import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bmesh  # noqa: E402
import bpy  # noqa: E402
import mathutils  # noqa: E402
import numpy as np  # noqa: E402

import bl_common as C  # noqa: E402
import patterns as P  # noqa: E402

# ---------------------------------------------------------------- layout (Blender: Z up, metres)
# Room is y < 0, wall front face at y = 0, wall back face at y = WALL_T.
WALL_X0, WALL_X1, WALL_T, WALL_H = -1.5, 1.5, 0.5, 3.2
DADO_TOP, BAND_TOP = 0.80, 1.30
NICHE = dict(cx=-0.55, half=0.55, sill=0.12, spring=1.75)
NICHE_DEPTH = 0.35
WIN_IN = dict(cx=0.85, half=0.30, sill=1.45, spring=2.05)
WIN_OUT = dict(cx=0.85, half=0.46, sill=1.33, spring=2.18)
WIN_STRAIGHT = 0.10          # straight reveal depth before the splay
GRILLE_Y0, GRILLE_Y1 = 0.03, 0.055  # 2.5 cm pierced stucco slab
FLOOR_Y0, FLOOR_T = -3.0, 0.12
SUN_EL, SUN_AZ = 40.0, 20.0  # degrees; travels towards -y and -x
SUN_STRENGTH = 4.0
SUN_COLOR = (1.0, 0.74, 0.46)
SKY_COLOR = (0.95, 0.74, 0.52)
SKY_STRENGTH = 1.0
LM_SIZE = 1024
LM_SAMPLES = 512

MAT_ORDER = ['brick', 'stucco', 'plaster', 'floor', 'plinth', 'cedar', 'glaze', 'brass']
STATS = {}


def b2t(v):
    """Blender (x, y, z) -> three.js / glTF (x, z, -y)."""
    return [float(v[0]), float(v[2]), float(-v[1])]


# ---------------------------------------------------------------- materials
def gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g is None:
        g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g


def load_img(name, data):
    img = bpy.data.images.load(os.path.join(C.TEX, name), check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return img


def make_material(name, base=None, color=(0.8, 0.8, 0.8), normal=None, ao=None, rough=0.85,
                  metal=0.0, emission=None, normal_strength=1.0):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True  # deprecated in 5.x but still creates the tree
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    L = nt.links
    if base:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(base, False)
        L.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
    if normal:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(normal, True)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.uv_map = 'UVMap'
        nm.inputs['Strength'].default_value = normal_strength
        L.new(t.outputs['Color'], nm.inputs['Color'])
        L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if ao:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(ao, True)
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        grp = nt.nodes.new('ShaderNodeGroup')
        grp.node_tree = gltf_output_group()
        L.new(t.outputs['Color'], sep.inputs['Color'])
        L.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.0  # off for the bake
    return m


def srgb_to_lin(c):
    c = np.asarray(c, dtype=np.float64) / 255.0
    return tuple(np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4))


def build_materials():
    # floor texture: the plaster field with a warmer, darker tint (numpy path)
    pw = 512
    u = (np.arange(pw) + 0.5) / pw
    U, V = np.meshgrid(u, u[::-1])
    _, cp = P.plaster_maps(U + 0.37, V + 0.11)
    P.write_png(os.path.join(C.TEX, 'floor_basecolor.png'),
                P.to_u8(cp * np.array([0.93, 0.88, 0.80])[None, None, :]))
    mats = {
        'brick': make_material('brick', 'brick_basecolor.png', normal='brick_normal.png',
                               ao='brick_ao.png', rough=0.9),
        'stucco': make_material('stucco', 'stucco_basecolor.png', normal='stucco_normal.png',
                                ao='stucco_ao.png', rough=0.8),
        'plaster': make_material('plaster', 'plaster_basecolor.png', normal='plaster_normal.png',
                                 rough=0.85),
        'floor': make_material('floor', 'floor_basecolor.png', normal='plaster_normal.png',
                               rough=0.8),
        'plinth': make_material('plinth', color=srgb_to_lin((58, 44, 34)), rough=0.9),
        'cedar': make_material('cedar', 'cedar_basecolor.png', rough=0.55),
        'glaze': make_material('glaze', color=srgb_to_lin((34, 168, 170)), rough=0.18,
                               emission=srgb_to_lin((40, 210, 205))),
        'brass': make_material('brass', color=srgb_to_lin((176, 132, 70)), rough=0.35, metal=1.0),
    }
    return mats


def assign_slots(ob, mats):
    ob.data.materials.clear()
    for name in MAT_ORDER:
        ob.data.materials.append(mats[name])


# ---------------------------------------------------------------- geometry helpers
def bm_to_object(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def ring_prism(name, rings):
    """Closed loft through outline rings [(y, [(x, z), ...]), ...] (same point counts)."""
    bm = bmesh.new()
    vr = [[bm.verts.new((x, y, z)) for x, z in pts] for y, pts in rings]
    n = len(vr[0])
    bm.faces.new(vr[0])
    bm.faces.new(vr[-1][::-1])
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return bm_to_object(bm, name)


def box(bm, x0, x1, y0, y1, z0, z1):
    r = bmesh.ops.create_cube(bm, size=1.0)
    for v in r['verts']:
        v.co = mathutils.Vector((x0 + (v.co.x + 0.5) * (x1 - x0), y0 + (v.co.y + 0.5) * (y1 - y0),
                                 z0 + (v.co.z + 0.5) * (z1 - z0)))
    return r['verts']


def boolean_diff(target, cutters):
    for i, c in enumerate(cutters):
        m = target.modifiers.new(f'cut{i}', 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.object = c
        m.solver = 'MANIFOLD'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(target.evaluated_get(dg))
    target.modifiers.clear()
    old = target.data
    target.data = me
    bpy.data.meshes.remove(old)
    for c in cutters:
        bpy.data.objects.remove(c)


def apply_bevel(ob, width, segments=2):
    m = ob.modifiers.new('bevel', 'BEVEL')
    m.width = width
    m.segments = segments
    m.limit_method = 'ANGLE'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    ob.data = me


# ---------------------------------------------------------------- UV0 (texture / trim) rules
def set_uv0(ob, rule):
    me = ob.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        n = p.normal
        for li in p.loop_indices:
            co = me.vertices[me.loops[li].vertex_index].co
            uv.data[li].uv = rule(p.material_index, co, n)


def box_uv(co, n, scale=1.0):
    ax = max(range(3), key=lambda i: abs(n[i]))
    if ax == 0:
        return (co.y / scale * (1 if n.x > 0 else -1), co.z / scale)
    if ax == 1:
        return (co.x / scale * (-1 if n.y > 0 else 1), co.z / scale)
    return (co.x / scale, co.y / scale)


def wall_uv(mi, co, n):
    name = MAT_ORDER[mi]
    if name == 'brick':
        return (co.x, co.z)
    if name == 'stucco':
        return (co.x, (co.z - DADO_TOP) / (BAND_TOP - DADO_TOP))
    return box_uv(co, n, 1.0)


# ---------------------------------------------------------------- builders
def build_wall(mats):
    bm = bmesh.new()
    box(bm, WALL_X0, WALL_X1, 0.0, WALL_T, 0.0, WALL_H)
    for zc in (DADO_TOP, BAND_TOP):
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=(0, 0, zc), plane_no=(0, 0, 1))
    wall = bm_to_object(bm, 'wall')
    niche = ring_prism('niche_cut', [(-0.1, P.arch_outline(**NICHE)),
                                     (NICHE_DEPTH, P.arch_outline(**NICHE))])
    wi, wo = P.arch_outline(**WIN_IN), P.arch_outline(**WIN_OUT)
    window = ring_prism('window_cut', [(-0.1, wi), (WIN_STRAIGHT, wi), (WALL_T, wo),
                                       (WALL_T + 0.1, wo)])
    boolean_diff(wall, [niche, window])
    assign_slots(wall, mats)
    me = wall.data
    bm = bmesh.new()
    bm.from_mesh(me)
    kill = []
    for f in bm.faces:
        c, n = f.calc_center_median(), f.normal
        if n.y < -0.99 and abs(c.y) < 1e-4:
            f.material_index = 0 if c.z < DADO_TOP else (1 if c.z < BAND_TOP else 2)
        else:
            f.material_index = 2
        if (n.y > 0.99 and c.y > WALL_T - 1e-4) or (n.z < -0.99 and c.z < 1e-4):
            kill.append(f)  # back face and footing: never seen
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
    set_uv0(wall, wall_uv)
    return wall


def build_floor(mats):
    bm = bmesh.new()
    box(bm, WALL_X0, WALL_X1, FLOOR_Y0, 0.0, -FLOOR_T, 0.0)
    ob = bm_to_object(bm, 'floor')
    assign_slots(ob, mats)
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    kill = []
    for f in bm.faces:
        n = f.normal
        if n.z > 0.99:
            f.material_index = MAT_ORDER.index('floor')
        elif n.z < -0.99 or n.y > 0.99:
            kill.append(f)  # underside and the face hidden under the wall
        else:
            f.material_index = MAT_ORDER.index('plinth')
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me)
    bm.free()
    set_uv0(ob, lambda mi, co, n: box_uv(co, n, 1.0))
    return ob


def build_desk(mats):
    cx, cy, top, w, d = NICHE['cx'], -0.42, 0.34, 0.95, 0.48
    bm = bmesh.new()
    box(bm, cx - w / 2, cx + w / 2, cy - d / 2, cy + d / 2, top - 0.035, top)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x, y = cx + sx * (w / 2 - 0.06), cy + sy * (d / 2 - 0.05)
            box(bm, x - 0.025, x + 0.025, y - 0.025, y + 0.025, 0.0, top - 0.035)
    for sy in (-1, 1):
        y = cy + sy * (d / 2 - 0.05)
        box(bm, cx - w / 2 + 0.06, cx + w / 2 - 0.06, y - 0.012, y + 0.012, top - 0.095, top - 0.035)
    ob = bm_to_object(bm, 'desk')
    apply_bevel(ob, 0.004)
    assign_slots(ob, mats)
    for p in ob.data.polygons:
        p.material_index = MAT_ORDER.index('cedar')
    set_uv0(ob, lambda mi, co, n: box_uv(co, n, 1.0))
    return ob


LAMP_POS = (NICHE['cx'], 0.17, 1.84)


def build_lamp(mats):
    prof = [(0.0, 0.0), (0.03, 0.004), (0.065, 0.025), (0.088, 0.06), (0.086, 0.085),
            (0.06, 0.11), (0.036, 0.13), (0.032, 0.16), (0.046, 0.185), (0.052, 0.195),
            (0.0, 0.195)]
    bm = bmesh.new()
    vs = [bm.verts.new((r, 0, z)) for r, z in prof]
    es = [bm.edges.new((a, b)) for a, b in zip(vs[:-1], vs[1:])]
    bmesh.ops.spin(bm, geom=vs + es, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi,
                   steps=28, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    for v in bm.verts:
        v.co += mathutils.Vector(LAMP_POS)
    lamp = bm_to_object(bm, 'lamp')
    lamp.data.shade_smooth()
    assign_slots(lamp, mats)
    for p in lamp.data.polygons:
        p.material_index = MAT_ORDER.index('glaze')
    # three suspension rods up to a hook under the niche vault
    bm = bmesh.new()
    hook = mathutils.Vector((LAMP_POS[0], LAMP_POS[1], 2.36))
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.4
        p0 = mathutils.Vector((LAMP_POS[0] + 0.05 * math.cos(a), LAMP_POS[1] + 0.05 * math.sin(a),
                               LAMP_POS[2] + 0.19))
        dv = hook - p0
        r = bmesh.ops.create_cone(bm, cap_ends=True, segments=6, radius1=0.003, radius2=0.003,
                                  depth=dv.length)
        rot = dv.to_track_quat('Z', 'Y').to_matrix().to_4x4()
        mat = mathutils.Matrix.Translation((p0 + hook) / 2) @ rot
        bmesh.ops.transform(bm, matrix=mat, verts=r['verts'])
    rods = bm_to_object(bm, 'rods')
    assign_slots(rods, mats)
    for p in rods.data.polygons:
        p.material_index = MAT_ORDER.index('brass')
    for o in (lamp, rods):
        set_uv0(o, lambda mi, co, n: box_uv(co, n, 0.25))
    return [lamp, rods]


def build_grille(mats):
    cx, half, sill, spring = WIN_IN['cx'], WIN_IN['half'], WIN_IN['sill'], WIN_IN['spring']
    xs = np.arange(cx - half - 0.02, cx + half + 0.02, 0.0015)
    zs = np.arange(sill - 0.02, sill + 1.2, 0.0015)
    X, Z = np.meshgrid(xs, zs)
    f = P.grille_open(X, Z, cx, half, sill, spring)
    loops = P.marching_squares(f, xs, zs)
    holes = []
    for lp in loops:
        s = P.simplify_loop(lp, 0.0005)
        a = np.asarray(s)
        area = 0.5 * abs(np.dot(a[:, 0], np.roll(a[:, 1], 1)) - np.dot(a[:, 1], np.roll(a[:, 0], 1)))
        if area > 1.5e-4 and len(s) >= 4:  # drop slivers where lenses meet the rim
            holes.append([tuple(p) for p in s])
    outer = P.arch_outline(cx, half + 0.003, sill - 0.003, spring, n_arc=40)
    polys = [outer] + holes
    flat = [p for poly in polys for p in poly]
    tris = mathutils.geometry.tessellate_polygon(
        [[mathutils.Vector((x, z, 0)) for x, z in poly] for poly in polys])
    bm = bmesh.new()
    front = [bm.verts.new((x, GRILLE_Y0, z)) for x, z in flat]
    back = [bm.verts.new((x, GRILLE_Y1, z)) for x, z in flat]
    for a, b, c in tris:
        for ring in (front, back):
            try:
                bm.faces.new((ring[a], ring[b], ring[c]))
            except ValueError:
                pass
    off = 0
    for poly in polys:
        n = len(poly)
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((front[off + i], front[off + j], back[off + j], back[off + i]))
        off += n
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = bm_to_object(bm, 'grille')
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(35))
    assign_slots(ob, mats)
    for p in ob.data.polygons:
        p.material_index = MAT_ORDER.index('plaster')
    set_uv0(ob, lambda mi, co, n: box_uv(co, n, 1.0))
    STATS['grille_holes'] = len(holes)
    return ob


def build_bake_only():
    """Ceiling and side walls that shape the bake but are never exported."""
    bm = bmesh.new()
    box(bm, WALL_X0 - 0.1, WALL_X1 + 0.1, FLOOR_Y0, WALL_T, WALL_H, WALL_H + 0.1)
    box(bm, WALL_X0 - 0.1, WALL_X0, FLOOR_Y0, WALL_T, -FLOOR_T, WALL_H)
    box(bm, WALL_X1, WALL_X1 + 0.1, FLOOR_Y0, WALL_T, -FLOOR_T, WALL_H)
    ob = bm_to_object(bm, 'BAKE_ONLY_enclosure')
    m = bpy.data.materials.new('enclosure')
    m.diffuse_color = (0.6, 0.55, 0.5, 1)
    ob.data.materials.append(m)
    return ob


# ---------------------------------------------------------------- lightmap
def lightmap_uvs(ob):
    me = ob.data
    lm = me.uv_layers.new(name='UVLightmap')
    me.uv_layers.active = lm
    C.select_only([ob], ob)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.003,
                             area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.004)
    bpy.ops.object.mode_set(mode='OBJECT')
    me.uv_layers.active = me.uv_layers['UVMap']
    me.uv_layers['UVMap'].active_render = True


def setup_lighting(scene):
    w = scene.world
    if w.node_tree is None:
        w.use_nodes = True  # deprecated in 5.x but still creates the tree
    bg = w.node_tree.nodes.get('Background')
    bg.inputs['Color'].default_value = (*SKY_COLOR, 1)
    bg.inputs['Strength'].default_value = SKY_STRENGTH
    sun_d = sun_direction()
    ld = bpy.data.lights.new('Sun', 'SUN')
    ld.energy = SUN_STRENGTH
    ld.color = SUN_COLOR
    ld.angle = math.radians(0.53)
    sun = bpy.data.objects.new('Sun', ld)
    scene.collection.objects.link(sun)
    sun.rotation_euler = mathutils.Vector(sun_d).to_track_quat('-Z', 'Y').to_euler()
    return bg, sun


def sun_direction():
    el, az = math.radians(SUN_EL), math.radians(SUN_AZ)
    return (-math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), -math.sin(el))


def bake_diffuse(ob, label, passes):
    img = C.new_image(f'lm_{label}', LM_SIZE, LM_SIZE, float_buffer=True, data=True)
    C.bake_target(ob, img)
    C.select_only([ob], ob)
    with C.timed(f'lightmap bake {label} {LM_SIZE}^2 @{LM_SAMPLES}spp (GPU)'):
        bpy.ops.object.bake(type='DIFFUSE', pass_filter=passes, margin=6, use_clear=True,
                            uv_layer='UVLightmap', target='IMAGE_TEXTURES')
    return C.image_to_numpy(img)[..., :3].astype(np.float64)


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


# ---------------------------------------------------------------- gobo
def make_gobo(n=1024, L=6.0):
    """Project the window aperture + grille from a far 'sun' spot light, the way three.js
    maps spotLight.map (perspective shadow camera, square aspect, lookAt with Y-up)."""
    d = np.array(sun_direction())
    wc = np.array([WIN_IN['cx'], (GRILLE_Y0 + GRILLE_Y1) / 2,
                   (WIN_IN['sill'] + WIN_IN['spring'] + 0.38) / 2])
    pos = wc - d * L
    target = wc + d * 2.0
    up = np.array([0.0, 0.0, 1.0])               # three's +Y in Blender coords
    zc = pos - target
    zc /= np.linalg.norm(zc)
    xc = np.cross(up, zc)
    xc /= np.linalg.norm(xc)
    yc = np.cross(zc, xc)
    # cone half-angle: enclose the inner (limiting) aperture as seen from the light, +6 %
    pts = []
    for y in (0.0, WIN_STRAIGHT):
        for x, z in P.arch_outline(**WIN_IN):
            pts.append([x, y, z])
    rel = np.array(pts) - pos
    cam = np.stack([rel @ xc, rel @ yc, -(rel @ zc)], -1)
    tan_a = 1.06 * np.max(np.hypot(cam[:, 0], cam[:, 1]) / cam[:, 2])
    s = (np.arange(n) + 0.5) / n
    S, T = np.meshgrid(s, s[::-1])               # row 0 = top of the image (t = 1)
    rx, ry = (2 * S - 1) * tan_a, (2 * T - 1) * tan_a
    dirs = rx[..., None] * xc + ry[..., None] * yc - zc
    ok = np.ones((n, n), bool)

    def hit(yp):
        t = (yp - pos[1]) / dirs[..., 1]
        return pos[0] + t * dirs[..., 0], pos[2] + t * dirs[..., 2]

    for yp in np.linspace(0.0, WALL_T, 11):     # straight reveal + splay
        k = np.clip((yp - WIN_STRAIGHT) / (WALL_T - WIN_STRAIGHT), 0, 1)
        prm = {key: WIN_IN[key] * (1 - k) + WIN_OUT[key] * k for key in WIN_IN}
        x, z = hit(yp)
        ok &= P.arch_inside(x, z, **prm)
    for yp in (GRILLE_Y0, GRILLE_Y1):            # both faces of the 5 cm stucco slab
        x, z = hit(yp)
        ok &= P.grille_open(x, z, WIN_IN['cx'], WIN_IN['half'], WIN_IN['sill'],
                            WIN_IN['spring']) > 0
    g = ok.astype(np.float64)
    # penumbra: sun disc (0.53 deg) over ~2.5 m of throw is ~2 cm, about sigma 3 px here
    sig = 3.0
    k = np.exp(-0.5 * (np.arange(-9, 10) / sig) ** 2)
    k /= k.sum()
    g = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, g)
    g = np.apply_along_axis(lambda c: np.convolve(c, k, 'same'), 0, g)
    P.write_png(os.path.join(C.OUT, 'gobo_window.png'), P.to_u8(g))
    angle = math.atan(tan_a)
    return {
        'position': b2t(pos), 'target': b2t(target), 'angle': angle,
        'near': 0.5, 'far': L + 6.0, 'size': n,
    }


# ---------------------------------------------------------------- main
def main():
    scene = C.reset_scene()
    C.use_metal_gpu(scene)
    C.TIMINGS.clear()
    with C.timed('generate low-poly corner (wall booleans, grille, desk, lamp, floor)'):
        mats = build_materials()
        parts = [build_wall(mats), build_floor(mats), build_desk(mats), *build_lamp(mats),
                 build_grille(mats)]
        for p in parts:
            STATS[f'tris_{p.name}'] = C.tri_count(p)
        C.select_only(parts, parts[0])
        bpy.ops.object.join()
        corner = bpy.context.view_layer.objects.active
        corner.name = 'Corner'
        STATS['tris_corner_total'] = C.tri_count(corner)
    with C.timed('lightmap UV unwrap + pack (UVLightmap)'):
        lightmap_uvs(corner)
    enclosure = build_bake_only()
    bg, sun = setup_lighting(scene)
    scene.cycles.samples = LM_SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4

    # A: sky/courtyard light, direct + indirect. Sun off.
    sun.hide_render = True
    A = bake_diffuse(corner, 'A_sky', {'DIRECT', 'INDIRECT'})
    # B: sun bounce only (its direct part is the live gobo spot in three.js). Sky off.
    sun.hide_render = False
    bg.inputs['Strength'].default_value = 0.0
    B = bake_diffuse(corner, 'B_sunbounce', {'INDIRECT'})
    # C: sun direct, for calibrating the live spot and as a fully baked low-tier fallback.
    Cd = bake_diffuse(corner, 'C_sundirect', {'DIRECT'})
    bg.inputs['Strength'].default_value = SKY_STRENGTH

    np.save(os.path.join(C.RAW, 'lm_A.npy'), A.astype(np.float32))
    np.save(os.path.join(C.RAW, 'lm_B.npy'), B.astype(np.float32))
    np.save(os.path.join(C.RAW, 'lm_C.npy'), Cd.astype(np.float32))
    live = A + B
    valid = live.sum(-1) > 0
    M = float(np.percentile(live[valid].max(-1), 99.7))
    P.write_png(os.path.join(C.OUT, 'lightmap_golden.png'), P.to_u8(lin_to_srgb(live / M)))
    full = A + B + Cd
    Mf = float(np.percentile(full[valid].max(-1), 99.7))
    P.write_png(os.path.join(C.RAW, 'lightmap_golden_fullbake.png'), P.to_u8(lin_to_srgb(full / Mf)))
    # calibration: fully sunlit up-facing texels (floor, desk top) in C give the sun's
    # Cycles 'diffuse direct' value V; three wants irradiance E = pi * V (BRDF = albedo/pi).
    img_nrm = C.new_image('lm_normal', LM_SIZE, LM_SIZE, float_buffer=True, data=True)
    C.bake_target(corner, img_nrm)
    C.select_only([corner], corner)
    bpy.ops.object.bake(type='NORMAL', normal_space='OBJECT', margin=0, use_clear=True,
                        uv_layer='UVLightmap', target='IMAGE_TEXTURES')
    nz = C.image_to_numpy(img_nrm)[..., 2] * 2 - 1
    lum = Cd.max(-1)
    up = (nz > 0.995) & (lum > 0)
    lit = lum[up & (lum > 0.6 * lum[up].max())]
    patch = float(np.median(lit))
    cos_floor = math.sin(math.radians(SUN_EL))
    spot_intensity = math.pi * patch / cos_floor
    STATS.update({'lightmap_scale_M': M, 'sun_patch_C_up': patch, 'sun_patch_texels': int(lit.size),
                  'cycles_V_over_E': patch / (SUN_STRENGTH * max(SUN_COLOR) * cos_floor),
                  'spot_intensity_three': spot_intensity})

    with C.timed('gobo projection (numpy)'):
        gobo = make_gobo()

    # restore export state: no bake targets, emission back on, bake-only hidden
    C.remove_bake_targets(corner)
    mats['glaze'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 2.0
    meta = {
        'note': 'THROWAWAY SPIKE OUTPUT (M1 pipeline spike). three.js coordinates, metres.',
        'lightmap': {'file': 'lightmap_golden', 'uv': 1, 'intensity': math.pi * M, 'colorSpace': 'srgb'},
        'sun': {'color': list(SUN_COLOR), 'intensity': spot_intensity, **gobo,
                'gobo': 'gobo_window.png'},
        'lamp': {'position': b2t(LAMP_POS), 'color': [0.16, 0.82, 0.80]},
        'window': {'center': b2t((WIN_IN['cx'], WALL_T + 0.25, 1.9)), 'size': [1.0, 1.6]},
        'sky': {'color': list(SKY_COLOR), 'strength': SKY_STRENGTH},
    }
    corner['diwan'] = json.dumps(meta)
    with open(os.path.join(C.OUT, 'corner.meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)

    C.select_only([corner], corner)
    glb = os.path.join(C.RAW, 'corner.raw.glb')
    with C.timed('export GLB'):
        bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True,
                                  export_texcoords=True, export_normals=True,
                                  export_tangents=False, export_materials='EXPORT',
                                  export_extras=True, export_yup=True, export_apply=True,
                                  export_image_format='AUTO', export_lights=False,
                                  export_cameras=False)
    STATS['glb_raw_bytes'] = os.path.getsize(glb)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(C.RAW, 'corner.blend'))
    C.TIMINGS.update(STATS)
    C.save_timings('scene')
    print('[stats]', json.dumps(STATS, indent=1), flush=True)
    _ = enclosure


main()
