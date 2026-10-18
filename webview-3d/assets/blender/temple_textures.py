# House of Life: numpy-only texture maps for the temple (no Blender needed). Each map is written as
# PNG into the trim folder, row 0 = top. Every colour map passes the amethyst guard (nothing
# saturated within 255-335 deg) through patterns.py and a 4x4 block check, because ETC1S stores one
# chroma per block: a red stroke next to a blue one would average to violet.
#   sandstone   ashlar walls (courses 0.5 m, blocks 1 m) and its normal
#   paving      the court's sandstone flags
#   wall        the enclosure walls' inner elevation: dado band traced from Pl. 13, a plain ashlar
#               field and a kheker frieze under the cornice stripes (no stars on walls: those
#               belong to ceilings and soffits)
#   screen      the facade's screen walls: Pl. 13 fig. 1 traced into painted relief (left half),
#               and the same frame bands around painted registers with no figures (right half)
#   column      the Hathor column atlas after Pl. 12: shaft bands, the Hathor face, the naos block
#   title       the door lintel: the font-rendered title as sunk relief with a blue fill
#   frieze      the pyramid casing's band of sacred signs (ankh djed was), sunk in the limestone
#   thoth, thoth_fine   two bands of "Thoth, lord of divine words" (eight signs repeated) above it
#   granite     Aswan rose granite (pink ground, grey and black mineral speckle); the obelisks'
#               atlas: the same granite with the central inscription column of six faces traced
#               from the Luxor obelisk plates (Description de l'Egypte, A. vol. III pl. 11, 12)
#   limestone   polished white Tura casing; section (the cut face's masonry in a white casing
#               frame); core and interior (courses; the voids' darker stone)
#   papyrus     the Architects' gridded papyrus: the pyramid's section from pyramid_spec.py
#   palette     flat swatches for small props
# No hieroglyph is drawn by hand: the only signs are the plate's (traced) and the font's (title).
import math
import os
import sys

import numpy as np

import patterns as P
import pyramid_spec as S

# ---------------------------------------------------------------- Ptolemaic paint (sRGB)
RED = (164, 66, 42)          # red ochre (haematite)
DARK_RED = (122, 46, 30)
YELLOW = (206, 156, 58)      # yellow ochre (goethite)
GOLD = (214, 178, 84)
BLUE = (46, 88, 166)         # Egyptian blue (cuprorivaite), ~220 deg: free in this world
TITLE_GLOW = (56, 116, 255)  # the title's luminous royal blue (~220 deg), the glyphs' emissive map
SKY = (98, 140, 182)         # the pale blue of the Dendera ceilings (research-e0 #80A4B9)
GREEN = (62, 128, 86)        # malachite / green frit
TURQ = (52, 158, 148)        # faience turquoise
WHITE = (232, 226, 210)      # gypsum
BLACK = (38, 33, 30)         # carbon
STONE = (204, 182, 146)      # pale sandstone ground of the painted reliefs
SAND = (188, 160, 120)       # wall sandstone
SAND_DARK = (170, 140, 102)

# ---------------------------------------------------------------- shared sizes (metres)
SAND_M = 3.0                 # the ashlar map covers 3 x 3 m
PAVE_M = 3.0                 # two tiles of paving
WALL_W, WALL_H = 3.5, 6.2    # the inner wall elevation: one dado repeat, the wall's height
WALL_PX = (1792, 1024)
WALL_BANDS = dict(base=(0.0, 0.12), dado=(0.18, 0.88), field=(0.98, 5.0), kheker=(5.56, 5.82),
                  cornice=(5.82, 6.2))
PANEL_PX = (1520, 1024)      # one screen wall (h, w): Pl. 13 fig. 1 is 0.67 wide per height
TITLE_PX = (560, 992)        # the lintel, 1.10 x 1.95 m
OBELISK_PX = (2304, 288)     # one face strip of the obelisk atlas (h, w): 0.53 m wide at the base
PAPYRUS_PX = (704, 1024)
PALETTE_N = 8                # 8 x 8 swatches

# The screen-wall drawing's bands, in Pl. 13 fig. 1 view pixels (700 x 1005: the plate cropped at
# x 2370-3380, y 380-1830 and scaled by 1/1.443), measured off the plate.
VIEW = dict(x0=2370, y0=380, s=1010 / 700)
BANDS = dict(crest=(0, 118), discs=(0, 32), slab=(118, 150), cavetto=(150, 245),
             torus=(245, 262), heads=(262, 322), rosettes=(322, 338), line=(338, 360),
             scene=(360, 795), ground=(795, 872), dado=(872, 1005))
WINGED_UV = []                # (u0, v0, u1, v1) of the traced winged disc band, set by write_all
# the screen wall's geometry follows the drawing: these fractions of its height (from the top)
CAVETTO_V = (BANDS['cavetto'][0] / 1005, BANDS['cavetto'][1] / 1005)
CREST_V = BANDS['slab'][0] / 1005


# ---------------------------------------------------------------- small helpers
def _grid(w, h, width_m, height_m):
    u = (np.arange(w) + 0.5) / w * width_m
    v = (h - 1 - np.arange(h) + 0.5) / h * height_m  # row 0 = top
    return np.meshgrid(u, v)


def _cell_rand(ix, iy, seed):
    h = (np.asarray(ix).astype(np.int64) * 73856093) ^ (np.asarray(iy).astype(np.int64) * 19349663)
    x = np.sin((h % 100003) * 12.9898 + seed * 7.31) * 43758.5453
    return x - np.floor(x)


def c3(rgb):
    return np.array(rgb, dtype=np.float64) / 255.0


def blur(a, r, axes=(0, 1), wrap=False):
    """Three box passes (~Gaussian of sigma ~ r), edge-clamped or wrapped."""
    out = np.asarray(a, dtype=np.float64)
    r = int(max(1, round(r)))
    for ax in axes:
        for _ in range(3):
            pad = [(0, 0)] * out.ndim
            pad[ax] = (r + 1, r)
            p = np.pad(out, pad, mode='wrap' if wrap else 'edge')
            c = np.cumsum(p, axis=ax)
            hi = np.take(c, np.arange(2 * r + 1, c.shape[ax]), axis=ax)
            lo = np.take(c, np.arange(0, c.shape[ax] - 2 * r - 1), axis=ax)
            out = (hi - lo) / (2 * r + 1)
    return out


def resample(a, h, w):
    """Bilinear resample of a 2D (or HxWxC) array to h x w."""
    H, W = a.shape[:2]
    ys = np.clip((np.arange(h) + 0.5) * H / h - 0.5, 0, H - 1)
    xs = np.clip((np.arange(w) + 0.5) * W / w - 0.5, 0, W - 1)
    y0, x0 = np.floor(ys).astype(int), np.floor(xs).astype(int)
    y1, x1 = np.minimum(y0 + 1, H - 1), np.minimum(x0 + 1, W - 1)
    fy, fx = (ys - y0)[:, None], (xs - x0)[None, :]
    if a.ndim == 3:
        fy, fx = fy[..., None], fx[..., None]
    top = a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx
    bot = a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx
    return top * (1 - fy) + bot * fy


def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def fill(img, mask, rgb):
    """img = lerp(img, rgb, mask)."""
    m = np.clip(mask, 0, 1)[..., None]
    img[:] = img * (1 - m) + c3(rgb) * m


def hsv(rgb):
    mx, mn = rgb.max(-1), rgb.min(-1)
    d = mx - mn
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    dd = np.maximum(d, 1e-9)
    h = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4))
    return h * 60, np.where(mx > 0, d / np.maximum(mx, 1e-9), 0), mx


def scrub(rgb, margin=4.0, min_sat=0.18):
    """Pull anything that drifted into the signal band (a blend, a block average) back to grey.
    margin widens the band, so a later lossy encode (ETC1S) cannot carry a texel back into it."""
    out = np.clip(np.asarray(rgb, dtype=np.float64), 0, 1).copy()
    for _ in range(3):
        h, s, v = hsv(out)
        bad = (np.abs((h - P.COBALT_HUE + 180) % 360 - 180) < P.HUE_GUARD + margin) & (s > min_sat)
        luma = (out @ np.array([0.299, 0.587, 0.114]))[..., None]
        out = np.where(bad[..., None], luma + (out - luma) * 0.35, out)
        H, W = out.shape[:2]
        if H % 4 or W % 4:
            continue
        blk = out.reshape(H // 4, 4, W // 4, 4, 3).mean((1, 3))
        bh, bs, bv = hsv(blk)
        bbad = (np.abs((bh - P.COBALT_HUE + 180) % 360 - 180) < P.HUE_GUARD + margin) & (bs > min_sat)
        if not bbad.any():
            break
        m = np.repeat(np.repeat(bbad, 4, 0), 4, 1)[..., None]
        out = np.where(m, luma + (out - luma) * 0.35, out)
    return out


def dark_neutral(rgb, v_max=0.45):
    """ETC1S's codebook drifts dark bluish texels (a black line over blue paint) into violet: the
    darkest blue-to-violet texels go nearly neutral (as the lightmaps' dark corners do)."""
    h, s_, v = hsv(rgb)
    # dark texels within 70 deg of the band (224-10 deg) go grey; dark blues keep half their chroma
    near = (v < 0.5) & ((h >= 224) | (h < 8)) & (s_ > 0.05)
    blue = (v < v_max) & (h > 170) & (h < 224) & (s_ > 0.05)
    luma = (rgb @ np.array([0.299, 0.587, 0.114]))[..., None]
    k = np.where(near, 0.12, np.where(blue, 0.5, 1.0))[..., None]
    return luma + (rgb - luma) * k


def guard(rgb, label):
    """The colour law, per texel (patterns.py) and per 4x4 block (what ETC1S keeps)."""
    P.assert_no_cobalt(rgb, label)
    H, W = rgb.shape[:2]
    if H % 4 == 0 and W % 4 == 0:
        P.assert_no_cobalt(rgb.reshape(H // 4, 4, W // 4, 4, 3).mean((1, 3)), label + ' (blocks)')


def finish(rgb, label):
    out = scrub(rgb)
    guard(out, label)
    return out


def normal_from(h, px_u, px_v, wrap_u=True, wrap_v=False):
    return P.height_to_normal(h, px_u, px_v, wrap_u=wrap_u, wrap_v=wrap_v)


# ---------------------------------------------------------------- ashlar sandstone
def sandstone(size=1024, normal_size=512):
    U, V = _grid(size, size, SAND_M, SAND_M)
    course = np.floor(V / 0.5)
    off = _cell_rand(course % 6, 0, 3) * 1.0
    block = np.floor((U + off) / 1.0)
    du = np.abs(((U + off) % 1.0) - 0.5) - 0.5          # 0 at a vertical joint
    dv = np.abs((V % 0.5) - 0.25) - 0.25
    joint = np.minimum(-du, -dv)                        # distance to the nearest joint
    tint = 0.9 + 0.12 * _cell_rand(block % 3, course % 6, 5)
    n1 = P.wave_noise(U / SAND_M, V / SAND_M, 31, n=40, fmin=3, fmax=40, period_u=1.0, period_v=1.0)
    strata = P.wave_noise(U / SAND_M * 0.3, V / SAND_M * 6, 32, n=16, fmin=2, fmax=12,
                          period_u=1.0, period_v=1.0)
    base = c3(SAND) * (tint + 0.05 * n1 + 0.035 * strata)[..., None]
    base = base * (1 - 0.35 * smooth(0.012, 0.0, joint))[..., None]
    col = finish(base, 'sandstone')
    Un, Vn = _grid(normal_size, normal_size, SAND_M, SAND_M)
    coursen = np.floor(Vn / 0.5)
    offn = _cell_rand(coursen % 6, 0, 3) * 1.0
    jn = np.minimum(0.5 - np.abs(((Un + offn) % 1.0) - 0.5), 0.25 - np.abs((Vn % 0.5) - 0.25))
    hgt = -0.006 * smooth(0.014, 0.0, jn) + 0.0015 * P.wave_noise(Un / SAND_M, Vn / SAND_M, 33, n=48,
                                                                   fmin=8, fmax=90, period_u=1.0,
                                                                   period_v=1.0)
    nrm = normal_from(hgt, SAND_M / normal_size, SAND_M / normal_size, wrap_v=True)
    return col, nrm


def paving(size=1024, normal_size=512):
    """Sandstone flags 1.5 x 0.75 m, rows offset by half a flag, worn and slightly mottled."""
    def fields(n):
        U, V = _grid(n, n, PAVE_M, PAVE_M)
        row = np.floor(V / 0.75)
        off = (row % 2) * 0.75
        col = np.floor((U + off) / 1.5)
        ju = 0.75 - np.abs(((U + off) % 1.5) - 0.75)
        jv = 0.375 - np.abs((V % 0.75) - 0.375)
        return U, V, row, col, np.minimum(ju, jv)
    U, V, row, colx, j = fields(size)
    tint = 0.9 + 0.14 * _cell_rand(colx % 2, row % 4, 9)
    n1 = P.wave_noise(U / PAVE_M, V / PAVE_M, 41, n=40, fmin=3, fmax=50, period_u=1.0, period_v=1.0)
    base = c3((192, 172, 138)) * (tint + 0.05 * n1)[..., None]
    base = base * (1 - 0.4 * smooth(0.01, 0.0, j))[..., None]
    col = finish(base, 'paving')
    U, V, row, colx, j = fields(normal_size)
    hgt = -0.005 * smooth(0.012, 0.0, j) + 0.0012 * P.wave_noise(U / PAVE_M, V / PAVE_M, 42, n=48,
                                                                  fmin=8, fmax=90, period_u=1.0,
                                                                  period_v=1.0)
    return col, normal_from(hgt, PAVE_M / normal_size, PAVE_M / normal_size, wrap_v=True)


# ---------------------------------------------------------------- drawn ornament
def kheker(h, w, period_px, ground=STONE):
    """The kheker frieze: rows of tied bundles with a rounded top, in ochre with yellow ties."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float64)
    lx = (x % period_px) / period_px - 0.5
    ly = y / h
    half = 0.3 - 0.08 * smooth(0.25, 0.0, ly) + 0.1 * smooth(0.55, 0.75, ly) - 0.12 * smooth(0.85, 1.0, ly)
    body = smooth(0.02, -0.02, np.abs(lx) - half) * smooth(0.0, 0.06, ly)
    tie = (np.abs(ly - 0.42) < 0.05) | (np.abs(ly - 0.55) < 0.04)
    img = np.broadcast_to(c3(ground), (h, w, 3)).copy()
    fill(img, body, RED)
    fill(img, body * tie, YELLOW)
    edge = smooth(0.035, 0.0, np.abs(np.abs(lx) - half)) * smooth(0.0, 0.06, ly)
    fill(img, edge * 0.7, BLACK)
    return img, body


def gorge_stripes(h, w, period_px):
    """The cavetto's vertical leaf stripes: blue, yellow, green, yellow (no red against blue)."""
    x = np.arange(w)[None, :].repeat(h, 0).astype(np.float64)
    k = np.floor(x / (period_px / 4)).astype(int) % 4
    img = np.zeros((h, w, 3))
    for i, c in enumerate((BLUE, YELLOW, GREEN, YELLOW)):
        img[k == i] = c3(c)
    edge = np.abs(((x / (period_px / 4)) % 1.0) - 0.5) > 0.42
    img[edge] = img[edge] * 0.55
    # leaf tips rounded at the bottom
    yy = np.arange(h)[:, None] / h
    img = img * (1 - 0.25 * smooth(0.8, 1.0, yy))[..., None]
    return img


# ---------------------------------------------------------------- the traced plate (Pl. 13 fig. 1)
def plate_panel(plate):
    """Crop Pl. 13 fig. 1 (a screen wall of the Dendera portico) from the full plate (grey, 0..1),
    tight to the drawing (rows and columns that are mostly ink, not paper). Returns the crop and
    its origin in plate pixels."""
    win = plate[VIEW['y0']:VIEW['y0'] + 1460, VIEW['x0']:VIEW['x0'] + 1015]
    ink = blur(win, 2) < 0.85
    rows = np.where(ink.mean(1) > 0.5)[0]
    cols = np.where(ink.mean(0) > 0.5)[0]
    y0, y1, x0, x1 = rows.min(), rows.max() + 1, cols.min(), cols.max() + 1
    return win[y0:y1, x0:x1], (VIEW['x0'] + x0, VIEW['y0'] + y0)


def _view_to_panel(origin, shape, xv, yv):
    """Fig. 1 view pixels (my 700 x 1005 crop) -> normalised panel coordinates."""
    ox, oy = origin
    x = VIEW['x0'] + xv * VIEW['s'] - ox
    y = VIEW['y0'] + yv * VIEW['s'] - oy
    return x / shape[1], y / shape[0]


def trace_relief(crop, h, w):
    """The plate's engraving -> relief fields at h x w. The engraver hatched the flat ground with
    close horizontal lines and left the carved figures smooth, so the hatching's energy (the
    vertical derivative, blurred) tells ground from relief: low energy is a raised figure."""
    E = blur(np.abs(np.diff(crop, axis=0, append=crop[-1:])), 4)
    L = resample(crop, h, w)
    E = resample(E, h, w)
    Lb = blur(L, 1.6)
    raised = smooth(0.36, 0.22, E)
    raised = smooth(0.35, 0.65, blur(raised, 1.5))
    near = blur(raised, 3) > 0.05
    lines = smooth(0.46, 0.26, Lb) * near
    edge = np.hypot(*np.gradient(blur(raised, 1.2)))
    lines = np.maximum(lines, smooth(0.08, 0.25, edge))
    mean_r = (Lb * raised).sum() / max(raised.sum(), 1)
    shade = np.where(raised > 0.5, np.clip(0.92 + 1.1 * (Lb - mean_r), 0.55, 1.18), 1.0)
    return raised, lines, shade, Lb


def screen_panel(plate, scene=True):
    """One screen wall in painted relief: the traced plate coloured with Ptolemaic paint by zone.
    scene=False keeps the traced frame bands and paints registers (no figures) in the field."""
    crop, origin = plate_panel(plate)
    H, W = PANEL_PX
    raised, lines, shade, Lb = trace_relief(crop, H, W)
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float64)

    def V(yv):   # view y -> this image's rows
        return _view_to_panel(origin, crop.shape, 0, yv)[1] * H

    def X(xv):
        return _view_to_panel(origin, crop.shape, xv, 0)[0] * W

    def band(name):
        a, b = BANDS[name]
        return (yy >= V(a)) & (yy < V(b))

    def box(x0, x1, y0, y1):
        return (xx >= X(x0)) & (xx < X(x1)) & (yy >= V(y0)) & (yy < V(y1))

    img = np.broadcast_to(c3(STONE), (H, W, 3)).copy()
    R = raised
    # crest: sun discs red, cobra hoods turquoise
    fill(img, R * band('discs'), RED)
    fill(img, R * (band('crest') & ~band('discs')), TURQ)
    fill(img, band('slab') * 1.0, YELLOW)
    # cavetto: leaf stripes, the winged disc over them
    cav = band('cavetto')
    stripe = np.floor(xx / (X(9.5) - X(0))).astype(int) % 4
    for i, c in enumerate((BLUE, YELLOW, GREEN, YELLOW)):
        fill(img, cav * (stripe == i) * np.maximum(R, 0.6), c)
    wing = box(100, 610, 168, 232)
    img[wing] = c3(STONE)
    fill(img, R * box(100, 610, 168, 190), YELLOW)
    fill(img, R * box(100, 610, 190, 212), BLUE)
    fill(img, R * box(100, 610, 212, 232), GREEN)
    disc = np.hypot(xx - X(350), yy - V(200)) < (X(21) - X(0))
    img[disc & wing] = c3(RED)
    fill(img, R * (box(312, 332, 180, 232) | box(368, 388, 180, 232)), GREEN)
    # the tori: a bound roll (red, yellow, green ribbons)
    tor = band('torus') | box(30, 58, 245, 1005) | box(645, 672, 245, 1005)
    ribbon = np.floor((xx + yy) / (X(7) - X(0))).astype(int) % 3
    for i, c in enumerate((RED, YELLOW, GREEN)):
        fill(img, tor * (ribbon == i) * np.maximum(R, 0.7), c)
    # the frieze of small Hathor heads: faces yellow, wigs blue, discs gold
    hb = band('heads') & box(58, 645, 0, 1005)
    period = (X(645) - X(58)) / 12
    lx = ((xx - X(58)) % period) / period - 0.5
    fill(img, R * hb * (np.abs(lx) < 0.16) * (yy > V(278)), YELLOW)
    fill(img, R * hb * (np.abs(lx) >= 0.16) * (yy > V(278)), BLUE)
    fill(img, R * hb * (yy <= V(278)), GOLD)
    # rosette band: yellow on blue; the green line under it
    rb = band('rosettes') & box(58, 645, 0, 1005)
    fill(img, rb * 1.0, BLUE)
    fill(img, rb * R, YELLOW)
    fill(img, band('line') & box(58, 645, 0, 1005), GREEN)
    if scene:
        # Horus: double crown (white over red), falcon head, collar, red skin, white kilt
        for (x0, x1), parts in (
            ((95, 240), [((415, 470), WHITE), ((470, 500), RED), ((500, 545), GREEN),
                         ((545, 565), YELLOW), ((565, 625), RED), ((625, 705), WHITE),
                         ((705, 795), RED)]),
            # Hathor: horns and disc, blue wig, yellow skin, red net dress
            ((245, 400), [((435, 490), BLACK), ((490, 540), BLUE), ((540, 612), YELLOW),
                          ((612, 775), RED), ((775, 795), YELLOW)]),
            # the king: white crown, red skin, green collar, white kilt
            ((440, 615), [((440, 530), WHITE), ((530, 548), RED), ((548, 562), GREEN),
                          ((562, 625), RED), ((625, 705), WHITE), ((705, 795), RED)]),
        ):
            for (y0, y1), c in parts:
                fill(img, R * box(x0, x1, y0, y1), c)
        # Hathor's face inside the wig, her sun disc red between the horns
        fill(img, R * box(288, 322, 498, 542), YELLOW)
        sun = np.hypot(xx - X(288), yy - V(462)) < (X(17) - X(0))
        fill(img, R * sun, RED)
        # the offering bowls and the empty cartouches in gold
        fill(img, R * (box(452, 528, 540, 560) | box(458, 522, 438, 497)), GOLD)
    else:
        f0, f1 = V(BANDS['scene'][0]), V(BANDS['scene'][1])
        fx = box(58, 645, 0, 1005)
        field = (yy >= f0) & (yy < f1) & fx
        img[field] = c3(STONE)
        # a plain painted field (the next round traces reliefs onto it): register rules only
        r0 = int(round(f0 + 6))
        for y0, c in ((r0 + int((f1 - f0) * 0.13), YELLOW), (int(f0 + (f1 - f0) * 0.55), RED),
                      (int(f1 - 14), GREEN)):
            img[y0:y0 + 5][fx[y0:y0 + 5]] = c3(c)
        # two ashlar joints in the bare field
        for t in (0.36, 0.78):
            y0 = int(f0 + (f1 - f0) * t)
            img[y0:y0 + 2][fx[y0:y0 + 2]] *= 0.82
        raised = raised * ~field
        lines = lines * ~field
        R = raised
    # the dado: birds and flowers gold, papyrus green, water blue at the foot
    db = band('dado') & box(58, 645, 0, 1005)
    fill(img, R * db * (yy < V(902)), GOLD)
    fill(img, R * db * (yy >= V(902)), GREEN)
    fill(img, db * ~(R > 0.3) * (yy > V(985)), BLUE)
    fill(img, band('ground') * (yy < V(806)), RED)
    # the engraving's own shading and lines keep every drawn detail
    img = img * (shade if scene else np.where(raised > 0, shade, 1.0))[..., None]
    fill(img, lines * 0.6 * (1.0 if scene else 1.0), BLACK)
    return finish(img, 'screen panel' + ('' if scene else ' (registers)')), raised, lines


def screen_field(plate):
    """The scene field of Pl. 13 fig. 1 (between its Hathor-head frieze and its ground line): its
    rectangle in panel pixels (r0, r1, c0, c1) and the plate's own crop of it."""
    crop, origin = plate_panel(plate)
    H, W = PANEL_PX
    u0, v0 = _view_to_panel(origin, crop.shape, 58, BANDS['scene'][0])
    u1, v1 = _view_to_panel(origin, crop.shape, 645, BANDS['scene'][1])
    rect = (int(round(v0 * H)), int(round(v1 * H)), int(round(u0 * W)), int(round(u1 * W)))
    Hc, Wc = crop.shape
    own = crop[int(v0 * Hc):int(v1 * Hc), int(u0 * Wc):int(u1 * Wc)]
    return rect, own


def screen_maps(plate, scene_crops, normal_px=(760, 2048)):
    """The four screen walls side by side, left to right: Pl. 13 fig. 1's traced frame (the
    uraeus crest, the cavetto with the winged disc, the Hathor frieze, the dado) around a whole
    traced scene each (temple_relief.SCREEN_SCENES; None = the plate's own scene), never mirrored.
    Returns the colour map and one normal map."""
    import temple_relief as R
    frame, raised, lines = screen_panel(plate, False)
    (r0, r1, c0, c1), own = screen_field(plate)
    fh, fw = r1 - r0, c1 - c0
    cols, hgts = [], []
    base_h = 0.004 * blur(raised, 2) - 0.0012 * lines
    for k, sid in enumerate(R.SCREEN_SCENES):
        img = frame.copy()
        hgt = base_h.copy()
        L = own if sid is None else scene_crops[sid]
        a = L.shape[1] / L.shape[0]
        sh, sw = (fh, int(round(fh * a))) if fh * a <= fw else (int(round(fw / a)), fw)
        sexes = 'mfm' if sid is None else R.SCENES[sid][2]
        rgb, ht, _ = R.paint(np.asarray(L, np.float64), sh, sw, sexes, seed=11 + k)
        img[r0:r1, c0:c1] = c3(R.GROUND)
        hgt[r0:r1, c0:c1] = 0.0
        y, x = r0 + (fh - sh) // 2, c0 + (fw - sw) // 2
        img[y:y + sh, x:x + sw] = rgb
        hgt[y:y + sh, x:x + sw] = 0.004 * blur(ht, 1.5)
        # ETC1S keeps one chroma per block: a red stroke beside a blue one must not average to
        # violet, so the screen walls take the wide margin the lightmaps use
        img = scrub(dark_neutral(img), margin=24.0, min_sat=0.10)
        guard(img, f'screen wall {k}')
        cols.append(img)
        hgts.append(hgt)
    col = np.concatenate(cols, 1)
    H, W = normal_px
    hgt = np.concatenate([resample(h, H, W // 4) for h in hgts], 1)
    m_per_px = 2.95 / H
    return col, normal_from(hgt, m_per_px, m_per_px, wrap_u=False)


def dado_strip(plate, h, w):
    """The papyrus dado of Pl. 13 fig. 1 as a seamless strip (cropped between two plants)."""
    crop, origin = plate_panel(plate)
    u0, v0 = _view_to_panel(origin, crop.shape, 58, BANDS['dado'][0])
    u1, v1 = _view_to_panel(origin, crop.shape, 645, BANDS['dado'][1])
    Hc, Wc = crop.shape
    strip = crop[int(v0 * Hc):int(v1 * Hc), int(u0 * Wc):int(u1 * Wc)]
    # the plants repeat: find the period from the column profile, cut whole periods from a gap
    prof = blur(strip, 2).mean(0)
    prof = prof - prof.mean()
    ac = np.correlate(prof, prof, 'full')[len(prof) - 1:]
    lo = len(prof) // 16
    period = lo + int(np.argmax(ac[lo:len(prof) // 6]))
    n = max(1, (len(prof) - period) // period)
    start = int(np.argmax(prof[:period]))          # brightest column: stone between two plants
    strip = strip[:, start:start + n * period]
    hs = h * 1
    raised, lines, shade, _ = trace_relief(strip, hs, w)
    yy = np.arange(hs)[:, None].repeat(w, 1) / hs
    img = np.broadcast_to(c3(STONE), (hs, w, 3)).copy()
    fill(img, raised * (yy < 0.22), GOLD)
    fill(img, raised * (yy >= 0.22), GREEN)
    fill(img, ~(raised > 0.3) * (yy > 0.86), BLUE)
    img = img * shade[..., None]
    fill(img, lines * 0.6, BLACK)
    return img, raised, lines, n


# ---------------------------------------------------------------- the enclosure wall's elevation
def wall_elevation(plate, normal_px=(896, 512)):
    H, W = WALL_PX
    m_px = WALL_H / H

    def rows(a, b):
        return int(round(H - b / m_px)), int(round(H - a / m_px))

    sand, _ = sandstone(1024, 64)
    img = np.zeros((H, W, 3))
    # the ashlar field, sampled from the sandstone map (3 m) at the elevation's scale
    yy, xx = np.mgrid[0:H, 0:W]
    su = ((xx + 0.5) / W * WALL_W / SAND_M * 1024).astype(int) % 1024
    sv = ((yy + 0.5) * m_px / SAND_M * 1024).astype(int) % 1024
    img[:] = sand[sv, su]
    hgt = np.zeros((H, W))
    r0, r1 = rows(*WALL_BANDS['base'])
    img[r0:r1] = c3(BLACK) * 1.2
    a, b = rows(0.12, 0.18)
    img[a:b] = c3(RED)
    r0, r1 = rows(*WALL_BANDS['dado'])
    strip, raised, lines, n = dado_strip(plate, r1 - r0, W)
    img[r0:r1] = strip
    hgt[r0:r1] = 0.004 * blur(raised, 2) - 0.0012 * lines
    for (y0, y1), c in (((0.88, 0.94), YELLOW), ((0.94, 0.98), GREEN), ((5.0, 5.06), RED),
                        ((5.5, 5.56), YELLOW)):
        a, b = rows(y0, y1)
        img[a:b] = c3(c)
    r0, r1 = rows(*WALL_BANDS['kheker'])
    kh, km = kheker(r1 - r0, W, period_px=W / 20)
    img[r0:r1] = kh
    hgt[r0:r1] = 0.003 * blur(km, 1)
    r0, r1 = rows(*WALL_BANDS['cornice'])
    img[r0:r1] = gorge_stripes(r1 - r0, W, period_px=W / 24)
    col = finish(img, 'wall elevation')
    nh, nw = normal_px
    nrm = normal_from(resample(hgt, nh, nw), WALL_W / nw, WALL_H / nh, wrap_u=True)
    return col, nrm


# ---------------------------------------------------------------- the Hathor column (Pl. 12)
# Atlas layout (2048 x 2048, row 0 = top). The geometry (temple_parts.hathor_column) maps into
# these rectangles, (u0, v0, u1, v1) in UV space (v up).
COLUMN_PX = 2048
COL_UV = dict(shaft=(0.0, 0.375, 0.5, 1.0), face=(0.5, 0.5, 1.0, 1.0),
              naos=(0.5, 0.135, 1.0, 0.5), plain=(0.5, 0.0, 1.0, 0.135),
              collar=(0.0, 0.0, 0.5, 0.375))
HEAD_SPAN = [0.0, 1.0]          # the head image's u span inside the face region, set by column_atlas
# the plain strip's swatches (u across it): sandstone, blue, yellow, red, white, green
PLAIN_SWATCHES = (STONE, BLUE, YELLOW, RED, WHITE, GREEN)


def _region(name, px=COLUMN_PX):
    u0, v0, u1, v1 = COL_UV[name]
    return (int(round((1 - v1) * px)), int(round((1 - v0) * px)), int(round(u0 * px)),
            int(round(u1 * px)))


# The Hathor head: Yousef's TRELLIS2 head (hathor_head.py: the front view cast into a height field,
# holes filled, made symmetric) painted in Ptolemaic colour. The image sits in the face region,
# centred, full height.
HEAD_IMG = (1024, 760)          # hathor_head_color.png (h, w)
HEAD_MODEL_W = 0.367            # the cast cell's width, model metres (hathor_head.CELL_Y)
# the head is carved in high relief on the capital's block: the bulk of the full round head is
# compressed (bulk) while the carving (eyes, lips, the wig's grooves, the ears) keeps its depth
HEAD_DEPTH = dict(bulk=0.36, detail=0.95, base_pct=6.0, corner=0.84)
HEAD_FACE = (214, 166, 80)      # Hathor's gold-ochre flesh (the gods' flesh of gold)
HEAD_LIGHT = (236, 230, 214)    # the wig's bead rows: gypsum white
HEAD_WIG = (42, 70, 132)        # the wig: Egyptian blue, coarse-ground (deep)


def head_displacement(depth):
    """hathor_head_depth.npy (row 0 = top, NaN outside) -> outward displacement in core
    half-widths, the same grid. The block shows where the head does not (d = 0)."""
    D = np.asarray(depth, dtype=np.float64)
    ok = ~np.isnan(D)
    base = np.percentile(D[ok], HEAD_DEPTH['base_pct'])
    rel = np.where(ok, np.clip(D - base, 0, None), 0.0) * (2.0 / HEAD_MODEL_W)
    low = blur(rel, 9)
    d = HEAD_DEPTH['bulk'] * low + HEAD_DEPTH['detail'] * (rel - low)
    u = np.linspace(-1, 1, D.shape[1])[None, :]
    d = d * smooth(1.0, HEAD_DEPTH['corner'], np.abs(u))      # the four heads meet at the corners
    return np.clip(d, 0, None), rel


def _dilate(m, r):
    out = m.copy()
    for _ in range(r):
        g = out.copy()
        g[1:] |= out[:-1]
        g[:-1] |= out[1:]
        g[:, 1:] |= out[:, :-1]
        g[:, :-1] |= out[:, 1:]
        out = g
    return out


def _holes(m):
    """The holes of a mask: what the outside cannot reach without crossing it."""
    reach = np.zeros_like(m)
    reach[0, :] = reach[-1, :] = True
    reach[:, 0] = reach[:, -1] = True
    reach &= ~m
    for _ in range(4000):
        grown = _dilate(reach, 1) & ~m
        if (grown == reach).all():
            break
        reach = grown
    return ~m & ~reach


def hathor_head_paint(rgba):
    """The TRELLIS colour (sRGB as seen from the front) -> Ptolemaic paint: the flesh gold ochre,
    the wig Egyptian blue, its bead rows white, the eyes white with black pupils and the kohl line.
    Each class keeps the model's own light and shade (its value relative to the class's median), so
    the carving and the wig's striations stay. Outside the head: the capital's sandstone."""
    rgb, al = np.asarray(rgba[..., :3], np.float64), np.asarray(rgba[..., 3], np.float64)
    inside = al > 0.5
    L = rgb @ np.array([0.299, 0.587, 0.114])
    yb = (rgb[..., 0] + rgb[..., 1]) / 2 - rgb[..., 2]          # the yellow-blue opponent
    warm = blur(smooth(0.30, 0.40, yb / np.maximum(L, 1e-3)) * inside, 1.2)
    h, w = L.shape
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float64)
    yy, xx = (yy + 0.5) / h, np.abs((xx + 0.5) / w - 0.5)
    # the flesh: the warm face closed over its highlights (the nose's tip, the eyes) and the ears
    hard = warm > 0.5
    closed = ~_dilate(~_dilate(hard, 6), 6)
    face = _holes(closed) | closed
    # the cow's ears: lighter than the wig they lie on
    ears = (yy > 0.41) & (yy < 0.55) & (xx > 0.25) & inside & (blur(L, 1.5) > 0.31)
    flesh = blur((face | ears).astype(np.float64), 1.0)
    # the eyes (where the model has them, on the face): the white only where the model's eye is
    # light, the pupil and the cosmetic line black where it is dark, flesh between
    zone = ((yy > 0.43) & (yy < 0.515) & (xx > 0.035) & (xx < 0.25)).astype(np.float64)
    eyes = blur(zone, 1.0) * flesh * (1 - hard) * smooth(0.36, 0.46, blur(L, 1.0))
    dark_eye = blur(zone, 1.0) * flesh * (1 - hard) * smooth(0.33, 0.24, blur(L, 1.0))
    warm = np.maximum(warm, flesh * (1 - eyes))
    light = blur(smooth(0.48, 0.58, L), 1.5) * (1 - warm) * (1 - eyes)
    wig = np.clip(1 - warm - light - eyes, 0, 1)

    def shade(mask, lo=0.55, hi=1.25):
        m = (mask > 0.5) & inside
        med = np.median(L[m]) if m.any() else 0.4
        return np.clip(L / med, lo, hi)[..., None]
    out = (warm[..., None] * c3(HEAD_FACE) * shade(warm)
           + light[..., None] * c3(HEAD_LIGHT) * shade(light, 0.75, 1.08)
           + wig[..., None] * c3(HEAD_WIG) * shade(wig, 0.55, 1.15))
    # the eye: white, its pupil and rims black (the darkest part of the model's eye)
    out += eyes[..., None] * c3(WHITE) * 0.92
    fill(out, dark_eye, BLACK)
    # the kohl line, brows and the lids' edges: the darkest strokes in the flesh
    fill(out, smooth(0.25, 0.17, L) * warm, BLACK)
    fill(out, (1 - inside) * 1.0, STONE)
    return out


def column_head(rgba, depth, h, w):
    """The face region of the column atlas (h x w): the painted head, centred, full height, the
    sandstone around it; and its detail height (the carving, for the normal map), metres at the
    7 m column."""
    img = np.broadcast_to(c3(STONE), (h, w, 3)).copy()
    hh, hw = h, int(round(HEAD_IMG[1] * h / HEAD_IMG[0]))
    x0 = (w - hw) // 2
    img[:, x0:x0 + hw] = resample(hathor_head_paint(rgba), hh, hw)
    _, rel = head_displacement(depth)
    a = 0.074 * 7.0                                              # the core's half-width, metres
    # gentle: the mesh carries the head's form; the map only adds the carving's fine edges
    det = np.clip((rel - blur(rel, 2.5)) * a * 0.3, -0.003, 0.003)
    hgt = np.zeros((h, w))
    hgt[:, x0:x0 + hw] = resample(det, hh, hw)
    return img, hgt, (x0 / w, (x0 + hw) / w)


def naos_side(h, w):
    """A side of the naos block: cavetto top band, a framed door (dark), side panels."""
    v, u = np.mgrid[0:h, 0:w].astype(np.float64)
    v = 1 - (v + 0.5) / h
    u = (u + 0.5) / w
    img = np.broadcast_to(c3(STONE), (h, w, 3)).copy()
    top = v > 0.8
    k = np.floor(u * 28).astype(int) % 4
    for i, c in enumerate((BLUE, YELLOW, GREEN, YELLOW)):
        fill(img, top * (k == i), c)
    fill(img, ((v > 0.76) & (v <= 0.8)) * 1.0, RED)
    door = (np.abs(u - 0.5) < 0.17) & (v < 0.68) & (v > 0.06)
    frame = (np.abs(u - 0.5) < 0.23) & (v < 0.72) & (v > 0.03) & ~door
    fill(img, frame * 1.0, YELLOW)
    fill(img, door * 1.0, (58, 44, 34))
    panel = (np.abs(u - 0.5) > 0.28) & (np.abs(u - 0.5) < 0.45) & (v > 0.1) & (v < 0.68)
    fill(img, panel * 1.0, TURQ)
    fill(img, (panel & (np.abs(((u * 40) % 1) - 0.5) > 0.4)) * 0.6, BLACK)
    return img


def shaft_bands(h, w, plate):
    """The shaft's registers (v = 0 at the base, 1 at the capital): painted bands and fields."""
    img = np.zeros((h, w, 3))
    sand, _ = sandstone(1024, 64)
    yy, xx = np.mgrid[0:h, 0:w]
    img[:] = sand[(yy * 2) % 1024, (xx * 2) % 1024] * 1.03
    hgt = np.zeros((h, w))

    def rows(a, b):
        return int(round((1 - b) * h)), int(round((1 - a) * h))

    for (a, b), c in (((0.0, 0.035), RED), ((0.035, 0.045), BLACK), ((0.155, 0.165), YELLOW),
                      ((0.42, 0.43), GREEN), ((0.43, 0.44), YELLOW), ((0.66, 0.67), YELLOW),
                      ((0.67, 0.68), GREEN), ((0.86, 0.87), YELLOW), ((0.955, 1.0), RED)):
        r0, r1 = rows(a, b)
        img[r0:r1] = c3(c)
    r0, r1 = rows(0.045, 0.155)
    strip, raised, lines, _ = dado_strip(plate, r1 - r0, w)
    img[r0:r1] = strip
    hgt[r0:r1] = 0.004 * blur(raised, 2)
    r0, r1 = rows(0.87, 0.955)
    img[r0:r1] = c3(BLUE)
    r0, r1 = rows(0.44, 0.66)
    kh, km = kheker(r1 - r0, w, period_px=w / 10)
    img[r0:r1] = kh
    hgt[r0:r1] = 0.003 * blur(km, 2)
    return img, hgt


def collar_band(h, w):
    """The broad collar round the column under the heads: rows of beads and drop pendants
    (green, red, blue, yellow on white), u around the column."""
    v, u = np.mgrid[0:h, 0:w].astype(np.float64)
    v = 1 - (v + 0.5) / h
    img = np.broadcast_to(c3(WHITE), (h, w, 3)).copy()
    rows = [(0.0, 0.08, YELLOW), (0.08, 0.30, GREEN), (0.30, 0.36, YELLOW), (0.36, 0.56, RED),
            (0.56, 0.62, YELLOW), (0.62, 0.84, BLUE), (0.84, 0.92, YELLOW), (0.92, 1.0, RED)]
    for a, b, c in rows:
        fill(img, ((v >= a) & (v < b)) * 1.0, c)
    # drop pendants in the lowest row, beads (small light dots) in the others
    k = w / 96
    lu = (u % k) / k - 0.5
    drop = (v < 0.30) & (np.abs(lu) < 0.32 * np.clip((v - 0.02) / 0.28, 0, 1) + 0.06)
    fill(img, drop * 1.0, TURQ)
    bead = (np.abs(lu) < 0.2) & (np.abs(((v * 26) % 1) - 0.5) < 0.22) & (v >= 0.30)
    fill(img, bead * 0.35, WHITE)
    edge = (np.abs(((v * 26) % 1) - 0.5) > 0.45)
    fill(img, edge * 0.4, BLACK)
    return img


def column_atlas(plate, head_rgba, head_depth):
    N = COLUMN_PX
    img = np.zeros((N, N, 3))
    hgt = np.zeros((N, N))
    r0, r1, c0, c1 = _region('shaft')
    s, sh = shaft_bands(r1 - r0, c1 - c0, plate)
    img[r0:r1, c0:c1] = s
    hgt[r0:r1, c0:c1] = sh
    r0, r1, c0, c1 = _region('face')
    f, d, span = column_head(head_rgba, head_depth, r1 - r0, c1 - c0)
    img[r0:r1, c0:c1] = f
    hgt[r0:r1, c0:c1] = d
    HEAD_SPAN[:] = span
    r0, r1, c0, c1 = _region('naos')
    img[r0:r1, c0:c1] = naos_side(r1 - r0, c1 - c0)
    r0, r1, c0, c1 = _region('plain')
    k = np.floor(np.linspace(0, len(PLAIN_SWATCHES), c1 - c0, endpoint=False)).astype(int)
    for i, c in enumerate(PLAIN_SWATCHES):
        img[r0:r1, c0:c1][:, k == i] = c3(c)
    r0, r1, c0, c1 = _region('collar')
    img[r0:r1, c0:c1] = collar_band(r1 - r0, c1 - c0)
    col = finish(img, 'column atlas')
    nrm = normal_from(resample(hgt, N // 2, N // 2), 0.0029, 0.0029, wrap_u=False)
    return col, nrm


def plain_uv(name):
    """UV of a swatch in the column atlas's plain strip."""
    u0, v0, u1, v1 = COL_UV['plain']
    i = [c3(c).tolist() for c in PLAIN_SWATCHES].index(c3(name).tolist())
    return (u0 + (i + 0.5) / len(PLAIN_SWATCHES) * (u1 - u0), (v0 + v1) / 2)


# ---------------------------------------------------------------- the title lintel
def title_lintel(glyph_alpha):
    """The door lintel: 𓉐𓋹 from the font (alpha 0..1: solid signs, render-hieroglyphs.mjs), sunk
    relief painted Egyptian blue, 75% of the lintel's height. The cut's upper and left inner walls
    stand in shadow (the noon sun is high and from the left)."""
    H, W = TITLE_PX
    U, V = _grid(W, H, 1.95, 1.10)
    grain = P.wave_noise(U, V, 81, n=40, fmin=8, fmax=120, period_u=1.95, period_v=1.10)
    img = c3((200, 172, 130)) * (0.965 + 0.05 * grain)[..., None]
    ink = glyph_alpha > 0.5
    rows, cols = np.where(ink.any(1))[0], np.where(ink.any(0))[0]
    g = glyph_alpha[rows.min():rows.max() + 1, cols.min():cols.max() + 1]
    gh = int(H * 0.75)
    gw = int(round(g.shape[1] * gh / g.shape[0]))
    g = resample(g, gh, gw)
    mask = np.zeros((H, W))
    y0, x0 = (H - gh) // 2, (W - gw) // 2
    mask[y0:y0 + gh, x0:x0 + gw] = g
    m = smooth(0.35, 0.65, mask)
    sh = 6
    up_left = np.zeros_like(m)
    up_left[sh:, sh:] = m[:-sh, :-sh]          # what lies sh px up and to the left of each pixel
    floor = m * up_left                          # the cut's floor, lit
    wall = m * (1 - up_left)                     # the upper and left inner walls, in shadow
    fill(img, m, (44, 38, 38))
    blue = c3(BLUE) * (0.96 + 0.08 * grain)[..., None]
    img = img * (1 - floor[..., None]) + blue * floor[..., None]
    fill(img, wall * 0.55, (20, 26, 44))
    edge = np.clip(m - blur(m, 1.6), 0, 1) * 3.0
    fill(img, edge * 0.5, (30, 28, 30))
    yy, xx = np.mgrid[0:H, 0:W]
    frame = np.minimum(np.minimum(yy, H - 1 - yy), np.minimum(xx, W - 1 - xx)) < 10
    fill(img, frame * 1.0, YELLOW)
    col = finish(img, 'title lintel')
    glow = np.clip(floor, 0, 1)[..., None] * c3(TITLE_GLOW) * (0.92 + 0.08 * grain)[..., None]
    glow = np.clip(glow, 0, 1)
    assert hsv(glow.reshape(-1, 3)[floor.reshape(-1) > 0.5][:200])[0].max() < 250, 'title glow hue'
    hgt = -0.012 * blur(m, 1.5)
    nrm = normal_from(resample(hgt, H // 2, W // 2), 1.95 / (W // 2), 1.10 / (H // 2), wrap_u=False)
    return col, nrm, float(floor.mean()), glow


# ---------------------------------------------------------------- granite, limestone, core
GRANITE_PALETTES = {
    # Aswan rose granite: feldspar pinks with grey quartz and dark mafic specks
    'rose': ((168, 128, 116), (190, 144, 130), (142, 112, 104), (184, 178, 172), (88, 72, 70), (36, 32, 32)),
    # Aswan grey granite (granodiorite), the pool's edge: near-neutral, a hair warm, so neither the
    # blue dusk sky nor the warm lamps can tint it towards the amethyst signal band (Yousef, 2026-10-18)
    'grey': ((124, 121, 117), (150, 146, 140), (100, 98, 95), (176, 173, 168), (62, 60, 58), (28, 27, 27)),
}


def granite_ground(h, w, seed, px_per_m, wrap=False, palette='rose'):
    """Aswan rose granite, polished: a pink-to-grey ground of feldspar grains with grey quartz
    and black biotite / hornblende speckle (all hues 0-25 deg or neutral, never violet). The
    grains are about 3-6 mm; wrap=True tiles the map."""
    rng = np.random.default_rng(seed)
    k = px_per_m / 540.0

    def field(sigma):
        n = blur(rng.standard_normal((h, w)), max(1.0, sigma * k), wrap=wrap)
        return n / n.std()
    mottle = field(30.0)          # broad tonal drift of the quarry block
    f1 = field(1.1)               # feldspar grains (~3-5 mm)
    f2 = field(0.7)               # fine speckle (~2 mm)
    f3 = field(1.7)               # mafic clots
    base, feld, dark, quartz, mafic, biotite = GRANITE_PALETTES[palette]
    img = np.broadcast_to(c3(base), (h, w, 3)).copy()
    img = img * (1 + 0.06 * mottle)[..., None]
    fill(img, smooth(0.0, 1.2, f1) * 0.9, feld)        # feldspar
    fill(img, smooth(0.2, 1.3, -f1) * 0.8, dark)       # darker grains
    fill(img, smooth(1.0, 1.7, f2) * 0.9, quartz)      # quartz
    fill(img, smooth(1.3, 1.9, -f3) * 0.7, mafic)      # hornblende clots
    fill(img, smooth(1.55, 2.2, -f2), biotite)         # biotite specks
    return img


def granite(size=512):
    """The granite tile (0.5 m): the pool's coping, steps and plinth, the door sill. Grey granite."""
    img = granite_ground(size, size, 51, size / 0.5, wrap=True, palette='grey')
    h = blur(np.random.default_rng(52).standard_normal((size, size)), 1.4, wrap=True)
    nrm = normal_from(h * 0.0004, 0.5 / size, 0.5 / size, wrap_u=True, wrap_v=True)
    return finish(img, 'granite'), nrm


OCHRE = (112, 72, 38)            # dark ochre: the sunk signs' fill on the pale obelisk stone
LIME_WARM = (222, 206, 172)      # the obelisks' fine limestone: warmer and honed, not polished


def lime_warm_ground(h, w, seed, px_per_m, wrap=False):
    """Fine honed limestone for the obelisks: a warm cream with a faint natural mottle (broad
    tonal drift and soft clouds, no speckle). wrap=True tiles the map."""
    rng = np.random.default_rng(seed)
    k = px_per_m / 540.0

    def field(sigma):
        n = blur(rng.standard_normal((h, w)), max(1.0, sigma * k), wrap=wrap)
        return n / n.std()
    broad, cloud, fine = field(36.0), field(9.0), field(2.2)
    img = np.broadcast_to(c3(LIME_WARM), (h, w, 3)).copy()
    img = img * (1 + 0.02 * broad + 0.008 * cloud + 0.005 * fine)[..., None]
    fill(img, smooth(0.8, 2.2, -cloud) * 0.07, (200, 182, 148))      # a faintly darker cloud
    fill(img, smooth(0.8, 2.2, broad) * 0.06, (232, 220, 192))       # a paler one
    return img


def lime_warm(size=512):
    """The obelisk pedestals' tile (0.5 m)."""
    return finish(lime_warm_ground(size, size, 91, size / 0.5, wrap=True), 'lime warm')


def poolstone(size=512):
    """The pool's basin: dark, slightly green slate-grey granite under the water."""
    img = granite_ground(size, size, 53, size / 0.5, wrap=True)
    lum = (img @ np.array([0.299, 0.587, 0.114]))[..., None]
    img = (lum * np.array([0.9, 0.97, 0.92]) * 0.52)
    h = blur(np.random.default_rng(54).standard_normal((size, size)), 1.4, wrap=True)
    nrm = normal_from(h * 0.0004, 0.5 / size, 0.5 / size, wrap_u=True, wrap_v=True)
    return finish(img, 'poolstone'), nrm



def limestone(size=512):
    """Polished white Tura limestone: pale, warm, flawless (the model is far too small for visible
    courses on the casing), the faintest tonal drift and fine grain for the sheen."""
    U, V = _grid(size, size, 1.0, 1.0)
    n1 = P.wave_noise(U, V, 61, n=40, fmin=3, fmax=40, period_u=1.0, period_v=1.0)
    n2 = P.wave_noise(U, V, 62, n=30, fmin=60, fmax=220, period_u=1.0, period_v=1.0)
    vein = np.exp(-((np.sin(6.0 * np.pi * (U * 0.7 + V * 0.4) + 2.2 * n1)) ** 2) * 60.0)
    img = c3((214, 208, 192)) * (0.985 + 0.014 * n1 + 0.006 * n2)[..., None]
    fill(img, vein * 0.05, (214, 204, 184))
    return finish(img, 'limestone')


# ---------------------------------------------------------------- the pyramid's frieze
FRIEZE_WASH = (204, 170, 104)    # the pale gold wash in the sunk signs (low contrast on the casing)
FRIEZE_SHADE = (120, 104, 78)    # the cut's shadowed upper and left inner walls


def frieze_signs(glyph_alpha):
    """Splits the rendered row (render-hieroglyphs.mjs: ankh, djed, was) into its three signs, each
    cropped to the common ink rows, so their baselines and heights stay the font's own."""
    ink = glyph_alpha > 0.5
    rows = np.where(ink.any(1))[0]
    cols = ink.any(0)
    edges = np.diff(np.concatenate([[0], cols.astype(int), [0]]))
    starts, ends = np.where(edges == 1)[0], np.where(edges == -1)[0]
    assert len(starts) == len(S.FRIEZE_SIGNS) == 3, f'the frieze row must hold exactly 3 signs, found {len(starts)}'
    return [glyph_alpha[rows.min():rows.max() + 1, a:b] for a, b in zip(starts, ends)]


def _carved_band(rows, centre, rule, sink, seeds, make_mask, stats, key):
    """A band of carved signs on plain Tura limestone, shared by the frieze and the Thoth bands: two
    fine incised rules (`rule` m up the face either side of the centre line, `centre` m high) and the
    signs make_mask(H, W, pxm) draws between them, each sunk `sink` m and washed pale gold. u spans the
    base's width, v the band up the slope. Returns the colour map and the normal map."""
    H, W = rows, S.FRIEZE_PX
    slant = S.band_slant(rows)
    U, V = _grid(W, H, S.BASE, slant)
    n1 = P.wave_noise(U, V, seeds[0], n=40, fmin=3, fmax=40, period_u=S.BASE, period_v=slant)
    n2 = P.wave_noise(U, V, seeds[1], n=30, fmin=60, fmax=220, period_u=S.BASE, period_v=slant)
    img = c3((214, 208, 192)) * (0.985 + 0.014 * n1 + 0.006 * n2)[..., None]
    pxm = S.FRIEZE_PXM
    signs_m = smooth(0.3, 0.7, make_mask(H, W, pxm))
    # the two rules: one fine incised line each, stopping where the face does
    rule_w = 2.5
    yy = np.arange(H)[:, None] + 0.5
    h = (H - yy) / pxm - slant / 2                              # slant offset from the centre line, m
    rules = np.zeros((H, W))
    for sgn in (-1, 1):
        rules = np.maximum(rules, smooth(rule_w, rule_w - 1.5, np.abs(h * pxm - sgn * rule * pxm)))
    hh = centre + h * S.SIN_SLOPE                               # height of each row
    half = np.maximum(0.0, (S.HEIGHT - hh) / S.TAN)
    s_m = (np.arange(W)[None, :] + 0.5) / pxm - S.HALF
    rules = rules * (np.abs(s_m) < half - 0.006)
    m = np.clip(signs_m + rules, 0, 1)
    sh_px = 2
    up_left = np.zeros_like(m)
    up_left[sh_px:, sh_px:] = m[:-sh_px, :-sh_px]
    wall = m * (1 - up_left)
    wash = c3(FRIEZE_WASH) * (0.96 + 0.06 * n1)[..., None]
    img = img * (1 - 0.62 * signs_m[..., None]) + wash * 0.62 * signs_m[..., None]
    fill(img, rules * 0.42, (176, 160, 132))
    fill(img, wall * 0.40, FRIEZE_SHADE)
    col = finish(img, f'casing {key}')
    hgt = -sink * blur(m, 1.2)
    nrm = normal_from(hgt, 1.0 / pxm, 1.0 / pxm, wrap_u=False)
    stats[f'{key}_carved_fraction'] = round(float(m.mean()), 4)
    return col, nrm


def frieze(glyph_alpha, stats):
    """The frieze band (pyramid_spec.frieze_band): 21 signs, ankh djed was repeating (a djed at the
    middle), each sunk 3 mm and washed pale gold."""
    signs = frieze_signs(glyph_alpha)

    def mask(H, W, pxm):
        out = np.zeros((H, W))
        sh = int(round(S.FRIEZE_SIGN_H * pxm))
        pasted = 0
        for i in range(S.FRIEZE_CELLS):
            g = blur(signs[i % 3], 3)
            gw = max(2, int(round(g.shape[1] * sh / g.shape[0])))
            g = resample(g, sh, gw)
            cx = int(round(W / 2 + (i - S.FRIEZE_CELLS // 2) * S.FRIEZE_CELL * pxm))
            y0, x0 = (H - sh) // 2, cx - gw // 2
            out[y0:y0 + sh, x0:x0 + gw] = np.maximum(out[y0:y0 + sh, x0:x0 + gw], g)
            pasted += 1
        assert pasted == S.FRIEZE_CELLS
        return out
    return _carved_band(S.FRIEZE_ROWS, S.FRIEZE_CENTRE, S.FRIEZE_RULE, 0.003, (61, 62), mask, stats,
                        'frieze')


def thoth_band(glyph_alpha, band, seeds, stats, key):
    """A band of "Thoth, lord of divine words": the rendered eight-sign row (render-hieroglyphs.mjs)
    scaled as one piece, so every sign keeps the font's own size and baseline, and repeated across
    the face, as many whole repeats as fit the face's width at the band, centred, `gap` apart."""
    ink = glyph_alpha > 0.5
    rows, cols = np.where(ink.any(1))[0], np.where(ink.any(0))[0]
    phrase = glyph_alpha[rows.min():rows.max() + 1, cols.min():cols.max() + 1]

    def mask(H, W, pxm):
        sh = int(round(band['sign_h'] * pxm))
        g = blur(phrase, max(1.0, phrase.shape[0] / sh / 1.5))
        gw = int(round(g.shape[1] * sh / g.shape[0]))
        g = resample(g, sh, gw)
        pw, pitch = gw / pxm, gw / pxm + band['gap']
        top = band['centre'] + band['sign_h'] / 2 * S.SIN_SLOPE
        room = 2 * (S.half_width(top) - 0.06)
        n = max(1, int((room + band['gap']) // pitch))
        stats[f'{key}_repeats'] = n
        out = np.zeros((H, W))
        y0 = (H - sh) // 2
        for k in range(n):
            x0 = int(round(W / 2 + ((k - (n - 1) / 2) * pitch - pw / 2) * pxm))
            out[y0:y0 + sh, x0:x0 + gw] = g
        return out
    return _carved_band(band['rows'], band['centre'], band['rule'], band['sink'], seeds, mask, stats,
                        key)


# ---------------------------------------------------------------- the obelisks (Luxor plates)
def _runs(mask1d):
    idx = np.where(mask1d)[0]
    return idx.min(), idx.max()


def _robust_line(ys, xs):
    ys, xs = np.asarray(ys, float), np.asarray(xs, float)
    keep = np.ones(len(ys), bool)
    for _ in range(4):
        c = np.polyfit(ys[keep], xs[keep], 1)
        r = np.abs(np.polyval(c, ys) - xs)
        keep = r < max(4.0, np.percentile(r[keep], 80) * 2)
    return c


def obelisk_faces(plate, y0=1230, y1=4480):
    """The three faces of one Luxor obelisk plate (grey 0..1), each rectified into a strip of
    OBELISK_PX: the shaft's two edges are fitted per face (a line each), and the plate is resampled
    between them, so every row spans the face's width. Rows y0..y1 are the shaft below the
    pyramidion; the plate's three drawings are found as the dark column groups."""
    Ht, Wt = OBELISK_PX
    dark = (plate[1500:4000, 300:3500] < 0.65).mean(0)
    cols = np.where(dark > 0.3)[0] + 300
    groups, a, b = [], cols[0], cols[0]
    for c in cols[1:]:
        if c > b + 20:
            groups.append((a, b))
            a = c
        b = c
    groups.append((a, b))
    assert len(groups) == 3, groups
    out = []
    rows = y0 + (np.arange(Ht) + 0.5) * (y1 - y0) / Ht
    yi = np.clip(np.round(rows).astype(int), 0, plate.shape[0] - 1)
    for ga, gb in groups:
        cx = (ga + gb) // 2
        ys = list(range(y0 + 40, y1 - 40, 40))
        left, right = [], []
        for y in ys:
            lo, hi = _runs(plate[y, cx - 300:cx + 300] < 0.7)
            left.append(lo + cx - 300)
            right.append(hi + cx - 300)
        cl, cr = _robust_line(ys, left), _robust_line(ys, right)
        xl, xr = np.polyval(cl, rows), np.polyval(cr, rows)
        xs = xl[:, None] + (xr - xl)[:, None] * (np.arange(Wt)[None, :] + 0.5) / Wt
        x0 = np.floor(xs).astype(int)
        fx = xs - x0
        out.append(plate[yi[:, None], x0] * (1 - fx) + plate[yi[:, None], x0 + 1] * fx)
    return out


OBELISK_COLUMN = (0.335, 0.665)      # the central inscription column: this span of the face's width
# atlas strip -> (plate, face): the western obelisk is Pl. 12, the eastern Pl. 11
# (plate, face, last traced row or None to find it). Pl. 11's middle face is scarred by an old break
# from about row 1900 down: the scar's shading must not be read as carving, so its text stops above.
OBELISK_SOURCES = [('12', 0, None), ('12', 1, None), ('12', 2, None), ('11', 0, None),
                   ('11', 1, 1850), ('11', 2, None)]


def obelisk_atlas(plates, stats):
    """Six face strips side by side (u: strip k of 6, v up the shaft), granite ground with the
    central inscription column of one plate face traced into each: the engraver's own relief
    (outline strokes and shading, band-passed) shades the pale limestone as sunk carving, and the
    sunk signs are filled a dark ochre. Nothing is drawn: every sign is the plate's. Returns the
    colour map and a normal map (half resolution)."""
    Ht, Wt = OBELISK_PX
    n = len(OBELISK_SOURCES)
    img = lime_warm_ground(Ht, n * Wt, 71, Wt / 0.53)
    hgt = 0.0003 * blur(np.random.default_rng(72).standard_normal((Ht, n * Wt)), 1.2)
    faces = {no: obelisk_faces(p) for no, p in plates.items()}
    c0, c1 = int(OBELISK_COLUMN[0] * Wt), int(OBELISK_COLUMN[1] * Wt)
    ends = []
    for k, (no, fi, fixed_end) in enumerate(OBELISK_SOURCES):
        L = faces[no][fi]
        bp = blur(L, 1.3) - blur(L, 5.0)
        e = blur(np.abs(bp)[:, c0:c1].mean(1)[:, None], 40, axes=(0,))[:, 0]
        plain = np.median(e[-260:])
        carved = np.where(e > plain * 1.55)[0]
        end = int(min(Ht - 40, (carved.max() if len(carved) else Ht // 2) + 36))
        end = fixed_end or end
        ends.append(end)
        relief = np.clip(bp / (3.0 * bp[:end, c0:c1].std()), -1, 1)
        # the glyphs' smooth bodies are slightly brighter than the stippled ground: a subtle dark fill
        body = smooth(0.012, 0.03, blur(L, 4) - blur(L, 22))
        u = np.zeros(Wt)
        u[c0:c1] = 1.0
        u = blur(u[None, :], 4, axes=(1,))[0]
        win = u[None, :] * smooth(end, end - 60, np.arange(Ht))[:, None]
        sl = slice(k * Wt, (k + 1) * Wt)
        g = img[:, sl]
        g *= (1 + 0.55 * relief * win)[..., None]
        strokes = np.clip(-relief * 1.3, 0, 1)    # the engraver's dark lines: the sunk cuts
        fill(g, np.clip(0.75 * strokes + 0.8 * body, 0, 0.9) * win, OCHRE)
        hgt[:, sl] += 0.0028 * relief * win - 0.0012 * body * win
        stats[f'obelisk_strip_{k}'] = f'Pl. {no} face {fi + 1}, rows 0-{end} of {Ht}'
    stats['obelisk_inscription_rows'] = ends
    col = finish(img, 'obelisk atlas')
    nrm = normal_from(resample(hgt, Ht // 2, n * Wt // 2), 0.53 / Wt * 2, 0.53 / Wt * 2,
                      wrap_u=False)
    return col, nrm


# ---------------------------------------------------------------- the Architects' papyrus
def papyrus_section():
    """A gridded papyrus sheet with the pyramid's section in black ink over a red grid, from the
    same numbers as the model (pyramid_spec.py). No text: the ruled columns stand for writing."""
    H, W = PAPYRUS_PX
    v, u = np.mgrid[0:H, 0:W].astype(np.float64)
    fib = 0.04 * P.wave_noise(u / W, v / H * 0.05, 71, n=24, fmin=40, fmax=160, period_u=1.0)
    img = c3((226, 204, 156)) * (0.97 + fib)[..., None]
    # the sheets of a roll, glued every ~ 1/5 of its width
    img[(u % (W / 5)) < 3] *= 0.9
    # the drawing: model metres -> pixels, base on a line near the bottom
    m = (W * 0.68) / S.BASE
    ox, oy = W * 0.40, H * 0.86

    def px(s, h):
        return ox + s * m, oy - h * m
    grid = 0.125 * m
    gl = (np.abs(((u - ox) / grid + 0.5) % 1 - 0.5) * grid < 0.9) | \
         (np.abs(((v - oy) / grid + 0.5) % 1 - 0.5) * grid < 0.9)
    inside = (u > W * 0.04) & (u < W * 0.76) & (v > H * 0.1) & (v < H * 0.93)
    fill(img, (gl & inside) * 0.75, RED)
    ink = np.zeros((H, W))

    def poly(pts, width=1.6):
        nonlocal ink
        for (a, b), (c, d) in zip(pts, pts[1:] + pts[:1]):
            x0, y0 = px(a, b)
            x1, y1 = px(c, d)
            ink = np.maximum(ink, smooth(width + 0.8, width - 0.4, P.d_seg(u, v, x0, y0, x1, y1)))
    poly(S.section_outline(), 2.4)
    for p in S.interior_polys():
        poly(p, 1.4)
    # the ruled columns of "text" to the right: plain ruled bars, no letterforms
    for i in range(7):
        x = W * (0.8 + i * 0.026)
        bar = (np.abs(u - x) < 3.2) & (v > H * 0.14) & (v < H * (0.52 + 0.05 * (i % 3)))
        ink = np.maximum(ink, bar * 0.55)
    fill(img, ink, BLACK)
    return finish(img, 'papyrus section')


# ---------------------------------------------------------------- the ceilings' stars
STARS_M = 1.2                    # the star map's tile, metres
RELIEF_RECTS = {}                # field -> its UV rectangle in the relief atlas, set by write_all


def stars(size=512):
    """The ceilings and soffits: five-pointed yellow stars on Egyptian blue, in staggered rows
    (allowed on ceilings only: the walls carry the plates' reliefs)."""
    U, V = _grid(size, size, STARS_M, STARS_M)
    img = np.broadcast_to(c3((34, 62, 132)), (size, size, 3)).copy()
    n = 4                                                 # stars per row per tile
    p = STARS_M / n
    best = np.full((size, size), 9.0)
    for oy, ox in ((0, 0), (0.5, 0.5)):
        cy = (np.floor(V / p - oy) + 0.5 + oy) * p
        cx = (np.floor(U / p - ox) + 0.5 + ox) * p
        dx, dy = U - cx, V - cy
        r = np.hypot(dx, dy)
        a = np.arctan2(dx, dy)
        k = (a % (2 * np.pi / 5)) - np.pi / 5
        R0, R1 = 0.11 * p, 0.28 * p                       # inner and outer radius of the star
        edge = R0 + (R1 - R0) * np.clip(1 - np.abs(k) / (np.pi / 5), 0, 1) ** 1.6
        best = np.minimum(best, r - edge)
    fill(img, smooth(0.004, -0.004, best), YELLOW)
    return finish(img, 'stars')


# ---------------------------------------------------------------- props palette
SWATCHES = {
    'wood': (124, 86, 52), 'wood_dark': (82, 56, 36), 'wood_pale': (168, 128, 84),
    'reed': (198, 164, 96), 'reed_dark': (164, 128, 70), 'papyrus': (224, 202, 152),
    'pottery': (172, 100, 64), 'pottery_dark': (128, 70, 44), 'linen': (230, 222, 200),
    'bronze': (150, 110, 64), 'cord': (186, 158, 112), 'ink': (40, 34, 30),
    'red': RED, 'yellow': YELLOW, 'blue': BLUE, 'green': GREEN, 'turquoise': TURQ,
    'white': WHITE, 'stone': STONE, 'granite_dark': (70, 56, 52), 'black': BLACK,
    'gold': GOLD, 'sand': SAND, 'basalt': (58, 56, 54),
    # the court's dressing: the baboons' dark stone, bread, the blue lotus, papyrus, faience
    'greywacke': (78, 82, 70), 'greywacke_dark': (52, 54, 46), 'bread': (196, 138, 70),
    'bread_dark': (150, 94, 48), 'lotus': (214, 226, 236), 'lotus_blue': (96, 140, 196),
    'leaf': (70, 118, 62), 'stem': (104, 140, 70), 'umbel': (150, 166, 84), 'faience': (44, 150, 150),
    'figs': (110, 70, 52), 'grapes': (64, 86, 60),
}


def palette():
    n = PALETTE_N
    cell = 32
    img = np.zeros((n * cell, n * cell, 3))
    for i, rgb in enumerate(SWATCHES.values()):
        r, c = divmod(i, n)
        img[r * cell:(r + 1) * cell, c * cell:(c + 1) * cell] = c3(rgb)
    return finish(img, 'palette')


def palette_uv():
    n = PALETTE_N
    return {name: ((i % n + 0.5) / n, 1 - (i // n + 0.5) / n) for i, name in enumerate(SWATCHES)}


# ---------------------------------------------------------------- write everything
def write_all(tex_dir, plate, glyph_alpha, stats, obelisk_plates, head_rgba, head_depth,
              scene_crops, frieze_alpha, thoth_alpha):
    """plate: Pl. 13 as grey 0..1 (H x W); glyph_alpha: the rendered title's alpha 0..1."""
    os.makedirs(tex_dir, exist_ok=True)

    def png(name, a):
        P.write_png(os.path.join(tex_dir, name), P.to_u8(a))

    col, nrm = sandstone()
    png('tl_sandstone_basecolor.png', col)
    png('tl_sandstone_normal.png', nrm)
    col, nrm = paving()
    png('tl_paving_basecolor.png', col)
    png('tl_paving_normal.png', nrm)
    col, nrm = wall_elevation(plate)
    png('tl_wall_basecolor.png', col)
    png('tl_wall_normal.png', nrm)
    import temple_relief as R
    col, nrm = screen_maps(plate, scene_crops)
    png('tl_screen_basecolor.png', col)
    png('tl_screen_normal.png', nrm)
    # the painted reliefs of every wall field, traced from the plates (temple_relief.py)
    col, hgt, rects = R.atlas(scene_crops, stats)
    col = scrub(dark_neutral(col), margin=24.0, min_sat=0.10)
    guard(col, 'relief atlas')
    png('tl_relief_basecolor.png', col)
    H, W = hgt.shape
    nh, nw = H // 4, W // 4
    png('tl_relief_normal.png', normal_from(resample(0.005 * hgt, nh, nw), 1.0 / 50, 1.0 / 50,
                                            wrap_u=False))
    RELIEF_RECTS.clear()
    RELIEF_RECTS.update(rects)
    stats['plate_table'] = R.plate_table()
    png('tl_stars_basecolor.png', stars())
    col, nrm = column_atlas(plate, head_rgba, head_depth)
    png('tl_column_basecolor.png', col)
    png('tl_column_normal.png', nrm)
    col, nrm, ink, glow = title_lintel(glyph_alpha)
    png('tl_title_basecolor.png', col)
    png('tl_title_normal.png', nrm)
    guard(glow, 'title glow')
    png('tl_title_glow.png', glow)
    stats['title_ink_fraction'] = round(ink, 4)
    col, nrm = granite()
    png('tl_granite_basecolor.png', col)
    png('tl_granite_normal.png', nrm)
    png('tl_limestone_basecolor.png', limestone())
    col, nrm = frieze(frieze_alpha, stats)
    png('tl_frieze_basecolor.png', col)
    png('tl_frieze_normal.png', nrm)
    col, nrm = thoth_band(thoth_alpha, S.THOTH_LOW, (63, 64), stats, 'thoth')
    png('tl_thoth_basecolor.png', col)
    png('tl_thoth_normal.png', nrm)
    col, nrm = thoth_band(thoth_alpha, S.THOTH_HIGH, (65, 66), stats, 'thoth_fine')
    png('tl_thoth_fine_basecolor.png', col)
    png('tl_thoth_fine_normal.png', nrm)
    png('tl_lime_warm_basecolor.png', lime_warm())
    col, nrm = poolstone()
    png('tl_poolstone_basecolor.png', col)
    png('tl_poolstone_normal.png', nrm)
    col, nrm = obelisk_atlas(obelisk_plates, stats)
    png('tl_obelisk_basecolor.png', col)
    png('tl_obelisk_normal.png', nrm)
    png('tl_papyrus_basecolor.png', papyrus_section())
    png('tl_cornice_basecolor.png', finish(gorge_stripes(256, 512, period_px=256), 'cornice'))
    # where the traced winged disc sits in the screen atlas (scene half): the door's cornice and
    # the facade's central cornice map onto it
    crop, origin = plate_panel(plate)
    u0, v0 = _view_to_panel(origin, crop.shape, 92, BANDS['cavetto'][0])
    u1, v1 = _view_to_panel(origin, crop.shape, 618, BANDS['cavetto'][1])
    WINGED_UV[:] = [u0 * 0.25, 1 - v1, u1 * 0.25, 1 - v0]
    stats['winged_uv'] = [round(x, 4) for x in WINGED_UV]
    png('tl_palette_basecolor.png', palette())
    # the swatches and the plain colours above all pass the guard at the stricter 0.25 sat
    assert P.cobalt_clash(np.array(list(SWATCHES.values())) / 255.0) == 0.0, 'palette swatch'


if __name__ == '__main__':
    # preview without Blender: python3 temple_textures.py <out dir>  (needs Pillow for the JPEG)
    from PIL import Image
    here = os.path.dirname(os.path.abspath(__file__))
    world = os.path.join(here, '..', 'worlds', 'house-of-life')
    plate = np.asarray(Image.open(os.path.join(world, 'refs', 'description-dendera-pl13-screen-walls.jpg'))
                       .convert('L'), dtype=np.float64) / 255.0
    glyph = np.asarray(Image.open(os.path.join(world, 'src', 'title_pr_ankh.png')).convert('RGBA'),
                       dtype=np.float64)[..., 3] / 255.0
    Image.MAX_IMAGE_PIXELS = None
    ob = {no: np.asarray(Image.open(os.path.join(world, 'refs', f'description-thbes-louqsor-pl{no}.jpg'))
                         .convert('L'), dtype=np.float32) / 255.0 for no in ('12', '11')}
    st = {}
    write_all(sys.argv[1], plate, glyph, st, ob)
    print(st)
