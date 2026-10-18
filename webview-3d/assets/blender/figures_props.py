# Hand props and the desk candle for the figurines.
#
# Each prop is built in a grip frame: x = fingers direction, y = palm normal, z = x cross y
# (the thumb side is +z for the right hand, -z for the left). The prop object is parented to
# its hand bone so it follows every clip; it is exported hidden (extras.hidden) and the runtime
# shows the one a clip needs.
import math

import bpy
from mathutils import Matrix, Quaternion, Vector

import figures_geo as geo
import figures_rig as rig

TAU = 2 * math.pi
GRIP_A = 0.075  # grip point: along the fingers from the wrist
GRIP_N = 0.025  # and out from the palm, inside the curl of the fingers

PROPS = {
    # name: (hand side, clip that shows it)
    'prop_reed_pen': ('R', 'write'),
    'prop_codex': ('L', 'read'),
    'prop_astrolabe': ('L', 'astrolabe'),
    'prop_scroll': ('L', 'scroll_search'),
    'prop_letter': ('R', 'receive_letter'),
}
SCROLL_FREE_EDGE = Vector((0.0, 0.30, 0.0))  # grip-frame point the right hand holds
LETTER_W, LETTER_H = 0.13, 0.165
LETTER_CORNER = Vector((0.0, 0.0, -LETTER_W))  # right-hand grip frame: the corner the left hand holds


def grip_matrix_rest(side):
    W, a, n, t = geo.hand_rest_frame(side)
    M = Matrix.Identity(4)
    M.col[0][:3] = a
    M.col[1][:3] = n
    M.col[2][:3] = a.cross(n)
    M.col[3][:3] = W + a * GRIP_A + n * GRIP_N
    return M


def thumb_z(side):
    return 1.0 if side == 'R' else -1.0


def P():
    return geo.Part()


def nw(*_):
    return {}


def ring(c, u, v, r, n):
    return [c + (u * math.cos(TAU * j / n) + v * math.sin(TAU * j / n)) * r for j in range(n)]


def cylinder(part, a, b, r, n, mat, caps=True, r_b=None):
    d = (b - a).normalized()
    ref = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
    u = d.cross(ref).normalized()
    v = d.cross(u)
    rows = [ring(a, u, v, r, n), ring(b, u, v, r if r_b is None else r_b, n)]
    ids = part.grid(rows, True, lambda i, j: mat, nw)
    if caps:
        part.fan(ids[0], a - d * 0.0005, {}, mat)
        part.fan(ids[1], b + d * 0.0005, {}, mat)


def box(part, c, hx, hy, hz, mat, rot=None):
    rot = rot or Matrix.Identity(3)
    corners = [c + rot @ Vector((sx * hx, sy * hy, sz * hz))
               for sz in (-1, 1) for sy in (-1, 1) for sx in (-1, 1)]
    ids = [part.vert(p, {}) for p in corners]
    faces = [(0, 2, 3, 1), (4, 5, 7, 6), (0, 1, 5, 4), (2, 6, 7, 3), (0, 4, 6, 2), (1, 3, 7, 5)]
    for f in faces:
        part.face([ids[i] for i in f], mat)


def torus(part, c, axis, R, r, n_major, n_minor, mat):
    axis = axis.normalized()
    ref = Vector((1, 0, 0)) if abs(axis.x) < 0.9 else Vector((0, 1, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u)
    rows = []
    for i in range(n_major + 1):
        a = TAU * i / n_major
        cc = c + (u * math.cos(a) + v * math.sin(a)) * R
        radial = (cc - c).normalized()
        rows.append(ring(cc, radial, axis, r, n_minor))
    rows = rows[:-1]
    # close the major loop by wrapping rows: grid over rows + first row again
    part.grid(rows + [rows[0]], True, lambda i, j: mat, nw)


def ink_lines(part, origin, along, across, normal, n_lines, length, gap, width=0.0016):
    for k in range(n_lines):
        o = origin + across * (k * gap) + normal * 0.0008
        lk = length * (0.65 + 0.35 * ((k * 7) % 5) / 4)
        quad = [o, o + along * lk, o + along * lk + across * width, o + across * width]
        ids = [part.vert(p, {}) for p in quad]
        part.face(ids, 'ink')


# ---------------------------------------------------------------- the props (grip frame)


def reed_pen(side):
    part = P()
    tz = thumb_z(side)
    u = Vector((0.70, 0.62, 0.36 * tz)).normalized()
    c0 = Vector((-0.004, -0.004, 0.010 * tz))
    rear, tip = c0 - u * 0.125, c0 + u * 0.062
    cut = tip - u * 0.016
    cylinder(part, rear, cut, 0.0043, 6, 'reed')
    cylinder(part, cut, tip - u * 0.006, 0.0043, 6, 'reed', caps=False, r_b=0.0022)
    cylinder(part, tip - u * 0.006, tip, 0.0022, 6, 'ink', r_b=0.0006)
    return part


def codex(side):
    """An open codex lying on the palm, spine along the fingers. Returns (book, page leaf)."""
    part = P()
    tilt = math.radians(10)
    y0 = 0.006
    length, half_w, block = 0.19, 0.128, 0.014
    for sgn in (-1, 1):
        rot = Matrix.Rotation(-sgn * tilt, 3, 'X')
        c = Vector((0.012, y0, 0)) + rot @ Vector((0, 0, sgn * (half_w / 2 + 0.003)))
        box(part, c + rot @ Vector((0, -0.002, 0)), length / 2 + 0.006, 0.002, half_w / 2 + 0.006,
            'codex_cover', rot)
        box(part, c + rot @ Vector((0, block / 2, 0)), length / 2, block / 2, half_w / 2, 'parchment', rot)
        top = Vector((0.012, y0, 0)) + rot @ Vector((-length / 2 + 0.018, block + 0.0006, sgn * 0.012))
        ink_lines(part, top, rot @ Vector((1, 0, 0)), rot @ Vector((0, 0, sgn)), rot @ Vector((0, 1, 0)),
                  9, length - 0.036, 0.0105)
    box(part, Vector((0.012, y0 - 0.003, 0)), length / 2 + 0.006, 0.004, 0.008, 'codex_cover')
    # Page leaf, hinged on the spine; starts on the reader's left half (the side away from the
    # thumb for the left hand) and turns over to the right, as an Arabic codex reads.
    leaf = P()
    rows = []
    for k in range(5):
        f = k / 4
        z = -tz_left(side) * f * half_w
        y = math.sin(tilt) * f * half_w + 0.004 * math.sin(math.pi * f)
        rows.append([Vector((-length / 2 + 0.003, y, z)), Vector((length / 2 - 0.003, y, z))])
    leaf.grid(rows, False, lambda i, j: 'parchment', nw, flip=False)
    hinge = Vector((0.012, y0 + block + 0.0012, 0))
    return part, leaf, hinge


def tz_left(side):
    """+1 if the grip frame's +z points to the reader's right when the palm faces up."""
    return 1.0 if side == 'L' else -1.0


def astrolabe(side):
    part = P()
    hang = Vector((0, 0, -thumb_z(side)))  # out of the little-finger side of the fist
    x, y = Vector((1, 0, 0)), Vector((0, 1, 0))
    torus(part, hang * 0.004, x, 0.017, 0.0028, 14, 6, 'brass')
    # throne (kursi): a small lobed plate between the ring and the disc
    for k, (hw, d) in enumerate(((0.010, 0.022), (0.016, 0.032), (0.012, 0.040))):
        box(part, hang * d, hw, 0.0025, 0.005, 'brass')
    c = hang * 0.125
    R = 0.085
    rows = [ring(c + y * 0.004, x, hang, R, 28), ring(c - y * 0.004, x, hang, R, 28)]
    ids = part.grid(rows, True, lambda i, j: 'brass', nw)
    part.fan(ids[0], c + y * 0.0042, {}, 'brass')
    part.fan(ids[1], c - y * 0.0042, {}, 'brass')
    # limb: the raised rim of the front (palm-facing) side
    rows = [ring(c + y * 0.004, x, hang, R, 28), ring(c + y * 0.0075, x, hang, R - 0.001, 28),
            ring(c + y * 0.0075, x, hang, R - 0.009, 28), ring(c + y * 0.0042, x, hang, R - 0.010, 28)]
    part.grid(rows, True, lambda i, j: 'brass', nw)
    # alidade across the back
    box(part, c - y * 0.0058, 0.0065, 0.0018, R * 0.95, 'brass')
    # rete: six star pointers on a ring, six-fold symmetric so a 60 degree turn loops seamlessly
    rete = P()
    rows = [ring(Vector(), x, hang, 0.066, 24), ring(Vector(), x, hang, 0.058, 24)]
    rete.grid(rows, True, lambda i, j: 'brass', nw, flip=False)
    rete.grid(rows, True, lambda i, j: 'brass', nw, flip=True)
    for k in range(6):
        a = TAU * k / 6
        d = x * math.cos(a) + hang * math.sin(a)
        p = x * -math.sin(a) + hang * math.cos(a)
        tri = [d * 0.012 + p * 0.006, d * 0.077, d * 0.012 - p * 0.006]
        ids = [rete.vert(q + y * 0.0006, {}) for q in tri]
        rete.face(ids, 'brass')
        rete.face(ids[::-1], 'brass')
    cylinder(rete, -y * 0.012, y * 0.004, 0.004, 8, 'brass')
    return part, rete, c + y * 0.0078


def scroll(side):
    part = P()
    tz = thumb_z(side)
    z = Vector((0, 0, 1))
    cylinder(part, -z * 0.115, z * 0.115, 0.019, 10, 'parchment')
    for s in (-1, 1):
        cylinder(part, z * s * 0.115, z * s * 0.13, 0.006, 6, 'reed')
    rows = []
    n = 7
    for k in range(n):
        f = k / (n - 1)
        yy = 0.018 + f * (SCROLL_FREE_EDGE.y - 0.018)
        xx = -0.016 * math.sin(math.pi * f)  # the sheet bows a little
        rows.append([Vector((xx, yy, -0.105)), Vector((xx, yy, 0.105))])
    part.grid(rows, False, lambda i, j: 'parchment', nw, flip=False)
    ink_lines(part, Vector((-0.014, 0.05, 0.085 * tz)), Vector((0, 1, 0)), Vector((0, 0, -tz)),
              Vector((-1, 0, 0)), 14, 0.21, 0.012)
    cylinder(part, SCROLL_FREE_EDGE - z * 0.11, SCROLL_FREE_EDGE + z * 0.11, 0.011, 8, 'parchment')
    return part


def letter(side):
    """A sheet held upright by its lower corner: it rises along the fingers (x) and spreads
    away from the thumb (-z for the right hand) towards the other hand. Folded once, sealed."""
    part = P()
    tz = thumb_z(side)
    rows = []
    for k in range(3):  # three columns across the width, the middle one is the fold
        zz = -tz * LETTER_W * k / 2 + tz * 0.008
        yy = -0.006 if k == 1 else 0.0
        rows.append([Vector((-0.012, yy, zz)), Vector((LETTER_H, yy, zz))])
    part.grid(rows, False, lambda i, j: 'parchment', nw, flip=False)
    ink_lines(part, Vector((0.02, 0.0012, -tz * 0.012)), Vector((0, 0, -tz)), Vector((1, 0, 0)),
              Vector((0, 1, 0)), 9, LETTER_W - 0.03, 0.014)
    cylinder(part, Vector((LETTER_H * 0.45, -0.001, -tz * LETTER_W * 0.5)),
             Vector((LETTER_H * 0.45, -0.0045, -tz * LETTER_W * 0.5)), 0.010, 10, 'codex_cover')
    return part


# ---------------------------------------------------------------- objects


def make_object(name, part, mats, parent=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in part.V], [], part.F)
    order = []
    for m in part.M:
        if m not in order:
            order.append(m)
    for m in order:
        me.materials.append(mats[m])
    idx = {m: i for i, m in enumerate(order)}
    me.polygons.foreach_set('material_index', [idx[m] for m in part.M])
    me.update()
    me.validate()
    me.shade_smooth()
    me.set_sharp_from_angle(angle=math.radians(35))
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.rotation_mode = 'QUATERNION'
    if parent is not None:
        ob.parent = parent
    return ob


def attach_to_bone(ob, arm_ob, rest, bone, arm_space_matrix):
    ob.parent = arm_ob
    ob.parent_type = 'BONE'
    ob.parent_bone = bone
    ob.matrix_parent_inverse = Matrix.Identity(4)
    ob.matrix_basis = rig.bone_tail_matrix(rest, bone).inverted() @ arm_space_matrix


def build_props(kind, arm_ob, rest, mats):
    """All five props for one figure, hidden by default. Returns {name: object}."""
    out = {}
    for name, (side, _clip) in PROPS.items():
        G = grip_matrix_rest(side)
        child = None
        if name == 'prop_reed_pen':
            part = reed_pen(side)
        elif name == 'prop_codex':
            part, leaf, hinge = codex(side)
            child = ('prop_codex_page', leaf, hinge)
        elif name == 'prop_astrolabe':
            part, rete, centre = astrolabe(side)
            child = ('prop_astrolabe_rete', rete, centre)
        elif name == 'prop_scroll':
            part = scroll(side)
        else:
            part = letter(side)
        ob = make_object(name, part, mats)
        attach_to_bone(ob, arm_ob, rest, f'hand.{side}', G)
        ob['hidden'] = True
        ob.hide_render = True
        if child:
            cname, cpart, pivot = child
            co = make_object(cname, cpart, mats, parent=ob)
            co.location = pivot
        out[name] = ob
    return out


def animated_parts(prop_obs):
    """Prop parts driven by pose scalars: key -> (object, local axis, value -> angle)."""
    page = next(c for c in prop_obs['prop_codex'].children if c.name.startswith('prop_codex_page'))
    rete = next(c for c in prop_obs['prop_astrolabe'].children if c.name.startswith('prop_astrolabe_rete'))
    page_axis = Vector((1, 0, 0)) * tz_left('L')
    return {
        's_page': (page, page_axis, lambda v: math.radians(160) * v),
        's_rete': (rete, Vector((0, 1, 0)), lambda v: math.radians(60) * v),
    }


def hand_point_local(rest, side, point):
    """A grip-frame point of a prop held in `side`, relative to that hand bone's frame."""
    return rest[f'hand.{side}']['M'].inverted() @ grip_matrix_rest(side) @ Matrix.Translation(point)


def tri_count(ob):
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    return n + sum(tri_count(c) for c in ob.children)


def props_meta():
    return {name: {'hand': f'hand.{side}', 'clip': clip, 'hiddenByDefault': True,
                   'parts': {'prop_codex': ['prop_codex_page'],
                             'prop_astrolabe': ['prop_astrolabe_rete']}.get(name, [])}
            for name, (side, clip) in PROPS.items()}


# ---------------------------------------------------------------- candle

WAX_BASE = 0.024
WAX_HEIGHT = 0.11


def build_candle(mats):
    """Desk candle: `candle` (brass dish) > `candle_wax` (origin at its base, scale Y for the
    context gauge) and `candle_flame` (place it at waxBaseY + waxHeight * wax.scale.y)."""
    holder = P()
    z = Vector((0, 0, 1))
    x, y = Vector((1, 0, 0)), Vector((0, 1, 0))
    rows = [ring(Vector((0, 0, 0.0)), x, y, 0.040, 20), ring(Vector((0, 0, 0.004)), x, y, 0.046, 20),
            ring(Vector((0, 0, 0.012)), x, y, 0.047, 20), ring(Vector((0, 0, 0.010)), x, y, 0.041, 20),
            ring(Vector((0, 0, 0.007)), x, y, 0.020, 20), ring(Vector((0, 0, WAX_BASE)), x, y, 0.016, 20),
            ring(Vector((0, 0, WAX_BASE)), x, y, 0.012, 20)]
    ids = holder.grid(rows, True, lambda i, j: 'brass', nw, flip=False)
    holder.fan(ids[0], Vector((0, 0, 0.0)), {}, 'brass')
    torus(holder, Vector((0.054, 0, 0.008)), y, 0.011, 0.0025, 12, 5, 'brass')
    candle = make_object('candle', holder, mats)
    wax = P()
    rows = [ring(Vector((0, 0, 0)), x, y, 0.0118, 14), ring(Vector((0, 0, WAX_HEIGHT - 0.006)), x, y, 0.0118, 14),
            ring(Vector((0, 0, WAX_HEIGHT)), x, y, 0.0095, 14)]
    ids = wax.grid(rows, True, lambda i, j: 'wax', nw)
    wax.fan(ids[-1], Vector((0, 0, WAX_HEIGHT - 0.002)), {}, 'wax')
    wax_ob = make_object('candle_wax', wax, mats, parent=candle)
    wax_ob.location = (0, 0, WAX_BASE)
    flame = P()
    cylinder(flame, Vector((0, 0, -0.004)), Vector((0, 0, 0.007)), 0.0012, 5, 'ink')
    prof = [(0.004, 0.0), (0.008, 0.0042), (0.014, 0.0055), (0.022, 0.0042), (0.031, 0.0018)]
    rows = [ring(Vector((0, 0, h)), x, y, r, 10) for h, r in prof]
    ids = flame.grid(rows, True, lambda i, j: 'flame', nw)
    flame.fan(ids[-1], Vector((0, 0, 0.037)), {}, 'flame')
    flame_ob = make_object('candle_flame', flame, mats, parent=candle)
    flame_ob.location = (0, 0, WAX_BASE + WAX_HEIGHT)
    meta = {'node': 'candle', 'wax': 'candle_wax', 'flame': 'candle_flame',
            'waxBaseY': WAX_BASE, 'waxHeight': WAX_HEIGHT,
            'note': 'scale candle_wax.y by the remaining fraction; set candle_flame.position.y = '
                    'waxBaseY + waxHeight * scale; hide both when the gauge is null'}
    return {'object': candle, 'wax': wax_ob, 'flame': flame_ob, 'meta': meta}
