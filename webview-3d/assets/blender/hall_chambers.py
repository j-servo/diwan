# House of Wisdom: three of the four north chambers become themed rooms (Yousef, 2026-10-15).
# West to east, as he listed them:
#   alcove-n-2   chamber_chemistry     Jabir ibn Hayyan's and al-Razi's distilling: a brick furnace
#                                      with an ember glow, an alembic, retorts, flasks, a mortar, a
#                                      balance, a shelf of jars
#   alcove-n-6   chamber_cartography   al-Khwarizmi's Surat al-Ard and al-Ma'mun's world map: a map
#                                      unrolled on the desk with dividers and a ruler, a rack of
#                                      rolled maps, map cases, a celestial globe, a map chest
#   alcove-n-12  chamber_biology       Hunayn ibn Ishaq, Dioscorides, al-Jahiz: herbs drying from a
#                                      rod, specimen jars and albarelli, a plant press, potted plants,
#                                      a mortar
#   alcove-n-16  stays the scholar's study.
# Each chamber keeps its desk, cushion, seat, lamp niche and lamp. The wall art (chamber_art.py)
# hangs in the iwan back (one hero sheet) and on the wall beside it; every prop keeps to the
# blocked desk tiles or to a 0.3 m band along a wall, so the walking tiles stay clear. One node per
# chamber: its props, its hung sheets and their rods, baked into the lightmap like the rest.
import math

import bmesh
import mathutils
import numpy as np

import chamber_art as CA
import hall_geom as G
from hall_geom import B, MI, box

THEMES = {'alcove-n-2-seat': 'chemistry', 'alcove-n-6-seat': 'cartography',
          'alcove-n-12-seat': 'biology'}
IWAN_DEPTH = 0.12              # the blind iwan recess behind each north desk (hall.py)
WALL_BAND = 0.3                # props on walkable tiles stay this close to the wall
ROD_R = 0.016


class Ctx:
    """Plan geometry of one chamber, from the layout and hall.py's arcade."""
    def __init__(self, seat, T, zi0, xi0, xi1, piers, pier_w, uvs):
        self.T, self.uvs = T, uvs
        self.sx = (seat['col'] + 0.5) * T                      # seat / lamp niche axis
        self.desk_x = (seat['col'] * T, (seat['col'] + 2) * T)  # the two blocked desk tiles
        a, b = [(a, b) for a, b in zip(piers[:-1], piers[1:]) if a < self.sx < b][0]
        self.cx = (a + b) / 2
        self.x_l = xi0 if abs(a - xi0) < 1e-6 else a + pier_w / 2
        self.x_r = xi1 if abs(b - xi1) < 1e-6 else b - pier_w / 2
        self.zw = zi0                                          # back wall face
        self.zi = zi0 - IWAN_DEPTH                             # iwan back face
        self.desk_z = (seat['row'] * T - 0.54, seat['row'] * T - 0.04)
        self.top = 0.34                                        # desk top (hall.py desk_mesh)


# ---------------------------------------------------------------- primitives
def paint(bm, faces, ctx, swatch):
    G.paint(bm, faces, ctx.uvs[swatch])


def tube(bm, ctx, p0, p1, r0, r1=None, seg=8, mat='cedar', swatch=None, cap=True):
    """A cylinder (or cone) between two plan points."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    a = p1 - p0
    a /= np.linalg.norm(a)
    e1 = np.cross(a, [0.0, 1.0, 0.0]) if abs(a[1]) < 0.9 else np.cross(a, [1.0, 0.0, 0.0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(a, e1)
    ts = [2 * math.pi * k / seg for k in range(seg)]
    ring = lambda c, r: [tuple(c + r * (math.cos(t) * e1 + math.sin(t) * e2)) for t in ts]
    faces = G.loft(bm, [ring(p0, r0), ring(p1, r0 if r1 is None else r1)], mat=mat, cap=cap)
    if swatch:
        paint(bm, faces, ctx, swatch)
    return faces


def vessel(bm, ctx, x, z, y0, profile, swatch, mat='glass', seg=12):
    profile = [p for p in profile if p[0] > 1e-4]          # no zero-radius rings: close_top caps
    faces = G.lathe(bm, profile, x, z, y0=y0, segments=seg, mat=mat, close_top=True)
    paint(bm, faces, ctx, swatch)
    return faces


def pbox(bm, ctx, a, swatch, mat='props'):
    faces = box(bm, *a, mat=mat)
    paint(bm, faces, ctx, swatch)
    return faces


def loop(bm, ctx, centre, normal, radius, r_tube, swatch, n=20):
    """A ring of tube segments (a meridian or horizon ring)."""
    c = np.asarray(centre, float)
    nn = np.asarray(normal, float) / np.linalg.norm(normal)
    e1 = np.cross(nn, [0.0, 1.0, 0.0]) if abs(nn[1]) < 0.9 else np.cross(nn, [1.0, 0.0, 0.0])
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(nn, e1)
    pts = [c + radius * (math.cos(2 * math.pi * k / n) * e1 + math.sin(2 * math.pi * k / n) * e2)
           for k in range(n + 1)]
    for p, q in zip(pts[:-1], pts[1:]):
        tube(bm, ctx, p, q, r_tube, seg=5, mat='props', swatch=swatch, cap=False)


def blob(bm, ctx, c, r, swatch, rng, squash=0.85):
    """A low-poly leaf clump (a jittered icosahedron)."""
    res = bmesh.ops.create_icosphere(bm, subdivisions=1, radius=1.0)
    for v in res['verts']:
        d = mathutils.Vector(v.co).normalized()
        k = r * float(rng.uniform(0.85, 1.12))
        v.co = B(c[0] + d.x * k, c[1] + d.z * k * squash, c[2] - d.y * k)
    faces = list({f for v in res['verts'] for f in v.link_faces})
    for f in faces:
        f.material_index = MI['props']
    paint(bm, faces, ctx, swatch)


# ---------------------------------------------------------------- hung sheets
def hang(bm, ctx, name, u0, u1, y0, y1, plane, facing='z', rods=('top',), sub=None, cords=True):
    """A sheet of the art atlas on a wall plane, with cedar rollers. facing 'z': on the back wall
    z = plane, u0..u1 are x (reads left to right from the room); facing 'x': on the west wall
    x = plane, u0..u1 are z, the viewer looking west (their right hand is north)."""
    ua, va, ub, vb = CA.uv_rect(name, sub or (0, 0, 1, 1))
    layer = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    d = 0.006
    if facing == 'z':
        pts = [(u0, y0, plane + d), (u1, y0, plane + d), (u1, y1, plane + d), (u0, y1, plane + d)]
        uv = [(ua, va), (ub, va), (ub, vb), (ua, vb)]
    else:
        pts = [(plane + d, y0, u1), (plane + d, y0, u0), (plane + d, y1, u0), (plane + d, y1, u1)]
        uv = [(ua, va), (ub, va), (ub, vb), (ua, vb)]
    vs = [bm.verts.new(B(*p)) for p in pts]
    f = bm.faces.new(vs)
    f.material_index = MI['chamber_art']
    f.normal_update()
    want = np.array([0, 0, 1.0]) if facing == 'z' else np.array([1.0, 0, 0])
    n = G.plan_normal(f.normal)
    if np.dot(n, want) < 0:
        f.normal_flip()
        uv = uv[::-1]
        vs = vs[::-1]
    for loop_, (u, v) in zip(f.loops, [uv[vs.index(l.vert)] for l in f.loops]):
        loop_[layer].uv = (u, v)
    for which in rods:
        y = y1 + 0.006 if which == 'top' else y0 - 0.006
        if facing == 'z':
            tube(bm, ctx, (u0 - 0.04, y, plane + 0.022), (u1 + 0.04, y, plane + 0.022), ROD_R,
                 mat='cedar')
        else:
            tube(bm, ctx, (plane + 0.022, y, u0 - 0.04), (plane + 0.022, y, u1 + 0.04), ROD_R,
                 mat='cedar')
    if cords and 'top' in rods:                               # the hanging cord to a peg
        mid = (u0 + u1) / 2
        if facing == 'z':
            tube(bm, ctx, (mid - (u1 - u0) * 0.3, y1 + 0.01, plane + 0.01), (mid, y1 + 0.16, plane + 0.008),
                 0.004, seg=4, mat='props', swatch='cord', cap=False)
            tube(bm, ctx, (mid + (u1 - u0) * 0.3, y1 + 0.01, plane + 0.01), (mid, y1 + 0.16, plane + 0.008),
                 0.004, seg=4, mat='props', swatch='cord', cap=False)
        else:
            tube(bm, ctx, (plane + 0.01, y1 + 0.01, mid - (u1 - u0) * 0.3), (plane + 0.008, y1 + 0.16, mid),
                 0.004, seg=4, mat='props', swatch='cord', cap=False)
            tube(bm, ctx, (plane + 0.01, y1 + 0.01, mid + (u1 - u0) * 0.3), (plane + 0.008, y1 + 0.16, mid),
                 0.004, seg=4, mat='props', swatch='cord', cap=False)


def hero(bm, ctx, name):
    """The chamber's hero sheet, centred in the iwan back, rollers top and bottom."""
    w, h = CA.SIZES[name]
    y0 = 2.22
    hang(bm, ctx, name, ctx.cx - w / 2, ctx.cx + w / 2, y0, y0 + h, ctx.zi, rods=('top', 'bottom'))


def side_sheet(bm, ctx, name, x_centre, y0):
    w, h = CA.SIZES[name]
    hang(bm, ctx, name, x_centre - w / 2, x_centre + w / 2, y0, y0 + h, ctx.zw)


# ---------------------------------------------------------------- shared furniture
def wall_shelf(bm, ctx, x0, x1, levels, depth=0.26):
    """A plain cedar wall shelf on brackets, boards at the given heights."""
    for y in levels:
        box(bm, x0, x1, y - 0.03, y, ctx.zw, ctx.zw + depth, mat='cedar')
        for x in (x0 + 0.06, x1 - 0.08):
            box(bm, x, x + 0.025, y - 0.2, y - 0.03, ctx.zw, ctx.zw + depth * 0.7, mat='cedar')


def mortar(bm, ctx, x, z, y0=0.0, s=1.0):
    vessel(bm, ctx, x, z, y0, [(0.075 * s, 0.0), (0.1 * s, 0.03 * s), (0.11 * s, 0.1 * s),
                               (0.115 * s, 0.13 * s), (0.09 * s, 0.13 * s), (0.08 * s, 0.09 * s)],
           'stone', mat='props', seg=12)
    tube(bm, ctx, (x - 0.01 * s, y0 + 0.07 * s, z), (x + 0.06 * s, y0 + 0.24 * s, z - 0.05 * s),
         0.017 * s, 0.022 * s, seg=6, mat='props', swatch='stone')


JAR = [(0.0, 0.0), (0.06, 0.0), (0.075, 0.04), (0.08, 0.12), (0.065, 0.17), (0.045, 0.19),
       (0.05, 0.22), (0.0, 0.22)]
ALBARELLO = [(0.0, 0.0), (0.055, 0.0), (0.06, 0.03), (0.048, 0.07), (0.046, 0.13), (0.058, 0.17),
             (0.05, 0.2), (0.042, 0.215), (0.0, 0.215)]
FLASK = [(0.0, 0.0), (0.05, 0.0), (0.085, 0.03), (0.1, 0.08), (0.085, 0.13), (0.04, 0.16),
         (0.022, 0.18), (0.02, 0.26), (0.027, 0.27), (0.0, 0.27)]
PHIAL = [(0.0, 0.0), (0.03, 0.0), (0.034, 0.02), (0.034, 0.12), (0.02, 0.15), (0.013, 0.17),
         (0.013, 0.2), (0.0, 0.2)]
SPECIMEN = [(0.0, 0.0), (0.055, 0.0), (0.06, 0.02), (0.06, 0.17), (0.05, 0.185), (0.05, 0.2),
            (0.0, 0.2)]


def scale(profile, s):
    return [(r * s, y * s) for r, y in profile]


def retort(bm, ctx, x, z, y0, s, swatch, toward=1):
    """A retort: a round body, its neck bent down to the side."""
    body = [(0.0, 0.0), (0.04, 0.005), (0.065, 0.03), (0.075, 0.07), (0.065, 0.11), (0.035, 0.135),
            (0.0, 0.14)]
    vessel(bm, ctx, x, z, y0, scale(body, s), swatch)
    p0 = np.array([x, y0 + 0.12 * s, z])
    p1 = p0 + np.array([toward * 0.09 * s, 0.05 * s, 0])
    p2 = p1 + np.array([toward * 0.14 * s, -0.09 * s, 0])
    tube(bm, ctx, p0, p1, 0.022 * s, 0.017 * s, seg=8, mat='glass', swatch=swatch)
    tube(bm, ctx, p1, p2, 0.017 * s, 0.01 * s, seg=8, mat='glass', swatch=swatch)


# ---------------------------------------------------------------- chemistry
def chemistry(bm, ctx, rng):
    hero(bm, ctx, 'chem_alembic')
    side_sheet(bm, ctx, 'chem_vessels', ctx.x_l + 0.7, 1.3)
    side_sheet(bm, ctx, 'chem_cucurbit', ctx.x_r - 0.85, 1.85)
    # the retort sheet on the west wall, seen from the arcade
    w, h = CA.SIZES['chem_retort']
    hang(bm, ctx, 'chem_retort', 2.05, 2.05 + w, 1.25, 1.25 + h, ctx.x_l, facing='x')

    # the furnace on the second desk tile: brick body, slab, an ember-lit fire mouth
    d0, d1 = ctx.desk_x
    fx0, fx1 = (d0 + d1) / 2 + 0.28, (d0 + d1) / 2 + 1.12
    fz0, fz1 = ctx.zw + 0.12, ctx.zw + 0.8
    fh = 0.72
    box(bm, fx0, fx1, 0.0, fh, fz0, fz1, mat='brick')
    pbox(bm, ctx, (fx0 - 0.03, fx1 + 0.03, fh, fh + 0.04, fz0 - 0.03, fz1 + 0.03), 'stone')
    mx = (fx0 + fx1) / 2
    # a stepped-arch fire mouth glowing with embers, in an iron frame
    for hw, y0, y1 in ((0.11, 0.1, 0.24), (0.075, 0.24, 0.28), (0.04, 0.28, 0.3)):
        box(bm, mx - hw, mx + hw, y0, y1, fz1, fz1 + 0.006, mat='ember')
    for a in ((mx - 0.14, mx - 0.11, 0.08, 0.27), (mx + 0.11, mx + 0.14, 0.08, 0.27),
              (mx - 0.14, mx + 0.14, 0.06, 0.1), (mx - 0.11, mx - 0.04, 0.28, 0.33),
              (mx + 0.04, mx + 0.11, 0.28, 0.33), (mx - 0.04, mx + 0.04, 0.3, 0.34)):
        pbox(bm, ctx, (a[0], a[1], a[2], a[3], fz1, fz1 + 0.03), 'iron')
    # cucurbit on the furnace, the alembic on it, the beak down to a receiver on a tripod
    fzc = (fz0 + fz1) / 2
    y = fh + 0.04
    cuc = [(0.0, 0.0), (0.1, 0.0), (0.17, 0.04), (0.2, 0.12), (0.19, 0.2), (0.13, 0.27),
           (0.07, 0.31), (0.065, 0.36)]
    vessel(bm, ctx, mx, fzc, y, cuc, 'glass_green')
    head = [(0.075, 0.0), (0.13, 0.03), (0.14, 0.08), (0.11, 0.14), (0.05, 0.17), (0.0, 0.18)]
    vessel(bm, ctx, mx, fzc, y + 0.36, head, 'glass_clear')
    rx, rz = fx1 + 0.24, fz1 - 0.12
    tube(bm, ctx, (mx + 0.12, y + 0.44, fzc), (rx, 0.64, rz), 0.024, 0.011, mat='glass',
         swatch='glass_clear')
    vessel(bm, ctx, rx, rz, 0.3, [(0.0, 0.0), (0.06, 0.0), (0.11, 0.04), (0.13, 0.1),
                                  (0.11, 0.17), (0.045, 0.21), (0.025, 0.24), (0.025, 0.3),
                                  (0.0, 0.3)], 'glass_amber')
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.4
        tube(bm, ctx, (rx + 0.1 * math.cos(a), 0.3, rz + 0.1 * math.sin(a)),
             (rx + 0.14 * math.cos(a), 0.0, rz + 0.14 * math.sin(a)), 0.009, seg=5, mat='props',
             swatch='iron')
    loop(bm, ctx, (rx, 0.3, rz), (0, 1, 0), 0.1, 0.008, 'iron', n=12)
    mortar(bm, ctx, fx0 + 0.04, fz1 + 0.34)
    # a balance on the writing desk
    bx, bz = ctx.sx - 0.03, ctx.desk_z[0] + 0.14
    t = ctx.top
    pbox(bm, ctx, (bx - 0.05, bx + 0.05, t, t + 0.02, bz - 0.035, bz + 0.035), 'brass')
    tube(bm, ctx, (bx, t + 0.02, bz), (bx, t + 0.28, bz), 0.007, seg=6, mat='props', swatch='brass')
    tube(bm, ctx, (bx - 0.16, t + 0.27, bz), (bx + 0.16, t + 0.27, bz), 0.006, seg=6, mat='props',
         swatch='brass')
    for sgn in (-1, 1):
        px = bx + sgn * 0.15
        tube(bm, ctx, (px, t + 0.27, bz), (px, t + 0.1, bz), 0.003, seg=4, mat='props', swatch='cord',
             cap=False)
        vessel(bm, ctx, px, bz, t + 0.09, [(0.0, 0.0), (0.05, 0.005), (0.056, 0.02), (0.0, 0.02)],
               'brass', mat='props', seg=10)
    # a shelf of jars, flasks and retorts on the east side, under the condenser sheet
    sx0, sx1 = ctx.x_r - 1.1, ctx.x_r - 0.06
    wall_shelf(bm, ctx, sx0, sx1, (0.88, 1.38))
    xs = np.linspace(sx0 + 0.12, sx1 - 0.12, 5)
    jars = [('ceramic_cream', JAR, 1.0, 'props'), ('glass_green', FLASK, 0.9, 'glass'),
            ('clay', JAR, 1.15, 'props'), ('glass_amber', PHIAL, 1.2, 'glass'),
            ('ceramic_ochre', ALBARELLO, 1.0, 'props')]
    for x, (sw, prof, s, mat) in zip(xs, jars):
        vessel(bm, ctx, x, ctx.zw + 0.13, 0.88, scale(prof, s), sw, mat=mat)
    retort(bm, ctx, sx0 + 0.2, ctx.zw + 0.13, 1.38, 1.3, 'glass_clear')
    retort(bm, ctx, sx0 + 0.6, ctx.zw + 0.13, 1.38, 1.1, 'glass_amber')
    vessel(bm, ctx, sx1 - 0.14, ctx.zw + 0.13, 1.38, scale(PHIAL, 1.1), 'glass_green')
    # a bench along the west wall with flasks and a cucurbit
    bz0, bz1 = 1.95, 2.92
    bxa, bxb = ctx.x_l, ctx.x_l + WALL_BAND
    box(bm, bxa, bxb, 0.4, 0.44, bz0, bz1, mat='cedar')
    for zz in (bz0 + 0.05, bz1 - 0.08):
        box(bm, bxa + 0.03, bxb - 0.03, 0.0, 0.4, zz, zz + 0.03, mat='cedar')
    for zz, (sw, prof, s) in zip(np.linspace(bz0 + 0.15, bz1 - 0.15, 4),
                                 [('glass_amber', FLASK, 1.0), ('glass_clear', PHIAL, 1.2),
                                  ('glass_green', FLASK, 0.8), ('clay', JAR, 0.9)]):
        vessel(bm, ctx, bxa + 0.15, zz, 0.44, scale(prof, s), sw,
               mat='props' if sw == 'clay' else 'glass')


# ---------------------------------------------------------------- cartography
def roll(bm, ctx, x, y, z0, z1, r, swatch):
    tube(bm, ctx, (x, y, z0), (x, y, z1), r, seg=8, mat='props', swatch=swatch)


def cartography(bm, ctx, rng):
    hero(bm, ctx, 'map_world')
    side_sheet(bm, ctx, 'map_disc', ctx.x_l + 0.55, 1.5)
    t = ctx.top
    # a map unrolled on the writing desk (a crop of the world map), rolled ends, dividers, ruler
    mx0, mx1 = ctx.sx - 0.32, ctx.sx + 0.25
    mz0, mz1 = ctx.desk_z[0] + 0.04, ctx.desk_z[1] - 0.06
    layer = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    ua, va, ub, vb = CA.uv_rect('map_world', (0.3, 0.28, 0.62, 0.78))
    vs = [bm.verts.new(B(x, t + 0.0025, z)) for x, z in ((mx0, mz1), (mx1, mz1), (mx1, mz0), (mx0, mz0))]
    f = bm.faces.new(vs)
    f.material_index = MI['chamber_art']
    f.normal_update()
    if G.plan_normal(f.normal)[1] < 0:
        f.normal_flip()
    for lp in f.loops:
        x, _, z = G.plan(lp.vert.co)
        lp[layer].uv = (ua + (ub - ua) * (x - mx0) / (mx1 - mx0), va + (vb - va) * (mz1 - z) / (mz1 - mz0))
    for x in (mx0, mx1):
        roll(bm, ctx, x, t + 0.016, mz0 - 0.01, mz1 + 0.01, 0.016, 'paper_old')
    hinge = np.array([ctx.sx - 0.1, t + 0.006, mz0 + 0.1])
    for end in ((ctx.sx - 0.2, mz1 - 0.06), (ctx.sx - 0.02, mz1 - 0.04)):
        tube(bm, ctx, hinge, (end[0], t + 0.004, end[1]), 0.004, seg=4, mat='props', swatch='brass')
    pbox(bm, ctx, (ctx.sx - 0.26, ctx.sx + 0.16, t + 0.002, t + 0.01, mz1 - 0.01, mz1 + 0.02), 'scroll_wood')
    # a celestial globe on a stand on the second desk tile
    d0, d1 = ctx.desk_x
    gx, gz = d1 - 0.75, (ctx.desk_z[0] + ctx.desk_z[1]) / 2 - 0.05
    vessel(bm, ctx, gx, gz, 0.0, [(0.0, 0.0), (0.13, 0.0), (0.13, 0.03), (0.06, 0.06), (0.035, 0.12),
                                  (0.03, 0.3), (0.05, 0.34), (0.0, 0.34)], 'scroll_wood', mat='props')
    gy, gr = 0.53, 0.17
    sphere = [(gr * math.sin(math.pi * k / 10), gr * (1 - math.cos(math.pi * k / 10))) for k in range(11)]
    vessel(bm, ctx, gx, gz, gy - gr, sphere, 'globe_ink', mat='props', seg=16)
    for k in range(3):
        a = 2 * math.pi * k / 3 + 0.5
        tube(bm, ctx, (gx + 0.04 * math.cos(a), 0.33, gz + 0.04 * math.sin(a)),
             (gx + 0.21 * math.cos(a), gy, gz + 0.21 * math.sin(a)), 0.008, seg=5, mat='props',
             swatch='brass')
    loop(bm, ctx, (gx, gy, gz), (0, 1, 0), 0.215, 0.012, 'brass', n=24)          # horizon ring
    loop(bm, ctx, (gx, gy, gz), (0.25, 0, 1.0), 0.19, 0.008, 'brass', n=24)       # meridian ring
    tilt = math.radians(33.3)                                                  # Baghdad's pole
    tube(bm, ctx, (gx, gy - gr * 1.18 * math.sin(tilt), gz + gr * 1.18 * math.cos(tilt)),
         (gx, gy + gr * 1.18 * math.sin(tilt), gz - gr * 1.18 * math.cos(tilt)), 0.006, seg=5,
         mat='props', swatch='brass')
    # a rack of rolled maps against the back wall behind the globe
    rx0, rx1 = d1 - 1.38, d1 - 0.08
    rz0, rz1, rh = ctx.zw, ctx.zw + 0.36, 1.2
    for xa in (rx0, rx1 - 0.04):
        box(bm, xa, xa + 0.04, 0.0, rh, rz0, rz1, mat='cedar')
    for y in (0.0, 0.4, 0.8, rh - 0.04):
        box(bm, rx0, rx1, y, y + 0.04, rz0, rz1, mat='cedar')
    # the city plan pinned over the rack (the bay's east strip sits behind the west palm's crown)
    w, h = CA.SIZES['map_city']
    hang(bm, ctx, 'map_city', (rx0 + rx1) / 2 - w / 2, (rx0 + rx1) / 2 + w / 2, rh + 0.1, rh + 0.1 + h,
         ctx.zw, rods=(), cords=False)
    cells = np.linspace(rx0 + 0.04, rx1 - 0.04, 4)
    for xa in cells[1:-1]:
        box(bm, xa - 0.015, xa + 0.015, 0.04, rh - 0.04, rz0, rz1, mat='cedar')
    for lo in (0.04, 0.44, 0.84):
        for xa, xb in zip(cells[:-1], cells[1:]):
            n = int(rng.integers(3, 6))
            for j in range(n):
                r = float(rng.uniform(0.03, 0.045))
                x = xa + 0.02 + r + (j % 3) * (xb - xa - 0.04 - 2 * r) / 2
                y = lo + r + (j // 3) * 2 * r + 0.002
                if y + r > lo + 0.355:
                    continue
                sw = ['paper', 'paper_old', 'leather_tan'][int(rng.integers(3))]
                roll(bm, ctx, x, y, rz0 + 0.02, rz1 + 0.02, r, sw)
    # map cases and rolls standing in a basket in the west corner
    kx, kz = ctx.x_l + 0.32, ctx.zw + 0.17
    vessel(bm, ctx, kx, kz, 0.0, [(0.0, 0.0), (0.12, 0.0), (0.14, 0.05), (0.14, 0.3), (0.0, 0.3)],
           'reed', mat='props', seg=10)
    for k, (dx, dz, h) in enumerate(((-0.05, -0.03, 0.95), (0.04, -0.04, 1.05), (0.05, 0.05, 0.8),
                                     (-0.04, 0.05, 0.9))):
        tube(bm, ctx, (kx + dx, 0.05, kz + dz), (kx + dx * 1.6, h, kz + dz * 1.6), 0.034,
             mat='props', swatch='paper' if k % 2 else 'paper_old')
    for k, dx in enumerate((0.52, 0.66)):
        base = np.array([ctx.x_l + dx, 0.0, ctx.zw + 0.22])
        top = base + np.array([0.04, 0.92 - 0.06 * k, -0.15])
        tube(bm, ctx, base, top, 0.055, seg=10, mat='props', swatch='leather_tan' if k else 'leather_brown')
        tube(bm, ctx, top - (top - base) * 0.06, top + (top - base) * 0.02, 0.058, seg=10, mat='props',
             swatch='brass')
    # a low map chest on the east side, under the city plan
    cx0, cx1 = ctx.x_r - 0.98, ctx.x_r - 0.12
    box(bm, cx0, cx1, 0.0, 0.62, ctx.zw, ctx.zw + 0.32, mat='cedar')
    for y in (0.08, 0.26, 0.44):
        pbox(bm, ctx, (cx0 + 0.04, cx1 - 0.04, y, y + 0.14, ctx.zw + 0.32, ctx.zw + 0.335), 'leather_dark')
        pbox(bm, ctx, ((cx0 + cx1) / 2 - 0.06, (cx0 + cx1) / 2 + 0.06, y + 0.06, y + 0.08,
                       ctx.zw + 0.335, ctx.zw + 0.355), 'brass')


# ---------------------------------------------------------------- biology
def potted_plant(bm, ctx, x, z, rng, flower):
    vessel(bm, ctx, x, z, 0.0, [(0.0, 0.0), (0.1, 0.0), (0.13, 0.03), (0.15, 0.2), (0.165, 0.24),
                                (0.145, 0.25), (0.0, 0.25)], 'terracotta', mat='props', seg=12)
    leaves = ('herb_green', 'frond_dark', 'herb_green', 'frond')
    for k in range(9):
        a = 2 * math.pi * k / 9 + float(rng.uniform(-0.2, 0.2))
        el = float(rng.uniform(0.25, 1.0))
        rr = 0.09 * (1 - 0.4 * el)
        c = (x + rr * math.cos(a), 0.32 + 0.3 * el, z + rr * math.sin(a))
        blob(bm, ctx, c, float(rng.uniform(0.06, 0.09)), leaves[k % len(leaves)], rng)
    for k in range(4):
        a = float(rng.uniform(0, 2 * math.pi))
        blob(bm, ctx, (x + 0.1 * math.cos(a), float(rng.uniform(0.5, 0.64)), z + 0.1 * math.sin(a)),
             0.022, flower, rng, squash=1.0)


def biology(bm, ctx, rng):
    # the eye (hero) and al-Jahiz's animals share the iwan, centred as a pair: the bay's west strip
    # sits behind the east palm's crown at the default camera
    (we, he), (wa, ha) = CA.SIZES['bio_eye'], CA.SIZES['bio_animals']
    gap = 0.12
    x0 = ctx.cx - (we + gap + wa) / 2
    hang(bm, ctx, 'bio_eye', x0, x0 + we, 2.22, 2.22 + he, ctx.zi, rods=('top', 'bottom'))
    hang(bm, ctx, 'bio_animals', x0 + we + gap, x0 + we + gap + wa, 2.3, 2.3 + ha, ctx.zi)
    side_sheet(bm, ctx, 'bio_mandrake', ctx.x_r - 0.82, 1.45)
    side_sheet(bm, ctx, 'bio_poppy', ctx.x_r - 0.29, 1.45)
    # herbs drying from a rod on pegs, right of the lamp niche
    d0, d1 = ctx.desk_x
    hx0, hx1 = ctx.sx + 0.57, d1
    hy, hz = 2.08, ctx.zw + 0.1
    tube(bm, ctx, (hx0, hy, hz), (hx1, hy, hz), 0.015, mat='cedar')
    for x in (hx0 + 0.06, hx1 - 0.06):
        tube(bm, ctx, (x, hy, ctx.zw), (x, hy, hz + 0.03), 0.012, mat='cedar')
    herbs = ('herb_green', 'herb_dry', 'lavender', 'herb_green', 'herb_dry', 'herb_green', 'lavender')
    for k, x in enumerate(np.linspace(hx0 + 0.16, hx1 - 0.16, 7)):
        L = float(rng.uniform(0.26, 0.38))
        prof = [(0.03, 0.0), (0.05, 0.05), (0.052, L * 0.5), (0.03, L * 0.85), (0.012, L)]
        vessel(bm, ctx, x, hz, hy - 0.02 - L, prof, herbs[k], mat='props', seg=7)
        pbox(bm, ctx, (x - 0.014, x + 0.014, hy - 0.035, hy + 0.012, hz - 0.014, hz + 0.014), 'cord')
    # specimen jars and albarelli on a wall shelf behind the desk's second tile
    sx0, sx1 = d0 + 1.6, d1 - 0.05
    wall_shelf(bm, ctx, sx0, sx1, (0.8, 1.24))
    for x, (sw, prof, s, mat) in zip(np.linspace(sx0 + 0.12, sx1 - 0.12, 5),
                                     [('albarello_green', ALBARELLO, 1.1, 'props'),
                                      ('specimen', SPECIMEN, 1.0, 'glass'),
                                      ('ceramic_ochre', ALBARELLO, 1.0, 'props'),
                                      ('specimen', SPECIMEN, 0.85, 'glass'),
                                      ('albarello_green', ALBARELLO, 0.9, 'props')]):
        vessel(bm, ctx, x, ctx.zw + 0.13, 0.8, scale(prof, s), sw, mat=mat)
    for x, s in zip(np.linspace(sx0 + 0.14, sx1 - 0.14, 4), (0.9, 1.1, 0.8, 1.0)):
        vessel(bm, ctx, x, ctx.zw + 0.13, 1.24, scale(SPECIMEN, s), 'specimen')
        vessel(bm, ctx, x, ctx.zw + 0.13, 1.24 + 0.2 * s, [(0.052 * s, 0.0), (0.054 * s, 0.025),
                                                           (0.0, 0.025)], 'cork', mat='props', seg=12)
    # a plant press and a mortar on the second desk tile
    px, pz = d1 - 0.62, (ctx.desk_z[0] + ctx.desk_z[1]) / 2 - 0.04
    box(bm, px - 0.25, px + 0.25, 0.0, 0.035, pz - 0.18, pz + 0.18, mat='cedar')
    pbox(bm, ctx, (px - 0.23, px + 0.23, 0.035, 0.1, pz - 0.16, pz + 0.16), 'paper_old')
    for y in (0.055, 0.078):
        pbox(bm, ctx, (px - 0.235, px + 0.2, y, y + 0.008, pz - 0.165, pz + 0.15), 'herb_dry')
    box(bm, px - 0.25, px + 0.25, 0.1, 0.135, pz - 0.18, pz + 0.18, mat='cedar')
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = px + sx * 0.21, pz + sz * 0.14
            tube(bm, ctx, (x, 0.0, z), (x, 0.2, z), 0.012, seg=6, mat='props', swatch='iron')
            pbox(bm, ctx, (x - 0.04, x + 0.04, 0.17, 0.185, z - 0.008, z + 0.008), 'iron')
    mortar(bm, ctx, px + 0.42, pz + 0.12)
    # potted medicinal plants by the walls on either side
    potted_plant(bm, ctx, ctx.x_l + 0.5, ctx.zw + 0.17, rng, 'flower_white')
    potted_plant(bm, ctx, ctx.x_r - 0.55, ctx.zw + 0.17, rng, 'madder_flower')


BUILDERS = {'chemistry': chemistry, 'cartography': cartography, 'biology': biology}


def build(layout, T, zi0, xi0, xi1, piers, pier_w, uvs):
    """chamber_<theme> nodes, one per themed north alcove."""
    out = []
    seats = {s['uid']: s for s in layout['seats']}
    for k, (uid, theme) in enumerate(THEMES.items()):
        ctx = Ctx(seats[uid], T, zi0, xi0, xi1, piers, pier_w, uvs)
        bm = bmesh.new()
        BUILDERS[theme](bm, ctx, np.random.default_rng(31 + k))
        bm.normal_update()
        ob = G.new_object(f'chamber_{theme}', bm)
        G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < 0.01, 'delete')
        out.append(ob)
    return out
