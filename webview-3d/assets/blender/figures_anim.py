# Clip authoring for the figurines: poses in armature space, solved to bone transforms.
#
# A Pose is a dict of named 3-vectors:
#   p_*  positions (hips, wrists, ankles), armature space
#   r_*  rotation vectors (axis * angle): hips absolute; spine/chest/neck/head/shoulders relative
#        to the parent, in the figure's axes (X left, -Y forward, Z up); feet absolute
#   d_*  directions: hand (wrist -> fingers), palm normal, elbow and knee pole hints
#   s_*  scalars in [0]: prop part motion (codex page, astrolabe rete)
# Arms and legs are two-bone IK, so contacts (pen on paper, feet on the floor) are exact.
# The robe hangs from cloth chains placed by a small position-based drape solver.
import math

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

import figures_geo as geo
import figures_rig as rig

FPS = 30
CUSHION_H = 0.15
CUSHION_HALF = 0.34
DESK_H = 0.45
DESK_NEAR = 0.30  # desk near edge, metres in front of the root (glTF +Z)
SEAT_HIPS = Vector((0, 0.035, 0.252))

# Walk: in place. The stance foot moves back at exactly WALK_SPEED, so a root moving forward
# at WALK_SPEED leaves it planted.
WALK_CYCLE = 0.9
WALK_DUTY = 0.6
WALK_SPEED = 0.8
WALK_EXCURSION = WALK_SPEED * WALK_DUTY * WALK_CYCLE / 2  # 0.216 m either side of the hip

SIDES = rig.SIDES


def V(*a):
    return np.array(a if len(a) == 3 else a[0], dtype=float)


def e(pitch=0.0, yaw=0.0, roll=0.0):
    """Rotation vector from figure-axis angles in degrees: pitch forward, yaw left, roll left."""
    q = (Quaternion((0, 0, 1), math.radians(yaw)) @ Quaternion((1, 0, 0), math.radians(pitch))
         @ Quaternion((0, 1, 0), math.radians(roll)))
    return q2rv(q)


def q2rv(q):
    q = q.normalized()
    if q.w < 0:
        q = -q
    ang = 2 * math.acos(max(-1.0, min(1.0, q.w)))
    s = math.sqrt(max(0.0, 1 - q.w * q.w))
    if s < 1e-8:
        return np.zeros(3)
    return np.array([q.x / s, q.y / s, q.z / s]) * ang


def rv2q(rv):
    ang = float(np.linalg.norm(rv))
    if ang < 1e-9:
        return Quaternion()
    return Quaternion(Vector(rv / ang), ang)


def unit(v):
    v = np.asarray(v, float)
    return v / (np.linalg.norm(v) or 1.0)


# ---------------------------------------------------------------- base poses


def standing():
    p = {
        'p_hips': V(0, 0.004, 0.912),
        'r_hips': e(),
        'r_spine': e(-2), 'r_chest': e(3), 'r_neck': e(4), 'r_head': e(-4),
        'r_shoulder.L': e(), 'r_shoulder.R': e(),
        # hands clasped in front at the waist, right over left, inside the sleeves
        'p_wrist.L': V(0.058, -0.168, 0.985), 'd_hand.L': V(-0.86, -0.2, -0.45),
        'd_palm.L': V(-0.1, 0.65, -0.75), 'd_elbow.L': V(1, 0.55, -0.25),
        'p_wrist.R': V(-0.062, -0.188, 0.99), 'd_hand.R': V(0.86, -0.18, -0.40),
        'd_palm.R': V(0.1, 0.7, -0.7), 'd_elbow.R': V(-1, 0.55, -0.25),
        's_page': V(0, 0, 0), 's_rete': V(0, 0, 0), 's_ground': V(0, 0, 0),
        's_tieR': V(0, 0, 0), 's_tieL': V(0, 0, 0),
    }
    for side in SIDES:
        s = rig.SIGN[side]
        _, _, A, _ = rig.leg_rest(side)
        p[f'p_ankle.{side}'] = V(s * 0.102, 0.012, rig.ANKLE_Z)
        p[f'r_foot.{side}'] = e(yaw=s * 7)
        p[f'd_knee.{side}'] = V(s * 0.12, -1, 0)
    return p


def seated():
    p = standing()
    p.update({
        'p_hips': V(SEAT_HIPS),
        'r_hips': e(-7), 'r_spine': e(7), 'r_chest': e(4), 'r_neck': e(5), 'r_head': e(-2),
        # hands resting in the lap, palms up, right over left
        'p_wrist.L': V(0.105, -0.205, 0.315), 'd_hand.L': V(-0.72, -0.55, -0.05),
        'd_palm.L': V(0.1, 0.05, 1), 'd_elbow.L': V(1, 0.6, -0.4),
        'p_wrist.R': V(-0.10, -0.225, 0.33), 'd_hand.R': V(0.7, -0.6, -0.05),
        'd_palm.R': V(-0.1, 0.05, 1), 'd_elbow.R': V(-1, 0.6, -0.4),
        # legs crossed: the left shin in front, the feet tucked under the opposite knees
        'p_ankle.L': V(-0.005, -0.335, 0.197), 'd_knee.L': V(1, -0.12, -0.05),
        'r_foot.L': e(pitch=-35, yaw=-95, roll=-50),
        'p_ankle.R': V(0.03, -0.262, 0.186), 'd_knee.R': V(-1, -0.12, -0.05),
        'r_foot.R': e(pitch=-35, yaw=95, roll=50),
        's_ground': V(1, 0, 0),
    })
    return p


def merged(base, **kw):
    p = {k: np.array(v, float) for k, v in base.items()}
    for k, v in kw.items():
        p[k.replace('__', '.')] = np.array(v, float)
    return p


# ---------------------------------------------------------------- interpolation


class Keys:
    """Pose keys with Catmull-Rom interpolation; 'hold' keys stop (ease in and out)."""

    def __init__(self, keys, loop):
        self.keys = keys  # [(t, pose, hold)]
        self.loop = loop
        self.names = list(keys[0][1].keys())
        self.duration = keys[-1][0]

    def vec(self, i):
        n = len(self.keys)
        if self.loop:
            # last key duplicates the first; wrap over the n - 1 distinct keys
            m = n - 1
            j = i % m
            off = (i // m) * self.duration
            t, p, h = self.keys[j]
            return t + off, p, h
        i = max(0, min(n - 1, i))
        return self.keys[i]

    def __call__(self, t):
        ks = self.keys
        if self.loop:
            t = t % self.duration
        t = max(ks[0][0], min(ks[-1][0], t))
        i = 0
        while i < len(ks) - 2 and t > ks[i + 1][0]:
            i += 1
        t0, p0, h0 = self.vec(i)
        t1, p1, h1 = self.vec(i + 1)
        tm, pm, _ = self.vec(i - 1) if (self.loop or i > 0) else (t0 - 1, p0, True)
        tp, pp, _ = self.vec(i + 2) if (self.loop or i + 2 < len(ks)) else (t1 + 1, p1, True)
        dt = t1 - t0
        u = (t - t0) / dt if dt > 0 else 0.0
        out = {}
        for k in self.names:
            a, b = p0[k], p1[k]
            m0 = np.zeros(3) if h0 else (b - pm[k]) / (t1 - tm) * dt
            m1 = np.zeros(3) if h1 else (pp[k] - a) / (tp - t0) * dt
            u2, u3 = u * u, u * u * u
            out[k] = ((2 * u3 - 3 * u2 + 1) * a + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * b
                      + (u3 - u2) * m1)
        return out


def add(p, **kw):
    for k, v in kw.items():
        k = k.replace('__', '.')
        p[k] = p[k] + np.asarray(v, float)
    return p


def ease(x):
    x = min(1.0, max(0.0, x))
    return x * x * x * (x * (x * 6 - 15) + 10)


def wave(t, period, phase=0.0):
    return math.sin(2 * math.pi * (t / period + phase))


# ---------------------------------------------------------------- solving a pose


def frame3(d, n):
    d = d.normalized()
    n = (n - d * n.dot(d)).normalized()
    return Matrix((d, n, d.cross(n))).transposed()


class Solver:
    def __init__(self, rest):
        self.rest = rest
        self.limb = {}
        for side in SIDES:
            for up, lo, end in ((f'upper_arm.{side}', f'forearm.{side}', f'hand.{side}'),
                                (f'thigh.{side}', f'shin.{side}', f'foot.{side}')):
                S, E, W = rest[up]['head'], rest[lo]['head'], rest[end]['head']
                ur, fr = (E - S).normalized(), (W - E).normalized()
                self.limb[up] = dict(a=(E - S).length, b=(W - E).length, ur=ur, fr=fr,
                                     nr=ur.cross(fr).normalized())
            W0, a0, n0, _ = geo.hand_rest_frame(side)
            self.limb[f'hand.{side}'] = frame3(a0, n0)
            ft = rest[f'foot.{side}']
            self.limb[f'foot.{side}'] = None

    def child_head(self, Q, H, parent, bone):
        r = self.rest
        return H[parent] + Q[parent] @ (r[bone]['head'] - r[parent]['head'])

    def two_bone(self, up, S, T, pole):
        L = self.limb[up]
        a, b = L['a'], L['b']
        dv = T - S
        d = max(abs(a - b) + 1e-4, min(a + b - 1e-4, dv.length))
        u = dv.normalized()
        pv = pole - u * pole.dot(u)
        if pv.length < 1e-6:
            pv = L['nr'].cross(u)
        v = pv.normalized()
        ca = (a * a + d * d - b * b) / (2 * a * d)
        sa = math.sqrt(max(0.0, 1 - ca * ca))
        E = S + (u * ca + v * sa) * a
        Tc = S + u * d
        up_d = (E - S).normalized()
        fo_d = (Tc - E).normalized()
        n = up_d.cross(fo_d)
        n = n.normalized() if n.length > 1e-6 else u.cross(v).normalized()
        Fr_u = Matrix((L['ur'], L['nr'].cross(L['ur']), L['nr'])).transposed()
        Fr_f = Matrix((L['fr'], L['nr'].cross(L['fr']), L['nr'])).transposed()
        Fu = Matrix((up_d, n.cross(up_d), n)).transposed()
        Ff = Matrix((fo_d, n.cross(fo_d), n)).transposed()
        return (Fu @ Fr_u.transposed()).to_quaternion(), (Ff @ Fr_f.transposed()).to_quaternion(), E, Tc

    def solve(self, P):
        """Pose -> {bone: (Q armature-space rotation applied to rest, head position)}."""
        r = self.rest
        Q, H = {'root': Quaternion()}, {'root': r['root']['head'].copy()}
        Q['hips'] = rv2q(P['r_hips'])
        H['hips'] = Vector(P['p_hips'])
        for b in ('spine', 'chest', 'neck', 'head'):
            p = r[b]['parent']
            Q[b] = Q[p] @ rv2q(P[f'r_{b}'])
            H[b] = self.child_head(Q, H, p, b)
        hand_frames = {}
        for side in SIDES:
            sh = f'shoulder.{side}'
            Q[sh] = Q['chest'] @ rv2q(P[f'r_{sh}'])
            H[sh] = self.child_head(Q, H, 'chest', sh)
            ua, fa, ha = f'upper_arm.{side}', f'forearm.{side}', f'hand.{side}'
            S = self.child_head(Q, H, sh, ua)
            T = Vector(P[f'p_wrist.{side}'])
            qu, qf, E, Tc = self.two_bone(ua, S, T, Vector(P[f'd_elbow.{side}']))
            Q[ua], H[ua], Q[fa], H[fa] = qu, S, qf, E
            Fh = frame3(Vector(P[f'd_hand.{side}']), Vector(P[f'd_palm.{side}']))
            Q[ha] = (Fh @ self.limb[ha].transposed()).to_quaternion()
            H[ha] = Tc
            hand_frames[side] = (Fh, Tc)
        for side in SIDES:
            th, sn, ft = f'thigh.{side}', f'shin.{side}', f'foot.{side}'
            Hj = self.child_head(Q, H, 'hips', th)
            T = Vector(P[f'p_ankle.{side}'])
            qt, qs, K, Tc = self.two_bone(th, Hj, T, Vector(P[f'd_knee.{side}']))
            Q[th], H[th], Q[sn], H[sn] = qt, Hj, qs, K
            Q[ft] = rv2q(P[f'r_foot.{side}'])
            H[ft] = Tc
        return Q, H

    def world_matrix(self, Q, H, b):
        M = (Q[b].to_matrix() @ self.rest[b]['R']).to_4x4()
        M.translation = H[b]
        return M

    def joint(self, Q, H, b, frac):
        """Point at fraction frac along bone b (0 head, 1 tail) in the solved pose."""
        r = self.rest[b]
        return H[b] + Q[b] @ ((r['tail'] - r['head']) * frac)


# ---------------------------------------------------------------- the drape solver


class Drape:
    """Position-based cloth chains. Per chain, a knee point J and a hem point K hang from the
    waist point W (rigid on the hips). Each frame the chain is pulled towards a target shape:
    the A-line rest shape carried by the hips, or, where that would pass below the floor or the
    cushion, a path that hangs to the ground and then lies outward, bunching up. Constraints keep
    the cloth clear of the legs (over them when they are horizontal, as when sitting cross-legged)
    and the pelvis, never stretched, above the ground and smooth around the ring. Verlet inertia
    with a soft target pull gives the robe its sway."""

    N = rig.SKIRT_N
    BUNCH = 0.5  # cloth lying on the ground takes up this fraction of its length
    SPREAD = 0.50  # hem radius limit around the hips axis

    def __init__(self, solver):
        self.s = solver
        r = solver.rest
        self.Wr, self.Jr, self.Kr = [], [], []
        for k in range(self.N):
            up, lo = rig.skirt_names(k)
            self.Wr.append(r[up]['head'].copy())
            self.Jr.append(r[lo]['head'].copy())
            self.Kr.append(r[lo]['tail'].copy())
        self.L1 = [(j - w).length for w, j in zip(self.Wr, self.Jr)]
        self.L2 = [(k - j).length for j, k in zip(self.Jr, self.Kr)]
        self.hips_rest = r['hips']['head'].copy()
        self.J = self.Jp = self.K = self.Kp = None

    def ground(self, p, g):
        if g <= 0:
            return 0.0
        inside = abs(p.x) < CUSHION_HALF and abs(p.y) < CUSHION_HALF
        return CUSHION_H * g if inside else 0.0

    def lie_path(self, W, offs, out, g, lift):
        """Follow the rest offsets from W; below the ground, continue outward along `out`,
        bunched. Returns the end point of each offset."""
        pts, p, on_ground = [], W.copy(), False
        for v in offs:
            L = v.length
            if not on_ground:
                q = p + v
                gz = self.ground(q, g) + lift
                if q.z >= gz:
                    pts.append(q)
                    p = q
                    continue
                f = (p.z - gz) / max(p.z - q.z, 1e-6)
                f = max(0.0, min(1.0, f))
                p = p + v * f
                p.z = max(p.z, gz)
                L *= (1 - f)
                on_ground = True
            p = p + out * (L * self.BUNCH)
            p.z = self.ground(p, g) + lift
            pts.append(p.copy())
        return pts

    def targets(self, Q, H, g):
        q, h = Q['hips'], H['hips']
        W, Jt, Kt = [], [], []
        for i in range(self.N):
            w = h + q @ (self.Wr[i] - self.hips_rest)
            out = Vector((w.x - h.x, w.y - h.y, 0))
            out = out.normalized() if out.length > 1e-6 else Vector((0, -1, 0))
            j, k = self.lie_path(w, [q @ (self.Jr[i] - self.Wr[i]), q @ (self.Kr[i] - self.Jr[i])],
                                 out, g, 0.012)
            W.append(w)
            Jt.append(j)
            Kt.append(k)
        return W, Jt, Kt

    def reset(self, Q, H, g=0.0):
        W, Jt, Kt = self.targets(Q, H, g)
        self.J, self.K = [v.copy() for v in Jt], [v.copy() for v in Kt]
        self.Jp, self.Kp = [v.copy() for v in self.J], [v.copy() for v in self.K]

    def colliders(self, Q, H):
        s = self.s
        caps = []
        for side in SIDES:
            hip = s.joint(Q, H, f'thigh.{side}', 0)
            knee = s.joint(Q, H, f'shin.{side}', 0)
            ank = s.joint(Q, H, f'foot.{side}', 0)
            toe = s.joint(Q, H, f'foot.{side}', 1.25)
            caps += [(hip, knee, 0.066, 0.056), (knee, ank, 0.054, 0.042), (ank, toe, 0.044, 0.036)]
        pel = H['hips'] + Q['hips'] @ Vector((0, 0.012, -0.04))
        caps.append((pel, pel + Q['hips'] @ Vector((0, 0, 0.11)), 0.128, 0.128))
        return caps

    @staticmethod
    def push_out(p, caps, margin=0.014, out=None):
        """Move p out of the capsules. Cloth stays on its own side: outward (`out`, the chain's
        radial direction) of a standing leg, and over the top of a lying one."""
        for a, b, ra, rb in caps:
            ab = b - a
            t = 0.0 if ab.length_squared < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            c = a + ab * t
            d = p - c
            r = ra + (rb - ra) * t + margin
            if d.length < r:
                n = d.normalized() if d.length > 1e-6 else Vector((0, 0, 1))
                if ab.length > 1e-6 and abs(ab.normalized().z) < 0.6:
                    if n.z < 0.35:  # a lying limb: cloth comes from above, so it goes over
                        n = Vector((n.x, n.y, abs(n.z) + 0.35)).normalized()
                elif out is not None and n.dot(out) < 0.2:
                    n = (n - out * (n.dot(out) - 0.2) * 1.0)
                    n = Vector((n.x, n.y, n.z * 0.5)).normalized()
                p = c + n * r
        return p

    def step(self, Q, H, g, dt=1 / FPS, iters=6, pull=0.14):
        W, Jt, Kt = self.targets(Q, H, g)
        caps = self.colliders(Q, H)
        n = self.N
        for arr, prev in ((self.J, self.Jp), (self.K, self.Kp)):
            for i in range(n):
                v = (arr[i] - prev[i]) * 0.80
                prev[i] = arr[i].copy()
                arr[i] = arr[i] + v
        c = H['hips']
        outs = []
        for i in range(n):
            o = Vector((W[i].x - c.x, W[i].y - c.y, 0))
            outs.append(o.normalized() if o.length > 1e-6 else Vector((0, -1, 0)))
        for _ in range(iters):
            for arr, tgt in ((self.J, Jt), (self.K, Kt)):
                dev = [arr[i] - tgt[i] for i in range(n)]
                for i in range(n):
                    avg = (dev[(i - 1) % n] + dev[(i + 1) % n]) * 0.5
                    d = dev[i].lerp(avg, 0.22) * (1 - pull)
                    arr[i] = tgt[i] + d
            for i in range(n):
                J, K = self.J[i], self.K[i]
                o = outs[i]
                J = self.push_out(J, caps, out=o)
                for f in (0.35, 0.7):  # keep the upper panel itself out of the legs
                    m = W[i].lerp(J, f)
                    m2 = self.push_out(m, caps, out=o)
                    if (m2 - m).length > 1e-6:
                        J = J + (m2 - m) / f
                d = J - W[i]
                if d.length > self.L1[i] * 1.04:
                    J = W[i] + d * (self.L1[i] * 1.04 / d.length)
                K = self.push_out(K, caps, 0.012, out=o)
                m = J.lerp(K, 0.5)
                m2 = self.push_out(m, caps, out=o)
                if (m2 - m).length > 1e-6:
                    J, K = J + (m2 - m) * 0.6, K + (m2 - m) * 1.4
                d = K - J
                if d.length > self.L2[i] * 1.04:
                    K = J + d * (self.L2[i] * 1.04 / d.length)
                for P, lift in ((J, 0.012), (K, 0.008)):
                    gz = self.ground(P, g) + lift
                    if P.z < gz:
                        P.z = gz
                off = Vector((K.x - c.x, K.y - c.y, 0))
                if off.length > self.SPREAD:
                    K.x, K.y = c.x + off.x * self.SPREAD / off.length, c.y + off.y * self.SPREAD / off.length
                self.J[i], self.K[i] = J, K
            # panels between chains: push both neighbours when the midpoint is inside a leg
            for arr, base in ((self.J, W), (self.K, self.J)):
                for i in range(n):
                    i2 = (i + 1) % n
                    m = (arr[i] + arr[i2]) * 0.5
                    m2 = self.push_out(m, caps, out=(outs[i] + outs[i2]).normalized())
                    if (m2 - m).length > 1e-6:
                        arr[i] = arr[i] + (m2 - m)
                        arr[i2] = arr[i2] + (m2 - m)
        for i in range(n):
            for P, prev, lift in ((self.J[i], self.Jp[i], 0.012), (self.K[i], self.Kp[i], 0.008)):
                if P.z <= self.ground(P, g) + lift + 1e-4:  # friction on contact
                    prev.x = lerp(prev.x, P.x, 0.7)
                    prev.y = lerp(prev.y, P.y, 0.7)
        return W

    def bones(self, Q, H, W):
        """Cloth chain bone transforms {bone: (Q, head, stretch)} from the current state."""
        out = {}
        hq = Q['hips']
        for i in range(self.N):
            up, lo = rig.skirt_names(i)
            for b, a, z, L in ((up, W[i], self.J[i], self.L1[i]), (lo, self.J[i], self.K[i], self.L2[i])):
                rest_dir = self.s.rest[b]['tail'] - self.s.rest[b]['head']
                carried = hq @ rest_dir.normalized()
                d = z - a
                if d.length < 1e-5:
                    d = carried * 1e-5
                swing = carried.rotation_difference(d.normalized())
                out[b] = (swing @ hq, a.copy(), max(d.length / L, 0.2))
        return out


def lerp(a, b, t):
    return a + (b - a) * t


# ---------------------------------------------------------------- clips


def clip_idle(t):
    p = standing()
    br = wave(t, 4.0)
    add(p, r_chest=e(0.9 * br), r_spine=e(-0.3 * br), r_neck=e(-0.4 * br),
        p_hips=V(0.007 * wave(t, 4.0, 0.25), 0, 0.0015 * br),
        r_hips=e(roll=-0.8 * wave(t, 4.0, 0.25)),
        r_head=e(pitch=1.0 * wave(t, 4.0, 0.6), yaw=3.5 * wave(t, 4.0, 0.15), roll=0.8 * wave(t, 4.0, 0.4)))
    add(p, **{'r_shoulder.L': e(roll=0.6 * br), 'r_shoulder.R': e(roll=-0.6 * br)})
    lift = V(0, 0, 0.003 * br)
    add(p, **{'p_wrist.L': lift, 'p_wrist.R': lift})
    return p


def foot_track(fp, side):
    """Ankle position and foot rotation for foot phase fp (0 = heel strike), in place."""
    s = rig.SIGN[side]
    E = WALK_EXCURSION
    x = s * 0.092
    heel_back, ball_fwd = 0.055, 0.125  # contact points relative to the ankle (y)
    toe_up, heel_up = math.radians(12), math.radians(32)
    toe_out = e(yaw=s * 6)

    def ref(f):
        return -E + 2 * E * f / WALK_DUTY

    def stance(f):
        yr = ref(f)
        if f < 0.08:  # heel strike: pivot on the heel, toes come down
            a = toe_up * (1 - ease(f / 0.08))
            piv = Vector((x, yr + heel_back, 0))
            rot = Quaternion((1, 0, 0), -a)
            ank = piv + rot @ Vector((0, -heel_back, rig.ANKLE_Z))
        elif f < 0.38:
            a = 0.0
            rot = Quaternion()
            ank = Vector((x, yr, rig.ANKLE_Z))
        else:  # heel off: pivot on the ball of the foot
            a = heel_up * ease((f - 0.38) / (WALK_DUTY - 0.38))
            piv = Vector((x, yr - ball_fwd, 0))
            rot = Quaternion((1, 0, 0), a)
            ank = piv + rot @ Vector((0, ball_fwd, rig.ANKLE_Z))
        return ank, rot

    if fp < WALK_DUTY:
        ank, rot = stance(fp)
    else:
        u = (fp - WALK_DUTY) / (1 - WALK_DUTY)
        a0, r0 = stance(WALK_DUTY - 1e-6)
        a1, r1 = stance(0.0)
        k = ease(u)
        ank = a0.lerp(a1, k)
        ank.z += 0.075 * math.sin(math.pi * min(1.0, u * 1.08)) ** 1.2
        ank.x += -s * 0.012 * math.sin(math.pi * u)
        rot = r0.slerp(r1, ease(min(1.0, u * 1.25)))
    return V(ank), q2rv(rv2q(toe_out) @ rot)


def clip_walk(t):
    ph = (t / WALK_CYCLE) % 1.0
    p = standing()
    c2 = math.cos(4 * math.pi * (ph - 0.3))
    p['p_hips'] = V(0.011 * math.cos(2 * math.pi * (ph - 0.3)), 0.0, 0.897 + 0.010 * c2)
    p['r_hips'] = e(pitch=2, yaw=-4 * math.cos(2 * math.pi * ph),
                    roll=-1.6 * math.cos(2 * math.pi * (ph - 0.3)))
    p['r_spine'] = e(pitch=0, yaw=2.4 * math.cos(2 * math.pi * ph), roll=1.0 * math.cos(2 * math.pi * (ph - 0.3)))
    p['r_chest'] = e(pitch=2 - 0.6 * c2, yaw=2.2 * math.cos(2 * math.pi * ph), roll=0.4 * math.cos(2 * math.pi * (ph - 0.3)))
    p['r_head'] = e(pitch=-3 + 0.8 * c2, yaw=-0.8 * math.cos(2 * math.pi * ph))
    for side, off in (('L', 0.0), ('R', 0.5)):
        ank, rf = foot_track((ph + off) % 1.0, side)
        p[f'p_ankle.{side}'] = ank
        p[f'r_foot.{side}'] = rf
        p[f'd_knee.{side}'] = V(rig.SIGN[side] * 0.1, -1, 0.1)
    bob = V(0.0, 0.0, 0.010 * c2 - 0.014)
    sway = V(0.009 * math.cos(2 * math.pi * (ph - 0.3)), -0.004 * math.cos(2 * math.pi * ph), 0)
    for side in SIDES:
        p[f'p_wrist.{side}'] = p[f'p_wrist.{side}'] + bob + sway + V(0, -0.012, 0)
    return p


# Seated work poses ------------------------------------------------------------


def lean(p, hips=0.0, spine=0.0, chest=0.0, neck=0.0, head=0.0, yaw=0.0):
    add(p, r_hips=e(hips), r_spine=e(spine, yaw * 0.3), r_chest=e(chest, yaw * 0.4),
        r_neck=e(neck, yaw * 0.15), r_head=e(head, yaw * 0.15))
    return p


def breathe(p, t, period=4.0, amp=1.0):
    br = wave(t, period)
    add(p, r_chest=e(0.8 * amp * br), r_neck=e(-0.4 * amp * br))
    return p


def clip_sit_idle(t):
    p = seated()
    breathe(p, t, 6.0 / 2)
    look = Keys([
        (0.0, {'h': e(0, 0, 0)}, True),
        (1.6, {'h': e(9, 6, 2)}, True),
        (3.4, {'h': e(-3, -10, -1)}, True),
        (5.0, {'h': e(2, 4, 0)}, False),
        (6.0, {'h': e(0, 0, 0)}, True),
    ], loop=True)(t)['h']
    add(p, r_head=look, r_neck=look * 0.4)
    add(p, **{'p_wrist.R': V(0.004 * wave(t, 3.0), 0, 0.003 * wave(t, 3.0, 0.2))})
    return p


def write_base():
    p = seated()
    lean(p, hips=6, spine=8, chest=6, neck=8, head=14)
    p.update({
        'p_wrist.L': V(0.165, -0.355, 0.478), 'd_hand.L': V(-0.35, -0.93, -0.12),
        'd_palm.L': V(0.0, -0.1, -1), 'd_elbow.L': V(1, 0.4, -0.5),
        'p_wrist.R': V(-0.10, -0.335, 0.512), 'd_hand.R': V(0.32, -0.80, -0.50),
        'd_palm.R': V(0.45, 0.1, -0.88), 'd_elbow.R': V(-1, 0.6, -0.3),
    })
    return p


def clip_write(t):
    """Two lines of naskh, right to left, then a dip in the inkwell. 4 s."""
    p = write_base()
    x0, x1 = -0.115, 0.055  # line start (writer's right) and end (writer's left)
    line_y = [-0.335, -0.322]
    ink = V(-0.24, -0.33, 0.53)

    def on_line(u, y):
        x = lerp(x0, x1, u)
        # small letter loops and lifts between words
        return V(x + 0.004 * math.sin(u * 2 * math.pi * 9), y + 0.005 * math.sin(u * 2 * math.pi * 11),
                 0.512 + 0.004 * max(0.0, math.sin(u * 2 * math.pi * 4.5)) ** 2)

    if t < 1.45:
        w = on_line(ease(t / 1.45) * 0.2 + t / 1.45 * 0.8, line_y[0])
    elif t < 1.85:
        u = ease((t - 1.45) / 0.4)
        w = on_line(1.0, line_y[0]) * (1 - u) + on_line(0.0, line_y[1]) * u + V(0, 0, 0.03 * math.sin(math.pi * u))
    elif t < 3.3:
        u = (t - 1.85) / 1.45
        w = on_line(ease(u) * 0.2 + u * 0.8, line_y[1])
    else:  # to the inkwell and back to the start of the first line
        u = (t - 3.3) / 0.7
        a = on_line(1.0, line_y[1])
        b = on_line(0.0, line_y[0])
        if u < 0.5:
            k = ease(u / 0.5)
            w = a * (1 - k) + ink * k + V(0, 0, 0.04 * math.sin(math.pi * k))
        else:
            k = ease((u - 0.5) / 0.5)
            w = ink * (1 - k) + b * k + V(0, 0, 0.03 * math.sin(math.pi * k))
    p['p_wrist.R'] = w
    # the eyes and head follow the pen
    gaze = (w[0] - (x0 + x1) / 2) / (x1 - x0)
    add(p, r_head=e(0, 6 * gaze, 0), r_neck=e(0, 3 * gaze, 0), r_chest=e(0, 2 * gaze, 0))
    breathe(p, t, 4.0, 0.5)
    return p


def read_base():
    p = seated()
    lean(p, hips=3, spine=5, chest=3, neck=8, head=16)
    p.update({
        'p_wrist.L': V(0.09, -0.31, 0.535), 'd_hand.L': V(-0.45, -0.85, 0.22),
        'd_palm.L': V(0.0, 0.40, 0.92), 'd_elbow.L': V(1, 0.3, -0.6),
        'p_wrist.R': V(-0.12, -0.31, 0.585), 'd_hand.R': V(0.5, -0.75, -0.25),
        'd_palm.R': V(0.2, -0.3, -0.95), 'd_elbow.R': V(-1, 0.5, -0.5),
    })
    return p


def clip_read(t):
    """Reading a codex held in the left hand; the right hand turns a page (Arabic: the left-hand
    page goes over to the right) at 2.9-3.9 s. 5 s."""
    p = read_base()
    rest_R = p['p_wrist.R'].copy()
    corner = V(0.075, -0.36, 0.60)  # far corner of the left-hand page
    over = V(-0.03, -0.32, 0.70)
    land = V(-0.13, -0.35, 0.60)
    if 2.4 <= t < 4.6:
        u = (t - 2.4) / 2.2
        k = Keys([(0.0, {'w': rest_R}, True), (0.25, {'w': corner}, True), (0.5, {'w': over}, False),
                  (0.72, {'w': land}, True), (1.0, {'w': rest_R}, True)], loop=False)(u)['w']
        p['p_wrist.R'] = k
        p['s_page'] = V(ease((u - 0.25) / 0.47), 0, 0)
        add(p, r_head=e(0, -4 * math.sin(math.pi * u), 0))
    elif t >= 4.6:
        p['s_page'] = V(1, 0, 0)
    # scanning lines right to left
    scan = (t % 1.2) / 1.2
    add(p, r_head=e(1.5 * (t / 5.0), 5 * (0.5 - scan) * 0.9, 0))
    breathe(p, t, 5.0)
    return p


def astro_raised():
    p = seated()
    lean(p, hips=-2, spine=-2, chest=-3, neck=-6, head=-8)
    p.update({
        'p_wrist.L': V(0.25, -0.47, 0.88), 'd_hand.L': V(-0.91, -0.38, 0.0),
        'd_palm.L': V(-0.38, 0.91, -0.18), 'd_elbow.L': V(1, 0.2, -0.8),
        'p_wrist.R': V(0.0, -0.41, 0.70), 'd_hand.R': V(0.8, -0.5, 0.3),
        'd_palm.R': V(0.38, -0.91, 0.18), 'd_elbow.R': V(-1, 0.3, -0.7),
    })
    return p


def astro_lowered():
    p = seated()
    lean(p, hips=3, spine=5, chest=4, neck=8, head=16)
    p.update({
        'p_wrist.L': V(0.21, -0.40, 0.72), 'd_hand.L': V(-0.91, -0.38, 0.0),
        'd_palm.L': V(-0.38, 0.91, -0.18), 'd_elbow.L': V(1, 0.3, -0.7),
        'p_wrist.R': V(0.04, -0.40, 0.55), 'd_hand.R': V(0.7, -0.6, 0.35),
        'd_palm.R': V(0.38, -0.91, 0.18), 'd_elbow.R': V(-1, 0.4, -0.6),
    })
    return p


def clip_astrolabe(t):
    """Sight the sun with the astrolabe held by its ring, lower it, turn the rete. 6 s."""
    k = Keys([(0.0, astro_raised(), True), (1.5, astro_raised(), True), (2.4, astro_lowered(), True),
              (4.7, astro_lowered(), True), (6.0, astro_raised(), True)], loop=True)
    p = k(t)
    if 2.5 <= t < 4.6:
        u = (t - 2.5) / 2.1
        ang = 2 * math.pi * u * 0.9
        add(p, **{'p_wrist.R': V(0.025 * math.sin(ang), 0.0, 0.025 * (math.cos(ang) - 1))})
        p['s_rete'] = V(ease(u), 0, 0)
    elif t >= 4.6:
        p['s_rete'] = V(1, 0, 0)
    breathe(p, t, 3.0, 0.6)
    return p


def scroll_base():
    p = seated()
    lean(p, hips=2, spine=4, chest=3, neck=8, head=18)
    p.update({
        'p_wrist.L': V(0.21, -0.25, 0.60), 'd_hand.L': V(-0.12, -0.96, 0.22),
        'd_palm.L': V(-1, 0.1, 0.05), 'd_elbow.L': V(1, 0.4, -0.6),
        'd_hand.R': V(0.12, -0.96, 0.22), 'd_palm.R': V(1, 0.1, 0.05), 'd_elbow.R': V(-1, 0.4, -0.6),
        'p_wrist.R': V(-0.17, -0.25, 0.60), 's_tieR': V(1, 0, 0),
    })
    return p


def clip_scroll_search(t):
    """Holding an unrolled scroll between the hands, scanning down it, glancing aside to the
    rack for the next one. 5 s. The right hand is tied to the scroll's free edge."""
    p = scroll_base()
    scan = Keys([(0.0, {'h': e(0, 0, 0)}, True), (2.4, {'h': e(10, 3, 0)}, False),
                 (2.9, {'h': e(-4, -38, -3)}, True), (3.9, {'h': e(-6, -42, -3)}, True),
                 (5.0, {'h': e(0, 0, 0)}, True)], loop=True)(t)['h']
    add(p, r_head=scan * 0.7, r_neck=scan * 0.3)
    if 2.6 < t < 4.3:
        u = (t - 2.6) / 1.7
        add(p, r_chest=e(0, -14 * math.sin(math.pi * u), 0), r_spine=e(0, -6 * math.sin(math.pi * u), 0))
    add(p, **{'p_wrist.L': V(0, 0, 0.012 * wave(t, 5.0, 0.1))})
    breathe(p, t, 5.0 / 2, 0.6)
    return p


def letter_reach():
    p = seated()
    lean(p, hips=-1, spine=2, chest=-2, neck=-4, head=-6, yaw=-6)
    p.update({
        'p_wrist.R': V(-0.17, -0.47, 0.76), 'd_hand.R': V(0.15, -0.95, 0.22),
        'd_palm.R': V(0.0, 0.22, 0.97), 'd_elbow.R': V(-1, 0.2, -0.7),
    })
    return p


def letter_read():
    p = seated()
    lean(p, hips=2, spine=4, chest=3, neck=10, head=18)
    p.update({
        'p_wrist.R': V(-0.11, -0.33, 0.50), 'd_hand.R': V(0.06, 0.3, 0.95),
        'd_palm.R': V(0.0, 0.95, -0.3), 'd_elbow.R': V(-1, 0.4, -0.6),
        'p_wrist.L': V(0.08, -0.33, 0.50), 'd_hand.L': V(-0.06, 0.3, 0.95),
        'd_palm.L': V(0.0, 0.95, -0.3), 'd_elbow.L': V(1, 0.4, -0.6), 's_tieL': V(1, 0, 0),
    })
    return p


def clip_receive_letter(t):
    """A letter arrives: reach for it, bring it in, read it with both hands. 5 s."""
    k = Keys([(0.0, letter_reach(), True), (0.6, letter_reach(), True), (1.6, letter_read(), True),
              (3.9, letter_read(), False), (5.0, letter_reach(), True)], loop=True)
    p = k(t)
    if 1.6 <= t < 3.9:
        u = (t - 1.6) / 2.3
        add(p, r_head=e(2 * u, 4 * math.sin(2 * math.pi * u * 2), 0))
    breathe(p, t, 5.0 / 2, 0.6)
    return p


def beckon_pose(curl):
    p = seated()
    lean(p, hips=-2, spine=1, chest=-1, neck=0, head=-4, yaw=-38)
    add(p, r_head=e(0, -22, -4))
    a = Vector((-0.15, -0.35, 0.92))
    pr = Vector((-0.75, -0.55, 0.35))
    rot = Quaternion(Vector((0.45, -0.9, 0.0)).normalized(), math.radians(-70 * curl))
    p.update({
        'p_wrist.R': V(-0.34, -0.17, 0.66), 'd_hand.R': V(rot @ a), 'd_palm.R': V(rot @ pr),
        'd_elbow.R': V(-0.6, 0.6, -0.9),
    })
    return p


def clip_gesture_beckon(t):
    """Turn towards the stacks and beckon an apprentice over. 3 s."""
    k = Keys([(0.0, seated(), True), (0.6, beckon_pose(0.0), False), (0.95, beckon_pose(1.0), False),
              (1.3, beckon_pose(0.1), False), (1.65, beckon_pose(1.0), False),
              (2.1, beckon_pose(0.0), True), (3.0, seated(), True)], loop=True)
    p = k(t)
    breathe(p, t, 3.0, 0.5)
    return p


def look_up_pose():
    p = seated()
    lean(p, hips=-2, spine=-2, chest=-3, neck=-6, head=-10)
    return p


def clip_look_up(t):
    """Done: the pen is set down, the scholar sits back and looks up, waiting. 4 s."""
    p = look_up_pose()
    breathe(p, t, 4.0, 1.0)
    add(p, r_head=e(1.2 * wave(t, 4.0, 0.3), 3.0 * wave(t, 4.0), 2.5 * wave(t, 4.0, 0.15)))
    return p


def crouch_pose():
    p = standing()
    p['p_hips'] = V(0, 0.07, 0.60)
    lean(p, hips=24, spine=8, chest=4, neck=-6, head=-14)
    p.update({
        'p_ankle.L': V(0.11, -0.03, rig.ANKLE_Z + 0.002), 'p_ankle.R': V(-0.11, 0.01, rig.ANKLE_Z),
        'd_knee.L': V(0.5, -1, 0.1), 'd_knee.R': V(-0.5, -1, 0.1),
        'p_wrist.L': V(0.22, -0.34, 0.60), 'd_hand.L': V(0.1, -0.6, -0.8), 'd_palm.L': V(-0.2, 0.75, -0.6),
        'p_wrist.R': V(-0.22, -0.33, 0.61), 'd_hand.R': V(-0.1, -0.6, -0.8), 'd_palm.R': V(0.2, 0.75, -0.6),
        'd_elbow.L': V(1, 0.4, -0.2), 'd_elbow.R': V(-1, 0.4, -0.2),
    })
    return p


def lowering_pose():
    """Hips almost down, one hand on the cushion, the legs folding in to cross."""
    p = seated()
    p['p_hips'] = V(0, 0.05, 0.34)
    lean(p, hips=16, spine=6, chest=2, neck=-2, head=-4)
    p.update({
        'p_ankle.L': V(0.05, -0.27, 0.12), 'p_ankle.R': V(-0.02, -0.17, 0.10),
        'p_wrist.L': V(0.26, -0.02, 0.21), 'd_hand.L': V(0.2, -0.3, -0.93), 'd_palm.L': V(0, 0.2, -1),
        'd_elbow.L': V(1, 0.5, 0.1),
        'p_wrist.R': V(-0.13, -0.27, 0.40), 'd_hand.R': V(0.4, -0.7, -0.5), 'd_palm.R': V(0.3, 0.4, -0.8),
    })
    return p


def clip_sit_down(t):
    k = Keys([(0.0, standing(), True), (0.55, crouch_pose(), False), (1.15, lowering_pose(), False),
              (1.8, seated(), True)], loop=False)
    p = k(t)
    hz = p['p_hips'][2]
    p['s_ground'] = V(ease((0.75 - hz) / 0.4), 0, 0)
    return p


def clip_stand_up(t):
    k = Keys([(0.0, seated(), True), (0.45, lowering_pose(), False), (1.0, crouch_pose(), False),
              (1.6, standing(), True)], loop=False)
    p = k(t)
    hz = p['p_hips'][2]
    p['s_ground'] = V(ease((0.75 - hz) / 0.4), 0, 0)
    return p


CLIPS = {
    # name: (function, duration s, loop, seated, prop)
    'idle': (clip_idle, 4.0, True, False, None),
    'walk': (clip_walk, WALK_CYCLE, True, False, None),
    'sit_idle': (clip_sit_idle, 6.0, True, True, None),
    'write': (clip_write, 4.0, True, True, 'prop_reed_pen'),
    'read': (clip_read, 5.0, True, True, 'prop_codex'),
    'astrolabe': (clip_astrolabe, 6.0, True, True, 'prop_astrolabe'),
    'scroll_search': (clip_scroll_search, 5.0, True, True, 'prop_scroll'),
    'receive_letter': (clip_receive_letter, 5.0, True, True, 'prop_letter'),
    'gesture_beckon': (clip_gesture_beckon, 3.0, True, True, None),
    'look_up': (clip_look_up, 4.0, True, True, None),
    'stand_up': (clip_stand_up, 1.6, False, True, None),
    'sit_down': (clip_sit_down, 1.8, False, True, None),
}


def walk_meta():
    return {'speedMps': WALK_SPEED, 'cycleSeconds': WALK_CYCLE,
            'strideMeters': round(WALK_SPEED * WALK_CYCLE, 4), 'dutyFactor': WALK_DUTY,
            'note': 'stance feet move back at speedMps; move the root forward at the same speed'}


def seated_meta():
    return {'hipHeight': round(SEAT_HIPS.z, 3), 'hipsBone': 'hips', 'cushionHeight': CUSHION_H,
            'cushionHalfSize': CUSHION_HALF, 'deskHeight': DESK_H, 'deskNearEdge': DESK_NEAR,
            'note': 'root at the cushion centre on the floor; the desk near edge is deskNearEdge '
                    'metres in front (+Z), top at deskHeight'}


# ---------------------------------------------------------------- baking to actions


def tie_hands(P, solver):
    """Two-handed holds. s_tieR: the right hand grips the free edge of the scroll held in the
    left; s_tieL: the left hand takes the far corner of the letter held in the right. The value
    blends from the free wrist target (0) to the tied one (1)."""
    import figures_props as props
    for key, holder, follower, point in (('s_tieR', 'L', 'R', props.SCROLL_FREE_EDGE),
                                         ('s_tieL', 'R', 'L', props.LETTER_CORNER)):
        w = float(P[key][0])
        if w <= 1e-4:
            continue
        Q, H = solver.solve(P)
        pt = (solver.world_matrix(Q, H, f'hand.{holder}')
              @ props.hand_point_local(solver.rest, holder, point)).translation
        F = frame3(Vector(P[f'd_hand.{follower}']), Vector(P[f'd_palm.{follower}']))
        tied = np.array(pt - F.col[0] * props.GRIP_A - F.col[1] * props.GRIP_N)
        P[f'p_wrist.{follower}'] = P[f'p_wrist.{follower}'] * (1 - w) + tied * w
    return P


def sample_clip(name, solver):
    fn, dur, loop, seated_flag, prop = CLIPS[name]
    n = int(round(dur * FPS))
    poses = []
    for f in range(n + 1):
        t = f / FPS
        if loop and f == n:
            t = 0.0
        poses.append(tie_hands(fn(t), solver))
    return poses, n


def bake_clip(name, solver, warm_poses=None):
    """Returns per-frame {bone: (loc, quat, scale)} and per-frame prop part values."""
    fn, dur, loop, seated_flag, prop = CLIPS[name]
    poses, n = sample_clip(name, solver)
    solved = [solver.solve(P) for P in poses]
    drape = Drape(solver)
    # warm up the cloth: settle on a lead-in, then (for loops) run the clip twice
    lead = warm_poses or [poses[0]] * FPS
    Q0, H0 = solver.solve(lead[0])
    drape.reset(Q0, H0, float(lead[0]['s_ground'][0]))
    for P in lead:
        Q, H = solver.solve(P)
        drape.step(Q, H, float(P['s_ground'][0]))
    for _ in range(FPS):
        drape.step(*solved[0], float(poses[0]['s_ground'][0]))
    passes = 3 if loop else 1
    frames = []
    for pi in range(passes):
        frames = []
        for f in range(n + 1):
            Q, H = solved[f]
            W = drape.step(Q, H, float(poses[f]['s_ground'][0]))
            frames.append(drape.bones(Q, H, W))
    if loop:
        # close the loop exactly: ease the last frames onto the first
        m = min(8, n // 3)
        for i in range(m + 1):
            f = n - m + i
            w = ease(i / m)
            for b, (q, h, s) in frames[f].items():
                q0, h0, s0 = frames[0][b]
                frames[f][b] = (q.slerp(q0, w), h.lerp(h0, w), s + (s0 - s) * w)
    out = []
    for f in range(n + 1):
        Q, H = solved[f]
        out.append(to_local(solver, Q, H, frames[f]))
    parts = [{'s_page': float(P['s_page'][0]), 's_rete': float(P['s_rete'][0])} for P in poses]
    if loop:
        parts[-1] = dict(parts[0])
    return out, parts, n, poses


def to_local(solver, Q, H, cloth):
    """Armature-space solution -> Blender pose-bone loc/rot/scale (local to the rest frame)."""
    r = solver.rest
    out = {}
    allQ, allH = dict(Q), dict(H)
    stretch = {}
    for b, (q, h, s) in cloth.items():
        allQ[b], allH[b], stretch[b] = q, h, s
    for b in rig.BONE_NAMES:
        if b not in allQ:
            allQ[b], allH[b] = Quaternion(), r[b]['head'].copy()
        p = r[b]['parent']
        Rb = r[b]['R']
        if p is None:
            qp, hp_rest, hp = Quaternion(), r[b]['head'], r[b]['head']
            a0 = r[b]['head']
        else:
            qp = allQ[p]
            a0 = allH[p] + qp @ (r[b]['head'] - r[p]['head'])
        q_rel = qp.inverted() @ allQ[b]
        q_loc = (Rb.transposed() @ q_rel.to_matrix() @ Rb).to_quaternion()
        loc = Rb.transposed() @ (qp.inverted() @ (allH[b] - a0))
        sc = Vector((1.0, stretch.get(b, 1.0), 1.0))
        out[b] = (loc, q_loc, sc)
    return out


def write_action(name, arm_ob, frames, parts, part_obs):
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    slot = act.slots.new(id_type='OBJECT', name=arm_ob.name)
    layer = act.layers.new('base')
    strip = layer.strips.new(type='KEYFRAME')
    cb = strip.channelbag(slot, ensure=True)
    n = len(frames)
    fr = np.arange(n, dtype=np.float32)
    for b in rig.BONE_NAMES:
        locs = np.array([frames[f][b][0][:] for f in range(n)], dtype=np.float32)
        quats = np.array([frames[f][b][1][:] for f in range(n)], dtype=np.float32)
        for f in range(1, n):  # hemisphere continuity
            if np.dot(quats[f], quats[f - 1]) < 0:
                quats[f] = -quats[f]
        scales = np.array([frames[f][b][2][:] for f in range(n)], dtype=np.float32)
        for path, data in (('location', locs), ('rotation_quaternion', quats), ('scale', scales)):
            for i in range(data.shape[1]):
                fc = cb.fcurves.new(f'pose.bones["{b}"].{path}', index=i, group_name=b)
                fc.keyframe_points.add(n)
                fc.keyframe_points.foreach_set('co', np.stack([fr, data[:, i]], 1).ravel())
                fc.keyframe_points.foreach_set('interpolation', [1] * n)  # LINEAR
                fc.update()
    slots = {arm_ob.name: slot}
    for key, (ob, axis, angle_fn) in part_obs.items():
        vals = [parts[f][key] for f in range(n)]
        if max(vals) - min(vals) < 1e-6:
            continue
        ps = act.slots.new(id_type='OBJECT', name=ob.name)
        pcb = strip.channelbag(ps, ensure=True)
        base = ob.rotation_quaternion.copy()
        quats = np.array([(base @ Quaternion(axis, angle_fn(v)))[:] for v in vals], dtype=np.float32)
        for f in range(1, n):
            if np.dot(quats[f], quats[f - 1]) < 0:
                quats[f] = -quats[f]
        for i in range(4):
            fc = pcb.fcurves.new('rotation_quaternion', index=i, group_name=key)
            fc.keyframe_points.add(n)
            fc.keyframe_points.foreach_set('co', np.stack([fr, quats[:, i]], 1).ravel())
            fc.keyframe_points.foreach_set('interpolation', [1] * n)
            fc.update()
        slots[ob.name] = ps
    return act, slots


def animate(fig):
    """Bake every clip onto the scholar rig (NLA tracks, muted) and return clip info."""
    import figures_props as props
    arm_ob = fig['arm']
    solver = Solver(fig['rest'])
    arm_ob.animation_data_create()
    part_obs = props.animated_parts(fig['props'])
    clips = {}
    sit_lead = None
    for name in CLIPS:
        fn, dur, loop, seated_flag, prop = CLIPS[name]
        lead = None
        if seated_flag and name not in ('sit_down',):
            if sit_lead is None:
                sd, _ = sample_clip('sit_down', solver)
                sit_lead = [standing()] * FPS + sd + [seated()] * FPS
            first = sample_clip(name, solver)[0][0]
            blend = [blend_pose(seated(), first, ease(i / 15)) for i in range(16)]
            lead = sit_lead + blend
        frames, parts, n, poses = bake_clip(name, solver, lead)
        act, slots = write_action(name, arm_ob, frames, parts, part_obs)
        for ob_name, slot in slots.items():
            ob = bpy.data.objects[ob_name]
            ob.animation_data_create()
            tr = ob.animation_data.nla_tracks.new()
            tr.name = name
            st = tr.strips.new(name, 0, act)
            st.action_slot = slot
            tr.mute = True
        clips[name] = {'duration': n / FPS, 'loop': loop, 'seated': seated_flag, 'prop': prop,
                       'frames': n, 'start': 0, 'action': act, 'slots': slots,
                       'seated_any': seated_flag or name in ('stand_up', 'sit_down')}
        print(f'[anim] {name}: {n} frames', flush=True)
    return clips


def blend_pose(a, b, w):
    return {k: a[k] * (1 - w) + b[k] * w if k in b else a[k] for k in a}


def assign_for_render(figs, clips):
    """For look-check renders: no NLA, the active action is set per clip by set_clip()."""
    for f in figs.values():
        for ob in [f['arm']] + [c for p in f['props'].values() for c in [p] + list(p.children)]:
            if ob.animation_data:
                for tr in ob.animation_data.nla_tracks:
                    tr.mute = True


def set_clip(figs, clip):
    act = clip['action']
    for f in figs.values():
        arm = f['arm']
        arm.animation_data_create()
        arm.animation_data.action = act
        arm.animation_data.action_slot = clip['slots'][figs['scholar']['arm'].name]
    for ob_name, slot in clip['slots'].items():
        ob = bpy.data.objects[ob_name]
        if ob.type == 'ARMATURE':
            continue
        ob.animation_data_create()
        ob.animation_data.action = act
        ob.animation_data.action_slot = slot


def pose_rest_idle(figs, scene, clips=None):
    if clips:
        set_clip(figs, clips['idle'])
    scene.frame_set(0)
