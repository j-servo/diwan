# Eevee look-check renders for the figurines: turntable, per-clip contact sheets, scale check.
# Not part of the shipped asset; frames go to docs/superpowers/m1/img/task4-*.jpg.
import math
import os
import tempfile

import bpy
import numpy as np
from mathutils import Euler, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
IMG = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'docs', 'superpowers', 'm1', 'img'))
TMP = tempfile.mkdtemp(prefix='diwan-fig-')


def srgb_to_linear(c):
    return [((v + 0.055) / 1.055) ** 2.4 if v > 0.04045 else v / 12.92 for v in c]


def _mat(name, rgb, rough=0.8):
    m = bpy.data.materials.new(name)
    nt = m.node_tree
    bsdf = nt.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*srgb_to_linear(rgb), 1)
    bsdf.inputs['Roughness'].default_value = rough
    return m


def setup_stage(scene, seated_props=False):
    """Warm stone floor, golden key light, soft fill. Returns the list of stage objects."""
    scene.render.engine = 'BLENDER_EEVEE'
    scene.view_settings.view_transform = 'Khronos PBR Neutral'
    scene.view_settings.look = 'None'
    scene.render.film_transparent = False
    world = scene.world
    world.color = (0.08, 0.075, 0.07)
    wnt = world.node_tree
    bg = wnt.nodes.get('Background')
    if bg:
        bg.inputs['Color'].default_value = (0.20, 0.17, 0.14, 1)
        bg.inputs['Strength'].default_value = 0.55
    stage = []
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0))
    floor = bpy.context.active_object
    floor.name = 'stage_floor'
    floor.data.materials.append(_mat('stage_stone', (0.58, 0.50, 0.42), 0.9))
    stage.append(floor)
    sun = bpy.data.lights.new('stage_sun', 'SUN')
    sun.energy = 3.2
    sun.color = (1.0, 0.86, 0.68)
    sun.angle = math.radians(3)
    so = bpy.data.objects.new('stage_sun', sun)
    so.rotation_euler = Euler((math.radians(52), 0, math.radians(-38)))
    scene.collection.objects.link(so)
    stage.append(so)
    fill = bpy.data.lights.new('stage_fill', 'AREA')
    fill.energy = 120
    fill.size = 3
    fill.color = (0.80, 0.86, 1.0)
    fo = bpy.data.objects.new('stage_fill', fill)
    fo.location = (3.0, -3.5, 2.6)
    fo.rotation_euler = Euler((math.radians(60), 0, math.radians(40)))
    scene.collection.objects.link(fo)
    stage.append(fo)
    rim = bpy.data.lights.new('stage_rim', 'AREA')
    rim.energy = 90
    rim.size = 2
    rim.color = (1.0, 0.9, 0.75)
    ro = bpy.data.objects.new('stage_rim', rim)
    ro.location = (-1.5, 3.0, 2.8)
    ro.rotation_euler = Euler((math.radians(-55), 0, math.radians(200)))
    scene.collection.objects.link(ro)
    stage.append(ro)
    return stage


def add_desk_and_cushion(origin, meta):
    """Proxy cushion and low desk matching the seated contract (render only)."""
    objs = []
    cx, cy = origin
    ch = meta['cushionHeight']
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy + 0.02, ch / 2))
    c = bpy.context.active_object
    c.scale = (0.62, 0.62, ch)
    c.name = 'stage_cushion'
    c.data.materials.append(_mat('stage_cushion', (0.45, 0.22, 0.16), 0.95))
    bpy.ops.object.modifier_add(type='BEVEL')
    c.modifiers[-1].width = 0.04
    c.modifiers[-1].segments = 3
    objs.append(c)
    near = meta['deskNearEdge']
    depth, width, top = 0.36, 0.78, meta['deskHeight']
    bpy.ops.mesh.primitive_cube_add(size=1, location=(cx, cy - near - depth / 2, top - 0.02))
    d = bpy.context.active_object
    d.scale = (width, depth, 0.04)
    d.name = 'stage_desk'
    cedar = _mat('stage_cedar', (0.42, 0.26, 0.16), 0.6)
    d.data.materials.append(cedar)
    objs.append(d)
    for sx in (-1, 1):
        for sy in (0, 1):
            bpy.ops.mesh.primitive_cube_add(
                size=1,
                location=(cx + sx * (width / 2 - 0.04), cy - near - 0.04 - sy * (depth - 0.08),
                          (top - 0.04) / 2))
            leg = bpy.context.active_object
            leg.scale = (0.04, 0.04, top - 0.04)
            leg.data.materials.append(cedar)
            objs.append(leg)
    bpy.ops.mesh.primitive_plane_add(size=1, location=(cx - 0.02, cy - near - 0.12, top + 0.001))
    paper = bpy.context.active_object
    paper.scale = (0.22, 0.16, 1)
    paper.data.materials.append(_mat('stage_paper', (0.92, 0.86, 0.70), 0.8))
    objs.append(paper)
    return objs


def camera(scene, loc, target, lens=85, ortho=None):
    cam_data = bpy.data.cameras.new('look_cam')
    cam_data.lens = lens
    cam_data.clip_end = 300
    if ortho:
        cam_data.type = 'ORTHO'
        cam_data.ortho_scale = ortho
    cam = bpy.data.objects.new('look_cam', cam_data)
    scene.collection.objects.link(cam)
    cam.location = loc
    direction = Vector(target) - Vector(loc)
    cam.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam
    return cam


def render_png(scene, w, h, name):
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    path = os.path.join(TMP, name + '.png')
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    return path


def load_rgb(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    bpy.data.images.remove(img)
    return px.reshape(h, w, 4)[::-1, :, :3]  # row 0 = top


def save_jpg(arr, name, quality=88):
    """arr: HxWx3 floats (display-referred, row 0 = top)."""
    os.makedirs(IMG, exist_ok=True)
    h, w = arr.shape[:2]
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[:, :, :3] = np.clip(arr, 0, 1)
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    img.pixels.foreach_set(rgba[::-1].ravel())
    path = os.path.join(IMG, name + '.jpg')
    img.filepath_raw = path
    img.file_format = 'JPEG'
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'JPEG'
    scene.render.image_settings.quality = quality
    img.save_render(path, scene=scene)
    bpy.data.images.remove(img)
    print('[render] wrote', path, flush=True)
    return path


def grid(panels, cols, pad=4, bg=0.12):
    h, w = panels[0].shape[:2]
    rows = math.ceil(len(panels) / cols)
    out = np.full((rows * h + (rows + 1) * pad, cols * w + (cols + 1) * pad, 3), bg, np.float32)
    for i, p in enumerate(panels):
        r, c = divmod(i, cols)
        y, x = pad + r * (h + pad), pad + c * (w + pad)
        out[y:y + h, x:x + w] = p
    return out
