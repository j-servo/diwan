# THROWAWAY SPIKE CODE (M1 pipeline spike, 2026-10-12). Not production.
# Blender helpers shared by the spike scripts: Metal GPU setup, numpy mesh building,
# image <-> numpy, bake target nodes, timing.
import json
import os
import time

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'out'))
TEX = os.path.join(OUT, 'tex')
RAW = os.path.join(OUT, 'raw')
for _d in (OUT, TEX, RAW):
    os.makedirs(_d, exist_ok=True)

TIMINGS = {}


class timed:
    def __init__(self, label):
        self.label = label

    def __enter__(self):
        self.t = time.perf_counter()

    def __exit__(self, *a):
        dt = time.perf_counter() - self.t
        TIMINGS[self.label] = round(dt, 2)
        print(f'[timing] {self.label}: {dt:.2f} s', flush=True)


def save_timings(name):
    path = os.path.join(OUT, f'timings_{name}.json')
    with open(path, 'w') as f:
        json.dump(TIMINGS, f, indent=2)


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    return scene


def use_metal_gpu(scene):
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'GPU'
    used = [d.name for d in prefs.devices if d.use]
    print('[gpu] cycles devices:', used, flush=True)
    return used


def mesh_from_numpy(name, verts, faces, smooth=True):
    """verts (N,3) float, faces (F,k) int (uniform polygon size)."""
    me = bpy.data.meshes.new(name)
    faces = np.asarray(faces, dtype=np.int32)
    k = faces.shape[1]
    me.vertices.add(len(verts))
    me.vertices.foreach_set('co', np.asarray(verts, dtype=np.float32).ravel())
    me.loops.add(faces.size)
    me.loops.foreach_set('vertex_index', faces.ravel())
    me.polygons.add(len(faces))
    me.polygons.foreach_set('loop_start', np.arange(0, faces.size, k, dtype=np.int32))
    me.update(calc_edges=True)
    me.validate()
    if smooth:
        me.shade_smooth()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def grid_mesh(name, xs, ys, Z):
    nx, ny = len(xs), len(ys)
    X, Y = np.meshgrid(xs, ys)
    verts = np.stack([X, Y, Z], -1).reshape(-1, 3)
    i = (np.arange(ny - 1)[:, None] * nx + np.arange(nx - 1)[None, :]).ravel()
    quads = np.stack([i, i + 1, i + nx + 1, i + nx], -1)
    return mesh_from_numpy(name, verts, quads)


def new_image(name, w, h, float_buffer=True, data=True):
    img = bpy.data.images.new(name, w, h, alpha=False, float_buffer=float_buffer, is_data=data)
    img.colorspace_settings.name = 'Non-Color' if data else 'sRGB'
    return img


def image_to_numpy(img):
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    return px.reshape(h, w, 4)[::-1]  # row 0 = top


def bake_target(ob, img, uv_name=None):
    """Add (or reuse) an active, unconnected Image Texture node holding img in every material."""
    for slot in ob.material_slots:
        mat = slot.material
        nt = mat.node_tree
        node = nt.nodes.get('BAKE_TARGET') or nt.nodes.new('ShaderNodeTexImage')
        node.name = 'BAKE_TARGET'
        node.image = img
        for n in nt.nodes:
            n.select = False
        node.select = True
        nt.nodes.active = node


def remove_bake_targets(ob):
    for slot in ob.material_slots:
        nt = slot.material.node_tree
        n = nt.nodes.get('BAKE_TARGET')
        if n:
            nt.nodes.remove(n)


def select_only(objs, active):
    for o in bpy.context.view_layer.objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active


def tri_count(ob):
    me = ob.data
    sizes = np.empty(len(me.polygons), dtype=np.int32)
    me.polygons.foreach_get('loop_total', sizes)
    return int((sizes - 2).sum())
