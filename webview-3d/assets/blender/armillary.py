# House of Wisdom: the courtyard's armillary sphere, its moving parts as named nodes, exported as
# its own GLB (the runtime turns the nodes; nothing here is lightmapped). The octagonal plinth it
# stands on is hall geometry (hall.py), so it shares the hall's bakes.
#
#   Blender -b --factory-startup --python-exit-code 1 --python assets/blender/armillary.py
#
# Writes assets/worlds/house-of-wisdom/out/raw/armillary.raw.glb (optimize.mjs makes
# out/armillary.glb) and the engraving textures into assets/out/tex. Node tree, frames and
# dimensions: armillary_spec.py; engraving: armillary_textures.py.
import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import bpy  # noqa: E402
import mathutils  # noqa: E402
import numpy as np  # noqa: E402

import armillary_spec as S  # noqa: E402
import armillary_textures as AT  # noqa: E402
import bl_common as C  # noqa: E402

WORLD = C.WORLD_DIR
RAW = os.path.join(WORLD, 'out', 'raw')
os.makedirs(RAW, exist_ok=True)
with open(os.path.join(WORLD, 'layout.json')) as f:
    LAYOUT = json.load(f)
T = LAYOUT['tileMeters']
STATS = {}

# plan (glTF) axes -> Blender axes: (x, y, z) -> (x, -z, y), as hall_geom.B
CB = np.array([[1.0, 0.0, 0.0], [0.0, 0.0, -1.0], [0.0, 1.0, 0.0]])


def placement():
    """Centre of the hw_armillary footprint, on the plinth top (GLB metres)."""
    f = next(f for f in LAYOUT['furniture'] if f['type'] == 'hw_armillary')
    return np.array([(f['col'] + f['footprintW'] / 2) * T, S.PLINTH['top'],
                     (f['row'] + f['footprintH'] / 2) * T])


def blender_matrix(rot, t):
    m = mathutils.Matrix.Identity(4)
    r = CB @ rot @ CB.T
    for i in range(3):
        for j in range(3):
            m[i][j] = r[i, j]
        m[i][3] = (CB @ t)[i]
    return m


def image(name, data):
    img = bpy.data.images.load(os.path.join(C.TEX, name), check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return img


def material(name, base, mr, normal=None):
    """Principled BSDF the glTF exporter maps 1:1: base colour, metallic-roughness (G, B) and an
    optional tangent-space normal map, all on UVMap."""
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True  # deprecated in 5.x but still creates the tree
    nt, L = m.node_tree, m.node_tree.links
    bsdf = nt.nodes.get('Principled BSDF')
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = image(base, False)
    L.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    t = nt.nodes.new('ShaderNodeTexImage')
    t.image = image(mr, True)
    sep = nt.nodes.new('ShaderNodeSeparateColor')
    L.new(t.outputs['Color'], sep.inputs['Color'])
    L.new(sep.outputs['Green'], bsdf.inputs['Roughness'])
    L.new(sep.outputs['Blue'], bsdf.inputs['Metallic'])
    if normal:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = image(normal, True)
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.uv_map = 'UVMap'
        L.new(t.outputs['Color'], nm.inputs['Color'])
        L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    return m


def mesh_object(name, mesh, mats):
    P, N, UV = mesh.arrays()
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(CB @ p) for p in P], [], mesh.F)
    me.update()
    uv = me.uv_layers.new(name='UVMap')
    loops = np.empty(len(me.loops), dtype=np.int32)
    me.loops.foreach_get('vertex_index', loops)
    uv.data.foreach_set('uv', UV[loops].astype(np.float32).ravel())
    me.polygons.foreach_set('material_index', np.asarray(mesh.M, dtype=np.int32))
    for m in mats:
        me.materials.append(m)
    me.shade_smooth()
    me.normals_split_custom_set_from_vertices([tuple(CB @ n) for n in N])
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main():
    t0 = time.perf_counter()
    C.reset_scene()
    with C.timed('armillary textures (numpy)'):
        AT.write_all(C.TEX, STATS)
    mats = [material('armillary_brass', 'armillary_basecolor.png', 'armillary_mr.png',
                     'armillary_normal.png'),
            material('armillary_globe', 'globe_basecolor.png', 'globe_mr.png')]
    assert len(mats) == 2 and S.BRASS == 0 and S.GLOBE == 1
    with C.timed('armillary geometry'):
        meshes = S.instrument(AT.UV())
    objs = {}
    for name in S.NODES:
        if name in S.EMPTY:
            objs[name] = bpy.data.objects.new(name, None)
            bpy.context.scene.collection.objects.link(objs[name])
        else:
            objs[name] = mesh_object(name, meshes[name], mats)
    root = objs['armillary']
    root.matrix_basis = blender_matrix(np.eye(3), placement())
    local = S.local_transforms()
    for name in S.NODES[1:]:
        ob = objs[name]
        ob.parent = objs[S.PARENT[name]]
        ob.matrix_parent_inverse = mathutils.Matrix.Identity(4)
        ob.matrix_basis = blender_matrix(*local[name])
    STATS['tris'] = {n: m.tris() for n, m in meshes.items()}
    STATS['tris_total'] = sum(STATS['tris'].values())
    STATS['centre'] = [round(float(v), 3) for v in placement() + np.array([0, S.CY, 0])]
    print('[stats] armillary tris', STATS['tris_total'], flush=True)

    C.select_only(list(objs.values()), root)
    glb = os.path.join(RAW, 'armillary.raw.glb')
    with C.timed('export GLB'):
        bpy.ops.export_scene.gltf(filepath=glb, export_format='GLB', use_selection=True,
                                  export_texcoords=True, export_normals=True,
                                  export_tangents=False, export_materials='EXPORT',
                                  export_extras=False, export_yup=True, export_apply=True,
                                  export_image_format='AUTO', export_lights=False,
                                  export_cameras=False, export_animations=False)
    STATS['glb_raw_bytes'] = os.path.getsize(glb)
    STATS['total_s'] = round(time.perf_counter() - t0, 1)
    C.TIMINGS.update(STATS)
    with open(os.path.join(RAW, 'timings_armillary.json'), 'w') as f:
        json.dump(C.TIMINGS, f, indent=2)
    print('[stats]', json.dumps(STATS, indent=1), flush=True)


main()
