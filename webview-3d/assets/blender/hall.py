# House of Wisdom (Baghdad, 9th century): the hero hall, generated from layout.json in headless
# Blender, lightmapped for two moods (golden afternoon, lantern-lit dusk) and exported as GLB.
#
#   Blender -b --factory-startup --python-exit-code 1 --python assets/blender/hall.py [-- --quick]
#
# Run trim_bake.py first (shared trim sheets in assets/out/tex). Writes, under
# assets/worlds/house-of-wisdom/out/:
#   raw/hall.raw.glb                     the GLB before optimize.mjs (never committed)
#   raw/lightmap_{golden,dusk}.png       8-bit sRGB lightmaps before KTX2 (never committed)
#   gobo_west.png                        the west grille's sun gobo (committed)
#   hall.meta.json                       light rig + lightmap calibration (committed)
# Coordinates in the meta are GLB space: metres, glTF axes (x east, y up, z south), origin at
# the grid's north-west corner, so tile (col, row) spans x in [1.5 col, 1.5 col + 1.5].
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

import armillary_spec as AS  # noqa: E402
import bl_common as C  # noqa: E402
import chamber_art as CA  # noqa: E402
import hall_chambers as HC  # noqa: E402
import hall_dressing as HD  # noqa: E402
import hall_geom as G  # noqa: E402
import hall_textures as HT  # noqa: E402
import patterns as P  # noqa: E402
from hall_geom import B, MI, bevelled, box  # noqa: E402

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
QUICK = '--quick' in ARGS          # low samples + 1024 lightmap, for geometry iteration
NO_BAKE = '--no-bake' in ARGS      # flat lightmaps, for layout checks only

WORLD = C.WORLD_DIR
OUT = os.path.join(WORLD, 'out')
RAW = os.path.join(OUT, 'raw')
os.makedirs(RAW, exist_ok=True)
with open(os.path.join(WORLD, 'layout.json')) as f:
    LAYOUT = json.load(f)
T = LAYOUT['tileMeters']
STATS = {}

# ---------------------------------------------------------------- architecture (plan metres)
XI0, XI1 = T, (LAYOUT['cols'] - 1) * T          # inner faces of the west / east walls
ZI0, ZI1 = T, (LAYOUT['rows'] - 1) * T          # inner faces of the north / south walls
WALL_T = 1.0
XO0, XO1, ZO0, ZO1 = XI0 - WALL_T, XI1 + WALL_T, ZI0 - WALL_T, ZI1 + WALL_T
WALL_H = 7.0
# Wall elevation (inner faces): baked-brick base, framed lustre-tile dado panels, lime plaster,
# a carved glazed arabesque frieze directly under the coping. Samarra bevelled stucco fills the
# alcoves' iwan backs and the north arcade's spandrels.
DADO = 1.0                                      # top of the baked-brick base
PANEL_TOP = DADO + P.DADO_H                     # framed tile panels above it (2.125 m)
UPPER_BAND = (WALL_H - 0.16 - P.FRIEZE_H, WALL_H - 0.16)   # the frieze, under the coping
SOUTH_CUT = DADO                                # diorama cutaway: the south wall stops here
PIER = 0.70                                     # pier and arcade thickness
N_ARC = dict(line=3 * T, spring=2.6, dr=0.15, top=6.6, frieze=(5.85, 6.35),
             portal_spring=4.55, portal_dr=0.3)
# The south range has no arcade (Yousef, 2026-10-12: its cut stubs read as meaningless at the
# front of the diorama). Its line still bounds the south alcoves' brick paving and rugs.
S_ARC = dict(line=11 * T)
PISHTAQ = dict(x0=12.6, x1=17.4, top=7.68, proud=0.15, panel=(12.95, 17.05, 6.38, 7.48))   # 4.1 m: the wide, landscape inscription
WIN = dict(cz=10.2, half=0.6, sill=1.6, spring=2.85, dr=0.3)        # west grille, inner aperture
WIN_OUT = dict(cz=10.5, half=0.95, sill=1.55, spring=3.45, dr=0.3)  # outer aperture (splayed)
WIN_IN = dict(cz=10.35, half=0.92, sill=1.55, spring=3.3, dr=0.3)     # inner aperture (splayed into the hall)
PORTAL_IWAN_HALF = 0.82                         # the portal bay's iwan back (no board): 1.64 m wide
WIN_WAIST = (0.30, 0.40)                        # straight waist: depth range from the inner face (m)
GRILLE_W = (0.32, 0.345)                        # grille slab depth from the inner face (m), inside the waist


def win_params(w):
    """Window aperture at depth w (m) into the wall: double splay, narrowest (WIN) along the waist."""
    a, b = WIN_WAIST
    if w < a:
        k, lo, hi = (a - w) / a, WIN, WIN_IN
    elif w <= b:
        return dict(WIN)
    else:
        k, lo, hi = (w - b) / (WALL_T - b), WIN, WIN_OUT
    return {key: lo[key] * (1 - k) + hi[key] * k for key in ('cz', 'half', 'sill', 'spring', 'dr')}
LAMP_SILL = 1.0                                 # alcove lamps: niche sill / wall top
EMBER_BASE, EMBER_GLOW = (104, 38, 20), (255, 118, 44)   # furnace embers (sRGB)

# ---------------------------------------------------------------- lighting
SUN_EL, SUN_AZ = 27.0, 22.5      # elevation; azimuth of the sun south of due west (WSW)
SUN_STRENGTH = 5.0
SUN_COLOR = (1.0, 0.70, 0.42)
# Sky kept low against the sun (spike finding: a strong sky made the upper walls flat and hot)
GOLD_SKY = dict(zenith=(0.36, 0.50, 0.85), horizon=(1.0, 0.80, 0.60), ground=(0.30, 0.25, 0.20),
                strength=0.18)
DUSK_SKY = dict(zenith=(0.03, 0.07, 0.34), horizon=(0.08, 0.11, 0.33), ground=(0.02, 0.02, 0.05),
                strength=1.0)
LAMP_COLOR = (1.0, 0.58, 0.28)
LAMP_POWER = 16.0                # W per alcove / desk lamp (Blender); three cd = P / (4 pi)
LAMP_RANGE = 6.0                 # three.js PointLight.distance for the live counterpart
LM_SIZE = 1024 if QUICK else 2048
LM_SAMPLES = 32 if QUICK else 512


def sun_dir():
    """Direction the sunlight travels, plan coords: towards east-north-east and down."""
    el, az = math.radians(SUN_EL), math.radians(SUN_AZ)
    return np.array([math.cos(el) * math.cos(az), -math.sin(el), -math.cos(el) * math.sin(az)])


# ---------------------------------------------------------------- layout helpers
SEATS = {s['uid']: s for s in LAYOUT['seats']}
FURN = {f['uid']: f for f in LAYOUT['furniture']}
STEP = {'UP': (0, -1), 'DOWN': (0, 1), 'LEFT': (-1, 0), 'RIGHT': (1, 0)}


def tile_centre(col, row):
    return ((col + 0.5) * T, (row + 0.5) * T)


def alcove_seats(side):
    return [s for s in LAYOUT['seats'] if s['uid'].startswith(f'alcove-{side}-')]


def arcade_piers():
    """Pier lines (tile x) for both arcades: each alcove bay is centred on its 2-tile desk,
    so piers land on tile corners that are never a seat corner."""
    desks = sorted(f['col'] for f in LAYOUT['furniture']
                   if f['uid'].startswith('alcove-n-') and f['isDesk'])
    edges = sorted({c - 1 for c in desks} | {c + 3 for c in desks})
    seat_corners = {(s['col'] + dc) for s in LAYOUT['seats'] for dc in (0, 1)
                    if s['uid'].startswith('alcove-')}
    piers = [e for e in edges if 1 < e < LAYOUT['cols'] - 1]
    assert not set(piers) & seat_corners, 'a pier would stand on a seat corner'
    return [1] + piers + [LAYOUT['cols'] - 1]


# ---------------------------------------------------------------- materials
def gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g is None:
        g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g


def load_img(name, data):
    path = os.path.join(C.TEX, name)
    if not os.path.exists(path):
        raise SystemExit(f'missing trim {path}: run trim_bake.py first (npm run assets:bake)')
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return img


def srgb_lin(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    return tuple(float(x) for x in np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4))


def make_material(name, base=None, color=(0.8, 0.8, 0.8), normal=None, ao=None, rough=0.85,
                  metal=0.0, emission=None, double=False):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True  # deprecated in 5.x but still creates the tree
    nt, L = m.node_tree, m.node_tree.links
    bsdf = nt.nodes.get('Principled BSDF')
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'UVMap'
    if base:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(base, False)
        L.new(uvn.outputs['UV'], t.inputs['Vector'])
        L.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
    if normal:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(normal, True)
        L.new(uvn.outputs['UV'], t.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.uv_map = 'UVMap'
        L.new(t.outputs['Color'], nm.inputs['Color'])
        L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    if ao:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(ao, True)
        L.new(uvn.outputs['UV'], t.inputs['Vector'])
        sep = nt.nodes.new('ShaderNodeSeparateColor')
        grp = nt.nodes.new('ShaderNodeGroup')
        grp.node_tree = gltf_output_group()
        L.new(t.outputs['Color'], sep.inputs['Color'])
        L.new(sep.outputs['Red'], grp.inputs['Occlusion'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.0  # off for the bakes
    m.use_backface_culling = not double
    return m


EMBER_EXPORT = 0.75         # the furnace mouth's ember glow in the export (no real-time light)
EMBER_DUSK_BAKE = 3.0       # and its faint warm spill, baked into the dusk lamps pass


def build_materials():
    HT.write_all(C.TEX)
    HD.write_textures(C.TEX, STATS)
    CA.write(C.TEX, STATS)
    # the colour law at 40 degrees for everything the themed chambers add
    CA.assert_colour_law(np.array([HT.SWATCHES[k] for k in HT.CHAMBER_SWATCHES]) / 255.0,
                         'chamber prop swatches')
    CA.assert_colour_law(np.array([EMBER_BASE, EMBER_GLOW]) / 255.0, 'ember')
    # the colour law (rule 4: saturation >= 0.35 within 25 degrees) over the whole palette
    assert P.cobalt_clash(np.array(list(HT.SWATCHES.values())) / 255.0, min_sat=0.35) == 0.0, \
        'palette swatch within 25 deg of cobalt'
    mats = {
        'brick': make_material('brick', 'brick_basecolor.png', normal='brick_normal.png',
                               ao='brick_ao.png', rough=0.9),
        'stucco': make_material('stucco', 'stucco_basecolor.png', normal='stucco_normal.png',
                                ao='stucco_ao.png', rough=0.8),
        'plaster': make_material('plaster', 'plaster_basecolor.png', normal='plaster_normal.png',
                                 rough=0.88),
        'starfloor': make_material('starfloor', 'starfloor_basecolor.png',
                                   normal='starfloor_normal.png', rough=0.72),
        'brickfloor': make_material('brickfloor', 'brickfloor_basecolor.png',
                                    normal='brickfloor_normal.png', rough=0.85),
        'cedar': make_material('cedar', 'hallcedar_basecolor.png', rough=0.55),
        'marble': make_material('marble', 'marble_basecolor.png', rough=0.35),
        'rug': make_material('rug', 'rug_basecolor.png', rough=0.95),
        'props': make_material('props', 'palette_basecolor.png', rough=0.7),
        'palm': make_material('palm', 'palette_basecolor.png', rough=0.75, double=True),
        'lamp': make_material('lamp', color=srgb_lin((222, 206, 172)), rough=0.3,
                              emission=srgb_lin((255, 190, 120))),
        'flame': make_material('flame', color=srgb_lin((255, 214, 150)), rough=1.0,
                               emission=srgb_lin((255, 170, 80))),
        'notice_board_mat': make_material('notice_board_mat', color=srgb_lin((226, 214, 186)),
                                          rough=0.9),
        'base': make_material('base', color=srgb_lin((58, 38, 26)), rough=0.45),
        # wall dressing (Task 2b): lustre-tile dado panels, glazed arabesque frieze, Samarra field
        # the J. Servo mark on parchment: lit by the lightmap like any wall, never emissive
        'logo_panel_mat': make_material('logo_panel_mat', 'logo_panel_basecolor.png', rough=0.82),
        # lustre-glazed jars and their shrubs (double-sided for the leaves and blossoms); never
        # the palm material, which the runtime's palm sway owns
        'planter_mat': make_material('planter_mat', 'planter_basecolor.png', rough=0.4,
                                     double=True),
        'dado': make_material('dado', 'dado_basecolor.png', normal='dado_normal.png',
                              ao='dado_ao.png', rough=0.6),
        'frieze': make_material('frieze', 'frieze_basecolor.png', normal='frieze_normal.png',
                                rough=0.45),     # glazed tile: no AO, lightmap-lit, never emissive
        'samarra': make_material('samarra', 'samarra_basecolor.png', normal='samarra_normal.png',
                                 ao='samarra_ao.png', rough=0.8),
        # the themed north chambers (Yousef, 2026-10-15): wall art atlas, vessel glass, embers
        'chamber_art': make_material('chamber_art', 'chamber_art_basecolor.png', rough=0.9),
        'glass': make_material('glass', 'palette_basecolor.png', rough=0.18),
        'ember': make_material('ember', color=srgb_lin(EMBER_BASE), rough=0.9,
                               emission=srgb_lin(EMBER_GLOW)),
    }
    assert list(mats) == G.MATS
    return mats


# ---------------------------------------------------------------- material zone rules
def band_of(y):
    for lo, hi in (UPPER_BAND, N_ARC['frieze']):
        if lo - 1e-3 <= y <= hi + 1e-3:
            return lo
    return None


def wall_rule(inner_axis, inner_sign):
    """Material for faces of an outer wall solid; the inner face has normal inner_sign on axis."""
    def rule(f, c, n):
        x, y, z = c
        if abs(n[1]) > 0.9:
            f.material_index = MI['plaster']
            return
        inward = n[inner_axis] * inner_sign > 0.9
        if not inward:
            f.material_index = MI['brick']
        elif y < DADO:
            f.material_index = MI['brick']
        elif y < PANEL_TOP:
            f.material_index = MI['dado']
        elif UPPER_BAND[0] < y < UPPER_BAND[1]:
            f.material_index = MI['frieze']
        else:
            f.material_index = MI['plaster']
    return rule


def arcade_rule(arc, courtyard_sign, face_axis):
    """Piers in brick to the springing, plaster arch soffits; facing the courtyard, Samarra
    stucco spandrels and the glazed arabesque frieze. face_axis: 2 for east-west arcades (faces along
    z), 0 for transverse walls."""
    def rule(f, c, n):
        x, y, z = c
        if n[1] < -0.2 or n[1] > 0.9:
            f.material_index = MI['plaster']
        elif y < arc['spring']:
            f.material_index = MI['brick']
        elif (arc['frieze'] and face_axis == 2 and n[2] * courtyard_sign > 0.9
              and arc['frieze'][0] < y < arc['frieze'][1]):
            f.material_index = MI['frieze']
        elif (arc['frieze'] and face_axis == 2 and n[2] * courtyard_sign > 0.9
              and y < arc['frieze'][0]):
            f.material_index = MI['samarra']
        else:
            f.material_index = MI['plaster']
    return rule


def assign(ob, rule):
    G.faces_where(ob, lambda c, n, f: True, rule)


# ---------------------------------------------------------------- architecture builders
def solid(name, build):
    bm = bmesh.new()
    build(bm)
    return G.new_object(name, bm)


def outer_walls():
    pieces = []
    # north, west, east at full height; overlapping corners so the union is clean
    specs = [
        ('wall_n', (XO0, XO1, 0, WALL_H, ZO0, ZI0), 2, +1),
        ('wall_w', (XO0, XI0, 0, WALL_H, ZI0 - 0.1, ZO1), 0, +1),
        ('wall_e', (XI1, XO1, 0, WALL_H, ZI0 - 0.1, ZO1), 0, -1),
    ]
    for name, (x0, x1, y0, y1, z0, z1), axis, sign in specs:
        ob = solid(name, lambda bm, a=(x0, x1, y0, y1, z0, z1): box(bm, *a))
        G.bisect(ob, ys=(DADO, PANEL_TOP, *UPPER_BAND))
        assign(ob, wall_rule(axis, sign))
        pieces.append(ob)
    # south: cut at dado height, with the entrance on the hall's axis
    gap = (13.85, 16.15)
    for name, (x0, x1) in (('wall_s0', (XO0, gap[0])), ('wall_s1', (gap[1], XO1))):
        ob = solid(name, lambda bm, a=(x0, x1): box(bm, a[0], a[1], 0, SOUTH_CUT, ZI1, ZO1))
        assign(ob, wall_rule(2, -1))
        pieces.append(ob)
    # copings: a projecting lip on top of the full-height walls, cast as one shadow line
    lip = 0.07
    for name, a in (('cope_n', (XO0, XO1, WALL_H - 0.16, WALL_H, ZO0, ZI0 + lip)),
                    ('cope_w', (XO0, XI0 + lip, WALL_H - 0.16, WALL_H, ZI0, ZO1)),
                    ('cope_e', (XI1 - lip, XO1, WALL_H - 0.16, WALL_H, ZI0, ZO1))):
        ob = solid(name, lambda bm, a=a: box(bm, *a))
        assign(ob, lambda f, c, n: setattr(f, 'material_index', MI['plaster']))
        pieces.append(ob)
    return pieces


def arcade(arc, courtyard_sign, name):
    piers = [p * T for p in arcade_piers()]
    openings = []
    for a, b in zip(piers[:-1], piers[1:]):
        lo, hi = a + PIER / 2, b - PIER / 2
        portal = abs((a + b) / 2 - LAYOUT['cols'] * T / 2) < 0.01
        spring = arc['portal_spring'] if portal else arc['spring']
        dr = arc['portal_dr'] if portal else arc['dr']
        openings.append(((lo + hi) / 2, (hi - lo) / 2, spring, dr))
    outline = G.arcade_outline(XI0 - 0.3, XI1 + 0.3, arc['top'], openings, n=18)
    z0, z1 = arc['line'] - PIER / 2, arc['line'] + PIER / 2
    ob = solid(name, lambda bm: G.extrude_profile(bm, outline, 'z', z0, z1))
    ys = [arc['spring'], arc['portal_spring']] + (list(arc['frieze']) if arc['frieze'] else [])
    G.bisect(ob, ys=ys)
    assign(ob, arcade_rule(arc, courtyard_sign, 2))
    STATS[f'{name}_openings'] = [(round(o[0], 2), round(2 * o[1], 2),
                                  round(G.arch_crown(o[1], o[2], o[3]), 2)) for o in openings]
    return ob, openings


def transverse_walls(arc, wall_z, name):
    """Transverse arches from each pier back to the outer wall (north range only)."""
    out = []
    sign = 1 if wall_z < arc['line'] else -1
    z_wall_face = wall_z
    z_arc_face = arc['line'] - sign * PIER / 2
    lo, hi = sorted((z_wall_face + sign * PIER / 2, z_arc_face))
    opening = [((lo + hi) / 2, (hi - lo) / 2, arc['spring'], 0.3)]
    u0, u1 = sorted((wall_z - sign * 0.25, arc['line']))
    outline = G.arcade_outline(u0, u1, arc['top'], opening, n=14)
    for p in arcade_piers()[1:-1]:
        x = p * T
        ob = solid(f'{name}_{p}', lambda bm, x=x: G.extrude_profile(bm, outline, 'x',
                                                                   x - PIER / 2, x + PIER / 2))
        G.bisect(ob, ys=[arc['spring']])
        assign(ob, arcade_rule(arc, 0, 0))
        out.append(ob)
    return out


def pishtaq():
    """The portal frame on the north arcade's axis, rising above it, with the inscription
    panel over the portal arch."""
    p = PISHTAQ
    z0 = N_ARC['line'] + PIER / 2 - 0.05
    z1 = N_ARC['line'] + PIER / 2 + p['proud']
    ob = solid('pishtaq', lambda bm: box(bm, p['x0'], p['x1'], 0, p['top'], z0, z1))
    assign(ob, lambda f, c, n: setattr(f, 'material_index', MI['plaster']))
    # portal opening through the frame: the same arch as the arcade's central bay, framed
    piers = [x * T for x in arcade_piers()]
    mid = LAYOUT['cols'] * T / 2
    a = max(x for x in piers if x < mid) + PIER / 2
    b = min(x for x in piers if x > mid) - PIER / 2
    half = (b - a) / 2
    outline = G.arch_outline_closed(mid, half, -0.2, N_ARC['portal_spring'], N_ARC['portal_dr'], 18)
    cut = solid('pishtaq_cut', lambda bm: G.extrude_profile(bm, outline, 'z', z0 - 0.2, z1 + 0.2))
    # a raised archivolt: a second, larger arch ring standing proud of the frame
    ring_o = G.arch_outline_closed(mid, half + 0.22, 0.0, N_ARC['portal_spring'], 0.3, 18)
    ring = solid('archivolt', lambda bm: G.extrude_profile(bm, ring_o, 'z', z1 - 0.02, z1 + 0.06))
    assign(ring, lambda f, c, n: setattr(f, 'material_index', MI['samarra']))
    G.union(ob, [ring])
    # inscription panel: recessed field in the kufic ground colour
    x0, x1, y0, y1 = p['panel']
    panel = solid('panel_cut', lambda bm: _painted_box(bm, (x0, x1, y0, y1, z1 - 0.04, z1 + 0.3),
                                                      'kufic_ground'))
    G.difference(ob, [cut, panel])
    return ob


def _painted_box(bm, a, swatch, mat='props'):
    faces = box(bm, *a, mat=mat)
    G.paint(bm, faces, HT.palette_uv()[swatch])
    return faces


def arch_cutter(name, axis, plane, depth_in, cx, half, sill, spring, dr, mat='plaster',
                inward=+1):
    """Prism cutting an arched opening/recess into a wall face. axis 'x': the wall face is the
    plane x = plane (u = z); axis 'z': z = plane (u = x). inward: +1 if the wall body lies on
    the positive side of the plane."""
    outline = G.arch_outline_closed(cx, half, sill, spring, dr, 16)
    a0 = plane - inward * 0.3
    a1 = plane + inward * depth_in
    lo, hi = sorted((a0, a1))
    ob = solid(name, lambda bm: G.extrude_profile(bm, outline, axis, lo, hi))
    assign(ob, lambda f, c, n: setattr(f, 'material_index', MI[mat]))
    return ob


def window_cutter():
    """Double-splayed west window: a narrow straight waist inside the wall, widening to both faces."""
    def ring(x, prm):
        return [(x, y, u) for u, y in G.arch_outline_closed(prm['cz'], prm['half'], prm['sill'],
                                                             prm['spring'], prm['dr'], 16)]
    rings = [ring(XI0 + 0.2, WIN_IN), ring(XI0, WIN_IN), ring(XI0 - WIN_WAIST[0], WIN),
             ring(XI0 - WIN_WAIST[1], WIN), ring(XO0, WIN_OUT), ring(XO0 - 0.2, WIN_OUT)]
    ob = solid('window_cut', lambda bm: G.loft(bm, rings))
    assign(ob, lambda f, c, n: setattr(f, 'material_index', MI['plaster']))
    return ob


def build_architecture():
    parts = outer_walls()
    n_arc, _ = arcade(N_ARC, +1, 'arcade_n')
    parts += [n_arc, pishtaq()]
    parts += transverse_walls(N_ARC, ZI0, 'transverse_n')
    hall = parts[0]
    hall.name = 'hall_walls'
    G.union(hall, parts[1:])

    cutters = [window_cutter()]
    # arched recesses behind the shelves on the east and west walls
    for f in LAYOUT['furniture']:
        if f['type'] != 'hw_shelf':
            continue
        cz = (f['row'] + f['footprintH'] / 2) * T
        west = f['col'] * T < XI1 / 2
        cutters.append(arch_cutter(f'shelf_recess_{f["uid"]}', 'x', XI0 if west else XI1, 0.12,
                                   cz, 1.42, -0.05, 2.75, 0.3, inward=-1 if west else +1))
    # north range: a blind iwan arch at the back of each alcove bay, and a lamp niche
    piers = [p * T for p in arcade_piers()]
    mid = LAYOUT['cols'] * T / 2
    for a, b in zip(piers[:-1], piers[1:]):
        cx = (a + b) / 2
        if abs(cx - mid) < 0.01:
            # the portal bay: the notice board's wall when there is one; without it (the House
            # of Wisdom for now) the bay gets the same Samarra iwan back as the alcoves, narrower
            if not LAYOUT.get('board'):
                cutters.append(arch_cutter('iwan_portal', 'z', ZI0, 0.12, cx, PORTAL_IWAN_HALF,
                                           PANEL_TOP, 3.3, 0.3, mat='samarra', inward=-1))
            continue
        cutters.append(arch_cutter(f'iwan_{a:.1f}', 'z', ZI0, 0.12, cx, 1.55, PANEL_TOP, 3.35, 0.3,
                                   mat='samarra', inward=-1))
    for s in alcove_seats('n'):
        x, _ = tile_centre(s['col'], s['row'])
        cutters.append(arch_cutter(f'niche_{s["uid"]}', 'z', ZI0, 0.28, x, 0.2, LAMP_SILL,
                                   LAMP_SILL + 0.42, 0.3, mat='samarra', inward=-1))
    G.difference(hall, cutters)
    # patterned niche backs: only faces looking into the alcoves (or the courtyard) keep the
    # Samarra stucco; reveals, soffits and ring edges are plain plaster
    G.faces_where(hall, lambda c, n, f: f.material_index == MI['samarra'] and n[2] < 0.9,
                  lambda f, c, n: setattr(f, 'material_index', MI['plaster']))
    # drop faces nobody can see: undersides at floor level
    G.faces_where(hall, lambda c, n, f: n[1] < -0.9 and c[1] < 0.01, 'delete')
    STATS['north_arcade_openings'] = STATS.pop('arcade_n_openings')
    return hall


def split_hall(hall):
    """Outer faces nobody sees from the default camera get a smaller lightmap share; the south
    wall's cut top is baked separately (as if open to the sky)."""
    def exterior(c, n, f):
        x, y, z = c
        return ((n[2] < -0.9 and z < ZO0 + 0.01) or (n[0] < -0.9 and x < XO0 + 0.01)
                or (n[0] > 0.9 and x > XO1 - 0.01))
    ext = G.split_off(hall, exterior, 'hall_exterior')
    def cut_face(c, n, f):
        if n[1] < 0.9:
            return False
        return abs(c[1] - SOUTH_CUT) < 0.01 and c[2] > ZI1 - 0.01
    section = G.split_off(hall, cut_face, 'hall_section')
    return ext, section


# ---------------------------------------------------------------- details
def build_details():
    """Marble pier bases and imposts, the west grille, the Kufic inscription."""
    bm = bmesh.new()
    piers = [p * T for p in arcade_piers()]
    w = 0.42
    for arc in (N_ARC,):
        for i, x in enumerate(piers):
            x0, x1 = x - w, x + w
            if i == 0:
                x0 = XI0
            if i == len(piers) - 1:
                x1 = XI1
            box(bm, x0, x1, 0, 0.22, arc['line'] - w, arc['line'] + w, mat='marble')
            box(bm, x0, x1, arc['spring'] - 0.14, arc['spring'], arc['line'] - w,
                arc['line'] + w, mat='marble')
    # threshold of the south entrance
    box(bm, 13.85, 16.15, 0, 0.04, ZI1 - 0.05, ZO1 + 0.05, mat='marble')
    ob = G.new_object('hall_details', bm)
    G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < 0.01, 'delete')
    grille = build_grille()
    z_face = N_ARC['line'] + PIER / 2 + PISHTAQ['proud'] - 0.04       # the recessed panel ground
    letters = HD.build_kufic(PISHTAQ['panel'], z_face, STATS)
    return [ob, grille, letters]


def build_grille():
    """Pierced stucco grille: interlaced circles (Umayyad/Abbasid), cut by marching squares on
    the same field that drives the gobo."""
    cz, half, sill, spring = WIN['cz'], WIN['half'], WIN['sill'], WIN['spring']
    us = np.arange(cz - half - 0.02, cz + half + 0.02, 0.0015)
    vs = np.arange(sill - 0.02, sill + half * 2.4, 0.0015)
    U, V = np.meshgrid(us, vs)
    f = P.grille_open(U, V, cz, half, sill, spring)
    loops = P.marching_squares(f, us, vs)
    holes = []
    for lp in loops:
        s = P.simplify_loop(lp, 0.0006)
        a = np.asarray(s)
        area = 0.5 * abs(np.dot(a[:, 0], np.roll(a[:, 1], 1)) - np.dot(a[:, 1], np.roll(a[:, 0], 1)))
        if area > 1.5e-4 and len(s) >= 4:
            holes.append([tuple(p) for p in s])
    outer = [tuple(p) for p in P.arch_outline(cz, half + 0.004, sill - 0.004, spring, n_arc=40)]
    polys = [outer] + holes
    flat = [p for poly in polys for p in poly]
    tris = mathutils.geometry.tessellate_polygon(
        [[mathutils.Vector((u, v, 0)) for u, v in poly] for poly in polys])
    bm = bmesh.new()
    xa, xb = XI0 - GRILLE_W[0], XI0 - GRILLE_W[1]
    front = [bm.verts.new(B(xa, v, u)) for u, v in flat]
    back = [bm.verts.new(B(xb, v, u)) for u, v in flat]
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
    for fc in bm.faces:
        fc.material_index = MI['plaster']
    ob = G.new_object('grille_west', bm)
    ob.data.shade_smooth()
    ob.data.set_sharp_from_angle(angle=math.radians(35))
    STATS['grille_holes'] = len(holes)
    return ob


# ---------------------------------------------------------------- floors and base
def build_floors():
    out = []
    for name, mat, zs in (('floor_court', 'starfloor', [(N_ARC['line'], S_ARC['line'])]),
                          ('floor_alcoves', 'brickfloor', [(ZI0, N_ARC['line']),
                                                           (S_ARC['line'], ZI1)])):
        bm = bmesh.new()
        for z0, z1 in zs:
            vs = [bm.verts.new(B(x, 0.0, z)) for x, z in ((XI0, z1), (XI1, z1), (XI1, z0),
                                                           (XI0, z0))]
            f = bm.faces.new(vs)
            f.material_index = MI[mat]
        bm.normal_update()
        for f in bm.faces:
            if f.normal.z < 0:
                f.normal_flip()
        out.append(G.new_object(name, bm))
    return out


def build_rugs():
    bm = bmesh.new()
    layer = bm.loops.layers.uv.new('UVMap')
    rugs = []
    piers = [p * T for p in arcade_piers()]
    for side, arc, z_wall in (('n', N_ARC, ZI0), ('s', S_ARC, ZI1)):
        for s in alcove_seats(side):
            sx, _ = tile_centre(s['col'], s['row'])
            bay = [(a, b) for a, b in zip(piers[:-1], piers[1:]) if a < sx < b][0]
            cx = (bay[0] + bay[1]) / 2
            z0, z1 = sorted((z_wall + (0.25 if side == 'n' else -0.25),
                             arc['line'] - (0.55 if side == 'n' else -0.55)))
            rugs.append((cx - 1.15, cx + 1.15, z0, z1))
    for f in LAYOUT['furniture']:
        if f['uid'].startswith('court-') and f['isDesk']:
            x0, x1 = f['col'] * T + 0.1, (f['col'] + f['footprintW']) * T - 0.1
            rugs.append((x0, x1, f['row'] * T + 0.45, (f['row'] + 2) * T - 0.25))
    for x0, x1, z0, z1 in rugs:
        long_x = (x1 - x0) > (z1 - z0)
        faces = box(bm, x0, x1, 0.0, 0.012, z0, z1, mat='rug')
        for fc in faces:
            for loop in fc.loops:
                x, y, z = G.plan(loop.vert.co)
                u, v = (x - x0) / (x1 - x0), (z - z0) / (z1 - z0)
                loop[layer].uv = (v, u) if long_x else (u, v)
    ob = G.new_object('floor_rugs', bm)
    G.faces_where(ob, lambda c, n, f: n[1] < -0.9, 'delete')
    return ob


def build_base():
    """The museum diorama's plinth: dark wood with a moulded lip, a brick terrace on top."""
    bm = bmesh.new()
    m = 0.45
    W, D = LAYOUT['cols'] * T, LAYOUT['rows'] * T
    box(bm, -m, W + m, -0.75, 0.0, -m, D + m, mat='base')
    ob = G.new_object('diorama_base', bm)
    hole = solid('base_hole', lambda bm: box(bm, XO0 + 0.1, XO1 - 0.1, -1.0, 0.2, ZO0 + 0.1,
                                             ZO1 - 0.1))
    G.difference(ob, [hole])
    lip = solid('base_lip', lambda bm: box(bm, -m - 0.06, W + m + 0.06, -0.12, -0.04,
                                           -m - 0.06, D + m + 0.06, mat='base'))
    G.union(ob, [lip])

    def rule(f, c, n):
        f.material_index = MI['brickfloor'] if (n[1] > 0.9 and c[1] > -0.01) else MI['base']
    assign(ob, rule)
    G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < -0.7, 'delete')
    return ob


# ---------------------------------------------------------------- east wall: the logo panel
def build_logo():
    """The J. Servo panel on the east wall, the west grille's counterpart: centred between the
    two east shelf recesses, just above the tile dado, facing the courtyard and the afternoon
    sun."""
    east = sorted((f for f in LAYOUT['furniture']
                   if f['type'] == 'hw_shelf' and f['col'] * T > XI1 / 2), key=lambda f: f['row'])
    cz = ((east[0]['row'] + east[0]['footprintH']) + east[1]['row']) / 2 * T
    cy = PANEL_TOP + 0.37 + HD.LOGO_FRAME + HD.LOGO_FIELD_M[1] / 2     # well clear of the tile dado
    STATS['logo_centre'] = [XI1, round(cy, 3), cz]
    return HD.build_logo_panel(XI1, cz, cy, inward=-1)


def is_front_palm(f):
    """The two palms nearest the default camera (the south pair) give way to planters."""
    return f['row'] >= LAYOUT['rows'] / 2


# ---------------------------------------------------------------- furniture
def desk_mesh(bm, cx, cz, w, d, h=0.34, long_axis='x'):
    """Low cedar writing desk: top, four legs, an apron and a raised back lip."""
    hw, hd = (w / 2, d / 2) if long_axis == 'x' else (d / 2, w / 2)
    box(bm, cx - hw, cx + hw, h - 0.035, h, cz - hd, cz + hd, mat='cedar')
    for sx in (-1, 1):
        for sz in (-1, 1):
            x, z = cx + sx * (hw - 0.05), cz + sz * (hd - 0.05)
            box(bm, x - 0.025, x + 0.025, 0.0, h - 0.035, z - 0.025, z + 0.025, mat='cedar')
    box(bm, cx - hw + 0.05, cx + hw - 0.05, h - 0.09, h - 0.035, cz - 0.012, cz + 0.012,
        mat='cedar')


def build_desks():
    """desk_<seatUid>: one low desk in front of every seat, on the desk tile it faces."""
    out = []
    for s in LAYOUT['seats']:
        dc, dr = STEP[s['facing']]
        col, row = s['col'] + dc, s['row'] + dr
        cx, _ = tile_centre(col, row)
        court = s['uid'].startswith('court-')
        w, d = (1.2, 0.52) if court else (1.1, 0.5)
        # pull the desk to the seat side of its tile so the scholar can reach it
        edge = (row + (1 if dr < 0 else 0)) * T
        cz = edge + (-1 if dr < 0 else 1) * (d / 2 + 0.04)
        bm = bmesh.new()
        desk_mesh(bm, cx, cz, w, d)
        ob = G.new_object(f'desk_{s["uid"]}', bm)
        bevelled(ob, 0.006)
        G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < 0.01, 'delete')
        out.append(ob)
    return out


def build_cushions():
    bm = bmesh.new()
    colours = ['cushion_madder', 'cushion_indigo', 'cushion_ochre', 'cushion_olive',
               'cushion_brown', 'cushion_ivory']
    uvs = HT.palette_uv()
    for i, s in enumerate(LAYOUT['seats']):
        cx, cz = tile_centre(s['col'], s['row'])
        faces = box(bm, cx - 0.36, cx + 0.36, 0.0, 0.10, cz - 0.36, cz + 0.36, mat='props')
        G.paint(bm, faces, uvs[colours[i % len(colours)]])
    ob = G.new_object('cushions', bm)
    bevelled(ob, 0.035, 3)
    G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < 0.01, 'delete')
    return ob


LAMP_PROFILE = [(0.0, 0.0), (0.035, 0.004), (0.05, 0.02), (0.062, 0.045), (0.058, 0.062),
                (0.04, 0.074), (0.018, 0.08), (0.016, 0.092), (0.026, 0.1), (0.0, 0.1)]


def lamp_mesh(bm, x, y, z, spout_dir):
    """A glazed oil lamp (pear body, spout) with its flame; returns the flame position."""
    G.lathe(bm, LAMP_PROFILE[1:-1], x, z, y0=y, segments=12, mat='lamp', close_top=True)
    sx, sz = spout_dir
    box(bm, x + min(0, sx * 0.1) - 0.012 * abs(sz), x + max(0, sx * 0.1) + 0.012 * abs(sz),
        y + 0.03, y + 0.052, z + min(0, sz * 0.1) - 0.012 * abs(sx),
        z + max(0, sz * 0.1) + 0.012 * abs(sx), mat='lamp')
    fx, fy, fz = x + sx * 0.1, y + 0.052, z + sz * 0.1
    G.lathe(bm, [(0.003, 0.0), (0.011, 0.012), (0.009, 0.03), (0.002, 0.05)], fx, fz, y0=fy,
            segments=6, mat='flame', close_top=True)
    return (fx, fy + 0.022, fz)


def build_lamps():
    """lamp_<seatUid> for every seat, plus the notice-board lamps. Returns objects + practicals."""
    objs, practicals = [], []
    for s in LAYOUT['seats']:
        cx, cz = tile_centre(s['col'], s['row'])
        if s['uid'].startswith('alcove-n-'):
            pos, spout = (cx, LAMP_SILL, ZI0 - 0.15), (0, 1)
        elif s['uid'].startswith('alcove-s-'):
            pos, spout = (cx, SOUTH_CUT, ZI1 + 0.22), (0, -1)
        else:
            dc, dr = STEP[s['facing']]
            row = s['row'] + dr
            side = 1 if s['uid'].endswith('-b') else -1
            desk_cz = (row + 1) * T - 0.30
            pos, spout = (cx + side * 0.42, 0.34, desk_cz - 0.13), (0, 1)
        bm = bmesh.new()
        flame = lamp_mesh(bm, *pos, spout)
        objs.append(G.new_object(f'lamp_{s["uid"]}', bm))
        practicals.append(dict(id=f'lamp_{s["uid"]}', seatUid=s['uid'], position=flame))
    # notice wall: a cedar lamp ledge under the board with two lamps lighting it
    if not LAYOUT.get('board'):
        return objs, practicals
    bx, by, bz = (v * T for v in LAYOUT['board']['position'])
    for i, dx in enumerate((-0.5, 0.5)):
        bm = bmesh.new()
        flame = lamp_mesh(bm, bx + dx, by - 0.68, ZI0 + 0.1, (0, 1))
        objs.append(G.new_object(f'lamp_board_{i}', bm))
        practicals.append(dict(id=f'lamp_board_{i}', position=flame))
    return objs, practicals


def build_notice():
    """The in-world notice board and its frame, or nothing when the world has no board."""
    if not LAYOUT.get('board'):
        return []
    bx, by, bz = (v * T for v in LAYOUT['board']['position'])
    w, h = 2.0, 1.0
    bm = bmesh.new()
    faces = box(bm, bx - w / 2, bx + w / 2, by - h / 2, by + h / 2, bz - 0.03, bz + 0.03,
                mat='notice_board_mat')
    layer = bm.loops.layers.uv.new('UVMap')
    for fc in faces:
        for loop in fc.loops:
            x, y, z = G.plan(loop.vert.co)
            loop[layer].uv = ((x - (bx - w / 2)) / w, (y - (by - h / 2)) / h)
    board = G.new_object('notice_board', bm)
    G.faces_where(board, lambda c, n, f: n[2] < -0.9, 'delete')
    bm = bmesh.new()
    fw, z0 = 0.09, ZI0
    for a in ((bx - w / 2 - fw, bx + w / 2 + fw, by + h / 2, by + h / 2 + fw, z0, bz + 0.05),
              (bx - w / 2 - fw, bx + w / 2 + fw, by - h / 2 - fw, by - h / 2, z0, bz + 0.05),
              (bx - w / 2 - fw, bx - w / 2, by - h / 2, by + h / 2, z0, bz + 0.05),
              (bx + w / 2, bx + w / 2 + fw, by - h / 2, by + h / 2, z0, bz + 0.05),
              (bx - w / 2 - 0.16, bx + w / 2 + 0.16, by + h / 2 + fw, by + h / 2 + fw + 0.05,
               z0, bz + 0.1),
              (bx - 0.9, bx + 0.9, by - 0.73, by - 0.69, z0, z0 + 0.2)):   # lamp ledge
        box(bm, *a, mat='cedar')
    frame = G.new_object('notice_frame', bm)
    G.faces_where(frame, lambda c, n, f: n[2] < -0.9 and c[2] < z0 + 0.01, 'delete')
    return [board, frame]


def book(bm, x0, x1, y0, y1, z0, z1, leather, spine_axis, uvs):
    faces = box(bm, x0, x1, y0, y1, z0, z1, mat='props')
    for fc in faces:
        n = G.plan_normal(fc.normal)
        if abs(n[1]) > 0.9:
            G.paint(bm, [fc], uvs[leather])
        elif abs(n[spine_axis]) > 0.9 and n[spine_axis] > 0:
            G.paint(bm, [fc], uvs[leather])
        else:
            G.paint(bm, [fc], uvs['page_edge'])


LEATHERS = ['leather_brown', 'leather_dark', 'leather_red', 'leather_tan', 'leather_olive',
            'leather_black', 'leather_ochre', 'cloth_plum']


def build_shelves():
    """Codex cabinets and scroll racks on the east and west walls, at the layout's shelf tiles."""
    rng = np.random.default_rng(7)
    uvs = HT.palette_uv()
    frame_bm = bmesh.new()
    fills = []
    shelves = sorted((f for f in LAYOUT['furniture'] if f['type'] == 'hw_shelf'),
                     key=lambda f: (f['col'], f['row']))
    for k, f in enumerate(shelves):
        fill_bm = bmesh.new()
        west = f['col'] * T < XI1 / 2
        wall = XI0 if west else XI1
        sgn = 1 if west else -1                       # +x into the room for the west wall
        depth, height = 0.46, 2.5
        xa, xb = sorted((wall, wall + sgn * depth))
        z0, z1 = f['row'] * T + 0.12, (f['row'] + f['footprintH']) * T - 0.12
        scrolls = (k in (1, 2))                        # one scroll rack per wall
        # carcass: sides, top with cornice, plinth, shelves
        box(frame_bm, xa, xb, 0, height, z0, z0 + 0.05, mat='cedar')
        box(frame_bm, xa, xb, 0, height, z1 - 0.05, z1, mat='cedar')
        box(frame_bm, xa, xb + 0.0, height, height + 0.06, z0 - 0.05, z1 + 0.05, mat='cedar')
        cx = xb if west else xa
        box(frame_bm, min(cx, cx + sgn * 0.06), max(cx, cx + sgn * 0.06), height - 0.02,
            height + 0.08, z0 - 0.08, z1 + 0.08, mat='cedar')
        box(frame_bm, xa, xb, 0, 0.12, z0 + 0.05, z1 - 0.05, mat='cedar')
        levels = [0.12, 0.6, 1.08, 1.56, 2.04]
        for y in levels[1:]:
            box(frame_bm, xa, xb, y - 0.03, y, z0 + 0.05, z1 - 0.05, mat='cedar')
        if scrolls:
            # pigeonholes: vertical dividers, scrolls lying with their ends to the room
            n_div = 6
            zs = np.linspace(z0 + 0.05, z1 - 0.05, n_div + 1)
            for zd in zs[1:-1]:
                box(frame_bm, xa, xb, 0.12, height, zd - 0.015, zd + 0.015, mat='cedar')
            for lo, hi in zip(levels[:-1] + [levels[-1]], levels[1:] + [height]):
                for za, zb in zip(zs[:-1], zs[1:]):
                    n_sc = int(rng.integers(3, 6))
                    for j in range(n_sc):
                        r = float(rng.uniform(0.032, 0.045))
                        zc = za + 0.02 + r + (j % 3) * (zb - za - 0.04 - 2 * r) / 2
                        yc = lo + r + 0.005 + (j // 3) * 2 * r
                        if yc + r > hi - 0.03:
                            continue
                        x_in = xb - 0.02 if west else xa + 0.02
                        x_out = xa + 0.03 if west else xb - 0.03
                        ring = lambda xx: [(xx, yc + r * math.sin(t), zc + r * math.cos(t))
                                           for t in np.linspace(0, 2 * math.pi, 9)[:-1]]
                        faces = G.loft(fill_bm, [ring(x_out), ring(x_in)], mat='props')
                        cap = faces[1]
                        G.paint(fill_bm, faces, uvs['paper_old'])
                        G.paint(fill_bm, [cap], uvs['scroll_cap' if j % 2 else 'paper'])
        else:
            # codices lie flat in stacks, as they were kept in Abbasid libraries
            for lo, hi in zip(levels, levels[1:] + [height]):
                z = z0 + 0.08
                while z < z1 - 0.3:
                    bw = float(rng.uniform(0.2, 0.3))
                    if rng.random() < 0.18:
                        z += bw * 0.6
                        continue
                    y = lo
                    top = lo + float(rng.uniform(0.12, hi - lo - 0.08))
                    while y < top:
                        th = float(rng.uniform(0.025, 0.06))
                        bd = float(rng.uniform(0.22, 0.32))
                        jz = float(rng.uniform(-0.015, 0.015))
                        x_front = xb - 0.03 if west else xa + 0.03
                        bxa, bxb = sorted((x_front, x_front - sgn * bd))
                        book(fill_bm, bxa, bxb, y, y + th, z + jz, z + bw + jz,
                             LEATHERS[int(rng.integers(len(LEATHERS)))], 0 if rng.random() < 0.5
                             else 2, uvs)
                        y += th
                    z += bw + float(rng.uniform(0.02, 0.06))
        fill = G.new_object(f'shelf_fill_{k}', fill_bm)
        # faces against the wall are never seen
        G.faces_where(fill, lambda c, n, f, s=sgn: n[0] * s < -0.9, 'delete')
        fills.append((fill, dict(x=xb if west else xa, z0=z0, z1=z1, y0=0.0, y1=height + 0.1)))
    frame = G.new_object('shelves', frame_bm)
    G.faces_where(frame, lambda c, n, f: n[1] < -0.9 and c[1] < 0.01, 'delete')
    return frame, fills


def build_armillary_plinth():
    """The armillary sphere's octagonal plinth, where the fountain stood (Yousef, 2026-10-12): hall
    geometry, so it shares the lightmap and the instrument's baked contact shadows. A dark moulded
    wooden base, a stone tier carved with the Samarra stucco frieze between marble mouldings, and
    a dark top inlaid with concentric brass rings. The instrument is armillary.py's own GLB."""
    f = FURN['armillary']
    cx = (f['col'] + f['footprintW'] / 2) * T
    cz = (f['row'] + f['footprintH'] / 2) * T
    p = AS.PLINTH
    seg = 64                       # around; includes the octagon's corners (every 8th point)
    th = [2 * math.pi * k / seg for k in range(seg)]
    brass = HT.palette_uv()['brass']
    bm = bmesh.new()
    layer = bm.loops.layers.uv.new('UVMap')

    def octagon(a, th_):
        """Distance to the octagon's edge (apothem a, flats facing the axes) at angle th_."""
        off = (th_ + math.pi / 8) % (math.pi / 4) - math.pi / 8
        return a / math.cos(off)

    def ring(rad, y):
        return [(cx + rad(t) * math.cos(t), y, cz + rad(t) * math.sin(t)) for t in th]

    def band(r0, y0, r1, y1, mat, uv_of, facing):
        """Quads between two rings, wound to face `facing` (+1 outward / up, -1 down).
        uv_of(k, j, t, x, y, z): quad k, corner j along the ring (0, 1), t across (0, 1)."""
        a, b = ring(r0, y0), ring(r1, y1)
        for k in range(seg):
            k1 = (k + 1) % seg
            quad = [(a[k], 0, 0), (a[k1], 1, 0), (b[k1], 1, 1), (b[k], 0, 1)]
            vs = [bm.verts.new(B(*q[0])) for q in quad]
            fc = bm.faces.new(vs)
            fc.normal_update()
            n = G.plan_normal(fc.normal)
            mid = ((a[k][0] + b[k1][0]) / 2 - cx, (a[k][2] + b[k1][2]) / 2 - cz)
            want = (mid[0] * n[0] + mid[1] * n[2]) if abs(n[1]) < 0.5 else n[1]
            if want * facing < 0:
                fc.normal_flip()
            fc.material_index = MI[mat]
            for loop in fc.loops:
                pt, j, t = quad[vs.index(loop.vert)]
                loop[layer].uv = uv_of(k, j, t, *pt)

    oct_ = lambda a: (lambda t: octagon(a, t))
    circ = lambda r: (lambda t: r)
    per = seg // 8                 # points per octagon side; the corners are at k = 4 mod 8

    def wall_uv(per_side, y0, y1, v_span):
        """Walls: u runs 0..per_side along each side (so the pattern lands whole on every side),
        v up the wall over v_span texture units."""
        return lambda k, j, t, x, y, z: (((k - per // 2) % per + j) / per * per_side,
                                         (y - y0) / (y1 - y0) * v_span)
    plan_uv = lambda k, j, t, x, y, z: (x, -z)
    swatch = lambda *_: brass
    # dark wooden base with a chamfered lip, then its top ledge
    lip = p['base_a'] - 0.04
    band(oct_(p['base_a']), 0.0, oct_(p['base_a']), p['base_h'], 'base', plan_uv, +1)
    band(oct_(p['base_a']), p['base_h'], oct_(lip), p['base_lip'], 'base', plan_uv, +1)
    band(oct_(lip), p['base_lip'], oct_(p['mould_a']), p['base_lip'], 'base', plan_uv, +1)
    # stone tier: marble foot moulding, the carved frieze, the marble cap
    m0, m1 = p['mould']
    f0, f1 = p['frieze']
    c0, c1 = p['cap']
    band(oct_(p['mould_a']), m0, oct_(p['mould_a']), m1, 'marble', wall_uv(1.0, m0, m1, 0.05),
         +1)
    band(oct_(p['mould_a']), m1, oct_(p['tier_a']), m1, 'marble', plan_uv, +1)
    # six moulded units per side: the Samarra field's checkerboard (two units per metre of
    # texture) lands whole on every side, one unit row tall
    band(oct_(p['tier_a']), f0, oct_(p['tier_a']), f1, 'samarra', wall_uv(3.0, f0, f1, 0.5), +1)
    band(oct_(p['tier_a']), c0, oct_(p['mould_a']), c0, 'marble', plan_uv, -1)
    band(oct_(p['mould_a']), c0, oct_(p['mould_a']), c1, 'marble', wall_uv(1.0, c0, c1, 0.03),
         +1)
    band(oct_(p['mould_a']), c1, circ(p['disc_r']), c1, 'marble', plan_uv, +1)
    # the inlaid top: a brass edge, then dark and brass annuli from the rim to the centre boss
    band(circ(p['disc_r']), c1, circ(p['disc_r']), p['top'], 'props', swatch, +1)
    r_in = 0.0
    for r_out, kind in p['inlay']:
        mat, uv = ('props', swatch) if kind == 'brass' else ('base', plan_uv)
        if r_in == 0.0:
            ctr = bm.verts.new(B(cx, p['top'], cz))
            rim = [bm.verts.new(B(*q)) for q in ring(circ(r_out), p['top'])]
            for k in range(seg):
                fc = bm.faces.new((ctr, rim[(k + 1) % seg], rim[k]))
                fc.normal_update()
                if G.plan_normal(fc.normal)[1] < 0:
                    fc.normal_flip()
                fc.material_index = MI[mat]
                for loop in fc.loops:
                    loop[layer].uv = uv(0, 0, 0, *G.plan(loop.vert.co))
        else:
            band(circ(r_in), p['top'], circ(r_out), p['top'], mat, uv, +1)
        r_in = r_out
    ob = G.new_object('armillary_plinth', bm)
    ob.data.shade_flat()
    STATS['armillary_plinth'] = dict(centre=[cx, p['top'], cz], apothem=p['base_a'])
    return ob


def build_armillary_occluders():
    """The instrument's fixed parts (meridian, horizon, pedestal, polar axis) at their exported
    place: never exported, they only cast the baked shadows on the plinth top and the floor."""
    f = FURN['armillary']
    origin = np.array([(f['col'] + f['footprintW'] / 2) * T, AS.PLINTH['top'],
                       (f['row'] + f['footprintH'] / 2) * T])
    mesh = AS.fixed_occluders()
    P, _, _ = mesh.arrays()
    me = bpy.data.meshes.new('BAKE_ONLY_armillary')
    me.from_pydata([tuple(B(*(q + origin))) for q in P], [], mesh.F)
    me.update()
    ob = bpy.data.objects.new('BAKE_ONLY_armillary', me)
    bpy.context.scene.collection.objects.link(ob)
    for m in G.MATS:
        ob.data.materials.append(bpy.data.materials[m])
    return ob


# The back palms stand in front of the north alcoves; at the default camera their fronds hid the
# cobalt approval lamps of n-6 and n-12 (Yousef, 2026-10-15: the chambers must read). Fronds
# reaching towards the palm's own alcove are pruned shorter and lifted, those reaching towards
# the camera a little, measured against the default camera: both lamps, the seated scholars and
# the hero sheets clear; fronds over the n-6 / n-12 openings 9.0 / 9.6% -> ~4.5%. The palms keep
# their tiles, so the colonnade rhythm and the walking paths stay as they were.
PALM_TRIM = dict(span=100.0, length=0.45, el=35.0, south_span=45.0, south_el=30.0,
                 south_length=0.85)


def trim_frond(az, el, length, alcove_az):
    """Prune a back palm's frond: shorter and higher towards its alcove, a little towards the
    camera (south). Angles in radians, az as build_palm draws it (0 = east, pi/2 = south)."""
    tr = PALM_TRIM
    gap = lambda a, b: abs((a - b + math.pi) % (2 * math.pi) - math.pi)
    d = gap(az, alcove_az)
    if d < math.radians(tr['span']):
        k = 1 - d / math.radians(tr['span'])
        length *= 1 - (1 - tr['length']) * k
        el = max(el, math.radians(tr['el']) * k + el * (1 - k))
    d = gap(az, math.pi / 2)
    if d < math.radians(tr['south_span']):
        k = 1 - d / math.radians(tr['south_span'])
        el = max(el, math.radians(tr['south_el']) * k + el * (1 - k))
        length *= 1 - (1 - tr['south_length']) * k
    return az, el, length


def build_palm(f, rng):
    """Stylised date palm: ringed trunk, arching fronds with serrated edges, date clusters.
    Returns the object and its trunk meta (base and crown, for the runtime frond sway)."""
    uvs = HT.palette_uv()
    cx, cz = tile_centre(f['col'], f['row'])
    bm = bmesh.new()
    # planter kerb + soil (marble kerb on the tile)
    oct_ring = lambda r, y: [(cx + r * math.cos(math.pi / 8 + k * math.pi / 4), y,
                              cz + r * math.sin(math.pi / 8 + k * math.pi / 4)) for k in range(8)]
    G.loft(bm, [oct_ring(0.62, 0.0), oct_ring(0.62, 0.28), oct_ring(0.5, 0.28),
                oct_ring(0.5, 0.2)], mat='marble', cap=False)
    soil = [bm.verts.new(B(*p)) for p in oct_ring(0.5, 0.2)]
    sf = bm.faces.new(soil[::-1])
    sf.material_index = MI['palm']
    G.paint(bm, [sf], uvs['soil'])
    H = float(rng.uniform(4.3, 4.9))
    lean = rng.uniform(-1, 1, 2) * 0.18
    n_r, sides = 16, 7
    rings = []
    for i in range(n_r + 1):
        t = i / n_r
        r = 0.19 - 0.05 * t + (0.018 if i % 2 else 0.0)
        ox, oz = lean[0] * t * t, lean[1] * t * t
        rings.append([(cx + ox + r * math.cos(2 * math.pi * k / sides), 0.15 + t * (H - 0.15),
                       cz + oz + r * math.sin(2 * math.pi * k / sides)) for k in range(sides)])
    faces = G.loft(bm, rings, mat='palm', cap=False)
    for i, fc in enumerate(faces):
        G.paint(bm, [fc], uvs['palm_trunk' if (i // sides) % 2 else 'palm_trunk_dark'])
    top = np.array([cx + lean[0], H, cz + lean[1]])
    alcove_az = math.pi if cx < LAYOUT['cols'] * T / 2 else 0.0   # west palm: its alcove is west
    # fronds
    n_f = 18
    for k in range(n_f):
        az = 2 * math.pi * k / n_f + float(rng.uniform(-0.12, 0.12))
        el = math.radians(float(rng.uniform(5, 35) if k % 3 else rng.uniform(40, 62)))
        L = float(rng.uniform(1.9, 2.5)) * (0.75 if k % 3 == 0 else 1.0)
        if not is_front_palm(f):
            az, el, L = trim_frond(az, el, L, alcove_az)
        h_dir = np.array([math.cos(az), 0.0, math.sin(az)])
        side = np.array([-math.sin(az), 0.0, math.cos(az)])
        up = np.array([0.0, 1.0, 0.0])
        seg = 12
        prev = None
        sw = 'frond' if k % 2 else 'frond_dark'
        if k % 5 == 4:
            sw = 'frond_dry'
        for i in range(seg + 1):
            t = i / seg
            p = top + L * (t * math.cos(el) * h_dir + (t * math.sin(el) - 0.62 * t * t) * up)
            w = 0.34 * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.7 * (1.0 if i % 2 else 0.72)
            if i == 0:
                w = 0.04
            fold = 0.05 * w / 0.34
            left = p + w * side + fold * up
            right = p - w * side + fold * up
            cur = [bm.verts.new(B(*left)), bm.verts.new(B(*p)), bm.verts.new(B(*right))]
            if prev:
                for a, b in ((0, 1), (1, 2)):
                    fc = bm.faces.new((prev[a], prev[b], cur[b], cur[a]))
                    fc.material_index = MI['palm']
                    G.paint(bm, [fc], uvs[sw])
            prev = cur
    # date clusters under the crown
    for k in range(3):
        az = 2 * math.pi * k / 3 + float(rng.uniform(0, 1))
        base = top + np.array([0.28 * math.cos(az), -0.35, 0.28 * math.sin(az)])
        for j in range(14):
            d = base + np.array([rng.uniform(-0.09, 0.09), -0.03 * j * 0.7 + rng.uniform(-0.03, 0.03),
                                 rng.uniform(-0.09, 0.09)])
            r = 0.028
            vs = [bm.verts.new(B(*(d + np.array(o) * r))) for o in
                  ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
            for a, b, c in ((0, 2, 4), (4, 2, 1), (1, 2, 5), (5, 2, 0), (0, 4, 3), (4, 1, 3),
                            (1, 5, 3), (5, 0, 3)):
                fc = bm.faces.new((vs[a], vs[b], vs[c]))
                fc.material_index = MI['palm']
                G.paint(bm, [fc], uvs['dates'])
    bm.normal_update()
    ob = G.new_object(f'palm_{f["uid"]}', bm)
    meta = {'node': ob.name, 'base': [round(cx, 4), 0.15, round(cz, 4)],
            'crown': [round(float(v), 4) for v in top]}
    return ob, meta


def build_props():
    """Static desk furniture: book chests on the second desk tile, inkwells, paper, codices."""
    rng = np.random.default_rng(11)
    uvs = HT.palette_uv()
    bm = bmesh.new()
    for s in LAYOUT['seats']:
        dc, dr = STEP[s['facing']]
        col, row = s['col'] + dc, s['row'] + dr
        cx, _ = tile_centre(col, row)
        edge = (row + (1 if dr < 0 else 0)) * T
        sgn = -1 if dr < 0 else 1
        dz = edge + sgn * 0.29                     # desk centre line (see build_desks)
        top = 0.34
        # inkwell on the desk's left, a small stack of paper on its right
        ink = G.lathe(bm, [(0.03, 0.0), (0.034, 0.03), (0.022, 0.05), (0.024, 0.058)],
                      cx - 0.38, dz - sgn * 0.08, y0=top, segments=8, mat='props')
        G.paint(bm, ink, uvs['brass'])
        faces = box(bm, cx + 0.22, cx + 0.44, top, top + 0.018, dz - 0.12, dz + 0.1, mat='props')
        G.paint(bm, faces, uvs['paper'])
        if s['uid'].startswith('alcove-') and s['uid'] not in HC.THEMES:
            # a cedar book chest with codices on the other desk tile (the themed chambers put
            # their furnace, globe or plant press there instead)
            ox = (s['col'] + 1.5) * T          # the desk footprint's second tile
            box(bm, ox - 0.42, ox + 0.42, 0.0, 0.42, dz - 0.22 + sgn * 0.05, dz + 0.22 + sgn * 0.05,
                mat='cedar')
            y = 0.42
            for j in range(int(rng.integers(2, 5))):
                th = float(rng.uniform(0.03, 0.055))
                w = float(rng.uniform(0.24, 0.32))
                jx = float(rng.uniform(-0.05, 0.05))
                book(bm, ox - w / 2 + jx - 0.1, ox + w / 2 + jx - 0.1, y, y + th,
                     dz - 0.15, dz + 0.15, LEATHERS[int(rng.integers(len(LEATHERS)))], 2, uvs)
                y += th
            # brass corner straps on the chest
            for sx in (-1, 1):
                faces = box(bm, ox + sx * 0.42 - 0.012, ox + sx * 0.42 + 0.012, 0.05, 0.37,
                            dz - 0.23 + sgn * 0.05, dz + 0.23 + sgn * 0.05, mat='props')
                G.paint(bm, faces, uvs['brass'])
    ob = G.new_object('props', bm)
    G.faces_where(ob, lambda c, n, f: n[1] < -0.9 and c[1] < 0.01, 'delete')
    return ob


# ---------------------------------------------------------------- bake-only occluders
def build_bake_only():
    """Shapes that light the hall as the real building would, but are never exported: the
    north range's roof, the south wall above the cutaway (with its door opening) and the
    armillary's fixed parts."""
    objs = []
    bm = bmesh.new()
    # north range only: its alcoves are seen through the arcade, so the roof is never missed and
    # it turns the sun into arch-shaped pools. The south range is open in the cutaway, so it
    # stays open to the sky in the bake too (and the scholars there are not left in the dark).
    box(bm, XO0, XO1, N_ARC['top'], N_ARC['top'] + 0.3, ZO0, N_ARC['line'] + PIER / 2)
    objs.append(G.new_object('BAKE_ONLY_roof_north', bm))
    bm = bmesh.new()
    gap = (13.85, 16.15)
    box(bm, XO0, gap[0], SOUTH_CUT, WALL_H, ZI1, ZO1)
    box(bm, gap[1], XO1, SOUTH_CUT, WALL_H, ZI1, ZO1)
    box(bm, gap[0], gap[1], 3.3, WALL_H, ZI1, ZO1)
    objs.append(G.new_object('BAKE_ONLY_south_wall', bm))
    # the armillary's fixed rings and pedestal shade the plinth and the paving under the sun
    objs.append(build_armillary_occluders())
    # window plug: blocks the sun's direct beam through the grille (the live gobo spot adds it)
    bm = bmesh.new()
    outline = G.arch_outline_closed(WIN['cz'], WIN['half'] + 0.03, WIN['sill'] - 0.03,
                                    WIN['spring'], WIN['dr'], 16)
    G.extrude_profile(bm, outline, 'x', XI0 - GRILLE_W[0] + 0.002, XI0 - WIN_WAIST[0] - 0.005)
    objs.append(G.new_object('BAKE_ONLY_window_plug', bm))
    for o in objs:
        for f in o.data.polygons:
            f.material_index = MI['plaster']
    return objs


# ---------------------------------------------------------------- UV0 for the architecture
def arch_uv(name, co, n):
    x, y, z = co
    if name in ('brick',):
        ax = max(range(3), key=lambda i: abs(n[i]))
        if ax == 0:
            return (z, y)
        if ax == 2:
            return (x, y)
        return (x, -z)
    if name == 'stucco':
        ax = max(range(3), key=lambda i: abs(n[i]))
        lo = band_of(y) if ax != 1 else None
        if ax == 1 or lo is None:
            return G.box_uv(co, n, 1.0)
        u = (-z if n[0] > 0 else z) if ax == 0 else (x if n[2] > 0 else -x)
        return (u, (y - lo) / 0.5)
    if name in ('dado', 'frieze'):
        ax = max(range(3), key=lambda i: abs(n[i]))
        if ax == 1:
            return G.box_uv(co, n, 1.0)
        # read upright and unmirrored from inside the hall; dado panels join on tile edges
        u = (-z if n[0] > 0 else z) if ax == 0 else (x if n[2] > 0 else -x)
        if name == 'dado':
            return (u / P.DADO_W, (y - DADO) / P.DADO_H)
        lo = band_of(y)
        return (u / P.FRIEZE_TEX_W, (y - lo) / P.FRIEZE_H) if lo is not None else G.box_uv(co, n, 1.0)
    if name == 'samarra':
        return G.box_uv(co, n, P.SAMARRA_M)
    if name in ('plaster', 'marble'):
        return G.box_uv(co, n, 1.0)
    if name in ('starfloor', 'brickfloor'):
        return (x / T, -z / T)
    if name == 'cedar':
        return G.box_uv(co, n, 1.0)
    return None


# ---------------------------------------------------------------- lightmap UVs
LM_WEIGHT = {'hall_exterior': 0.25, 'diorama_base': 0.3, 'props': 0.35, 'shelves': 0.5,
             'cushions': 0.5, 'floor_rugs': 0.7, 'notice_frame': 0.6,
             'grille_west': 0.5, 'armillary_plinth': 0.8, 'hall_details': 0.8, 'kufic_letters': 0.8,
             'logo_panel': 1.0, 'logo_frame': 0.6, 'UV_PROXY': 0.6}
LM_PREFIX_WEIGHT = {'lamp_': 0.25, 'desk_': 0.6, 'palm_': 0.3, 'planter_': 0.4, 'chamber_': 0.4}


def lm_weight(name):
    for k, w in LM_PREFIX_WEIGHT.items():
        if name.startswith(k):
            return w
    return LM_WEIGHT.get(name.split('.')[0].rstrip('0123456789').rstrip('_'), 1.0)


def proxy_quad(frame, k):
    """A stand-in island for a projected group: a quad of the group's front extent."""
    bm = bmesh.new()
    x, z0, z1, y0, y1 = frame['x'], frame['z0'], frame['z1'], frame['y0'], frame['y1']
    vs = [bm.verts.new(B(x, y, z)) for z, y in ((z0, y0), (z1, y0), (z1, y1), (z0, y1))]
    bm.faces.new(vs)
    return G.new_object(f'UV_PROXY_{k}', bm)


def lightmap_uvs(objs, projected=()):
    """Smart-project every object into one shared UVLightmap atlas, texel density evened out and
    weighted per object, then packed. Each projected group (object, frame) gets a single planar
    island (seen from the room) instead of one island per face: shelf contents."""
    proxies = [proxy_quad(frame, k) for k, (_, frame) in enumerate(projected)]
    unwrap = list(objs) + proxies
    for o in unwrap + [p for p, _ in projected]:
        me = o.data
        if 'UVMap' not in me.uv_layers:
            me.uv_layers.new(name='UVMap')
        lm = me.uv_layers.new(name='UVLightmap')
        me.uv_layers.active = lm
    C.select_only(unwrap, unwrap[0])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in unwrap:
        w = lm_weight(o.name)
        if w != 1.0:
            lm = o.data.uv_layers['UVLightmap']
            uv = np.empty(len(lm.data) * 2, dtype=np.float32)
            lm.data.foreach_get('uv', uv)
            lm.data.foreach_set('uv', uv * w)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')
    for (ob, frame), proxy in zip(projected, proxies):
        pm = proxy.data
        corner = {}
        for li, loop in enumerate(pm.loops):
            corner[loop.vertex_index] = np.array(pm.uv_layers['UVLightmap'].data[li].uv)
        c = [corner[i] for i in range(4)]
        me = ob.data
        lm = me.uv_layers['UVLightmap']
        for li, loop in enumerate(me.loops):
            x, y, z = G.plan(me.vertices[loop.vertex_index].co)
            s_ = np.clip((z - frame['z0']) / (frame['z1'] - frame['z0']), 0, 1)
            t_ = np.clip((y - frame['y0']) / (frame['y1'] - frame['y0']), 0, 1)
            uv = ((1 - s_) * (1 - t_) * c[0] + s_ * (1 - t_) * c[1] + s_ * t_ * c[2]
                  + (1 - s_) * t_ * c[3])
            lm.data[li].uv = uv
        proxy.hide_render = True
        proxy.hide_set(True)
    for o in unwrap + [p for p, _ in projected]:
        me = o.data
        me.uv_layers.active = me.uv_layers['UVMap']
        me.uv_layers['UVMap'].active_render = True


# ---------------------------------------------------------------- lights and world
def set_world(sky):
    w = bpy.context.scene.world
    if w.node_tree is None:
        w.use_nodes = True  # deprecated in 5.x but still creates the tree
    nt = w.node_tree
    for n in list(nt.nodes):
        if n.type not in ('OUTPUT_WORLD',):
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_WORLD'][0]
    L = nt.links
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Generated'], sep.inputs['Vector'])
    up = nt.nodes.new('ShaderNodeMath')
    up.operation = 'MAXIMUM'
    up.inputs[1].default_value = 0.0
    L.new(sep.outputs['Z'], up.inputs[0])
    pw = nt.nodes.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = 0.5
    L.new(up.outputs[0], pw.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (*sky['horizon'], 1)
    mix.inputs['B'].default_value = (*sky['zenith'], 1)
    L.new(pw.outputs[0], mix.inputs['Factor'])
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.0
    L.new(sep.outputs['Z'], gt.inputs[0])
    mix2 = nt.nodes.new('ShaderNodeMix')
    mix2.data_type = 'RGBA'
    mix2.inputs['A'].default_value = (*sky['ground'], 1)
    L.new(mix.outputs['Result'], mix2.inputs['B'])
    L.new(gt.outputs[0], mix2.inputs['Factor'])
    bg = nt.nodes.new('ShaderNodeBackground')
    L.new(mix2.outputs['Result'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = sky['strength']
    L.new(bg.outputs['Background'], out.inputs['Surface'])
    return bg


def make_sun():
    d = sun_dir()
    ld = bpy.data.lights.new('Sun', 'SUN')
    ld.energy = SUN_STRENGTH
    ld.color = SUN_COLOR
    ld.angle = math.radians(0.53)
    sun = bpy.data.objects.new('Sun', ld)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = B(*d).to_track_quat('-Z', 'Y').to_euler()
    return sun


def make_lamps(practicals):
    objs = []
    for p in practicals:
        ld = bpy.data.lights.new(p['id'], 'POINT')
        ld.energy = LAMP_POWER
        ld.color = LAMP_COLOR
        ld.shadow_soft_size = 0.05
        ob = bpy.data.objects.new(p['id'] + '_light', ld)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = B(*p['position'])
        objs.append(ob)
    return objs


# ---------------------------------------------------------------- bakes
def join_for_bake(objs):
    """Cycles pays a set-up cost per baked object, so bake one joined mesh; faces remember
    their node so split_after_bake() restores the exact objects (names are the GLB contract)."""
    names = [o.name for o in objs]
    for i, o in enumerate(objs):
        a = o.data.attributes.new('node_id', 'INT', 'FACE')
        a.data.foreach_set('value', np.full(len(o.data.polygons), i, dtype=np.int32))
    return G.join(objs, 'BAKE_MESH'), names


def split_after_bake(joined, names):
    out = []
    for i, name in enumerate(names):
        me = joined.data.copy()
        bm = bmesh.new()
        bm.from_mesh(me)
        layer = bm.faces.layers.int.get('node_id')
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer] != i], context='FACES')
        bm.to_mesh(me)
        bm.free()
        me.attributes.remove(me.attributes['node_id'])
        me.name = name
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        out.append(ob)
    joined.hide_render = True
    joined.hide_set(True)
    return out


def bake(objs, passes, label, btype='DIFFUSE'):
    img = C.new_image(f'lm_{label}', LM_SIZE, LM_SIZE, float_buffer=True, data=True)
    for o in objs:
        C.bake_target(o, img)
    C.select_only(objs, objs[0])
    with C.timed(f'bake {label} {LM_SIZE}^2 @{bpy.context.scene.cycles.samples}spp'):
        if btype == 'NORMAL':
            bpy.ops.object.bake(type='NORMAL', normal_space='OBJECT', margin=0, use_clear=True,
                                uv_layer='UVLightmap', target='IMAGE_TEXTURES')
        else:
            bpy.ops.object.bake(type='DIFFUSE', pass_filter=passes, margin=0, use_clear=True,
                                uv_layer='UVLightmap', target='IMAGE_TEXTURES')
    a = C.image_to_numpy(img)[..., :3].astype(np.float64)
    bpy.data.images.remove(img)
    return a


def dilate(img, mask, iters=24):
    """Pull valid texels outwards into the gutters so bilinear filtering never sees black."""
    out = img.copy()
    m = mask.copy()
    for _ in range(iters):
        acc = np.zeros_like(out)
        cnt = np.zeros(m.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                sm = np.roll(np.roll(m, dy, 0), dx, 1)
                acc += np.roll(np.roll(out, dy, 0), dx, 1) * sm[..., None]
                cnt += sm
        grow = (~m) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
        if m.all():
            break
    return out


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


# ---------------------------------------------------------------- gobo
def make_gobo(n=1024, L=9.0):
    """Project the west window's aperture and grille from a far 'sun' spot, the way three.js maps
    spotLight.map (perspective shadow camera, square aspect, lookAt with +Y up)."""
    d = sun_dir()
    gw = (GRILLE_W[0] + GRILLE_W[1]) / 2
    wc = np.array([XI0 - gw, (WIN['sill'] + G.arch_crown(WIN['half'], WIN['spring'], WIN['dr'])) / 2,
                   WIN['cz']])
    pos = wc - d * L
    target = wc + d * 2.0
    up = np.array([0.0, 1.0, 0.0])
    zc = pos - target
    zc /= np.linalg.norm(zc)
    xc = np.cross(up, zc)
    xc /= np.linalg.norm(xc)
    yc = np.cross(zc, xc)
    pts = []
    for w in WIN_WAIST:
        for u, v in P.arch_outline(WIN['cz'], WIN['half'], WIN['sill'], WIN['spring']):
            pts.append([XI0 - w, v, u])
    rel = np.array(pts) - pos
    cam = np.stack([rel @ xc, rel @ yc, -(rel @ zc)], -1)
    tan_a = 1.06 * np.max(np.hypot(cam[:, 0], cam[:, 1]) / cam[:, 2])
    s = (np.arange(n) + 0.5) / n
    S, Tt = np.meshgrid(s, s[::-1])                 # row 0 = top of the image (t = 1)
    rx, ry = (2 * S - 1) * tan_a, (2 * Tt - 1) * tan_a
    dirs = rx[..., None] * xc + ry[..., None] * yc - zc
    ok = np.ones((n, n), bool)

    def hit(x_plane):
        t = (x_plane - pos[0]) / dirs[..., 0]
        return pos[2] + t * dirs[..., 2], pos[1] + t * dirs[..., 1]   # (u = z, v = y)

    for w in np.unique(np.concatenate([np.linspace(0.0, WALL_T, 21), WIN_WAIST])):  # double splay
        prm = win_params(w)
        u, v = hit(XI0 - w)
        ok &= P.arch_inside(u, v, prm['cz'], prm['half'], prm['sill'], prm['spring'])
    for w in GRILLE_W:                                  # both faces of the stucco slab
        u, v = hit(XI0 - w)
        ok &= P.grille_open(u, v, WIN['cz'], WIN['half'], WIN['sill'], WIN['spring']) > 0
    g = ok.astype(np.float64)
    # penumbra: the sun disc (0.53 deg) over a ~5 m throw is ~4.5 cm on the floor
    throw = WIN['sill'] / math.tan(math.radians(SUN_EL)) / math.cos(math.radians(SUN_EL))
    px_per_rad = n / (2 * tan_a)
    sig = max(1.5, 0.5 * math.radians(0.53) * throw / (L + throw) * px_per_rad)
    k = np.exp(-0.5 * (np.arange(-int(4 * sig) - 1, int(4 * sig) + 2) / sig) ** 2)
    k /= k.sum()
    g = np.apply_along_axis(lambda r: np.convolve(r, k, 'same'), 1, g)
    g = np.apply_along_axis(lambda c: np.convolve(c, k, 'same'), 0, g)
    P.write_png(os.path.join(OUT, 'gobo_west.png'), P.to_u8(g))
    STATS['gobo_open_fraction'] = round(float(ok.mean()), 4)
    STATS['gobo_sigma_px'] = round(sig, 2)
    return {'position': [float(v) for v in pos], 'target': [float(v) for v in target],
            'angle': float(math.atan(tan_a)), 'near': 0.5, 'far': float(L + 14.0), 'size': n}


# ---------------------------------------------------------------- main
def main():
    t0 = time.perf_counter()
    scene = C.reset_scene()
    C.use_metal_gpu(scene)
    C.TIMINGS.clear()
    with C.timed('materials + hall textures (numpy)'):
        build_materials()
    with C.timed('generate hall geometry'):
        hall = build_architecture()
        ext, section = split_hall(hall)
        details = build_details()
        floors = build_floors()
        rugs = build_rugs()
        base = build_base()
        desks = build_desks()
        cushions = build_cushions()
        lamps, practicals = build_lamps()
        notice = build_notice()
        shelves, shelf_fills = build_shelves()
        plinth = build_armillary_plinth()
        rng = np.random.default_rng(5)
        palm_tiles = [f for f in LAYOUT['furniture'] if f['type'] == 'hw_palm']
        palms_and_meta = [build_palm(f, rng) for f in palm_tiles if not is_front_palm(f)]
        palms = [p for p, _ in palms_and_meta]
        palm_meta = [m for _, m in palms_and_meta]
        prng = np.random.default_rng(17)
        planters = [HD.build_planter(f, T, prng, 'oleander' if i == 0 else 'jasmine')
                    for i, f in enumerate(sorted((f for f in palm_tiles if is_front_palm(f)),
                                                 key=lambda f: f['col']))]
        logo = build_logo()
        props = build_props()
        chambers = HC.build(LAYOUT, T, ZI0, XI0, XI1, [p * T for p in arcade_piers()], PIER,
                            HT.palette_uv())
        exported = ([hall, ext, section] + details + floors + [rugs, base] + desks + [cushions]
                    + lamps + notice + logo + [shelves] + [f for f, _ in shelf_fills] + [plinth]
                    + palms + planters + [props] + chambers)
        for o in exported:
            if o is not plinth:             # the plinth carries its own UV0
                G.set_uv0(o, arch_uv)
        bake_only = build_bake_only()
    STATS['tris_total'] = sum(G.tri_count(o) for o in exported)
    STATS['tris'] = {o.name: G.tri_count(o) for o in exported if G.tri_count(o) > 2000}
    STATS['tris_chambers'] = {o.name: G.tri_count(o) for o in chambers}
    print('[stats] tris', STATS['tris_total'], flush=True)
    with C.timed('lightmap UV unwrap + pack (UVLightmap)'):
        lightmap_uvs([o for o in exported if not o.name.startswith('shelf_fill_')], shelf_fills)
    # shelf contents travel with the carcass from here on
    fills = [f for f, _ in shelf_fills]
    shelves = G.join([shelves] + fills, 'shelves')
    exported = [o for o in exported if o not in fills and o.name != 'shelves'] + [shelves]

    scene.cycles.samples = LM_SAMPLES
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 4
    scene.cycles.glossy_bounces = 1
    scene.cycles.sample_clamp_indirect = 2.0   # small flames make indirect fireflies
    scene.cycles.transmission_bounces = 0
    main_names = [o.name for o in exported if o is not section]
    baked, names = join_for_bake([o for o in exported if o is not section])
    main_objs = [baked]
    cut_away = [bpy.data.objects['BAKE_ONLY_south_wall']]
    plug = bpy.data.objects['BAKE_ONLY_window_plug']
    sun = make_sun()
    lamp_lights = make_lamps(practicals)

    def two_part(passes, label):
        """Bake the hall as the whole building, then the south wall's cut top as open sky."""
        a = bake(main_objs, passes, label)
        for o in cut_away:
            o.hide_render = True
        b = bake([section], passes, label + '_section')
        for o in cut_away:
            o.hide_render = False
        return a, b

    def lights(sun_on, lamps_on, plug_on):
        sun.hide_render = not sun_on
        plug.hide_render = not plug_on
        for o in lamp_lights:
            o.hide_render = not lamps_on

    passes = {}
    if not NO_BAKE:
        scene.cycles.samples = 1
        nrm01 = bake(main_objs, None, 'normals', 'NORMAL')
        cov_main = nrm01.max(-1) > 0.004
        cov_sec = bake([section], None, 'normals_section', 'NORMAL').max(-1) > 0.004
        nrm = nrm01 * 2 - 1
        scene.cycles.samples = LM_SAMPLES
        gold = set_world(GOLD_SKY)
        lights(False, False, False)
        passes['g_sky'] = two_part({'DIRECT', 'INDIRECT'}, 'golden_sky')
        gold.inputs['Strength'].default_value = 0.0
        lights(True, False, True)
        passes['g_sundir'] = two_part({'DIRECT'}, 'golden_sun_direct')
        lights(True, False, False)
        passes['g_sunind'] = two_part({'INDIRECT'}, 'golden_sun_bounce')
        dusk = set_world(DUSK_SKY)
        lights(False, False, False)
        passes['d_sky'] = two_part({'DIRECT', 'INDIRECT'}, 'dusk_sky')
        dusk.inputs['Strength'].default_value = 0.0
        lights(False, True, False)
        ember = bpy.data.materials['ember'].node_tree.nodes['Principled BSDF']
        ember.inputs['Emission Strength'].default_value = EMBER_DUSK_BAKE   # a faint warm spill
        passes['d_lamps'] = two_part({'DIRECT', 'INDIRECT'}, 'dusk_lamps')
        ember.inputs['Emission Strength'].default_value = 0.0
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
        for k, (a, b) in passes.items():
            np.save(os.path.join(RAW, f'lm_{k}.npy'), np.where(cov_main[..., None], a, b)
                    .astype(np.float16))
        # calibration: fully sunlit up-facing texels in the direct-sun pass (spike gotcha 6)
        sd = passes['g_sundir'][0].max(-1)
        upf = cov_main & (nrm[..., 2] > 0.995) & (sd > 0)
        lit = sd[upf & (sd > 0.8 * sd[upf].max())]
        patch = float(np.median(lit))
        cos_floor = math.sin(math.radians(SUN_EL))
        spot_intensity = math.pi * patch / cos_floor / max(SUN_COLOR)
        STATS.update({'sun_patch_V': patch, 'sun_patch_texels': int(lit.size),
                      'spot_intensity_measured': spot_intensity})
    else:
        cov = np.ones((LM_SIZE, LM_SIZE), bool)
        golden = np.full((LM_SIZE, LM_SIZE, 3), 0.2)
        dusk_img = np.full((LM_SIZE, LM_SIZE, 3), 0.05)
        spot_intensity = SUN_STRENGTH

    lm_meta = {}
    for name, img in (('golden', golden), ('dusk', dusk_img)):
        valid = cov & (img.sum(-1) > 0)
        # dusk: clip the hot spots right at the flames so the blue sky term keeps its bits
        pct = 99.7 if name == 'golden' else 99.0
        M = float(np.percentile(img[valid].max(-1), pct)) if valid.any() else 1.0
        enc = lin_to_srgb(dilate(img, cov) / M)
        P.write_png(os.path.join(RAW, f'lightmap_{name}.png'), P.to_u8(enc))
        lm_meta[name] = {'file': f'lightmap_{name}.ktx2', 'uv': 1, 'intensity': math.pi * M,
                         'colorSpace': 'srgb'}
        STATS[f'lightmap_{name}_M'] = M

    with C.timed('gobo projection (numpy)'):
        gobo = make_gobo()

    C.remove_bake_targets(section)
    exported = split_after_bake(baked, names) + [section]
    assert [o.name for o in exported[:-1]] == main_names, 'node names changed in the bake split'
    for o in bake_only:
        o.hide_render = True    # kept in the .blend for inspection; never selected for export
    meta = {
        'note': 'Generated by assets/blender/hall.py. Positions are GLB space: metres, glTF axes '
                '(x east, y up, z south), origin at the grid NW corner (tile = 1.5 m).',
        'worldId': LAYOUT['worldId'],
        'tileMeters': T,
        'glb': 'hall.glb',
        # the instrument on the plinth: its own GLB (armillary.py), nodes turned at runtime
        'armillary': {'glb': 'armillary.glb'},
        'moods': {
            'golden': {'lightmap': lm_meta['golden'],
                       'sun': {'color': list(SUN_COLOR), 'intensity': spot_intensity,
                               'penumbra': 0.02, **gobo, 'gobo': 'gobo_west.png'}},
            'dusk': {'lightmap': lm_meta['dusk'], 'sun': None},
        },
        # palm trunks, so the runtime sways only the fronds (Atmosphere.tsx PalmSway)
        'palms': palm_meta,
        'practicals': [{'id': p['id'], 'position': [round(float(v), 4) for v in p['position']],
                        'color': list(LAMP_COLOR), 'intensity': LAMP_POWER / (4 * math.pi),
                        'distance': LAMP_RANGE, **({'seatUid': p['seatUid']} if 'seatUid' in p
                                                   else {})}
                       for p in practicals],
    }
    with open(os.path.join(OUT, 'hall.meta.json'), 'w') as f:
        json.dump(meta, f, indent=2)
        f.write('\n')

    # flames glow in the export (the runtime drives them); lamps stay unlit
    bpy.data.materials['flame'].node_tree.nodes['Principled BSDF'].inputs[
        'Emission Strength'].default_value = 1.0
    bpy.data.materials['ember'].node_tree.nodes['Principled BSDF'].inputs[
        'Emission Strength'].default_value = EMBER_EXPORT
    C.select_only(exported, exported[0])
    glb = os.path.join(RAW, 'hall.raw.glb')
    with C.timed('export GLB'):
        bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True,
                                  export_texcoords=True, export_normals=True,
                                  export_tangents=False, export_materials='EXPORT',
                                  export_extras=False, export_yup=True, export_apply=True,
                                  export_image_format='AUTO', export_lights=False,
                                  export_cameras=False)
    STATS['glb_raw_bytes'] = os.path.getsize(glb)
    STATS['total_s'] = round(time.perf_counter() - t0, 1)
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(RAW, 'hall.blend'))
    C.TIMINGS.update(STATS)
    with open(os.path.join(RAW, 'timings_hall.json'), 'w') as f:
        json.dump(C.TIMINGS, f, indent=2)
    print('[stats]', json.dumps(STATS, indent=1), flush=True)


main()
