# House of Life: the painted reliefs of the walls, traced from the public-domain Description de
# l'Egypte plates (refs/, SOURCES.md). numpy only (no Blender needed), like temple_textures.py.
#
# The plates are line engravings of raised and sunk relief: the engraver hatched the flat ground
# with close horizontal lines and left the carved figures and signs smooth, modelled with stipple and
# a shadow edge. Tracing (trace):
#   - the hatching's energy tells ground from carving: smooth = carved;
#   - inside the carving, the dark strokes are the sculptor's lines; they cut it into regions;
#   - the regions are coloured as an Egyptian painter fills a relief, flat and by region:
#       signs (small carvings outside the figures) in Egyptian blue, green and red;
#       figures by their parts, from the top of each figure down: crowns (white, red discs, gold),
#       the wig or headcloth in blue and the face as flesh, the broad collar in bands, the body in
#       flesh (red-brown for men, yellow ochre for women), linen white, legs flesh;
#   - the engraver's own stipple shades the paint (the carving's modelling) and his strokes stay as
#     the painter's dark outlines; the hatched ground becomes the plain sandstone ground.
# Nothing is drawn: every figure, sign and line is the plate's. Signs are never moved, mirrored or
# recombined: a scene is always used whole, as one crop of its plate (SCENES), and placed upright.
# The walls are composed in registers of whole scenes (WALLS); which plate feeds which wall is in
# PLATE_TABLE and the bake's stats.
import numpy as np

import temple_textures as TT
from temple_textures import (BLACK, BLUE, GOLD, GREEN, RED, STONE, TURQ, WHITE, YELLOW, blur,
                             c3, fill, resample, smooth)

# ---------------------------------------------------------------- paint
FLESH_M = (150, 70, 42)          # men: red-brown ochre (deepened, as the Ptolemaic painters did)
FLESH_F = (206, 154, 64)         # women: yellow ochre
LINEN = (238, 232, 216)          # white linen
GROUND = (214, 194, 156)         # the plain sandstone ground of a painted wall
WIG = (40, 74, 150)              # Egyptian blue, the gods' lapis hair
SIGN_COLORS = (BLUE, BLUE, GREEN, BLUE, RED, GREEN, BLUE, YELLOW)

# ---------------------------------------------------------------- the scenes (plate crops)
# id -> (plate file, crop in plate pixels (x0, y0, x1, y1), figures' sexes left to right or '',
#        what the plate figure is). The crops are the plates' own panel frames (found as the
#        drawings' dark rectangles), inset a little so the frame line itself is not traced.
SCENES = {
    'esna82-1': ('description-esn-pl82.jpg', (556, 928, 3248, 2408), 'mmm',
                 'Esna, portico: the king offering before Khnum and Sobek (Pl. 82 fig. 1)'),
    'esna82-2': ('description-esn-pl82.jpg', (660, 2832, 1704, 4072), '',
                 'Esna, portico: an offering scene (Pl. 82 fig. 2)'),
    'esna82-3': ('description-esn-pl82.jpg', (1960, 2836, 3240, 4076), '',
                 'Esna, portico: an offering scene (Pl. 82 fig. 3)'),
    'philae16-1': ('description-le-de-phil-pl16.jpg', (1000, 1128, 2756, 2364), '',
                   'Philae, portico of the great temple: painted relief (Pl. 16 fig. 1)'),
    'philae16-2': ('description-le-de-phil-pl16.jpg', (980, 2752, 2756, 4052), 'ffm',
                   'Philae, portico of the great temple: painted relief (Pl. 16 fig. 2)'),
    'philae23-1': ('description-le-de-phil-pl23.jpg', (912, 792, 1844, 1296), '',
                   'Philae, west temple: relief (Pl. 23 fig. 1)'),
    'philae23-2': ('description-le-de-phil-pl23.jpg', (1964, 800, 2896, 1304), '',
                   'Philae, west temple: relief (Pl. 23 fig. 2)'),
    'philae23-3': ('description-le-de-phil-pl23.jpg', (908, 1540, 2888, 2344), '',
                   'Philae, west temple: relief (Pl. 23 fig. 3)'),
    'philae23-4': ('description-le-de-phil-pl23.jpg', (904, 2588, 2884, 2920), '',
                   'Philae, west temple: frieze (Pl. 23 fig. 4)'),
    'philae23-5a': ('description-le-de-phil-pl23.jpg', (880, 3168, 2888, 3564), '',
                    'Philae, west temple: cornice and frieze (Pl. 23 fig. 5)'),
    'philae23-5b': ('description-le-de-phil-pl23.jpg', (896, 3620, 2884, 3852), '',
                    'Philae, west temple: band (Pl. 23 fig. 5)'),
    'philae23-5c': ('description-le-de-phil-pl23.jpg', (892, 3924, 2884, 4148), '',
                    'Philae, west temple: band (Pl. 23 fig. 5)'),
    'edfu59-1': ('description-edfou-pl59.jpg', (860, 540, 1740, 840), '', 'Edfu: inscription (Pl. 59 fig. 1)'),
    'edfu59-2': ('description-edfou-pl59.jpg', (2192, 544, 3072, 840), '', 'Edfu: inscription (Pl. 59 fig. 2)'),
    'edfu59-3': ('description-edfou-pl59.jpg', (860, 936, 1740, 1236), '', 'Edfu: inscription (Pl. 59 fig. 3)'),
    'edfu59-4': ('description-edfou-pl59.jpg', (2188, 940, 3072, 1240), '', 'Edfu: inscription (Pl. 59 fig. 4)'),
    'edfu59-5': ('description-edfou-pl59.jpg', (720, 1336, 1872, 2248), '',
                 'Edfu, great temple: offering scene (Pl. 59 fig. 5)'),
    'edfu59-6': ('description-edfou-pl59.jpg', (2052, 1336, 3204, 2248), 'fm',
                 'Edfu, great temple: offering scene (Pl. 59 fig. 6)'),
    'dendera13-2': ('description-dendera-pl13-screen-walls.jpg', (484, 380, 1612, 1820), 'mf',
                    'Dendera, great temple: the king offering to the goddess (Pl. 13 fig. 2)'),
    'dendera13-3': ('description-dendera-pl13-screen-walls.jpg', (1664, 380, 2328, 1216), '',
                    'Dendera, great temple: relief (Pl. 13 fig. 3)'),
    'dendera13-4': ('description-dendera-pl13-screen-walls.jpg', (1664, 1272, 1956, 1816), '',
                    'Dendera: relief, a bird (Pl. 13 fig. 4)'),
    'dendera13-5': ('description-dendera-pl13-screen-walls.jpg', (2012, 1276, 2324, 1820), '',
                    'Dendera: relief, a bird (Pl. 13 fig. 5)'),
    'dendera22-1': ('description-dendrah-pl22.jpg', (404, 464, 2680, 1212), '',
                    'Dendera: cornice and frieze of the portico\'s side faces (Pl. 22 fig. 1)'),
    'dendera22-2': ('description-dendrah-pl22.jpg', (2752, 388, 3460, 640), '', 'Dendera, zodiac rooms: relief (Pl. 22)'),
    'dendera22-3': ('description-dendrah-pl22.jpg', (2752, 680, 3464, 924), '', 'Dendera, zodiac rooms: relief (Pl. 22)'),
    'dendera22-4': ('description-dendrah-pl22.jpg', (2748, 968, 3464, 1212), '', 'Dendera, zodiac rooms: relief (Pl. 22)'),
    'dendera22-5': ('description-dendrah-pl22.jpg', (712, 1292, 3096, 1776), '',
                    'Dendera, zodiac rooms: procession with the barque (Pl. 22)'),
    'dendera22-6': ('description-dendrah-pl22.jpg', (328, 1300, 624, 1776), '', 'Dendera: a seated god (Pl. 22)'),
    'dendera22-7': ('description-dendrah-pl22.jpg', (3176, 1296, 3460, 1772), '', 'Dendera: a god (Pl. 22)'),
    'dendera22-8': ('description-dendrah-pl22.jpg', (708, 1856, 1420, 2340), '', 'Dendera, great temple walls (Pl. 22)'),
    'dendera22-9': ('description-dendrah-pl22.jpg', (1504, 1860, 2572, 2336), '', 'Dendera, great temple walls (Pl. 22)'),
    'dendera22-10': ('description-dendrah-pl22.jpg', (2656, 1860, 3096, 2332), '', 'Dendera, great temple walls (Pl. 22)'),
    'dendera22-11': ('description-dendrah-pl22.jpg', (332, 1868, 624, 2344), '', 'Dendera, great temple walls (Pl. 22)'),
    'dendera22-12': ('description-dendrah-pl22.jpg', (3184, 1860, 3464, 2336), '', 'Dendera, great temple walls (Pl. 22)'),
    'dendera23-1a': ('description-dendrah-pl23.jpg', (424, 456, 1044, 912), '',
                     'Dendera: frieze of the back of the portico (Pl. 23 fig. 1)'),
    'dendera23-1b': ('description-dendrah-pl23.jpg', (1076, 456, 3420, 1028), '',
                     'Dendera: frieze of the back of the portico (Pl. 23 fig. 1)'),
    'dendera23-2': ('description-dendrah-pl23.jpg', (412, 1144, 3424, 1770), '',
                    'Dendera, zodiac rooms: cornice with the winged disc (Pl. 23 fig. 2)'),
    'dendera23-3': ('description-dendrah-pl23.jpg', (412, 1770, 3424, 2396), '',
                    'Dendera, great temple: frieze and cornice (Pl. 23 fig. 3)'),
    'dendera28-1': ('description-dendrah-pl28.jpg', (552, 596, 1072, 1604), '', 'Dendera: figure and costume (Pl. 28 fig. 1)'),
    'dendera28-2': ('description-dendrah-pl28.jpg', (1240, 596, 1768, 1612), '', 'Dendera: figure and costume (Pl. 28 fig. 2)'),
    'dendera28-3': ('description-dendrah-pl28.jpg', (1948, 604, 2472, 1604), '', 'Dendera: figure and costume (Pl. 28 fig. 3)'),
    'dendera28-4': ('description-dendrah-pl28.jpg', (2648, 604, 3168, 1604), '', 'Dendera: figure and costume (Pl. 28 fig. 4)'),
    'dendera28-5': ('description-dendrah-pl28.jpg', (544, 1792, 1064, 2336), '', 'Dendera: costume detail (Pl. 28 fig. 5)'),
    'dendera28-6': ('description-dendrah-pl28.jpg', (1240, 1796, 1768, 2340), '', 'Dendera: costume detail (Pl. 28 fig. 6)'),
    'dendera28-7': ('description-dendrah-pl28.jpg', (1948, 1800, 2472, 2340), '', 'Dendera: costume detail (Pl. 28 fig. 7)'),
    'dendera28-8': ('description-dendrah-pl28.jpg', (2648, 1800, 3164, 2336), '', 'Dendera: costume detail (Pl. 28 fig. 8)'),
    'edfu58-1': ('description-edfou-pl58.jpg', (208, 116, 1328, 308), '', 'Edfu, portico: frieze (Pl. 58 fig. 1)'),
    'edfu58-2': ('description-edfou-pl58.jpg', (256, 344, 1272, 444), '', 'Edfu, portico: frieze (Pl. 58)'),
    'edfu58-3': ('description-edfou-pl58.jpg', (260, 468, 1272, 572), '', 'Edfu, portico: frieze (Pl. 58)'),
    'edfu58-4': ('description-edfou-pl58.jpg', (260, 588, 1272, 696), '', 'Edfu, portico: frieze (Pl. 58)'),
    'edfu58-5': ('description-edfou-pl58.jpg', (260, 712, 1280, 820), '', 'Edfu, portico: frieze (Pl. 58)'),
    'edfu58-6': ('description-edfou-pl58.jpg', (260, 840, 1280, 940), '', 'Edfu, portico: frieze (Pl. 58)'),
    'edfu64-1': ('description-edfou-pl64.jpg', (232, 212, 1332, 392), '', 'Edfu, small temple: frieze (Pl. 64)'),
    'edfu64-2': ('description-edfou-pl64.jpg', (228, 460, 1328, 648), '', 'Edfu, small temple: frieze (Pl. 64)'),
    'edfu64-3': ('description-edfou-pl64.jpg', (236, 712, 1336, 900), '', 'Edfu, small temple: frieze (Pl. 64)'),
}
INSET = 0.012                    # of the crop's smaller side: the panel's frame line stays out


def crop(plates, sid):
    """The scene's crop: plates maps a plate file to its grey image, or a scene id to its crop
    already cut (crops())."""
    if sid in plates:
        return plates[sid]
    f, (x0, y0, x1, y1), _, _ = SCENES[sid]
    p = plates[f]
    k = int(round(min(x1 - x0, y1 - y0) * INSET)) + 2
    return p[y0 + k:y1 - k, x0 + k:x1 - k]


def crops(load):
    """Every scene's crop, loading each plate once (load(file) -> grey image) and keeping only the
    crops, so the bake never holds all the plates at once."""
    out = {}
    for f in sorted({v[0] for v in SCENES.values()}):
        plate = {f: load(f)}
        for sid, v in SCENES.items():
            if v[0] == f:
                out[sid] = np.array(crop(plate, sid), dtype=np.float32)
        del plate
    return out


def aspect(sid):
    _, (x0, y0, x1, y1), _, _ = SCENES[sid]
    return (x1 - x0) / (y1 - y0)


# ---------------------------------------------------------------- image tools
def label(mask):
    """4-connected components of a boolean mask (numpy + a union-find over row runs). Returns
    (labels, -1 outside; the count)."""
    h, w = mask.shape
    pad = np.zeros((h, w + 2), bool)
    pad[:, 1:-1] = mask
    d = np.diff(pad.astype(np.int8), axis=1)
    rows_s = [np.where(d[r] == 1)[0] for r in range(h)]
    rows_e = [np.where(d[r] == -1)[0] for r in range(h)]
    base = np.cumsum([0] + [len(x) for x in rows_s])
    n = int(base[-1])
    parent = list(range(n))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for r in range(1, h):
        ps, pe, cs, ce = rows_s[r - 1], rows_e[r - 1], rows_s[r], rows_e[r]
        i = j = 0
        while i < len(ps) and j < len(cs):
            if ps[i] < ce[j] and cs[j] < pe[i]:
                a, b = find(base[r - 1] + i), find(base[r] + j)
                if a != b:
                    parent[max(a, b)] = min(a, b)
            if pe[i] < ce[j]:
                i += 1
            else:
                j += 1
    roots = np.array([find(a) for a in range(n)], dtype=np.int64)
    _, comp = np.unique(roots, return_inverse=True)
    lab = np.full((h, w), -1, dtype=np.int64)
    k = 0
    for r in range(h):
        for st, en in zip(rows_s[r], rows_e[r]):
            lab[r, st:en] = comp[k]
            k += 1
    return lab, int(comp.max() + 1 if n else 0)


def dilate(m, r):
    return TT._dilate(m, r)


def erode(m, r):
    return ~TT._dilate(~m, r)


# ---------------------------------------------------------------- tracing
def trace(L, cap=1500):
    """A plate crop (grey 0..1) -> the relief's fields at the crop's own scale (at most cap rows):
    carved (0..1), hard (the carving's mask), the sculptor's lines (0..1), the engraver's shade
    (a multiplier ~1) and regions (the carving cut by its lines)."""
    if L.shape[0] > cap:
        L = resample(L, cap, int(round(L.shape[1] * cap / L.shape[0])))
    Ev = blur(np.abs(np.diff(L, axis=0, append=L[-1:])), 3)
    Eh = blur(np.abs(np.diff(L, axis=1, append=L[:, -1:])), 3)
    ratio = Ev / (Eh + 0.01)
    # a hatching scanned at its own period beats into moire bands (the Dendera Pl. 22 scan): the
    # ground is then judged over a wider window and its leftover dashes are dropped (paint)
    col = L[:, :: max(1, L.shape[1] // 40)]
    c = col - col.mean(0)
    ac2 = (c[2:] * c[:-2]).sum() / max((c * c).sum(), 1e-9)
    moire = ac2 > 0.6
    if np.median(ratio) > 2.0:
        # the ground's hatching runs along x: its vertical energy dwarfs the horizontal
        ground = smooth(2.2, 3.6, blur(ratio, 5 if moire else 2))
    else:
        # hatching too fine for the scan (the 1536 px plates): the ground is the darker tone
        bg = blur(L, 12)
        ground = smooth(0.03, -0.02, blur(L, 1.5) - bg) * smooth(0.5, 0.75, bg + 0.2)
    hard = ground < 0.5
    hard = erode(dilate(hard, 2), 2)                    # close hairline gaps in the carving
    hard = dilate(erode(hard, 2), 2)                    # drop hatching specks
    carved = blur(hard.astype(np.float64), 1.0)
    Lb = blur(L, 1.4)
    mean_c = np.median(Lb[hard]) if hard.any() else 0.8
    # the sculptor's lines: strokes clearly darker than the carving around them (the stipple's
    # fine dots blur away at this scale)
    local = blur(L, 5)
    tophat = local - Lb
    lines = smooth(0.06, 0.16, tophat) * erode(hard, 1)
    lines = np.maximum(lines, smooth(mean_c - 0.18, mean_c - 0.38, Lb) * hard)
    edge = np.hypot(*np.gradient(carved))
    lines = np.maximum(lines, smooth(0.12, 0.35, edge) * 0.9)
    shade = np.where(hard, np.clip(0.95 + 0.9 * (blur(L, 2.5) - mean_c), 0.64, 1.1), 1.0)
    regions = hard & ~dilate(lines > 0.5, 1)
    return dict(carved=carved, hard=hard, lines=lines, shade=shade, regions=regions, L=L,
                moire=moire)


def _stats(lab, n):
    """Per component: area, bbox, centroid."""
    h, w = lab.shape
    yy, xx = np.mgrid[0:h, 0:w]
    m = lab >= 0
    l = lab[m]
    area = np.bincount(l, minlength=n)
    cy = np.bincount(l, yy[m], n) / np.maximum(area, 1)
    cx = np.bincount(l, xx[m], n) / np.maximum(area, 1)
    y0 = np.full(n, h)
    y1 = np.zeros(n, int)
    x0 = np.full(n, w)
    x1 = np.zeros(n, int)
    np.minimum.at(y0, l, yy[m])
    np.maximum.at(y1, l, yy[m])
    np.minimum.at(x0, l, xx[m])
    np.maximum.at(x1, l, xx[m])
    return area, cx, cy, x0, x1, y0, y1


# A figure's zones, as fractions of its height from the soles to the top of the head (the crown
# stands above 1.0), after the Egyptian canon: the neck is found on the silhouette (its narrowest
# row above the shoulders) and the canon gives the rest. (name, top) from the soles up.
ZONES = {
    ('stand', 'm'): (('flesh', 0.36), ('linen', 0.60), ('flesh', 0.775), ('collar', 0.835),
                     ('head', 1.0), ('crown', 9.0)),
    ('stand', 'f'): (('flesh', 0.12), ('dress', 0.70), ('flesh', 0.775), ('collar', 0.835),
                     ('head', 1.0), ('crown', 9.0)),
    ('seat', 'm'): (('flesh', 0.40), ('linen', 0.56), ('flesh', 0.74), ('collar', 0.80),
                    ('head', 1.0), ('crown', 9.0)),
    ('seat', 'f'): (('flesh', 0.12), ('dress', 0.68), ('flesh', 0.74), ('collar', 0.80),
                    ('head', 1.0), ('crown', 9.0)),
}
ZONE_NAMES = ('flesh', 'linen', 'dress', 'collar', 'head', 'crown')
NECK = {'stand': 0.835, 'seat': 0.80}
DRESS = (150, 58, 38)            # a goddess's sheath: red ochre


def _neck(widths, h):
    """The neck's row in a figure's silhouette: a narrow row with the shoulders (among the
    figure's widest rows) just below it; a crown's stem has only the head below it."""
    w = blur(widths[:, None].astype(np.float64), max(1.0, h / 90), axes=(0,))[:, 0]
    wmax = max(w[int(0.15 * h):].max(), 1.0)
    best, row, bq = 9.0, int(0.3 * h), 1.0
    for r in range(int(0.12 * h), int(0.6 * h)):
        below = w[r + int(0.02 * h):r + int(0.085 * h) + 1]
        if len(below) == 0 or below.max() <= 0 or w[r] < 0.04 * h:
            continue
        q = w[r] / below.max()
        score = q - 0.45 * below.max() / wmax
        if score < best:
            best, row, bq = score, r, q
    return row, bq


def paint(L, out_h, out_w, sexes='', sunk=False, seed=0):
    """Trace and paint one scene: returns (rgb, height, stats) at out_h x out_w (row 0 = top)."""
    tr = trace(L)
    ah, aw = tr['hard'].shape
    hard, lines = tr['hard'], tr['lines']
    rng = np.random.default_rng(seed)
    # the register's ground line and the panel's frame: carved bands running right across; they
    # join every figure standing on them, so they are painted as bands and kept out of the figures
    rowf = hard.mean(1)
    colf = hard.mean(0)
    band = np.zeros_like(hard)
    band[rowf > 0.8] = True
    band[:, colf > 0.85] = True
    band &= hard
    blobs, nb = label(hard & ~dilate(band, 1))
    # figures side by side, joined by a staff, an arm or an offering: split at the narrowest columns
    b_area, b_cx, b_cy, b_x0, b_x1, b_y0, b_y1 = _stats(blobs, nb)
    split = np.zeros_like(hard)
    for b in range(nb):
        bh, bw = b_y1[b] - b_y0[b] + 1, b_x1[b] - b_x0[b] + 1
        if b_area[b] < 0.03 * ah * ah or bh < 0.3 * ah or bw < 0.55 * bh:
            continue
        sub = blobs[b_y0[b]:b_y1[b] + 1, b_x0[b]:b_x1[b] + 1] == b
        prof = blur(sub.sum(0)[None, :].astype(np.float64), 2, axes=(1,))[0]
        x = int(0.22 * bh)
        while x < bw - int(0.22 * bh):
            win = prof[x:x + int(0.3 * bh)]
            j = x + int(np.argmin(win))
            if prof[j] < 0.12 * bh and j > int(0.2 * bh) and j < bw - int(0.2 * bh):
                split[b_y0[b]:b_y1[b] + 1, b_x0[b] + j - 1:b_x0[b] + j + 2] |= sub[:, max(j - 1, 0):j + 2]
                x = j + int(0.25 * bh)
            else:
                x += max(1, int(0.15 * bh))
    blobs, nb = label(hard & ~dilate(band, 1) & ~split)
    b_area, b_cx, b_cy, b_x0, b_x1, b_y0, b_y1 = _stats(blobs, nb)
    # what the hatching's moire leaves (thin horizontal dashes) and lone specks are ground
    bw_, bh_ = b_x1 - b_x0 + 1, b_y1 - b_y0 + 1
    junk = ((bh_ <= max(3, 0.02 * ah)) & (bw_ > 3 * bh_)) | (b_area < 14)
    if tr['moire']:
        junk |= (bw_ > 2.0 * bh_) & (bh_ < 0.045 * ah) & (b_area < 0.002 * ah * aw)
    if junk.any():
        jm = np.append(junk, False)[np.where(blobs >= 0, blobs, nb)]
        hard = hard & ~jm
        tr['carved'] = tr['carved'] * ~jm
        tr['lines'] = tr['lines'] * ~dilate(jm, 1)
        tr['regions'] = tr['regions'] & ~jm
        lines = tr['lines']
        blobs, nb = label(hard & ~dilate(band, 1) & ~split)
        b_area, b_cx, b_cy, b_x0, b_x1, b_y0, b_y1 = _stats(blobs, nb)
    figs = [i for i in range(nb) if b_area[i] > 0.02 * ah * ah and (b_y1[i] - b_y0[i]) > 0.3 * ah]
    figs.sort(key=lambda i: b_cx[i])
    # the figures' parts: the sculptor's lines cut the carving, and a stroke running across most
    # of a figure's width (a belt, a hem, a collar's edge) cuts it right through
    cut = np.zeros_like(hard)
    ln = lines > 0.4
    zone = np.full((ah, aw), -1, dtype=np.int64)
    fzone = np.zeros((ah, aw))
    info = {}
    for k, b in enumerate(figs):
        y0, y1, x0, x1 = b_y0[b], b_y1[b] + 1, b_x0[b], b_x1[b] + 1
        sub = blobs[y0:y1, x0:x1] == b
        width = sub.sum(1)
        frac = (ln[y0:y1, x0:x1] & sub).sum(1) / np.maximum(width, 1)
        rows = np.where((frac > 0.3) & (width > 0.2 * (x1 - x0)))[0]
        cut[y0:y1, x0:x1][rows] |= sub[rows]
        h = y1 - y0
        kind = 'seat' if h / (x1 - x0) < 1.75 else 'stand'
        sex = sexes[k] if k < len(sexes) else 'm'
        neck, q = _neck(width, h)
        H0 = (h - neck) / NECK[kind]
        yy = np.arange(y0, y1)[:, None]
        f = (y1 - yy) / max(H0, 1.0) + 0.0 * sub
        z = np.zeros_like(f, dtype=np.int64)
        lo = 0.0
        for name, top in ZONES[(kind, sex)]:
            z = np.where((f >= lo) & (f < top), ZONE_NAMES.index(name), z)
            lo = top
        zone[y0:y1, x0:x1] = np.where(sub, z, zone[y0:y1, x0:x1])
        fzone[y0:y1, x0:x1] = np.where(sub, f, fzone[y0:y1, x0:x1])
        info[b] = dict(kind=kind, sex=sex, neck_q=round(float(neck / h), 2), H0=H0, top=y1 - H0)
    regions = tr['regions'] & ~dilate(cut, 0)
    regs, nr = label(regions)
    r_area, r_cx, r_cy, r_x0, r_x1, r_y0, r_y1 = _stats(regs, nr)
    m = regs >= 0
    owner = np.full(nr, -1)
    owner[regs[m]] = blobs[m]
    # per region, its pixels per zone: a region painted whole takes its main zone's paint
    zm = m & (zone >= 0)
    counts = np.zeros((nr, len(ZONE_NAMES)))
    np.add.at(counts, (regs[zm], zone[zm]), 1)
    main = counts.argmax(1)
    share = counts.max(1) / np.maximum(counts.sum(1), 1)
    rgb = np.broadcast_to(c3(GROUND), (ah, aw, 3)).copy()
    yy, xx = np.mgrid[0:ah, 0:aw]
    stripe = np.floor(yy / max(2.0, ah / 170)).astype(int) % 4
    collar_rgb = np.stack([c3(c) for c in (GREEN, RED, BLUE, YELLOW)])[stripe]
    figset = set(figs)

    def flesh_of(b):
        return c3(FLESH_F if info[b]['sex'] == 'f' else FLESH_M)

    def zone_rgb(name, b):
        return {'flesh': flesh_of(b), 'linen': c3(LINEN), 'dress': c3(DRESS), 'collar': None,
                'head': c3(WIG), 'crown': c3(GOLD)}[name]
    # 1. every figure pixel by its zone (the fall-back for regions the lines did not close)
    for b in figs:
        sel = blobs == b
        for zi, name in enumerate(ZONE_NAMES):
            s2 = sel & (zone == zi)
            if name == 'collar':
                rgb[s2] = collar_rgb[s2]
            elif name == 'head':
                # a head the lines left whole: the wig over the top, the face below it
                t = (fzone - 1.0) / (1.0 - NECK[info[b]['kind']])
                rgb[s2 & (t > -0.45)] = c3(WIG)
                rgb[s2 & (t <= -0.45)] = flesh_of(b)
            else:
                rgb[s2] = zone_rgb(name, b)
    # 2. regions the lines closed: one paint each
    region_paint = {}
    for r in range(nr):
        b = owner[r]
        if r_area[r] < 8 or b not in figset or share[r] < 0.6:
            continue
        name = ZONE_NAMES[main[r]]
        rw, rh = r_x1[r] - r_x0[r] + 1, r_y1[r] - r_y0[r] + 1
        fillr = r_area[r] / (rw * rh)
        if name == 'crown':
            if fillr > 0.68 and 0.7 < rw / rh < 1.4:
                c = c3(RED)                                  # a sun disc
            elif rh > 2.0 * rw:
                c = c3(WHITE) if rng.random() < 0.6 else c3(GREEN)   # plumes, the white crown
            else:
                c = c3(GOLD if rng.random() < 0.6 else YELLOW)
        elif name == 'head':
            c = 'head'
        elif name == 'collar':
            c = 'collar'
        elif info[b]['kind'] == 'seat' and fillr > 0.86 and r_area[r] > 0.03 * b_area[b] \
                and r_cx[r] and name != 'head':
            c = c3(BLUE)                                     # the throne's block
        else:
            c = zone_rgb(name, b)
        region_paint[r] = c
    # the head's regions: the largest is the wig or headcloth, the others the face
    for b in figs:
        hr = [r for r, c in region_paint.items() if owner[r] == b and isinstance(c, str) and c == 'head']
        if hr:
            big = max(hr, key=lambda r: r_area[r])
            if r_area[big] > 0.8 * sum(r_area[r] for r in hr):
                # the lines left the face and the wig as one: paint it by height (step 1)
                for r in hr:
                    del region_paint[r]
                continue
            for r in hr:
                region_paint[r] = c3(WIG) if r == big else flesh_of(b)
    lut = np.full((nr + 1, 3), np.nan)
    for r, c in region_paint.items():
        if not isinstance(c, str):
            lut[r] = c
    rid = np.where(m, regs, nr)
    per = lut[rid]
    has = ~np.isnan(per[..., 0])
    rgb[has] = per[has]
    # 3. the signs: a flat colour per sign; the long frames of the text columns blue
    sign_rgb = np.zeros((nb + 1, 3))
    for b in range(nb):
        if b in figset:
            continue
        bw, bh = b_x1[b] - b_x0[b] + 1, b_y1[b] - b_y0[b] + 1
        if max(bw, bh) > 8 * min(bw, bh) or b_area[b] > 0.03 * ah * ah:
            sign_rgb[b] = c3(BLUE)
        else:
            sign_rgb[b] = c3(SIGN_COLORS[int(rng.integers(len(SIGN_COLORS)))])
    rgb[band] = c3(BLUE)
    bid = np.where(blobs >= 0, blobs, nb)
    is_sign = (blobs >= 0) & ~np.isin(blobs, figs)
    rgb[is_sign] = sign_rgb[bid][is_sign]
    # the carving filled, shaded by the engraver's stipple, outlined by his strokes
    carved = tr['carved'][..., None]
    img = c3(GROUND) * (1 - carved) + rgb * carved
    img = img * tr['shade'][..., None]
    fill(img, lines * 0.8, BLACK)
    if sunk:
        h = hard.astype(np.float64)
        sh = np.zeros_like(h)
        sh[2:, 2:] = h[:-2, :-2]
        fill(img, h * (1 - sh) * 0.5, BLACK)       # the cut's upper-left inner walls in shadow
    grain = blur(rng.standard_normal((ah, aw)), 1.5)
    img = img * (1 + 0.025 * grain / max(grain.std(), 1e-6))[..., None]
    height = blur(tr['carved'], 1.2) * (-1 if sunk else 1)
    out = np.clip(resample(img, out_h, out_w), 0, 1)
    return out, resample(height, out_h, out_w), dict(
        figures=[(info[b]['kind'], info[b]['sex'], info[b]['neck_q']) for b in figs],
        signs=int(nb - len(figs)))


# ---------------------------------------------------------------- the walls' fields
def block_border(h, w, horizontal=True):
    """The painters' block border that frames registers and scenes: blocks of blue, red and green
    parted by white, between two dark lines (ornament, not writing)."""
    n = w if horizontal else h
    t = np.arange(n) / max(h if horizontal else w, 1)            # along the band, in band widths
    k = np.floor(t / 1.6).astype(int) % 4
    seq = np.stack([c3(c) for c in (BLUE, RED, GREEN, RED)])[k]
    gap = ((t / 1.6) % 1) > 0.82
    seq[gap] = c3(WHITE)
    band = seq[None, :, :].repeat(h, 0) if horizontal else seq[:, None, :].repeat(w, 1)
    edge = np.arange(h if horizontal else w)
    e = (edge < max(1, 0.12 * len(edge))) | (edge >= len(edge) - max(1, 0.12 * len(edge)))
    if horizontal:
        band[e] = c3(BLACK)
    else:
        band[:, e] = c3(BLACK)
    return band


# A field is one wall face's painted area: its size (metres), the pixels per metre it gets in the
# atlas, and its registers from the bottom up: (bottom, top) in metres from the field's foot and
# the whole scenes in it, left to right. Every scene appears on exactly one wall.
BORDER_M = 0.07
FIELDS = {
    # the court's west and east walls (seen from the court), above the dado and under the kheker
    'court_w': dict(size=(15.1, 4.52), ppm=210, registers=[
        ((0.10, 2.12), ['dendera22-5', 'philae23-2']),
        ((2.30, 4.40), ['esna82-1', 'dendera13-2', 'edfu59-6', 'philae23-1', 'esna82-2'])]),
    'court_e': dict(size=(15.1, 4.52), ppm=210, registers=[
        ((0.10, 2.12), ['dendera23-1b', 'dendera23-1a', 'dendera22-10', 'dendera28-2']),
        ((2.30, 4.40), ['philae23-3', 'dendera22-9', 'dendera22-8', 'dendera28-1'])]),
    # the pronaos' back wall, seen between the facade's columns above the screen walls
    'pronaos': dict(size=(14.2, 4.3), ppm=120, registers=[((0.6, 3.0), [
        'dendera28-3', 'dendera22-6', 'dendera28-5', 'dendera22-11', 'dendera28-4', 'dendera22-7',
        'dendera28-6', 'dendera22-12'])]),
    # the four chambers' back walls and their sides (inside the chambers, under the roofs)
    'n1_back': dict(size=(2.85, 3.25), ppm=150, registers=[((1.25, 2.35), ['dendera22-1'])]),
    'n4_back': dict(size=(2.85, 3.25), ppm=150, registers=[((1.12, 3.15), ['dendera13-3', 'dendera13-4', 'dendera13-5'])]),
    'n15_back': dict(size=(2.85, 3.25), ppm=150, registers=[((1.25, 2.35), ['dendera22-2'])]),
    'n18_back': dict(size=(2.85, 3.25), ppm=150, registers=[((1.45, 2.15), ['dendera23-3'])]),
    'n1_west': dict(size=(2.73, 3.25), ppm=150, registers=[((1.55, 2.75), ['edfu59-1'])]),
    'n1_east': dict(size=(2.83, 3.25), ppm=150, registers=[((1.55, 2.75), ['edfu59-2'])]),
    'n4_west': dict(size=(2.83, 3.25), ppm=150, registers=[((1.55, 2.75), ['edfu59-3'])]),
    'n4_east': dict(size=(2.85, 3.25), ppm=150, registers=[((1.55, 2.75), ['edfu59-4'])]),
    'n15_west': dict(size=(2.85, 3.25), ppm=150, registers=[((1.55, 2.75), ['dendera22-3'])]),
    'n15_east': dict(size=(2.83, 3.25), ppm=150, registers=[((1.55, 2.75), ['dendera22-4'])]),
    'n18_west': dict(size=(2.83, 3.25), ppm=150, registers=[((1.55, 2.2), ['dendera23-2'])]),
    'n18_east': dict(size=(2.73, 3.25), ppm=150, registers=[((1.20, 2.75), ['dendera28-7', 'dendera28-8'])]),
    # the facade's architrave and the colonnades' architraves: friezes from the Edfu portico
    'architrave': dict(size=(14.8, 0.5), ppm=200, registers=[((0.0, 0.5), ['edfu58-2', 'edfu58-3', 'edfu58-4'])], frame=False),
    'wing_arch_w': dict(size=(6.22, 0.35), ppm=200, registers=[((0.0, 0.35), ['edfu58-5', 'edfu58-6'])], frame=False),
    'wing_arch_e': dict(size=(6.22, 0.35), ppm=200, registers=[((0.0, 0.35), ['edfu64-1', 'edfu64-2', 'edfu64-3'])], frame=False),
    # the south rim's outer face (the diorama's cut wall, towards the viewer): sunk relief
    'rim_w': dict(size=(13.35, 0.8), ppm=150, sunk=True, registers=[((0.04, 0.76), ['philae23-5b', 'philae23-5c'])]),
    'rim_e': dict(size=(13.35, 0.8), ppm=150, sunk=True, registers=[((0.04, 0.76), ['philae23-4', 'philae23-5a', 'edfu58-1'])]),
}
# the facade's four screen walls (temple_textures.screen_panel), left to right
SCREEN_SCENES = ['edfu59-5', None, 'philae16-2', 'esna82-3']     # None: Pl. 13 fig. 1's own scene


def plate_table():
    """wall -> [(scene id, what the plate shows)] for the report and the bake's stats."""
    out = {name: [(sid, SCENES[sid][3]) for _, ids in f['registers'] for sid in ids]
           for name, f in FIELDS.items()}
    out['screens'] = [(sid or 'dendera13-1', SCENES[sid][3] if sid else
                       'Dendera, portico: a screen wall (Pl. 13 fig. 1)') for sid in SCREEN_SCENES]
    used = [s for v in out.values() for s, _ in v]
    assert len(used) == len(set(used)), 'a scene is used twice'
    return out


def compose(field, plates, stats):
    """One field's painted relief: (rgb, height) at its atlas size, row 0 = top."""
    f = FIELDS[field]
    wm, hm = f['size']
    ppm = f['ppm']
    W, H = int(round(wm * ppm)), int(round(hm * ppm))
    sunk = f.get('sunk', False)
    rng = np.random.default_rng(sum(ord(ch) * (i + 1) for i, ch in enumerate(field)))
    img = np.broadcast_to(c3(GROUND), (H, W, 3)).copy()
    grain = blur(rng.standard_normal((H, W)), 1.2)
    img *= (1 + 0.02 * grain / max(grain.std(), 1e-6))[..., None]
    hgt = np.zeros((H, W))
    bpx = max(2, int(round(BORDER_M * ppm)))
    frame = f.get('frame', True)
    for (b0, b1), ids in f['registers']:
        r0, r1 = H - int(round(b1 * ppm)), H - int(round(b0 * ppm))     # rows (top, bottom)
        if frame:
            img[max(0, r0 - bpx):r0] = block_border(r0 - max(0, r0 - bpx), W)
            img[r1:min(H, r1 + bpx)] = block_border(min(H, r1 + bpx) - r1, W)
        rh = r1 - r0
        nat = [aspect(sid) * rh for sid in ids]
        gap = bpx if frame else 2
        avail = W - gap * (len(ids) + 1)
        k = min(1.0, avail / sum(nat))
        sh = int(rh * k)
        widths = [int(n * k) for n in nat]
        spare = W - sum(widths)
        g = spare / (len(ids) + 1)
        x = g
        for sid, sw in zip(ids, widths):
            L = crop(plates, sid).astype(np.float64)
            rgb, ht, st = paint(L, sh, sw, SCENES[sid][2], sunk=sunk, seed=len(sid) * 7 + sw)
            y = r0 + (rh - sh) // 2
            xi = int(round(x))
            img[y:y + sh, xi:xi + sw] = rgb
            hgt[y:y + sh, xi:xi + sw] = ht
            if frame:
                for xb in (xi - gap, xi + sw):
                    if 0 <= xb and xb + gap <= W:
                        img[r0:r1, xb:xb + gap] = block_border(rh, gap, horizontal=False)
            stats.setdefault('relief_scenes', {})[sid] = dict(wall=field, figures=len(st['figures']),
                                                               signs=st['signs'])
            x += sw + g
    return img, hgt


def atlas(plates, stats, width=4096):
    """Every field shelf-packed into one atlas (rows of fields, tallest first). Returns (rgb,
    height, rects): rects[field] = (u0, v0, u1, v1) in UV space (v up)."""
    sizes = {n: (int(round(f['size'][0] * f['ppm'])), int(round(f['size'][1] * f['ppm'])))
             for n, f in FIELDS.items()}
    order = sorted(sizes, key=lambda n: -sizes[n][1])
    shelves, x, y, sh = [], 0, 0, 0
    place = {}
    pad = 8
    for n in order:
        w, h = sizes[n]
        if x + w > width:
            y += sh + pad
            x, sh = 0, 0
        place[n] = (x, y)
        x += w + pad
        sh = max(sh, h)
    total = y + sh
    Ht = int(np.ceil(total / 64) * 64)
    img = np.broadcast_to(c3(GROUND), (Ht, width, 3)).copy()
    hgt = np.zeros((Ht, width))
    rects = {}
    for n in order:
        rgb, ht = compose(n, plates, stats)
        x0, y0 = place[n]
        h, w = ht.shape
        img[y0:y0 + h, x0:x0 + w] = rgb
        hgt[y0:y0 + h, x0:x0 + w] = ht
        # a 1 px inset keeps bilinear filtering inside the field
        rects[n] = ((x0 + 1) / width, 1 - (y0 + h - 1) / Ht, (x0 + w - 1) / width, 1 - (y0 + 1) / Ht)
    stats['relief_atlas'] = [width, Ht]
    return img, hgt, rects
