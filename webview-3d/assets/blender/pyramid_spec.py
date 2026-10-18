# House of Life: the Great Pyramid in the pool of Nun, as numbers. Pure numpy (no Blender).
# temple_parts.py builds the whole pyramid from BASE, HEIGHT, CAP_H and CASING_TOP: a complete
# square pyramid of polished white Tura casing under a gold pyramidion (Yousef's round C brief:
# the monument as imagined in its golden era, no cut, no interior). The interior figures below
# (passages, galleries, chambers) survive for one reader only: the gridded papyrus section on the
# Architects' chamber wall (temple_textures.papyrus_section), a drawing and not a model.
#
# Sizes after research.md 10c (Wikipedia, Great Pyramid of Giza): base 230.3 m, height 146.6 m,
# slope 51.84 deg (51 deg 50' 40"); descending passage 1.05 x 1.20 m at 26.5 deg; ascending
# passage at 26.1 deg; Grand Gallery 46.68 m long, 8.6 m high; Queen's Chamber 5.75 x 5.23 m,
# gable apex 6.23 m; King's Chamber 10.47 x 5.23 x 5.82 m, floor 43 m up; five relieving chambers
# above it. Rooms and passages are drawn 2x their size on the papyrus.
import math

import numpy as np

REAL_BASE = 230.3
REAL_HEIGHT = 146.6
SLOPE_DEG = 51.84
BASE = 5.5                      # model base (m)
K = BASE / REAL_BASE            # model metres per real metre (1:41.9)
INTERIOR = 2.0                  # rooms and passages drawn 2x their size
KI = K * INTERIOR
TAN = math.tan(math.radians(SLOPE_DEG))
HEIGHT = REAL_HEIGHT * K        # the true apex, 3.50 m
CAP_H = 0.42                    # the gold pyramidion that crowns it
CASING_TOP = HEIGHT - CAP_H     # where the white casing ends and the gold begins: 3.08 m
HALF = BASE / 2
SIN_SLOPE = math.sin(math.radians(SLOPE_DEG))

# Round E: the frieze of sacred signs low on each face, a band between two incised rules: ankh
# (S34), djed (R11), was (S40), life, stability, dominion, in that order, repeating. Only these
# three signs. FRIEZE_SIGNS is the single source of the sequence; render-hieroglyphs.mjs draws the
# same three from the vendored Noto font and the tests compare them.
FRIEZE_SIGNS = (0x132F9, 0x132BD, 0x13300)
FRIEZE_CENTRE = 0.14 * HEIGHT   # the band's centre line, 14% of the height up (0.49 m)
FRIEZE_PX = 4096                # the band texture's width: BASE metres across
FRIEZE_ROWS = 344               # and its height in texels; the same px/m both ways
FRIEZE_PXM = FRIEZE_PX / BASE
FRIEZE_SLANT = FRIEZE_ROWS / FRIEZE_PXM        # the band's extent measured up the face (m)
FRIEZE_SIGN_H = 0.20            # a sign, 20 cm up the face
FRIEZE_CELL = 0.20              # one sign's width of band (m): 21 cells, the middle one a djed
FRIEZE_CELLS = 21
FRIEZE_RULE = 0.15              # the rules sit this far (up the face) above and below the centre line


def half_width(h):
    """Half the pyramid's width at height h (model metres)."""
    return max(0.0, (HEIGHT - h) / TAN)


def frieze_band():
    """(h0, h1): the heights (m) where the frieze's strip of casing starts and ends."""
    d = FRIEZE_CENTRE / SIN_SLOPE
    return ((d - FRIEZE_SLANT / 2) * SIN_SLOPE, (d + FRIEZE_SLANT / 2) * SIN_SLOPE)


def real(s, h):
    """A real (s, h) in metres from the axis and base -> model metres."""
    return (s * K, h * K)


# Points on the passage plane, true places (model metres). s < 0 is north of the axis.
ENTRANCE = real(-(REAL_BASE / 2 - 16.98 / math.tan(math.radians(SLOPE_DEG))), 16.98)
DESC_DEG = 26.5
ASC_DEG = 26.1
GALLERY_FOOT = real(-41.0, 21.7)
GALLERY_TOP = real(-0.9, 42.4)
# the junction: where the ascending passage, run down from the gallery foot at 26.1 deg, meets
# the descending one
_t1, _t2 = math.tan(math.radians(DESC_DEG)), math.tan(math.radians(ASC_DEG))
_sj = (ENTRANCE[1] + ENTRANCE[0] * _t1 - GALLERY_FOOT[1] + GALLERY_FOOT[0] * _t2) / (_t1 + _t2)
JUNCTION = (_sj, ENTRANCE[1] - (_sj - ENTRANCE[0]) * _t1)
DESC_END = (ENTRANCE[0] + ENTRANCE[1] / _t1, 0.0)          # where it reaches the base level

PASSAGE_W, PASSAGE_H = 1.05 * KI, 1.20 * KI                # section of both sloping passages
GALLERY_H = 8.6 * KI                                        # vertical height of the gallery

QUEEN = dict(s=0.0, floor=GALLERY_FOOT[1], ns=5.75 * KI, ew=5.23 * KI, wall=4.7 * KI,
             apex=6.23 * KI, niche=dict(w=1.57 * KI, h=4.7 * KI, steps=4))
QUEEN_PASSAGE_H = 1.17 * KI
ANTE = dict(s0=GALLERY_TOP[0], s1=9.0 * K, floor=43.0 * K, h=3.8 * KI)
KING = dict(s0=9.0 * K, ns=5.23 * KI, ew=10.47 * KI, floor=43.0 * K, h=5.82 * KI)
KING['s1'] = KING['s0'] + KING['ns']
# Five relieving chambers over the King's chamber: four flat ones and the gabled top (Campbell's)
RELIEVING = dict(n=5, gap=1.05 * KI, beam=2.0 * KI, gable=3.2 * KI)



def relieving_spaces():
    """(h0, h1) of each relieving space above the King's chamber ceiling; the last is gabled."""
    out = []
    h = KING['floor'] + KING['h']
    for i in range(RELIEVING['n']):
        h0 = h + RELIEVING['beam']
        h1 = h0 + (RELIEVING['gap'] if i < RELIEVING['n'] - 1 else RELIEVING['gable'])
        out.append((h0, h1))
        h = h1
    return out


def section_outline():
    """The pyramid's outline in the section plane, (s, h) counter-clockwise, to the apex."""
    return [(-HALF, 0.0), (HALF, 0.0), (0.0, HEIGHT)]


def interior_polys():
    """Every void of the section as closed (s, h) polygons, for drawing (the papyrus)."""
    polys = []

    def slab(p, q, thick):
        """A sloping passage of vertical thickness `thick` from floor point p to q."""
        (s0, h0), (s1, h1) = p, q
        return [(s0, h0), (s1, h1), (s1, h1 + thick), (s0, h0 + thick)]

    polys.append(slab(ENTRANCE, DESC_END, PASSAGE_H / math.cos(math.radians(DESC_DEG))))
    polys.append(slab(JUNCTION, GALLERY_FOOT, PASSAGE_H / math.cos(math.radians(ASC_DEG))))
    polys.append(slab(GALLERY_FOOT, GALLERY_TOP, GALLERY_H))
    q = QUEEN
    polys.append([(GALLERY_FOOT[0], q['floor']), (q['s'] - q['ns'] / 2, q['floor']),
                  (q['s'] - q['ns'] / 2, q['floor'] + QUEEN_PASSAGE_H),
                  (GALLERY_FOOT[0], q['floor'] + QUEEN_PASSAGE_H)])
    polys.append([(q['s'] - q['ns'] / 2, q['floor']), (q['s'] + q['ns'] / 2, q['floor']),
                  (q['s'] + q['ns'] / 2, q['floor'] + q['wall']), (q['s'], q['floor'] + q['apex']),
                  (q['s'] - q['ns'] / 2, q['floor'] + q['wall'])])
    a = ANTE
    polys.append([(a['s0'], a['floor']), (a['s1'], a['floor']), (a['s1'], a['floor'] + a['h']),
                  (a['s0'], a['floor'] + a['h'])])
    k = KING
    polys.append([(k['s0'], k['floor']), (k['s1'], k['floor']), (k['s1'], k['floor'] + k['h']),
                  (k['s0'], k['floor'] + k['h'])])
    for i, (h0, h1) in enumerate(relieving_spaces()):
        if i < RELIEVING['n'] - 1:
            polys.append([(k['s0'], h0), (k['s1'], h0), (k['s1'], h1), (k['s0'], h1)])
        else:
            mid = (k['s0'] + k['s1']) / 2
            polys.append([(k['s0'], h0), (k['s1'], h0), (mid, h1)])
    return polys
