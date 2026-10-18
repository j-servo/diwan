# House of Life (a temple court in the Dendera manner, late Ptolemaic / early Roman): the second
# world's hall, generated from layout.json in headless Blender, lightmapped for two moods (the
# noon of Ra, oil lamps at dusk) and exported as two GLBs.
#
#   DIWAN_WORLD=house-of-life Blender -b --factory-startup --python-exit-code 1 \
#       --python assets/blender/temple.py [-- --quick]
#
# Reads layout.json, the Pl. 13 reference plate (refs/) and the font-rendered title (src/,
# render-hieroglyphs.mjs). Writes, under assets/worlds/house-of-life/out/:
#   raw/hall.raw.glb, raw/pyramid.raw.glb   the GLBs before optimize.mjs (never committed)
#   raw/lightmap_{golden,dusk}.png          8-bit sRGB lightmaps before KTX2 (never committed)
#   gobo_sun.png                            the live sun's gobo (black: the noon sun is baked)
#   hall.meta.json                          light rig + lightmap calibration (committed)
# The pyramid in the pool of Nun is its own GLB (named nodes for the water, the lilies and
# ripples) but bakes with the hall into the same lightmap atlas (its meshes carry uv1).
# Coordinates as hall.py: metres, glTF axes (x east, y up, z south), origin at the grid's NW corner.
import json
import math
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bmesh  # noqa: E402
import bpy  # noqa: E402
import mathutils  # noqa: E402
import numpy as np  # noqa: E402

import bake_harness as BH  # noqa: E402
import bl_common as C  # noqa: E402
import hall_geom as G  # noqa: E402
import patterns as P  # noqa: E402
import temple_parts as TP  # noqa: E402
import temple_relief as R  # noqa: E402
import temple_textures as TT  # noqa: E402
from hall_geom import B, MI  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS
NO_BAKE = '--no-bake' in ARGS
assert C.WORLD_ID == 'house-of-life', 'temple.py bakes the House of Life: set DIWAN_WORLD=house-of-life'
assert P.HUE_GUARD == 40.0 and P.COBALT_HUE == 295.0, 'the amethyst guard must be active'

WORLD = C.WORLD_DIR
OUT = os.path.join(WORLD, 'out')
RAW = os.path.join(OUT, 'raw')
os.makedirs(RAW, exist_ok=True)
with open(os.path.join(WORLD, 'layout.json')) as f:
    LAYOUT = json.load(f)
assert LAYOUT['worldId'] == 'house-of-life'
T = LAYOUT['tileMeters']
STATS = {}

MATS = ['sandstone', 'paving', 'wall', 'screen', 'column', 'title', 'cornice', 'granite',
        'limestone', 'papyrus', 'props', 'lamp', 'flame', 'base', 'water', 'poolstone',
        'gold', 'obelisk', 'lime_warm', 'relief', 'stars', 'frieze']
G.use_materials(MATS)

# ---------------------------------------------------------------- the plan (metres)
XI0, XI1 = T, (LAYOUT['cols'] - 1) * T          # inner faces of the west / east walls
ZI0, ZI1 = T, (LAYOUT['rows'] - 1) * T          # inner faces of the north / south walls
WALL_T, WALL_H, BATTER = 1.0, TT.WALL_H, 0.35   # the outer faces lean in 0.35 m (3 deg)
XO0, XO1, ZO0, ZO1 = XI0 - WALL_T, XI1 + WALL_T, ZI0 - WALL_T, ZI1 + WALL_T
SOUTH_CUT = 1.0                                 # diorama cutaway: the south wall stops here
GATE = (13.85, 16.15)
CX = LAYOUT['cols'] * T / 2                     # 15.0, the temple's axis

# The Hathor facade: six columns 7.0 m (Dendera's 14.28 m column at ~1:2), 2.7 m apart, so the
# facade (15 m) fits between the chamber pairs and its end columns clear the inner seats.
FZ = 4.65
FH = 7.0
FX = [CX - 6.75 + 2.7 * i for i in range(6)]    # 8.25 .. 21.75
SW_H = 0.42 * FH                                 # screen walls, 2.94 m (Dendera 6.0 of 14.28)
SW_T = 0.28                                      # half their thickness
TITLE_LIFT = 0.006                      # the title's decal lift off the lintel face, metres
DOOR = dict(open=(14.35, 15.65), top=3.30, lintel=(3.30, 4.40), cornice=(4.40, 4.70, 4.78), half=0.32)
ARCH = dict(y=(7.0, 7.5), half=0.62, x=(7.6, 22.4))
CORN = dict(y=(7.5, 8.15, 8.28), proud=0.42)
PRONAOS = dict(x=(7.5, 22.5), roof=(7.5, 7.82))
# The lower colonnades east and west, fronting the chamber pairs: 4.4 m Hathor columns
WING = dict(cols=(4.5, 25.5), H=4.4, arch=(4.4, 4.75), roof=(4.75, 4.95), corn=(4.75, 5.15, 5.23),
            half=0.42, partition=(4.5, 25.5))
# The pool of Nun at the court's centre: 8.4 m across the granite coping, a deep channel round the
# pyramid's plinth and a shallow shelf along the coping, two steps down on the south side. The
# whole pool is footprint 8.4 m inside the blocked 9 m of the layout (cols 7-12, rows 5-10: round F
# moved it one row south so a lane runs all round it).
POOL = dict(cx=CX, cz=12.0, outer=4.2, inner=3.85, shelf=3.20, top=0.03, shelf_y=-0.40,
            water=-0.16, floor=-0.72)
PYR = dict(cx=CX, cz=12.0, y0=-0.04, plinth=2.80)       # the plinth's half-width: the casing's foot
_pool = next(f for f in LAYOUT['furniture'] if f['uid'] == 'pool')
assert abs((_pool['row'] + 3) * T - POOL['cz']) < 1e-6 and abs((_pool['col'] + 3) * T - CX) < 1e-6, \
    'the pool is centred on its blocked footprint in the layout'
STEPS = [(0.45, -0.07), (0.45, -0.25)]                   # (tread depth, top y), from the coping inwards
STEP_HALF = 1.1                                          # the steps' half-width along the south coping
LAMP_SILL = 1.0
WATER = (30, 78, 92)            # the pool's water base (hue ~190): the runtime shader tints it
GOLD_RGB = (230, 170, 52)       # electrum-gold sheath of the pyramidion and the obelisk tips
GLOW = dict(gold=(0.10, 0.05, 0.008), title=(1.0, 1.0, 1.0))   # emission, on after the bake

# ---------------------------------------------------------------- lighting
# Noon of Ra: a high warm sun from the south-west (58 deg up, 40 deg west of south) so the
# columns throw crisp diagonal shadows across the facade and the court. Dusk: oil lamps.
SUN_EL, SUN_AZ = 58.0, 40.0
SUN_STRENGTH = 3.0
SUN_COLOR = (1.0, 0.84, 0.64)
GOLD_SKY = dict(zenith=(0.40, 0.56, 0.88), horizon=(1.0, 0.86, 0.68), ground=(0.32, 0.27, 0.21),
                strength=0.22)
# The night sky leans to cyan-blue (~212 deg), the lamps' complement, so where lamplight and sky
# light meet on warm sandstone the blend greys instead of turning violet (amethyst's band).
DUSK_SKY = dict(zenith=(0.02, 0.09, 0.22), horizon=(0.06, 0.10, 0.20), ground=(0.02, 0.02, 0.04),
                strength=1.0)
LAMP_COLOR = (1.0, 0.58, 0.28)
LAMP_POWER = 16.0
LAMP_RANGE = 6.0
LM_SIZE = 1024 if QUICK else 2048
LM_SAMPLES = 32 if QUICK else 512


def sun_dir():
    """Direction the sunlight travels (plan): towards the north-east and down."""
    el, az = math.radians(SUN_EL), math.radians(SUN_AZ)
    return np.array([math.sin(az) * math.cos(el), -math.sin(el), -math.cos(az) * math.cos(el)])


SEATS = {s['uid']: s for s in LAYOUT['seats']}
STEP = {'UP': (0, -1), 'DOWN': (0, 1), 'LEFT': (-1, 0), 'RIGHT': (1, 0)}


def tile_centre(col, row):
    return ((col + 0.5) * T, (row + 0.5) * T)


def furniture(prefix):
    return [f for f in LAYOUT['furniture'] if f['uid'].startswith(prefix)]


# ---------------------------------------------------------------- textures and materials
def load_numpy_image(path, alpha=False):
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = 'Non-Color'
    a = C.image_to_numpy(img)
    bpy.data.images.remove(img)
    return a[..., 3] if alpha else a[..., :3].mean(-1)


def build_materials():
    plate = load_numpy_image(os.path.join(WORLD, 'refs', 'description-dendera-pl13-screen-walls.jpg'))
    glyph = load_numpy_image(os.path.join(WORLD, 'src', 'title_pr_ankh.png'), alpha=True)
    frieze_alpha = load_numpy_image(os.path.join(WORLD, 'src', 'frieze_signs.png'), alpha=True)
    # the Luxor obelisks' plates (Description de l'Egypte, A. vol. III pl. 11 and 12): the
    # inscriptions of the six faces are traced from them
    obelisk_plates = {no: load_numpy_image(os.path.join(
        WORLD, 'refs', f'description-thbes-louqsor-pl{no}.jpg')) for no in ('12', '11')}
    # the Hathor head (hathor_head.py, from Yousef's TRELLIS2 model): its colour seen from the
    # front and its height field
    img = bpy.data.images.load(os.path.join(WORLD, 'src', 'hathor_head_color.png'))
    img.colorspace_settings.name = 'Non-Color'
    head_rgba = C.image_to_numpy(img).astype(np.float64)
    bpy.data.images.remove(img)
    head_depth = np.load(os.path.join(WORLD, 'src', 'hathor_head_depth.npy')).astype(np.float64)
    HEAD['disp'], _ = TT.head_displacement(head_depth)
    # every scene the walls carry, cut from its plate (each plate loaded once)
    scene_crops = R.crops(lambda f: load_numpy_image(os.path.join(WORLD, 'refs', f)))
    TT.write_all(C.TEX, plate, glyph, STATS, obelisk_plates, head_rgba, head_depth, scene_crops,
                  frieze_alpha)
    lin = BH.srgb_lin

    def lin_e(c):   # emission colours are given in linear RGB already
        return c
    for name, rgb in (('lamp', (176, 104, 66)), ('flame', (255, 214, 150)),
                      ('base', (58, 38, 26)), ('water', WATER)):
        TT.guard(np.array([rgb]) / 255.0, name)
    mats = {
        'sandstone': BH.make_material('sandstone', 'tl_sandstone_basecolor.png',
                                      normal='tl_sandstone_normal.png', rough=0.9),
        'paving': BH.make_material('paving', 'tl_paving_basecolor.png', normal='tl_paving_normal.png',
                                   rough=0.85),
        'wall': BH.make_material('wall', 'tl_wall_basecolor.png', normal='tl_wall_normal.png',
                                 rough=0.88),
        'screen': BH.make_material('screen', 'tl_screen_basecolor.png', normal='tl_screen_normal.png',
                                   rough=0.85),
        'column': BH.make_material('column', 'tl_column_basecolor.png', normal='tl_column_normal.png',
                                   rough=0.85),
        'title': BH.make_material('title', 'tl_title_basecolor.png', normal='tl_title_normal.png',
                                  rough=0.8, emission_tex='tl_title_glow.png'),
        'cornice': BH.make_material('cornice', 'tl_cornice_basecolor.png', rough=0.85),
        'granite': BH.make_material('granite', 'tl_granite_basecolor.png',
                                    normal='tl_granite_normal.png', rough=0.38),
        # the Great Pyramid's polished white Tura casing: a faint warm sheen
        # the casing: a soft satin sheen, not a mirror (round F: a polished 0.2 caught the room's
        # bright light former and bloomed white as the camera moved)
        'limestone': BH.make_material('limestone', 'tl_limestone_basecolor.png', rough=0.5),
        # the casing's band of sacred signs (ankh djed was), sunk 3 mm and washed pale gold
        'frieze': BH.make_material('frieze', 'tl_frieze_basecolor.png', normal='tl_frieze_normal.png',
                                   rough=0.5),
        'poolstone': BH.make_material('poolstone', 'tl_poolstone_basecolor.png',
                                      normal='tl_poolstone_normal.png', rough=0.5),
        'gold': BH.make_material('gold', color=lin(GOLD_RGB), rough=0.3, metal=0.8,
                                 emission=lin_e(GLOW['gold'])),
        # the obelisks: fine honed limestone, warmer and duller than the Tura casing
        'obelisk': BH.make_material('obelisk', 'tl_obelisk_basecolor.png',
                                    normal='tl_obelisk_normal.png', rough=0.62),
        'lime_warm': BH.make_material('lime_warm', 'tl_lime_warm_basecolor.png', rough=0.62),
        'papyrus': BH.make_material('papyrus', 'tl_papyrus_basecolor.png', rough=0.95),
        'props': BH.make_material('props', 'tl_palette_basecolor.png', rough=0.75),
        'lamp': BH.make_material('lamp', color=lin((176, 104, 66)), rough=0.6,
                                 emission=lin((255, 190, 120))),
        'flame': BH.make_material('flame', color=lin((255, 214, 150)), rough=1.0,
                                  emission=lin((255, 170, 80))),
        'base': BH.make_material('base', color=lin((58, 38, 26)), rough=0.45),
        'water': BH.make_material('water', color=lin(WATER), rough=0.05),
        # the walls' painted reliefs (temple_relief.py), one atlas for every field
        'relief': BH.make_material('relief', 'tl_relief_basecolor.png', normal='tl_relief_normal.png',
                                   rough=0.86),
        'stars': BH.make_material('stars', 'tl_stars_basecolor.png', rough=0.9),
    }
    # The runtime reads these from the glTF extras (PoolFx.tsx): the water becomes a shader of its
    # own (where the pool is, where the sun is), the casing and the gold take the room's reflection,
    # the gold glows towards dusk.
    sd = sun_dir()
    for k, v in (('poolCx', POOL['cx']), ('poolCz', POOL['cz']), ('poolPlinth', PYR['plinth']),
                 ('poolCoping', POOL['inner']), ('poolWaterY', POOL['water']),
                 ('poolSunX', -float(sd[0])), ('poolSunY', -float(sd[1])), ('poolSunZ', -float(sd[2]))):
        mats['water'][k] = float(v)
    mats['limestone']['envScale'] = 1.0
    mats['frieze']['envScale'] = 1.0
    mats['gold']['envScale'] = 4.0
    mats['gold']['duskGlow'] = 4.0
    assert set(mats) == set(G.MATS)
    return mats


def temple_uv(name, co, n):
    """UV0 for every material without explicit UVs (the builders set screen, column, title,
    cornice, papyrus and props themselves)."""
    x, y, z = co
    ax = max(range(3), key=lambda i: abs(n[i]))
    if name == 'sandstone':
        return G.box_uv(co, n, TT.SAND_M)
    if name == 'paving':
        return (x / TT.PAVE_M, -z / TT.PAVE_M)
    if name == 'wall':
        if ax == 1:
            return G.box_uv(co, n, TT.SAND_M)
        u = (-z if n[0] > 0 else z) if ax == 0 else (x if n[2] > 0 else -x)
        return (u / TT.WALL_W, min(max(y, 0.0) / TT.WALL_H, 0.999))
    if name in ('granite', 'poolstone', 'lime_warm'):
        return G.box_uv(co, n, 0.5)
    if name == 'limestone':
        return G.box_uv(co, n, 1.0)
    if name == 'stars':
        return (x / TT.STARS_M, -z / TT.STARS_M)
    if name in ('water', 'base', 'lamp', 'flame', 'gold'):
        return G.box_uv(co, n, 4.0)
    return None


def box(bm, x0, x1, y0, y1, z0, z1, mat='sandstone'):
    return G.box(bm, x0, x1, y0, y1, z0, z1, mat=mat)


def extrude(bm, outline, axis, a0, a1, mat='sandstone'):
    return G.extrude_profile(bm, outline, axis, a0, a1, mat=mat)


def set_mat(ob, pred, mat):
    G.faces_where(ob, pred, lambda f, c, n: setattr(f, 'material_index', MI[mat]))


def drop_hidden_bottoms(ob, y=0.01):
    G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < y, 'delete')


# ---------------------------------------------------------------- enclosure walls
def build_walls():
    bm = bmesh.new()
    extrude(bm, [(XO0, 0), (XI0, 0), (XI0, WALL_H), (XO0 + BATTER, WALL_H)], 'z', ZO0, ZO1)
    extrude(bm, [(XI1, 0), (XO1, 0), (XO1 - BATTER, WALL_H), (XI1, WALL_H)], 'z', ZO0, ZO1)
    walls = G.new_object('temple_walls', bm)
    pieces = []
    for build in (
        lambda b: extrude(b, [(ZO0, 0), (ZI0, 0), (ZI0, WALL_H), (ZO0 + BATTER, WALL_H)],
                                    'x', XO0, XO1),
        # the pronaos' back wall rises with its roof
        lambda b: box(b, PRONAOS['x'][0], PRONAOS['x'][1], 0.0, PRONAOS['roof'][1], ZO0 + 0.2, ZI0),
        lambda b: extrude(b, [(ZI1, 0), (ZO1, 0), (ZO1 - 0.06, SOUTH_CUT), (ZI1, SOUTH_CUT)],
                                    'x', XO0, GATE[0]),
        lambda b: extrude(b, [(ZI1, 0), (ZO1, 0), (ZO1 - 0.06, SOUTH_CUT), (ZI1, SOUTH_CUT)],
                                    'x', GATE[1], XO1),
        # a projecting coping lip along the inner top of the west, east and north walls
        lambda b: box(b, XI0 - 0.05, XI0 + 0.12, WALL_H - 0.16, WALL_H, ZI0 - 0.05, ZI1 + 0.2),
        lambda b: box(b, XI1 - 0.12, XI1 + 0.05, WALL_H - 0.16, WALL_H, ZI0 - 0.05, ZI1 + 0.2),
        lambda b: box(b, XI0, PRONAOS['x'][0], WALL_H - 0.16, WALL_H, ZI0 - 0.05, ZI0 + 0.12),
        lambda b: box(b, PRONAOS['x'][1], XI1, WALL_H - 0.16, WALL_H, ZI0 - 0.05, ZI0 + 0.12),
    ):
        b2 = bmesh.new()
        build(b2)
        pieces.append(G.new_object('wall_piece', b2))
    G.union(walls, pieces)

    def rule(f, c, n):
        x, y, z = c
        inner = ((n[0] > 0.9 and abs(x - XI0) < 0.02) or (n[0] < -0.9 and abs(x - XI1) < 0.02)
                 or (n[2] > 0.9 and abs(z - ZI0) < 0.02) or (n[2] < -0.9 and abs(z - ZI1) < 0.02))
        f.material_index = MI['wall' if inner and y < WALL_H - 0.16 else 'sandstone']
    G.faces_where(walls, lambda c, n, f: True, rule)
    drop_hidden_bottoms(walls)
    ext = G.split_off(walls, lambda c, n, f: (n[0] < -0.9 and c[0] < XO0 + BATTER + 0.01)
                      or (n[0] > 0.9 and c[0] > XO1 - BATTER - 0.01)
                      or (n[2] < -0.9 and c[2] < ZO0 + BATTER + 0.21), 'temple_exterior')
    section = G.split_off(walls, lambda c, n, f: n[1] > 0.9 and abs(c[1] - SOUTH_CUT) < 0.01
                          and c[2] > ZI1 - 0.01, 'temple_section')
    return walls, ext, section


# ---------------------------------------------------------------- floor, pool, base
def build_floor():
    bm = bmesh.new()
    p0, p1 = POOL['cx'] - POOL['outer'], POOL['cx'] + POOL['outer']
    q0, q1 = POOL['cz'] - POOL['outer'], POOL['cz'] + POOL['outer']
    for x0, x1, z0, z1 in ((XI0, XI1, ZI0, q0), (XI0, XI1, q1, ZI1), (XI0, p0, q0, q1), (p1, XI1, q0, q1)):
        TP.quad(bm, [(x0, 0.0, z1), (x1, 0.0, z1), (x1, 0.0, z0), (x0, 0.0, z0)], 'paving')
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return G.new_object('temple_floor', bm)


def build_pool():
    """The pool of Nun: the granite coping, a shallow shelf along it, a deep channel round the
    pyramid's plinth, and two steps down on the south side. Dark slate under the water."""
    bm = bmesh.new()
    cx, cz = POOL['cx'], POOL['cz']
    o, i, l = POOL['outer'], POOL['inner'], POOL['shelf']
    f_y, s_y = POOL['floor'], POOL['shelf_y']
    for (r0, r1, y0, y1, mat) in ((i, o, s_y, POOL['top'], 'granite'),
                                  (l, i, f_y, s_y, 'poolstone')):
        box(bm, cx - r1, cx + r1, y0, y1, cz - r1, cz - r0, mat=mat)
        box(bm, cx - r1, cx + r1, y0, y1, cz + r0, cz + r1, mat=mat)
        box(bm, cx - r1, cx - r0, y0, y1, cz - r0, cz + r0, mat=mat)
        box(bm, cx + r0, cx + r1, y0, y1, cz - r0, cz + r0, mat=mat)
    box(bm, cx - l, cx + l, f_y - 0.05, f_y, cz - l, cz + l, mat='poolstone')
    # two steps down from the south coping onto the shelf
    z1 = cz + i
    for depth, top in STEPS:
        box(bm, cx - STEP_HALF, cx + STEP_HALF, s_y, top, z1 - depth, z1, mat='granite')
        z1 -= depth
    ob = G.new_object('pool_basin', bm)
    drop_hidden_bottoms(ob, POOL['floor'] - 0.02)
    return ob


def build_water():
    """The pool's water: one flat sheet round the plinth. Its look is a runtime shader."""
    bm = bmesh.new()
    cx, cz, l, pl, y = POOL['cx'], POOL['cz'], POOL['inner'], PYR['plinth'], POOL['water']
    for x0, x1, z0, z1 in ((-l, l, -l, -pl), (-l, l, pl, l), (-l, -pl, -pl, pl), (pl, l, -pl, pl)):
        TP.quad(bm, [(cx + x0, y, cz + z1), (cx + x1, y, cz + z1), (cx + x1, y, cz + z0),
                     (cx + x0, y, cz + z0)], 'water')
    bm.normal_update()
    for f in bm.faces:
        if f.normal.z < 0:
            f.normal_flip()
    return G.new_object('pool_water', bm)


def build_base():
    """The museum diorama's plinth: dark wood with a moulded lip (as hall.py's)."""
    bm = bmesh.new()
    m = 0.45
    W, D = LAYOUT['cols'] * T, LAYOUT['rows'] * T
    box(bm, -m, W + m, -0.75, 0.0, -m, D + m, mat='base')
    ob = G.new_object('temple_base', bm)
    lb = bmesh.new()
    box(lb, -m - 0.06, W + m + 0.06, -0.12, -0.04, -m - 0.06, D + m + 0.06, mat='base')
    G.union(ob, [G.new_object('base_lip', lb)])
    # the hole after the lip: the court is sunk below the plinth's top (the pool), so the lip must
    # be a ring too
    hb = bmesh.new()
    box(hb, XO0 + 0.1, XO1 - 0.1, -1.0, 0.2, ZO0 + 0.1, ZO1 - 0.1)
    G.difference(ob, [G.new_object('base_hole', hb)])
    set_mat(ob, lambda c, n, f: n[1] > 0.9 and c[1] > -0.01, 'paving')
    G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < -0.7, 'delete')
    return ob


# ---------------------------------------------------------------- the Hathor facade
HEAD = {}
# The heads' level of detail per side: the court sees the facade's south faces whole (the door's
# two columns at the master's detail) and the sides at a grazing angle; the north faces look into
# the pronaos. The colonnades' columns are smaller and farther.
COLUMN_LODS = {
    'door': dict(south='master', east='mid', west='mid', north='lo'),
    'facade': dict(south='hi', east='mid', west='mid', north='lo'),
    'wing': dict(south='mid', east='lo', west='lo', north='lo'),
}


def column_objects():
    """The Hathor column meshes, built once each at unit height (one per LOD set) and placed
    (scaled) for every column: the facade's six at 7 m and the colonnades' two at 4.4 m. Each
    copy gets its own lightmap island, which is why they are copies rather than GPU instances."""
    templates = {}
    for kind, lods in COLUMN_LODS.items():
        bm = bmesh.new()
        TP.hathor_column(bm, 0.0, 0.0, 1.0, lods, HEAD['disp'], STATS)
        templates[kind] = G.new_object(f'hathor_template_{kind}', bm)
    out = []
    places = [(f'hathor_{i}', x, FZ, FH, 'door' if i in (2, 3) else 'facade') for i, x in enumerate(FX)]
    places += [('hathor_w', WING['cols'][0], FZ, WING['H'], 'wing'),
               ('hathor_e', WING['cols'][1], FZ, WING['H'], 'wing')]
    for name, x, z, h, kind in places:
        me = templates[kind].data.copy()
        me.transform(mathutils.Matrix.Translation(B(x, 0.0, z)) @ mathutils.Matrix.Scale(h, 4))
        me.name = name
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        out.append(ob)
    for kind, t in templates.items():
        STATS[f'column_tris_{kind}'] = G.tri_count(t)
        bpy.data.objects.remove(t)
    return out


def shaft_r(y):
    c = TP.COL
    t = np.clip((y / FH - c['shaft'][0]) / (c['shaft'][1] - c['shaft'][0]), 0, 1)
    return (c['r_bottom'] + (c['r_top'] - c['r_bottom']) * t) * FH


def screen_walls():
    """The four screen walls (0.42 of the columns) between the facade columns: Pl. 13 fig. 1's
    traced frame around a different whole traced scene on each (temple_relief.SCREEN_SCENES)."""
    out = []
    xv = math.sqrt(shaft_r(1.5) ** 2 - SW_T ** 2)
    yc0 = SW_H * (1 - TT.CAVETTO_V[1])
    yc1 = SW_H * (1 - TT.CAVETTO_V[0])
    ys = SW_H * (1 - TT.CREST_V)
    zf = FZ + SW_T
    for k, i in enumerate((0, 1, 3, 4)):
        x0, x1 = FX[i] + 0.30, FX[i + 1] - 0.30
        a, b = FX[i] + xv, FX[i + 1] - xv

        def uv(x, y, a=a, b=b, k=k):
            u = min(max((x - a) / (b - a), 0.0), 1.0)
            return ((u + k) * 0.25, min(y / SW_H, 0.999))

        bm = bmesh.new()
        layer = TP.uv_layer(bm)
        faces = box(bm, x0, x1, 0.0, ys, FZ - SW_T, zf, mat='screen')
        faces += box(bm, x0, x1, yc1, ys, zf, zf + 0.16, mat='screen')
        TP.cavetto(bm, x0, x1, yc0, yc1, zf, 0.14, +1, 'screen',
                   lambda x, t: uv(x, yc0 + t * (yc1 - yc0)), caps=True)
        # the uraeus crest: 21 cobras' discs make its top edge
        n = 21
        outline = [(x0, ys)]
        for j in range(n):
            xa = a + (b - a) * j / n
            xb = a + (b - a) * (j + 1) / n
            for t in (0.15, 0.5, 0.85):
                outline.append((xa + (xb - xa) * t, SW_H - (0.04 if t != 0.5 else 0.0)))
        outline.append((x1, ys))
        faces += G.extrude_profile(bm, outline, 'z', FZ - 0.06, zf + 0.04, mat='screen')
        for f in bm.faces:
            nz = G.plan_normal(f.normal)[2]
            if nz > 0.3:
                for loop in f.loops:
                    x, y, z = G.plan(loop.vert.co)
                    loop[layer].uv = uv(x, y)
        ob = G.new_object(f'screen_{k}', bm)
        set_mat(ob, lambda c, n, f: n[2] < 0.3, 'sandstone')
        drop_hidden_bottoms(ob)
        out.append(ob)
    return out


def winged_uv(x, t, x0, x1):
    u0, v0, u1, v1 = TT.WINGED_UV
    s = min(max((x - x0) / (x1 - x0), 0.0), 1.0)
    return (u0 + s * (u1 - u0), v0 + t * (v1 - v0))


def build_door():
    """The central doorway: jambs, the lintel (the title is its own node), and its own cavetto
    with the traced winged disc."""
    bm = bmesh.new()
    xa, xb = FX[2] + 0.30, FX[3] - 0.30
    h = DOOR['half']
    box(bm, xa, DOOR['open'][0], 0.0, DOOR['top'], FZ - h, FZ + h, mat='sandstone')
    box(bm, DOOR['open'][1], xb, 0.0, DOOR['top'], FZ - h, FZ + h, mat='sandstone')
    box(bm, xa, xb, DOOR['lintel'][0], DOOR['lintel'][1], FZ - h, FZ + h, mat='sandstone')
    y0, y1, y2 = DOOR['cornice']
    vis = math.sqrt(shaft_r(4.5) ** 2 - h ** 2)
    a, b = FX[2] + vis, FX[3] - vis
    TP.cavetto(bm, xa, xb, y0, y1, FZ + h, 0.15, +1, 'screen', lambda x, t: winged_uv(x, t, a, b))
    box(bm, xa, xb, y1, y2, FZ - h, FZ + h + 0.17, mat='sandstone')
    box(bm, DOOR['open'][0], DOOR['open'][1], 0.0, 0.03, FZ - h, FZ + h + 0.05, mat='granite')
    door = G.new_object('facade_door', bm)
    drop_hidden_bottoms(door)
    # the title 𓉐𓋹 on the lintel's face, under the winged disc
    bm = bmesh.new()
    vis = math.sqrt(shaft_r(4.0) ** 2 - h ** 2)
    a, b = FX[2] + vis, FX[3] - vis
    l0, l1 = DOOR['lintel']
    # lifted 6 mm proud of the lintel: at 2 mm it z-fought with the lintel's face from far out
    # (24-bit depth, camera near 0.1 tile: ~2 mm resolution at the 72 m orbit limit); the runtime
    # adds a polygon offset on top (TitleGlow.tsx), so no distance can fight
    z = FZ + h + TITLE_LIFT
    TP.quad(bm, [(a, l0, z), (b, l0, z), (b, l1, z), (a, l1, z)], 'title',
            [(0, 0), (1, 0), (1, 1), (0, 1)])
    title = G.new_object('facade_title', bm)
    STATS['title_box'] = [round(a, 3), round(b, 3), l0, l1]
    return [door, title]


def build_entablature():
    """Architrave, torus and the cavetto cornice over the six columns, the winged disc over the
    door, and the pronaos behind: its side walls and roof."""
    bm = bmesh.new()
    xa, xb = ARCH['x']
    h = ARCH['half']
    box(bm, xa, xb, ARCH['y'][0], ARCH['y'][1], FZ - h, FZ + h, mat='sandstone')
    torus = [(FZ + h + 0.07 * math.cos(t), ARCH['y'][1] + 0.07 * math.sin(t))
             for t in np.linspace(0, 2 * math.pi, 10, endpoint=False)]
    extrude(bm, torus, 'x', xa, xb)
    y0, y1, y2 = CORN['y']
    mid = (CX - 2.4, CX + 2.4)
    for s0, s1, winged in ((xa, mid[0], False), (mid[0], mid[1], True), (mid[1], xb, False)):
        if winged:
            TP.cavetto(bm, s0, s1, y0, y1, FZ + h, CORN['proud'], +1, 'screen',
                       lambda x, t: winged_uv(x, t, mid[0], mid[1]), caps=False)
        else:
            TP.cavetto(bm, s0, s1, y0, y1, FZ + h, CORN['proud'], +1, 'cornice',
                       lambda x, t: (x / 1.0, t), caps=True)
    box(bm, xa - 0.1, xb + 0.1, y1, y2, FZ - h, FZ + h + CORN['proud'] + 0.06, mat='sandstone')
    ent = G.new_object('facade_cornice', bm)
    bm = bmesh.new()
    px0, px1 = PRONAOS['x']
    box(bm, px0, px1, PRONAOS['roof'][0], PRONAOS['roof'][1], ZO0 + 0.2, FZ - h, mat='sandstone')
    box(bm, px0, px0 + 0.4, 0.0, PRONAOS['roof'][0], ZI0, FZ - 0.3, mat='sandstone')
    box(bm, px1 - 0.4, px1, 0.0, PRONAOS['roof'][0], ZI0, FZ - 0.3, mat='sandstone')
    pron = G.new_object('pronaos', bm)
    drop_hidden_bottoms(ent)
    drop_hidden_bottoms(pron)
    return [ent, pron]


def build_wings():
    """The two lower colonnades fronting the chamber pairs: a partition between the two
    chambers, the architrave on the Hathor column, a roof slab and the cornice."""
    out = []
    for side, (x0, x1), px in (('w', (XI0, FX[0] - 0.53), WING['partition'][0]),
                               ('e', (FX[-1] + 0.53, XI1), WING['partition'][1])):
        bm = bmesh.new()
        h = WING['half']
        box(bm, px - 0.15, px + 0.15, 0.0, WING['roof'][1], ZI0, FZ - 0.32, mat='sandstone')
        box(bm, x0, x1, WING['arch'][0], WING['arch'][1], FZ - h, FZ + h, mat='sandstone')
        box(bm, x0, x1, WING['roof'][0], WING['roof'][1], ZI0 - 0.05, FZ - h, mat='sandstone')
        y0, y1, y2 = WING['corn']
        TP.cavetto(bm, x0, x1, y0, y1, FZ + h, 0.28, +1, 'cornice', lambda x, t: (x / 1.0, t))
        box(bm, x0, x1, y1, y2, FZ - h, FZ + h + 0.32, mat='sandstone')
        ob = G.new_object(f'wing_{side}', bm)
        drop_hidden_bottoms(ob)
        out.append(ob)
    return out


# ---------------------------------------------------------------- the painted reliefs
# Where each relief field (temple_relief.FIELDS) sits: the object, the wall plane (plan axis, its
# coordinate, the outward normal's sign), the along-wall coordinate at the field's left and right
# edges as seen from in front, and its foot and top (metres). The faces in the plane are cut at
# the field's edges and the part inside takes the relief atlas.
NB = (FZ - 0.32)        # the chamber partitions' south end
RELIEF = {
    'court_w': ('temple_walls', 'x', XI0, +1, (ZO1, 5.4), (0.98, 5.50)),
    'court_e': ('temple_walls', 'x', XI1, -1, (5.4, ZO1), (0.98, 5.50)),
    'pronaos': ('temple_walls', 'z', ZI0, +1, (7.9, 22.1), (3.0, 7.3)),
    'n1_back': ('temple_walls', 'z', ZI0, +1, (XI0, 4.35), (1.1, 4.35)),
    'n4_back': ('temple_walls', 'z', ZI0, +1, (4.65, 7.5), (1.1, 4.35)),
    'n15_back': ('temple_walls', 'z', ZI0, +1, (22.5, 25.35), (1.1, 4.35)),
    'n18_back': ('temple_walls', 'z', ZI0, +1, (25.65, XI1), (1.1, 4.35)),
    'n1_west': ('temple_walls', 'x', XI0, +1, (4.23, ZI0), (1.1, 4.35)),
    'n1_east': ('wing_w', 'x', 4.35, -1, (ZI0, NB), (1.1, 4.35)),
    'n4_west': ('wing_w', 'x', 4.65, +1, (NB, ZI0), (1.1, 4.35)),
    'n4_east': ('pronaos', 'x', 7.5, -1, (ZI0, 4.35), (1.1, 4.35)),
    'n15_west': ('pronaos', 'x', 22.5, +1, (4.35, ZI0), (1.1, 4.35)),
    'n15_east': ('wing_e', 'x', 25.35, -1, (ZI0, NB), (1.1, 4.35)),
    'n18_west': ('wing_e', 'x', 25.65, +1, (NB, ZI0), (1.1, 4.35)),
    'n18_east': ('temple_walls', 'x', XI1, -1, (ZI0, 4.23), (1.1, 4.35)),
    'architrave': ('facade_cornice', 'z', FZ + ARCH['half'], +1, ARCH['x'], ARCH['y']),
    'wing_arch_w': ('wing_w', 'z', FZ + WING['half'], +1, (XI0, FX[0] - 0.53), WING['arch']),
    'wing_arch_e': ('wing_e', 'z', FZ + WING['half'], +1, (FX[-1] + 0.53, XI1), WING['arch']),
    'rim_w': ('temple_walls', 'z', ZO1, +1, (XO0, GATE[0]), (0.1, 0.9)),
    'rim_e': ('temple_walls', 'z', ZO1, +1, (GATE[1], XO1), (0.1, 0.9)),
}
AXIS = {'x': 0, 'y': 1, 'z': 2}


def _plane(axis, at):
    """A plan plane (axis = at) as a Blender (point, normal)."""
    if axis == 'x':
        return B(at, 0, 0), mathutils.Vector((1, 0, 0))
    if axis == 'y':
        return B(0, at, 0), mathutils.Vector((0, 0, 1))
    return B(0, 0, at), mathutils.Vector((0, 1, 0))


def apply_reliefs(objs):
    """Cut every relief field out of its wall face and map it into the relief atlas."""
    rects = TT.RELIEF_RECTS
    by_obj = {}
    for field, spec in RELIEF.items():
        by_obj.setdefault(spec[0], []).append((field, spec))
    for name, specs in by_obj.items():
        ob = objs[name]
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        layer = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
        for field, (_, axis, at, sign, (ua, ub), (y0, y1)) in specs:
            ai = AXIS[axis]
            along = 2 if axis == 'x' else 0

            def in_plane(f, ai=ai, at=at, sign=sign):
                n = G.plan_normal(f.normal)
                c = G.plan(f.calc_center_median())
                return n[ai] * sign > 0.95 and abs(c[ai] - at) < 0.08
            for cut_axis, cut_at in ((AXIS['y'], y0), (AXIS['y'], y1), (along, ua), (along, ub)):
                faces = [f for f in bm.faces if in_plane(f)]
                if not faces:
                    continue
                geom = list({e for f in faces for e in f.edges}) + faces + list({v for f in faces for v in f.verts})
                co, no = _plane('xyz'[cut_axis], cut_at)
                bmesh.ops.bisect_plane(bm, geom=geom, dist=1e-5, plane_co=co, plane_no=no)
            lo, hi = min(ua, ub), max(ua, ub)
            u0, v0, u1, v1 = rects[field]
            hit = 0
            for f in bm.faces:
                if not in_plane(f):
                    continue
                c = G.plan(f.calc_center_median())
                if not (lo - 1e-3 < c[along] < hi + 1e-3 and y0 - 1e-3 < c[1] < y1 + 1e-3):
                    continue
                f.material_index = MI['relief']
                hit += 1
                for loop in f.loops:
                    p = G.plan(loop.vert.co)
                    t = min(max((p[along] - ua) / (ub - ua), 0.0), 1.0)
                    s = min(max((p[1] - y0) / (y1 - y0), 0.0), 1.0)
                    loop[layer].uv = (u0 + t * (u1 - u0), v0 + s * (v1 - v0))
            assert hit, f'relief field {field}: no face in its plane'
            STATS.setdefault('relief_faces', {})[field] = hit
        bm.to_mesh(ob.data)
        bm.free()


def apply_stars(objs):
    """The soffits of the colonnades and the pronaos' ceiling: stars on blue."""
    for name in ('wing_w', 'wing_e', 'pronaos', 'facade_cornice'):
        set_mat(objs[name], lambda c, n, f: n[1] < -0.99 and c[1] > 3.0
                and f.material_index == MI['sandstone'], 'stars')


# ---------------------------------------------------------------- the court
def build_obelisks():
    out = []
    for f in furniture('obelisk-'):
        cx, cz = tile_centre(f['col'], f['row'])
        bm = bmesh.new()
        top = TP.obelisk(bm, cx, cz, 'w' if cx < CX else 'e')
        ob = G.new_object(f'obelisk_{f["col"]}_{f["row"]}', bm)
        drop_hidden_bottoms(ob)
        out.append(ob)
        STATS['obelisk_height'] = round(top, 2)
    return out


def palette_box(bm, a, swatch, mat='props'):
    faces = box(bm, *a, mat=mat)
    G.paint(bm, faces, TT.palette_uv()[swatch])
    return faces


def beam(bm, p0, p1, w, swatch, up=(0.0, 1.0, 0.0)):
    """A square-section rod from p0 to p1 (plan), w thick, painted with a palette swatch."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d = p1 - p0
    d /= np.linalg.norm(d)
    a = np.cross(d, up)
    if np.linalg.norm(a) < 1e-6:
        a = np.cross(d, (1.0, 0.0, 0.0))
    a = a / np.linalg.norm(a) * w / 2
    b = np.cross(d, a)
    b = b / np.linalg.norm(b) * w / 2
    corners = [p0 + sa * a + sb * b for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    corners += [p1 + sa * a + sb * b for sa, sb in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    vs = [bm.verts.new(B(*c)) for c in corners]
    faces = [bm.faces.new(vs[:4]), bm.faces.new(vs[4:][::-1])]
    for i in range(4):
        j = (i + 1) % 4
        faces.append(bm.faces.new((vs[i], vs[j], vs[4 + j], vs[4 + i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = MI['props']
    G.paint(bm, faces, TT.palette_uv()[swatch])
    return faces


def roll(bm, x0, x1, y, z, r, swatch, axis='x', seg=8):
    """A papyrus roll (or any rod) lying along x or z."""
    ring = [(r * math.cos(t), r * math.sin(t)) for t in np.linspace(0, 2 * math.pi, seg, endpoint=False)]
    if axis == 'x':
        faces = G.extrude_profile(bm, [(z + a, y + b) for a, b in ring], 'x', x0, x1, mat='props')
    else:
        faces = G.extrude_profile(bm, [(x + a, y + b) for a, b in ring], 'z', x0, x1, mat='props')
    G.paint(bm, faces, TT.palette_uv()[swatch])
    return faces


def table_centre(s):
    dc, dr = STEP[s['facing']]
    col, row = s['col'] + dc, s['row'] + dr
    cx, _ = tile_centre(col, row)
    edge = (row + (1 if dr < 0 else 0)) * T
    d = 0.46
    cz = edge + (-1 if dr < 0 else 1) * (d / 2 + 0.05)
    return cx, cz, dr


def build_tables():
    """table_<seatUid>: a scribe's low wooden table in front of every seat (the scribe sits on a
    reed mat), with a roll, a palette and a water pot on it."""
    out = []
    pb = bmesh.new()
    for s in LAYOUT['seats']:
        cx, cz, dr = table_centre(s)
        w, d, h = (1.1 if s['uid'].startswith('court-') else 0.95), 0.46, 0.30
        bm = bmesh.new()
        palette_box(bm, (cx - w / 2, cx + w / 2, h - 0.04, h, cz - d / 2, cz + d / 2), 'wood')
        for sx in (-1, 1):
            palette_box(bm, (cx + sx * (w / 2 - 0.06) - 0.03, cx + sx * (w / 2 - 0.06) + 0.03, 0.0,
                             h - 0.04, cz - d / 2 + 0.03, cz + d / 2 - 0.03), 'wood_dark')
        ob = G.new_object(f'table_{s["uid"]}', bm)
        drop_hidden_bottoms(ob)
        out.append(ob)
        roll(pb, cx - 0.28, cx + 0.18, h + 0.025, cz - 0.08 * (1 if dr < 0 else -1), 0.025, 'papyrus')
        palette_box(pb, (cx + 0.22, cx + 0.42, h, h + 0.012, cz - 0.04, cz + 0.04), 'wood_pale')
        G.paint(pb, G.lathe(pb, [(0.03, 0.0), (0.045, 0.03), (0.035, 0.07), (0.022, 0.08)],
                            cx - 0.38, cz + 0.05, y0=h, segments=8, mat='props', close_top=True),
                TT.palette_uv()['pottery'])
    return out, G.new_object('temple_props', pb)


def build_mats():
    bm = bmesh.new()
    for s in LAYOUT['seats']:
        cx, cz = tile_centre(s['col'], s['row'])
        palette_box(bm, (cx - 0.42, cx + 0.42, 0.0, 0.012, cz - 0.42, cz + 0.42), 'reed_dark')
        palette_box(bm, (cx - 0.37, cx + 0.37, 0.012, 0.022, cz - 0.37, cz + 0.37), 'reed')
    ob = G.new_object('reed_mats', bm)
    drop_hidden_bottoms(ob)
    return ob


LAMP_PROFILE = [(0.0, 0.0), (0.04, 0.004), (0.065, 0.018), (0.07, 0.032), (0.06, 0.038), (0.0, 0.04)]


def lamp_mesh(bm, x, y, z, spout):
    """A pottery saucer lamp with a pinched spout and its flame; returns the flame position."""
    G.lathe(bm, LAMP_PROFILE[1:-1], x, z, y0=y, segments=10, mat='lamp', close_top=True)
    sx, sz = spout
    box(bm, x + min(0, sx * 0.1) - 0.014 * abs(sz), x + max(0, sx * 0.1) + 0.014 * abs(sz),
        y + 0.02, y + 0.036, z + min(0, sz * 0.1) - 0.014 * abs(sx),
        z + max(0, sz * 0.1) + 0.014 * abs(sx), mat='lamp')
    fx, fy, fz = x + sx * 0.1, y + 0.036, z + sz * 0.1
    G.lathe(bm, [(0.003, 0.0), (0.011, 0.012), (0.009, 0.03), (0.002, 0.05)], fx, fz, y0=fy,
            segments=6, mat='flame', close_top=True)
    return (fx, fy + 0.022, fz)


def build_lamps(details):
    """oil_lamp_<seatUid> for every seat and two lamp stands by the door; returns the objects and
    the practicals (the dusk bake's lamps and the runtime's)."""
    objs, practicals = [], []
    for s in LAYOUT['seats']:
        cx, cz = tile_centre(s['col'], s['row'])
        bm = bmesh.new()
        if s['uid'].startswith('alcove-n-'):
            pos, spout = (cx, LAMP_SILL, ZI0 + 0.13), (0, 1)
            box(details, cx - 0.17, cx + 0.17, LAMP_SILL - 0.06, LAMP_SILL, ZI0, ZI0 + 0.24,
                mat='sandstone')
        elif s['uid'].startswith('alcove-s-'):
            pos, spout = (cx, SOUTH_CUT, ZI1 + 0.22), (0, -1)
        else:
            _, tz, _ = table_centre(s)
            side = 1 if s['uid'].endswith('-b') else -1
            pos, spout = (cx + side * 0.36, 0.30, tz - 0.12), (0, 1)
        flame = lamp_mesh(bm, *pos, spout)
        objs.append(G.new_object(f'oil_lamp_{s["uid"]}', bm))
        practicals.append(dict(id=f'oil_lamp_{s["uid"]}', seatUid=s['uid'], position=flame))
    for i, x in enumerate((CX - 2.0, CX + 2.0)):      # beside the baboons of Thoth at the door
        bm = bmesh.new()
        z = FZ + 0.85
        G.lathe(bm, [(0.16, 0.0), (0.12, 0.05), (0.035, 0.1), (0.03, 1.05), (0.09, 1.12),
                     (0.1, 1.16)], x, z, y0=0.0, segments=10, mat='props', close_top=True)
        G.paint(bm, bm.faces, TT.palette_uv()['bronze'])
        flame = lamp_mesh(bm, x, 1.16, z, (0, 1))
        objs.append(G.new_object(f'oil_lamp_door_{i}', bm))
        practicals.append(dict(id=f'oil_lamp_door_{i}', position=flame))
    return objs, practicals


def build_scrolls():
    """scrolls_<uid>: open cabinets against the side walls with papyrus rolls (the House of
    Wisdom's shelf tiles)."""
    out = []
    for f in furniture('shelf-'):
        west = f['col'] * T < CX
        wx = XI0 if west else XI1
        d = 0.42
        x0, x1 = (wx, wx + d) if west else (wx - d, wx)
        z0, z1 = f['row'] * T + 0.1, (f['row'] + f['footprintH']) * T - 0.1
        bm = bmesh.new()
        for y0, y1 in ((0.0, 0.08), (0.42, 0.46), (0.84, 0.88), (1.26, 1.32)):
            palette_box(bm, (x0, x1, y0, y1, z0, z1), 'wood')
        for z in (z0, (z0 + z1) / 2, z1):
            palette_box(bm, (x0, x1, 0.0, 1.32, z - 0.03, z + 0.03), 'wood_dark')
        rng = np.random.default_rng(f['row'] * 7 + f['col'])
        for y in (0.08, 0.46, 0.88):
            n = 9
            for k in range(n):
                zc = z0 + 0.12 + (z1 - z0 - 0.24) * k / (n - 1)
                r = 0.045 + 0.01 * rng.random()
                if abs(zc - (z0 + z1) / 2) < 0.06:
                    continue
                roll(bm, x0 + 0.03, x1 - 0.02, y + r, zc, r,
                     'papyrus' if rng.random() < 0.75 else 'linen')
        ob = G.new_object(f'scrolls_{f["uid"]}', bm)
        drop_hidden_bottoms(ob)
        out.append(ob)
    return out


def build_chests():
    out = []
    for f in furniture('chest-'):
        if f['col'] == 3:          # the Architects' chamber: its stakes and cord stand here
            continue
        cx, cz = tile_centre(f['col'], f['row'])
        cz -= 0.2
        bm = bmesh.new()
        palette_box(bm, (cx - 0.36, cx + 0.36, 0.06, 0.44, cz - 0.22, cz + 0.22), 'wood')
        palette_box(bm, (cx - 0.38, cx + 0.38, 0.44, 0.5, cz - 0.24, cz + 0.24), 'wood_dark')
        for sx in (-1, 1):
            for sz in (-1, 1):
                palette_box(bm, (cx + sx * 0.32 - 0.03, cx + sx * 0.32 + 0.03, 0.0, 0.06,
                                 cz + sz * 0.18 - 0.03, cz + sz * 0.18 + 0.03), 'wood_dark')
        ob = G.new_object(f'chest_{f["uid"]}', bm)
        drop_hidden_bottoms(ob)
        out.append(ob)
    return out


# ---------------------------------------------------------------- the court's dressing
def ellipsoid(bm, c, r, swatch, seg=12, rings=8, mat='props'):
    """An ellipsoid at plan c with radii r (x, y, z), painted with a palette swatch."""
    vs = []
    for i in range(rings + 1):
        phi = math.pi * i / rings
        row = []
        for k in range(seg):
            th = 2 * math.pi * k / seg
            row.append(bm.verts.new(B(c[0] + r[0] * math.sin(phi) * math.cos(th),
                                      c[1] + r[1] * math.cos(phi),
                                      c[2] + r[2] * math.sin(phi) * math.sin(th))))
        vs.append(row)
    faces = []
    for i in range(rings):
        for k in range(seg):
            j = (k + 1) % seg
            if i == 0:
                f = (vs[0][k], vs[1][j], vs[1][k])
            elif i == rings - 1:
                f = (vs[i][k], vs[i][j], vs[i + 1][k])
            else:
                f = (vs[i][k], vs[i][j], vs[i + 1][j], vs[i + 1][k])
            try:
                faces.append(bm.faces.new(f))
            except ValueError:
                pass
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = MI[mat]
        f.smooth = True
    G.paint(bm, faces, TT.palette_uv()[swatch])
    return faces


def baboon(bm, x, z, facing=1.0):
    """Thoth as the seated baboon (A'an) on his plinth, facing the court (+z): squatting, hands on
    the knees, the mane falling over the shoulders like a cape, the moon's disc on the head."""
    palette_box(bm, (x - 0.30, x + 0.30, 0.0, 0.08, z - 0.34, z + 0.34), 'granite_dark')
    palette_box(bm, (x - 0.26, x + 0.26, 0.08, 0.56, z - 0.30, z + 0.30), 'stone')
    palette_box(bm, (x - 0.28, x + 0.28, 0.56, 0.60, z - 0.32, z + 0.32), 'granite_dark')
    y = 0.60
    f = facing
    ellipsoid(bm, (x, y + 0.16, z - 0.04 * f), (0.18, 0.17, 0.17), 'greywacke')          # haunches
    for sx in (-1, 1):
        ellipsoid(bm, (x + sx * 0.10, y + 0.17, z + 0.09 * f), (0.07, 0.10, 0.12), 'greywacke')  # knees
        ellipsoid(bm, (x + sx * 0.10, y + 0.07, z + 0.15 * f), (0.05, 0.05, 0.07), 'greywacke_dark')  # feet
        ellipsoid(bm, (x + sx * 0.11, y + 0.28, z + 0.12 * f), (0.035, 0.035, 0.05), 'greywacke_dark')  # hands
    ellipsoid(bm, (x, y + 0.36, z - 0.02 * f), (0.15, 0.19, 0.14), 'greywacke')           # body
    ellipsoid(bm, (x, y + 0.47, z - 0.03 * f), (0.19, 0.12, 0.16), 'greywacke_dark')      # the mane's cape
    ellipsoid(bm, (x, y + 0.58, z + 0.03 * f), (0.09, 0.09, 0.09), 'greywacke')           # head
    ellipsoid(bm, (x, y + 0.555, z + 0.11 * f), (0.045, 0.04, 0.06), 'greywacke_dark')    # muzzle
    # the lunar disc on its crescent, gilded
    G.paint(bm, G.lathe(bm, [(0.0, 0.0), (0.07, 0.0), (0.07, 0.014), (0.0, 0.014)], x, z,
                        y0=y + 0.66, segments=14, mat='props'), TT.palette_uv()['gold'])
    ellipsoid(bm, (x, y + 0.75, z), (0.075, 0.075, 0.018), 'gold', seg=14, rings=8)


def offering_table(bm, x, z, w=0.9, d=0.5, h=0.62):
    """A stone offering table (hetep) on its stand, heaped with loaves, figs and grapes, a jar of
    water and blue lotus flowers laid across the top."""
    palette_box(bm, (x - 0.12, x + 0.12, 0.0, h - 0.06, z - 0.12, z + 0.12), 'granite_dark')
    palette_box(bm, (x - 0.22, x + 0.22, 0.0, 0.06, z - 0.2, z + 0.2), 'granite_dark')
    palette_box(bm, (x - w / 2, x + w / 2, h - 0.06, h, z - d / 2, z + d / 2), 'stone')
    t = h
    rng = np.random.default_rng(int(x * 10 + z))
    for k in range(5):                                            # round and conical loaves
        bx = x - w * 0.36 + k * w * 0.14
        bz = z + (0.08 if k % 2 else -0.06)
        if k % 2:
            G.paint(bm, G.lathe(bm, [(0.05, 0.0), (0.045, 0.06), (0.02, 0.13), (0.003, 0.16)], bx, bz,
                                y0=t, segments=8, mat='props'), TT.palette_uv()['bread'])
        else:
            ellipsoid(bm, (bx, t + 0.035, bz), (0.07, 0.04, 0.06), 'bread_dark' if k == 2 else 'bread', seg=10, rings=6)
    for k in range(6):                                            # figs and a bunch of grapes
        ellipsoid(bm, (x + 0.16 + 0.05 * (k % 3), t + 0.03 + 0.03 * (k // 3), z - 0.1 + 0.03 * k),
                  (0.025, 0.025, 0.025), 'figs' if k < 3 else 'grapes', seg=6, rings=4)
    G.paint(bm, G.lathe(bm, [(0.04, 0.0), (0.075, 0.06), (0.07, 0.16), (0.035, 0.22), (0.045, 0.25)],
                        x + w * 0.38, z + 0.1, y0=t, segments=10, mat='props'), TT.palette_uv()['faience'])
    # blue lotus: long stems over the table's edge, the flowers open at the front
    for k in range(3):
        sx = x - 0.15 + 0.15 * k + 0.02 * rng.standard_normal()
        beam(bm, (sx, t + 0.012, z - 0.12), (sx + 0.03, t + 0.01, z + d / 2 + 0.06), 0.01, 'stem')
        fz = z + d / 2 + 0.08
        G.paint(bm, G.lathe(bm, [(0.0, 0.0), (0.035, 0.02), (0.055, 0.05), (0.03, 0.055)], sx + 0.03,
                            fz, y0=t - 0.02, segments=8, mat='props', close_top=False),
                TT.palette_uv()['lotus_blue' if k == 1 else 'lotus'])


def lamp_stand(bm, x, z, h=1.45):
    """A tall bronze lamp stand: a tripod foot, the shaft with its rings, a dish lamp on top.
    Returns the flame's position."""
    G.paint(bm, G.lathe(bm, [(0.17, 0.0), (0.13, 0.04), (0.04, 0.09), (0.028, 0.2), (0.04, 0.22),
                             (0.025, 0.24), (0.025, h - 0.12), (0.045, h - 0.1), (0.03, h - 0.07),
                             (0.1, h - 0.03), (0.11, h)], x, z, y0=0.0, segments=10, mat='props',
                        close_top=True), TT.palette_uv()['bronze'])
    return lamp_mesh(bm, x, h, z, (0, 1))


def potted_papyrus(bm, x, z, rng):
    """A clump of papyrus in a broad pottery pot: stems fanning out, each crowned by its umbel."""
    G.paint(bm, G.lathe(bm, [(0.12, 0.0), (0.2, 0.08), (0.23, 0.22), (0.2, 0.36), (0.22, 0.4),
                             (0.18, 0.4)], x, z, y0=0.0, segments=12, mat='props'),
            TT.palette_uv()['pottery'])
    palette_box(bm, (x - 0.17, x + 0.17, 0.36, 0.38, z - 0.17, z + 0.17), 'pottery_dark')
    for k in range(9):
        a = 2 * math.pi * k / 9 + 0.3 * rng.standard_normal()
        lean = 0.10 + 0.12 * rng.random()
        hgt = 1.05 + 0.45 * rng.random()
        top = (x + math.cos(a) * lean * hgt * 0.35, 0.38 + hgt, z + math.sin(a) * lean * hgt * 0.35)
        beam(bm, (x + 0.03 * math.cos(a), 0.37, z + 0.03 * math.sin(a)), top, 0.014, 'stem')
        G.paint(bm, G.lathe(bm, [(0.006, 0.0), (0.07, 0.07), (0.09, 0.1), (0.05, 0.12)], top[0], top[2],
                            y0=top[1] - 0.01, segments=8, mat='props', close_top=True),
                TT.palette_uv()['umbel'])
    for k in range(5):                                            # leaves at the foot
        a = 2 * math.pi * k / 5
        beam(bm, (x, 0.38, z), (x + 0.28 * math.cos(a), 0.62, z + 0.28 * math.sin(a)), 0.02, 'leaf')


def storage_jars(bm, x, z, rng):
    """Two tall storage jars and a squat one on ring stands, stoppered with clay."""
    for k, (dx, dz, s) in enumerate(((-0.22, -0.12, 1.0), (0.2, -0.05, 0.9), (0.02, 0.24, 0.62))):
        cx, cz = x + dx, z + dz
        palette_box(bm, (cx - 0.12, cx + 0.12, 0.0, 0.05, cz - 0.12, cz + 0.12), 'pottery_dark')
        prof = [(0.05, 0.0), (0.14, 0.12), (0.2, 0.34), (0.19, 0.55), (0.12, 0.72), (0.07, 0.78),
                (0.08, 0.84), (0.05, 0.86)]
        G.paint(bm, G.lathe(bm, [(r * s, hh * s) for r, hh in prof], cx, cz, y0=0.04, segments=12,
                            mat='props'), TT.palette_uv()['pottery' if k != 1 else 'sand'])
        # a painted band round the shoulder (blue faience glaze lines, as on Late jars)
        G.paint(bm, G.lathe(bm, [(0.195 * s, 0.5 * s), (0.2 * s, 0.53 * s)], cx, cz, y0=0.04,
                            segments=12, mat='props', close_top=False), TT.palette_uv()['blue'])


# where the dressing stands: furniture uids of the layout (blocked tiles), see greybox.ts
def build_dressing():
    """The court's dressing: two baboons of Thoth and an offering table before the door, the
    door's lamp stands beside them, two more offering tables at the obelisks' feet, lamp stands at
    the pool's south corners, potted papyrus at its north corners and by the side walls, storage
    jars in the south corners and beside the gate. Returns the object and the extra lamps (baked
    into the dusk lightmap; not runtime practicals)."""
    bm = bmesh.new()
    rng = np.random.default_rng(7)
    lamps = []
    for x in (CX - 0.85, CX + 0.85):           # clear of the door columns' base discs
        baboon(bm, x, FZ + 1.1)
    offering_table(bm, CX, FZ + 1.0, w=0.7, d=0.4, h=0.58)
    for f in furniture('offering-'):
        cx, cz = tile_centre(f['col'], f['row'])
        offering_table(bm, cx, cz)
    for f in furniture('stand-'):
        cx, cz = tile_centre(f['col'], f['row'])
        lamps.append(dict(id=f'court_lamp_{f["col"]}_{f["row"]}', position=lamp_stand(bm, cx, cz),
                          power=LAMP_POWER))
    for f in furniture('papyrus-'):
        cx, cz = tile_centre(f['col'], f['row'])
        potted_papyrus(bm, cx, cz, rng)
    for f in furniture('jars-'):
        cx, cz = tile_centre(f['col'], f['row'])
        storage_jars(bm, cx, cz, rng)
    ob = G.new_object('court_dressing', bm)
    drop_hidden_bottoms(ob)
    STATS['dressing_tris'] = G.tri_count(ob)
    return ob, lamps


# ---------------------------------------------------------------- the Architects' chamber
def build_architects():
    """Chamber alcove-n-4 (west, beside the facade): the gridded papyrus section of the pyramid on
    the back wall (the centrepiece's numbers), royal cubit rods, a plumb bob on its bracket,
    Seshat's cord stretched between two stakes, and an A-frame mason's level."""
    x0, x1 = WING['partition'][0] + 0.15, PRONAOS['x'][0]
    pc = (x0 + x1) / 2 - 0.25
    pw, ph = 1.5, 1.5 * TT.PAPYRUS_PX[0] / TT.PAPYRUS_PX[1]
    y0 = 1.02
    bm = bmesh.new()
    z = ZI0 + 0.012
    TP.quad(bm, [(pc - pw / 2, y0, z), (pc + pw / 2, y0, z), (pc + pw / 2, y0 + ph, z),
                 (pc - pw / 2, y0 + ph, z)], 'papyrus', [(0, 0), (1, 0), (1, 1), (0, 1)])
    paper = G.new_object('architects_papyrus', bm)
    bm = bmesh.new()
    for y in (y0 - 0.015, y0 + ph + 0.015):
        roll(bm, pc - pw / 2 - 0.06, pc + pw / 2 + 0.06, y, ZI0 + 0.03, 0.022, 'wood_dark')
    # three royal cubit rods (52.4 cm) leaning on the partition
    for k in range(3):
        zb = 2.05 + 0.09 * k
        beam(bm, (x0 + 0.13, 0.0, zb), (x0 + 0.03, 0.5, zb + 0.06), 0.03,
             'wood' if k != 1 else 'basalt')
    # the plumb bob: a bracket, the cord, the pear-shaped weight
    bx, bz = x0 + 0.05, 3.15
    palette_box(bm, (x0, x0 + 0.16, 1.78, 1.82, bz - 0.02, bz + 0.02), 'wood_dark')
    beam(bm, (x0 + 0.13, 1.78, bz), (x0 + 0.13, 1.05, bz), 0.006, 'cord')
    G.paint(bm, G.lathe(bm, [(0.004, 0.0), (0.03, 0.03), (0.022, 0.06), (0.006, 0.075)],
                        x0 + 0.13, bz, y0=0.98, segments=8, mat='props', close_top=True),
            TT.palette_uv()['bronze'])
    # Seshat's cord on its stakes (the stretching of the cord), on the chest tile
    s0, s1 = (x0 + 0.35, 3.35), (x0 + 0.95, 4.25)
    for sx, sz in (s0, s1):
        beam(bm, (sx, 0.0, sz), (sx, 0.42, sz), 0.035, 'wood_pale')
    beam(bm, (s0[0], 0.36, s0[1]), (s1[0], 0.36, s1[1]), 0.007, 'cord')
    G.paint(bm, G.lathe(bm, [(0.05, 0.0), (0.08, 0.02), (0.08, 0.05), (0.05, 0.06)],
                        s1[0] - 0.3, s1[1] - 0.05, y0=0.0, segments=10, mat='props',
                        close_top=True), TT.palette_uv()['cord'])
    # the A-frame level against the back wall, its plumb line
    ax = x1 - 0.35
    beam(bm, (ax - 0.32, 0.0, ZI0 + 0.25), (ax, 0.62, ZI0 + 0.12), 0.035, 'wood')
    beam(bm, (ax + 0.32, 0.0, ZI0 + 0.25), (ax, 0.62, ZI0 + 0.12), 0.035, 'wood')
    beam(bm, (ax - 0.17, 0.3, ZI0 + 0.19), (ax + 0.17, 0.3, ZI0 + 0.19), 0.03, 'wood')
    beam(bm, (ax, 0.6, ZI0 + 0.2), (ax, 0.24, ZI0 + 0.2), 0.005, 'cord')
    props = G.new_object('architects_props', bm)
    drop_hidden_bottoms(props)
    STATS['architects_papyrus'] = [round(pc - pw / 2, 3), round(pc + pw / 2, 3), y0, round(y0 + ph, 3)]
    return [paper, props]


# ---------------------------------------------------------------- the pyramid in the pool
def build_pyramid():
    casing, cap = TP.build_pyramid(PYR['cx'], PYR['cz'], PYR['y0'], STATS)
    bm = bmesh.new()
    p = PYR['plinth']
    # the granite plinth rises from the pool floor under the casing's foot
    box(bm, PYR['cx'] - p, PYR['cx'] + p, POOL['floor'], PYR['y0'], PYR['cz'] - p, PYR['cz'] + p,
        mat='granite')
    plinth = G.new_object('pyramid_plinth', bm)
    drop_hidden_bottoms(plinth, POOL['floor'] + 0.01)
    return [casing, cap, plinth]


# Water lilies: (x, z) from the pool's centre, and whether a white lotus flower sits on the pad.
# All on the water ring (the plinth's half-width is 2.8, the coping's 3.85), clear of the steps.
LOTUS = [(-3.30, -1.60, True), (-3.15, 0.45, False), (-3.35, 2.05, True), (3.30, -2.05, False),
         (3.35, 0.05, True), (3.20, 1.90, False), (-1.45, -3.30, True), (1.65, -3.30, False),
         (-2.35, 3.25, False), (2.40, 3.25, False)]


def lily_pad(bm, x, z, r, notch, rng):
    """A round pad floating on the water: a shallow dish with a V-shaped notch."""
    y = POOL['water'] + 0.012
    n = 16
    c = bm.verts.new(B(x, y - 0.004, z))
    ring = []
    for k in range(n + 1):
        a = notch + 0.34 + (2 * math.pi - 0.68) * k / n
        rr = r * (0.96 + 0.04 * rng.random())
        ring.append(bm.verts.new(B(x + rr * math.cos(a), y + 0.012, z + rr * math.sin(a))))
    faces = [bm.faces.new((c, ring[k + 1], ring[k])) for k in range(n)]
    bm.normal_update()
    for f in faces:
        if f.normal.z < 0:   # a pad faces the sky (Blender's up is z)
            f.normal_flip()
    for f in faces:
        f.material_index = MI['props']
    G.paint(bm, faces, TT.palette_uv()['leaf'])


def white_lotus(bm, x, z, rng):
    """A white lotus (Nymphaea lotus): two rings of pointed white petals round a gold heart."""
    y0 = POOL['water'] + 0.02
    for ring, (n, length, tilt, off) in enumerate(((9, 0.17, 62, 0.0), (9, 0.145, 38, 0.5),
                                                   (6, 0.11, 18, 0.25))):
        for k in range(n):
            a = 2 * math.pi * (k + off) / n + 0.1 * rng.standard_normal()
            th = math.radians(tilt + 4 * rng.standard_normal())
            rad = np.array([math.cos(a), 0.0, math.sin(a)])
            tan = np.array([-math.sin(a), 0.0, math.cos(a)])
            up = np.array([0.0, 1.0, 0.0])
            base = np.array([x, y0 + 0.01 * ring, z]) + rad * 0.018
            axis = rad * math.sin(th) + up * math.cos(th)
            w = 0.052 - 0.006 * ring
            pts = [base, base + axis * length * 0.5 + tan * w + up * 0.004,
                   base + axis * length, base + axis * length * 0.5 - tan * w + up * 0.004]
            # two thin skins a hair apart (so the bake does not see one through the other), the
            # upper one facing up and out
            u = np.cross(axis, tan)
            u = u / np.linalg.norm(u)
            if u[1] < 0:
                u = -u
            bu = mathutils.Vector((u[0], -u[2], u[1]))
            fs = []
            for side in (1.0, -1.0):
                vs = [bm.verts.new(B(*(pt + u * 0.0016 * side))) for pt in pts]
                f = bm.faces.new(vs)
                bm.normal_update()
                if f.normal.dot(bu) * side < 0:
                    f.normal_flip()
                f.material_index = MI['props']
                fs.append(f)
            G.paint(bm, fs, TT.palette_uv()['white'])
    # the stamens' golden heart
    G.paint(bm, G.lathe(bm, [(0.0, 0.0), (0.03, 0.0), (0.034, 0.018), (0.012, 0.03), (0.0, 0.03)],
                        x, z, y0=y0 + 0.01, segments=8, mat='props', close_top=True),
            TT.palette_uv()['yellow'])


def build_lilies():
    """lotus_<i>: one node per floating cluster (a pad, a small pad, a flower on some), so the
    runtime can bob each on its own phase (engine clock)."""
    rng = np.random.default_rng(23)
    out = []
    for i, (dx, dz, flower) in enumerate(LOTUS):
        x, z = POOL['cx'] + dx, POOL['cz'] + dz
        bm = bmesh.new()
        lily_pad(bm, x, z, 0.30 + 0.06 * rng.random(), 2 * math.pi * rng.random(), rng)
        a = 2 * math.pi * rng.random()
        lily_pad(bm, x + 0.42 * math.cos(a), z + 0.42 * math.sin(a), 0.17 + 0.03 * rng.random(),
                 2 * math.pi * rng.random(), rng)
        if flower:
            white_lotus(bm, x + 0.03, z - 0.02, rng)
        out.append(G.new_object(f'lotus_{i}', bm))
    return out


def pool_papyrus(bm, x, z, rng):
    """A clump of papyrus rooted on the shelf and rising out of the water, umbels at the tips."""
    y0 = POOL['shelf_y']
    for k in range(13):
        a = 2 * math.pi * k / 13 + 0.3 * rng.standard_normal()
        lean = 0.10 + 0.14 * rng.random()
        hgt = 1.55 + 0.55 * rng.random()
        r0 = 0.05 + 0.07 * rng.random()
        top = (x + math.cos(a) * lean * hgt * 0.45, y0 + hgt, z + math.sin(a) * lean * hgt * 0.45)
        beam(bm, (x + r0 * math.cos(a), y0, z + r0 * math.sin(a)), top, 0.016, 'stem')
        G.paint(bm, G.lathe(bm, [(0.006, 0.0), (0.07, 0.07), (0.09, 0.1), (0.05, 0.12)], top[0],
                            top[2], y0=top[1] - 0.01, segments=8, mat='props', close_top=True),
                TT.palette_uv()['umbel'])
    for k in range(6):                                            # blades at the foot
        a = 2 * math.pi * k / 6 + 0.4
        beam(bm, (x, POOL['water'] + 0.1, z),
             (x + 0.34 * math.cos(a), POOL['water'] + 0.5, z + 0.34 * math.sin(a)), 0.022, 'leaf')


def build_pool_papyrus():
    rng = np.random.default_rng(31)
    out = []
    for name, sx in (('w', -1), ('e', 1)):
        bm = bmesh.new()
        pool_papyrus(bm, POOL['cx'] + sx * 3.50, POOL['cz'] - 3.50, rng)
        out.append(G.new_object(f'pool_papyrus_{name}', bm))
    return out


# ---------------------------------------------------------------- details and bake-only
def build_bake_only():
    """The south wall above the cutaway (with its gate): it shades the court as the real
    enclosure would, but is never exported (as hall.py's)."""
    bm = bmesh.new()
    box(bm, XO0, GATE[0], SOUTH_CUT, WALL_H, ZI1, ZO1)
    box(bm, GATE[1], XO1, SOUTH_CUT, WALL_H, ZI1, ZO1)
    box(bm, GATE[0], GATE[1], 3.3, WALL_H, ZI1, ZO1)
    ob = G.new_object('BAKE_ONLY_south_wall', bm)
    for f in ob.data.polygons:
        f.material_index = MI['sandstone']
    return [ob]


# ---------------------------------------------------------------- lightmap weights
LM_WEIGHT = {'temple_exterior': 0.25, 'temple_base': 0.3, 'pronaos': 0.6, 'reed_mats': 0.5,
             'temple_props': 0.4, 'temple_details': 0.6, 'architects_props': 1.2,
             'architects_papyrus': 1.4, 'facade_title': 1.8, 'pool_water': 0.9, 'pool_basin': 1.0,
             'pyramid_casing': 2.6, 'pyramid_capstone': 1.6, 'pyramid_plinth': 0.9,
             'temple_floor': 0.85, 'temple_walls': 0.9, 'temple_section': 1.0,
             'court_dressing': 0.8}
LM_PREFIX_WEIGHT = {'hathor_': 1.5, 'screen_': 1.25, 'oil_lamp_': 0.25, 'table_': 0.6,
                    'scrolls_': 0.5, 'chest_': 0.5, 'obelisk_': 1.3, 'wing_': 0.8, 'facade_': 1.0,
                    'lotus_': 0.3, 'pool_papyrus_': 0.3}


def lm_weight(name):
    for k, w in LM_PREFIX_WEIGHT.items():
        if name.startswith(k):
            return w
    return LM_WEIGHT.get(name, 1.0)


def make_gobo():
    """The live sun spot (meta.moods.golden.sun): the noon sun is all in the lightmap, so its gobo
    is black and the spot adds nothing; the rig stays in the meta for the runtime's schema."""
    P.write_png(os.path.join(OUT, 'gobo_sun.png'), np.zeros((16, 16), dtype=np.uint8))
    d = sun_dir()
    target = np.array([CX, 0.0, 10.5])
    pos = target - d * 30.0
    return {'position': [float(v) for v in pos], 'target': [float(v) for v in target],
            'angle': 0.45, 'near': 10.0, 'far': 60.0, 'size': 16}


# ---------------------------------------------------------------- main
def main():
    t0 = time.perf_counter()
    scene = C.reset_scene()
    C.use_metal_gpu(scene)
    C.TIMINGS.clear()
    with C.timed('temple textures (numpy)'):
        build_materials()
    with C.timed('temple geometry'):
        walls, ext, section = build_walls()
        floor = build_floor()
        base = build_base()
        pool = build_pool()
        water = build_water()
        columns = column_objects()
        screens = screen_walls()
        door = build_door()
        entab = build_entablature()
        wings = build_wings()
        obelisks = build_obelisks()
        tables, props = build_tables()
        mats = build_mats()
        dbm = bmesh.new()
        box(dbm, GATE[0], GATE[1], 0.0, 0.04, ZI1 - 0.05, ZO1 + 0.05, mat='granite')
        lamps, practicals = build_lamps(dbm)
        details = G.new_object('temple_details', dbm)
        drop_hidden_bottoms(details)
        scrolls = build_scrolls()
        chests = build_chests()
        architects = build_architects()
        pyramid = build_pyramid()
        lilies = build_lilies()
        reeds = build_pool_papyrus()
        dressing, court_lamps = build_dressing()
        pyramid_set = pyramid + [pool, water] + lilies + reeds
        exported = ([walls, ext, section, floor, base] + columns + screens + door + entab
                    + wings + obelisks + tables + [props, mats, details] + lamps + scrolls + chests
                    + architects + [dressing] + pyramid_set)
        by_name = {o.name: o for o in exported}
        apply_reliefs(by_name)
        apply_stars(by_name)
        for o in exported:
            G.set_uv0(o, temple_uv)
        bake_only = build_bake_only()
    names = [o.name for o in exported]
    assert len(set(names)) == len(names), 'duplicate node names'
    pyramid_names = {o.name for o in pyramid_set}
    STATS['tris_total'] = sum(G.tri_count(o) for o in exported if o not in pyramid_set)
    STATS['tris_pyramid_glb'] = sum(G.tri_count(o) for o in pyramid_set)
    STATS['tris'] = {o.name: G.tri_count(o) for o in exported if G.tri_count(o) > 1500}
    print('[stats] tris hall', STATS['tris_total'], 'pyramid', STATS['tris_pyramid_glb'], flush=True)
    with C.timed('lightmap UV unwrap + pack (UVLightmap)'):
        BH.lightmap_uvs(exported, lm_weight)

    scene.cycles.samples = LM_SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 1
    scene.cycles.sample_clamp_indirect = 2.0
    scene.cycles.transmission_bounces = 0
    main_names = [o.name for o in exported if o is not section]
    baked, names = BH.join_for_bake([o for o in exported if o is not section])
    main_objs = [baked]
    cut_away = [bpy.data.objects['BAKE_ONLY_south_wall']]
    sun = BH.make_sun(sun_dir(), SUN_STRENGTH, SUN_COLOR)
    lamp_lights = BH.make_lamps(practicals + court_lamps, LAMP_POWER, LAMP_COLOR)

    def two_part(passes, label):
        a = BH.bake(main_objs, passes, label, LM_SIZE)
        for o in cut_away:
            o.hide_render = True
        b = BH.bake([section], passes, label + '_section', LM_SIZE)
        for o in cut_away:
            o.hide_render = False
        return a, b

    def lights(sun_on, lamps_on):
        sun.hide_render = not sun_on
        for o in lamp_lights:
            o.hide_render = not lamps_on

    passes = {}
    if not NO_BAKE:
        scene.cycles.samples = 1
        nrm01 = BH.bake(main_objs, None, 'normals', LM_SIZE, 'NORMAL')
        cov_main = nrm01.max(-1) > 0.004
        cov_sec = BH.bake([section], None, 'normals_section', LM_SIZE, 'NORMAL').max(-1) > 0.004
        nrm = nrm01 * 2 - 1
        scene.cycles.samples = LM_SAMPLES
        gold = BH.set_world(GOLD_SKY)
        lights(False, False)
        passes['g_sky'] = two_part({'DIRECT', 'INDIRECT'}, 'golden_sky')
        gold.inputs['Strength'].default_value = 0.0
        lights(True, False)
        passes['g_sundir'] = two_part({'DIRECT'}, 'golden_sun_direct')
        passes['g_sunind'] = two_part({'INDIRECT'}, 'golden_sun_bounce')
        dusk = BH.set_world(DUSK_SKY)
        lights(False, False)
        passes['d_sky'] = two_part({'DIRECT', 'INDIRECT'}, 'dusk_sky')
        dusk.inputs['Strength'].default_value = 0.0
        lights(False, True)
        passes['d_lamps'] = two_part({'DIRECT', 'INDIRECT'}, 'dusk_lamps')
        cov_main &= ~cov_sec
        cov = cov_main | cov_sec

        def compose(keys):
            img = np.zeros((LM_SIZE, LM_SIZE, 3))
            for k in keys:
                a, b = passes[k]
                img += np.where(cov_main[..., None], a, 0) + np.where(cov_sec[..., None], b, 0)
            return img

        golden = compose(['g_sky', 'g_sundir', 'g_sunind'])
        dusk_img = compose(['d_sky', 'd_lamps'])
        sd = passes['g_sundir'][0].max(-1)
        upf = cov_main & (nrm[..., 2] > 0.995) & (sd > 0)
        lit = sd[upf & (sd > 0.8 * sd[upf].max())]
        patch = float(np.median(lit))
        spot_intensity = math.pi * patch / math.sin(math.radians(SUN_EL)) / max(SUN_COLOR)
        STATS.update({'sun_patch_V': patch, 'spot_intensity_measured': spot_intensity})
    else:
        cov = np.ones((LM_SIZE, LM_SIZE), bool)
        golden = np.full((LM_SIZE, LM_SIZE, 3), 0.2)
        dusk_img = np.full((LM_SIZE, LM_SIZE, 3), 0.05)
        spot_intensity = SUN_STRENGTH

    lm_meta = {}
    for name, img in (('golden', golden), ('dusk', dusk_img)):
        valid = cov & (img.sum(-1) > 0)
        # golden keeps the sunlit casing's own gradient (it is the brightest thing in the court)
        pct = 99.95 if name == 'golden' else 99.0
        M = float(np.percentile(img[valid].max(-1), pct)) if valid.any() else 1.0
        enc = BH.lin_to_srgb(BH.dilate(img, cov) / M)
        # the colour law holds for light too: any texel a bounce tinted violet goes to grey
        clean = TT.scrub(enc, margin=12.0, min_sat=0.12)    # ETC1S drifts: a wide margin
        # ETC1S quantises dark blocks' chroma coarsely: the darkest bluish-violet corners go grey
        h, s, v = TT.hsv(clean)
        dark = (v < 0.34) & (h > 238) & (h < 352) & (s > 0.1)
        luma = (clean @ np.array([0.299, 0.587, 0.114]))[..., None]
        clean = np.where(dark[..., None], luma + (clean - luma) * 0.3, clean)
        STATS[f'lightmap_{name}_scrubbed'] = int((np.abs(clean - enc).max(-1) > 1e-6).sum())
        enc = clean
        TT.guard(enc, f'lightmap {name}')
        P.write_png(os.path.join(RAW, f'lightmap_{name}.png'), P.to_u8(enc))
        lm_meta[name] = {'file': f'lightmap_{name}.ktx2', 'uv': 1, 'intensity': math.pi * M,
                         'colorSpace': 'srgb'}
        STATS[f'lightmap_{name}_M'] = M
    gobo = make_gobo()

    C.remove_bake_targets(section)
    exported = BH.split_after_bake(baked, names) + [section]
    assert [o.name for o in exported[:-1]] == main_names, 'node names changed in the bake split'
    for o in bake_only:
        o.hide_render = True
    meta = {
        'note': 'Generated by assets/blender/temple.py. Positions are GLB space: metres, glTF axes '
                '(x east, y up, z south), origin at the grid NW corner (tile = 1.5 m).',
        'worldId': LAYOUT['worldId'],
        'tileMeters': T,
        'glb': 'hall.glb',
        # the Great Pyramid in the pool of Nun with its water, lilies and reeds: its own GLB, lit
        # by the hall's lightmaps (uv1)
        'centrepiece': {'glb': 'pyramid.glb'},
        'moods': {
            'golden': {'lightmap': lm_meta['golden'],
                       'sun': {'color': list(SUN_COLOR), 'intensity': spot_intensity,
                               'penumbra': 0.02, **gobo, 'gobo': 'gobo_sun.png'}},
            'dusk': {'lightmap': lm_meta['dusk'], 'sun': None},
        },
        'practicals': [{'id': p['id'], 'position': [round(float(v), 4) for v in p['position']],
                        'color': list(LAMP_COLOR), 'intensity': LAMP_POWER / (4 * math.pi),
                        'distance': LAMP_RANGE, **({'seatUid': p['seatUid']} if 'seatUid' in p
                                                   else {})}
                       for p in practicals],
    }
    with open(os.path.join(OUT, 'hall.meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')
    for name in ('flame', 'gold', 'title'):
        bpy.data.materials[name].node_tree.nodes['Principled BSDF'].inputs[
            'Emission Strength'].default_value = 1.0
    hall_objs = [o for o in exported if o.name not in pyramid_names]
    pyr_objs = [o for o in exported if o.name in pyramid_names]
    with C.timed('export GLBs'):
        STATS['glb_raw_bytes'] = BH.export_glb(hall_objs, os.path.join(RAW, 'hall.raw.glb'))
        STATS['pyramid_raw_bytes'] = BH.export_glb(pyr_objs, os.path.join(RAW, 'pyramid.raw.glb'),
                                                   extras=True)
    STATS['total_s'] = round(time.perf_counter() - t0, 1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(RAW, 'temple.blend'))
    C.TIMINGS.update(STATS)
    with open(os.path.join(RAW, 'timings_temple.json'), 'w') as f:
        json.dump(C.TIMINGS, f, indent=2)
    print('[stats]', json.dumps(STATS, indent=1), flush=True)


main()
