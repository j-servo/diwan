# House of Life: geometry for the temple's parts, in plan coordinates (hall_geom.py: x east,
# y up, z south, metres). The Hathor column after Description de l'Egypte Pl. 12, the cavetto
# cornice, the obelisks and the pyramid (pyramid_spec.py).
import math

import bmesh
import bpy
import numpy as np

import hall_geom as G
import pyramid_spec as S
import temple_textures as TT
from hall_geom import B, MI


# ---------------------------------------------------------------- small helpers
def uv_layer(bm):
    return bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')


def quad(bm, pts, mat, uvs=None, smooth=False):
    """One face through plan points (in order), with optional per-corner UVs."""
    f = bm.faces.new([bm.verts.new(B(*p)) for p in pts])
    f.material_index = MI[mat]
    f.smooth = smooth
    if uvs is not None:
        layer = uv_layer(bm)
        for loop, uv in zip(f.loops, uvs):
            loop[layer].uv = uv
    return f


def region_uv(region, u, v):
    """(u, v) in [0, 1] -> UV inside a column-atlas rectangle."""
    u0, v0, u1, v1 = TT.COL_UV[region]
    return (u0 + u * (u1 - u0), v0 + v * (v1 - v0))


def uv_box(bm, x0, x1, y0, y1, z0, z1, mat, uvfn):
    """Axis-aligned box whose faces take uvfn(normal_axis_sign, (x, y, z)) -> (u, v)."""
    faces = G.box(bm, x0, x1, y0, y1, z0, z1, mat=mat)
    layer = uv_layer(bm)
    for f in faces:
        n = G.plan_normal(f.normal)
        for loop in f.loops:
            loop[layer].uv = uvfn(n, G.plan(loop.vert.co))
    return faces


def cylinder(bm, cx, cz, r0, r1, y0, y1, seg, mat, uvfn=None, cap=True, rings=2):
    """Vertical (tapered) cylinder with per-loop UVs: uvfn(k / seg, t) for t along its height."""
    layer = uv_layer(bm)
    ys = np.linspace(y0, y1, rings)
    vr = []
    for i, y in enumerate(ys):
        t = i / (rings - 1)
        r = r0 + (r1 - r0) * t
        vr.append([bm.verts.new(B(cx + r * math.cos(2 * math.pi * k / seg), y,
                                  cz + r * math.sin(2 * math.pi * k / seg))) for k in range(seg)])
    faces = []
    for i in range(rings - 1):
        for k in range(seg):
            j = (k + 1) % seg
            f = bm.faces.new((vr[i][k], vr[i + 1][k], vr[i + 1][j], vr[i][j]))
            f.material_index = MI[mat]
            f.smooth = True
            if uvfn:
                t0, t1 = i / (rings - 1), (i + 1) / (rings - 1)
                for loop, (kk, tt) in zip(f.loops, ((k, t0), (k, t1), (k + 1, t1), (k + 1, t0))):
                    loop[layer].uv = uvfn(kk / seg, tt)
            faces.append(f)
    if cap:
        f = bm.faces.new(vr[-1][::-1])
        f.material_index = MI[mat]
        if uvfn:
            for loop in f.loops:
                loop[layer].uv = uvfn(0.5, 1.0)
        faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    return faces


# ---------------------------------------------------------------- the Hathor column (Pl. 12)
# Proportions per unit height (E2 rulings, E0b's Dendera numbers): the capital is 0.36 of the
# column, the shaft ~0.15 across; base, the broad collar, the four heads, the plate, the naos, the
# abacus. The heads' zone is as tall as the head image is for its width (1024 : 760 over 2 half-widths).
COL = dict(base=(0.0, 0.018, 0.108), base2=(0.018, 0.03, 0.094), shaft=(0.03, 0.61),
           r_bottom=0.077, r_top=0.071, collar=(0.61, 0.64, 0.079), heads=(0.64, 0.8394),
           half=0.074, plate=(0.8394, 0.858, 0.088), naos=(0.858, 0.972, 0.076),
           abacus=(0.972, 1.0, 0.08))
SIDES = [((1, 0, 0), (0, 0, 1)), ((0, 0, -1), (1, 0, 0)), ((-1, 0, 0), (0, 0, -1)),
         ((0, 0, 1), (-1, 0, 0))]   # (right, outward) per side: south, east, north, west
SIDE_NAMES = ('south', 'east', 'north', 'west')
# Triangles per head (the TRELLIS head as a height field, decimated): the facade columns show the
# court their south face in full and their sides at a grazing angle; north faces look into the
# pronaos. The master (~10K) is what the door's two columns show.
HEAD_LODS = {'master': 10000, 'hi': 4000, 'mid': 1500, 'lo': 420}
HEAD_GRID = (176, 128)          # the dense grid the LODs are decimated from (rows, columns)
_HEAD_MESHES = {}


def head_templates(disp, stats):
    """One head per LOD as (co, faces, uvs) in the head's frame: x across the side in core
    half-widths [-1, 1], y up (0 at the heads' foot, HEAD_RATIO at the top), z outward. A dense
    grid displaced by the height field (with a skirt down to the block at the top and the foot),
    then Blender's collapse decimation, which keeps the eyes, lips and ears' edges where the
    triangles go. Cached: every column copies these."""
    if _HEAD_MESHES:
        return _HEAD_MESHES
    ratio = 2.0 * TT.HEAD_IMG[0] / TT.HEAD_IMG[1]
    nv, nu = HEAD_GRID
    d = TT.resample(disp, nv + 1, nu + 1)[::-1]              # row 0 = the foot
    u0, u1 = TT.HEAD_SPAN
    fu0, fv0, fu1, fv1 = TT.COL_UV['face']
    bm = bmesh.new()
    layer = uv_layer(bm)
    rows = []
    for j in range(nv + 1):
        rows.append([bm.verts.new((-1 + 2 * i / nu, ratio * j / nv, float(d[j, i])))
                     for i in range(nu + 1)])
    skirt_lo = [bm.verts.new((v.co.x, 0.0, 0.0)) for v in rows[0]]
    skirt_hi = [bm.verts.new((v.co.x, ratio, 0.0)) for v in rows[-1]]

    def uv_of(i, j):
        return (fu0 + (u0 + (u1 - u0) * i / nu) * (fu1 - fu0), fv0 + (fv1 - fv0) * j / nv)
    for j in range(nv):
        for i in range(nu):
            f = bm.faces.new((rows[j][i], rows[j][i + 1], rows[j + 1][i + 1], rows[j + 1][i]))
            for loop, (ii, jj) in zip(f.loops, ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))):
                loop[layer].uv = uv_of(ii, jj)
    for i in range(nu):
        for ring, edge, jj, flip in ((skirt_lo, rows[0], 0, False), (skirt_hi, rows[-1], nv, True)):
            q = (ring[i], ring[i + 1], edge[i + 1], edge[i])
            f = bm.faces.new(q[::-1] if flip else q)
            for loop, ii in zip(f.loops, ((i, i + 1, i + 1, i)[::-1] if flip else (i, i + 1, i + 1, i))):
                loop[layer].uv = uv_of(ii, jj)
    me = bpy.data.meshes.new('head_dense')
    bm.to_mesh(me)
    bm.free()
    dense = len(me.polygons) * 2
    for lod, target in HEAD_LODS.items():
        ob = bpy.data.objects.new(f'head_{lod}', me.copy())
        bpy.context.scene.collection.objects.link(ob)
        mod = ob.modifiers.new('decimate', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = target / dense
        mod.use_collapse_triangulate = True
        dg = bpy.context.evaluated_depsgraph_get()
        ev = ob.evaluated_get(dg)
        m2 = bpy.data.meshes.new_from_object(ev)
        co = np.array([v.co[:] for v in m2.vertices])
        faces = [tuple(p.vertices) for p in m2.polygons]
        uvl = m2.uv_layers[0].data
        uvs = [[tuple(uvl[li].uv) for li in p.loop_indices] for p in m2.polygons]
        _HEAD_MESHES[lod] = (co, faces, uvs)
        stats[f'head_tris_{lod}'] = sum(len(f) - 2 for f in faces)
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(m2)
    stats['head_tris_dense'] = dense
    bpy.data.meshes.remove(me)
    return _HEAD_MESHES


def hathor_column(bm, cx, cz, H, lods, disp, stats):
    """One Hathor column standing at (cx, cz), H tall, in the column atlas, with the four heads
    at the LODs given per side ({'south': 'hi', ...})."""
    c = COL
    stone = TT.plain_uv(TT.STONE)
    blue = TT.plain_uv(TT.BLUE)
    for (y0, y1, r) in (c['base'], c['base2']):
        cylinder(bm, cx, cz, r * H, r * H, y0 * H, y1 * H, 24, 'column', lambda k, t: stone)
    sy0, sy1 = c['shaft']
    cylinder(bm, cx, cz, c['r_bottom'] * H, c['r_top'] * H, sy0 * H, sy1 * H, 24, 'column',
             lambda k, t: region_uv('shaft', k, t), cap=False, rings=5)
    y0, y1, r = c['collar']
    cylinder(bm, cx, cz, r * H, r * H, y0 * H, y1 * H, 24, 'column',
             lambda k, t: region_uv('collar', k, t))
    # the four Hathor heads, back to back on the block
    a = c['half'] * H
    hy0 = c['heads'][0] * H
    heads = head_templates(disp, stats)
    layer = uv_layer(bm)
    for (right, out), side in zip(SIDES, SIDE_NAMES):
        co, faces, uvs = heads[lods[side]]
        rx, _, rz = right
        ox, _, oz = out
        vs = [bm.verts.new(B(cx + ox * (a + p[2] * a) + rx * p[0] * a, hy0 + p[1] * a,
                             cz + oz * (a + p[2] * a) + rz * p[0] * a)) for p in co]
        for f, fuv in zip(faces, uvs):
            try:
                face = bm.faces.new([vs[i] for i in f])
            except ValueError:
                continue
            face.material_index = MI['column']
            face.smooth = True
            for loop, uv in zip(face.loops, fuv):
                loop[layer].uv = uv
    hy1 = c['heads'][1] * H
    quad(bm, [(cx - a, hy0, cz - a), (cx + a, hy0, cz - a), (cx + a, hy0, cz + a),
              (cx - a, hy0, cz + a)], 'column', [stone] * 4)
    for (y0, y1, r), uv in ((c['plate'], blue), (c['abacus'], stone)):
        uv_box(bm, cx - r * H, cx + r * H, y0 * H, y1 * H, cz - r * H, cz + r * H, 'column',
               lambda n, p, uv=uv: uv)
    del hy1
    y0, y1, r = c['naos']
    R = r * H

    def naos_uv(n, p):
        x, y, z = p
        t = (y / H - y0) / (y1 - y0)
        if abs(n[1]) > 0.9:
            return stone
        if abs(n[2]) > 0.9:
            s = (x - cx) / R * (1 if n[2] > 0 else -1)
        else:
            s = -(z - cz) / R * (1 if n[0] > 0 else -1)
        return region_uv('naos', (s + 1) / 2, t)
    uv_box(bm, cx - R, cx + R, y0 * H, y1 * H, cz - R, cz + R, 'column', naos_uv)


# ---------------------------------------------------------------- cavetto cornice
def cavetto(bm, x0, x1, y0, y1, z_face, proud, sign, mat, uvfn, n=6, caps=True):
    """A cavetto (gorge) along x: concave from the wall face (z_face) out by `proud` towards
    sign (+1 south), y0..y1; uvfn(x, t) -> UV with t from bottom (0) to top (1). Returns faces."""
    layer = uv_layer(bm)
    ts = np.linspace(0, 1, n + 1)
    off = proud * (1 - np.sqrt(np.clip(1 - ts ** 2, 0, 1)))
    rows = [(y0 + (y1 - y0) * t, z_face + sign * o) for t, o in zip(ts, off)]
    faces = []
    for (ya, za), (yb, zb), ta, tb in zip(rows[:-1], rows[1:], ts[:-1], ts[1:]):
        pts = [(x0, ya, za), (x1, ya, za), (x1, yb, zb), (x0, yb, zb)]
        if sign < 0:
            pts = pts[::-1]
        uvs = [uvfn(x0, ta), uvfn(x1, ta), uvfn(x1, tb), uvfn(x0, tb)]
        if sign < 0:
            uvs = uvs[::-1]
        faces.append(quad(bm, pts, mat, uvs, smooth=True))
    # the overhang's top, back to the wall
    yt, zt = rows[-1]
    pts = [(x0, yt, z_face), (x1, yt, z_face), (x1, yt, zt), (x0, yt, zt)]
    faces.append(quad(bm, pts if sign > 0 else pts[::-1], mat, [uvfn(x0, 1.0)] * 4))
    if caps:   # close the profile's ends, so the overhang reads as stone, not a shell
        for x, flip in ((x0, sign > 0), (x1, sign < 0)):
            pts = [(x, y, z) for y, z in rows] + [(x, rows[-1][0], z_face), (x, rows[0][0], z_face)]
            faces.append(quad(bm, pts[::-1] if flip else pts, mat, [uvfn(x, 0.5)] * len(pts)))
    return faces


# ---------------------------------------------------------------- obelisks
OBELISK = dict(base=0.54, top=0.38, shaft=5.3, tip=0.5, pedestal=((1.0, 0.16), (0.78, 0.14)))
# The tapering limestone shaft takes one atlas strip per face (temple_textures.obelisk_atlas):
# the strips' order is Pl. 12 (the western obelisk) faces 1-3, then Pl. 11 (the eastern) faces 1-3.
# The western obelisk (the tile (3, 9)) shows strips 0, 1, 2 to the south, east and west; the eastern
# one (16, 9) shows 3, 4, 5 to the south, west and east. The north faces repeat one of their own
# plate's (nobody sees them).
OBELISK_STRIPS = {
    'w': dict(south=0, east=1, west=2, north=2),
    'e': dict(south=3, west=4, east=5, north=5),
}


def obelisk(bm, cx, cz, side, o=OBELISK):
    """Limestone obelisk on a two-step pedestal: base:height about 1:10, a gentle taper,
    the traced inscription on the middle of each face (its own atlas strip), and a pyramidion
    sheathed in gold with a sharp point. Returns the height of the point."""
    y = 0.0
    for pw, ph in o['pedestal']:
        G.box(bm, cx - pw / 2, cx + pw / 2, y, y + ph, cz - pw / 2, cz + pw / 2, mat='lime_warm')
        y += ph
    b, t = o['base'] / 2, o['top'] / 2
    y1 = y + o['shaft']
    layer = uv_layer(bm)
    strips = OBELISK_STRIPS[side]
    n_strips = 6
    for (right, out), name in zip(SIDES, ('south', 'east', 'north', 'west')):
        rx, _, rz = right
        ox, _, oz = out

        def pt(r, yy, s):
            return bm.verts.new(B(cx + ox * r + rx * s * r, yy, cz + oz * r + rz * s * r))
        f = bm.faces.new([pt(b, y, -1), pt(b, y, 1), pt(t, y1, 1), pt(t, y1, -1)])
        f.material_index = MI['obelisk']
        f.smooth = False
        k = strips[name]
        for loop, (u, v) in zip(f.loops, ((0, 0), (1, 0), (1, 1), (0, 1))):
            loop[layer].uv = ((k + u) / n_strips, v)
    # the gold sheath: its base a hair wider than the shaft's top, so it reads as a cap
    gb = t + 0.008
    yb = y1 - 0.02
    ring = [bm.verts.new(B(cx + sx * gb, yb, cz + sz * gb))
            for sx, sz in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    apex = bm.verts.new(B(cx, y1 + o['tip'], cz))
    faces = [bm.faces.new((ring[i], ring[(i + 1) % 4], apex)) for i in range(4)]
    faces.append(bm.faces.new(ring[::-1]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = MI['gold']
    return y1 + o['tip']


# ---------------------------------------------------------------- the pyramid
def build_pyramid(cx, cz, y0, stats):
    """The Great Pyramid as it stood in its golden era: a complete square pyramid of polished
    white Tura casing, crisp arrises, rising to a gold pyramidion at the true apex. Returns
    (casing, capstone)."""
    def p(s, h, e):
        return (cx + s, y0 + h, cz + e)

    bm = bmesh.new()
    wt = S.half_width(S.CASING_TOP)
    layer = uv_layer(bm)
    corners = ((-1, -1), (1, -1), (1, 1), (-1, 1))
    # courses up the face: plain casing, then three carved bands (the frieze, the Thoth bands), each
    # its own material, with plain casing between them and above
    bands = [('frieze', S.FRIEZE_CENTRE, S.FRIEZE_ROWS), (S.THOTH_LOW['mat'], S.THOTH_LOW['centre'],
             S.THOTH_LOW['rows']), (S.THOTH_HIGH['mat'], S.THOTH_HIGH['centre'], S.THOTH_HIGH['rows'])]
    rings = [('b', S.HALF, 0.0)]
    courses = []
    prev = 'b'
    for mat, centre, rows in bands:
        h0, h1 = S.band_extent(centre, rows)
        rings += [(mat + '0', S.half_width(h0), h0), (mat + '1', S.half_width(h1), h1)]
        courses += [(prev, mat + '0', 'limestone', None), (mat + '0', mat + '1', mat, rows)]
        prev = mat + '1'
    rings.append(('t', wt, S.CASING_TOP))
    courses.append((prev, 't', 'limestone', None))
    ring = {(key, i): bm.verts.new(B(*p(s_ * r, h, e_ * r)))
            for key, r, h in rings for i, (s_, e_) in enumerate(corners)}
    pos = {key: (r, h) for key, r, h in rings}
    for lo, hi, mat, rows in courses:
        for i in range(4):
            j = (i + 1) % 4
            keys = [(lo, i), (lo, j), (hi, j), (hi, i)]
            f = bm.faces.new([ring[k] for k in keys])
            f.material_index = MI[mat]
            f.smooth = False
            if rows is None:
                continue
            # the band texture spans the base's width across and the band's own extent up the slope,
            # u along the face as the viewer outside reads it (right = (nz, 0, -nx)), v up the slope
            h_lo = pos[lo][1]
            (s0, e0), (s1, e1) = corners[i], corners[j]
            nx, nz = (s0 + s1) / 2, (e0 + e1) / 2             # the face's outward normal in plan
            for loop, (key, ci) in zip(f.loops, keys):
                r, h = pos[key]
                cs, ce = corners[ci]
                u = 0.5 + (cs * r * nz - ce * r * nx) / S.BASE
                loop[layer].uv = (u, (h - h_lo) / S.SIN_SLOPE / S.band_slant(rows))
    faces = list(bm.faces)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    casing = G.new_object('pyramid_casing', bm)
    stats['pyramid_tris'] = G.tri_count(casing)

    # the gold pyramidion: the true apex, its foot a hair wider than the casing's top
    bm = bmesh.new()
    gw = wt + 0.006
    gy = S.CASING_TOP - 0.004
    base = [bm.verts.new(B(*p(s_ * gw, gy, e_ * gw))) for s_, e_ in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    apex = bm.verts.new(B(*p(0.0, S.HEIGHT, 0.0)))
    faces = [bm.faces.new((base[i], base[(i + 1) % 4], apex)) for i in range(4)]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = MI['gold']
        f.smooth = False
    cap = G.new_object('pyramid_capstone', bm)
    stats['capstone_tris'] = G.tri_count(cap)
    return casing, cap
