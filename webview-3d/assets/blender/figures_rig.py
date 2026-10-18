# Shared skeleton for the Diwan figurines: one bone set for the scholar and the apprentice.
#
# Blender space, metres: Z up, the figure faces -Y, +X is the figure's LEFT. The glTF exporter
# turns -Y into +Z, so the figure faces glTF +Z. Bone names follow Blender's .L/.R convention.
#
# The robe hangs from SKIRT_N "cloth chains" around the waist. Each chain has an upper and a
# lower segment bone, both children of hips (never of each other), so the drape solver in
# figures_anim.py can place, aim and stretch each segment independently.
import math

import bpy
from mathutils import Matrix, Vector

FWD = Vector((0, -1, 0))
UP = Vector((0, 0, 1))
LEFT = Vector((1, 0, 0))
SIDES = ('L', 'R')
SIGN = {'L': 1.0, 'R': -1.0}

# Landmarks (rest pose, scholar scale). Crown of the head 1.615, turban top about 1.66.
HIPS = Vector((0, 0.0, 0.92))
SPINE = Vector((0, 0.0, 1.02))
CHEST = Vector((0, 0.005, 1.15))
CHEST_TOP = Vector((0, 0.0, 1.33))
NECK = Vector((0, 0.0, 1.355))
HEAD = Vector((0, -0.008, 1.435))
HEAD_TOP = Vector((0, -0.008, 1.62))

SHOULDER_IN = 0.035
SHOULDER_X = 0.172  # shoulder joint (upper arm head)
SHOULDER_Z = 1.300
UPPER_ARM = 0.28
FOREARM = 0.25
HAND = 0.085  # wrist to knuckles

HIP_X = 0.095
HIP_JOINT_Z = 0.885
THIGH = 0.405
SHIN = 0.40
ANKLE_Z = 0.083

# Cloth chains: waist ring -> knee ring -> hem ring (centre y, radius x, radius y, z).
SKIRT_N = 8
WAIST_RING = (0.008, 0.152, 0.122, 0.975)
KNEE_RING = (0.015, 0.205, 0.188, 0.50)
HEM_RING = (0.02, 0.25, 0.238, 0.055)


def chain_theta(k):
    """Angle of chain k; 0 = front (-Y), increasing towards the figure's left (+X)."""
    return k * 2 * math.pi / SKIRT_N


def ring_point(ring, theta):
    cy, rx, ry, z = ring
    return Vector((rx * math.sin(theta), cy - ry * math.cos(theta), z))


def skirt_names(k):
    return f'skirt{k}_up', f'skirt{k}_lo'


def arm_rest(side):
    """Rest joint positions (shoulder joint, elbow, wrist, knuckles) for an A-pose arm."""
    s = SIGN[side]
    S = Vector((s * SHOULDER_X, 0.012, SHOULDER_Z))
    up_dir = Vector((s * 0.64, -0.04, -0.767)).normalized()
    fo_dir = Vector((s * 0.56, -0.24, -0.79)).normalized()
    E = S + up_dir * UPPER_ARM
    W = E + fo_dir * FOREARM
    hand_dir = Vector((s * 0.52, -0.22, -0.82)).normalized()
    K = W + hand_dir * HAND
    return S, E, W, K


def leg_rest(side):
    s = SIGN[side]
    Hj = Vector((s * HIP_X, 0.0, HIP_JOINT_Z))
    A = Vector((s * HIP_X * 1.02, 0.0, ANKLE_Z))
    # Knee slightly forward of the hip-ankle line so IK knows which way it bends.
    K = Vector((s * HIP_X * 1.01, -0.014, ANKLE_Z + SHIN * 0.999))
    K = Hj + (K - Hj).normalized() * THIGH
    A = K + (A - K).normalized() * SHIN
    T = A + Vector((s * 0.012, -0.125, -0.055))  # ball of the foot
    return Hj, K, A, T


def bone_defs():
    """(name, head, tail, parent, z-axis hint, deform)."""
    d = [
        ('root', Vector((0, 0, 0)), Vector((0, 0, 0.12)), None, FWD, False),
        ('hips', HIPS, SPINE, 'root', FWD, True),
        ('spine', SPINE, CHEST, 'hips', FWD, True),
        ('chest', CHEST, CHEST_TOP, 'spine', FWD, True),
        ('neck', NECK, HEAD, 'chest', FWD, True),
        ('head', HEAD, HEAD_TOP, 'neck', FWD, True),
    ]
    for side in SIDES:
        s = SIGN[side]
        S, E, W, K = arm_rest(side)
        d += [
            (f'shoulder.{side}', Vector((s * SHOULDER_IN, 0.008, 1.305)), S + Vector((0, 0, 0.004)),
             'chest', UP, True),
            (f'upper_arm.{side}', S, E, f'shoulder.{side}', FWD, True),
            (f'forearm.{side}', E, W, f'upper_arm.{side}', FWD, True),
            (f'hand.{side}', W, K, f'forearm.{side}', FWD, True),
        ]
        Hj, Kn, A, T = leg_rest(side)
        d += [
            (f'thigh.{side}', Hj, Kn, 'hips', FWD, True),
            (f'shin.{side}', Kn, A, f'thigh.{side}', FWD, True),
            (f'foot.{side}', A, T, f'shin.{side}', UP, True),
        ]
    for k in range(SKIRT_N):
        th = chain_theta(k)
        out = Vector((math.sin(th), -math.cos(th), 0))
        W, J, H = (ring_point(r, th) for r in (WAIST_RING, KNEE_RING, HEM_RING))
        up, lo = skirt_names(k)
        d += [(up, W, J, 'hips', out, True), (lo, J, H, 'hips', out, True)]
    return d


BONE_NAMES = [b[0] for b in bone_defs()]


def build_armature(name, parent_obj, scale=1.0):
    """Armature object `<name>_rig` under parent_obj. Returns the object."""
    scene = bpy.context.scene
    arm = bpy.data.armatures.new(f'{name}_skeleton')
    ob = bpy.data.objects.new(f'{name}_rig', arm)
    scene.collection.objects.link(ob)
    ob.parent = parent_obj
    ob.scale = (scale, scale, scale)
    bpy.context.view_layer.objects.active = ob
    bpy.ops.object.mode_set(mode='EDIT')
    for bname, head, tail, parent, zaxis, deform in bone_defs():
        eb = arm.edit_bones.new(bname)
        eb.head, eb.tail = head, tail
        eb.align_roll(zaxis)
        eb.use_deform = deform
        if parent:
            eb.parent = arm.edit_bones[parent]
            eb.use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    for pb in ob.pose.bones:
        pb.rotation_mode = 'QUATERNION'
    return ob


def rest_data(arm_ob):
    """Per bone: head, tail, length, parent and the 3x3 rest orientation in armature space."""
    out = {}
    for b in arm_ob.data.bones:
        out[b.name] = {
            'head': b.head_local.copy(),
            'tail': b.tail_local.copy(),
            'length': b.length,
            'parent': b.parent.name if b.parent else None,
            'R': b.matrix_local.to_3x3().normalized(),
            'M': b.matrix_local.copy(),
        }
    return out


def bone_tail_matrix(rest, bname):
    """Armature-space frame a bone-parented child is attached to (the bone's tail)."""
    return rest[bname]['M'] @ Matrix.Translation((0, rest[bname]['length'], 0))
