# House of Wisdom: numpy-only texture maps for the hall (no Blender needed). Each map tiles,
# row 0 = top, and is written as PNG into the trim folder next to the shared trim sheets.
#   star floor   courtyard paving: 8-point stars and crosses, limestone and terracotta
#   brick floor  square baked-brick paving for the alcoves and the terrace
#   rug          one geometric pile rug, stretched onto every carpet
#   marble       pale veined stone for the armillary plinth's mouldings, pier bases and imposts
#   palette      flat colour swatches for small props (codices, scrolls, cushions, palms ...)
import os

import numpy as np

import patterns as P

STAR_PERIOD = 1.5     # m between star centres: one star centred on every 1.5 m tile
STAR_MAP_M = 1.5
BRICKFLOOR_M = 1.5    # map covers one tile: 4 x 4 square bricks of 0.375 m
RUG_W, RUG_H = 512, 768


def _grid(w, h, width_m, height_m):
    u = (np.arange(w) + 0.5) / w * width_m
    v = (h - 1 - np.arange(h) + 0.5) / h * height_m  # row 0 = top
    return np.meshgrid(u, v)


def _cell_rand(ix, iy, seed, n=1):
    """Deterministic per-cell random numbers in [0, 1)."""
    h = (ix.astype(np.int64) * 73856093) ^ (iy.astype(np.int64) * 19349663) ^ (seed * 83492791)
    out = []
    for k in range(n):
        x = np.sin((h % 100003) * (12.9898 + 7.1 * k) + seed) * 43758.5453
        out.append(x - np.floor(x))
    return out if n > 1 else out[0]


# ---------------------------------------------------------------- star-and-cross courtyard paving
def star_floor(size=1024):
    p = STAR_PERIOD
    U, V = _grid(size, size, STAR_MAP_M, STAR_MAP_M)
    ix, iy = np.round((U - p / 2) / p), np.round((V - p / 2) / p)
    lx, ly = U - (ix + 0.5) * p, V - (iy + 0.5) * p   # local to the nearest star (tile centre)
    b = 0.5 * p                                       # rotated square: tips meet the neighbours
    a = b / np.sqrt(2)                                # equal axis square: a regular 8-point star
    d_sq = np.maximum(np.abs(lx), np.abs(ly)) - a     # axis-aligned square
    d_rot = (np.abs(lx) + np.abs(ly)) / np.sqrt(2) - b / np.sqrt(2)
    d_star = np.minimum(d_sq, d_rot)                  # < 0 inside the 8-point star
    in_star = d_star < 0
    k = 0.36                                          # inlaid inner star
    d_in = np.minimum(np.maximum(np.abs(lx), np.abs(ly)) - a * k,
                      (np.abs(lx) + np.abs(ly)) / np.sqrt(2) - b * k / np.sqrt(2))
    in_inner = d_in < 0
    grout = 0.006
    edge = np.minimum(np.abs(d_star), np.abs(d_in))   # distance to the nearest joint (approx.)
    # crosses fill the rest; their centres sit at the half-period offsets
    cx, cy = np.floor(U / p + 0.5), np.floor(V / p + 0.5)
    r_star = _cell_rand(ix, iy, 3, 2)
    r_cross = _cell_rand(cx, cy, 7, 2)
    lime, terra = P.srgb((226, 213, 186)), P.srgb((204, 182, 148))   # tone-on-tone stone
    tint_s = (0.94 + 0.08 * r_star[0])[..., None]
    tint_c = (0.90 + 0.12 * r_cross[0])[..., None]
    mott = P.wave_noise(U / STAR_MAP_M, V / STAR_MAP_M, 51, fmin=3, fmax=40, period_v=1.0)
    slate = P.srgb((178, 150, 112))                                    # ochre inlay
    col = np.where(in_star[..., None], lime * tint_s, terra * tint_c)
    col = np.where(in_inner[..., None], slate * tint_s, col)
    col = col * (1 + 0.05 * mott)[..., None]
    t = np.clip((edge - grout / 2) / 0.008, 0, 1)
    gypsum = P.srgb((186, 174, 150))
    col = col * t[..., None] + gypsum * (1 - t[..., None])
    wear = P.wave_noise(U / STAR_MAP_M, V / STAR_MAP_M, 52, fmin=20, fmax=120, period_v=1.0)
    h = 0.0018 * (2 * t - t * t) + 0.00025 * wear + np.where(in_star, 0.0002, 0.0)
    nrm = P.height_to_normal(h, STAR_MAP_M / size, STAR_MAP_M / size, wrap_u=True, wrap_v=True)
    return col, nrm


# ---------------------------------------------------------------- square-brick paving
def brick_floor(size=512):
    s = BRICKFLOOR_M / 4
    U, V = _grid(size, size, BRICKFLOOR_M, BRICKFLOOR_M)
    ix, iy = np.floor(U / s), np.floor(V / s)
    lx, ly = U - ix * s, V - iy * s
    j = 0.007
    d = np.minimum.reduce([lx - j, s - j - lx, ly - j, s - j - ly])
    r = _cell_rand(ix, iy, 11, 2)
    buff, red = P.srgb((198, 160, 116)), P.srgb((176, 120, 84))
    k = r[0][..., None]
    col = buff * (1 - k) + red * k
    col *= (0.9 + 0.12 * r[1])[..., None]
    mott = P.wave_noise(U / BRICKFLOOR_M, V / BRICKFLOOR_M, 61, fmin=4, fmax=60, period_v=1.0)
    col *= (1 + 0.06 * mott)[..., None]
    t = np.clip(d / 0.005, 0, 1)
    mortar = P.srgb((190, 178, 154))
    col = np.where((d > 0)[..., None], col * (0.86 + 0.14 * t[..., None]), mortar)
    h = np.where(d > 0, 0.002 * (2 * t - t * t), 0.0)
    h += 0.0003 * P.wave_noise(U / BRICKFLOOR_M, V / BRICKFLOOR_M, 62, fmin=30, fmax=160,
                               period_v=1.0)
    nrm = P.height_to_normal(h, BRICKFLOOR_M / size, BRICKFLOOR_M / size, wrap_u=True, wrap_v=True)
    return col, nrm


# ---------------------------------------------------------------- pile rug (geometric, muted)
def rug(w=RUG_W, h=RUG_H):
    x = (np.arange(w) + 0.5) / w
    y = (np.arange(h) + 0.5) / h
    X, Y = np.meshgrid(x, y)
    aspect = h / w
    madder, indigo = P.srgb((126, 52, 42)), P.srgb((48, 54, 80))
    ivory, ochre, brown = P.srgb((206, 190, 156)), P.srgb((170, 128, 66)), P.srgb((70, 44, 32))
    col = np.empty((h, w, 3))
    col[:] = madder
    # borders (in rug-width units, so they keep their width on the long side)
    bx = np.minimum(X, 1 - X)
    by = np.minimum(Y, 1 - Y) * aspect
    db = np.minimum(bx, by)
    col[db < 0.16] = indigo
    col[(db >= 0.035) & (db < 0.045)] = ivory
    col[(db >= 0.150) & (db < 0.160)] = ivory
    # running motif in the border: small stepped diamonds along the band centre
    along = np.where(bx < by, Y * aspect, X)
    m = np.abs(np.mod(along, 0.11) - 0.055) + np.abs(db - 0.0975)
    col[(db >= 0.045) & (db < 0.150) & (m < 0.04)] = ochre
    col[(db >= 0.045) & (db < 0.150) & (m < 0.018)] = ivory
    # field: lattice of octagons with a small cross, offset rows
    fx, fy = (X - 0.5) / 0.16, (Y - 0.5) * aspect / 0.16
    gx, gy = fx - 0.5 - np.round(fx - 0.5), fy - np.round(fy)
    octa = np.maximum(np.maximum(np.abs(gx), np.abs(gy)), (np.abs(gx) + np.abs(gy)) / 1.35)
    field = db >= 0.175
    col[field & (octa < 0.36) & (octa >= 0.30)] = ivory
    col[field & (octa < 0.30)] = indigo
    crossm = (np.minimum(np.abs(gx), np.abs(gy)) < 0.045) & (octa < 0.22)
    col[field & crossm] = ochre
    dot = (np.abs(np.abs(gx) - 0.5) < 0.06) & (np.abs(np.abs(gy) - 0.5) < 0.06)
    col[field & dot] = brown
    # pile: abrash (dye-lot banding) and fine knot noise
    abrash = 1 + 0.06 * np.sin(Y * 23.0 + 1.3) * np.sin(Y * 7.0)
    knots = P.wave_noise(X, Y * aspect, 71, fmin=80, fmax=260)
    col = col * (abrash * (1 + 0.05 * knots))[..., None]
    return col


# ---------------------------------------------------------------- veined marble
def marble(size=512):
    U, V = _grid(size, size, 1.0, 1.0)
    n1 = P.wave_noise(U, V, 81, fmin=1, fmax=6, period_v=1.0)
    n2 = P.wave_noise(U, V, 82, fmin=6, fmax=30, period_v=1.0)
    vein = np.abs(np.sin(np.pi * (3 * U + 2 * V + 1.6 * n1 + 0.3 * n2)))
    veins = np.clip(1 - vein / 0.05, 0, 1) ** 2
    base = P.srgb((232, 224, 210)) * (1 + 0.03 * n2)[..., None]
    return base * (1 - 0.22 * veins)[..., None] + P.srgb((150, 140, 128)) * (0.22 * veins)[..., None]


# ---------------------------------------------------------------- palette atlas
PALETTE_GRID = 16
PALETTE_PX = 32
SWATCHES = {
    # codex leathers and cloth bindings (muted, so robe trims stay the saturated note)
    'leather_brown': (112, 70, 44), 'leather_dark': (72, 44, 30), 'leather_red': (128, 52, 40),
    'leather_tan': (160, 116, 72), 'leather_olive': (104, 98, 60), 'leather_black': (42, 34, 30),
    'leather_ochre': (170, 128, 62), 'cloth_plum': (84, 52, 78),
    'paper': (226, 212, 180), 'paper_old': (208, 188, 146), 'page_edge': (230, 220, 196),
    'scroll_wood': (96, 60, 38), 'scroll_cap': (150, 104, 60), 'cord_red': (150, 48, 40),
    'cushion_madder': (124, 66, 54), 'cushion_indigo': (70, 74, 96), 'cushion_ochre': (162, 130, 82),
    'cushion_olive': (110, 106, 78), 'cushion_ivory': (206, 190, 156), 'cushion_brown': (110, 72, 50),
    'clay': (186, 140, 100), 'ceramic_cream': (222, 206, 172), 'ceramic_ochre': (196, 150, 84),
    'brass': (176, 132, 70), 'iron': (58, 54, 52), 'ink': (24, 20, 20), 'reed': (176, 150, 96),
    'palm_trunk': (122, 94, 66), 'palm_trunk_dark': (92, 70, 50), 'frond': (92, 118, 60),
    'frond_dark': (66, 92, 48), 'frond_dry': (150, 132, 78), 'dates': (166, 84, 38),
    'soil': (92, 66, 46), 'kufic_ground': (116, 56, 44), 'section': (124, 104, 86),
    'wax': (232, 216, 180), 'flame': (255, 210, 140),
    # the themed north chambers (hall_chambers.py): glass, stone, herbs, globe; none near cobalt
    'cord': (152, 128, 92), 'stone': (150, 142, 128), 'glass_green': (112, 142, 92),
    'glass_clear': (206, 212, 196), 'glass_amber': (178, 112, 44), 'globe_ink': (40, 58, 50),
    'terracotta': (172, 100, 66), 'herb_green': (104, 124, 68), 'herb_dry': (156, 142, 92),
    'lavender': (140, 116, 142), 'albarello_green': (104, 132, 88), 'specimen': (176, 170, 112),
    'cork': (150, 116, 80), 'flower_white': (234, 230, 214), 'madder_flower': (176, 70, 70),
}
CHAMBER_SWATCHES = ('cord', 'stone', 'glass_green', 'glass_clear', 'glass_amber', 'globe_ink',
                    'terracotta', 'herb_green', 'herb_dry', 'lavender', 'albarello_green',
                    'specimen', 'cork', 'flower_white', 'madder_flower')


def palette():
    n, s = PALETTE_GRID, PALETTE_PX
    img = np.zeros((n * s, n * s, 3))
    img[:] = P.srgb((128, 128, 128))
    U, V = _grid(n * s, n * s, 1.0, 1.0)
    grain = P.wave_noise(U, V, 91, fmin=40, fmax=200, period_v=1.0)
    uv = {}
    for i, (name, rgb) in enumerate(SWATCHES.items()):
        r, c = divmod(i, n)
        img[r * s:(r + 1) * s, c * s:(c + 1) * s] = P.srgb(rgb)
        uv[name] = ((c + 0.5) / n, 1 - (r + 0.5) / n)   # Blender UV of the swatch centre
    img *= (1 + 0.03 * grain)[..., None]
    return img, uv


def palette_uv():
    n = PALETTE_GRID
    return {name: ((i % n + 0.5) / n, 1 - (i // n + 0.5) / n) for i, name in enumerate(SWATCHES)}


def hall_cedar(size=512):
    U, V = _grid(size, size, 1.0, 1.0)
    c = P.cedar_color(U, V)
    grey = c.mean(-1, keepdims=True)
    return (grey + 0.6 * (c - grey)) * 0.92


def write_all(tex_dir):
    os.makedirs(tex_dir, exist_ok=True)
    c, n = star_floor()
    P.write_png(os.path.join(tex_dir, 'starfloor_basecolor.png'), P.to_u8(c))
    P.write_png(os.path.join(tex_dir, 'starfloor_normal.png'), P.to_u8(n))
    c, n = brick_floor()
    P.write_png(os.path.join(tex_dir, 'brickfloor_basecolor.png'), P.to_u8(c))
    P.write_png(os.path.join(tex_dir, 'brickfloor_normal.png'), P.to_u8(n))
    P.write_png(os.path.join(tex_dir, 'rug_basecolor.png'), P.to_u8(rug()))
    P.write_png(os.path.join(tex_dir, 'marble_basecolor.png'), P.to_u8(marble()))
    P.write_png(os.path.join(tex_dir, 'hallcedar_basecolor.png'), P.to_u8(hall_cedar()))
    img, _ = palette()
    P.write_png(os.path.join(tex_dir, 'palette_basecolor.png'), P.to_u8(img))


if __name__ == '__main__':
    import sys
    write_all(sys.argv[1] if len(sys.argv) > 1 else 'tex')
