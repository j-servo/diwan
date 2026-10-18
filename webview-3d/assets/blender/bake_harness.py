# The lightmap bake harness for a world other than the House of Wisdom, copied from hall.py (which
# stays exactly as it is, so its bake cannot drift): glTF-ready materials, the shared UVLightmap
# atlas, the sky / sun / practical-lamp rig, the join-for-bake and split-after-bake, the bake
# itself, gutter dilation and the sRGB encode. temple.py (the House of Life) is its first user.
import math
import os

import bmesh
import bpy
import numpy as np

import bl_common as C
import hall_geom as G
from hall_geom import B


def gltf_output_group():
    g = bpy.data.node_groups.get('glTF Material Output')
    if g is None:
        g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        g.interface.new_socket('Thickness', in_out='INPUT', socket_type='NodeSocketFloat')
    return g


def load_img(name, data):
    path = os.path.join(C.TEX, name)
    if not os.path.exists(path):
        raise SystemExit(f'missing texture {path}')
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return img


def srgb_lin(rgb):
    c = np.asarray(rgb, dtype=np.float64) / 255.0
    return tuple(float(x) for x in np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4))


def make_material(name, base=None, color=(0.8, 0.8, 0.8), normal=None, rough=0.85, metal=0.0,
                  emission=None, double=False, emission_tex=None):
    m = bpy.data.materials.new(name)
    if m.node_tree is None:
        m.use_nodes = True  # deprecated in 5.x but still creates the tree
    nt, L = m.node_tree, m.node_tree.links
    bsdf = nt.nodes.get('Principled BSDF')
    uvn = nt.nodes.new('ShaderNodeUVMap')
    uvn.uv_map = 'UVMap'
    if base:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(base, False)
        L.new(uvn.outputs['UV'], t.inputs['Vector'])
        L.new(t.outputs['Color'], bsdf.inputs['Base Color'])
    else:
        bsdf.inputs['Base Color'].default_value = (*color, 1)
    if normal:
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(normal, True)
        L.new(uvn.outputs['UV'], t.inputs['Vector'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nm.uv_map = 'UVMap'
        L.new(t.outputs['Color'], nm.inputs['Color'])
        L.new(nm.outputs['Normal'], bsdf.inputs['Normal'])
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    if emission_tex:
        # an emissive map (the House of Life's glowing title): off for the bakes like any emission
        t = nt.nodes.new('ShaderNodeTexImage')
        t.image = load_img(emission_tex, False)
        L.new(uvn.outputs['UV'], t.inputs['Vector'])
        L.new(t.outputs['Color'], bsdf.inputs['Emission Color'])
        bsdf.inputs['Emission Strength'].default_value = 0.0
    if emission:
        bsdf.inputs['Emission Color'].default_value = (*emission, 1)
        bsdf.inputs['Emission Strength'].default_value = 0.0  # off for the bakes
    m.use_backface_culling = not double
    return m


def lightmap_uvs(objs, weight):
    """Smart-project every object into one shared UVLightmap atlas, texel density evened out
    and weighted per object by weight(name), then packed (hall.py's recipe, no projected groups)."""
    for o in objs:
        me = o.data
        if 'UVMap' not in me.uv_layers:
            me.uv_layers.new(name='UVMap')
        lm = me.uv_layers.new(name='UVLightmap')
        me.uv_layers.active = lm
    C.select_only(objs, objs[0])
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        w = weight(o.name)
        if w != 1.0:
            lm = o.data.uv_layers['UVLightmap']
            uv = np.empty(len(lm.data) * 2, dtype=np.float32)
            lm.data.foreach_get('uv', uv)
            lm.data.foreach_set('uv', uv * w)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.uv.select_all(action='SELECT')
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin_method='FRACTION', margin=0.002)
    bpy.ops.object.mode_set(mode='OBJECT')
    for o in objs:
        me = o.data
        me.uv_layers.active = me.uv_layers['UVMap']
        me.uv_layers['UVMap'].active_render = True


def set_world(sky):
    w = bpy.context.scene.world
    if w.node_tree is None:
        w.use_nodes = True  # deprecated in 5.x but still creates the tree
    nt = w.node_tree
    for n in list(nt.nodes):
        if n.type not in ('OUTPUT_WORLD',):
            nt.nodes.remove(n)
    out = [n for n in nt.nodes if n.type == 'OUTPUT_WORLD'][0]
    L = nt.links
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Generated'], sep.inputs['Vector'])
    up = nt.nodes.new('ShaderNodeMath')
    up.operation = 'MAXIMUM'
    up.inputs[1].default_value = 0.0
    L.new(sep.outputs['Z'], up.inputs[0])
    pw = nt.nodes.new('ShaderNodeMath')
    pw.operation = 'POWER'
    pw.inputs[1].default_value = 0.5
    L.new(up.outputs[0], pw.inputs[0])
    mix = nt.nodes.new('ShaderNodeMix')
    mix.data_type = 'RGBA'
    mix.inputs['A'].default_value = (*sky['horizon'], 1)
    mix.inputs['B'].default_value = (*sky['zenith'], 1)
    L.new(pw.outputs[0], mix.inputs['Factor'])
    gt = nt.nodes.new('ShaderNodeMath')
    gt.operation = 'GREATER_THAN'
    gt.inputs[1].default_value = 0.0
    L.new(sep.outputs['Z'], gt.inputs[0])
    mix2 = nt.nodes.new('ShaderNodeMix')
    mix2.data_type = 'RGBA'
    mix2.inputs['A'].default_value = (*sky['ground'], 1)
    L.new(mix.outputs['Result'], mix2.inputs['B'])
    L.new(gt.outputs[0], mix2.inputs['Factor'])
    bg = nt.nodes.new('ShaderNodeBackground')
    L.new(mix2.outputs['Result'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = sky['strength']
    L.new(bg.outputs['Background'], out.inputs['Surface'])
    return bg


def make_sun(direction, strength, color):
    ld = bpy.data.lights.new('Sun', 'SUN')
    ld.energy = strength
    ld.color = color
    ld.angle = math.radians(0.53)
    sun = bpy.data.objects.new('Sun', ld)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = B(*direction).to_track_quat('-Z', 'Y').to_euler()
    return sun


def make_lamps(lamps, power, color):
    """lamps: [{'id', 'position', optional 'power'}] -> point lights for the dusk bake."""
    objs = []
    for p in lamps:
        ld = bpy.data.lights.new(p['id'], 'POINT')
        ld.energy = p.get('power', power)
        ld.color = color
        ld.shadow_soft_size = 0.05
        ob = bpy.data.objects.new(p['id'] + '_light', ld)
        bpy.context.scene.collection.objects.link(ob)
        ob.location = B(*p['position'])
        objs.append(ob)
    return objs


def join_for_bake(objs):
    """Cycles pays a set-up cost per baked object, so bake one joined mesh; faces remember
    their node so split_after_bake() restores the exact objects (names are the GLB contract)."""
    names = [o.name for o in objs]
    for i, o in enumerate(objs):
        a = o.data.attributes.new('node_id', 'INT', 'FACE')
        a.data.foreach_set('value', np.full(len(o.data.polygons), i, dtype=np.int32))
    return G.join(objs, 'BAKE_MESH'), names


def split_after_bake(joined, names):
    out = []
    for i, name in enumerate(names):
        me = joined.data.copy()
        bm = bmesh.new()
        bm.from_mesh(me)
        layer = bm.faces.layers.int.get('node_id')
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f[layer] != i], context='FACES')
        bm.to_mesh(me)
        bm.free()
        me.attributes.remove(me.attributes['node_id'])
        me.name = name
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        out.append(ob)
    joined.hide_render = True
    joined.hide_set(True)
    return out


def bake(objs, passes, label, size, btype='DIFFUSE'):
    img = C.new_image(f'lm_{label}', size, size, float_buffer=True, data=True)
    for o in objs:
        C.bake_target(o, img)
    C.select_only(objs, objs[0])
    with C.timed(f'bake {label} {size}^2 @{bpy.context.scene.cycles.samples}spp'):
        if btype == 'NORMAL':
            bpy.ops.object.bake(type='NORMAL', normal_space='OBJECT', margin=0, use_clear=True,
                                uv_layer='UVLightmap', target='IMAGE_TEXTURES')
        else:
            bpy.ops.object.bake(type='DIFFUSE', pass_filter=passes, margin=0, use_clear=True,
                                uv_layer='UVLightmap', target='IMAGE_TEXTURES')
    a = C.image_to_numpy(img)[..., :3].astype(np.float64)
    bpy.data.images.remove(img)
    return a


def dilate(img, mask, iters=24):
    """Pull valid texels outwards into the gutters so bilinear filtering never sees black."""
    out = img.copy()
    m = mask.copy()
    for _ in range(iters):
        acc = np.zeros_like(out)
        cnt = np.zeros(m.shape)
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dx == 0 and dy == 0:
                    continue
                sm = np.roll(np.roll(m, dy, 0), dx, 1)
                acc += np.roll(np.roll(out, dy, 0), dx, 1) * sm[..., None]
                cnt += sm
        grow = (~m) & (cnt > 0)
        out[grow] = acc[grow] / cnt[grow][:, None]
        m = m | grow
        if m.all():
            break
    return out


def lin_to_srgb(x):
    x = np.clip(x, 0, 1)
    return np.where(x <= 0.0031308, 12.92 * x, 1.055 * np.power(x, 1 / 2.4) - 0.055)


def export_glb(objs, path, extras=False):
    C.select_only(objs, objs[0])
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True,
                              export_texcoords=True, export_normals=True, export_tangents=False,
                              export_materials='EXPORT', export_extras=extras, export_yup=True,
                              export_apply=True, export_image_format='AUTO', export_lights=False,
                              export_cameras=False, export_animations=False)
    return os.path.getsize(path)
