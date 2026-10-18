# Procedural figurine geometry: lofted parts with explicit skin weights.
#
# Every part is built in rest pose, in armature space (see figures_rig.py for axes). Weights are
# computed from each vertex's place in its part (height on the robe, angle around the waist,
# distance along an arm), not by heat diffusion, so open cloth shells skin cleanly.
import math

import bpy
from mathutils import Matrix, Vector

import figures_rig as rig

TAU = 2 * math.pi


def clamp(x, lo=0.0, hi=1.0):
    return lo if x < lo else hi if x > hi else x


def smooth(e0, e1, x):
    t = clamp((x - e0) / (e1 - e0))
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def norm_weights(w, limit=4):
    w = {k: v for k, v in w.items() if v > 1e-4}
    top = sorted(w.items(), key=lambda kv: -kv[1])[:limit]
    s = sum(v for _, v in top) or 1.0
    return {k: v / s for k, v in top}


def mix(*pairs):
    out = {}
    for wdict, f in pairs:
        if f <= 0:
            continue
        for k, v in wdict.items():
            out[k] = out.get(k, 0.0) + v * f
    return out


class Part:
    """Accumulates vertices (with weights) and faces (with material names)."""

    def __init__(self):
        self.V, self.W, self.F, self.M = [], [], [], []

    def vert(self, co, w):
        self.V.append(Vector(co))
        self.W.append(norm_weights(w))
        return len(self.V) - 1

    def face(self, idx, mat):
        self.F.append(tuple(idx))
        self.M.append(mat)

    def grid(self, rows, closed, mat_fn, w_fn, flip=None):
        """rows: list of lists of points; quads between consecutive rows. flip=None orients the
        faces outward from the centroid of the rows (right for tubes and wraps); strips pass a
        bool. Returns the index grid."""
        ids = [[self.vert(p, w_fn(i, j, p)) for j, p in enumerate(row)] for i, row in enumerate(rows)]
        n = len(rows[0])
        cols = n if closed else n - 1
        quads = []
        for i in range(len(rows) - 1):
            for j in range(cols):
                j2 = (j + 1) % n
                quads.append(((ids[i][j], ids[i][j2], ids[i + 1][j2], ids[i + 1][j]), mat_fn(i, j)))
        if flip is None:
            pts = [p for row in rows for p in row]
            c = sum(pts, Vector()) / len(pts)
            score = 0.0
            for q, _ in quads:
                a, b, d = self.V[q[0]], self.V[q[1]], self.V[q[3]]
                score += (b - a).cross(d - a).dot(a - c)
            flip = score < 0
        for q, m in quads:
            self.face(q[::-1] if flip else q, m)
        return ids

    def fan(self, ring_ids, apex, w, mat):
        """Cap a ring with a fan, facing away from the ring's interior."""
        c = self.vert(apex, w)
        n = len(ring_ids)
        cen = sum((self.V[i] for i in ring_ids), Vector()) / n
        a, b = self.V[ring_ids[0]], self.V[ring_ids[1]]
        flip = (b - a).cross(self.V[c] - a).dot(self.V[c] - cen) < 0
        for j in range(n):
            t = (ring_ids[j], ring_ids[(j + 1) % n], c)
            self.face(t[::-1] if flip else t, mat)


def superellipse(cx, cy, rx, ry, theta, p=2.0):
    s, c = math.sin(theta), -math.cos(theta)
    fx = math.copysign(abs(s) ** (2 / p), s)
    fy = math.copysign(abs(c) ** (2 / p), c)
    return Vector((cx + rx * fx, cy + ry * fy, 0))


def interp_keys(keys, z):
    """keys: [(z, a, b, ...)] sorted by z ascending; linear interpolation of the tail values."""
    if z <= keys[0][0]:
        return keys[0][1:]
    for k0, k1 in zip(keys, keys[1:]):
        if z <= k1[0]:
            t = (z - k0[0]) / (k1[0] - k0[0])
            return tuple(lerp(a, b, t) for a, b in zip(k0[1:], k1[1:]))
    return keys[-1][1:]


# ---------------------------------------------------------------- robe body (torso + skirt)

# (z, centre y, radius x, radius y): the torso of the robe from the waist to the collar.
TORSO_KEYS = [
    (0.94, 0.010, 0.150, 0.124),
    (1.00, 0.010, 0.146, 0.118),
    (1.06, 0.008, 0.148, 0.117),
    (1.13, 0.004, 0.158, 0.121),
    (1.20, 0.002, 0.170, 0.123),
    (1.255, 0.004, 0.186, 0.116),
    (1.29, 0.008, 0.194, 0.104),
    (1.312, 0.010, 0.178, 0.092),
    (1.330, 0.010, 0.138, 0.082),
    (1.346, 0.008, 0.094, 0.073),
    (1.360, 0.006, 0.066, 0.064),
    (1.376, 0.006, 0.060, 0.058),
]
TORSO_Z = [k[0] for k in TORSO_KEYS]

HIP_RING = (0.012, 0.172, 0.150, 0.86)


def skirt_ring(z):
    """(cy, rx, ry) of the robe at height z below the waist (piecewise linear through chains)."""
    keys = [rig.HEM_RING, rig.KNEE_RING, HIP_RING, rig.WAIST_RING]
    keys = [(k[3], k[0], k[1], k[2]) for k in keys]
    return interp_keys(keys, z)


def robe_point(theta, z, offset=0.0):
    if z >= rig.WAIST_RING[3]:
        cy, rx, ry = interp_keys(TORSO_KEYS, z)
        p = superellipse(0, cy, rx + offset, ry + offset, theta, 2.3)
    else:
        cy, rx, ry = skirt_ring(z)
        p = superellipse(0, cy, rx + offset, ry + offset, theta, 2.0)
    p.z = z
    return p


def torso_weights(co):
    z = co.z
    stops = [(0.99, 'hips'), (1.09, 'spine'), (1.20, 'chest'), (1.355, 'chest'), (1.39, 'neck')]
    if z <= stops[0][0]:
        w = {'hips': 1.0}
    elif z >= stops[-1][0]:
        w = {'neck': 1.0}
    else:
        for (z0, b0), (z1, b1) in zip(stops, stops[1:]):
            if z <= z1:
                t = smooth(z0, z1, z)
                w = mix(({b0: 1}, 1 - t), ({b1: 1}, t))
                break
    side = 'L' if co.x > 0 else 'R'
    ax = abs(co.x)
    f_sh = smooth(0.09, 0.19, ax) * smooth(1.16, 1.27, z) * 0.75
    f_ua = smooth(0.175, 0.215, ax) * smooth(1.18, 1.25, z) * 0.45
    rest = max(0.0, 1 - f_sh - f_ua)
    return mix((w, rest), ({f'shoulder.{side}': 1}, f_sh), ({f'upper_arm.{side}': 1}, f_ua))


def skirt_weights(theta, z):
    """Chain weights for a robe point at angle theta, height z (rest pose)."""
    zw, zk = rig.WAIST_RING[3], rig.KNEE_RING[3]
    if z >= zw:
        return {'hips': 1.0}
    f = (theta % TAU) / TAU * rig.SKIRT_N
    k0 = int(math.floor(f)) % rig.SKIRT_N
    k1 = (k0 + 1) % rig.SKIRT_N
    a = f - math.floor(f)
    a = a * a * (3 - 2 * a) * 0.5 + a * 0.5  # mild easing keeps panels between chains flat
    up0, lo0 = rig.skirt_names(k0)
    up1, lo1 = rig.skirt_names(k1)
    w_lo = smooth(zk + 0.07, zk - 0.07, z)
    w_hips = smooth(zw - 0.09, zw, z)
    chains = mix(({up0: 1 - a, up1: a}, 1 - w_lo), ({lo0: 1 - a, lo1: a}, w_lo))
    return mix(({'hips': 1}, w_hips), (chains, 1 - w_hips))


def robe_weights(theta, co):
    if co.z >= rig.WAIST_RING[3] + 0.02:
        return torso_weights(co)
    if co.z >= rig.WAIST_RING[3] - 0.01:
        return {'hips': 1.0}
    return skirt_weights(theta, co.z)


def warped_thetas(n, power=1.0, start=0.0, end=TAU):
    """n columns over [start, end), denser near the front when power > 1 (closed ring)."""
    if power == 1.0:
        return [start + (end - start) * j / n for j in range(n)]
    out = []
    for j in range(n):
        t = -1 + 2 * j / n
        out.append(math.copysign(math.pi * abs(t) ** power, t) % TAU)
    return out


def build_robe(part, style):
    """Torso and skirt of the inner robe as one closed loft. style: dict of options."""
    n = 32
    thetas = [TAU * j / n for j in range(n)]
    hem = style['hem_z']
    zs = sorted(set(TORSO_Z + [0.975, 0.93, 0.86, 0.78, 0.69, 0.61, 0.555, 0.50, 0.445,
                               0.39, 0.31, 0.23, 0.16, 0.10, 0.055]), reverse=True)
    zs = [z for z in zs if z >= hem - 1e-6]
    if zs[-1] > hem + 1e-6:
        zs.append(hem)
    zs = zs[::-1]  # ascending: rows go upward for outward normals
    rows = [[robe_point(th, z) for th in thetas] for z in zs]
    # Hem turn-up: one row inside the hem gives the open bottom a cloth thickness.
    inner = [robe_point(th, hem + 0.02, -0.012) for th in thetas]
    for p in inner:
        p.z = hem + 0.02
    rows = [inner] + rows
    zrow = [hem + 0.02] + zs

    trim_rows = style.get('trim_rows', set())

    def mat(i, j):
        zc = 0.5 * (zrow[i] + zrow[i + 1])
        if i == 0 or zc < hem + style['hem_band']:
            return 'trim'
        if any(lo <= zc <= hi for lo, hi in trim_rows):
            return 'trim'
        return style['robe_mat']

    part.grid(rows, True, mat, lambda i, j, p: robe_weights(thetas[j], p))
    return zs


def build_cloak(part):
    """Scholar's open-fronted outer robe (jubba) with banded front edges, hem and collar."""
    hem = 0.13
    zs = [hem, 0.17, 0.23, 0.31, 0.39, 0.445, 0.50, 0.555, 0.61, 0.69, 0.78, 0.86, 0.93, 0.975,
          1.00, 1.06, 1.13, 1.20, 1.255, 1.29, 1.312, 1.330, 1.346, 1.360]
    ncol = 27

    def half_open(z):
        # front opening half-angle: a narrow V at the collar widening down to the hem
        return math.radians(lerp(30, 13, smooth(0.2, 1.33, z)))

    def offset(z):
        if z >= 0.975:
            return 0.011 + 0.004 * smooth(1.30, 1.36, z)
        return lerp(0.028, 0.013, smooth(0.13, 0.975, z))

    rows, row_thetas = [], []
    for z in zs:
        h = half_open(z)
        ths = [h + (TAU - 2 * h) * j / (ncol - 1) for j in range(ncol)]
        row_thetas.append(ths)
        rows.append([robe_point(th, z, offset(z)) for th in ths])
    # Standing collar band above the shoulders.
    ths = row_thetas[-1]
    collar = []
    for th in ths:
        p = robe_point(th, 1.360, 0.018)
        p.z = 1.392
        collar.append(p)
    rows.append(collar)
    row_thetas.append(ths)
    zs = zs + [1.392]

    def mat(i, j):
        zc = 0.5 * (zs[i] + zs[i + 1])
        if j == 0 or j == ncol - 2 or zc < hem + 0.045 or zc > 1.355:
            return 'trim'
        return 'cloak'

    def w(i, j, p):
        th = row_thetas[i][j]
        base = robe_point(th, p.z, 0.0)
        return robe_weights(th, base)

    part.grid(rows, False, mat, w)


# ---------------------------------------------------------------- sleeves, hands, legs


def arm_frame_points(side, start_in=0.05, past_wrist=0.025):
    S, E, W, K = rig.arm_rest(side)
    s = rig.SIGN[side]
    S0 = S + Vector((-s * start_in, 0.0, 0.004))
    Wx = W + (W - E).normalized() * past_wrist
    return S0, S, E, W, Wx


def arm_param_weights(side, u):
    """u: 0 = shoulder joint, 1 = elbow, 2 = wrist (piecewise by segment)."""
    sh, ua, fa, ha = (f'{b}.{side}' for b in ('shoulder', 'upper_arm', 'forearm', 'hand'))
    if u < 0:
        return {sh: 0.55, ua: 0.45}
    if u < 0.25:
        t = smooth(0.0, 0.25, u)
        return {sh: 0.45 * (1 - t), ua: 0.55 + 0.45 * t}
    if u < 0.82:
        return {ua: 1.0}
    if u < 1.18:
        t = smooth(0.82, 1.18, u)
        return {ua: 1 - t, fa: t}
    if u < 2.0:
        return {fa: 1.0}
    return {fa: 0.8, ha: 0.2}


def build_sleeve(part, side, style):
    S0, S, E, W, Wx = arm_frame_points(side, past_wrist=style['past_wrist'])
    # (u, point on path); u as in arm_param_weights
    path = [(-0.25, S0), (0.0, S)]
    for u in (0.25, 0.55, 0.82):
        path.append((u, S.lerp(E, u)))
    path.append((1.0, E))
    for u in (0.3, 0.6, 0.85):
        path.append((1 + u, E.lerp(W, u)))
    path.append((2.0, W))
    path.append((2.0 + style['past_wrist'] / rig.FOREARM, Wx))
    radii = style['radii']
    droop = style['droop']
    n = 16
    rows, us = [], []
    for k, (u, c) in enumerate(path):
        if k == 0:
            d = (path[1][1] - c).normalized()
        elif k == len(path) - 1:
            d = (c - path[k - 1][1]).normalized()
        else:
            d = (path[k + 1][1] - path[k - 1][1]).normalized()
        down = Vector((0, 0, -1)) - d * d.z
        down = down.normalized() if down.length > 1e-6 else Vector((0, 1, 0))
        side_v = d.cross(down).normalized()
        r = radii[k]
        cc = c + down * droop[k]
        if k <= 2:  # near the shoulder: keep the sleeve top on the shoulder line
            cc = cc + Vector((0, 0, -(0.034, 0.030, 0.012)[k]))
        ring = []
        for j in range(n):
            a = TAU * j / n
            # cross-section: a little deeper towards "down" so the sleeve hangs like cloth
            rr = r * (1 + 0.12 * max(0.0, math.cos(a)) * (k / len(path)))
            ring.append(cc + (down * math.cos(a) + side_v * math.sin(a)) * rr)
        rows.append(ring)
        us.append(u)
    # Lining: the open cuff turns inward so it reads as cloth with thickness.
    last = rows[-1]
    cen = sum(last, Vector()) / n
    d_end = (path[-1][1] - path[-2][1]).normalized()
    lining = [cen + (p - cen) * 0.82 - d_end * 0.03 for p in last]
    rows.append(lining)
    us.append(us[-1])
    trim_u = style['trim_u']

    def mat(i, j):
        uc = 0.5 * (us[i] + us[i + 1])
        if style['cuff'] and i >= len(rows) - 3:
            return 'trim'
        if any(lo <= uc <= hi for lo, hi in trim_u):
            return 'trim'
        return style['mat']

    part.grid(rows, True, mat, lambda i, j, p: arm_param_weights(side, us[i]))


def hand_rest_frame(side):
    """Rest wrist point and (a = fingers direction, n = palm normal, t = thumb side)."""
    S, E, W, K = rig.arm_rest(side)
    a = (K - W).normalized()
    m = Vector((-rig.SIGN[side], 0.25, 0.0))  # palm faces the thigh, slightly back
    n = (m - a * m.dot(a)).normalized()
    t = a.cross(n) if side == 'R' else n.cross(a)
    return W, a, n, t


def hand_frame_rest_matrix(side):
    W, a, n, t = hand_rest_frame(side)
    M = Matrix.Identity(4)
    M.col[0][:3] = a
    M.col[1][:3] = n
    M.col[2][:3] = a.cross(n)
    M.col[3][:3] = W
    return M


def build_hand(part, side):
    W, a, n, t = hand_rest_frame(side)
    hb, fb = f'hand.{side}', f'forearm.{side}'
    # (s along the hand, half width, half thickness, curl angle in degrees)
    k = 0.88  # a slender, elegant hand
    prof = [(s_ * k, hw * k, ht * k, c) for s_, hw, ht, c in (
        (-0.03, 0.024, 0.021, 0), (0.0, 0.027, 0.019, 0), (0.03, 0.035, 0.016, 0),
        (0.06, 0.039, 0.015, 0), (0.085, 0.038, 0.013, 4), (0.108, 0.035, 0.0115, 22),
        (0.13, 0.031, 0.0105, 42), (0.148, 0.027, 0.0095, 60), (0.16, 0.021, 0.008, 72))]
    n_col = 12
    rows = []
    pos = W + a * prof[0][0]
    prev_s = prof[0][0]
    for s_, hw, ht, curl in prof:
        phi = math.radians(curl)
        d = (a * math.cos(phi) + n * math.sin(phi)).normalized()
        if s_ > prev_s:
            pos = pos + d * (s_ - prev_s)
        prev_s = s_
        nn = (n * math.cos(phi) - a * math.sin(phi)).normalized()
        ring = []
        for j in range(n_col):
            ang = TAU * j / n_col
            ring.append(pos + t * (hw * math.cos(ang)) + nn * (ht * math.sin(ang)))
        rows.append(ring)

    def w(i, j, p):
        s_ = prof[i][0]
        f = smooth(-0.03, 0.02, s_)
        return {hb: f, fb: 1 - f} if f < 1 else {hb: 1.0}

    ids = part.grid(rows, True, lambda i, j: 'skin', w)
    tip = pos + (a * math.cos(math.radians(80)) + n * math.sin(math.radians(80))) * 0.006
    part.fan(ids[-1], tip, {hb: 1.0}, 'skin')
    # Thumb: a short capsule from the palm side towards the grip.
    base = W + a * 0.026 + t * 0.023 + n * 0.005
    tdir = (a * 0.55 + t * 0.25 + n * 0.62).normalized()
    side_ax = tdir.cross(t).normalized()
    up_ax = side_ax.cross(tdir).normalized()
    trows = []
    for l, r in [(0.0, 0.011), (0.022, 0.0105), (0.040, 0.0092), (0.051, 0.007)]:
        c = base + tdir * l
        trows.append([c + side_ax * (r * math.cos(TAU * j / 8)) + up_ax * (r * math.sin(TAU * j / 8))
                      for j in range(8)])
    tids = part.grid(trows, True, lambda i, j: 'skin', lambda i, j, p: {hb: 1.0})
    part.fan(tids[-1], base + tdir * 0.056, {hb: 1.0}, 'skin')


def tube(part, pts, radii, ws, mat, n=8, cap_end=None, cap_start=None):
    rows = []
    for k, c in enumerate(pts):
        d = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        ref = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
        u = d.cross(ref).normalized()
        v = d.cross(u).normalized()
        rows.append([c + (u * math.cos(TAU * j / n) + v * math.sin(TAU * j / n)) * radii[k]
                     for j in range(n)])
    ids = part.grid(rows, True, lambda i, j: mat, lambda i, j, p: ws[i])
    if cap_end is not None:
        part.fan(ids[-1], cap_end, ws[-1], mat)
    if cap_start is not None:
        part.fan(ids[0], cap_start, ws[0], mat)
    return ids


def build_legs(part, style):
    for side in rig.SIDES:
        Hj, K, A, T = rig.leg_rest(side)
        th, sh, ft = f'thigh.{side}', f'shin.{side}', f'foot.{side}'
        pts = [Hj + Vector((0, 0, 0.03)), Hj.lerp(K, 0.4), K.lerp(Hj, 0.08), K, K.lerp(A, 0.1),
               K.lerp(A, 0.55), A + Vector((0, 0, 0.03))]
        radii = [0.064, 0.060, 0.054, 0.052, 0.050, 0.043, 0.035]
        ws = [{th: 1}, {th: 1}, {th: 0.8, sh: 0.2}, {th: 0.5, sh: 0.5}, {sh: 0.85, th: 0.15},
              {sh: 1}, {sh: 0.6, ft: 0.4}]
        tube(part, pts, radii, ws, style['legs_mat'])
        build_shoe(part, side)


def build_shoe(part, side):
    Hj, K, A, T = rig.leg_rest(side)
    s = rig.SIGN[side]
    fwd = Vector((s * 0.09, -1, 0)).normalized()
    lat = Vector((-fwd.y, fwd.x, 0)) * s  # outward
    ft, sh = f'foot.{side}', f'shin.{side}'
    # (distance along the foot from the ankle, half width, height of the top, sole z)
    prof = [(-0.065, 0.026, 0.055), (-0.05, 0.036, 0.085), (-0.01, 0.042, 0.10), (0.04, 0.046, 0.075),
            (0.09, 0.044, 0.055), (0.13, 0.034, 0.042), (0.165, 0.018, 0.03), (0.185, 0.004, 0.022)]
    base = Vector((A.x, A.y, 0.0))
    rows = []
    for d, hw, top in prof:
        c = base + fwd * d
        ring = []
        for j in range(10):
            ang = TAU * j / 10
            x = math.cos(ang)
            y = math.sin(ang)
            z = 0.004 + (top - 0.004) * (0.5 + 0.5 * y) if y > -0.7 else 0.004
            ring.append(c + lat * (hw * x) + Vector((0, 0, z)))
        rows.append(ring)

    def w(i, j, p):
        return {ft: 1.0} if p.z < 0.07 else {ft: 0.7, sh: 0.3}

    ids = part.grid(rows, True, lambda i, j: 'leather', w)
    part.fan(ids[0], base + fwd * -0.07 + Vector((0, 0, 0.03)), {ft: 1}, 'leather')
    part.fan(ids[-1], base + fwd * 0.19 + Vector((0, 0, 0.012)), {ft: 1}, 'leather')


# ---------------------------------------------------------------- head, turban, cap

# (z, half width, front depth, back depth, centre y)
HEAD_KEYS = [
    (1.335, 0.050, 0.050, 0.050, 0.012),
    (1.375, 0.048, 0.050, 0.050, 0.014),
    (1.400, 0.050, 0.058, 0.050, 0.010),
    (1.415, 0.056, 0.080, 0.058, 0.004),
    (1.430, 0.063, 0.088, 0.072, 0.000),
    (1.448, 0.067, 0.091, 0.086, -0.002),
    (1.466, 0.071, 0.093, 0.095, -0.003),
    (1.484, 0.074, 0.094, 0.100, -0.004),
    (1.502, 0.0755, 0.094, 0.103, -0.004),
    (1.522, 0.0765, 0.091, 0.104, -0.004),
    (1.545, 0.0745, 0.085, 0.101, -0.004),
    (1.566, 0.069, 0.076, 0.094, -0.004),
    (1.586, 0.058, 0.062, 0.080, -0.004),
    (1.602, 0.040, 0.042, 0.056, -0.004),
    (1.612, 0.020, 0.021, 0.028, -0.004),
]
HEAD_TOP_Z = 1.6165


def bump(x, z, cx, cz, sx, sz):
    return math.exp(-(((x - cx) / sx) ** 2) - ((z - cz) / sz) ** 2)


def face_offset(x, z, theta, young):
    """Forward (-Y) displacement on the face: nose, brow, eyes, lips, chin, cheekbones."""
    front = max(0.0, math.cos(theta))
    if front <= 0:
        return 0.0
    k = 0.85 if young else 1.0
    d = 0.0
    # nose: bridge from the brow down to the tip, then tucked under
    zt = 1.462
    if 1.449 < z < 1.507:
        if z >= zt:
            prot = lerp(0.021, 0.003, (z - zt) / (1.507 - zt))
        else:
            prot = lerp(0.006, 0.021, (z - 1.449) / (zt - 1.449))
        wn = lerp(0.0135, 0.008, clamp((z - zt) / 0.04))
        d += k * prot * math.exp(-((x / wn) ** 2))
    d += 0.0055 * bump(x, z, 0, 1.507, 0.05, 0.006) * (1 - 0.5 * young)  # brow ridge
    for sx in (-1, 1):
        d -= 0.0095 * bump(x, z, sx * 0.031, 1.490, 0.015, 0.009)  # eye sockets
        d += 0.0035 * bump(x, z, sx * 0.050, 1.474, 0.016, 0.014)  # cheekbones
    d += 0.0028 * bump(x, z, 0, 1.441, 0.016, 0.0035)  # upper lip
    d -= 0.0018 * bump(x, z, 0, 1.4335, 0.020, 0.0022)  # mouth line
    d += 0.0022 * bump(x, z, 0, 1.427, 0.014, 0.004)  # lower lip
    d += 0.005 * bump(x, z, 0, 1.414, 0.022, 0.007)  # chin
    return d * front ** 0.5


def head_surface(th, z, young):
    """Point on the bare head (before the per-figure scale) at angle th, height z."""
    hw, fd, bd, cy = interp_keys(HEAD_KEYS, z)
    sx, cz = math.sin(th), -math.cos(th)
    depth = fd if cz < 0 else bd
    x = hw * sx
    p = Vector((x, cy + depth * cz, z))
    p.y -= face_offset(x, z, th, young)
    ear = bump(abs(sx), z, 1.0, 1.485, 0.12, 0.018) * max(0.0, 1 - abs(cz + 0.15) * 3)
    p.x += math.copysign(0.011 * ear, sx)
    return p


HEAD_PIVOT = Vector((0, 0.006, 1.39))


def head_weights(z):
    if z < 1.355:
        return {'chest': 0.4, 'neck': 0.6}
    t = smooth(1.395, 1.44, z)
    return {'neck': 1 - t, 'head': t}


def build_head(part, style):
    young = style['young']
    s = style.get('head_scale', 1.0)
    n = 28
    thetas = warped_thetas(n, 1.55)
    zs = [k[0] for k in HEAD_KEYS]
    # extra rows through the face for the nose and the lips
    zs = sorted(set(zs + [1.4335, 1.4405, 1.4575, 1.4735, 1.493, 1.512]))
    rows = [[HEAD_PIVOT + (head_surface(th, z, young) - HEAD_PIVOT) * s for th in thetas] for z in zs]
    ids = part.grid(rows, True, lambda i, j: 'skin', lambda i, j, p: head_weights(zs[i]))
    apex = HEAD_PIVOT + (Vector((0, -0.004, HEAD_TOP_Z)) - HEAD_PIVOT) * s
    part.fan(ids[-1], apex, {'head': 1.0}, 'skin')
    if style['beard']:
        build_beard(part)
    if style.get('hair'):
        build_hair(part, s)


def build_beard(part):
    """A trimmed full beard as its own shell: it grows out of the face along a smooth line from
    the sideburns down past the mouth, fills out over the jaw and hangs a little below the chin.
    The underside closes back to the throat."""
    cols = [math.radians(a) for a in (-104, -92, -78, -64, -50, -38, -27, -18, -10, -4, 0,
                                      4, 10, 18, 27, 38, 50, 64, 78, 92, 104)]
    nrow = 9

    def z_top(a):
        a = abs(a)
        return (1.426 + 0.027 * smooth(math.radians(8), math.radians(34), a)
                + 0.034 * smooth(math.radians(68), math.radians(104), a))

    def z_bot(a):
        return lerp(1.372, 1.432, smooth(0.0, math.radians(104), abs(a)))

    rows = []
    for i in range(nrow):
        u = i / (nrow - 1)
        row = []
        for a in cols:
            z = lerp(z_top(a), z_bot(a), u)
            edge = smooth(0.0, 0.28, u) * smooth(math.radians(106), math.radians(88), abs(a))
            front = max(0.0, math.cos(a))
            thick = (0.006 + 0.010 * front + 0.010 * front * u) * edge
            zz = max(z, 1.408)  # below the chin the beard hangs from the chin's outline
            base = head_surface(a, zz, False)
            out = Vector((math.sin(a), -math.cos(a) * 1.15, 0)).normalized()
            p = base + out * thick
            if z < zz:
                taper = smooth(1.408, 1.372, z)
                p.z = z
                p.x *= 1 - 0.45 * taper
                p.y = lerp(p.y, base.y + 0.02, 0.25 * taper)
            row.append(p)
        rows.append(row)
    under = []
    for a in cols:
        q = head_surface(a, 1.392, False)
        q.z = z_bot(a) + 0.006
        under.append(q)
    rows.append(under)
    part.grid(rows, False, lambda i, j: 'beard', lambda i, j, p: head_weights(max(p.z, 1.41)))
    # moustache: a soft band over the upper lip, drooping into the beard at the corners
    mcols = [math.radians(a) for a in (-30, -22, -14, -7, 0, 7, 14, 22, 30)]
    mrows = []
    for zf, th in ((0.0, 0.0), (0.5, 1.0), (1.0, 0.0)):
        row = []
        for a in mcols:
            droop = 0.012 * smooth(math.radians(8), math.radians(30), abs(a))
            q = head_surface(a, lerp(1.4505, 1.4415, zf) - droop, False)
            q.y -= 0.0045 * th + 0.0015
            row.append(q)
        mrows.append(row)
    part.grid(mrows, False, lambda i, j: 'beard', lambda i, j, p: {'head': 1.0}, flip=False)


def build_hair(part, scale):
    """Short hair under the cap: a thin shell with a clean hairline from temple to nape."""
    n = 22
    a0 = math.radians(64)
    cols = [a0 + (2 * math.pi - 2 * a0) * j / (n - 1) for j in range(n)]

    def hairline(th):
        a = abs(math.atan2(math.sin(th), math.cos(th)))
        return lerp(1.512, 1.428, smooth(math.radians(64), math.radians(150), a))

    rows = []
    for i in range(5):
        u = i / 4
        row = []
        for th in cols:
            q = head_surface(th, lerp(hairline(th), 1.565, u), True)
            out = Vector((math.sin(th), -math.cos(th), 0)).normalized()
            q += out * (0.0055 * smooth(0.0, 0.3, u))
            row.append(HEAD_PIVOT + (q - HEAD_PIVOT) * scale)
        rows.append(row)
    part.grid(rows, False, lambda i, j: 'hair', lambda i, j, p: {'head': 1.0})


def build_turban(part):
    """A wrapped turban over a cap, with a tail (adhaba) falling behind."""
    pivot_y = -0.006
    n = 28
    thetas = [TAU * j / n for j in range(n)]

    def base_z(th):
        return lerp(1.518, 1.548, 0.5 + 0.5 * math.cos(th))  # front higher than back

    # (height above the base, radial scale over the head) bottom to top
    prof = [(h * 0.85, sc) for h, sc in ((0.0, 1.0), (0.012, 1.10), (0.032, 1.25), (0.055, 1.31),
                                         (0.078, 1.29), (0.098, 1.20), (0.114, 1.02), (0.124, 0.78),
                                         (0.130, 0.45))]
    rows = []
    for i, (h, sc) in enumerate(prof):
        ring = []
        for th in thetas:
            z0 = base_z(th) + h
            hw, fd, bd, cy = interp_keys(HEAD_KEYS, min(base_z(th), 1.55))
            depth = fd if math.cos(th) > 0 else bd
            fold = 0.0
            if 0 < i < len(prof) - 2:
                fold = 0.0055 * math.sin(TAU * h / 0.022 + th * 1.0)  # diagonal wraps
            r_x = hw * sc + 0.002 + fold
            r_y = depth * sc + 0.002 + fold
            ring.append(Vector((r_x * math.sin(th), pivot_y - r_y * math.cos(th), z0)))
        rows.append(ring)
    ids = part.grid(rows, True, lambda i, j: 'turban', lambda i, j, p: {'head': 1.0})
    part.fan(ids[-1], Vector((0, pivot_y + 0.004, 1.548 + 0.116)), {'head': 1.0}, 'turban')
    # tail: a flat strip from the back of the turban down to the shoulder blades
    pts = [Vector((0.018, 0.112, 1.545)), Vector((0.024, 0.122, 1.47)), Vector((0.032, 0.13, 1.40)),
           Vector((0.040, 0.142, 1.33)), Vector((0.046, 0.150, 1.27))]
    half = [0.022, 0.024, 0.026, 0.027, 0.026]
    ws = [{'head': 1}, {'head': 0.7, 'neck': 0.3}, {'neck': 0.6, 'chest': 0.4}, {'chest': 1},
          {'chest': 1}]
    rows = [[p + Vector((-hw, 0, 0)), p + Vector((hw, 0, 0))] for p, hw in zip(pts, half)]
    part.grid(rows, False, lambda i, j: 'turban', lambda i, j, p: ws[i], flip=False)


def build_cap(part, scale):
    """Apprentice's felt cap (qalansuwa, short) with a band."""
    pivot = HEAD_PIVOT
    n = 24
    thetas = [TAU * j / n for j in range(n)]
    prof = [(1.546, 1.05, 'trim'), (1.556, 1.06, 'cap'), (1.570, 1.05, 'cap'), (1.590, 0.97, 'cap'),
            (1.610, 0.82, 'cap'), (1.626, 0.56, 'cap'), (1.636, 0.28, 'cap')]
    rows = []
    for z, sc, _ in prof:
        hw, fd, bd, cy = interp_keys(HEAD_KEYS, min(z, 1.53))
        ring = []
        for th in thetas:
            depth = fd if math.cos(th) > 0 else bd
            zz = z + 0.012 * (0.5 - 0.5 * math.cos(th)) * 0  # level band
            p = Vector(((hw * sc + 0.003) * math.sin(th), cy - (depth * sc + 0.003) * math.cos(th), zz))
            ring.append(pivot + (p - pivot) * scale)
        rows.append(ring)
    ids = part.grid(rows, True, lambda i, j: prof[i][2], lambda i, j, p: {'head': 1.0})
    apex = pivot + (Vector((0, -0.002, 1.640)) - pivot) * scale
    part.fan(ids[-1], apex, {'head': 1.0}, 'cap')


def build_sash(part):
    """Apprentice's sash: a band at the waist (part of the robe trim) and a hanging end."""
    th = math.radians(62)
    top = robe_point(th, 0.975, 0.012)
    out = Vector((math.sin(th), -math.cos(th), 0))
    tang = Vector((math.cos(th), math.sin(th), 0))
    pts = [top + out * 0.004, top + out * 0.016 + Vector((0, 0, -0.10)),
           top + out * 0.022 + Vector((0, 0, -0.21))]
    half = [0.026, 0.024, 0.022]
    rows = [[p - tang * h, p + tang * h] for p, h in zip(pts, half)]
    rows[0] = [p + Vector((0, 0, 0.02)) for p in rows[0]]
    rows.insert(0, [p + Vector((0, 0, 0.012)) for p in rows[0]])

    def w(i, j, p):
        return robe_weights(th, Vector((p.x, p.y, min(p.z, 0.96)))) if p.z < 0.96 else {'hips': 1.0}

    part.grid(rows, False, lambda i, j: 'trim', w, flip=False)


# ---------------------------------------------------------------- figure assembly

SCHOLAR = {
    'robe': {'robe_mat': 'robe', 'hem_z': 0.055, 'hem_band': 0.05,
             'trim_rows': {(1.355, 1.40)}},
    'sleeve': {'mat': 'cloak', 'past_wrist': 0.03, 'trim_u': [(0.32, 0.52)], 'cuff': False,
               'radii': [0.056, 0.060, 0.062, 0.061, 0.060, 0.060, 0.066, 0.074, 0.083, 0.092, 0.096],
               'droop': [0, 0, 0, 0, 0, 0.002, 0.008, 0.016, 0.024, 0.030, 0.032]},
    'head': {'young': False, 'beard': True, 'hair': False},
    'legs_mat': 'cloak',  # dark sirwal: where the drape parts it reads as shadow
}
APPRENTICE = {
    'robe': {'robe_mat': 'robe_apprentice', 'hem_z': 0.25, 'hem_band': 0.035,
             'trim_rows': {(0.94, 1.0), (1.36, 1.40)}},
    'sleeve': {'mat': 'robe_apprentice', 'past_wrist': 0.0, 'trim_u': [], 'cuff': True,
               'radii': [0.054, 0.056, 0.055, 0.053, 0.051, 0.050, 0.049, 0.048, 0.047, 0.047, 0.050],
               'droop': [0] * 11},
    'head': {'young': True, 'beard': False, 'hair': True, 'head_scale': 1.05},
    'legs_mat': 'robe_apprentice',
}


def build_body(kind):
    st = SCHOLAR if kind == 'scholar' else APPRENTICE
    part = Part()
    build_robe(part, st['robe'])
    if kind == 'scholar':
        build_cloak(part)
    for side in rig.SIDES:
        build_sleeve(part, side, st['sleeve'])
        build_hand(part, side)
    build_legs(part, st)
    build_head(part, st['head'])
    if kind == 'scholar':
        build_turban(part)
    else:
        build_cap(part, st['head']['head_scale'])
        build_sash(part)
    return part


def part_to_object(part, name, materials, arm_ob):
    """Mesh object skinned to arm_ob. materials: name -> bpy material."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in part.V], [], part.F)
    order = []
    for m in part.M:
        if m not in order:
            order.append(m)
    for m in order:
        me.materials.append(materials[m])
    idx = {m: i for i, m in enumerate(order)}
    me.polygons.foreach_set('material_index', [idx[m] for m in part.M])
    me.update()
    me.validate()
    me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = arm_ob
    groups = {}
    for i, w in enumerate(part.W):
        for b, v in w.items():
            groups.setdefault(b, []).append((i, v))
    for b, items in groups.items():
        vg = ob.vertex_groups.new(name=b)
        for i, v in items:
            vg.add([i], v, 'REPLACE')
    mod = ob.modifiers.new('skin', 'ARMATURE')
    mod.object = arm_ob
    return ob
