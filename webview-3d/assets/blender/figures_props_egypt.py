# The House of Life's hand props and desk lamp. Same prop names, hands, grips and animated child
# names as figures_props.py (the clips are authored against them); only the objects change:
#   prop_reed_pen   a reed pen (write, right hand)
#   prop_codex      a writing board with papyrus sheets; one sheet turns over (read, left hand)
#   prop_astrolabe  a scribe's palette, two ink cakes and reed pens, a gold finial that swivels
#                   (the "astrolabe" clip, left hand)
#   prop_scroll     a papyrus roll (scroll_search); prop_letter a sealed papyrus (receive_letter)
import math

from mathutils import Matrix, Vector

import figures_props as base
from figures_props import P, box, cylinder, ink_lines, make_object, attach_to_bone, thumb_z, tz_left


def remap(part, table):
    part.M = [table.get(m, m) for m in part.M]
    return part


def writing_board(side):
    """A wooden writing board with a papyrus sheet; a second sheet hinged on the middle turns over.
    Returns (board, leaf, hinge) like figures_props.codex."""
    part = P()
    tilt = math.radians(10)
    y0 = 0.006
    length, half_w = 0.19, 0.128
    box(part, Vector((0.012, y0, 0)), length / 2 + 0.008, 0.005, half_w + 0.006, 'wood')
    box(part, Vector((0.012, y0 + 0.0062, 0)), length / 2, 0.0013, half_w - 0.006, 'papyrus')
    top = Vector((0.012 - length / 2 + 0.014, y0 + 0.0077, tz_left(side) * 0.01))
    ink_lines(part, top, Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0)), 9,
              length - 0.03, 0.0105)
    leaf = P()
    rows = []
    for k in range(5):
        f = k / 4
        z = -tz_left(side) * f * half_w
        y = math.sin(tilt) * f * half_w + 0.004 * math.sin(math.pi * f)
        rows.append([Vector((-length / 2 + 0.003, y, z)), Vector((length / 2 - 0.003, y, z))])
    leaf.grid(rows, False, lambda i, j: 'papyrus', lambda *_: {}, flip=False)
    hinge = Vector((0.012, y0 + 0.0085, 0))
    return part, leaf, hinge


def scribe_palette(side):
    """A scribe's palette held like a tray: a long wooden board with a slot of reed pens and two
    round ink cakes, black and red. The finial (child) is a gold rosette that swivels."""
    part = P()
    hang = Vector((0, 0, -thumb_z(side)))
    x, y = Vector((1, 0, 0)), Vector((0, 1, 0))
    # A2: larger and paler, so it reads as a palette at the default camera (a real one is ~30 x
    # 5 cm): pale wood with the two ink cakes standing out black and red
    box(part, hang * 0.14, 0.038, 0.008, 0.19, 'palette_wood')
    for d, mat in ((0.055, 'ink'), (0.12, 'ink_red')):
        cylinder(part, hang * d + y * 0.008, hang * d + y * 0.0135, 0.015, 12, mat)
    for sx in (-1, 1):
        a = hang * 0.175 + x * (sx * 0.011) + y * 0.0112
        cylinder(part, a, a + hang * 0.13, 0.0048, 6, 'reed')
        cylinder(part, a + hang * 0.13, a + hang * 0.143, 0.0048, 6, 'ink', r_b=0.0017)
    lid = P()
    cylinder(lid, -y * 0.0015, y * 0.0015, 0.0135, 12, 'gold')
    for k in range(6):
        a = math.tau * k / 6
        c = (x * math.cos(a) + hang * math.sin(a)) * 0.0105
        cylinder(lid, c + y * 0.0013, c + y * 0.0045, 0.0030, 6, 'gold')
    return part, lid, hang * 0.33 + y * 0.009


def scroll(side):
    return remap(base.scroll(side), {'parchment': 'papyrus'})


def letter(side):
    return remap(base.letter(side), {'parchment': 'papyrus', 'codex_cover': 'clay'})


def build_props(kind, arm_ob, rest, mats):
    out = {}
    for name, (side, _clip) in base.PROPS.items():
        G = base.grip_matrix_rest(side)
        child = None
        if name == 'prop_reed_pen':
            part = base.reed_pen(side)
        elif name == 'prop_codex':
            part, leaf, hinge = writing_board(side)
            child = ('prop_codex_page', leaf, hinge)
        elif name == 'prop_astrolabe':
            part, lid, pivot = scribe_palette(side)
            child = ('prop_astrolabe_rete', lid, pivot)
        elif name == 'prop_scroll':
            part = scroll(side)
        else:
            part = letter(side)
        ob = make_object(name, part, mats)
        attach_to_bone(ob, arm_ob, rest, f'hand.{side}', G)
        ob['hidden'] = True
        ob.hide_render = True
        if child:
            cname, cpart, pv = child
            co = make_object(cname, cpart, mats, parent=ob)
            co.location = pv
        out[name] = ob
    return out


def build_candle(mats):
    """The desk lamp: `candle` (a clay oil-lamp stand) > `candle_wax` (an oil-soaked rush wick,
    origin at its base; the runtime scales it Y with the context left) and `candle_flame`.
    Same dimensions and node contract as the House of Wisdom's candle."""
    holder = P()
    x, y = Vector((1, 0, 0)), Vector((0, 1, 0))
    ring = base.ring
    rows = [ring(Vector((0, 0, 0.0)), x, y, 0.038, 18), ring(Vector((0, 0, 0.005)), x, y, 0.040, 18),
            ring(Vector((0, 0, 0.011)), x, y, 0.022, 18), ring(Vector((0, 0, 0.016)), x, y, 0.016, 18),
            ring(Vector((0, 0, 0.019)), x, y, 0.040, 18), ring(Vector((0, 0, 0.024)), x, y, 0.048, 18),
            ring(Vector((0, 0, 0.024)), x, y, 0.014, 18)]
    ids = holder.grid(rows, True, lambda i, j: 'clay', lambda *_: {}, flip=False)
    holder.fan(ids[0], Vector((0, 0, 0.0)), {}, 'clay')
    # the lamp's pinched spout, pointing forward
    box(holder, Vector((0, -0.058, 0.0215)), 0.011, 0.012, 0.0035, 'clay')
    candle = make_object('candle', holder, mats)
    wax = P()
    rows = [ring(Vector((0, 0, 0)), x, y, 0.0118, 14),
            ring(Vector((0, 0, base.WAX_HEIGHT - 0.006)), x, y, 0.0118, 14),
            ring(Vector((0, 0, base.WAX_HEIGHT)), x, y, 0.0095, 14)]
    ids = wax.grid(rows, True, lambda i, j: 'wax', lambda *_: {})
    wax.fan(ids[-1], Vector((0, 0, base.WAX_HEIGHT - 0.002)), {}, 'wax')
    wax_ob = make_object('candle_wax', wax, mats, parent=candle)
    wax_ob.location = (0, 0, base.WAX_BASE)
    flame = P()
    cylinder(flame, Vector((0, 0, -0.004)), Vector((0, 0, 0.007)), 0.0012, 5, 'ink')
    prof = [(0.004, 0.0), (0.008, 0.0042), (0.014, 0.0055), (0.022, 0.0042), (0.031, 0.0018)]
    rows = [ring(Vector((0, 0, h)), x, y, r, 10) for h, r in prof]
    ids = flame.grid(rows, True, lambda i, j: 'flame', lambda *_: {})
    flame.fan(ids[-1], Vector((0, 0, 0.037)), {}, 'flame')
    flame_ob = make_object('candle_flame', flame, mats, parent=candle)
    flame_ob.location = (0, 0, base.WAX_BASE + base.WAX_HEIGHT)
    meta = {'node': 'candle', 'wax': 'candle_wax', 'flame': 'candle_flame',
            'waxBaseY': base.WAX_BASE, 'waxHeight': base.WAX_HEIGHT,
            'note': 'a clay oil lamp with a rush wick: scale candle_wax.y by the remaining fraction; '
                    'set candle_flame.position.y = waxBaseY + waxHeight * scale; hide both when '
                    'the gauge is null'}
    return {'object': candle, 'wax': wax_ob, 'flame': flame_ob, 'meta': meta}
