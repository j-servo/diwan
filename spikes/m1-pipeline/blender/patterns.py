# THROWAWAY SPIKE CODE (M1 pipeline spike, 2026-10-12). Not production.
# Procedural Abbasid ornament as numpy fields: Samarra bevelled stucco, baked brick,
# lime plaster, cedar grain and the pierced-stucco window grille. Pure numpy, so the
# same code runs inside Blender's Python and anywhere else.
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
    d, eyes = stucco_fields(u, v)
    g, bevel = 0.0010, 0.016
    t = np.clip((d - g) / bevel, 0, 1)
    h = 0.0105 * (2 * t - t * t)                       # slanted cut rounding into the top
    h += 0.0055 * np.clip((d - g) / 0.045, 0, 1) ** 0.8  # soft pillowing: no flat ground
    pit = np.clip(1 - eyes / 0.0062, 0, 1)
    h -= 0.011 * np.sqrt(pit)                            # drilled eyes
    h += 0.00018 * wave_noise(u, v, 11, fmin=30, fmax=160)
    return h, d


def stucco_color(u, v, d):
    base = srgb((226, 211, 184))
    n = wave_noise(u, v, 5, fmin=2, fmax=25)
    tint = 1 + 0.035 * n
    dirt = 0.80 + 0.20 * np.clip(d / 0.005, 0, 1)        # grime settles in the grooves
    return base[None, None, :] * (tint * dirt)[..., None]


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
    mortar = srgb((201, 190, 168))[None, None, :] * (1 + 0.04 * chip)[..., None]
    col = np.where((de > 0)[..., None], bc, mortar)
    return h, col


# ---------------------------------------------------------------- lime plaster and cedar
def plaster_maps(u, v):
    h = 0.00045 * wave_noise(u, v, 31, fmin=3, fmax=40, period_v=1.0)
    h += 0.00012 * wave_noise(u, v, 32, fmin=60, fmax=300, period_v=1.0)
    mott = wave_noise(u, v, 33, fmin=1, fmax=12, period_v=1.0)
    col = srgb((232, 220, 198))[None, None, :] * (1 + 0.035 * mott)[..., None]
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
