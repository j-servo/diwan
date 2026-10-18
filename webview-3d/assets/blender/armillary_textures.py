# The armillary sphere's engraving, generated in numpy (no Blender needed). Two texture sets:
#   armillary_*   a 1024^2 atlas of horizontal strips, each tiling in u: graduated degree scales
#                 (ticks every 1, 5 and 10 degrees), the horizon's wind rose, the zodiac belt
#                 (twelve 30-degree signs, each a rosette medallion in interlace; no script, no
#                 pseudo-Arabic), an interlace band, and plain brass, gold, silver and bronze
#   globe_*       a 1024x512 equirectangular Earth: a deep verdigris-ink sea with a faint
#                 graticule and gold continents. Only the Old World (Afro-Eurasia, the oikoumene
#                 the Abbasid geographers mapped), from coarse coastlines coded below; no maps.
# Each set has a base colour (sRGB), a metallic-roughness map (glTF: G roughness, B metalness)
# and, for the atlas, a tangent-space normal map from the engraving's height. Dark patina fields
# with gold-inlaid engraving, bright polished brass on every border, as in the reference.
import os

import numpy as np

import patterns as P

ATLAS = 1024
GLOBE_W, GLOBE_H = 1024, 512
# strip name -> (top row, height) in atlas pixels; gutters between repeat the strips' edge rows
STRIPS = {'scale': (16, 160), 'horizon': (184, 160), 'zodiac': (352, 320),
          'interlace': (680, 128), 'brass': (816, 64), 'gold': (888, 40), 'silver': (936, 40),
          'bronze': (984, 40)}
PAD = 2  # rows kept clear of each strip's edge when mapping, so bilinear taps stay inside

# finish: (sRGB colour, roughness, metalness, relief height in units of RELIEF_M)
PATINA = ((40, 31, 23), 0.68, 0.12, 0.0)          # dark bronze patina, barely metallic
ENGRAVE = ((206, 162, 84), 0.32, 1.0, -0.35)     # gold inlay in a cut line
BORDER = ((196, 150, 78), 0.24, 1.0, 0.6)        # raised polished brass edge
GILT = ((224, 182, 100), 0.28, 1.0, 0.25)        # filled medallions
BRASS = ((192, 146, 74), 0.26, 1.0, 0.0)
GOLD = ((220, 178, 96), 0.2, 1.0, 0.0)
SILVER = ((202, 202, 196), 0.24, 1.0, 0.0)
BRONZE = ((112, 80, 48), 0.45, 0.8, 0.0)
SEA = ((17, 33, 27), 0.55, 0.1)                  # near-black verdigris ink, never navy (cobalt law)
LAND = ((202, 162, 84), 0.3, 1.0)
COAST = ((132, 102, 54), 0.4, 0.9)
GRATICULE = ((104, 86, 52), 0.4, 0.8)
RELIEF_M = 0.0004                                 # 0.4 mm per relief unit
PX_M = 0.001                                      # nominal texel size for the normal map


class UV:
    """UV0 lookups for armillary_spec: Blender convention (v up, row 0 = top of the image)."""

    def strip(self, name, u, s):
        top, h = STRIPS[name]
        y = top + PAD + float(np.clip(s, 0, 1)) * (h - 2 * PAD)
        return (float(u), 1.0 - y / ATLAS)

    def globe(self, u, lat01):
        return (float(u), float(lat01))


# ---------------------------------------------------------------- strip painting
class Strip:
    """Layers of one strip: x in [0, ATLAS) px along u, y in [0, h) px across (s = y / h)."""

    def __init__(self, h, base=PATINA):
        self.h = h
        self.x, self.y = np.meshgrid(np.arange(ATLAS) + 0.5, np.arange(h) + 0.5)
        self.s = self.y / h
        self.col = np.zeros((h, ATLAS, 3))
        self.rough = np.zeros((h, ATLAS))
        self.metal = np.zeros((h, ATLAS))
        self.height = np.zeros((h, ATLAS))
        self.paint(np.ones((h, ATLAS)), base)

    def paint(self, cov, finish):
        rgb, r, m, ht = finish
        c = np.clip(cov, 0, 1)
        self.col = self.col * (1 - c[..., None]) + P.srgb(rgb) * c[..., None]
        self.rough = self.rough * (1 - c) + r * c
        self.metal = self.metal * (1 - c) + m * c
        self.height = self.height * (1 - c) + ht * c

    def band(self, s0, s1, finish):
        """Rows s0..s1 (strip fractions), antialiased."""
        y0, y1 = s0 * self.h, s1 * self.h
        self.paint(np.clip(np.minimum(self.y - y0, y1 - self.y) + 0.5, 0, 1), finish)

    def lines(self, d_px, width_px, finish):
        """Engrave where a distance field (px) is within half a line width."""
        self.paint(np.clip(width_px / 2 - d_px + 0.5, 0, 1), finish)


def _period_d(x, period):
    """Distance (px) to the nearest multiple of `period`, and that multiple's index."""
    k = np.round(x / period)
    return np.abs(x - k * period), k


def _ticks(st, degrees, edge_s, toward, lengths, widths):
    """Degree ticks standing on a rule at edge_s, running `toward` (+1 down / -1 up) the strip:
    every 1, 5 and 10 degrees, `degrees` per repeat."""
    pxdeg = ATLAS / degrees
    d, k = _period_d(st.x, pxdeg)
    k = np.mod(k, degrees)
    for step, length, width in zip((1, 5, 10), lengths, widths):
        reach = (st.s - edge_s) * toward
        on = (np.mod(k, step) == 0) & (reach > -0.01) & (reach < length)
        st.lines(np.where(on, d, 1e9), width, ENGRAVE)
    return pxdeg


def _interlace(st, s_mid, amp_s, period_px, width_px, phase=0.0):
    """Two strands crossing over and under in turn (the gap shows which is on top)."""
    t = 2 * np.pi * (st.x / period_px) + phase
    dists = []
    for sign in (1, -1):
        f = s_mid + sign * amp_s * np.sin(t)
        df = sign * amp_s * np.cos(t) * 2 * np.pi / period_px * st.h
        dists.append(np.abs(st.s - f) * st.h / np.sqrt(1 + df * df))
    crossing = np.mod(np.round(t / np.pi), 2)           # which strand passes over here
    over = np.where(crossing == 0, dists[0], dists[1])
    under = np.where(crossing == 0, dists[1], dists[0])
    gap = over < width_px * 1.4
    st.lines(np.where(gap, 1e9, under), width_px, ENGRAVE)
    st.lines(over, width_px, ENGRAVE)
    # a gilt dot in every loop
    dl, _ = _period_d(st.x - period_px / 4, period_px / 2)
    r = np.hypot(dl, (st.s - s_mid) * st.h)
    st.lines(r, width_px * 1.4, ENGRAVE)


def _star(st, cx_px, s_c, radius_px, points=8):
    """Distance field of an n-pointed star (two overlapping squares for 8) centred in the strip."""
    dx = st.x - cx_px
    dx = dx - np.round(dx / ATLAS) * ATLAS
    dy = (st.s - s_c) * st.h
    ang = np.arctan2(dy, dx)
    r = np.hypot(dx, dy)
    # a regular polygon with points/2 sides, twice, rotated: the star is the union
    n = points // 2
    best = np.full(r.shape, np.inf)
    for rot in (0.0, np.pi / n):
        a = np.mod(ang - rot, 2 * np.pi / n) - np.pi / n
        best = np.minimum(best, r * np.cos(a) - radius_px * np.cos(np.pi / n))
    return best, r


def _medallion(st, cx_px, s_c, radius_px):
    """Gilt eight-point star in a ring, a patina eye and a gilt dot: the rosette of each sign."""
    d, r = _star(st, cx_px, s_c, radius_px * 0.78)
    st.lines(np.abs(r - radius_px), 4, ENGRAVE)
    st.paint(np.clip(0.5 - d, 0, 1), GILT)
    st.paint(np.clip(radius_px * 0.32 - r + 0.5, 0, 1), PATINA)
    st.lines(np.abs(r - radius_px * 0.32), 3, ENGRAVE)
    st.paint(np.clip(radius_px * 0.12 - r + 0.5, 0, 1), GILT)


def _mottle(st, seed, amount=0.07):
    n = P.wave_noise(st.x / ATLAS, st.s, seed, fmin=3, fmax=40)
    patina = (st.metal < 0.5)
    st.col *= (1 + amount * n * patina)[..., None]


def scale_strip():
    """Meridian, equator and colures: an interlace band inside, degree ticks along the outer edge
    (s = 1), 30 degrees per repeat."""
    st = Strip(STRIPS['scale'][1])
    st.band(0.0, 0.08, BORDER)
    st.band(0.92, 1.0, BORDER)
    for s in (0.12, 0.48, 0.885):
        st.lines(np.abs(st.s - s) * st.h, 2.5, ENGRAVE)
    _interlace(st, 0.30, 0.11, ATLAS / 6, 4.0)
    _ticks(st, 30, 0.885, -1, (0.12, 0.2, 0.32), (3.0, 4.5, 6.0))
    # a dot under every tenth degree
    d, k = _period_d(st.x, ATLAS / 3)
    st.lines(np.hypot(d, (st.s - 0.53) * st.h), 7, ENGRAVE)
    _mottle(st, 301)
    return st


def horizon_strip():
    """The horizon brim: 90 degrees per repeat, a wind-rose star at each cardinal point, a rosette
    at each half-wind, ticks along the outer edge."""
    st = Strip(STRIPS['horizon'][1])
    st.band(0.0, 0.08, BORDER)
    st.band(0.92, 1.0, BORDER)
    for s in (0.12, 0.6, 0.885):
        st.lines(np.abs(st.s - s) * st.h, 2.5, ENGRAVE)
    _interlace(st, 0.36, 0.1, ATLAS / 8, 3.5)
    for cx, rad in ((0.0, 0.2), (ATLAS / 2, 0.13)):
        r_px = rad * st.h
        clear = np.hypot(np.minimum(np.abs(st.x - cx), ATLAS - np.abs(st.x - cx)),
                         (st.s - 0.36) * st.h)
        st.paint(np.clip(r_px * 1.15 - clear + 0.5, 0, 1), PATINA)
        _medallion(st, cx, 0.36, r_px)
    _ticks(st, 90, 0.885, -1, (0.08, 0.15, 0.24), (2.0, 3.0, 4.0))
    _mottle(st, 302)
    return st


def zodiac_strip():
    """The ecliptic belt: one 30-degree sign per repeat, degree ticks along both edges, the signs
    parted by double rules, a rosette medallion in interlace at each sign's centre."""
    st = Strip(STRIPS['zodiac'][1])
    st.band(0.0, 0.05, BORDER)
    st.band(0.95, 1.0, BORDER)
    for s in (0.075, 0.225, 0.775, 0.925):
        st.lines(np.abs(st.s - s) * st.h, 2.5, ENGRAVE)
    _ticks(st, 30, 0.075, 1, (0.06, 0.1, 0.13), (3.0, 4.5, 6.0))
    _ticks(st, 30, 0.925, -1, (0.06, 0.1, 0.13), (3.0, 4.5, 6.0))
    zone = (st.s > 0.235) & (st.s < 0.765)
    keep = st.col.copy(), st.rough.copy(), st.metal.copy(), st.height.copy()
    _interlace(st, 0.5, 0.17, ATLAS / 4, 5.0, phase=np.pi / 2)
    # the interlace stays inside the cartouche zone
    for layer, old in zip(('col', 'rough', 'metal', 'height'), keep):
        cur = getattr(st, layer)
        mask = zone[..., None] if layer == 'col' else zone
        setattr(st, layer, np.where(mask, cur, old))
    radius = 0.2 * st.h
    clear = np.hypot(np.abs(st.x - ATLAS / 2), (st.s - 0.5) * st.h)
    st.paint(np.clip(radius * 1.25 - clear + 0.5, 0, 1) * zone, PATINA)
    _medallion(st, ATLAS / 2, 0.5, radius)
    # sign boundaries: double rules across the cartouche
    for off in (7.0, 15.0):
        d = np.minimum(np.abs(st.x - off), np.abs(st.x - (ATLAS - off)))
        st.lines(np.where(zone, d, 1e9), 3.0, ENGRAVE)
    _mottle(st, 303)
    return st


def interlace_strip():
    """Tropics, polar circles and the inner rings: brass edges round a running interlace."""
    st = Strip(STRIPS['interlace'][1])
    st.band(0.0, 0.12, BORDER)
    st.band(0.88, 1.0, BORDER)
    _interlace(st, 0.5, 0.2, ATLAS / 8, 6.0)
    _mottle(st, 304)
    return st


def plain_strip(name, finish, seed, streak=0.06):
    """Polished metal with fine streaks along u (brushed), a little wear in u."""
    st = Strip(STRIPS[name][1], finish)
    v_noise = P.wave_noise(st.s * 0 + st.y / 64.0, st.x * 0, seed, fmin=10, fmax=80)
    u_noise = P.wave_noise(st.x / ATLAS, st.s, seed + 1, fmin=2, fmax=12)
    st.col *= (1 + streak * v_noise + 0.03 * u_noise)[..., None]
    st.rough += 0.04 * u_noise
    return st


def bronze_strip():
    st = plain_strip('bronze', BRONZE, 311, streak=0.03)
    n = P.wave_noise(st.x / ATLAS, st.s, 312, fmin=4, fmax=30)
    dark = np.clip((n - 0.1) * 2.5, 0, 1) * 0.6
    st.paint(dark, PATINA)
    return st


def atlas():
    """The ring atlas: (base sRGB HxWx3, roughness, metalness, height), row 0 = top."""
    base = np.zeros((ATLAS, ATLAS, 3))
    rough = np.zeros((ATLAS, ATLAS))
    metal = np.zeros((ATLAS, ATLAS))
    height = np.zeros((ATLAS, ATLAS))
    strips = {'scale': scale_strip(), 'horizon': horizon_strip(), 'zodiac': zodiac_strip(),
              'interlace': interlace_strip(), 'brass': plain_strip('brass', BRASS, 305),
              'gold': plain_strip('gold', GOLD, 307, 0.04),
              'silver': plain_strip('silver', SILVER, 309, 0.03), 'bronze': bronze_strip()}
    order = sorted(strips, key=lambda n: STRIPS[n][0])
    for name in order:
        top, h = STRIPS[name]
        st = strips[name]
        base[top:top + h], rough[top:top + h] = st.col, st.rough
        metal[top:top + h], height[top:top + h] = st.metal, st.height
    # gutters: every row outside a strip repeats the nearest strip edge row
    spans = [(STRIPS[n][0], STRIPS[n][0] + STRIPS[n][1] - 1) for n in order]
    src = np.arange(ATLAS)
    for r in range(ATLAS):
        if not any(a <= r <= b for a, b in spans):
            src[r] = min((abs(r - e), e) for a, b in spans for e in (a, b))[1]
    base, rough, metal, height = base[src], rough[src], metal[src], height[src]
    return base, np.clip(rough, 0.05, 1), np.clip(metal, 0, 1), height


# ---------------------------------------------------------------- the globe
# Coarse coastlines (lon, lat), even-odd filled: seas inside a landmass are their own polygons.
# Drawn by hand to a few degrees; enough for a gilt globe a quarter of a metre across.
AFRICA = [(-6, 35.8), (-9.5, 30.5), (-13, 27.7), (-16.5, 22), (-17.3, 14.7), (-15, 10.5),
          (-13, 8), (-7.5, 4.4), (-2, 4.9), (2.5, 6.3), (6, 4.3), (9.5, 4), (9.5, 1),
          (11.8, -4.5), (13.5, -11), (12, -17), (14.5, -22.9), (16.5, -28.6), (18.4, -34),
          (20, -34.8), (25.6, -34), (28, -32.7), (32.5, -28.5), (32.9, -26), (35.5, -24),
          (35.3, -20), (40.5, -15), (40.2, -10.5), (39.3, -6), (40.5, -2.5), (43, 0), (46, 2.5),
          (49, 6.5), (51.2, 11.8), (48, 11.2), (44.5, 10.4), (43.3, 11.8), (42.6, 13),
          (39.5, 15.5), (38.6, 18), (37.2, 21), (35.6, 23.9), (34, 26.5), (32.6, 29.9),
          (32.3, 31.2), (29.9, 31.2), (25, 31.6), (20, 30.9), (19.8, 32), (15.5, 31.5),
          (11.2, 33.2), (10.2, 35.5), (11, 37), (9.5, 37.3), (3, 36.8), (-1, 35.7)]
MADAGASCAR = [(49.3, -12), (50.5, -15.5), (49.5, -18), (47.5, -24.5), (45.2, -25.5),
              (43.6, -22), (44.4, -17), (46.5, -15.6)]
EURASIA = [
    # Gibraltar east along the northern Mediterranean shore, Italy, the Balkans, Anatolia
    (-5.6, 36.0), (-2.0, 36.7), (0.0, 38.7), (-0.3, 39.5), (3.2, 41.9), (3.0, 43.2), (6.5, 43.1),
    (9.0, 44.4), (10.5, 43.0), (12.0, 41.8), (15.6, 40.0), (15.7, 38.0), (16.5, 38.5),
    (17.2, 39.0), (18.5, 40.1), (16.0, 41.4), (13.6, 43.5), (12.3, 45.2), (13.7, 45.6),
    (14.5, 45.2), (17.5, 43.0), (19.5, 41.8), (19.4, 40.3), (21.0, 38.3), (22.0, 36.4),
    (23.2, 36.4), (23.0, 38.0), (24.0, 38.2), (22.9, 40.5), (26.0, 40.8), (26.6, 40.0),
    (27.3, 37.5), (28.2, 36.6), (30.5, 36.6), (32.5, 36.1), (34.6, 36.8), (36.0, 36.6),
    # the Levant, Sinai, then down the Red Sea coast of Arabia and round it into the Gulf
    (35.9, 35.4), (35.0, 33.2), (34.5, 31.6), (34.2, 31.3), (32.4, 31.1), (32.5, 29.9),
    (33.5, 28.0), (34.3, 27.8), (34.9, 29.5), (35.2, 28.0), (36.6, 25.6), (38.5, 23.5),
    (39.2, 21.5), (40.7, 19.0), (42.5, 16.4), (43.3, 12.7), (45.0, 12.8), (48.5, 14.0),
    (52.2, 15.6), (55.0, 17.0), (57.8, 18.9), (58.6, 20.5), (59.8, 22.5), (58.6, 23.6),
    (56.4, 24.9), (56.3, 26.2), (55.5, 25.5), (54.0, 24.1), (51.6, 24.6), (51.5, 25.9),
    (50.0, 26.6), (48.5, 28.0), (48.0, 29.9),
    # Persia, India, Burma, Malaya, Indochina, China, Korea
    (50.3, 29.3), (51.4, 27.9), (54.0, 26.6), (56.3, 27.2), (57.3, 25.8), (61.6, 25.2),
    (66.5, 25.4), (67.4, 24.0), (68.5, 23.2), (70.0, 22.4), (72.6, 21.0), (72.9, 19.0),
    (73.4, 16.0), (74.6, 13.0), (75.8, 11.0), (77.0, 8.2), (78.2, 8.9), (79.9, 10.3),
    (80.3, 13.1), (80.2, 15.6), (82.3, 16.6), (84.9, 19.3), (86.9, 21.6), (88.5, 22.0),
    (90.6, 22.5), (91.8, 22.3), (92.4, 20.7), (94.3, 18.0), (94.2, 16.0), (97.6, 16.5),
    (98.6, 13.0), (98.4, 9.0), (100.4, 7.0), (100.3, 5.0), (101.3, 2.8), (103.4, 1.3),
    (104.2, 1.6), (103.5, 4.2), (102.3, 6.1), (100.9, 8.5), (99.8, 9.3), (99.2, 10.5),
    (99.9, 12.6), (100.9, 13.4), (102.0, 12.2), (103.0, 11.0), (104.8, 8.7), (106.8, 10.4),
    (109.2, 11.6), (109.3, 13.4), (108.6, 15.4), (106.6, 17.5), (105.7, 19.0), (106.8, 20.7),
    (108.0, 21.5), (109.8, 21.4), (110.4, 20.3), (111.6, 21.6), (113.6, 22.4), (116.5, 22.9),
    (118.5, 24.6), (119.8, 26.0), (121.6, 28.4), (121.9, 30.9), (120.5, 32.6), (119.2, 34.6),
    (120.6, 36.4), (122.5, 37.2), (119.0, 37.2), (117.8, 38.6), (117.7, 39.2), (119.6, 39.9),
    (121.5, 40.9), (124.3, 39.9), (125.4, 37.7), (126.5, 34.5), (129.3, 35.2), (129.5, 37.0),
    (128.4, 38.6), (129.7, 40.8), (131.5, 42.6), (135.2, 43.8), (138.5, 47.0), (140.4, 48.9),
    (141.4, 52.2), (137.4, 54.0), (143.0, 59.3), (155.0, 59.5), (163.5, 61.5), (170.0, 65.0),
    (180.0, 66.0),
    # the far north, westwards (unknown to the Abbasid geographers; kept plain)
    (180.0, 72.0), (140.0, 72.5), (113.0, 73.5), (104.0, 77.7), (87.0, 75.0), (80.0, 73.0),
    (69.0, 73.0), (68.0, 69.0), (60.0, 69.0), (54.0, 68.5), (44.0, 68.5), (41.0, 66.5),
    (40.0, 64.5), (36.0, 64.5), (33.0, 69.4), (28.0, 71.0), (22.0, 70.5), (16.0, 68.8),
    (13.0, 67.5), (12.0, 65.0), (10.0, 63.5), (5.0, 62.0), (5.5, 59.0), (7.0, 58.0),
    (8.0, 58.1), (10.5, 59.2), (11.2, 58.5), (10.6, 57.7),
    # Denmark, the North Sea and Atlantic coasts back to Gibraltar
    (8.1, 56.9), (8.6, 55.5), (8.6, 53.9), (4.5, 52.0), (1.6, 50.9), (-1.6, 48.8),
    (-4.7, 48.4), (-1.2, 46.2), (-1.5, 43.5), (-9.0, 43.0), (-9.0, 37.0)]
INLAND_SEAS = [
    [(29.0, 41.2), (31.5, 41.2), (35.0, 42.0), (38.0, 41.0), (41.5, 41.5), (41.6, 42.8),
     (39.0, 44.3), (37.5, 44.8), (38.0, 46.5), (35.0, 45.0), (33.5, 44.5), (32.5, 45.4),
     (31.0, 46.6), (30.2, 45.8), (29.6, 45.0), (28.6, 43.5), (28.0, 42.0)],           # Black Sea
    [(47.0, 44.8), (49.0, 46.6), (51.8, 47.0), (53.0, 45.3), (51.3, 44.5), (52.8, 42.0),
     (54.0, 40.8), (53.0, 39.4), (54.0, 37.4), (51.0, 36.7), (49.0, 37.6), (48.9, 38.6),
     (49.6, 40.4), (47.5, 43.0)],                                                   # Caspian
    [(12.5, 54.4), (14.2, 53.9), (18.5, 54.7), (21.2, 55.3), (21.0, 56.8), (24.0, 57.2),
     (24.3, 58.4), (28.5, 59.6), (29.8, 60.0), (22.9, 60.0), (21.5, 61.0), (21.2, 63.0),
     (25.0, 65.0), (25.4, 65.5), (23.0, 65.8), (21.0, 64.5), (19.0, 63.0), (17.4, 61.0),
     (18.4, 59.3), (16.8, 58.0), (16.0, 56.2), (14.3, 55.5), (12.9, 55.6)],          # Baltic
]
ISLANDS = [
    [(-5.7, 50.0), (1.4, 51.2), (1.7, 52.7), (0.2, 53.5), (-0.3, 54.5), (-1.6, 55.6),
     (-2.0, 57.6), (-3.2, 58.6), (-5.0, 58.6), (-6.2, 57.5), (-5.6, 55.8), (-4.8, 54.8),
     (-3.1, 53.4), (-4.6, 53.3), (-4.2, 52.3), (-5.3, 51.8), (-3.0, 51.2)],          # Britain
    [(-6.0, 52.0), (-6.2, 53.9), (-5.6, 54.6), (-7.3, 55.3), (-8.5, 54.4), (-10.0, 53.5),
     (-9.8, 51.6), (-8.0, 51.8)],                                                   # Ireland
    [(12.4, 38.0), (15.6, 38.3), (15.1, 36.7), (12.4, 37.6)],                       # Sicily
    [(8.4, 39.0), (9.6, 39.2), (9.8, 41.0), (9.4, 43.0), (8.6, 42.4), (8.4, 40.6)],  # Sardinia
    [(23.5, 35.3), (26.3, 35.2), (24.7, 34.9)],                                     # Crete
    [(32.3, 35.0), (34.6, 35.6), (33.0, 34.6)],                                     # Cyprus
    [(79.9, 7.0), (80.2, 9.8), (81.9, 7.6), (81.3, 6.2), (80.1, 6.1)],              # Sri Lanka
    [(95.2, 5.6), (98.0, 4.2), (100.5, 2.0), (104.0, -1.0), (106.0, -3.0), (105.8, -5.8),
     (104.5, -5.9), (102.0, -4.0), (98.5, 1.0)],                                    # Sumatra
    [(105.2, -6.8), (108.3, -6.2), (111.0, -6.4), (114.6, -7.7), (114.4, -8.7), (110.0, -8.2),
     (106.0, -7.4)],                                                                # Java
    [(109.0, 1.6), (111.0, 2.5), (114.0, 4.6), (117.0, 7.0), (119.2, 5.0), (118.0, 1.0),
     (116.5, -2.5), (116.0, -4.0), (110.3, -3.0), (109.0, -0.5)],                   # Borneo
    [(130.2, 31.3), (131.0, 33.9), (134.0, 34.6), (135.2, 33.6), (136.9, 34.6), (139.8, 35.0),
     (140.9, 36.9), (141.9, 39.8), (141.4, 41.4), (140.0, 40.6), (139.7, 38.5), (136.8, 37.3),
     (135.7, 35.5), (133.0, 35.5), (131.0, 34.3), (129.6, 33.2)],                   # Japan
    [(120.2, 22.6), (121.9, 25.0), (121.0, 25.1), (120.1, 23.5)],                   # Taiwan
    [(108.7, 19.2), (110.5, 20.1), (111.0, 19.6), (109.6, 18.2)],                   # Hainan
    MADAGASCAR, AFRICA,
]


def landmask(w=GLOBE_W, h=GLOBE_H):
    """Even-odd fill of every coastline polygon on the equirectangular grid (row 0 = north)."""
    lon = -180 + (np.arange(w) + 0.5) * 360 / w
    lat = 90 - (np.arange(h) + 0.5) * 180 / h
    X, Y = np.meshgrid(lon, lat)
    inside = np.zeros((h, w), bool)
    for poly in [EURASIA] + INLAND_SEAS + ISLANDS:
        p = np.asarray(poly, float)
        q = np.roll(p, -1, 0)
        acc = np.zeros((h, w), bool)
        for (x1, y1), (x2, y2) in zip(p, q):
            if y1 == y2:
                continue
            cond = (y1 > Y) != (y2 > Y)
            xc = (x2 - x1) * (Y - y1) / (y2 - y1) + x1
            acc ^= cond & (X < xc)
        inside ^= acc
    return inside


def _blur(a, n=1):
    for _ in range(n):
        a = (np.roll(a, 1, 1) + a + np.roll(a, -1, 1)) / 3
        a = (np.vstack([a[:1], a[:-1]]) + a + np.vstack([a[1:], a[-1:]])) / 3
    return a


def globe():
    """(base sRGB, roughness, metalness) of the Earth, 1024x512, row 0 = north."""
    land = _blur(landmask().astype(float), 1)
    inner = _blur((land > 0.5).astype(float), 3)
    coast = np.clip((1 - inner) * 2.2, 0, 1) * (land > 0.5)
    lon = (np.arange(GLOBE_W) + 0.5) / GLOBE_W * 360
    lat = (np.arange(GLOBE_H) + 0.5) / GLOBE_H * 180
    LON, LAT = np.meshgrid(lon, lat)
    px = 360 / GLOBE_W
    grid = np.minimum(np.abs(np.mod(LON + 15, 30) - 15), np.abs(np.mod(LAT + 15, 30) - 15)) / px
    graticule = np.clip(1.2 - grid, 0, 1) * 0.8
    noise = P.wave_noise(LON / 360, LAT / 180, 321, fmin=4, fmax=60)
    base = np.zeros((GLOBE_H, GLOBE_W, 3))
    rough = np.zeros((GLOBE_H, GLOBE_W))
    metal = np.zeros((GLOBE_H, GLOBE_W))
    layers = [(np.ones_like(land), SEA), (graticule * (1 - land), GRATICULE), (land, LAND),
              (coast, COAST)]
    for cov, (rgb, r, m) in layers:
        c = np.clip(cov, 0, 1)
        base = base * (1 - c[..., None]) + P.srgb(rgb) * c[..., None]
        rough = rough * (1 - c) + r * c
        metal = metal * (1 - c) + m * c
    base *= (1 + 0.06 * noise)[..., None]
    return base, rough, metal


def mr_image(rough, metal):
    """glTF metallic-roughness: R unused (white), G roughness, B metalness."""
    return np.stack([np.ones_like(rough), rough, metal], -1)


def write_all(tex_dir, stats=None):
    """Writes armillary_{basecolor,mr,normal}.png and globe_{basecolor,mr}.png; asserts the
    colour law on both base colours."""
    os.makedirs(tex_dir, exist_ok=True)
    base, rough, metal, height = atlas()
    P.assert_no_cobalt(base, 'armillary engraving atlas')
    P.write_png(os.path.join(tex_dir, 'armillary_basecolor.png'), P.to_u8(base))
    P.write_png(os.path.join(tex_dir, 'armillary_mr.png'), P.to_u8(mr_image(rough, metal)))
    nrm = P.height_to_normal(height * RELIEF_M, PX_M, PX_M, wrap_u=True, wrap_v=False)
    P.write_png(os.path.join(tex_dir, 'armillary_normal.png'), P.to_u8(nrm))
    gb, gr, gm = globe()
    P.assert_no_cobalt(gb, 'armillary globe')
    P.write_png(os.path.join(tex_dir, 'globe_basecolor.png'), P.to_u8(gb))
    P.write_png(os.path.join(tex_dir, 'globe_mr.png'), P.to_u8(mr_image(gr, gm)))
    if stats is not None:
        stats['globe_land_fraction'] = round(float((landmask()).mean()), 4)
        stats['atlas_cobalt_fraction'] = P.cobalt_clash(base)
        stats['globe_cobalt_fraction'] = P.cobalt_clash(gb)


if __name__ == '__main__':
    import sys
    write_all(sys.argv[1] if len(sys.argv) > 1 else 'tex')
