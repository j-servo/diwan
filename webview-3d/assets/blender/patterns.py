# Procedural Abbasid ornament as numpy fields: Samarra bevelled stucco, baked brick,
# lime plaster, cedar grain and the pierced-stucco window grille. Pure numpy, so the
# same code runs inside Blender's Python and anywhere else.
import os
import struct
import zlib

import numpy as np

TAU = 2 * np.pi


# ---------------------------------------------------------------- small helpers
def write_png(path, arr):
    """Minimal PNG writer. arr: HxW (gray) or HxWx3/4, uint8 or uint16. Row 0 = top."""
    arr = np.ascontiguousarray(arr)
    if arr.ndim == 2:
        arr = arr[:, :, None]
    h, w, c = arr.shape
    depth = 16 if arr.dtype == np.uint16 else 8
    ctype = {1: 0, 2: 4, 3: 2, 4: 6}[c]
    data = arr.astype('>u2' if depth == 16 else np.uint8).tobytes()
    stride = w * c * (depth // 8)
    raw = b''.join(b'\x00' + data[y * stride:(y + 1) * stride] for y in range(h))

    def chunk(tag, payload):
        body = tag + payload
        return struct.pack('>I', len(payload)) + body + struct.pack('>I', zlib.crc32(body) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, depth, ctype, 0, 0, 0))
    png += chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)


def to_u8(x):
    return (np.clip(x, 0, 1) * 255 + 0.5).astype(np.uint8)


def srgb(rgb255):
    return np.array(rgb255, dtype=np.float64) / 255.0


def wave_noise(u, v, seed, n=48, fmin=6, fmax=90, period_u=1.0, period_v=None):
    """Smooth band-limited noise in [-1,1]-ish; tiles in u (and v if period_v)."""
    rng = np.random.default_rng(seed)
    out = np.zeros_like(u)
    for _ in range(n):
        f = rng.uniform(fmin, fmax)
        ang = rng.uniform(0, TAU)
        ku = np.round(f * np.cos(ang) * period_u) / period_u
        kv = f * np.sin(ang)
        if period_v:
            kv = np.round(kv * period_v) / period_v
        out += np.sin(TAU * (ku * u + kv * v) + rng.uniform(0, TAU)) / np.sqrt(max(f, 1))
    return out / (np.abs(out).max() + 1e-9)


def height_to_normal(h, px_size_u, px_size_v, wrap_u=True, wrap_v=False):
    """Tangent-space normal (OpenGL +Y, glTF convention) from a height field, row 0 = top."""
    if wrap_u:
        dhdu = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / (2 * px_size_u)
    else:
        dhdu = np.gradient(h, px_size_u, axis=1)
    if wrap_v:
        dhdv_down = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / (2 * px_size_v)
    else:
        dhdv_down = np.gradient(h, px_size_v, axis=0)
    dhdv = -dhdv_down  # rows go down, v goes up
    n = np.stack([-dhdu, -dhdv, np.ones_like(h)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


# Each world's "needs you" signal: (hue deg, guard deg). Nothing saturated sits within the guard.
#   house-of-wisdom  cobalt #2f5bea, 25 deg (unchanged)
#   house-of-life    amethyst #A21CAF, 40 deg: 255-335 deg is forbidden
SIGNALS = {'house-of-wisdom': (226.0, 25.0), 'house-of-life': (295.0, 40.0)}
COBALT_HUE, HUE_GUARD = SIGNALS[os.environ.get('DIWAN_WORLD', 'house-of-wisdom')]


def cobalt_clash(rgb, min_sat=0.25, min_val=0.15):
    """Fraction of chromatic texels (sRGB 0..1) whose hue sits within HUE_GUARD of cobalt."""
    flat = np.asarray(rgb, dtype=np.float64).reshape(-1, 3)
    mx, mn = flat.max(1), flat.min(1)
    d = mx - mn
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0)
    r, g, b = flat.T
    dd = np.maximum(d, 1e-9)
    h = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4))
    near = np.abs((h * 60 - COBALT_HUE + 180) % 360 - 180) < HUE_GUARD
    return float((near & (sat >= min_sat) & (mx >= min_val)).mean())


def assert_no_cobalt(rgb, label):
    frac = cobalt_clash(rgb)
    assert frac == 0.0, f'{label}: {frac:.4%} of texels sit within {HUE_GUARD} deg of cobalt'


# ---------------------------------------------------------------- distance primitives
def d_seg(x, y, ax, ay, bx, by):
    pax, pay, bax, bay = x - ax, y - ay, bx - ax, by - ay
    h = np.clip((pax * bax + pay * bay) / (bax * bax + bay * bay), 0, 1)
    return np.hypot(pax - bax * h, pay - bay * h)


def d_arc(x, y, cx, cy, r, a0, a1):
    """Distance to a circular arc running counter-clockwise from a0 to a1 (degrees)."""
    a0r, a1r = np.radians(a0), np.radians(a1)
    dx, dy = x - cx, y - cy
    t = np.mod(np.arctan2(dy, dx) - a0r, TAU)
    on = t <= (a1r - a0r)
    ring = np.abs(np.hypot(dx, dy) - r)
    e0 = np.hypot(x - (cx + r * np.cos(a0r)), y - (cy + r * np.sin(a0r)))
    e1 = np.hypot(x - (cx + r * np.cos(a1r)), y - (cy + r * np.sin(a1r)))
    return np.where(on, ring, np.minimum(e0, e1))


def d_spiral(x, y, cx, cy, r0, step, n, rot=0.0, flip=False):
    """Two-centre spiral of n semicircles (compass construction, as a stucco carver would)."""
    c, s = np.cos(np.radians(rot)), np.sin(np.radians(rot))
    lx = (x - cx) * c + (y - cy) * s
    ly = -(x - cx) * s + (y - cy) * c
    if flip:
        lx = -lx
    d = np.full(np.shape(x), np.inf)
    for k in range(n):
        r = r0 + k * step
        if k % 2 == 0:
            d = np.minimum(d, d_arc(lx, ly, 0, 0, r, 0, 180))
        else:
            d = np.minimum(d, d_arc(lx, ly, step, 0, r, 180, 360))
    return d


# ---------------------------------------------------------------- Samarra bevelled stucco
STUCCO_W, STUCCO_H = 1.0, 0.5  # metres covered by the trim (tiles in u)


def _unit_bottle(u, v):
    """Unit A, 0.5 m wide: bottle/vase flanked by winged leaves ending in volutes (mirror sym)."""
    x = 0.25 + np.abs(u - 0.25)  # mirror into the right half
    d = np.full(np.shape(u), np.inf)
    d = np.minimum(d, d_arc(x, v, 0.25, 0.185, 0.072, -90, 68))          # bottle body
    d = np.minimum(d, d_seg(x, v, 0.277, 0.252, 0.268, 0.318))           # neck
    d = np.minimum(d, d_arc(x, v, 0.306, 0.318, 0.038, 40, 180))         # flared lip
    d = np.minimum(d, d_spiral(x, v, 0.372, 0.352, 0.010, 0.0085, 5, rot=200))  # upper volute
    d = np.minimum(d, d_arc(x, v, 0.25, 0.305, 0.165, -48, 14))          # wing outer
    d = np.minimum(d, d_arc(x, v, 0.25, 0.305, 0.118, -62, 4))           # wing inner
    d = np.minimum(d, d_spiral(x, v, 0.392, 0.142, 0.010, 0.0085, 6, rot=20, flip=True))  # lower volute
    d = np.minimum(d, d_arc(x, v, 0.25, 0.185, 0.040, -90, 90))          # inner body line
    d = np.minimum(d, d_seg(x, v, 0.25, 0.05, 0.25, 0.113))              # foot stem
    d = np.minimum(d, d_arc(x, v, 0.25, 0.305, 0.205, -30, 22))          # wing echo
    d = np.minimum(d, d_arc(x, v, 0.25, 0.402, 0.034, -40, 90))          # crown lobe
    d = np.minimum(d, d_arc(x, v, 0.5, 0.045, 0.062, 90, 180))           # corner fillers
    d = np.minimum(d, d_arc(x, v, 0.5, 0.455, 0.062, 180, 270))
    d = np.minimum(d, d_arc(x, v, 0.25, 0.045, 0.045, 0, 90))            # foot lobe
    for a in (-55, -20, 15):                                             # gadroons on the body
        ca, sa = np.cos(np.radians(a)), np.sin(np.radians(a))
        d = np.minimum(d, d_seg(x, v, 0.25 + 0.046 * ca, 0.185 + 0.046 * sa,
                                0.25 + 0.066 * ca, 0.185 + 0.066 * sa))
    eyes = np.minimum.reduce([
        np.hypot(x - 0.25, v - 0.185), np.hypot(x - 0.372, v - 0.352),
        np.hypot(x - 0.396, v - 0.142), np.hypot(x - 0.25, v - 0.41),
        np.hypot(x - 0.335, v - 0.265),
    ])
    return d, eyes


def _unit_palmette(u, v):
    """Unit B, 0.5 m wide: trilobed palmette on a stem between two volutes (mirror sym)."""
    x = 0.25 + np.abs(u - 0.25)
    d = np.full(np.shape(u), np.inf)
    d = np.minimum(d, d_arc(x, v, 0.25, 0.345, 0.062, -40, 90))          # top lobe
    d = np.minimum(d, d_arc(x, v, 0.318, 0.262, 0.056, -95, 125))        # side lobe
    d = np.minimum(d, d_arc(x, v, 0.25, 0.262, 0.030, -90, 90))          # heart
    d = np.minimum(d, d_seg(x, v, 0.262, 0.05, 0.268, 0.208))            # stem
    d = np.minimum(d, d_spiral(x, v, 0.405, 0.115, 0.010, 0.0085, 6, rot=-15, flip=True))
    d = np.minimum(d, d_arc(x, v, 0.43, 0.30, 0.10, 110, 215))           # sweeping leaf
    d = np.minimum(d, d_spiral(x, v, 0.415, 0.40, 0.009, 0.008, 4, rot=160))
    d = np.minimum(d, d_arc(x, v, 0.25, 0.345, 0.092, 10, 90))           # lobe echo
    d = np.minimum(d, d_arc(x, v, 0.318, 0.262, 0.082, -80, 40))
    d = np.minimum(d, d_arc(x, v, 0.5, 0.045, 0.062, 90, 180))           # corner fillers
    d = np.minimum(d, d_arc(x, v, 0.5, 0.455, 0.062, 180, 270))
    d = np.minimum(d, d_arc(x, v, 0.262, 0.05, 0.075, 0, 70))            # base leaf
    d = np.minimum(d, d_seg(x, v, 0.30, 0.16, 0.345, 0.20))              # notch
    eyes = np.minimum.reduce([
        np.hypot(x - 0.25, v - 0.345), np.hypot(x - 0.318, v - 0.262),
        np.hypot(x - 0.405, v - 0.115), np.hypot(x - 0.415, v - 0.40),
        np.hypot(x - 0.25, v - 0.262),
    ])
    return d, eyes


def stucco_fields(u, v):
    """Groove distance + eye distance for the 1.0 m x 0.5 m Samarra band (u wraps at 1.0)."""
    u = np.mod(u, STUCCO_W)
    ua = np.mod(u, 0.5)
    dA, eA = _unit_bottle(ua, v)
    dB, eB = _unit_palmette(ua, v)
    first = u < 0.5
    d = np.where(first, dA, dB)
    eyes = np.where(first, eA, eB)
    # frame: band edges, inner frame lines and the panel joint between moulded units
    d = np.minimum(d, np.minimum(v, STUCCO_H - v))
    d = np.minimum(d, np.minimum(np.abs(v - 0.045), np.abs(v - 0.455)))
    joint = np.minimum(ua, 0.5 - ua)
    d = np.minimum(d, np.where((v > 0.045) & (v < 0.455), joint, np.inf))
    return d, eyes


def stucco_height(u, v):
    """Slanted cut rounding into the top, soft pillowing (no flat ground), drilled eyes."""
    d, eyes = stucco_fields(u, v)
    return relief_height(d, eyes, u, v), d


def stucco_color(u, v, d):
    return relief_color(u, v, d)                         # grime settles in the grooves


def relief_height(d, eyes, u, v, period_u=1.0, period_v=None, seed=11):
    """Bevelled-style carving from a groove-distance field (the Samarra band's profile)."""
    g, bevel = 0.0010, 0.016
    t = np.clip((d - g) / bevel, 0, 1)
    h = 0.0105 * (2 * t - t * t)
    h += 0.0055 * np.clip((d - g) / 0.045, 0, 1) ** 0.8
    h -= 0.011 * np.sqrt(np.clip(1 - eyes / 0.0062, 0, 1))
    h += 0.00018 * wave_noise(u, v, seed, fmin=30, fmax=160, period_u=period_u, period_v=period_v)
    return h


def relief_color(u, v, d, period_u=1.0, period_v=None, base=(226, 211, 184)):
    n = wave_noise(u, v, 5, fmin=2, fmax=25, period_u=period_u, period_v=period_v)
    dirt = 0.80 + 0.20 * np.clip(d / 0.005, 0, 1)
    return srgb(base)[None, None, :] * ((1 + 0.035 * n) * dirt)[..., None]


# ---------------------------------------------------------------- Samarra field (large panels)
SAMARRA_M = 1.0   # tiles both ways: a checkerboard of the band's two moulded units


def samarra_fields(u, v):
    """The bottle and palmette units in a 2 x 2 checkerboard per metre, with moulding joints:
    for niche backs and spandrels (tiles in u and v)."""
    u, v = np.mod(u, SAMARRA_M), np.mod(v, SAMARRA_M)
    lu, lv = np.mod(u, 0.5), np.mod(v, 0.5)
    dA, eA = _unit_bottle(lu, lv)
    dB, eB = _unit_palmette(lu, lv)
    a = (np.floor(u / 0.5) + np.floor(v / 0.5)) % 2 == 0
    d = np.where(a, dA, dB)
    eyes = np.where(a, eA, eB)
    d = np.minimum(d, np.minimum.reduce([lu, 0.5 - lu, lv, 0.5 - lv]))
    return d, eyes


# ---------------------------------------------------------------- frieze under the cornice
FRIEZE_W, FRIEZE_H = 1.0, 0.5
# The glazed-tile frieze (frieze_arabesque.png, 1210 x 768 px, two medallion periods) fills the
# band's height and keeps its true aspect: one texture repeat is this wide in metres (u).
FRIEZE_TEX_PX = (1210, 768)
FRIEZE_TEX_W = FRIEZE_H * FRIEZE_TEX_PX[0] / FRIEZE_TEX_PX[1]
FRIEZE_JOINTS = (8, 5)         # tile joints per repeat: ~10 cm square glazed tiles


def frieze_fields(u, v):
    """Blind arcade frieze: pointed arches on colonnettes, a palmette in each, drilled eyes in
    the spandrels, between two pearl borders. Four bays per metre; tiles in u."""
    u = np.mod(u, FRIEZE_W)
    x = 0.125 + np.abs(np.mod(u, 0.25) - 0.125)            # mirror each bay about its axis
    d = np.minimum.reduce([v, FRIEZE_H - v, np.abs(v - 0.065), np.abs(v - 0.435)])
    for vc in (0.0325, 0.4675):                               # pearl borders
        d = np.minimum(d, np.abs(np.hypot(np.mod(u, 0.05) - 0.025, v - vc) - 0.0165))
    half, spring = 0.094, 0.235
    dd = 0.3 * half
    for r in (half + dd, half + dd - 0.022):                  # double arch outline
        a = np.degrees(np.arccos(dd / r))
        d = np.minimum(d, d_arc(x, v, 0.125 - dd, spring, r, 0, a))
    d = np.minimum(d, d_seg(x, v, 0.125 + half, 0.065, 0.125 + half, spring))   # colonnette
    d = np.minimum(d, d_seg(x, v, 0.125 + half - 0.022, spring, 0.25, spring))  # impost band
    # palmette: short stem, two leaves curling out from its foot, a trilobed crown
    d = np.minimum(d, d_seg(x, v, 0.125, 0.065, 0.125, 0.13))
    d = np.minimum(d, d_arc(x, v, 0.172, 0.095, 0.047, 105, 180))
    d = np.minimum(d, d_spiral(x, v, 0.186, 0.142, 0.006, 0.0055, 4, rot=200))
    d = np.minimum(d, d_arc(x, v, 0.125, 0.235, 0.052, -62, 90))              # top lobe
    d = np.minimum(d, d_arc(x, v, 0.158, 0.178, 0.034, -120, 130))            # side lobe
    d = np.minimum(d, d_arc(x, v, 0.125, 0.205, 0.026, -90, 90))              # heart
    d = np.minimum(d, np.abs(np.hypot(x - 0.25, v - 0.37) - 0.026))           # spandrel boss
    eyes = np.minimum(np.hypot(x - 0.25, v - 0.37), np.hypot(x - 0.125, v - 0.205))
    return d, eyes


# ---------------------------------------------------------------- lustre-tile dado panels
DADO_W, DADO_H, DADO_BORDER = 1.5, 1.125, 0.07
TILE_S = 0.165    # side of a square tile, set on point (the Kairouan mihrab tiles, Iraq c. 862)


def _tile_motifs(p, q, k):
    """Lustre motif masks in tile-local coords p, q in [-0.5, 0.5]: k picks the design.
    Returns (gold, brown) boolean masks."""
    r = np.hypot(p, q)
    ap, aq = np.abs(p), np.abs(q)
    gold = np.zeros(np.shape(p), bool)
    brown = np.zeros(np.shape(p), bool)
    m0, m1, m2, m3 = (k == 0), (k == 1), (k == 2), (k == 3)
    # 0: peacock-eye roundel on a dotted ground
    dots = (np.hypot(np.mod(p * 7, 1) - 0.5, np.mod(q * 7, 1) - 0.5) < 0.22) & (r > 0.36)
    gold |= m0 & (dots | ((r < 0.33) & (r > 0.2)) | (r < 0.09))
    brown |= m0 & (((r < 0.36) & (r >= 0.33)) | ((r < 0.2) & (r >= 0.15)))
    # 1: quatrefoil with a brown outline, gold heart
    lobe = np.minimum.reduce([np.hypot(p - 0.17, q), np.hypot(p + 0.17, q),
                              np.hypot(p, q - 0.17), np.hypot(p, q + 0.17)])
    gold |= m1 & (lobe < 0.15)
    brown |= m1 & (lobe >= 0.15) & (lobe < 0.19)
    brown |= m1 & (r < 0.06)
    # 2: chequer framed by a band
    chq = ((np.floor(p * 6 + 3) + np.floor(q * 6 + 3)) % 2 == 0) & (np.maximum(ap, aq) < 0.33)
    gold |= m2 & chq
    brown |= m2 & (np.maximum(ap, aq) >= 0.36) & (np.maximum(ap, aq) < 0.42)
    # 3: four palmette leaves pointing to the corners, brown cross between
    lp, lq = (p + q) / np.sqrt(2), (p - q) / np.sqrt(2)
    leaf = (np.abs(np.abs(lp) - 0.24) < 0.17 - np.abs(lq) * 1.1) | \
           (np.abs(np.abs(lq) - 0.24) < 0.17 - np.abs(lp) * 1.1)
    gold |= m3 & leaf
    brown |= m3 & (np.minimum(ap, aq) < 0.03) & ~leaf
    return gold, brown


def dado_maps(u, v):
    """Framed dado panel, 1.5 m x 1.125 m, tiling in u: lustre tiles set on point in a field
    framed by a moulded brick border with a carved bead. Returns (height, colour)."""
    u = np.mod(u, DADO_W)
    b = DADO_BORDER
    edge = np.minimum.reduce([u, DADO_W - u, v, DADO_H - v])
    inside = edge > b
    # tiles: rotated grid anchored on the field centre, so both edges cut symmetrically
    x, y = u - DADO_W / 2, v - DADO_H / 2
    s = TILE_S
    pr, qr = (x + y) / np.sqrt(2) / s, (x - y) / np.sqrt(2) / s
    ip, iq = np.floor(pr), np.floor(qr)
    p, q = pr - ip - 0.5, qr - iq - 0.5
    k = ((ip * 7 + iq * 3).astype(np.int64)) % 4
    gold, brown = _tile_motifs(p, q, k)
    grout = np.minimum(0.5 - np.abs(p), 0.5 - np.abs(q)) * s        # metres to the joint
    cream, lustre, ruby = srgb((232, 220, 192)), srgb((182, 134, 58)), srgb((120, 66, 38))
    olive = srgb((128, 120, 62))
    alt = (((ip + iq) % 3) == 0)[..., None]                           # some tiles olive-gold
    tile = np.where(gold[..., None], np.where(alt, olive, lustre), cream)
    tile = np.where(brown[..., None], ruby, tile)
    glaze = 1 + 0.03 * wave_noise(u, v, 141, fmin=6, fmax=60, period_u=DADO_W)
    tile = tile * glaze[..., None]
    mortar = srgb((196, 184, 160))
    t = np.clip((grout - 0.0025) / 0.002, 0, 1)
    field_col = tile * t[..., None] + mortar * (1 - t[..., None])
    field_h = 0.004 * t + 0.0003 * (gold | brown)                     # lustre sits proud a hair
    # border: brick moulding, a carved bead in its middle, and a fillet at the field edge
    bh, bc = brick_maps(u, v)
    bead = np.abs(np.hypot(np.mod(np.where(np.minimum(u, DADO_W - u) < np.minimum(v, DADO_H - v),
                                           v, u), 0.07) - 0.035, edge - b / 2) - 0.022)
    tb = np.clip(1 - edge / 0.004, 0, 1) + np.clip(1 - np.abs(edge - b) / 0.004, 0, 1)
    border_h = 0.009 + 0.004 * np.clip(bead / 0.006, 0, 1) - 0.006 * np.clip(tb, 0, 1)
    border_col = bc * (0.92 + 0.08 * np.clip(bead / 0.004, 0, 1))[..., None]
    h = np.where(inside, field_h, border_h)
    col = np.where(inside[..., None], field_col, border_col)
    return h, col


# ---------------------------------------------------------------- baked brick (1 m x 1 m tile)
BRICK_LEN, COURSE, JOINT = 0.25, 0.0625, 0.015


def brick_fields(u, v):
    course = np.floor(v / COURSE)
    off = np.mod(course, 2) * (BRICK_LEN / 2)
    uu = u + off
    col = np.floor(uu / BRICK_LEN)
    lx = np.mod(uu, BRICK_LEN)
    ly = np.mod(v, COURSE)
    j = JOINT / 2
    d_edge = np.minimum.reduce([lx - j, BRICK_LEN - j - lx, ly - j, COURSE - j - ly])
    bid = (np.mod(col, 4) * 16 + np.mod(course, 16)).astype(np.int64)
    return d_edge, bid


def brick_maps(u, v):
    d_edge, bid = brick_fields(u, v)
    rng = np.random.default_rng(3)
    r_h = rng.uniform(-0.0007, 0.0007, 64)
    r_tu = rng.uniform(-0.004, 0.004, 64)
    r_tv = rng.uniform(-0.01, 0.01, 64)
    r_col = rng.uniform(0, 1, 64)
    r_val = rng.uniform(0.86, 1.06, 64)
    chip = wave_noise(u, v, 21, fmin=25, fmax=140, period_v=1.0)
    de = d_edge + 0.0022 * chip
    t = np.clip(de / 0.0045, 0, 1)
    face = 0.0075 + r_h[bid] + r_tu[bid] * np.mod(u, BRICK_LEN) + r_tv[bid] * np.mod(v, COURSE)
    face += 0.00035 * wave_noise(u, v, 22, fmin=60, fmax=220, period_v=1.0)
    brick_h = face * (2 * t - t * t)
    mortar_h = 0.0012 + 0.0004 * wave_noise(u, v, 23, fmin=80, fmax=260, period_v=1.0)
    h = np.where(de > 0, np.maximum(brick_h, mortar_h), mortar_h)
    # colour: yellow-buff Abbasid baked brick, per-brick firing variation, gypsum mortar
    buff, red, pale = srgb((196, 152, 104)), srgb((172, 110, 76)), srgb((210, 182, 136))
    k = r_col[bid][..., None]
    bc = np.where(k < 0.5, buff * (1 - k) + red * k, buff * (1.5 - k) + pale * (k - 0.5))
    mott = 1 + 0.07 * wave_noise(u, v, 24, fmin=8, fmax=60, period_v=1.0)
    bc = bc * (r_val[bid] * mott)[..., None]
    # firing variation: a few over-fired clinkers (darker, purplish-brown), a few soft pale ones
    r_kind = rng.uniform(0, 1, 64)
    clinker = (r_kind[bid] < 0.09)[..., None]
    soft = (r_kind[bid] > 0.93)[..., None]
    bc = np.where(clinker, bc * srgb((150, 104, 78)) / srgb((196, 152, 104)) * 0.85, bc)
    bc = np.where(soft, bc * 0.6 + srgb((222, 200, 160)) * 0.4, bc)
    # traces of the old gypsum wash, caught in the brick's pores
    wash = np.clip(wave_noise(u, v, 25, fmin=3, fmax=20, period_v=1.0) * 3 - 1.6, 0, 1)
    wash *= 0.5 + 0.5 * np.clip(wave_noise(u, v, 26, fmin=90, fmax=300, period_v=1.0), 0, 1)
    bc = bc * (1 - 0.35 * wash[..., None]) + srgb((226, 214, 190)) * (0.35 * wash[..., None])
    mortar = srgb((201, 190, 168))[None, None, :] * (1 + 0.04 * chip)[..., None]
    col = np.where((de > 0)[..., None], bc, mortar)
    return h, col


# ---------------------------------------------------------------- lime plaster and cedar
def plaster_maps(u, v):
    """Lime-gypsum plaster: broad trowel undulation, curved float strokes, sand grain, and a
    soft tonal mottle with a few darker damp-stains, so large walls are never flat."""
    h = 0.00045 * wave_noise(u, v, 31, fmin=3, fmax=40, period_v=1.0)
    h += 0.00012 * wave_noise(u, v, 32, fmin=60, fmax=300, period_v=1.0)
    # float strokes: shallow arcs swept across the wall, warped so they never line up
    warp = 0.06 * wave_noise(u, v, 34, fmin=1, fmax=4, period_v=1.0)
    strokes = np.sin(TAU * 9 * (np.hypot(u - 0.5 + warp, v + 0.8) + 0.3 * warp))
    h += 0.00016 * strokes * (0.5 + 0.5 * wave_noise(u, v, 35, fmin=2, fmax=6, period_v=1.0))
    grain = wave_noise(u, v, 36, fmin=180, fmax=480, period_v=1.0)
    h += 0.00009 * grain
    mott = wave_noise(u, v, 33, fmin=1, fmax=12, period_v=1.0)
    stain = np.clip(wave_noise(u, v, 37, fmin=1, fmax=5, period_v=1.0) * 2.5 - 1.4, 0, 1)
    tone = 1 + 0.045 * mott + 0.012 * grain - 0.05 * stain
    col = srgb((232, 220, 198))[None, None, :] * tone[..., None]
    col = col * (1 - 0.3 * stain[..., None]) + srgb((214, 196, 166)) * (0.3 * stain[..., None])
    return h, col


def cedar_color(u, v):
    warp = 0.012 * wave_noise(u, v, 41, fmin=2, fmax=10, period_v=1.0)
    grain = np.sin(TAU * (v + warp) * 70) * 0.5 + 0.5
    fine = wave_noise(u, v, 42, fmin=80, fmax=300, period_v=1.0)
    k = (grain ** 3 * 0.6 + 0.2 * (fine * 0.5 + 0.5))[..., None]
    light, dark = srgb((150, 88, 54)), srgb((104, 56, 34))
    return light * (1 - k) + dark * k


# ---------------------------------------------------------------- pointed arch + grille
def arch_inside(x, z, cx, half, sill, spring, d_ratio=0.3):
    """Two-centred pointed arch opening (x horizontal, z up)."""
    d = d_ratio * half
    r = half + d
    dx = np.abs(x - cx)
    in_rect = (z >= sill) & (dx <= half) & (z <= spring)
    in_arch = (z > spring) & (np.hypot(dx + d, z - spring) <= r)
    return in_rect | in_arch


def arch_outline(cx, half, sill, spring, d_ratio=0.3, n_arc=28):
    """Closed counter-clockwise outline (list of (x, z)), starting bottom-left."""
    d = d_ratio * half
    r = half + d
    apex_ang = np.degrees(np.arccos(d / r))
    pts = [(cx - half, sill), (cx + half, sill)]
    for a in np.linspace(0, apex_ang, n_arc):                  # right flank, centre on the left
        pts.append((cx - d + r * np.cos(np.radians(a)), spring + r * np.sin(np.radians(a))))
    for a in np.linspace(180 - apex_ang, 180, n_arc)[1:]:      # left flank, centre on the right
        pts.append((cx + d + r * np.cos(np.radians(a)), spring + r * np.sin(np.radians(a))))
    return pts


GRILLE_CELL = 0.16      # lattice spacing (m)
GRILLE_BAR = 0.026      # stucco bar width (m)
GRILLE_FRAME = 0.040    # solid rim inside the opening (m)


def grille_open(x, z, cx, half, sill, spring):
    """>0 where the grille is pierced. Interlaced-circle lattice (Umayyad/Abbasid window grilles)."""
    s = GRILLE_CELL
    R = s / np.sqrt(2)          # each circle passes through the four neighbouring cell centres
    lx = x - cx
    lz = z - sill
    gx = lx / s
    gz = lz / s - 0.5
    bx, bz = np.round(gx), np.round(gz)
    d_c = np.full(np.shape(x), np.inf)
    for ox in (-1, 0, 1):        # a circle reaches past its own lattice cell: test neighbours
        for oz in (-1, 0, 1):
            d_c = np.minimum(d_c, np.abs(np.hypot(gx - bx - ox, gz - bz - oz) * s - R))
    stroke = d_c - GRILLE_BAR / 2
    # rim: shrink the arch by GRILLE_FRAME
    d_ratio = 0.3
    d = d_ratio * half
    r = half + d
    ins = np.minimum.reduce([lz, half - np.abs(lx)])
    in_top = r - np.hypot(np.abs(lx) + d, z - spring)
    rim = np.where(z > spring, np.minimum(in_top, lz), ins) - GRILLE_FRAME
    return np.minimum(stroke, rim)


def marching_squares(f, xs, zs):
    """Closed iso-contours (f=0) of a sampled field, as lists of (x, z). f[iz, ix]."""
    nz, nx = f.shape
    f = np.where(f == 0, 1e-9, f)
    pos = f > 0
    segs = {}

    def ept(kind, i, j):
        if kind == 'h':   # edge between (i,j)-(i,j+1) along x
            t = f[i, j] / (f[i, j] - f[i, j + 1])
            return ('h', i, j), (xs[j] + t * (xs[j + 1] - xs[j]), zs[i])
        t = f[i, j] / (f[i, j] - f[i + 1, j])
        return ('v', i, j), (xs[j], zs[i] + t * (zs[i + 1] - zs[i]))

    pts = {}
    links = {}
    idx = (pos[:-1, :-1].astype(int) | (pos[:-1, 1:].astype(int) << 1)
           | (pos[1:, 1:].astype(int) << 2) | (pos[1:, :-1].astype(int) << 3))
    for i, j in zip(*np.nonzero((idx != 0) & (idx != 15))):
        c = idx[i, j]
        e = {'b': ('h', i, j), 'r': ('v', i, j + 1), 't': ('h', i + 1, j), 'l': ('v', i, j)}
        table = {1: [('l', 'b')], 2: [('b', 'r')], 3: [('l', 'r')], 4: [('r', 't')],
                 6: [('b', 't')], 7: [('l', 't')], 8: [('t', 'l')], 9: [('t', 'b')],
                 11: [('t', 'r')], 12: [('r', 'l')], 13: [('r', 'b')], 14: [('b', 'l')]}
        if c in (5, 10):
            centre = (f[i, j] + f[i, j + 1] + f[i + 1, j + 1] + f[i + 1, j]) / 4
            # isolate the corners whose sign differs from the cell centre
            if (c == 5) != (centre > 0):
                pairs = [('l', 'b'), ('r', 't')]
            else:
                pairs = [('r', 'b'), ('l', 't')]
        else:
            pairs = table[c]
        for a, b in pairs:
            ka, kb = e[a], e[b]
            for k in (ka, kb):
                if k not in pts:
                    pts[k] = ept(k[0], k[1], k[2])[1]
            links.setdefault(ka, []).append(kb)
            links.setdefault(kb, []).append(ka)
    loops, seen = [], set()
    for start in links:
        if start in seen:
            continue
        loop, prev, cur = [start], None, start
        seen.add(start)
        while True:
            nxt = [n for n in links[cur] if n != prev and n not in seen]
            if not nxt:
                break
            prev, cur = cur, nxt[0]
            seen.add(cur)
            loop.append(cur)
        if len(loop) > 3:
            loops.append([pts[k] for k in loop])
    return loops


def simplify_loop(pts, tol):
    """Douglas-Peucker on a closed loop."""
    p = np.asarray(pts)
    if len(p) < 8:
        return p

    def dp(a):
        if len(a) < 3:
            return a
        s, e = a[0], a[-1]
        se = e - s
        L = np.hypot(*se) + 1e-12
        dist = np.abs(se[0] * (a[:, 1] - s[1]) - se[1] * (a[:, 0] - s[0])) / L
        k = int(np.argmax(dist))
        if dist[k] > tol:
            return np.vstack([dp(a[:k + 1])[:-1], dp(a[k:])])
        return np.vstack([s, e])

    half = len(p) // 2
    a = dp(np.vstack([p[:half + 1]]))
    b = dp(np.vstack([p[half:], p[:1]]))
    return np.vstack([a[:-1], b[:-1]])
