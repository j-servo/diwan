# Diwan figurines: a scholar and an apprentice, built, rigged, animated and exported headless.
#
#   Blender -b --factory-startup --python-exit-code 1 --python assets/blender/figures.py -- [opts]
#     --render turntable,clips,scale,props   also render look-check frames (Eevee) to docs/.../img
#     --no-export                            skip the GLB export
#     --world egypt                          the House of Life's costume set (figures_egypt.py):
#                                            assets/worlds/house-of-life/out/raw/figures-egypt.raw.glb
#                                            + figures-egypt.meta.json; the House of Wisdom's
#                                            default build is untouched.
#
# Output: assets/figures/out/raw/figures.raw.glb and assets/figures/out/figures.meta.json.
# Then run assets/figures/optimize-figures.mjs to make the committed assets/figures/out/figures.glb.
import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import figures_anim as anim  # noqa: E402
import figures_egypt as egypt  # noqa: E402
import figures_geo as geo  # noqa: E402
import figures_props as props  # noqa: E402
import figures_props_egypt as props_egypt  # noqa: E402
import figures_render as rnd  # noqa: E402
import figures_rig as rig  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.normpath(os.path.join(HERE, '..', 'figures', 'out'))
RAW = os.path.join(OUT, 'raw')

APPRENTICE_SCALE = 0.85

# The House of Wisdom's build, rebound by use_world('egypt').
WORLD = {'id': 'wisdom', 'glb': 'figures.glb', 'build_body': geo.build_body, 'props': props,
         'out': OUT, 'raw': RAW}

# name: (sRGB base colour, roughness, metallic, sheen weight, sheen tint sRGB, double sided)
MATERIALS = {
    'skin': ((0.71, 0.53, 0.41), 0.72, 0.0, 0.0, None, False),
    'beard': ((0.56, 0.54, 0.51), 0.92, 0.0, 0.0, None, False),
    'hair': ((0.15, 0.115, 0.095), 0.88, 0.0, 0.0, None, False),
    'robe': ((0.86, 0.81, 0.69), 0.86, 0.0, 0.55, (0.95, 0.92, 0.85), True),
    'cloak': ((0.115, 0.125, 0.20), 0.78, 0.0, 1.0, (0.42, 0.47, 0.66), True),
    'turban': ((0.94, 0.92, 0.87), 0.86, 0.0, 0.45, (1.0, 0.98, 0.94), True),
    # Default agent colour (kermes crimson); the runtime re-tints it per agent. Never turquoise.
    'trim': ((0.70, 0.14, 0.12), 0.62, 0.0, 0.6, (1.0, 0.62, 0.52), True),
    'robe_apprentice': ((0.45, 0.50, 0.63), 0.86, 0.0, 0.55, (0.78, 0.82, 0.95), True),
    'cap': ((0.40, 0.22, 0.15), 0.92, 0.0, 0.3, (0.7, 0.5, 0.4), False),
    'leather': ((0.33, 0.19, 0.12), 0.58, 0.0, 0.0, None, False),
    'reed': ((0.74, 0.62, 0.42), 0.62, 0.0, 0.0, None, False),
    'ink': ((0.05, 0.05, 0.06), 0.4, 0.0, 0.0, None, True),
    'parchment': ((0.91, 0.84, 0.67), 0.82, 0.0, 0.0, None, True),
    'codex_cover': ((0.44, 0.18, 0.11), 0.55, 0.0, 0.0, None, False),
    'brass': ((0.84, 0.65, 0.33), 0.32, 1.0, 0.0, None, True),
    'wax': ((0.95, 0.91, 0.81), 0.45, 0.0, 0.0, None, False),
    'flame': ((1.0, 0.74, 0.36), 0.5, 0.0, 0.0, None, False),
}
FLAME_STRENGTH = 3.0


def use_world(world):
    if world != 'egypt':
        return
    out = os.path.normpath(os.path.join(HERE, '..', 'worlds', 'house-of-life', 'out'))
    WORLD.update({'id': 'egypt', 'glb': 'figures-egypt.glb', 'build_body': egypt.build_body,
                  'props': props_egypt, 'out': os.path.join(out, 'figures'),
                  'raw': os.path.join(out, 'raw'),
                  'materials': egypt.MATERIALS})


def make_materials():
    mats = {}
    for name, (rgb, rough, metal, sheen, tint, double) in WORLD.get('materials', MATERIALS).items():
        m = bpy.data.materials.new(name)
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        bsdf.inputs['Base Color'].default_value = (*rnd.srgb_to_linear(rgb), 1)
        bsdf.inputs['Roughness'].default_value = rough
        bsdf.inputs['Metallic'].default_value = metal
        if sheen > 0:
            bsdf.inputs['Sheen Weight'].default_value = sheen
            bsdf.inputs['Sheen Tint'].default_value = (*rnd.srgb_to_linear(tint), 1)
            bsdf.inputs['Sheen Roughness'].default_value = 0.45
        if name == 'flame':
            bsdf.inputs['Emission Color'].default_value = (*rnd.srgb_to_linear(rgb), 1)
            bsdf.inputs['Emission Strength'].default_value = FLAME_STRENGTH
        m.use_backface_culling = not double
        m.diffuse_color = (*rnd.srgb_to_linear(rgb), 1)
        mats[name] = m
    return mats


def build_figure(kind, mats, scale):
    root = bpy.data.objects.new(kind, None)
    bpy.context.scene.collection.objects.link(root)
    arm_ob = rig.build_armature(kind, root, scale)
    body = WORLD['build_body'](kind)
    mesh_ob = geo.part_to_object(body, f'{kind}_body', mats, arm_ob)
    rest = rig.rest_data(arm_ob)
    prop_obs = WORLD['props'].build_props(kind, arm_ob, rest, mats)
    return {'root': root, 'arm': arm_ob, 'mesh': mesh_ob, 'rest': rest, 'props': prop_obs,
            'tris': sum(len(p.vertices) - 2 for p in mesh_ob.data.polygons)}


def parse_args():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    opts = {'render': set(), 'export': True, 'world': 'wisdom'}
    for i, a in enumerate(argv):
        if a == '--world':
            opts['world'] = argv[i + 1]
        if a == '--render':
            opts['render'] = set(argv[i + 1].split(','))
        if a == '--no-export':
            opts['export'] = False
    return opts


def main():
    opts = parse_args()
    use_world(opts['world'])
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.fps = anim.FPS
    if scene.world is None:
        scene.world = bpy.data.worlds.new('World')
    mats = make_materials()
    figs = {
        'scholar': build_figure('scholar', mats, 1.0),
        'apprentice': build_figure('apprentice', mats, APPRENTICE_SCALE),
    }
    candle = WORLD['props'].build_candle(mats)
    clips = anim.animate(figs['scholar'])
    for k, f in figs.items():
        tris = f['tris'] + sum(props.tri_count(p) for p in f['props'].values())
        print(f'[figures] {k}: body {f["tris"]} tris, with props {tris}', flush=True)
        f['tris_total'] = tris
    if opts['export']:
        export(figs, candle)
        write_meta(figs, clips, candle)
    if opts['render']:
        if WORLD['id'] == 'egypt':
            rnd.IMG = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'docs', 'superpowers',
                                                    'world2', 'img', 'process'))
            egypt.show_variant(bpy, mats, {'kilt', 'belt', 'wig'})
        anim.assign_for_render(figs, clips)
        show_candle(candle, False)
        if 'turntable' in opts['render']:
            render_turntable(scene, figs, clips)
        if 'clips' in opts['render']:
            show_candle(candle, True)
            render_clips(scene, figs, clips)
            show_candle(candle, False)
        if 'scale' in opts['render']:
            render_scale(scene, figs, clips)
        if 'props' in opts['render']:
            show_candle(candle, True)
            render_props(scene, figs, clips)
            show_candle(candle, False)
        if 'portrait' in opts['render']:
            render_portrait(scene, figs, clips)
        if 'walk' in opts['render']:
            render_walk_side(scene, figs, clips)
        if 'costumes' in opts['render']:
            render_costumes(scene, figs, clips, mats)
        if 'seated' in opts['render']:
            render_seated(scene, figs, clips, mats)


def export(figs, candle):
    os.makedirs(WORLD['raw'], exist_ok=True)
    path = os.path.join(WORLD['raw'], WORLD['glb'].replace('.glb', '.raw.glb'))
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_animations=True,
        export_animation_mode='ACTIONS',
        export_anim_single_armature=False,
        export_nla_strips=True,
        export_force_sampling=True,
        export_frame_range=False,
        export_def_bones=False,
        export_leaf_bone=False,
        export_skins=True,
        export_influence_nb=4,
        export_morph=False,
        export_reset_pose_bones=True,
        export_optimize_animation_size=False,
        export_materials='EXPORT',
        export_cameras=False,
        export_lights=False,
    )
    print('[figures] exported', path, f'{os.path.getsize(path) / 1e6:.2f} MB', flush=True)


def pretty_json(v, indent=0, prefix_len=0):
    """JSON laid out the way prettier (printWidth 100) prints it, so the committed meta file
    passes the format hook unchanged: objects expanded, arrays inline when they fit."""
    pad = ' ' * indent
    if isinstance(v, dict):
        if not v:
            return '{}'
        items = [f'{pad}  {json.dumps(k)}: {pretty_json(x, indent + 2, indent + 4 + len(json.dumps(k)))}'
                 for k, x in v.items()]
        return '{\n' + ',\n'.join(items) + '\n' + pad + '}'
    if isinstance(v, list):
        if not v:
            return '[]'
        if all(not isinstance(x, (dict, list)) for x in v):
            one = '[' + ', '.join(json.dumps(x) for x in v) + ']'
            if prefix_len + len(one) + 1 <= 100:
                return one
        items = [pad + '  ' + pretty_json(x, indent + 2, indent + 2) for x in v]
        return '[\n' + ',\n'.join(items) + '\n' + pad + ']'
    return json.dumps(v)


def height(fig, scale):
    return round(max(v.co.z for v in fig['mesh'].data.vertices) * scale, 3)


def write_meta(figs, clips, candle):
    meta = {
        'version': 1,
        'glb': WORLD['glb'],
        'units': 'metres; glTF Y up; figures face +Z',
        'fps': anim.FPS,
        'figures': {
            'scholar': {'node': 'scholar', 'height': height(figs['scholar'], 1.0), 'scale': 1.0,
                        'triangles': figs['scholar']['tris_total']},
            'apprentice': {'node': 'apprentice', 'height': height(figs['apprentice'], APPRENTICE_SCALE),
                           'scale': APPRENTICE_SCALE,
                           'triangles': figs['apprentice']['tris_total']},
        },
        'bones': {'count': len(rig.BONE_NAMES), 'hands': ['hand.R', 'hand.L'],
                  'threeNames': {'hand.R': 'handR', 'hand.L': 'handL'}},
        'clips': {name: {**{k: v for k, v in c.items() if k in ('duration', 'loop', 'seated', 'prop')},
                         **({'transition': True} if name in ('sit_down', 'stand_up') else {})}
                  for name, c in clips.items()},
        'walk': anim.walk_meta(),
        'seated': anim.seated_meta(),
        'materials': {'trim': ('runtime tints the collar per agent; never amethyst'
                               if WORLD['id'] == 'egypt' else 'runtime tints per agent; never turquoise'),
                      'doubleSided': [k for k, v in WORLD.get('materials', MATERIALS).items() if v[5]]},
        'props': props.props_meta(),
        'candle': candle['meta'],
        **({'costume': {'hideable': list(egypt.HIDEABLE),
                        'note': 'every variant is in the mesh; the runtime shows a persona\'s garments '
                                'by material.visible (kilt|dress, shirt, sash, wig|wig_long, belt) and '
                                'recolours skin and trim'}} if WORLD['id'] == 'egypt' else {}),
        'runtimeNotes': [
            'Clips target the scholar skeleton. three GLTFLoader de-duplicates node names, so '
            "the apprentice's bones and props load as <name>_1: strip /_\\d+$/ from names in "
            'the apprentice clone before binding the clips.',
            "three also sanitises '.' out of node names: hand.R loads as handR.",
            'Props carry extras.hidden = true (userData.hidden in three); hide them on load and '
            'show the one clipFor names.',
            'walk is in place: move the root at walk.speedMps x timeScale, or set '
            'timeScale = rootSpeed / walk.speedMps to keep the feet planted.',
            'sit_down (standing idle pose -> sit_idle pose) and stand_up (the reverse) play at '
            'the seat: the root stays at the cushion centre; cross-fade 0.25 s into the next clip.',
        ],
    }
    path = os.path.join(WORLD['out'], WORLD['glb'].replace('.glb', '.figmeta.json' if WORLD['id'] == 'egypt' else '.meta.json'))
    with open(path, 'w') as f:
        f.write(pretty_json(meta) + '\n')
    print('[figures] wrote', path, flush=True)


# ---------------------------------------------------------------- look-check renders


def show_candle(candle, on, at=(-0.27, -0.40, anim.DESK_H)):
    """Render-only: the desk candle at the writer's right, half burnt, or hidden."""
    for ob in (candle['object'], candle['wax'], candle['flame']):
        ob.hide_render = not on
    candle['object'].location = at
    candle['wax'].scale = (1, 1, 0.6)
    candle['flame'].location = (0, 0, props.WAX_BASE + props.WAX_HEIGHT * 0.6)


def hide_props(figs, keep=None):
    for f in figs.values():
        for name, ob in f['props'].items():
            vis = name == keep
            ob.hide_render = not vis
            for ch in ob.children:
                ch.hide_render = not vis


def set_visible(fig, vis):
    for ob in [fig['mesh']]:
        ob.hide_render = not vis


def render_turntable(scene, figs, clips):
    stage = rnd.setup_stage(scene)
    hide_props(figs)
    anim.pose_rest_idle(figs, scene, clips)
    rnd.camera(scene, (0, -4.3, 1.25), (0, 0, 0.84), lens=85)
    panels = []
    for kind in ('scholar', 'apprentice'):
        for k, f in figs.items():
            set_visible(f, k == kind)
        for i in range(8):
            figs[kind]['root'].rotation_euler = (0, 0, math.radians(45 * i))
            panels.append(rnd.load_rgb(rnd.render_png(scene, 330, 560, f'tt{kind}{i}')))
        figs[kind]['root'].rotation_euler = (0, 0, 0)
    for f in figs.values():
        set_visible(f, True)
    rnd.save_jpg(rnd.grid(panels, 8), 'task4-turntable')
    for o in stage:
        bpy.data.objects.remove(o)


def render_clips(scene, figs, clips):
    stage = rnd.setup_stage(scene)
    seat = anim.seated_meta()
    furniture = rnd.add_desk_and_cushion((0, 0), seat)
    fig = figs['scholar']
    figs['apprentice']['root'].location = (40, 0, 0)
    for name, clip in clips.items():
        if clip['seated_any']:
            rnd.camera(scene, (2.0, -2.6, 1.75), (0, -0.05, 0.62), lens=60)
        else:
            rnd.camera(scene, (2.3, -3.0, 1.7), (0, -0.05, 0.86), lens=60)
        hide_props(figs, clip.get('prop'))
        anim.set_clip(figs, clip)
        for o in furniture:
            o.hide_render = not clip['seated_any']
        panels = []
        for i in range(4):
            frame = clip['start'] + round(clip['frames'] * i / 4)
            scene.frame_set(frame)
            panels.append(rnd.load_rgb(rnd.render_png(scene, 520, 600, f'{name}{i}')))
        rnd.save_jpg(rnd.grid(panels, 4), f'task4-clip-{name}')
    for o in stage + furniture:
        bpy.data.objects.remove(o)
    figs['apprentice']['root'].location = (0, 0, 0)
    del fig


def render_scale(scene, figs, clips):
    """The runtime's 22 degree camera, pulled back so a standing figure projects to about 80 px
    on a 1440x900 frame. Left: both figures standing (idle). Right: the scholar writing at the
    desk and the apprentice seated. Prints the measured on-screen height."""
    from bpy_extras.object_utils import world_to_camera_view

    stage = rnd.setup_stage(scene)
    furn = rnd.add_desk_and_cushion((0, 0), anim.seated_meta())
    v_fov, elev = math.radians(22), math.radians(38)
    target_px = 82
    dist = 1.66 * math.cos(elev) * 900 / (target_px * 2 * math.tan(v_fov / 2))
    out = []
    for name, clip_name, frame in (('standing', 'idle', 0), ('seated', 'write', 10)):
        for o in furn:
            o.hide_render = name == 'standing'
        hide_props(figs, 'prop_reed_pen' if name == 'seated' else None)
        anim.set_clip(figs, clips[clip_name])
        scene.frame_set(frame)
        figs['scholar']['root'].location = (0, 0, 0)
        figs['apprentice']['root'].location = (1.3, 0.4, 0) if name == 'standing' else (1.3, 0.2, 0)
        cam = rnd.camera(scene, (0.6, -dist * math.cos(elev), dist * math.sin(elev)), (0.6, 0, 0.7))
        cam.data.sensor_fit = 'VERTICAL'
        cam.data.angle_y = v_fov
        bpy.context.view_layer.update()
        if name == 'standing':
            top = world_to_camera_view(scene, cam, Vector((0, 0, 1.66)))
            foot = world_to_camera_view(scene, cam, Vector((0, 0, 0)))
            px = (top.y - foot.y) * 900
            print(f'[scale] standing scholar projects to {px:.1f} px tall at 1440x900 '
                  f'(camera {dist:.1f} m away, 22 deg, {math.degrees(elev):.0f} deg elevation)', flush=True)
        full = rnd.load_rgb(rnd.render_png(scene, 1440, 900, f'scale_{name}'))
        h, w = full.shape[:2]
        out.append(full[h // 2 - 90:h // 2 + 90, w // 2 - 160:w // 2 + 160])
        if name == 'standing':
            rnd.save_jpg(full, 'task4-scale-22deg')
    crop = np.concatenate([out[0], np.full((180, 6, 3), 0.1, np.float32), out[1]], 1)
    rnd.save_jpg(crop, 'task4-scale-22deg-crop1x')
    rnd.save_jpg(np.repeat(np.repeat(crop, 3, 0), 3, 1), 'task4-scale-22deg-crop3x')
    for o in stage + furn:
        bpy.data.objects.remove(o)
    for f in figs.values():
        f['root'].location = (0, 0, 0)


def render_props(scene, figs, clips):
    stage = rnd.setup_stage(scene)
    seat = anim.seated_meta()
    furn = rnd.add_desk_and_cushion((0, 0), seat)
    figs['apprentice']['root'].location = (40, 0, 0)
    rnd.camera(scene, (0.9, -1.5, 1.25), (0, -0.2, 0.6), lens=70)
    panels = []
    for clip_name in ('write', 'read', 'astrolabe', 'scroll_search', 'receive_letter'):
        clip = clips[clip_name]
        hide_props(figs, clip['prop'])
        anim.set_clip(figs, clip)
        scene.frame_set(clip['start'] + clip['frames'] // 3)
        panels.append(rnd.load_rgb(rnd.render_png(scene, 520, 520, f'prop_{clip_name}')))
    rnd.save_jpg(rnd.grid(panels, 5), 'task4-props')
    for o in stage + furn:
        bpy.data.objects.remove(o)
    figs['apprentice']['root'].location = (0, 0, 0)


def render_portrait(scene, figs, clips):
    """Head and shoulders of both figures, three-quarter and profile."""
    stage = rnd.setup_stage(scene)
    hide_props(figs)
    anim.pose_rest_idle(figs, scene, clips)
    panels = []
    for kind, h in (('scholar', 1.47), ('apprentice', 1.47 * APPRENTICE_SCALE)):
        for k, f in figs.items():
            set_visible(f, k == kind)
        for ang in (-30, 0, 35, 90):
            figs[kind]['root'].rotation_euler = (0, 0, math.radians(ang))
            rnd.camera(scene, (0, -1.15, h + 0.12), (0, 0, h - 0.06), lens=85)
            panels.append(rnd.load_rgb(rnd.render_png(scene, 420, 420, f'pt{kind}{ang}')))
        figs[kind]['root'].rotation_euler = (0, 0, 0)
    for f in figs.values():
        set_visible(f, True)
    rnd.save_jpg(rnd.grid(panels, 4), 'task4-portrait')
    for o in stage:
        bpy.data.objects.remove(o)


def render_walk_side(scene, figs, clips):
    """Side view of one walk cycle with the root moving at walk.speedMps: planted feet stay put
    against the floor marks."""
    stage = rnd.setup_stage(scene)
    hide_props(figs)
    set_visible(figs['apprentice'], False)
    anim.set_clip(figs, clips['walk'])
    marks = []
    for i in range(-6, 7):
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0.25, -i * 0.1, 0.001))
        m = bpy.context.active_object
        m.scale = (0.5, 0.004, 1)
        m.data.materials.append(rnd._mat('mark', (0.15, 0.12, 0.1), 0.9))
        marks.append(m)
    rnd.camera(scene, (3.2, -0.1, 0.55), (0, -0.1, 0.5), lens=50)
    clip = clips['walk']
    panels = []
    root = figs['scholar']['root']
    for i in range(6):
        frame = round(clip['frames'] * i / 6)
        t = frame / anim.FPS
        root.location = (0, -anim.WALK_SPEED * t + 0.1, 0)
        scene.frame_set(frame)
        panels.append(rnd.load_rgb(rnd.render_png(scene, 330, 480, f'walk{i}')))
    root.location = (0, 0, 0)
    set_visible(figs['apprentice'], True)
    rnd.save_jpg(rnd.grid(panels, 6), 'task4-walk-side')
    for o in stage + marks:
        bpy.data.objects.remove(o)


def render_costumes(scene, figs, clips, mats):
    """Egypt: front, three-quarter, side and back of four costumes (a priest with the lector's sash,
    a craftsman in a tunic and wig, a woman in a sheath dress, a pupil)."""
    stage = rnd.setup_stage(scene)
    hide_props(figs)
    anim.pose_rest_idle(figs, scene, clips)
    variants = [
        ('scholar', {'kilt', 'belt', 'sash'}, (0.62, 0.43, 0.29), 1.0),
        ('scholar', {'kilt', 'belt', 'shirt', 'wig'}, (0.69, 0.48, 0.32), 1.0),
        ('scholar', {'dress', 'wig_long'}, (0.72, 0.51, 0.35), 1.0),
        ('apprentice', {'kilt', 'belt'}, (0.66, 0.46, 0.31), 0.85),
    ]
    panels = []
    for kind, vis, skin, sc in variants:
        for k, f in figs.items():
            set_visible(f, k == kind)
        egypt.show_variant(bpy, mats, vis, skin)
        for ang in (0, 40, 90, 180):
            figs[kind]['root'].rotation_euler = (0, 0, math.radians(ang))
            rnd.camera(scene, (0, -3.6, 1.0 * sc + 0.15), (0, 0, 0.84 * sc), lens=85)
            panels.append(rnd.load_rgb(rnd.render_png(scene, 300, 520, f'cos{kind}{ang}{len(panels)}')))
        figs[kind]['root'].rotation_euler = (0, 0, 0)
    for f in figs.values():
        set_visible(f, True)
    egypt.show_variant(bpy, mats, {'kilt', 'belt', 'wig'})
    rnd.save_jpg(rnd.grid(panels, 4), 'b-costumes')
    for o in stage:
        bpy.data.objects.remove(o)


def render_seated(scene, figs, clips, mats):
    """Egypt: the writing pose at the desk, and a walk and the reading pose, scribe in wig + tunic."""
    stage = rnd.setup_stage(scene)
    furn = rnd.add_desk_and_cushion((0, 0), anim.seated_meta())
    figs['apprentice']['root'].location = (40, 0, 0)
    egypt.show_variant(bpy, mats, {'kilt', 'belt', 'wig'}, (0.69, 0.48, 0.32))
    panels = []
    for name, ang in (('write', 0), ('write', 50), ('read', 40), ('astrolabe', 40), ('walk', 40)):
        clip = clips[name]
        hide_props(figs, clip.get('prop'))
        anim.set_clip(figs, clip)
        for o in furn:
            o.hide_render = not clip['seated_any']
        figs['scholar']['root'].rotation_euler = (0, 0, math.radians(ang))
        if clip['seated_any']:
            rnd.camera(scene, (1.1, -2.1, 1.35), (0, -0.1, 0.8), lens=70)
        else:
            rnd.camera(scene, (1.6, -3.0, 1.2), (0, 0, 0.8), lens=70)
        scene.frame_set(clip['start'] + clip['frames'] // 3)
        panels.append(rnd.load_rgb(rnd.render_png(scene, 420, 480, f'sea{name}{ang}')))
    figs['scholar']['root'].rotation_euler = (0, 0, 0)
    rnd.save_jpg(rnd.grid(panels, 5), 'b-seated')
    for o in stage + furn:
        bpy.data.objects.remove(o)
    figs['apprentice']['root'].location = (0, 0, 0)


import numpy as np  # noqa: E402  (used by the render helpers above)

if __name__ == '__main__':
    main()
