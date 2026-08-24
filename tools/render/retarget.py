"""
Drive our Mixamo-rigged peasant with a COLLADA animation.

The two skeletons are close enough that this is mostly a naming problem: 0
A.D.'s `Biped_hip / spine / chest / shoulder_L / arm_L / forearm_L / hand_L`
lines up one-to-one with Mixamo's `Hips / Spine / Spine2 / LeftShoulder /
LeftArm / LeftForeArm / LeftHand`, and every joint we care about has a partner.

What is NOT the same is the rest pose, and that is what makes this awkward.
Mixamo rigs a T-pose and 0 A.D. does not, so nothing absolute can be copied.

A rotation DELTA from each rig's own rest was the obvious answer and it does
not work: it assumes both skeletons sit the same way round in world space, and
these two do not. Rendered, `farming` came out as a contortion rather than a
man with a hoe.

What works is aiming rather than rotating. For each bone we take the direction
from that joint to its child in the source pose, and turn our bone to point the
same way. A direction is the same fact in both rigs no matter how either one
rests, so the differing rest poses stop mattering. The cost is that twist along
a limb's own axis is lost -- a forearm's roll does not survive -- which is
invisible at the size these sprites are drawn.

Translation is dropped for every bone but the hips, and even there only the
vertical, scaled by the two rigs' hip heights. Bone lengths differ, so copying
limb translation stretches the body.
"""

from __future__ import annotations
import bpy
from mathutils import Matrix, Vector

import collada_anim

#: 0 A.D. joint -> Mixamo bone, without the `mixamorig:` prefix.
#:
#: Each entry is (their joint, our bone, their child joint). The child is what
#: makes this work: we aim our bone at where THEIR bone points, rather than
#: trying to copy an orientation between two rigs that do not share a rest
#: pose. A leaf with no child is driven by its parent alone.
CHAIN = [
    ('Biped_hip',        'Hips',          'Biped_spine'),
    ('Biped_spine',      'Spine',         'Biped_spine1'),
    ('Biped_spine1',     'Spine1',        'Biped_chest'),
    ('Biped_chest',      'Spine2',        'Biped_neck'),
    ('Biped_neck',       'Neck',          'Biped_head'),
    ('Biped_shoulder_L', 'LeftShoulder',  'Biped_arm_L'),
    ('Biped_arm_L',      'LeftArm',       'Biped_forearm_L'),
    ('Biped_forearm_L',  'LeftForeArm',   'Biped_hand_L'),
    ('Biped_shoulder_R', 'RightShoulder', 'Biped_arm_R'),
    ('Biped_arm_R',      'RightArm',      'Biped_forearm_R'),
    ('Biped_forearm_R',  'RightForeArm',  'Biped_hand_R'),
    ('Biped_thigh_L',    'LeftUpLeg',     'Biped_leg_L'),
    ('Biped_leg_L',      'LeftLeg',       'Biped_foot_L'),
    ('Biped_thigh_R',    'RightUpLeg',    'Biped_leg_R'),
    ('Biped_leg_R',      'RightLeg',      'Biped_foot_R'),
]

def _mat(vals) -> Matrix:
    """COLLADA writes 4x4 row-major, which is Matrix()'s own row order."""
    return Matrix((vals[0:4], vals[4:8], vals[8:12], vals[12:16]))


def _world(clip: collada_anim.Clip, local: dict[str, Matrix]) -> dict[str, Matrix]:
    """Accumulate local joint matrices down the hierarchy into world space."""
    out: dict[str, Matrix] = {}

    def resolve(j: str) -> Matrix:
        if j in out:
            return out[j]
        m = local.get(j) or _mat(clip.rest[j])
        p = clip.parent.get(j)
        out[j] = (resolve(p) @ m) if p else m
        return out[j]

    for j in clip.order:
        resolve(j)
    return out


def apply(arm, prefix: str, clip: collada_anim.Clip,
          frames: int, name: str) -> int:
    """
    Bake `frames` evenly spaced samples of `clip` onto `arm` as an action.

    Samples rather than copies keys: our renderer wants a small fixed number of
    frames per clip and the source has fifty-odd. Taking every nth key would
    land wherever the source happened to key; even spacing over the whole
    duration keeps a slow wind-up and a fast release both represented.
    """
    scene = bpy.context.scene
    pose = arm.pose

    ours_rest = {b.name: b.matrix_local.copy() for b in arm.data.bones}
    chain = [(src, prefix + dst, kid) for src, dst, kid in CHAIN
             if src in clip.parent and kid in clip.parent
             and (prefix + dst) in pose.bones]

    hips = prefix + 'Hips'
    rest_world = _world(clip, {j: _mat(clip.rest[j]) for j in clip.order})
    src_hip_z = rest_world['Biped_hip'].translation.z if 'Biped_hip' in rest_world else 1.0
    our_hip_z = ours_rest[hips].translation.z if hips in ours_rest else 1.0
    hip_scale = (our_hip_z / src_hip_z) if src_hip_z else 1.0

    for pb in pose.bones:
        pb.rotation_mode = 'QUATERNION'

    arm.animation_data_create()
    arm.animation_data.action = bpy.data.actions.new(name)

    for i in range(frames):
        # -1 so the last sample is the end of the clip, not one key short of it
        k = round(i * (clip.frames - 1) / max(1, frames - 1)) if clip.frames > 1 else 0
        posed = {j: _mat(clip.track[j][k]) for j in clip.track if k < len(clip.track[j])}
        world = _world(clip, posed)

        scene.frame_set(i + 1)
        # Parents before children: a pose bone's matrix is set in armature
        # space, so a child written before its parent is immediately undone by
        # the parent's move. CHAIN is ordered root-first for exactly this.
        for src, dst, kid in chain:
            if src not in world or kid not in world:
                continue
            want = (world[kid].translation - world[src].translation)
            if want.length < 1e-6:
                continue
            # Into OUR armature's space. The Mixamo rig arrives from FBX with a
            # -90 degree X rotation on the object -- Y-up converted to Z-up --
            # so armature space is not world space, and a direction taken from
            # the source's world frame aims the bone ninety degrees out. The
            # figure came out lying flat on the ground, twice, before this.
            want = (arm.matrix_world.inverted().to_3x3() @ want).normalized()

            pb = pose.bones[dst]
            # pb.vector is the POSED bone's direction, already in armature
            # space. Rotating bone.vector by pb.matrix applies the pose twice
            # and folds the figure flat, which is exactly what it did.
            have = pb.vector.normalized()
            turn = have.rotation_difference(want).to_matrix()

            m = (turn @ pb.matrix.to_3x3()).to_4x4()
            m.translation = pb.matrix.translation
            pb.matrix = m
            bpy.context.view_layer.update()

        if hips in pose.bones and 'Biped_hip' in world:
            pb = pose.bones[hips]
            dz = (world['Biped_hip'].translation.z
                  - rest_world['Biped_hip'].translation.z) * hip_scale
            m = pb.matrix.copy()
            m.translation = ours_rest[hips].translation + Vector((0, 0, dz))
            pb.matrix = m
            bpy.context.view_layer.update()

        for _, dst, _ in chain:
            pose.bones[dst].keyframe_insert('rotation_quaternion', frame=i + 1)
        if hips in pose.bones:
            pose.bones[hips].keyframe_insert('location', frame=i + 1)

    scene.frame_start = 1
    scene.frame_end = frames
    return len(chain)
