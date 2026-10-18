# House of Wisdom: the wall art of the three themed north chambers (Yousef, 2026-10-15), drawn in
# numpy into one 2048^2 atlas. No Blender needed: `python3 chamber_art.py <dir>` writes a preview.
# Each sheet is a line drawing on parchment after a source the House of Wisdom knew:
#   chem_alembic   an alembic (al-anbiq) on a brick furnace, its spout running to a receiver: the
#                  distilling train of Jabir ibn Hayyan's corpus and al-Razi's Kitab al-Asrar
#   chem_retort    a retort on a brazier, its neck in a receiver
#   chem_cucurbit  a cucurbit in a water bath, its spout cooled through a trough (the condenser)
#   chem_vessels   vessel studies: cucurbits, flasks, phials, an aludel, beakers
#   map_world      the inhabited world (oikoumene) in the al-Khwarizmi tradition (Surat al-Ard,
#                  al-Ma'mun's world map): a graticule, the seven climates (iqlim) as horizontal
#                  zones, the Nile from the Mountains of the Moon; coastlines simplified from the
#                  coded outlines in armillary_textures (no map data)
#   map_disc       a round, south-up world in the Balkhi school (al-Istakhri, Ibn Hawqal): the
#                  encircling ocean, the Mediterranean and the Indian Ocean entering as two gulfs
#   map_city       al-Mansur's round city of Baghdad: double walls, four gates, the Tigris
#   bio_eye        the eye after Hunayn ibn Ishaq's Ten Treatises on the Eye: concentric tunics,
#                  the crystalline lens at the centre, the hollow optic nerve
#   bio_mandrake,  plates after Dioscorides' De materia medica (the herbal translated in Baghdad):
#   bio_poppy      roots, leaves and flowers
#   bio_animals    a bird and a giraffe after al-Jahiz's Kitab al-Hayawan
# No text and no letterforms anywhere: writing is drawn as ruled bars (no curves, no dots), so
# nothing on a sheet can read as pseudo-script. Seas are sea-green ink, never blue: cobalt
# #2f5bea means "needs you", and the atlas passes a 40-degree cobalt guard.
import math
import os

import numpy as np

import armillary_textures as AT
import patterns as P

ATLAS = 2048
PPM = 400                     # atlas px per metre of sheet on the wall
GUTTER = 8
COBALT_GUARD = 40.0           # stricter than the hall's 25: new art keeps 40 deg clear of cobalt

# name -> (width, height) in metres on the wall
SIZES = {
    'map_world': (2.5, 1.3), 'chem_alembic': (2.3, 1.25),
    'bio_eye': (1.8, 1.3), 'map_disc': (0.95, 1.0), 'chem_vessels': (0.95, 1.0),
    'chem_retort': (0.8, 1.0),
    'map_city': (0.62, 0.8), 'chem_cucurbit': (0.55, 0.75), 'bio_mandrake': (0.5, 0.75),
    'bio_poppy': (0.5, 0.75), 'bio_animals': (0.9, 1.0),
}
ROWS = [['map_world', 'chem_alembic'],
        ['bio_eye', 'map_disc', 'chem_vessels', 'chem_retort'],
        ['map_city', 'chem_cucurbit', 'bio_mandrake', 'bio_poppy', 'bio_animals']]


def _layout():
    rects, y = {}, GUTTER
    for row in ROWS:
        x, tallest = GUTTER, 0
        for name in row:
            w, h = (int(round(s * PPM)) for s in SIZES[name])
            rects[name] = (x, y, w, h)
            x += w + GUTTER
            tallest = max(tallest, h)
        assert x <= ATLAS, f'atlas row too wide: {row}'
        y += tallest + GUTTER
    assert y <= ATLAS
    return rects


RECTS = _layout()


def uv_rect(name, sub=(0.0, 0.0, 1.0, 1.0)):
    """Blender UV (u0, v0, u1, v1) of a sheet, or of a sub-rectangle of it given in sheet
    fractions (x0, y0, x1, y1), y down. Blender's v = 1 is the image's top row."""
    x, y, w, h = RECTS[name]
    a, b, c, d = sub
    return ((x + a * w) / ATLAS, 1 - (y + d * h) / ATLAS, (x + c * w) / ATLAS, 1 - (y + b * h) / ATLAS)


# ---------------------------------------------------------------- colours (sRGB 0..255)
PARCH = (226, 210, 174)
INK = (60, 43, 31)
RED = (150, 62, 44)
OCHRE = (204, 162, 92)
LAND = (222, 198, 146)
SEA = (122, 150, 128)           # muted sea-green (hue ~135): never blue
SEA_DEEP = (92, 120, 100)
GREEN = (116, 138, 74)
GREEN_DARK = (78, 100, 54)
ROSE = (178, 94, 82)
MADDER = (162, 66, 56)
GLASS = (204, 210, 192)
AMBER = (198, 136, 60)
BROWN = (132, 90, 54)
GOLD = (190, 148, 66)
FLAME = (214, 120, 52)


def parchment(w, h, seed):
    U, V = np.meshgrid((np.arange(w) + 0.5) / PPM, (np.arange(h) + 0.5) / PPM)
    mott = P.wave_noise(U, V, seed, n=36, fmin=1.5, fmax=9, period_u=1.0)
    fibre = P.wave_noise(U, V, seed + 1, n=48, fmin=40, fmax=140, period_u=1.0)
    edge = np.minimum.reduce([U, w / PPM - U, V, h / PPM - V])            # metres to the rim
    shade = 1 + 0.035 * mott + 0.012 * fibre - 0.10 * np.exp(-edge / 0.025)
    img = P.srgb(PARCH) * shade[..., None]
    rng = np.random.default_rng(seed + 2)
    for _ in range(int(w * h / 60000)):                                    # foxing
        cx, cy, r = rng.uniform(0, w), rng.uniform(0, h), rng.uniform(3, 9)
        d = np.hypot(U * PPM - cx, V * PPM - cy)
        img *= (1 - 0.05 * np.exp(-(d / r) ** 2))[..., None]
    return img


def bez(*pts, n=24):
    """Quadratic or cubic Bezier through control points, n+1 samples."""
    p = np.asarray(pts, float)
    t = np.linspace(0, 1, n + 1)[:, None]
    if len(p) == 3:
        return (1 - t) ** 2 * p[0] + 2 * (1 - t) * t * p[1] + t ** 2 * p[2]
    return ((1 - t) ** 3 * p[0] + 3 * (1 - t) ** 2 * t * p[1] + 3 * (1 - t) * t ** 2 * p[2]
            + t ** 3 * p[3])


def ell(cx, cy, rx, ry, a0=0.0, a1=360.0, n=72, rot=0.0):
    """Points on an ellipse (screen coords, y down; angles in degrees, 90 = down)."""
    a = np.radians(np.linspace(a0, a1, n))
    x, y = rx * np.cos(a), ry * np.sin(a)
    c, s = math.cos(math.radians(rot)), math.sin(math.radians(rot))
    return np.stack([cx + c * x - s * y, cy + s * x + c * y], -1)


def mirror(profile, cx, base):
    """Closed outline of a vessel from its half profile [(r, y up), ...] standing on base."""
    right = [(cx + r, base - y) for r, y in profile]
    left = [(cx - r, base - y) for r, y in profile[::-1]]
    return np.array(right + left, float)


class Sheet:
    def __init__(self, name, seed):
        self.name = name
        _, _, self.w, self.h = RECTS[name]
        self.img = parchment(self.w, self.h, seed)
        self.rng = np.random.default_rng(seed + 7)

    def _win(self, pts, pad):
        x0, y0 = pts.min(0) - pad
        x1, y1 = pts.max(0) + pad
        a, b = max(int(x0), 0), min(int(math.ceil(x1)) + 1, self.w)
        c, d = max(int(y0), 0), min(int(math.ceil(y1)) + 1, self.h)
        return a, b, c, d

    def _blend(self, a, b, c, d, cov, color, alpha):
        k = (cov * alpha)[..., None]
        win = self.img[c:d, a:b]
        win[:] = win * (1 - k) + P.srgb(color) * k

    def stroke(self, pts, width=3.0, color=INK, alpha=1.0, closed=False):
        pts = np.asarray(pts, float)
        if closed:
            pts = np.vstack([pts, pts[:1]])
        a, b, c, d = self._win(pts, width + 2)
        if a >= b or c >= d:
            return
        X, Y = np.meshgrid(np.arange(a, b) + 0.5, np.arange(c, d) + 0.5)
        dist = np.full(X.shape, 1e9)
        r = width / 2 + 2
        for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
            i0, i1 = max(int(min(ax, bx) - r) - a, 0), min(int(max(ax, bx) + r) + 1 - a, b - a)
            j0, j1 = max(int(min(ay, by) - r) - c, 0), min(int(max(ay, by) + r) + 1 - c, d - c)
            if i0 >= i1 or j0 >= j1:
                continue
            sub = (slice(j0, j1), slice(i0, i1))
            if (bx - ax) ** 2 + (by - ay) ** 2 < 1e-12:
                dd = np.hypot(X[sub] - ax, Y[sub] - ay)
            else:
                dd = P.d_seg(X[sub], Y[sub], ax, ay, bx, by)
            dist[sub] = np.minimum(dist[sub], dd)
        self._blend(a, b, c, d, np.clip(width / 2 - dist + 0.5, 0, 1), color, alpha)

    def fill(self, polys, color, alpha=1.0, clip=None):
        """Even-odd fill of one polygon or a list of them, optionally clipped to a rect."""
        if isinstance(polys, np.ndarray) or (polys and np.ndim(polys[0]) == 1):
            polys = [polys]
        polys = [np.asarray(p, float) for p in polys]
        a, b, c, d = self._win(np.vstack(polys), 1)
        if clip:
            a, c = max(a, int(clip[0])), max(c, int(clip[1]))
            b, d = min(b, int(clip[2])), min(d, int(clip[3]))
        if a >= b or c >= d:
            return
        X, Y = np.meshgrid(np.arange(a, b) + 0.5, np.arange(c, d) + 0.5)
        inside = np.zeros(X.shape, bool)
        for p in polys:
            q = np.roll(p, -1, 0)
            for (x1, y1), (x2, y2) in zip(p, q):
                if y1 == y2:
                    continue
                lo, hi = sorted((y1, y2))
                j0, j1 = max(int(lo) - c, 0), min(int(math.ceil(hi)) + 1 - c, d - c)
                if j0 >= j1:
                    continue
                Ys, Xs = Y[j0:j1], X[j0:j1]
                cond = (y1 > Ys) != (y2 > Ys)
                xc = (x2 - x1) * (Ys - y1) / (y2 - y1) + x1
                inside[j0:j1] ^= cond & (Xs < xc)
        self._blend(a, b, c, d, inside.astype(float), color, alpha)

    def shape(self, poly, fill=None, alpha=0.8, line=INK, width=3.0):
        if fill is not None:
            self.fill(poly, fill, alpha)
        if line is not None:
            self.stroke(poly, width, line, closed=True)

    def disc(self, cx, cy, r, color, alpha=1.0):
        self.fill(ell(cx, cy, r, r, n=max(16, int(r * 1.5))), color, alpha)

    def ring(self, cx, cy, r, width=3.0, color=INK, alpha=1.0):
        self.stroke(ell(cx, cy, r, r, n=max(24, int(r * 1.5))), width, color, alpha)

    def text(self, x0, y0, x1, y1, line=13.0, bar=3.6, color=INK, alpha=0.78, rubric=True):
        """Ruled 'writing': rows of straight bars of word-like lengths. No letterforms."""
        y = y0 + line * 0.7
        para_left = 0
        while y < y1 - line * 0.2:
            self.stroke([(x0, y + bar), (x1, y + bar)], 0.8, BROWN, 0.25)     # dry-point ruling
            x = x0 + (line * 1.4 if para_left == 0 else 0)
            end = x1 if para_left < 4 else x0 + (x1 - x0) * self.rng.uniform(0.3, 0.8)
            first = True
            while x < end - line:
                L = min(line * self.rng.uniform(0.7, 3.2), end - x)
                col = RED if (rubric and first and para_left == 0) else color
                self.stroke([(x + bar / 2, y), (x + L - bar / 2, y)], bar, col, alpha)
                x += L + line * 0.55
                first = False
            para_left = 0 if para_left >= 4 else para_left + 1
            y += line

    def frame(self, inset=10, red=True):
        w, h = self.w, self.h
        box = lambda i: [(i, i), (w - i, i), (w - i, h - i), (i, h - i)]
        if red:
            self.stroke(box(inset), 2.2, RED, 0.9, closed=True)
        self.stroke(box(inset + 6), 1.6, INK, 0.85, closed=True)

    def hatch(self, poly, spacing=7.0, angle=45.0, width=1.4, color=INK, alpha=0.6):
        """Parallel shading lines clipped to a polygon (scanline intersections)."""
        poly = np.asarray(poly, float)
        c, s = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        rot = poly @ np.array([[c, -s], [s, c]])          # into the hatch frame
        lo, hi = rot[:, 1].min(), rot[:, 1].max()
        q = np.roll(rot, -1, 0)
        for yy in np.arange(lo + spacing / 2, hi, spacing):
            xs = []
            for (x1, y1), (x2, y2) in zip(rot, q):
                if (y1 > yy) != (y2 > yy):
                    xs.append(x1 + (x2 - x1) * (yy - y1) / (y2 - y1))
            xs.sort()
            for xa, xb in zip(xs[0::2], xs[1::2]):
                seg = np.array([(xa, yy), (xb, yy)]) @ np.array([[c, s], [-s, c]])
                self.stroke(seg, width, color, alpha)


# ---------------------------------------------------------------- chemistry
CUCURBIT = [(0.0, 0.0), (0.42, 0.02), (0.62, 0.12), (0.72, 0.3), (0.7, 0.52), (0.56, 0.72),
            (0.32, 0.86), (0.24, 0.98), (0.24, 1.12)]
FLASK = [(0.0, 0.0), (0.3, 0.0), (0.5, 0.08), (0.6, 0.25), (0.56, 0.45), (0.38, 0.6), (0.14, 0.7),
         (0.12, 1.0), (0.16, 1.04)]
PHIAL = [(0.0, 0.0), (0.22, 0.0), (0.26, 0.1), (0.26, 0.62), (0.16, 0.74), (0.1, 0.8), (0.1, 1.0),
         (0.14, 1.03)]
BEAKER = [(0.0, 0.0), (0.4, 0.0), (0.44, 0.05), (0.46, 0.7), (0.52, 0.76)]
ALUDEL = [(0.0, 0.0), (0.3, 0.0), (0.36, 0.2), (0.3, 0.32), (0.36, 0.5), (0.3, 0.62), (0.36, 0.8),
          (0.26, 0.92), (0.16, 1.0)]


def scaled(profile, s):
    return [(r * s, y * s) for r, y in profile]


def glass_vessel(sh, cx, base, profile, s, liquid=0.35, tint=AMBER, width=3.0):
    """A glass vessel drawn as the manuscripts do: outline, pale glass wash, liquid, highlight."""
    out = mirror(scaled(profile, s), cx, base)
    sh.fill(out, GLASS, 0.55)
    if liquid > 0:
        lvl = base - liquid * s
        sh.fill(out, tint, 0.55, clip=(0, lvl, sh.w, base + 2))
        r_at = max(r for r, y in scaled(profile, s) if y <= liquid * s + 1e-6)
        sh.stroke([(cx - r_at * 0.92, lvl), (cx + r_at * 0.92, lvl)], 1.6, INK, 0.7)
    sh.stroke(out, width, INK, closed=True)
    hi = [(cx - r * 0.55, base - y) for r, y in scaled(profile, s)[2:-3]]
    if len(hi) > 1:
        sh.stroke(hi, max(1.5, width * 0.6), (244, 238, 222), 0.75)
    return out


def flames(sh, cx, base, width, height, n=5):
    for k in range(n):
        x = cx - width / 2 + width * (k + 0.5) / n
        hgt = height * (0.6 + 0.4 * math.sin(k * 2.1) ** 2)
        tip = (x + width * 0.05 * (-1) ** k, base - hgt)
        poly = np.vstack([bez((x - width / (2.4 * n), base), (x - width / (3 * n), base - hgt * 0.5),
                              tip, n=10),
                          bez(tip, (x + width / (3 * n), base - hgt * 0.5),
                              (x + width / (2.4 * n), base), n=10)])
        sh.shape(poly, FLAME, 0.75, RED, 1.8)


def brick_body(sh, poly, course=16.0, unit=34.0):
    sh.fill(poly, (196, 140, 98), 0.55)
    p = np.asarray(poly)
    x0, y0 = p.min(0)
    x1, y1 = p.max(0)
    clip = (x0 + 2, y0 + 2, x1 - 2, y1 - 2)
    for i, y in enumerate(np.arange(y0 + course, y1, course)):
        sh.stroke([(x0, y), (x1, y)], 1.4, INK, 0.55)
        off = (i % 2) * unit / 2
        for x in np.arange(x0 + off, x1, unit):
            seg = np.array([(x, y - course), (x, y)])
            seg[:, 1] = np.clip(seg[:, 1], clip[1], clip[3])
            sh.stroke(seg, 1.2, INK, 0.45)
    sh.stroke(poly, 3.4, INK, closed=True)


def alembic_head(sh, cx, top, s, spout_to):
    """The alembic (al-anbiq): a domed head over the cucurbit's mouth, its beak running down to
    spout_to."""
    dome = np.vstack([ell(cx, top, 0.5 * s, 0.46 * s, 180, 360, 28), [(cx + 0.5 * s, top + 0.08 * s),
                                                                       (cx - 0.5 * s, top + 0.08 * s)]])
    sh.shape(dome, GLASS, 0.6, INK, 3.0)
    sh.stroke([(cx - 0.47 * s, top - 0.02 * s), (cx + 0.47 * s, top - 0.02 * s)], 1.6, INK, 0.7)
    sh.disc(cx, top - 0.5 * s, 0.07 * s, GLASS, 0.8)
    sh.ring(cx, top - 0.5 * s, 0.07 * s, 2.0)
    bx, by = cx + 0.42 * s, top - 0.2 * s
    tx, ty = spout_to
    n = np.array([-(ty - by), tx - bx])
    n /= np.linalg.norm(n)
    w0, w1 = 0.09 * s, 0.035 * s
    beak = np.array([(bx, by) + n * w0, (tx, ty) + n * w1, (tx, ty) - n * w1, (bx, by) - n * w0])
    sh.shape(beak, GLASS, 0.6, INK, 2.6)
    for k in range(3):                                         # drops of distillate
        sh.disc(tx + 2, ty + 10 + k * 13, 2.6 - 0.5 * k, AMBER, 0.95)


def chem_alembic():
    sh = Sheet('chem_alembic', 301)
    W, H = sh.w, sh.h
    sh.frame()
    # the furnace: a tapering brick athanor with an arched fire mouth
    fx, base = W * 0.36, H - 70
    body = [(fx - 150, base), (fx + 150, base), (fx + 128, base - 190), (fx - 128, base - 190)]
    brick_body(sh, body)
    mouth = np.vstack([[(fx - 52, base)], ell(fx, base - 64, 52, 52, 180, 360, 24), [(fx + 52, base)]])
    sh.shape(mouth, (70, 40, 28), 0.85, INK, 3.0)
    flames(sh, fx, base - 4, 92, 70)
    sh.stroke([(fx - 160, base + 2), (fx + 160, base + 2)], 4.0, INK)
    sh.fill([(fx - 140, base - 190), (fx + 140, base - 190), (fx + 140, base - 204),
             (fx - 140, base - 204)], (150, 120, 96), 0.7)
    sh.stroke([(fx - 140, base - 204), (fx + 140, base - 204)], 3.0, INK)
    # the cucurbit seated in the furnace mouth, the alembic on it, the beak to the receiver
    s = 124
    glass_vessel(sh, fx, base - 168, CUCURBIT, s, liquid=0.4, tint=GREEN)
    top = base - 168 - 1.12 * s
    rx, rbase = fx + 290, base - 50
    alembic_head(sh, fx, top, s * 1.05, (rx - 28, rbase - 0.92 * 120))
    stool = [(rx - 70, rbase), (rx + 70, rbase), (rx + 60, rbase + 14), (rx - 60, rbase + 14)]
    sh.shape(stool, (176, 132, 86), 0.7, INK, 2.6)
    for dx in (-52, 52):
        sh.stroke([(rx + dx, rbase + 14), (rx + dx * 1.15, base + 2)], 3.0, INK)
    glass_vessel(sh, rx, rbase, FLASK, 120, liquid=0.3, tint=AMBER)
    # the text columns to the right, a rubricated heading bar on top
    tx0 = W * 0.73
    sh.stroke([(tx0 + 10, 52), (W - 46, 52)], 7.0, RED, 0.85)
    sh.text(tx0, 74, W - 40, H - 40, line=15, bar=4.0)
    return sh


def chem_retort():
    sh = Sheet('chem_retort', 302)
    W, H = sh.w, sh.h
    sh.frame(8)
    cx, cy, r = W * 0.3, H * 0.42, 58
    # brazier on three legs, coals and flames
    bowl = np.vstack([ell(cx, cy + r + 18, 70, 26, 0, 180, 24)])
    sh.shape(bowl, (90, 70, 56), 0.8, INK, 2.6)
    for dx in (-50, 0, 50):
        sh.stroke([(cx + dx * 0.8, cy + r + 38), (cx + dx, cy + r + 96)], 3.0, INK)
    flames(sh, cx, cy + r + 22, 90, 34, n=4)
    # the retort: a round body, its neck bent down to a receiver
    sh.disc(cx, cy, r, GLASS, 0.6)
    sh.fill(ell(cx, cy, r, r), AMBER, 0.5, clip=(0, cy + r * 0.3, W, H))
    sh.ring(cx, cy, r, 3.0)
    neck_top = bez((cx + 20, cy - r + 6), (cx + 70, cy - r - 46), (cx + 160, cy - 26), n=20)
    neck_bot = bez((cx + 46, cy - r + 22), (cx + 80, cy - r - 18), (cx + 152, cy - 8), n=20)
    sh.shape(np.vstack([neck_top, neck_bot[::-1]]), GLASS, 0.6, INK, 2.6)
    glass_vessel(sh, cx + 168, cy + 74, FLASK, 80, liquid=0.25, tint=AMBER, width=2.6)
    sh.text(26, H * 0.72, W - 26, H - 26, line=13, bar=3.6)
    return sh


def chem_cucurbit():
    sh = Sheet('chem_cucurbit', 303)
    W, H = sh.w, sh.h
    sh.frame(8)
    cx = W * 0.38
    # the water bath (a basin), the cucurbit standing in it
    basin = [(cx - 62, 168), (cx + 62, 168), (cx + 50, 220), (cx - 50, 220)]
    sh.shape(basin, (176, 132, 86), 0.7, INK, 2.6)
    sh.fill([(cx - 58, 178), (cx + 58, 178), (cx + 50, 214), (cx - 50, 214)], SEA, 0.55)
    glass_vessel(sh, cx, 205, CUCURBIT, 66, liquid=0.35, tint=GREEN, width=2.4)
    top = 205 - 1.12 * 66
    tip = (W - 36, 196)
    alembic_head(sh, cx, top, 66, tip)
    # the cooling trough the spout runs through
    trough = [(cx + 40, 114), (W - 50, 150), (W - 52, 166), (cx + 38, 130)]
    sh.shape(trough, SEA, 0.5, INK, 2.2)
    sh.text(22, 238, W - 22, H - 20, line=12, bar=3.2)
    return sh


def chem_vessels():
    sh = Sheet('chem_vessels', 304)
    W, H = sh.w, sh.h
    sh.frame(8)
    cells = [(CUCURBIT, 0.4, GREEN), (FLASK, 0.3, AMBER), (PHIAL, 0.5, GREEN),
             (ALUDEL, 0.0, AMBER), (BEAKER, 0.45, AMBER), (FLASK, 0.0, GREEN),
             (PHIAL, 0.3, AMBER), (CUCURBIT, 0.2, AMBER), (BEAKER, 0.25, GREEN)]
    cw, ch = (W - 40) / 3, (H - 120) / 3
    for i, (prof, liq, tint) in enumerate(cells):
        c, r = i % 3, i // 3
        cx = 20 + cw * (c + 0.5)
        base = 32 + ch * (r + 1) - 12
        hmax = max(y for _, y in prof)
        rmax = max(r_ for r_, _ in prof)
        s = min((ch - 34) / hmax, (cw - 30) / (2 * rmax))
        glass_vessel(sh, cx, base, prof, s, liquid=liq, tint=tint, width=2.4)
        sh.stroke([(cx - cw * 0.3, base + 6), (cx + cw * 0.3, base + 6)], 3.0, BROWN, 0.6)
    sh.text(20, H - 84, W - 20, H - 18, line=12, bar=3.2)
    return sh


# ---------------------------------------------------------------- cartography
# al-Khwarizmi's seven climates, after Ptolemy: the zone limits in degrees north
CLIMES = [12.7, 20.5, 27.5, 33.6, 38.9, 43.3, 47.2, 50.4]
NILE = [(31.0, 31.3), (31.2, 30.0), (31.2, 27.0), (32.9, 24.0), (32.6, 22.0), (31.0, 20.5),
        (32.5, 17.5), (32.5, 15.5), (32.0, 10.0), (31.0, 6.0), (31.5, 2.0), (30.5, -1.0),
        (29.8, -5.0)]
RIVERS = [
    [(47.8, 30.4), (46.0, 31.5), (44.4, 33.3), (43.6, 35.0), (42.6, 36.8), (41.4, 37.8)],   # Tigris
    [(47.6, 30.5), (45.2, 31.6), (43.2, 32.8), (41.0, 34.4), (39.8, 35.8), (38.6, 37.6),
     (39.0, 39.0)],                                                                          # Euphrates
    [(67.5, 24.2), (68.5, 27.0), (70.5, 29.5), (71.5, 32.5), (73.0, 35.0)],                # Indus
    [(88.4, 22.2), (86.0, 24.5), (83.0, 25.5), (80.0, 26.8), (78.5, 29.5)],                # Ganges
    [(59.0, 43.5), (61.5, 41.0), (64.5, 38.5), (67.5, 37.2), (71.0, 37.0)],                # Oxus
]
MOUNTAINS = [
    [(26, 39.5), (31, 37.8), (36, 37.3), (40.5, 38.5), (44, 37.5), (47, 35), (50, 33),
     (54, 30.5)],                                                                            # Taurus-Zagros
    [(52, 36.3), (57, 37), (62, 36.4), (67, 35.6), (71, 36.6), (76, 35.4), (81, 32.4),
     (86, 29.4), (92, 28.4)],                                                                # Alborz-Hindu Kush-Himalaya
    [(-8, 31.2), (-3, 32.4), (2, 33.6), (7, 34.6)],                                          # Atlas
    [(26, -2.0), (29, -3.6), (32, -4.6), (35, -3.8)],                                        # Mountains of the Moon
]
CITIES = [(44.4, 33.3), (29.9, 31.2), (66.9, 39.7), (36.3, 33.5), (39.8, 21.4), (51.4, 35.7)]


def humps(sh, pts, size=11.0, color=INK):
    pts = np.asarray(pts, float)
    seg = np.hypot(*np.diff(pts, axis=0).T)
    s = np.concatenate([[0], np.cumsum(seg)])
    for d in np.arange(size * 0.5, s[-1], size * 1.25):
        i = min(np.searchsorted(s, d) - 1, len(seg) - 1)
        t = (d - s[i]) / max(seg[i], 1e-9)
        x, y = pts[i] + t * (pts[i + 1] - pts[i])
        hump = ell(x, y, size * 0.62, size * 0.75, 180, 360, 12)
        sh.fill(np.vstack([hump, [(x + size * 0.62, y)]]), (176, 136, 90), 0.7)
        sh.stroke(hump, 2.2, color, 0.9)


def map_world():
    sh = Sheet('map_world', 401)
    W, H = sh.w, sh.h
    sh.frame(10)
    m = 28                                           # map field inside the rules
    x0, y0, x1, y1 = m + 10, m + 6, W - m - 10, H - m - 6
    lon0, lon1, lat0, lat1 = -20.0, 150.0, -14.0, 66.0
    proj = lambda pts: np.stack([x0 + (np.asarray(pts)[:, 0] - lon0) / (lon1 - lon0) * (x1 - x0),
                                 y1 - (np.asarray(pts)[:, 1] - lat0) / (lat1 - lat0) * (y1 - y0)], -1)
    clip = (x0, y0, x1, y1)
    field = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    sh.fill(field, SEA, 0.8)
    land = [proj(p) for p in [AT.EURASIA] + AT.INLAND_SEAS + AT.ISLANDS]
    sh.fill(land, LAND, 0.95, clip=clip)
    # the seven climates: alternating washes and red limits, a ruled tab in the margin for each
    ys = [y1 - (l - lat0) / (lat1 - lat0) * (y1 - y0) for l in CLIMES]
    for k, (ya, yb) in enumerate(zip(ys[:-1], ys[1:])):
        if k % 2 == 0:
            sh.fill([(x0, yb), (x1, yb), (x1, ya), (x0, ya)], OCHRE, 0.22)
        sh.stroke([(x0 - 22, (ya + yb) / 2), (x0 - 8, (ya + yb) / 2)], 4.0, RED, 0.85)
    for y in ys:
        sh.stroke([(x0, y), (x1, y)], 2.4, RED, 0.85)
    # graticule every ten degrees
    for lon in range(-10, 151, 10):
        x = proj([(lon, 0)])[0, 0]
        sh.stroke([(x, y0), (x, y1)], 1.2, INK, 0.35)
    for lat in range(-10, 61, 10):
        y = proj([(0, lat)])[0, 1]
        sh.stroke([(x0, y), (x1, y)], 1.2, INK, 0.35)
    for p in land:                                   # coasts, clipped by drawing inside the field
        q = p[(p[:, 0] > x0 - 40) & (p[:, 0] < x1 + 40)]
        if len(q) > 1:
            sh.stroke(np.clip(p, [x0, y0], [x1, y1]), 2.6, INK, 0.9, closed=True)
    for r in RIVERS + [NILE]:
        sh.stroke(proj(r), 2.6, SEA_DEEP, 0.95)
    for mt in MOUNTAINS:
        humps(sh, proj(mt))
    for lake in ((29.0, -4.0), (33.0, -5.2)):        # the Nile's lakes under the Mountains of the Moon
        c = proj([lake])[0]
        sh.disc(c[0], c[1], 6.0, SEA, 0.95)
        sh.ring(c[0], c[1], 6.0, 1.8)
    for k, c in enumerate(proj(CITIES)):
        sh.disc(c[0], c[1], 5.5 if k == 0 else 3.6, RED, 0.95)
        if k == 0:                                   # Baghdad: a double ring
            sh.ring(c[0], c[1], 9.0, 1.8, RED)
    sh.stroke(field, 3.0, INK, closed=True)
    # margin: degree ticks along the top and bottom rules
    for lon in range(-20, 151, 5):
        x = proj([(lon, 0)])[0, 0]
        L = 9 if lon % 10 == 0 else 5
        sh.stroke([(x, y0 - L), (x, y0)], 1.4, INK, 0.8)
        sh.stroke([(x, y1), (x, y1 + L)], 1.4, INK, 0.8)
    return sh


def map_disc():
    """South-up world disc, Balkhi school (al-Istakhri): the encircling ocean, the Mediterranean
    entering from the west (right) and the Indian Ocean from the east (upper left), drawn as the
    school drew them, in compass-and-ruler shapes."""
    sh = Sheet('map_disc', 402)
    W, H = sh.w, sh.h
    sh.frame(8)
    cx, cy, R = W / 2, H / 2 - 8, min(W, H) / 2 - 34
    sh.disc(cx, cy, R, SEA, 0.85)
    sh.disc(cx, cy, R - 22, LAND, 0.95)
    rim = lambda a: (cx + (R - 21) * math.cos(math.radians(a)), cy + (R - 21) * math.sin(math.radians(a)))
    P_ = lambda fx, fy: (cx + R * fx, cy + R * fy)
    med = np.vstack([[rim(4), P_(0.7, 0.1)],
                     bez(P_(0.7, 0.1), P_(0.3, -0.02), P_(-0.1, 0.12), P_(-0.18, 0.21), n=16),
                     bez(P_(-0.18, 0.21), P_(0.0, 0.36), P_(0.38, 0.4), P_(0.7, 0.22), n=16),
                     [rim(13)]])
    black = ell(*P_(-0.1, 0.5), R * 0.17, R * 0.08, rot=-12)
    ocean = np.vstack([ell(cx, cy, R - 21, R - 21, 200, 266, 14),
                       bez(rim(266), P_(0.12, -0.74), P_(0.4, -0.56), P_(0.36, -0.44), n=16),
                       bez(P_(0.36, -0.44), P_(0.1, -0.34), P_(-0.36, -0.36), rim(200), n=16)])
    gulf = np.vstack([bez(P_(-0.1, -0.35), P_(-0.08, -0.16), P_(-0.15, 0.01), n=8),
                      bez(P_(-0.22, 0.01), P_(-0.2, -0.16), P_(-0.24, -0.35), n=8)])
    red_sea = np.vstack([bez(P_(0.25, -0.41), P_(0.3, -0.2), P_(0.31, 0.0), n=8),
                         bez(P_(0.26, 0.01), P_(0.24, -0.2), P_(0.17, -0.38), n=8)])
    for poly in (ocean, med, black, gulf, red_sea):
        sh.shape(poly, SEA, 0.9, INK, 2.4)
    sh.stroke([P_(-0.12, 0.27), P_(-0.12, 0.43)], 2.0, SEA_DEEP)        # the strait to the Black Sea
    for fx, fy, r in ((0.36, 0.2, 6), (0.12, 0.23, 5), (-0.04, 0.2, 5)):  # Sicily, Crete, Cyprus
        sh.disc(*P_(fx, fy), r, LAND)
        sh.ring(*P_(fx, fy), r, 1.6)
    for fx, fy, r in ((-0.44, 0.36, 0.12), (-0.66, 0.24, 0.05)):       # the Caspian, the Aral
        sh.disc(*P_(fx, fy), R * r, SEA, 0.95)
        sh.ring(*P_(fx, fy), R * r, 2.4)
    sh.stroke(bez(P_(0.44, -0.8), P_(0.36, -0.4), P_(0.4, -0.1), P_(0.28, 0.12), n=16), 2.6, SEA_DEEP)
    for dx in (0.0, 0.07):                                              # Tigris and Euphrates
        sh.stroke(bez(P_(-0.2 + dx, 0.02), P_(-0.18 + dx, 0.2), P_(-0.24 + dx * 2, 0.36), n=10), 2.2, SEA_DEEP)
    humps(sh, [P_(-0.56, 0.6), P_(-0.2, 0.7), P_(0.18, 0.66)], 10)
    humps(sh, [P_(0.3, -0.8), P_(0.56, -0.72)], 10)                    # Mountains of the Moon
    sh.disc(*P_(-0.17, 0.24), 4.5, RED)                                 # Baghdad
    sh.ring(cx, cy, R, 3.0)
    sh.ring(cx, cy, R - 22, 2.4)
    for k in range(8):                                                   # wind marks on the rim
        a = math.radians(22.5 + 45 * k)
        sh.disc(cx + (R + 12) * math.cos(a), cy + (R + 12) * math.sin(a), 3.4, RED)
    sh.text(26, H - 44, W - 26, H - 16, line=12, bar=3.2, rubric=False)
    return sh


def map_city():
    """al-Mansur's round city of Baghdad (762): double walls, four gates, the Tigris to the east."""
    sh = Sheet('map_city', 403)
    W, H = sh.w, sh.h
    sh.frame(8)
    cx, cy, R = W * 0.44, H * 0.4, 96
    river = np.vstack([bez((W - 30, 20), (W - 10, cy - 40), (W - 40, cy + 50), (W - 22, H - 90),
                           n=24),
                       bez((W - 52, H - 90), (W - 70, cy + 50), (W - 40, cy - 40), (W - 60, 20),
                           n=24)])
    sh.shape(river, SEA, 0.85, INK, 2.2)
    sh.disc(cx, cy, R + 12, (196, 166, 120), 0.6)
    sh.disc(cx, cy, R, LAND, 0.9)
    for r, w in ((R + 12, 3.0), (R, 2.6), (R - 14, 2.0), (34, 2.6)):
        sh.ring(cx, cy, r, w)
    for k in range(4):                                # the Kufa, Basra, Khurasan and Syria gates
        a = math.radians(45 + 90 * k)
        d = np.array([math.cos(a), math.sin(a)])
        sh.stroke([(cx, cy) + d * 34, (cx, cy) + d * (R + 12)], 6.0, (180, 150, 104), 0.9)
        sh.stroke([(cx, cy) + d * 34, (cx, cy) + d * (R + 12)], 1.4, INK, 0.8)
        g = (cx, cy) + d * (R + 6)
        sh.disc(g[0], g[1], 7.0, RED, 0.9)
    sh.fill([(cx - 14, cy - 14), (cx + 14, cy - 14), (cx + 14, cy + 14), (cx - 14, cy + 14)],
            (176, 120, 84), 0.9)
    sh.stroke([(cx - 14, cy - 14), (cx + 14, cy - 14), (cx + 14, cy + 14), (cx - 14, cy + 14)],
              2.0, INK, closed=True)
    sh.stroke(bez((cx + R + 12, cy + 20), (cx + R + 40, cy + 30), (W - 60, cy + 40), n=10), 2.0,
              SEA_DEEP)                               # a canal to the Tigris
    sh.text(22, H * 0.74, W - 22, H - 18, line=12, bar=3.2)
    return sh


# ---------------------------------------------------------------- biology
def bio_eye():
    """After Hunayn ibn Ishaq: the eye as nested tunics round the central crystalline lens, the
    hollow optic nerve rising to the brain, the parts led off to ruled notes."""
    sh = Sheet('bio_eye', 501)
    W, H = sh.w, sh.h
    sh.frame(10)
    cx, cy, R = W * 0.3, H * 0.56, 168
    # the optic nerve: a hollow tube from the back of the eye up to the top margin
    nerve = [(cx - 30, cy - R + 8), (cx - 22, 40), (cx + 22, 40), (cx + 30, cy - R + 8)]
    sh.shape(nerve, (210, 180, 140), 0.8, INK, 3.0)
    sh.fill([(cx - 9, cy - R + 20), (cx - 7, 40), (cx + 7, 40), (cx + 9, cy - R + 20)], RED, 0.55)
    bands = [(R, (232, 222, 200), 0.9), (R - 12, (220, 200, 170), 0.8), (R - 26, MADDER, 0.55),
             (R - 38, ROSE, 0.5), (R - 48, (196, 206, 176), 0.85)]
    for r, col, a in bands:                       # conjunctiva, sclera, choroid (uvea), retina, vitreous
        sh.disc(cx, cy, r, col, a)
        sh.ring(cx, cy, r, 2.6)
    # the front: cornea bulging below, the aqueous humour, the iris with its pupil gap
    cornea = ell(cx, cy + R - 36, 92, 64, 0, 180, 40)
    sh.fill(np.vstack([cornea, [(cx - 92, cy + R - 36)]]), (232, 226, 208), 0.9)
    sh.stroke(cornea, 3.0)
    sh.fill(ell(cx, cy + R - 44, 78, 30), (226, 222, 196), 0.95)          # aqueous (albugineous) humour
    for side in (-1, 1):
        iris = [(cx + side * 80, cy + R - 60), (cx + side * 22, cy + R - 54),
                (cx + side * 22, cy + R - 44), (cx + side * 84, cy + R - 50)]
        sh.shape(iris, MADDER, 0.75, INK, 2.2)
    # the crystalline lens at the very centre, as Galen and Hunayn placed it
    sh.disc(cx, cy, 52, (226, 196, 120), 0.9)
    sh.ring(cx, cy, 52, 3.4)
    sh.ring(cx, cy, 30, 1.6, INK, 0.6)
    # eyelids closing over the front
    for sgn in (-1, 1):
        lid = bez((cx - 132, cy + R - 16), (cx - 40, cy + R + 30 + sgn * 22), (cx + 40,
                  cy + R + 30 + sgn * 22), (cx + 132, cy + R - 16), n=24)
        sh.stroke(lid, 3.0)
    # leader lines from the parts to the notes
    notes_x = W * 0.6
    parts = [(cx + 20, 60), (cx + R * 0.7, cy - R * 0.7), (cx + R - 31, cy - 10),
             (cx + 40, cy - 20), (cx + 70, cy + R - 50), (cx + 86, cy + R - 30)]
    for k, (px, py) in enumerate(parts):
        ty = 70 + k * (H - 150) / (len(parts) - 1)
        sh.stroke([(px, py), (notes_x - 70, ty), (notes_x - 18, ty)], 1.8, INK, 0.85)
        sh.disc(px, py, 3.4, INK)
        sh.stroke([(notes_x, ty), (notes_x + 60 + 30 * (k % 3), ty)], 4.0, RED, 0.85)
        sh.text(notes_x, ty + 8, W - 40, ty + 44, line=13, bar=3.6, rubric=False)
    return sh


def leaf(sh, base, tip, width, col=GREEN, lobes=0):
    base, tip = np.asarray(base, float), np.asarray(tip, float)
    d = tip - base
    n = np.array([-d[1], d[0]]) / max(np.linalg.norm(d), 1e-9)
    side = lambda s: bez(base, base + d * 0.3 + n * width * s, base + d * 0.75 + n * width * 0.6 * s,
                         tip, n=14)
    poly = np.vstack([side(1), side(-1)[::-1]])
    if lobes:
        t = np.linspace(0, 1, len(poly))
        poly = poly + n * (np.sin(t * math.pi * 2 * lobes) * width * 0.18)[:, None]
    sh.shape(poly, col, 0.8, INK, 2.2)
    sh.stroke([base, base + d * 0.92], 1.4, GREEN_DARK, 0.9)


def ground(sh, y):
    sh.stroke([(24, y), (sh.w - 24, y)], 2.4, BROWN, 0.8)
    for x in np.arange(30, sh.w - 30, 14):
        sh.stroke([(x, y + 3), (x - 6, y + 9)], 1.2, BROWN, 0.6)


def bio_mandrake():
    sh = Sheet('bio_mandrake', 502)
    W, H = sh.w, sh.h
    sh.frame(7)
    cx, gy = W / 2, H * 0.5
    # the forked root below the ground line
    for sgn in (-1, 1):
        root = np.vstack([bez((cx + sgn * 4, gy), (cx + sgn * 26, gy + 40), (cx + sgn * 30, gy + 80),
                              (cx + sgn * 40, gy + 112), n=14),
                          bez((cx + sgn * 34, gy + 114), (cx + sgn * 14, gy + 80), (cx + sgn * 6, gy + 40),
                              (cx - sgn * 8, gy), n=14)])
        sh.shape(root, (176, 132, 90), 0.85, INK, 2.2)
    for sgn in (-1, 1):
        sh.stroke(bez((cx + sgn * 30, gy + 60), (cx + sgn * 52, gy + 70), (cx + sgn * 62, gy + 86), n=8),
                  1.6, INK, 0.8)
    ground(sh, gy)
    # a rosette of broad leaves, the round fruits among them
    for k, ang in enumerate((-160, -132, -104, -76, -48, -20)):
        a = math.radians(ang)
        tip = (cx + 82 * math.cos(a), gy - 6 + 70 * math.sin(a))
        leaf(sh, (cx, gy - 4), tip, 20, GREEN if k % 2 else GREEN_DARK)
    for dx, dy in ((-16, -30), (8, -38), (22, -24), (-4, -18)):
        sh.disc(cx + dx, gy + dy, 8.0, OCHRE, 0.95)
        sh.ring(cx + dx, gy + dy, 8.0, 1.8)
    sh.text(20, H * 0.82, W - 20, H - 14, line=11, bar=3.0)
    return sh


def bio_poppy():
    sh = Sheet('bio_poppy', 503)
    W, H = sh.w, sh.h
    sh.frame(7)
    gy = H * 0.72
    ground(sh, gy)
    for x, top, flower in ((W * 0.38, 46, True), (W * 0.62, 86, False)):
        stem = bez((x, gy), (x - 8, (gy + top) / 2), (x + 6, top + 20), (x, top), n=16)
        sh.stroke(stem, 2.4, GREEN_DARK)
        for k, (yy, s) in enumerate(((gy - 30, -1), (gy - 72, 1), (gy - 110, -1))):
            leaf(sh, (x, yy), (x + s * 54, yy - 26), 13, GREEN, lobes=3)
        if flower:
            for ang in (-150, -100, -40, 10):
                a = math.radians(ang)
                petal = ell(x + 20 * math.cos(a), top + 18 * math.sin(a), 22, 16, rot=ang)
                sh.shape(petal, MADDER, 0.85, INK, 2.0)
            sh.disc(x, top, 8, (90, 70, 50), 0.9)
        else:                                               # the seed capsule
            cap = ell(x, top, 15, 19)
            sh.shape(cap, (170, 166, 110), 0.85, INK, 2.2)
            for dx in (-10, -4, 2, 8):
                sh.stroke([(x + dx, top - 21), (x + dx + 2, top - 26)], 1.6, INK)
    sh.text(20, H * 0.8, W - 20, H - 14, line=11, bar=3.0)
    return sh


def bio_animals():
    """After al-Jahiz's Kitab al-Hayawan: a long-legged bird above, a giraffe below."""
    sh = Sheet('bio_animals', 504)
    W, H = sh.w, sh.h
    sh.frame(8)
    # the bird: a crane, body, long neck and legs
    bx, by = W * 0.42, 92
    body = ell(bx, by, 52, 26, rot=-12)
    sh.shape(body, (214, 206, 186), 0.9, INK, 2.6)
    wing = np.vstack([bez((bx - 34, by - 8), (bx, by - 30), (bx + 40, by - 18), (bx + 58, by - 2), n=14),
                      bez((bx + 58, by - 2), (bx + 20, by + 6), (bx - 20, by + 8), (bx - 34, by - 8), n=14)])
    sh.shape(wing, (176, 164, 140), 0.85, INK, 2.0)
    neck = bez((bx - 44, by - 10), (bx - 70, by - 40), (bx - 66, by - 70), (bx - 80, by - 74), n=16)
    sh.stroke(neck, 6.0, INK)
    sh.stroke(neck, 3.0, (214, 206, 186))
    sh.disc(bx - 82, by - 74, 7, (214, 206, 186))
    sh.ring(bx - 82, by - 74, 7, 2.0)
    sh.disc(bx - 82, by - 77, 3, RED)
    sh.stroke([(bx - 88, by - 72), (bx - 116, by - 66)], 3.0, INK)                 # bill
    for dx in (-6, 10):
        sh.stroke([(bx + dx, by + 22), (bx + dx - 4, by + 64), (bx + dx + 2, by + 100)], 2.4, INK)
    ground(sh, by + 102)
    # the giraffe
    gx, gy = W * 0.5, H * 0.66
    torso = np.vstack([bez((gx - 70, gy), (gx - 74, gy - 40), (gx + 30, gy - 56), (gx + 66, gy - 30),
                           n=18),
                       bez((gx + 66, gy - 30), (gx + 74, gy), (gx + 20, gy + 14), (gx - 70, gy), n=18)])
    neck = np.vstack([bez((gx + 46, gy - 40), (gx + 70, gy - 90), (gx + 84, gy - 130), (gx + 96, gy - 156),
                          n=14),
                      bez((gx + 114, gy - 150), (gx + 98, gy - 120), (gx + 86, gy - 80), (gx + 70, gy - 22),
                          n=14)])
    for poly in (torso, neck):
        sh.fill(poly, OCHRE, 0.9)
    head = ell(gx + 112, gy - 160, 20, 10, rot=24)
    sh.fill(head, OCHRE, 0.9)
    for dx, dy in ((-40, -26), (-14, -36), (14, -34), (40, -22), (-26, -8), (6, -14), (34, -6),
                   (64, -70), (78, -104), (90, -134), (58, -50)):
        sh.disc(gx + dx, gy + dy, 6.5, (150, 98, 54), 0.9)
    for poly in (torso, neck, head):
        sh.stroke(poly, 2.6, closed=True)
    for dx in (-56, -36, 34, 54):
        sh.stroke([(gx + dx, gy + 4), (gx + dx + 2, gy + 70), (gx + dx - 2, gy + 104)], 3.0, INK)
    sh.stroke([(gx + 116, gy - 172), (gx + 120, gy - 184)], 2.2, INK)               # ossicones
    sh.stroke([(gx - 70, gy - 8), (gx - 86, gy + 26)], 2.0, INK)                    # tail
    ground(sh, gy + 106)
    sh.text(22, H - 66, W - 22, H - 16, line=11, bar=3.0)
    return sh


DRAW = {'map_world': map_world, 'chem_alembic': chem_alembic, 'bio_eye': bio_eye,
        'map_disc': map_disc, 'chem_vessels': chem_vessels, 'chem_retort': chem_retort,
        'map_city': map_city, 'chem_cucurbit': chem_cucurbit, 'bio_mandrake': bio_mandrake,
        'bio_poppy': bio_poppy, 'bio_animals': bio_animals}


def atlas(stats=None):
    """The atlas (sRGB 0..1, row 0 = top). Gaps between sheets carry the parchment edge colour,
    so mips never bleed a foreign tone into a sheet's rim."""
    img = np.empty((ATLAS, ATLAS, 3))
    img[:] = P.srgb(PARCH) * 0.9
    for name, draw in DRAW.items():
        sh = draw()
        x, y, w, h = RECTS[name]
        img[y:y + h, x:x + w] = np.clip(sh.img, 0, 1)
    assert_colour_law(img, 'chamber art atlas')
    if stats is not None:
        stats['chamber_art_sheets'] = {k: [round(s, 2) for s in SIZES[k]] for k in SIZES}
    return img


def assert_colour_law(rgb, label):
    """No saturated texel within COBALT_GUARD of cobalt (the hall's guard at 40 degrees)."""
    flat = np.asarray(rgb, dtype=np.float64).reshape(-1, 3)
    mx, mn = flat.max(1), flat.min(1)
    d = mx - mn
    sat = np.where(mx > 0, d / np.maximum(mx, 1e-9), 0)
    r, g, b = flat.T
    dd = np.maximum(d, 1e-9)
    h = np.where(mx == r, ((g - b) / dd) % 6, np.where(mx == g, (b - r) / dd + 2, (r - g) / dd + 4))
    near = np.abs((h * 60 - P.COBALT_HUE + 180) % 360 - 180) < COBALT_GUARD
    frac = float((near & (sat >= 0.25) & (mx >= 0.15)).mean())
    assert frac == 0.0, f'{label}: {frac:.4%} of texels sit within {COBALT_GUARD} deg of cobalt'


def write(tex_dir, stats=None):
    path = os.path.join(tex_dir, 'chamber_art_basecolor.png')
    P.write_png(path, P.to_u8(atlas(stats)))
    return path


if __name__ == '__main__':
    import sys
    out = sys.argv[1] if len(sys.argv) > 1 else '.'
    os.makedirs(out, exist_ok=True)
    print(write(out))
