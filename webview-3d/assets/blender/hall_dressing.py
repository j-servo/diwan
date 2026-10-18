# House of Wisdom: the hall's dressing (M1 Task 2b).
#   kufic_letters      بيت الحكمة in Reem Kufi SemiBold, raised plaster letters in the pishtaq panel
#   logo_panel         the J. Servo mark on parchment, framed in cedar on the east wall
#   planter_<c>_<r>    lustre-glazed jars with flowering shrubs, in place of the two front palms
# Shaped Arabic and the logo raster come from assets/render-glyphs.mjs (headless Chromium:
# Blender's text objects cannot shape Arabic). This module turns those pixels into geometry and
# textures; it never re-shapes or re-colours them. Strings: docs/superpowers/arabic-strings.md.
import math
import os

import bmesh
import bpy
import mathutils
import numpy as np

import hall_geom as G
import patterns as P
from hall_geom import B, MI, box

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.normpath(os.path.join(HERE, '..', 'worlds', 'house-of-wisdom', 'src'))
KUFIC_PNG = 'kufic_bayt_al_hikma.png'
LOGO_PNG = 'jservo-mark-flat.png'
GLYPH_PAD = 24                 # clear px around the ink in the glyph PNG (render-glyphs.mjs PAD)

KUFIC_RELIEF = 0.035           # letters stand 3.5 cm proud of the panel ground
KUFIC_BEVEL = 0.005
KUFIC_MARGIN = (0.25, 0.12)    # clear ground each side / above and below: the word spans ~88% of the panel

LOGO_TEX = (1024, 1024)        # square parchment field, 716 px per metre
LOGO_FIELD_M = (1.43, 1.43)    # parchment width x height (Yousef: 30% larger, 2026-10-12)
LOGO_FRAME = 0.13              # cedar frame width
LOGO_PX = (736, 736)           # the mark in the field (1.03 m); its raster is 2x this (render-glyphs.mjs)

PLANTER_TEX = 1024
JAR_PX, JAR_GUTTER = 896, 16   # the jar's glaze fills x in [0, 896); swatches fill the rest
JAR_U = JAR_PX / PLANTER_TEX
# the jar maps inside a wrap-around gutter, so mips never bleed swatch colours into its seam
JAR_U0, JAR_U1 = JAR_GUTTER / PLANTER_TEX, (JAR_PX - JAR_GUTTER) / PLANTER_TEX
SWATCHES = {'leaf_dark': (60, 90, 50), 'leaf_mid': (86, 120, 62), 'leaf_light': (120, 148, 80),
            'oleander': (222, 120, 150), 'oleander_deep': (186, 74, 104),
            'jasmine': (244, 240, 228), 'soil': (88, 62, 44)}


# ---------------------------------------------------------------- shared helpers
def load_png(path):
    """8-bit PNG -> float RGBA, row 0 = top, values exactly as stored (no colour transform)."""
    if not os.path.exists(path):
        raise SystemExit(f'missing {path}: run node assets/render-glyphs.mjs (npm run assets:bake)')
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1].astype(np.float64)


def _uv_layer(bm):
    return bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')


# ---------------------------------------------------------------- textures
def logo_field(stats):
    """The logo panel's base colour: parchment, a gold-and-ink ruled border (jadwal), and the
    J. Servo mark composited over it exactly as rasterised (brand colours untouched)."""
    W, H = LOGO_TEX
    u = (np.arange(W) + 0.5) / W
    v = (np.arange(H) + 0.5) / H
    U, V = np.meshgrid(u, v)
    mott = P.wave_noise(U, V * H / W, 121, fmin=2, fmax=24)
    edge = np.minimum.reduce([U * W, (1 - U) * W, V * H, (1 - V) * H])        # px to the rim
    ground = P.srgb((241, 233, 214)) * (1 + 0.02 * mott - 0.03 * np.exp(-edge / 40))[..., None]
    img = ground.copy()
    for inset, width, rgb in ((34, 10, (190, 150, 74)), (52, 3, (74, 50, 34))):
        ring = (edge >= inset) & (edge < inset + width)
        img[ring] = P.srgb(rgb)
    P.assert_no_cobalt(img, 'logo parchment and rules')
    # the mark, rendered at 2x: average 2x2 (premultiplied) down to LOGO_PX
    logo = load_png(os.path.join(SRC, LOGO_PNG))
    lh, lw = logo.shape[:2]
    assert (lw // 2, lh // 2) == LOGO_PX, f'logo raster is {lw}x{lh}, expected 2x {LOGO_PX}'
    prem = np.concatenate([logo[..., :3] * logo[..., 3:], logo[..., 3:]], -1)
    prem = prem.reshape(lh // 2, 2, lw // 2, 2, 4).mean((1, 3))
    x0, y0 = (W - LOGO_PX[0]) // 2, (H - LOGO_PX[1]) // 2
    win = img[y0:y0 + LOGO_PX[1], x0:x0 + LOGO_PX[0]]
    win[:] = prem[..., :3] + win * (1 - prem[..., 3:])
    solid = prem[..., 3] > 0.999
    stats['logo_cobalt_band_fraction'] = round(P.cobalt_clash(prem[..., :3][solid]), 5)
    return img


def planter_texture():
    """Tin-glazed jar painted in golden and brown lustre (9th-century Abbasid lustreware motifs:
    tongues, peacock-eye roundels on a dotted ground, chevrons), plus flat swatches for the
    shrub."""
    n, jw, g = PLANTER_TEX, JAR_PX, JAR_GUTTER
    U, V = np.meshgrid((np.arange(jw) - g + 0.5) / (jw - 2 * g), 1 - (np.arange(n) + 0.5) / n)
    cream, gold, brown = P.srgb((236, 226, 202)), P.srgb((186, 138, 62)), P.srgb((118, 72, 38))
    pool = P.wave_noise(U, V, 131, fmin=2, fmax=30, period_v=None)
    img = np.broadcast_to(cream, (n, jw, 3)) * (1 + 0.025 * pool)[..., None]
    img = img.copy()

    def put(mask, rgb):
        img[mask] = rgb

    def band(lo, hi):
        return (V >= lo) & (V < hi)

    N = 6                                     # motif repeats around the jar
    s = (U * N) % 1.0                         # 0..1 across one repeat
    put(band(0.0, 0.06), brown)
    put(band(0.085, 0.095), gold)
    # lower band: rounded tongues (gadroons), two per repeat
    sl = (U * 2 * N) % 1.0 - 0.5
    t = (V - 0.11) / 0.14
    cap = np.hypot(sl / 0.34, (t - 0.62) / 0.38) < 1
    tongue = band(0.11, 0.25) & (np.abs(sl) < 0.34) & ((t < 0.62) | cap)
    put(tongue, gold)
    put(tongue & (np.abs(sl) < 0.08) & (t < 0.7), brown)
    put(band(0.27, 0.28), brown)
    put(band(0.29, 0.295), gold)
    # main field: peacock-eye roundels on a ground of fine lustre dots
    field = band(0.31, 0.69)
    k = 2.1                                    # field height / repeat width (jar proportions)
    fx, fy = (s - 0.5), (V - 0.5) / 0.38 * k / 2
    rr = np.hypot(fx, fy)
    dots = (np.hypot((U * N * 9) % 1 - 0.5, (V * 64) % 1 - 0.5) < 0.2) & (rr > 0.36)
    put(field & dots, gold)
    put(field & (rr < 0.34), brown)
    put(field & (rr < 0.31), gold)
    put(field & (rr < 0.22), cream)
    put(field & (rr < 0.16), gold)
    put(field & (rr < 0.07), brown)
    # small four-dot rosettes between the roundels
    ox = np.minimum(s, 1 - s)
    for cy in (0.37, 0.63):
        for dx, dy in ((0.05, 0), (-0.05, 0), (0, 0.025), (0, -0.025)):
            put(field & (np.hypot(ox - abs(dx) if dx else ox, (V - cy - dy) * 2) < 0.022), brown)
    put(band(0.71, 0.715), gold)
    put(band(0.725, 0.735), brown)
    # shoulder: chevrons, brown outline with gold infill
    sc = (U * N * 4) % 1.0
    tc = (V - 0.75) / 0.11
    zig = np.abs(sc - 0.5) * 2
    shoulder = band(0.75, 0.86)
    put(shoulder & (np.abs(tc - zig * 0.7 - 0.15) < 0.11), brown)
    put(shoulder & (tc > zig * 0.7 + 0.28), gold)
    put(band(0.875, 0.882), brown)
    neck = band(0.89, 0.95) & (np.hypot((U * N * 6) % 1 - 0.5, (V - 0.92) * 50) < 0.22)
    put(neck, gold)
    put(band(0.95, 1.01), brown)
    P.assert_no_cobalt(img, 'planter glaze')
    out = np.zeros((n, n, 3))
    out[:, :jw] = img
    out[:, jw:] = P.srgb(SWATCHES['soil'])
    for i, rgb in enumerate(SWATCHES.values()):
        out[i * 128:(i + 1) * 128, jw:] = P.srgb(rgb)
    P.assert_no_cobalt(out, 'planter swatches')
    return out


def swatch_uv(name):
    i = list(SWATCHES).index(name)
    return ((JAR_U * PLANTER_TEX + (PLANTER_TEX - JAR_U * PLANTER_TEX) / 2) / PLANTER_TEX,
            1 - (i * 128 + 64) / PLANTER_TEX)


def write_textures(tex_dir, stats):
    P.write_png(os.path.join(tex_dir, 'logo_panel_basecolor.png'), P.to_u8(logo_field(stats)))
    P.write_png(os.path.join(tex_dir, 'planter_basecolor.png'), P.to_u8(planter_texture()))


# ---------------------------------------------------------------- the inscription
def build_kufic(panel, z_face, stats):
    """Raised letters traced from the Reem Kufi raster: marching squares at the half-coverage
    contour, simplified, filled (holes and dots included), extruded and lightly bevelled.
    The panel faces south (+z): image left is west, so the text reads right to left from the
    courtyard, بيت on the east."""
    a = load_png(os.path.join(SRC, KUFIC_PNG))[..., 3]
    h, w = a.shape
    x0, x1, y0, y1 = panel
    ink_w, ink_h = w - 2 * GLYPH_PAD, h - 2 * GLYPH_PAD
    m = min((x1 - x0 - 2 * KUFIC_MARGIN[0]) / ink_w, (y1 - y0 - 2 * KUFIC_MARGIN[1]) / ink_h)  # m/px
    bx = (x0 + x1) / 2 - ink_w * m / 2
    by = (y0 + y1) / 2 - ink_h * m / 2
    xs = bx + (np.arange(w) - GLYPH_PAD + 0.5) * m
    ys = by + (np.arange(h) - GLYPH_PAD + 0.5) * m
    loops = []
    for lp in P.marching_squares(a[::-1] - 0.5, xs, ys):       # rows bottom -> top = y up
        s = P.simplify_loop(lp, 0.3 * m)
        if len(s) >= 3 and abs(_area(s)) > 4e-6:
            loops.append(np.asarray(s))
    bm = bmesh.new()
    za, zb = z_face + KUFIC_RELIEF, z_face - 0.005
    filled = 0.0
    # one scanfill per letter body with its own holes: a single fill over every contour bridges
    # separate letters
    for outer, holes in _nest(loops):
        polys = [outer] + holes
        tris = mathutils.geometry.tessellate_polygon(
            [[mathutils.Vector((x, y, 0)) for x, y in lp] for lp in polys])
        flat = np.concatenate(polys)
        front = [bm.verts.new(B(x, y, za)) for x, y in flat]
        back = [bm.verts.new(B(x, y, zb)) for x, y in flat]
        for i, j, k in tris:
            filled += abs(_area(flat[[i, j, k]]))
            for ring in (front, back):
                bm.faces.new((ring[i], ring[j], ring[k]))
        off = 0
        for lp in polys:
            n = len(lp)
            for i in range(n):
                j = (i + 1) % n
                bm.faces.new((front[off + i], front[off + j], back[off + j], back[off + i]))
            off += n
    ink = sum(abs(_area(o)) - sum(abs(_area(h)) for h in hs) for o, hs in _nest(loops))
    assert abs(filled - ink) < 0.002 * ink, f'kufic fill {filled:.5f} m2 != ink {ink:.5f} m2'
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.material_index = MI['plaster']
    ob = G.new_object('kufic_letters', bm)
    G.faces_where(ob, lambda c, n, f: n[2] < -0.9, 'delete')        # backs, against the panel
    G.bevelled(ob, KUFIC_BEVEL, 1)
    stats.update({'kufic_m_per_px': round(m, 6), 'kufic_size_m': [round(ink_w * m, 3),
                  round(ink_h * m, 3)], 'kufic_loops': len(loops),
                  'kufic_bodies': len(_nest(loops)), 'kufic_points': int(sum(map(len, loops)))})
    return ob


def _area(pts):
    q = np.asarray(pts)
    return 0.5 * (np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(q[:, 1], np.roll(q[:, 0], -1)))


def _inside(pt, poly):
    x, y = pt
    px, py = poly[:, 0], poly[:, 1]
    qx, qy = np.roll(px, -1), np.roll(py, -1)
    cross = (py > y) != (qy > y)
    xi = px + (y - py) * (qx - px) / np.where(qy == py, 1e-12, qy - py)
    return bool(np.count_nonzero(cross & (x < xi)) % 2)


def _nest(loops):
    """Group contours into (outer, [holes]) by nesting depth (even = ink, odd = counter)."""
    depth = [sum(_inside(lp[0], o) for o in loops if o is not lp) for lp in loops]
    groups = []
    for i, lp in enumerate(loops):
        if depth[i] % 2 == 0:
            holes = [h for j, h in enumerate(loops) if depth[j] == depth[i] + 1
                     and _inside(h[0], lp)]
            groups.append((lp, holes))
    return groups


# ---------------------------------------------------------------- the logo panel
def build_logo_panel(wall_x, cz, cy, inward):
    """A framed parchment panel on a wall plane x = wall_x, facing the room along +x * inward.
    UV0 spans the parchment 0..1, upright and unmirrored for a viewer inside the hall."""
    fw, fh = LOGO_FIELD_M
    z0, z1 = cz - fw / 2, cz + fw / 2
    y0, y1 = cy - fh / 2, cy + fh / 2
    wx = lambda d: wall_x + inward * d                                # d metres off the wall
    lo, hi = sorted((wx(0.0), wx(0.03)))
    bm = bmesh.new()
    faces = box(bm, lo, hi, y0, y1, z0, z1, mat='logo_panel_mat')
    layer = _uv_layer(bm)
    for f in faces:
        for loop in f.loops:
            x, y, z = G.plan(loop.vert.co)
            # viewer faces the wall: with inward = -1 (east wall) their right hand is south (+z)
            u = (z - z0) / fw if inward < 0 else (z1 - z) / fw
            loop[layer].uv = (u, (y - y0) / fh)
    panel = G.new_object('logo_panel', bm)
    G.faces_where(panel, lambda c, n, f: n[0] * inward < 0.9, 'delete')   # front face only
    bm = bmesh.new()
    F, lip = LOGO_FRAME, 0.025

    def ring(za, zb, ya, yb, d, depth):
        a0, a1 = sorted((wx(0.0), wx(depth)))
        box(bm, a0, a1, yb - d, yb, za, zb, mat='cedar')
        box(bm, a0, a1, ya, ya + d, za, zb, mat='cedar')
        box(bm, a0, a1, ya + d, yb - d, za, za + d, mat='cedar')
        box(bm, a0, a1, ya + d, yb - d, zb - d, zb, mat='cedar')

    ring(z0 - F, z1 + F, y0 - F, y1 + F, F, 0.06)      # outer moulding
    ring(z0, z1, y0, y1, lip, 0.045)                   # inner lip over the parchment's edge
    # a small cornice over the frame, as on the notice wall
    a0, a1 = sorted((wx(0.0), wx(0.085)))
    box(bm, a0, a1, y1 + F, y1 + F + 0.05, z0 - F - 0.06, z1 + F + 0.06, mat='cedar')
    frame = G.new_object('logo_frame', bm)
    G.faces_where(frame, lambda c, n, f: n[0] * inward < -0.9 and abs(c[0] - wall_x) < 0.01,
                  'delete')
    G.bevelled(frame, 0.006, 1)
    return [panel, frame]


# ---------------------------------------------------------------- planters
JAR = [(0.15, 0.0), (0.165, 0.025), (0.14, 0.06), (0.2, 0.13), (0.28, 0.25), (0.335, 0.4),
       (0.35, 0.53), (0.335, 0.66), (0.29, 0.78), (0.215, 0.88), (0.155, 0.94), (0.138, 1.0),
       (0.145, 1.05), (0.19, 1.1), (0.205, 1.125), (0.195, 1.14)]
JAR_IN = [(0.175, 1.13), (0.165, 1.08)]          # inside the lip, down to the soil
PLINTH_H = 0.15


def _lathe_uv(bm, profile, vs, cx, cz, y0, seg, mat):
    """Surface of revolution with cylindrical UV0 (u around in [JAR_U0, JAR_U1], v per ring)."""
    layer = _uv_layer(bm)
    rings, where = [], {}
    for i, (r, hgt) in enumerate(profile):
        ring = []
        for k in range(seg):
            t = 2 * math.pi * k / seg
            v = bm.verts.new(B(cx + r * math.cos(t), y0 + hgt, cz + r * math.sin(t)))
            where[v] = (k, i)
            ring.append(v)
        rings.append(ring)
    faces = []
    for a, b in zip(rings[:-1], rings[1:]):
        for k in range(seg):
            j = (k + 1) % seg
            f = bm.faces.new((a[k], a[j], b[j], b[k]))
            f.material_index = MI[mat]
            faces.append(f)
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        ks = [where[l.vert][0] for l in f.loops]
        wrap = max(ks) == seg - 1 and min(ks) == 0
        for loop in f.loops:
            k, i = where[loop.vert]
            if wrap and k == 0:
                k = seg
            loop[layer].uv = (JAR_U0 + (JAR_U1 - JAR_U0) * k / seg, vs[i])
    return rings


def _arc_v(profile):
    p = np.asarray(profile)
    s = np.concatenate([[0], np.cumsum(np.hypot(*np.diff(p, axis=0).T))])
    return list(s / s[-1])


def _blob(bm, c, r, rng, swatch):
    """A low-poly clump of leaves: a jittered icosphere."""
    res = bmesh.ops.create_icosphere(bm, subdivisions=2, radius=1.0)
    for v in res['verts']:
        d = mathutils.Vector(v.co).normalized()
        k = r * float(rng.uniform(0.85, 1.12))
        v.co = B(c[0] + d.x * k, c[1] + d.z * k * 0.82, c[2] - d.y * k)
    faces = list({f for v in res['verts'] for f in v.link_faces})
    for f in faces:
        f.material_index = MI['planter_mat']
    G.paint(bm, faces, swatch_uv(swatch))


def _flat_poly(bm, centre, normal, pts2d, swatch, cup=0.0):
    """A blossom: a closed fan of triangles in the plane normal to `normal`, its centre cupped."""
    n = mathutils.Vector(normal).normalized()
    t = n.orthogonal().normalized()
    b = n.cross(t)
    c = mathutils.Vector(centre)
    cv = bm.verts.new(B(*(c - n * cup)))
    rim = [bm.verts.new(B(*(c + t * x + b * y))) for x, y in pts2d]
    faces = []
    for i in range(len(rim)):
        f = bm.faces.new((cv, rim[i], rim[(i + 1) % len(rim)]))
        f.material_index = MI['planter_mat']
        faces.append(f)
    G.paint(bm, faces, swatch_uv(swatch))


def build_planter(f, tile, rng, flowers):
    """A tall tin-glazed lustre jar on a low marble plinth, planted with a flowering shrub
    (oleander or jasmine). Fits inside its own tile; never uses the palm material."""
    cx, cz = (f['col'] + 0.5) * tile, (f['row'] + 0.5) * tile
    bm = bmesh.new()
    oct_ring = lambda r, y: [(cx + r * math.cos(math.pi / 8 + k * math.pi / 4), y,
                              cz + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    G.loft(bm, [oct_ring(0.5, 0.0), oct_ring(0.5, 0.075), oct_ring(0.43, 0.075),
                oct_ring(0.43, PLINTH_H)], mat='marble', cap=True)
    vs = _arc_v(JAR) + [1.0] * len(JAR_IN)
    rings = _lathe_uv(bm, JAR + JAR_IN, vs, cx, cz, PLINTH_H, 24, 'planter_mat')
    soil = bm.faces.new(rings[-1][::-1])
    soil.material_index = MI['planter_mat']
    G.paint(bm, [soil], swatch_uv('soil'))
    top = PLINTH_H + JAR_IN[-1][1]
    leaves = ('leaf_dark', 'leaf_mid', 'leaf_light')
    blossom = ['oleander', 'oleander', 'oleander_deep'] if flowers == 'oleander' else \
        ['jasmine', 'jasmine', 'jasmine', 'oleander']
    # a rounded dome of small leaf clumps over the mouth, softened by a ring over the rim
    centre = np.array([cx, top + 0.14, cz])
    clumps = [(centre + [0, 0.12, 0], 0.16)]
    for k in range(22):
        el = math.radians(float(rng.uniform(-5, 80)))
        az = 2 * math.pi * k / 22 * 2.618 + float(rng.uniform(-0.2, 0.2))   # golden-angle spread
        d = np.array([math.cos(el) * math.cos(az), math.sin(el), math.cos(el) * math.sin(az)])
        clumps.append((centre + d * 0.27, float(rng.uniform(0.095, 0.13))))
    for k in range(9):                              # a soft ring spilling over the lip
        az = 2 * math.pi * (k + 0.5) / 9 + float(rng.uniform(-0.15, 0.15))
        h = np.array([math.cos(az), 0.0, math.sin(az)])
        clumps.append((np.array([cx, top + 0.035, cz]) + h * 0.21, float(rng.uniform(0.07, 0.09))))
    for c, r in clumps:
        _blob(bm, c, r, rng, leaves[int(rng.integers(3))])
    # blossoms in small clusters on the dome's outer surface (rounded five-petal flowers)
    lobes = [(0.031 * (0.5 + 0.5 * abs(math.cos(2.5 * t))) * math.cos(t),
              0.031 * (0.5 + 0.5 * abs(math.cos(2.5 * t))) * math.sin(t))
             for t in np.linspace(0, 2 * math.pi, 16, endpoint=False)]
    for k in range(15):
        el = math.radians(float(rng.uniform(5, 75)))
        az = float(rng.uniform(0, 2 * math.pi))
        d = np.array([math.cos(el) * math.cos(az), math.sin(el), math.cos(el) * math.sin(az)])
        swatch = blossom[int(rng.integers(len(blossom)))]
        for _ in range(3):
            dd = d + rng.normal(0, 0.12, 3)
            dd /= np.linalg.norm(dd)
            p = centre + dd * 0.39
            _flat_poly(bm, p, dd, lobes, swatch, cup=0.006)
    bm.normal_update()
    ob = G.new_object(f'planter_{f["col"]}_{f["row"]}', bm)
    G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < 0.01, 'delete')
    return ob
