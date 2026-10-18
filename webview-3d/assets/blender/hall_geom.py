# House of Wisdom: geometry helpers. Everything is authored in PLAN coordinates, which are the
# glTF / three.js axes of the exported GLB, in metres:
#   x = east (column * 1.5), y = up, z = south (row * 1.5); the origin is the grid's NW corner.
# Blender is Z-up, so a plan point (x, y, z) is created at Blender (x, -z, y). The glTF exporter's
# +Y-up conversion maps it straight back to (x, y, z).
import math

import bmesh
import bpy
import mathutils
import numpy as np

MATS = ['brick', 'stucco', 'plaster', 'starfloor', 'brickfloor', 'cedar', 'marble', 'rug',
        'props', 'palm', 'lamp', 'flame', 'notice_board_mat', 'base', 'logo_panel_mat',
        'planter_mat', 'dado', 'frieze', 'samarra', 'chamber_art', 'glass', 'ember']
MI = {name: i for i, name in enumerate(MATS)}


def use_materials(names):
    """Another world's material list (the House of Life's temple.py): every object made from here
    on carries these, and MI follows. The House of Wisdom never calls this."""
    MATS[:] = list(names)
    MI.clear()
    MI.update({name: i for i, name in enumerate(MATS)})


def B(x, y, z):
    """Plan point -> Blender vector."""
    return mathutils.Vector((x, -z, y))


def plan(co):
    """Blender vector -> plan tuple (x, y, z)."""
    return (co.x, co.z, -co.y)


def plan_normal(n):
    return (n.x, n.z, -n.y)


# ---------------------------------------------------------------- bmesh primitives (plan coords)
def box(bm, x0, x1, y0, y1, z0, z1, mat='plaster'):
    """Axis-aligned box; returns its faces."""
    vs = [bm.verts.new(B(x, y, z)) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    # index = xi*4 + yi*2 + zi
    quads = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    faces = [bm.faces.new([vs[i] for i in q]) for q in quads]
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = MI[mat]
    return faces


def extrude_profile(bm, outline, axis, a0, a1, mat='plaster'):
    """Closed prism from a simple polygon outline [(u, y), ...] swept along a horizontal axis.
    axis 'z': u is plan x, the prism spans z in [a0, a1]; axis 'x': u is plan z, spans x."""
    def P(u, y, a):
        return B(u, y, a) if axis == 'z' else B(a, y, u)
    n = len(outline)
    r0 = [bm.verts.new(P(u, y, a0)) for u, y in outline]
    r1 = [bm.verts.new(P(u, y, a1)) for u, y in outline]
    tris = mathutils.geometry.tessellate_polygon([[mathutils.Vector((u, y, 0)) for u, y in outline]])
    faces = []
    for a, b, c in tris:
        faces.append(bm.faces.new((r0[a], r0[b], r0[c])))
        faces.append(bm.faces.new((r1[c], r1[b], r1[a])))
    for i in range(n):
        j = (i + 1) % n
        faces.append(bm.faces.new((r0[i], r0[j], r1[j], r1[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = MI[mat]
    return faces


def loft(bm, rings, mat='plaster', cap=True):
    """Closed loft through rings of plan points (same counts)."""
    vr = [[bm.verts.new(B(*p)) for p in ring] for ring in rings]
    n = len(vr[0])
    faces = []
    if cap:
        faces.append(bm.faces.new(vr[0]))
        faces.append(bm.faces.new(vr[-1][::-1]))
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(n):
            j = (i + 1) % n
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = MI[mat]
    return faces


def lathe(bm, profile, cx, cz, y0=0.0, segments=16, mat='marble', close_top=True):
    """Surface of revolution about a vertical axis; profile [(radius, height), ...] bottom->top."""
    rings = []
    for r, h in profile:
        rings.append([B(cx + r * math.cos(2 * math.pi * k / segments), y0 + h,
                        cz + r * math.sin(2 * math.pi * k / segments)) for k in range(segments)])
    vr = [[bm.verts.new(p) for p in ring] for ring in rings]
    faces = []
    for a, b in zip(vr[:-1], vr[1:]):
        for i in range(segments):
            j = (i + 1) % segments
            faces.append(bm.faces.new((a[i], a[j], b[j], b[i])))
    if close_top:
        faces.append(bm.faces.new(vr[-1][::-1]))
    bmesh.ops.recalc_face_normals(bm, faces=faces)
    for f in faces:
        f.material_index = MI[mat]
    return faces


def arch_curve(cx, half, spring, d_ratio, n=14):
    """Two-centred pointed arch from the left springing over the apex to the right springing.
    Returns [(u, y), ...]."""
    d = d_ratio * half
    r = half + d
    alpha = math.degrees(math.acos(d / r))
    pts = []
    for a in np.linspace(180.0, 180.0 - alpha, n):           # left flank, centre on the right
        pts.append((cx + d + r * math.cos(math.radians(a)), spring + r * math.sin(math.radians(a))))
    for a in np.linspace(alpha, 0.0, n)[1:]:                  # right flank, centre on the left
        pts.append((cx - d + r * math.cos(math.radians(a)), spring + r * math.sin(math.radians(a))))
    return pts


def arch_crown(half, spring, d_ratio):
    d = d_ratio * half
    r = half + d
    return spring + math.sqrt(r * r - d * d)


def arch_outline_closed(cx, half, sill, spring, d_ratio, n=14):
    """Closed opening outline (counter-clockwise): sill -> right jamb -> arch -> left jamb."""
    pts = [(cx - half, sill), (cx + half, sill)]
    pts += arch_curve(cx, half, spring, d_ratio, n)[::-1]
    return pts


def arcade_outline(u0, u1, height, openings, n=14):
    """Outline of an arcade slab standing on the floor: openings [(cx, half, spring, d_ratio)]
    are notches from the floor up into pointed arches. Counter-clockwise in (u, y)."""
    pts = [(u0, 0.0)]
    for cx, half, spring, dr in sorted(openings):
        pts.append((cx - half, 0.0))
        pts += arch_curve(cx, half, spring, dr, n)
        pts.append((cx + half, 0.0))
    pts += [(u1, 0.0), (u1, height), (u0, height)]
    return pts


# ---------------------------------------------------------------- objects
def new_object(name, bm):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for m in MATS:
        ob.data.materials.append(bpy.data.materials[m])
    return ob


def bevelled(ob, width, segments=2):
    """Apply a Bevel modifier (angle-limited, overlap clamped) to the object's mesh."""
    mod = ob.modifiers.new('bevel', 'BEVEL')
    mod.width = width
    mod.segments = segments
    mod.limit_method = 'ANGLE'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    ob.modifiers.clear()
    old = ob.data
    ob.data = me
    bpy.data.meshes.remove(old)
    return ob


def bisect(ob, ys=(), xs=(), zs=()):
    """Split faces of an object along horizontal planes (plan y) and vertical planes."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    for y in ys:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=B(0, y, 0), plane_no=(0, 0, 1))
    for x in xs:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=B(x, 0, 0), plane_no=(1, 0, 0))
    for z in zs:
        geom = bm.verts[:] + bm.edges[:] + bm.faces[:]
        bmesh.ops.bisect_plane(bm, geom=geom, plane_co=B(0, 0, z), plane_no=(0, 1, 0))
    bm.to_mesh(ob.data)
    bm.free()


def _apply_boolean(target, others, op):
    for i, o in enumerate(others):
        m = target.modifiers.new(f'b{i}', 'BOOLEAN')
        m.operation = op
        m.object = o
        m.solver = 'MANIFOLD'
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(target.evaluated_get(dg))
    target.modifiers.clear()
    old = target.data
    target.data = me
    bpy.data.meshes.remove(old)
    for o in others:
        bpy.data.objects.remove(o)


def union(target, others):
    _apply_boolean(target, others, 'UNION')


def difference(target, cutters):
    _apply_boolean(target, cutters, 'DIFFERENCE')


def intersect(target, others):
    _apply_boolean(target, others, 'INTERSECT')


def faces_where(ob, pred, action):
    """Run action(face, centre_plan, normal_plan) on every face matching pred(c, n, f)."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    kill = []
    for f in bm.faces:
        c, n = plan(f.calc_center_median()), plan_normal(f.normal)
        if pred(c, n, f):
            if action == 'delete':
                kill.append(f)
            else:
                action(f, c, n)
    if kill:
        bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(ob.data)
    bm.free()


def split_off(ob, pred, name):
    """Move faces matching pred(c, n, f) into a new object (same materials)."""
    new = ob.copy()
    new.data = ob.data.copy()
    new.name = name
    new.data.name = name
    bpy.context.scene.collection.objects.link(new)
    faces_where(new, lambda c, n, f: not pred(c, n, f), 'delete')
    faces_where(ob, pred, 'delete')
    return new


def join(objs, name):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.view_layer.objects.active
    ob.name = name
    ob.data.name = name
    return ob


# ---------------------------------------------------------------- UV0
def set_uv0(ob, rule):
    """rule(material_name, plan_co, plan_normal) -> (u, v) or None to keep the current value."""
    me = ob.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for p in me.polygons:
        name = MATS[p.material_index]
        n = plan_normal(p.normal)
        for li in p.loop_indices:
            r = rule(name, plan(me.vertices[me.loops[li].vertex_index].co), n)
            if r is not None:
                uv.data[li].uv = r


def box_uv(co, n, scale=1.0):
    x, y, z = co
    ax = max(range(3), key=lambda i: abs(n[i]))
    if ax == 0:
        return (-z / scale if n[0] > 0 else z / scale, y / scale)
    if ax == 2:
        return (x / scale if n[2] > 0 else -x / scale, y / scale)
    return (x / scale, -z / scale)


def paint(bm, faces, uv):
    """Give every loop of the faces one UV point (a palette swatch centre)."""
    layer = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    for f in faces:
        for loop in f.loops:
            loop[layer].uv = uv


def tri_count(ob):
    me = ob.data
    sizes = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get('loop_total', sizes)
    return int((sizes - 2).sum())
