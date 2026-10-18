# The House of Life's costume set for the shared Diwan body (c. 50 BC - AD 30, a native temple).
#
# Same armature, skin weights, clips and node names as the House of Wisdom figurines; only the
# clothing geometry and materials change. Every costume variant is baked into ONE skinned mesh
# under its own named material; the runtime shows the ones a persona wears by switching
# `material.visible` (figureLogic.applyCostume): kilt / dress, shirt, sash, wig / wig_long.
# Shaved heads are the bare skull: both wigs hidden. Skin and collar colours are set at runtime.
#
# No leopard skin (funerary), no nemes or crowns, nothing purple (amethyst #A21CAF is this world's
# signal: no saturated colour in 255-335 degrees anywhere).
import math

from mathutils import Vector

import figures_geo as geo
import figures_rig as rig
from figures_geo import Part, clamp, lerp, smooth

TAU = geo.TAU

# name: (sRGB base colour, roughness, metallic, sheen weight, sheen tint sRGB, double sided)
# Near-duplicate linens differ by a hair so the optimiser's dedup keeps them as separate materials.
MATERIALS = {
    'skin': ((0.58, 0.39, 0.27), 0.72, 0.0, 0.0, None, False),  # recoloured per persona at runtime
    'kilt': ((0.955, 0.94, 0.89), 0.90, 0.0, 0.35, (1.0, 0.98, 0.94), True),
    'shirt': ((0.925, 0.905, 0.855), 0.90, 0.0, 0.35, (1.0, 0.98, 0.94), True),
    'dress': ((0.935, 0.915, 0.86), 0.88, 0.0, 0.40, (1.0, 0.98, 0.94), True),
    'sash': ((0.95, 0.935, 0.89), 0.90, 0.0, 0.35, (1.0, 0.98, 0.94), True),
    'belt': ((0.62, 0.50, 0.34), 0.80, 0.0, 0.0, None, True),
    'wig': ((0.065, 0.052, 0.048), 0.55, 0.0, 0.2, (0.5, 0.45, 0.4), False),
    'wig_long': ((0.07, 0.056, 0.05), 0.55, 0.0, 0.2, (0.5, 0.45, 0.4), True),
    'hair': ((0.075, 0.06, 0.052), 0.6, 0.0, 0.0, None, False),
    # The collar's persona colour: the runtime tints it. Default faience turquoise.
    'trim': ((0.10, 0.58, 0.60), 0.38, 0.0, 0.0, None, True),
    'gold': ((0.86, 0.66, 0.20), 0.30, 0.85, 0.0, None, True),
    'bead': ((0.88, 0.82, 0.66), 0.50, 0.0, 0.0, None, True),
    'sandal': ((0.72, 0.62, 0.42), 0.85, 0.0, 0.0, None, True),
    'wood': ((0.42, 0.26, 0.14), 0.70, 0.0, 0.0, None, False),
    'palette_wood': ((0.80, 0.66, 0.44), 0.70, 0.0, 0.0, None, False),   # the scribe's pale palette
    'reed': ((0.74, 0.62, 0.42), 0.62, 0.0, 0.0, None, False),
    'ink': ((0.05, 0.05, 0.06), 0.40, 0.0, 0.0, None, True),
    'ink_red': ((0.55, 0.16, 0.10), 0.45, 0.0, 0.0, None, False),
    'papyrus': ((0.86, 0.78, 0.55), 0.85, 0.0, 0.0, None, True),
    'clay': ((0.66, 0.38, 0.24), 0.85, 0.0, 0.0, None, False),
    'wax': ((0.93, 0.86, 0.66), 0.55, 0.0, 0.0, None, False),  # tallow-soaked rush wick
    'flame': ((1.0, 0.74, 0.36), 0.5, 0.0, 0.0, None, False),
}
HIDEABLE = ('kilt', 'belt', 'dress', 'shirt', 'sash', 'wig', 'wig_long')

WAIST_Z = rig.WAIST_RING[3]


def wrap(th):
    return (th + math.pi) % TAU - math.pi


# ---------------------------------------------------------------- torso (bare chest)


def torso(part):
    n = 28
    thetas = [TAU * j / n for j in range(n)]
    zs = [0.94] + [z for z in geo.TORSO_Z if z > 0.94]
    rows = [[geo.robe_point(th, z) for th in thetas] for z in zs]
    part.grid(rows, True, lambda i, j: 'skin', lambda i, j, p: geo.robe_weights(thetas[j], p))


def shirt(part):
    """A light linen tunic over the torso: cap sleeves where it meets the shoulders."""
    n = 28
    thetas = [TAU * j / n for j in range(n)]
    zs = [0.962, 1.00, 1.06, 1.13, 1.20, 1.255, 1.29, 1.312, 1.332, 1.346]
    rows = [[geo.robe_point(th, z, 0.011) for th in thetas] for z in zs]
    part.grid(rows, True, lambda i, j: 'shirt', lambda i, j, p: geo.robe_weights(thetas[j], p))


# ---------------------------------------------------------------- kilt (shendyt) and sheath dress


def skirt_ellipse(th, z, fx, fy, offset):
    cy, rx, ry = geo.skirt_ring(z)
    p = geo.superellipse(0, cy, rx * fx + offset, ry * fy + offset, th, 2.0)
    p.z = z
    return p


def kilt(part, hem, apron):
    """Pleated linen kilt to the knee: a belt band at the waist, fine zigzag pleats and a
    projecting front panel (the shendyt's triangular apron)."""
    n = 56                                   # 28 pleats, deep enough to catch the light
    zs = [WAIST_Z + 0.005, 0.935]
    steps = 5
    zs += [0.935 + (hem - 0.935) * (k + 1) / steps for k in range(steps)]
    thetas = [TAU * j / n for j in range(n)]
    rows = []
    for z in zs:
        k = smooth(WAIST_Z, 0.5, z)
        f = lerp(1.03, 0.93, k)
        t = clamp((WAIST_Z - z) / (WAIST_Z - hem))
        row = []
        for j, th in enumerate(thetas):
            p = skirt_ellipse(th, z, f, f, 0.014)
            out = Vector((math.sin(th), -math.cos(th), 0))
            if z < 0.945:
                p += out * (0.0105 * smooth(0.945, 0.86, z) * (1 if j % 2 == 0 else -1))
            if apron:
                p.y -= 0.065 * (t ** 1.3) * math.exp(-(wrap(th) / 0.40) ** 2)
            row.append(p)
        rows.append(row)
    part.grid(rows, True, lambda i, j: 'belt' if i == 0 else 'kilt',
              lambda i, j, p: geo.robe_weights(thetas[j], p))


def dress(part):
    """Sheath dress (kalasiris) from under the collar to the ankle."""
    n = 28
    thetas = [TAU * j / n for j in range(n)]
    hem = 0.075
    torso_z = [1.25, 1.19, 1.12, 1.05, 1.0]
    skirt_z = [0.965, 0.90, 0.80, 0.68, 0.55, 0.42, 0.30, 0.18, hem]
    rows = [[geo.robe_point(th, z, 0.0095) for th in thetas] for z in torso_z]
    for z in skirt_z:
        k = smooth(WAIST_Z, hem, z)
        fx, fy = lerp(1.04, 0.80, k), lerp(1.04, 0.64, k)
        rows.append([skirt_ellipse(th, z, fx, fy, 0.010) for th in thetas])
    part.grid(rows, True, lambda i, j: 'dress', lambda i, j, p: geo.robe_weights(thetas[j], p))


def sash(part):
    """The lector priest's white sash: over the right shoulder, diagonally across the chest to the
    left hip, and back round behind."""
    path = [(-200, 1.00), (-150, 1.13), (-100, 1.27), (-45, 1.343), (0, 1.245), (40, 1.125),
            (85, 1.00)]
    hw = 0.032
    rows = []
    for deg, z in path:
        th = math.radians(deg)
        rows.append([geo.robe_point(th, z + hw, 0.028), geo.robe_point(th, z - hw, 0.028)])

    def w(i, j, p):
        th = math.radians(path[i][0])
        return geo.robe_weights(th % TAU, p)

    # a ribbon: one quad strip, so thetas are in `path` order
    part.grid(rows, False, lambda i, j: 'sash', w, flip=None)


# ---------------------------------------------------------------- broad collar (wesekh)

COLLAR_U = [0.0, 0.10, 0.30, 0.50, 0.58, 0.88, 1.0]
COLLAR_BANDS = ['gold', 'trim', 'trim', 'bead', 'trim', 'gold']


def collar(part, scale=1.0):
    n = 36
    thetas = [TAU * j / n for j in range(n)]
    z0 = 1.372

    def depth(th):
        front = max(0.0, math.cos(th))
        back = max(0.0, -math.cos(th))
        return (0.088 + 0.100 * front ** 2 + 0.036 * back) * scale

    rows = []
    for ui, u in enumerate(COLLAR_U):
        row = []
        for j, th in enumerate(thetas):
            z = z0 - depth(th) * u
            if ui == len(COLLAR_U) - 1 and j % 2 == 1:
                z -= 0.012 * scale  # pendant drops along the outer edge
            row.append(geo.robe_point(th, z, 0.014 + 0.006 * u))
        rows.append(row)
    part.grid(rows, True, lambda i, j: COLLAR_BANDS[i], lambda i, j, p: geo.robe_weights(thetas[j], p))


# ---------------------------------------------------------------- arms, legs, sandals

ARM = {'mat': 'skin', 'past_wrist': 0.012, 'trim_u': [], 'cuff': False,
       'radii': [0.052, 0.050, 0.047, 0.044, 0.042, 0.039, 0.036, 0.034, 0.031, 0.028, 0.026],
       'droop': [0] * 11}

FOOT = [(-0.065, 0.026, 0.045), (-0.05, 0.034, 0.075), (-0.01, 0.040, 0.092), (0.04, 0.044, 0.052),
        (0.09, 0.042, 0.036), (0.13, 0.032, 0.028), (0.165, 0.018, 0.022), (0.185, 0.004, 0.016)]
SOLE = [(-0.075, 0.030), (-0.055, 0.040), (-0.01, 0.046), (0.04, 0.050), (0.09, 0.048),
        (0.13, 0.038), (0.165, 0.022), (0.19, 0.008)]


def foot_frame(side):
    Hj, K, A, T = rig.leg_rest(side)
    s = rig.SIGN[side]
    fwd = Vector((s * 0.09, -1, 0)).normalized()
    lat = Vector((-fwd.y, fwd.x, 0)) * s
    return Vector((A.x, A.y, 0.0)), fwd, lat


def sandal_foot(part, side):
    """Bare foot in a papyrus sandal: flat sole and one strap across the instep."""
    base, fwd, lat = foot_frame(side)
    ft, sh = f'foot.{side}', f'shin.{side}'
    rows = []
    for d, hw, top in FOOT:
        c = base + fwd * d
        ring = []
        for j in range(10):
            ang = TAU * j / 10
            x, y = math.cos(ang), math.sin(ang)
            z = 0.012 + (top - 0.012) * (0.5 + 0.5 * y) if y > -0.7 else 0.012
            ring.append(c + lat * (hw * x) + Vector((0, 0, z)))
        rows.append(ring)

    def w(i, j, p):
        return {ft: 1.0} if p.z < 0.07 else {ft: 0.7, sh: 0.3}

    ids = part.grid(rows, True, lambda i, j: 'skin', w)
    part.fan(ids[0], base + fwd * -0.07 + Vector((0, 0, 0.04)), {ft: 1}, 'skin')
    part.fan(ids[-1], base + fwd * 0.19 + Vector((0, 0, 0.02)), {ft: 1}, 'skin')
    # sole: a flat slab under the foot
    outline = [(d, hw) for d, hw in SOLE] + [(d, -hw) for d, hw in reversed(SOLE)]
    bot = [part.vert(base + fwd * d + lat * hw + Vector((0, 0, 0.0)), {ft: 1.0}) for d, hw in outline]
    top = [part.vert(base + fwd * d + lat * hw + Vector((0, 0, 0.012)), {ft: 1.0}) for d, hw in outline]
    m = len(outline)
    for k in range(m):
        k2 = (k + 1) % m
        part.face((bot[k], bot[k2], top[k2], top[k]), 'sandal')
    part.face(top, 'sandal')
    part.face(bot[::-1], 'sandal')
    # strap over the instep
    strap = []
    for d, hw0, tp in ((0.035, 0.044, 0.056), (0.052, 0.044, 0.050)):
        c = base + fwd * d
        strap.append([c + lat * (hw0 * math.cos(a)) +
                      Vector((0, 0, 0.012 + (tp - 0.012) * (0.5 + 0.5 * math.sin(a)) + 0.003))
                      for a in (math.radians(v) for v in range(0, 181, 30))])
    part.grid(strap, False, lambda i, j: 'sandal', lambda i, j, p: {ft: 1.0})


def legs(part):
    for side in rig.SIDES:
        Hj, K, A, T = rig.leg_rest(side)
        th, sh, ft = f'thigh.{side}', f'shin.{side}', f'foot.{side}'
        pts = [Hj + Vector((0, 0, 0.03)), Hj.lerp(K, 0.4), K.lerp(Hj, 0.08), K, K.lerp(A, 0.1),
               K.lerp(A, 0.55), A + Vector((0, 0, 0.03))]
        radii = [0.064, 0.060, 0.054, 0.052, 0.049, 0.040, 0.032]
        ws = [{th: 1}, {th: 1}, {th: 0.8, sh: 0.2}, {th: 0.5, sh: 0.5}, {sh: 0.85, th: 0.15},
              {sh: 1}, {sh: 0.6, ft: 0.4}]
        geo.tube(part, pts, radii, ws, 'skin')
        sandal_foot(part, side)


# ---------------------------------------------------------------- wigs and the youth lock


def wig_shell(part, mat, lower=1.41, sides=1.455):
    """Short rounded wig: closes the crown, covers the ears and ends at the nape."""
    n = 28
    thetas = [TAU * j / n for j in range(n)]

    def z_low(th):
        a = abs(wrap(th))
        if a <= math.pi / 2:
            return lerp(1.50, sides, smooth(math.radians(40), math.pi / 2, a))
        return lerp(sides, lower, smooth(math.pi / 2, math.radians(150), a))

    us = [0.0, 0.2, 0.42, 0.66, 0.86]
    rows = []
    for i, u in enumerate(us):
        row = []
        for th in thetas:
            zl = z_low(th)
            z = lerp(zl, 1.585, u)
            base = geo.head_surface(th, z, False)
            out = Vector((math.sin(th), -math.cos(th), 0)).normalized()
            t = 0.009 + 0.012 * smooth(0.0, 0.4, u) + (0.0035 if i % 2 else 0.0)
            p = base + out * t + Vector((0, 0, 0.5 * t * smooth(0.5, 1.0, u)))
            row.append(p)
        rows.append(row)
    ids = part.grid(rows, True, lambda i, j: mat, lambda i, j, p: {'head': 1.0})
    apex = geo.head_surface(0.0, 1.612, False)
    apex.y = -0.004
    apex.z = 1.612 + 0.016
    part.fan(ids[-1], apex, {'head': 1.0}, mat)


def wig_long(part):
    """A long wig for women: the short wig's cap plus a curtain falling behind and in two front
    lappets over the collar."""
    wig_shell(part, 'wig_long', lower=1.43, sides=1.45)
    cols = [math.radians(a) for a in range(38, 323, 19)]
    keys = [(1.43, 0.0), (1.36, 1.0), (1.30, 2.0), (1.235, 3.0)]
    shape = {1.43: (0.098, 0.108, -0.004), 1.36: (0.112, 0.104, 0.012),
             1.30: (0.158, 0.118, 0.010), 1.235: (0.168, 0.124, 0.012)}

    def bottom(th):
        a = abs(wrap(th))
        return lerp(1.20, 1.255, smooth(math.radians(150), math.radians(60), a))

    rows = []
    for z, _ in keys:
        rx, ry, cy = shape[z]
        row = []
        for th in cols:
            zz = z if z > 1.236 else bottom(th)
            if z == 1.43:
                p = geo.head_surface(th, 1.43, False)
                p += Vector((math.sin(th), -math.cos(th), 0)).normalized() * 0.022
            else:
                p = geo.superellipse(0, cy, rx, ry, th, 2.2)
            p.z = zz
            row.append(p)
        rows.append(row)

    def w(i, j, p):
        t = smooth(1.40, 1.30, p.z)
        return geo.mix((geo.head_weights(p.z) if p.z >= 1.355 else {'neck': 1.0}, 1 - t),
                       ({'chest': 1.0}, t))

    part.grid(rows, False, lambda i, j: 'wig_long', w)


def sidelock(part):
    """A pupil's side-lock of youth: a braid over the right ear down to the shoulder."""
    pts = [Vector(v) for v in ((-0.078, 0.000, 1.515), (-0.094, 0.004, 1.470), (-0.102, 0.004, 1.420),
                                (-0.108, -0.002, 1.372), (-0.112, -0.010, 1.332))]
    ws = [{'head': 1.0}, {'head': 0.8, 'neck': 0.2}, {'neck': 0.6, 'head': 0.4}, {'neck': 0.7, 'chest': 0.3},
          {'chest': 1.0}]
    geo.tube(part, pts, [0.011, 0.010, 0.0095, 0.009, 0.0085], ws, 'hair', n=6,
             cap_end=pts[-1] + Vector((0, -0.003, -0.012)), cap_start=pts[0] + Vector((0.004, 0, 0.004)))


# ---------------------------------------------------------------- assembly


def build_body(kind):
    pupil = kind == 'apprentice'
    part = Part()
    torso(part)
    kilt(part, hem=0.62 if pupil else 0.52, apron=not pupil)
    if not pupil:
        dress(part)
        shirt(part)
        sash(part)
    for side in rig.SIDES:
        geo.build_sleeve(part, side, ARM)
        geo.build_hand(part, side)
    legs(part)
    geo.build_head(part, {'young': pupil, 'beard': False, 'hair': False,
                          'head_scale': 1.05 if pupil else 1.0})
    if pupil:
        sidelock(part)
    else:
        wig_shell(part, 'wig')
        wig_long(part)
    collar(part, 0.80 if pupil else 1.0)
    return part


# ---------------------------------------------------------------- look-check renders


def show_variant(bpy, mats, visible, skin=None):
    """Render-only: hide the hideable materials not in `visible` (alpha 0), optionally tint skin."""
    for name in HIDEABLE:
        bsdf = mats[name].node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Alpha'].default_value = 1.0 if name in visible else 0.0
    if skin:
        bsdf = mats['skin'].node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*skin, 1)
