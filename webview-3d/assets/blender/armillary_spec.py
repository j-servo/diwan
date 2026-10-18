# The House of Wisdom armillary sphere: dimensions, node frames and parametric meshes. Pure numpy
# (no bpy), shared by armillary.py (the instrument's own GLB, every moving part a named node) and
# hall.py (the static octagonal plinth, and the fixed parts as bake-only shadow occluders).
#
# Coordinates are plan / glTF space like hall_geom.py: metres, x east, y up, z south. The
# instrument's origin is the centre of the plinth top (PLINTH['top'] above the floor).
#
# Proportions come from the TRELLIS2 mesh (measured 2026-10-12, in units of its meridian's outer
# radius: horizon ring 1.06, cage rings 0.88-0.94, zodiac band ~0.78, inner rings ~0.3, globe
# ~0.17, plinth 1.07 wide, polar finial on top) and the two reference images; the dimensions are
# set by the court (see the README). The motion is geocentric, as Ptolemy's Almagest (translated
# at the House of Wisdom) models it: the runtime turns `cage` about the polar axis, `sun` along
# the ecliptic and `moon` along its own inclined ring (src/world/armillary.ts).
import math

import numpy as np

LATITUDE = 33.3            # Baghdad: the polar axis rises this far above the north horizon
OBLIQUITY = 23.44          # the ecliptic's tilt to the celestial equator
MOON_INCLINATION = 5.15    # the moon's orbit to the ecliptic
BAGHDAD_LON = 44.4         # the globe turns Baghdad to the zenith

R = 1.80                   # meridian outer radius: a 3.6 m sphere
CY = R + 0.40              # sphere centre above the plinth top (the pedestal lifts the meridian)
MERIDIAN_IN = 1.62         # the meridian's broad face runs from here to R
CAGE = (1.46, 1.60)        # equator and colures, radial extent (turning 2 cm inside the meridian)
CAGE_MID = 1.53
# The plinth is hall geometry (lightmapped): a dark moulded wooden base, a stone tier carved with
# a Samarra stucco frieze, and a dark inlaid top with concentric brass rings. Octagons have their
# flats facing the four axes; `a` is the apothem.
PLINTH = dict(base_a=1.80, base_h=0.17, base_lip=0.20, tier_a=1.55, mould_a=1.58,
              mould=(0.20, 0.25), frieze=(0.25, 0.44), cap=(0.44, 0.47), disc_r=1.36, top=0.49,
              # top surface, centre out: (radius, swatch) annuli of the inlay
              inlay=[(0.38, 'brass'), (0.62, 'dark'), (0.65, 'brass'), (0.95, 'dark'),
                     (0.99, 'brass'), (1.24, 'dark'), (1.28, 'brass'), (1.36, 'dark')])

# Node tree (parent, then the local transform's rotation and translation in the parent's frame).
# The three moving parts are empty pivots (the runtime turns them about their local +Y) with
# their meshes as children: mesh quantisation (optimize.mjs) re-centres a mesh node's origin on
# its mesh, so a pivot must never carry the mesh itself.
NODES = ['armillary', 'pedestal', 'meridian', 'horizon', 'polar_axis', 'earth', 'cage',
         'cage_rings', 'ecliptic', 'sun', 'sun_bead', 'moon_orbit', 'moon', 'moon_bead']
PARENT = {'pedestal': 'armillary', 'meridian': 'armillary', 'horizon': 'armillary',
          'polar_axis': 'armillary', 'earth': 'polar_axis', 'cage': 'polar_axis',
          'cage_rings': 'cage', 'ecliptic': 'cage', 'sun': 'ecliptic', 'sun_bead': 'sun',
          'moon_orbit': 'ecliptic', 'moon': 'moon_orbit', 'moon_bead': 'moon'}
EMPTY = ['armillary', 'cage', 'sun', 'moon']
FIXED = ['pedestal', 'meridian', 'horizon', 'polar_axis']   # never move (bake occluders)


def rot_x(deg):
    c, s = math.cos(math.radians(deg)), math.sin(math.radians(deg))
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def pole_frame():
    """Columns: local x = east, local y = the north celestial pole (raised LATITUDE above the north
    horizon, north = -z), local z = x cross y (the equator's highest point, towards the south)."""
    p = math.radians(LATITUDE)
    x = np.array([1.0, 0.0, 0.0])
    y = np.array([0.0, math.sin(p), -math.cos(p)])
    return np.stack([x, y, np.cross(x, y)], 1)


def local_transforms():
    """node -> (3x3 rotation, translation) relative to its parent (the root's is identity)."""
    eye, zero, centre = np.eye(3), np.zeros(3), np.array([0.0, CY, 0.0])
    return {
        'armillary': (eye, zero), 'pedestal': (eye, zero), 'meridian': (eye, centre),
        'horizon': (eye, centre), 'polar_axis': (pole_frame(), centre), 'earth': (eye, zero),
        'cage': (eye, zero), 'cage_rings': (eye, zero), 'ecliptic': (rot_x(OBLIQUITY), zero),
        'sun': (eye, zero), 'sun_bead': (eye, zero),
        'moon_orbit': (rot_x(MOON_INCLINATION), zero), 'moon': (eye, zero),
        'moon_bead': (eye, zero),
    }


def to_root(node):
    """(rotation, translation) of a node in the instrument's (root) frame, at rest."""
    lt = local_transforms()
    rot, t = np.eye(3), np.zeros(3)
    chain = []
    while node != 'armillary':
        chain.append(node)
        node = PARENT[node]
    for n in reversed(chain):
        r, tt = lt[n]
        t = t + rot @ tt
        rot = rot @ r
    return rot, t


# ---------------------------------------------------------------- mesh container
class Mesh:
    """Positions, normals, UV0 (Blender convention, v up), polygons and a material slot each."""

    def __init__(self):
        self.P, self.N, self.UV, self.F, self.M = [], [], [], [], []
        self.n = 0

    def add(self, P, N, UV, faces, mat):
        self.P.append(np.asarray(P, float).reshape(-1, 3))
        self.N.append(np.asarray(N, float).reshape(-1, 3))
        self.UV.append(np.asarray(UV, float).reshape(-1, 2))
        for f in faces:
            self.F.append([self.n + i for i in f])
            self.M.append(mat)
        self.n += len(self.P[-1])

    def merge(self, other):
        for P, N, UV in zip(other.P, other.N, other.UV):
            self.P.append(P), self.N.append(N), self.UV.append(UV)
        self.F += [[self.n + i for i in f] for f in other.F]
        self.M += other.M
        self.n += other.n

    def arrays(self):
        if not self.P:
            return np.zeros((0, 3)), np.zeros((0, 3)), np.zeros((0, 2))
        return np.concatenate(self.P), np.concatenate(self.N), np.concatenate(self.UV)

    def transformed(self, rot, t):
        out = Mesh()
        for P, N, UV in zip(self.P, self.N, self.UV):
            out.P.append(P @ rot.T + t), out.N.append(N @ rot.T), out.UV.append(UV)
        out.F, out.M, out.n = [list(f) for f in self.F], list(self.M), self.n
        return out

    def tris(self):
        return sum(len(f) - 2 for f in self.F)


def _orient(faces, P, N):
    """Wind each polygon so its geometric normal agrees with the authored vertex normals."""
    out = []
    for f in faces:
        a, b, c = P[f[0]], P[f[1]], P[f[2]]
        g = np.cross(b - a, c - a)
        if np.linalg.norm(g) < 1e-14 and len(f) == 4:
            a, b, c = P[f[0]], P[f[2]], P[f[3]]
            g = np.cross(b - a, c - a)
        out.append(list(f) if g @ N[f].sum(0) >= 0 else list(f[::-1]))
    return out


def sweep(mesh, profile, centre, axis, e1, seg, uv_of_edge, mat_of_edge, closed=True,
          smooth=None, arc=(0.0, 2 * math.pi)):
    """Sweep a 2D profile [(a, b), ...] (a radial, b along `axis`; CCW, so the outward normal of
    the edge (da, db) is (db, -da)) around `axis` through `centre`. Each profile edge becomes its
    own strip of quads, so profile corners stay crisp and the circumference is smooth. smooth: a
    set of profile vertex indices whose normals blend their two edges (lathe curves).
    uv_of_edge(i, theta01, s01) -> (u, v); mat_of_edge(i) -> material slot."""
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    e1 = np.asarray(e1, float) - axis * (np.asarray(e1, float) @ axis)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(axis, e1)
    prof = np.asarray(profile, float)
    n_e = len(prof) if closed else len(prof) - 1
    th = np.linspace(arc[0], arc[1], seg + 1)
    radial = np.cos(th)[:, None] * e1 + np.sin(th)[:, None] * e2      # (seg+1, 3)
    edge_n = []
    for i in range(len(prof) if closed else len(prof) - 1):
        a0, b0 = prof[i]
        a1, b1 = prof[(i + 1) % len(prof)]
        d = np.array([b1 - b0, -(a1 - a0)])
        edge_n.append(d / max(np.linalg.norm(d), 1e-12))
    smooth = smooth or set()

    def blended(i, neighbour):
        """Edge i's normal, averaged with a neighbouring edge's when that edge exists."""
        if not closed and not 0 <= neighbour < n_e:
            return edge_n[i]
        n2 = edge_n[i] + edge_n[neighbour % n_e]
        return n2 / max(np.linalg.norm(n2), 1e-12)

    for i in range(n_e):
        j = (i + 1) % len(prof)
        ends = [(prof[i], blended(i, i - 1) if i in smooth else edge_n[i]),
                (prof[j], blended(i, i + 1) if j in smooth else edge_n[i])]
        P, N, UV = [], [], []
        for (ab, n2), s in zip(ends, (0.0, 1.0)):
            P.append(centre + ab[0] * radial + ab[1] * axis)
            N.append(n2[0] * radial + n2[1] * axis)
            UV.append([uv_of_edge(i, t / (2 * math.pi), s) for t in th])
        P = np.concatenate(P)
        N = np.concatenate(N)
        UV = np.concatenate([np.asarray(u, float) for u in UV])
        m = seg + 1
        faces = [[k, k + 1, m + k + 1, m + k] for k in range(seg)]
        mesh.add(P, N, UV, _orient(faces, P, N), mat_of_edge(i))


def _chamfered_rect(a0, a1, b0, b1, c):
    """CCW (a, b) outline of a rectangle with 45-degree chamfers. Edge order: back chamfer, back
    face (-b), chamfer, outer (+a), chamfer, front face (+b), chamfer, inner (-a)."""
    return [(a0, b0 + c), (a0 + c, b0), (a1 - c, b0), (a1, b0 + c), (a1, b1 - c), (a1 - c, b1),
            (a0 + c, b1), (a0, b1 - c)]


# edge roles of _chamfered_rect, by edge index
RECT_ROLES = ['chamfer', 'back', 'chamfer', 'outer', 'chamfer', 'front', 'chamfer', 'inner']


def flat_ring(mesh, centre, normal, e1, r0, r1, t, seg, face_uv, rim_uv, mat=0, chamfer=0.006):
    """A flat annulus (washer) in the plane through centre normal to `normal`: engraved on both
    faces (face_uv(theta01, s01), s from r0 to r1), bright brass on rims and chamfers."""
    prof = _chamfered_rect(r0, r1, -t / 2, t / 2, min(chamfer, t / 4))

    def uv(i, th01, s):
        role = RECT_ROLES[i]
        if role in ('front', 'back'):
            return face_uv(th01, (1 - s) if role == 'front' else s)
        return rim_uv(th01, s)
    sweep(mesh, prof, np.asarray(centre, float), normal, e1, seg, uv, lambda i: mat)


def belt(mesh, centre, axis, e1, rho, t, w, seg, face_uv, rim_uv, mat=0, chamfer=0.006):
    """A cylindrical band (the zodiac belt): faces radially, engraved on its outer and inner
    faces (s across the width), brass edges."""
    prof = _chamfered_rect(rho - t / 2, rho + t / 2, -w / 2, w / 2, min(chamfer, t / 4))

    def uv(i, th01, s):
        role = RECT_ROLES[i]
        if role in ('outer', 'inner'):
            return face_uv(th01, s if role == 'outer' else 1 - s)
        return rim_uv(th01, s)
    sweep(mesh, prof, np.asarray(centre, float), axis, e1, seg, uv, lambda i: mat)


def lathe(mesh, profile, base, axis, e1, seg, uv_fn, mat=0, smooth=True):
    """Surface of revolution, profile [(r, h)] listed bottom to top along the outside."""
    sm = set(range(len(profile))) if smooth else None
    sweep(mesh, profile, np.asarray(base, float), axis, e1, seg, uv_fn, lambda i: mat,
          closed=False, smooth=sm)


def sphere(mesh, centre, radius, n_lon, n_lat, uv_fn, mat=0, frame=np.eye(3)):
    """UV sphere; uv_fn(lon01, lat01) with lon01 from -180 deg, lat01 from the south pole.
    `frame` columns: local x, y (pole), z axes."""
    lon = np.linspace(-math.pi, math.pi, n_lon + 1)
    lat = np.linspace(-math.pi / 2, math.pi / 2, n_lat + 1)
    LON, LAT = np.meshgrid(lon, lat)
    d = np.stack([np.cos(LAT) * np.sin(LON), np.sin(LAT), np.cos(LAT) * np.cos(LON)], -1)
    d = d.reshape(-1, 3) @ np.asarray(frame).T
    P = np.asarray(centre) + radius * d
    UV = [uv_fn(a, b) for b, a in zip(((LAT + math.pi / 2) / math.pi).ravel(),
                                      ((LON + math.pi) / (2 * math.pi)).ravel())]
    m = n_lon + 1
    faces = []
    for j in range(n_lat):
        for i in range(n_lon):
            a, b, c, e = j * m + i, j * m + i + 1, (j + 1) * m + i + 1, (j + 1) * m + i
            if j == 0:
                faces.append([a, c, e])
            elif j == n_lat - 1:
                faces.append([a, b, c])
            else:
                faces.append([a, b, c, e])
    mesh.add(P, d, UV, _orient(faces, P, d), mat)


def rod(mesh, p0, p1, r, seg, uv_fn, mat=0):
    """A capped cylinder between two points."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    ax = p1 - p0
    L = np.linalg.norm(ax)
    ax /= L
    e1 = np.cross(ax, [0.0, 1.0, 0.0] if abs(ax[1]) < 0.9 else [1.0, 0.0, 0.0])
    lathe(mesh, [(0.0, 0.0), (r, 0.0), (r, L), (0.0, L)], p0, ax, e1, seg, uv_fn, mat,
          smooth=False)


def any_perp(v):
    v = np.asarray(v, float)
    p = np.cross(v, [0.0, 1.0, 0.0] if abs(v[1]) < 0.9 else [1.0, 0.0, 0.0])
    return p / np.linalg.norm(p)


# ---------------------------------------------------------------- the instrument
# Material slots of the instrument GLB
BRASS, GLOBE = 0, 1


def instrument(uv):
    """Every mesh node's mesh in its own local frame. `uv` is armillary_textures.UV."""
    X, Y, Z = np.eye(3)
    m = {n: Mesh() for n in NODES if n not in EMPTY}
    scale12 = lambda th, s: uv.strip('scale', 12 * th, s)          # 30 degrees per repeat
    brass = lambda th, s: uv.strip('brass', 8 * th, 0.5)
    gold = lambda th, s: uv.strip('gold', 4 * th, 0.5)

    # pedestal: a bell-shaped bronze foot with brass knops; its post ends in the meridian's cup
    bell = [(0.34, 0.0), (0.34, 0.025), (0.31, 0.045), (0.25, 0.075), (0.19, 0.12), (0.15, 0.17),
            (0.125, 0.22), (0.115, 0.25), (0.15, 0.27), (0.155, 0.29), (0.13, 0.31),
            (0.075, 0.33), (0.065, 0.36), (0.09, 0.375), (0.09, CY - R + 0.008),
            (0.0, CY - R + 0.01)]
    lathe(m['pedestal'], bell, (0, 0, 0), Y, -Z, 48,
          lambda i, th, s: uv.strip('bronze' if i < 7 else 'brass', 4 * th, s))

    # meridian: the broad fixed ring in the north-south plane, graduated on both faces
    flat_ring(m['meridian'], (0, 0, 0), X, -Z, MERIDIAN_IN, R, 0.05, 128, scale12, brass)
    crest = [(0.05, -0.01), (0.06, 0.04), (0.035, 0.08), (0.05, 0.12), (0.012, 0.2), (0.0, 0.22)]
    lathe(m['meridian'], crest, (0, R - 0.005, 0), Y, -Z, 16, lambda i, th, s: gold(th, s))

    # horizon: the wide "hat brim", level with the sphere's centre; the meridian runs through it
    flat_ring(m['horizon'], (0, 0, 0), Y, -Z, 1.74, 1.94, 0.04, 128,
              lambda th, s: uv.strip('horizon', 4 * th, s), brass)

    # polar axis: one rod through both poles, bosses where it pierces the meridian, a gilt finial
    # at the north celestial pole and a knob at the south
    axis = [(0.0, -1.88), (0.04, -1.86), (0.045, -1.82), (0.045, -1.61), (0.022, -1.61),
            (0.022, 1.61), (0.045, 1.61), (0.045, 1.82), (0.03, 1.84), (0.05, 1.88), (0.05, 1.92),
            (0.02, 1.95), (0.035, 2.0), (0.035, 2.03), (0.012, 2.12), (0.0, 2.15)]
    lathe(m['polar_axis'], axis, (0, 0, 0), Y, X, 16,
          lambda i, th, s: gold(th, s) if i >= 7 else brass(th, s), smooth=False)

    # earth: Baghdad turned to the zenith (pole-frame z leans LATITUDE off the zenith)
    lon0 = math.radians(BAGHDAD_LON)
    frame = np.stack([X, Y, Z], 1)
    sphere(m['earth'], (0, 0, 0), 0.25, 64, 32,
           lambda lon01, lat01: uv.globe(lon01 + lon0 / (2 * math.pi), lat01),
           GLOBE, frame)

    # cage: equator, the two colures, the tropics and the polar circles, all on the pole frame
    cage = m['cage_rings']
    flat_ring(cage, (0, 0, 0), Y, X, *CAGE, 0.035, 128, scale12, brass)        # equator
    flat_ring(cage, (0, 0, 0), Z, X, *CAGE, 0.03, 128, scale12, brass)         # equinoctial colure
    flat_ring(cage, (0, 0, 0), X, Z, *CAGE, 0.03, 128, scale12, brass)         # solstitial colure
    eps = math.radians(OBLIQUITY)
    for sign in (1, -1):
        h, r = CAGE_MID * math.sin(eps), CAGE_MID * math.cos(eps)            # tropics
        flat_ring(cage, sign * h * Y, Y, X, r - 0.025, r + 0.025, 0.03, 96,
                  lambda th, s: uv.strip('interlace', 22 * th, s), brass)
        h, r = CAGE_MID * math.cos(eps), CAGE_MID * math.sin(eps)            # polar circles
        flat_ring(cage, sign * h * Y, Y, X, r - 0.0225, r + 0.0225, 0.028, 64,
                  lambda th, s: uv.strip('interlace', 11 * th, s), brass)
        # pivot hubs: the colures meet the axis here and turn on it
        lathe(cage, [(0.0, 0.0), (0.05, 0.0), (0.05, 0.16), (0.0, 0.16)], sign * 1.44 * Y,
              sign * Y, X, 16, lambda i, th, s: brass(th, s), smooth=False)

    # ecliptic: the wide zodiac belt, twelve 30-degree signs (rosettes, no script)
    belt(m['ecliptic'], (0, 0, 0), Y, X, CAGE_MID, 0.024, 0.30, 128,
         lambda th, s: uv.strip('zodiac', 12 * th, s), brass)

    def inner_ring(mesh, r0, r1, t, seg, reps, tilt_deg):
        """A ring in this node's xz plane, held by two struts from collars on the polar axis
        (which leans tilt_deg off this node's y). The struts meet the ring's inner edge in the
        plane of the solstitial colure, so a bead riding its outer edge never meets them."""
        flat_ring(mesh, (0, 0, 0), Y, X, r0, r1, t, seg,
                  lambda th, s: uv.strip('interlace', reps * th, s), brass)
        tilt = math.radians(tilt_deg)
        a = np.array([0.0, math.cos(tilt), -math.sin(tilt)])               # the axis, locally
        for sign in (1, -1):
            p = sign * np.array([0.0, 0.0, -r0 + 0.004])
            foot = (p @ a) * a
            rod(mesh, foot, p, 0.009, 8, lambda i, th, s: brass(th, s))
            lathe(mesh, [(0.0, -0.025), (0.034, -0.025), (0.034, 0.025), (0.0, 0.025)], foot, a,
                  any_perp(a), 12, lambda i, th, s: brass(th, s), smooth=False)

    # the sun's ring lies in the ecliptic; the moon's leans MOON_INCLINATION off it
    inner_ring(m['ecliptic'], 0.97, 1.03, 0.022, 96, 13, OBLIQUITY)
    inner_ring(m['moon_orbit'], 0.54, 0.58, 0.018, 64, 11, OBLIQUITY + MOON_INCLINATION)

    # sun: a gilt bead with rays, clipped to the outer edge of its ring
    c = np.array([1.03 + 0.085, 0.0, 0.0])
    sphere(m['sun_bead'], c, 0.075, 16, 8, lambda a, b: gold(a, b))
    rod(m['sun_bead'], (1.02, 0, 0), (1.05, 0, 0), 0.02, 8, lambda i, th, s: gold(th, s))
    rays = [np.array(v, float) for v in
            [(1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1)]]
    rays += [np.array(v, float) / math.sqrt(3) for v in
             [(x, y, z) for x in (1, -1) for y in (1, -1) for z in (1, -1)]]
    rays = [r for r in rays if r[0] > -0.9]           # none pointing back into the clip
    for d in rays:
        lathe(m['sun_bead'], [(0.022, 0.0), (0.0, 0.075)], c + d * 0.0675, d, any_perp(d), 4,
              lambda i, th, s: gold(th, s), smooth=False)
    # moon: a silvered bead on the outer edge of the inclined ring
    c = np.array([0.58 + 0.06, 0.0, 0.0])
    sphere(m['moon_bead'], c, 0.055, 16, 8, lambda a, b: uv.strip('silver', 2 * a, b))
    rod(m['moon_bead'], (0.575, 0, 0), (0.595, 0, 0), 0.014, 8, lambda i, th, s: brass(th, s))
    return m


def fixed_occluders():
    """The fixed parts in the instrument (root) frame, for the hall bake: meridian, horizon,
    pedestal and polar axis cast their baked shadows on the plinth and the floor."""
    class _UV:
        def strip(self, *a):
            return (0.0, 0.0)

        def globe(self, *a):
            return (0.0, 0.0)
    parts = instrument(_UV())
    out = Mesh()
    for n in FIXED:
        rot, t = to_root(n)
        out.merge(parts[n].transformed(rot, t))
    return out
