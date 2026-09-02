"""
Render animated unit sprites from the Mixamo rig.

    blender -b -P tools/render/render_units.py -- --body peasant
    blender -b -P tools/render/render_units.py -- --body ybot --only walk

Only ONE camera azimuth is rendered. Units are drawn in eight world-space
facings and a 90-degree camera rotation simply re-indexes which one is shown
(see unitDirectionIndex in src/engine/iso.ts), so 8 sprites suffice where 8x4
would be 24 duplicates.

Two things this file exists to get right:

* Framing is computed ONCE from a fixed box and reused for every frame and
  facing. Auto-framing per frame would resize the sprite as the arms swing and
  the unit would jitter around its own feet on screen.
* Root motion is removed per frame by re-centring the hips over the origin.
  Mixamo's "In Place" export checkbox is easy to miss -- the Walking clip here
  travels 2.77 units -- and a travelling clip walks straight out of frame.
  Doing it at render time works no matter how the clip was exported.
"""

from __future__ import annotations
import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector

import re

import rig
import materials as M
import peasant as PEASANT

# Relative to this file, so moving the project cannot break it.
SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                   "..", "..", "assets", "source", "mixamo")
CHARACTER = os.path.join(SRC, "YBot_TPose.fbx")
BONE_PREFIX_RE = re.compile(r'mixamorig\d*:')


def detect_prefix(arm) -> str:
    """The bone-name prefix this rig actually uses."""
    for b in arm.data.bones:
        m = BONE_PREFIX_RE.match(b.name)
        if m:
            return m.group(0)
    return "mixamorig:"


def retarget_action(act, prefix: str) -> int:
    """
    Point an action's channels at `prefix`-named bones.

    Mixamo does not guarantee the same bone prefix across downloads: the
    character here rigs as `mixamorig:Hips` while every animation rigs as
    `mixamorig1:Hips`. Assigning such an action binds cleanly and silently
    animates nothing, because no bone matches the paths -- the figure renders
    in a flawless T-pose, which looks like a posing bug rather than a naming
    one. Rewriting the paths is the fix.

    Blender 5.x actions are slotted: fcurves live in layers/strips/channelbags,
    not the removed `Action.fcurves`.
    """
    changed = 0
    for layer in getattr(act, "layers", []) or []:
        for strip in layer.strips:
            for bag in getattr(strip, "channelbags", []) or []:
                for fc in bag.fcurves:
                    new = BONE_PREFIX_RE.sub(prefix, fc.data_path)
                    if new != fc.data_path:
                        fc.data_path = new
                        changed += 1
    return changed

UNIT_HEIGHT_TILES = 0.52
DIRECTIONS = 8

# game clip -> (source fbx, frames to sample, cycle length in seconds)
#
# The third field is what lets the frame counts move at all. The engine used to
# step every clip at a flat ten frames a second, so sampling a walk more finely
# did not make it smoother -- it made it LONGER, and a peasant's legs stopped
# keeping up with the speed he was actually crossing the ground at. Emitting a
# per-clip rate alongside the frame count fixes the cycle in time and lets the
# sampling density be a pure quality knob.
#
# Every duration below is exactly what that clip already played at (its old
# frame count over ten fps), so this pass changes how smooth the animation is
# and nothing else about how it moves.
#
# `chop` and `carry` are absent on purpose: those two come from the 0 A.D.
# motion set via render_0ad.py, which writes the same clip keys. Listing them
# here as well meant whichever renderer ran last won, and running the Mixamo
# one silently replaced a hand-picked woodcutting swing with a baseball bat.
CLIPS = {
    "idle":  ("Idle.fbx", 6, 0.4),
    "walk":  ("Walking.fbx", 12, 0.8),
    "dig":   ("Digging.fbx", 8, 0.6),
    "mine":  ("Heavy Weapon Swing.fbx", 8, 0.6),
    "attack": ("Heavy Weapon Swing.fbx", 8, 0.6),
}


#: Soldier bodies. Same Mixamo rig and the same clips -- only the palette and
#: the kit differ, which is the whole reason peasant.build takes both.
SOLDIERS = {
    "spearman": {
        "palette": {'tunic': (0.44, 0.40, 0.34), 'hood': (0.36, 0.33, 0.28),
                    'hose': (0.26, 0.23, 0.18)},
        "kit": {'helmet': True, 'weapon': 'spear'},
        "attack_src": "Baseball Strike.fbx",     # a thrust, not a woodcutter's swing
    },
    "archer": {
        "palette": {'tunic': (0.30, 0.40, 0.26), 'hood': (0.24, 0.32, 0.20),
                    'hose': (0.28, 0.24, 0.18)},
        "kit": {'weapon': 'bow'},          # no helmet: archers read by silhouette
        # A real archery clip. The bow is bound to LeftHand and the draw is a
        # right-arm pull, so the kit and the motion agree without any tweaking.
        # More frames than the melee swing: a draw is slow then sudden, and six
        # evenly spaced samples land almost all of them on the slow part and
        # miss the loose entirely.
        "attack_src": "Standing Draw Arrow.fbx",
        "attack_frames": 14,
        "attack_seconds": 1.0,
    },
    # The two who do not fight. No weapon in the kit at all, which is the
    # honest silhouette: at sprite scale a man with empty hands reads as a
    # workman, and that is exactly what these are. Palette does the rest --
    # the engineer in tan leather, the tunneller in earth-dark clothes that
    # separate him from both the engineer and the peasant he was.
    "engineer": {
        "palette": {'tunic': (0.64, 0.50, 0.28), 'hood': (0.50, 0.39, 0.22),
                    'hose': (0.34, 0.28, 0.19)},
        "kit": {'helmet': True},
    },
    "tunneler": {
        "palette": {'tunic': (0.29, 0.25, 0.21), 'hood': (0.21, 0.18, 0.15),
                    'hose': (0.19, 0.16, 0.13)},
        "kit": {},
    },
    "swordsman": {
        "palette": {'tunic': (0.55, 0.56, 0.58), 'hood': (0.45, 0.46, 0.48),
                    'hose': (0.26, 0.24, 0.22)},
        "kit": {'helmet': True, 'weapon': 'sword', 'shield': True,
                'shield_colour': (0.58, 0.15, 0.13)},
    },
}


def parse_args():
    argv = rig.argv_after_dashes()
    out = os.path.join(os.getcwd(), "public", "assets", "sprites")
    body, samples, only = "peasant", 48, None
    i = 0
    while i < len(argv):
        if argv[i] == "--out": out = argv[i + 1]; i += 2
        elif argv[i] == "--body": body = argv[i + 1]; i += 2
        elif argv[i] == "--samples": samples = int(argv[i + 1]); i += 2
        elif argv[i] == "--only": only = argv[i + 1].split(","); i += 2
        else: i += 1
    return out, body, samples, only


def import_actions(existing_objects):
    """
    Import each animation file for its ACTION ONLY.

    Every Mixamo animation export ships its own copy of the skeleton. Left in
    the scene they render on top of the real character. Actions are pinned with
    a fake user first, or Blender collects them the moment their armature goes.
    """
    actions = {}
    for clip, (filename, *_rest) in CLIPS.items():
        path = os.path.join(SRC, filename)
        if not os.path.exists(path):
            print(f"!! missing {filename}, skipping clip '{clip}'", flush=True)
            continue
        before = set(bpy.data.actions.keys())
        bpy.ops.import_scene.fbx(filepath=path)
        new = [a for a in bpy.data.actions if a.name not in before]
        for a in bpy.data.actions:
            a.use_fake_user = True
        if new:
            actions[clip] = new[0]
        for name in list(bpy.data.objects.keys()):
            if name not in existing_objects:
                bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    return actions


def dress_ybot(meshes):
    """Recolour Y Bot so the comparison is about shape, not about it being grey."""
    tunic = M.cloth("YTunic", colour=(0.72, 0.65, 0.48))
    joints, _, bsdf = M._new("YJoints")
    M._set(bsdf, "Base Color", (0.34, 0.27, 0.19, 1.0))
    M._set(bsdf, "Roughness", 0.8)
    for m in meshes:
        m.data.materials.clear()
        m.data.materials.append(joints if "Joints" in m.name else tunic)


def evaluated_bounds(meshes):
    deps = bpy.context.evaluated_depsgraph_get()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for m in meshes:
        ev = m.evaluated_get(deps)
        mesh = ev.to_mesh()
        for v in mesh.vertices:
            w = ev.matrix_world @ v.co
            lo = Vector((min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)))
            hi = Vector((max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)))
        ev.to_mesh_clear()
    return lo, hi


def assign_action(arm, action):
    if arm.animation_data is None:
        arm.animation_data_create()
    arm.animation_data.action = action
    slots = getattr(action, "slots", None)
    if slots:
        try:
            arm.animation_data.action_slot = slots[0]
        except Exception:
            pass


def centre_hips(arm, base_z, hips_name):
    """
    Put the hips back over the origin for this frame.

    This is what makes a travelling clip usable: whatever the animation does
    horizontally, the figure stays framed. Vertical motion is left alone so the
    walk keeps its bob and the feet still meet the ground.
    """
    bpy.context.view_layer.update()
    pb = arm.pose.bones.get(hips_name)
    if pb is None:
        return
    world = arm.matrix_world @ pb.matrix.translation
    arm.location.x -= world.x
    arm.location.y -= world.y
    arm.location.z = base_z
    bpy.context.view_layer.update()


def main():
    out_dir, body_kind, samples, only = parse_args()
    t0 = time.time()

    rig.reset_scene()
    rig.setup_world()
    rig.setup_sun()
    rig.setup_bounce()
    rig.setup_render(samples=samples)

    if not os.path.exists(CHARACTER):
        raise SystemExit(f"character not found: {CHARACTER}")

    bpy.ops.import_scene.fbx(filepath=CHARACTER)
    char_objects = set(bpy.data.objects.keys())
    arm = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
    prefix = detect_prefix(arm)
    hips_name = prefix + "Hips"
    print(f"character bone prefix: {prefix!r}", flush=True)

    if body_kind == "ybot":
        meshes = [o for o in bpy.data.objects if o.type == 'MESH']
        dress_ybot(meshes)
    else:
        # drop Y Bot's own mesh and build a body on its skeleton
        for o in [o for o in bpy.data.objects if o.type == 'MESH']:
            bpy.data.objects.remove(o, do_unlink=True)
        char_objects = set(bpy.data.objects.keys())
        spec = SOLDIERS.get(body_kind, {})
        meshes = [PEASANT.build(arm, prefix=prefix,
                                palette=spec.get("palette"), kit=spec.get("kit"))]
        char_objects |= {m.name for m in meshes}

    # Per-body attack motion. CLIPS is module-level and import_actions reads it,
    # so the override has to land before the import.
    spec_clip = SOLDIERS.get(body_kind, {})
    attack_src = spec_clip.get("attack_src")
    if attack_src:
        CLIPS["attack"] = (attack_src,
                           spec_clip.get("attack_frames", CLIPS["attack"][1]),
                           spec_clip.get("attack_seconds", CLIPS["attack"][2]))

    actions = import_actions(char_objects)
    if not actions:
        raise SystemExit("no animations imported")

    for clip, act in actions.items():
        n = retarget_action(act, prefix)
        print(f"  retargeted '{clip}': {n} channels -> {prefix}", flush=True)

    # scale to sprite size
    bpy.context.view_layer.update()
    lo, hi = evaluated_bounds(meshes)
    # Scale by the BODY's height, not the mesh bounds. Kit reaches above the
    # head -- a spear by a good third -- and scaling to include it shrinks the
    # soldier so he stands shorter than the peasants he was recruited from.
    body_extent = meshes[0].get("body_z_extent") if len(meshes) == 1 else None
    raw_h = body_extent if body_extent else (hi.z - lo.z)
    factor = UNIT_HEIGHT_TILES / max(1e-6, raw_h)
    arm.scale = tuple(s * factor for s in arm.scale)
    bpy.context.view_layer.update()
    lo, hi = evaluated_bounds(meshes)
    base_z = -lo.z
    arm.location.z = base_z
    bpy.context.view_layer.update()
    lo, hi = evaluated_bounds(meshes)
    print(f"body={body_kind} height={hi.z - lo.z:.3f} (target {UNIT_HEIGHT_TILES})",
          flush=True)

    rig.add_shadow_catcher(size=6.0)

    # One fixed frame for every sprite, MEASURED from the poses that will
    # actually be rendered.
    #
    # This used to be an analytic guess: a cube of half-width 0.85 * the unit
    # height on both ground axes, plus that cube's cast shadow. It was safe and
    # enormously wasteful. A peasant came out 24x37 pixels of figure inside a
    # 120x98 frame -- eight per cent fill, so ninety-two per cent of every
    # human sprite in the atlas was transparent air, and the atlas is the thing
    # that decides how big a unit is allowed to be. The waste was invisible
    # while a unit was fifteen pixels tall and is the whole problem now that
    # the camera zooms in far enough to look at one.
    #
    # So: walk every frame of every clip in every facing, take the union of the
    # evaluated mesh bounds, and frame that. It is a pose loop with no
    # rendering in it, a second or two, and it cannot be wrong the way a guess
    # can -- a spear tip or a drawn bow is included because it was measured,
    # not because somebody remembered to widen a constant.
    #
    # Note the absence of an `only` filter here. The frame has to be the same
    # for every clip a body owns or the sprite changes size the moment the unit
    # stops walking and starts digging, so a `--only walk` run still measures
    # all five clips and reproduces the frame a full run would have chosen. It
    # renders one clip; it does not re-frame the body around it.
    corners = []
    for clip, action in actions.items():
        nframes = CLIPS[clip][1]
        assign_action(arm, action)
        start, end = action.frame_range
        for f in range(nframes):
            scene_f = start + (end - start) * (f / nframes)
            bpy.context.scene.frame_set(int(round(scene_f)))
            for d in range(DIRECTIONS):
                arm.rotation_euler = (arm.rotation_euler.x, arm.rotation_euler.y,
                                      (d / DIRECTIONS) * math.tau)
                centre_hips(arm, base_z, hips_name)
                plo, phi = evaluated_bounds(meshes)
                for sx in (plo.x, phi.x):
                    for sy in (plo.y, phi.y):
                        for sz in (min(0.0, plo.z), phi.z):
                            corners.append(Vector((sx, sy, sz)))
    if not corners:
        raise SystemExit("nothing to frame: no clips selected")
    # A little slack so the render filter's soft edge has somewhere to land.
    # It does not have to cover the cast shadow's soft tail: rig.MARGIN_PX
    # already adds nine pixels a side, and the measured content of a finished
    # peasant sprite -- body, kit and shadow down to one per cent alpha --
    # occupies 42x39 of the 80x74 frame this produces.
    pad = 0.02
    lo_x = min(c.x for c in corners) - pad
    hi_x = max(c.x for c in corners) + pad
    lo_y = min(c.y for c in corners) - pad
    hi_y = max(c.y for c in corners) + pad
    hi_z = max(c.z for c in corners) + pad
    box = [Vector((sx, sy, sz)) for sx in (lo_x, hi_x)
           for sy in (lo_y, hi_y) for sz in (0.0, hi_z)]
    cam = rig.setup_camera(rig.AZIMUTHS_DEG[0])
    w, h, ax, ay = rig.frame_points(cam, box + rig.shadow_projected(box),
                                    Vector((0.0, 0.0, 0.0)))
    print(f"unit frame {w}x{h} anchor=({ax:.1f},{ay:.1f}) "
          f"from measured box {hi_x - lo_x:.3f} x {hi_y - lo_y:.3f} x {hi_z:.3f}",
          flush=True)

    scene = bpy.context.scene
    metas = []
    clips_meta = {}

    for clip, action in actions.items():
        if only and clip not in only:
            continue
        nframes, seconds = CLIPS[clip][1], CLIPS[clip][2]
        assign_action(arm, action)
        start, end = action.frame_range
        # The atlas key is `${clip}_${dir}_${frame}`, so a soldier reusing the
        # bare clip name 'walk' would silently overwrite the peasant's walk.
        clip_key = clip if body_kind in ("peasant", "ybot") else f"{body_kind}_{clip}"
        clips_meta[clip_key] = {"frames": nframes,
                                "fps": round(nframes / seconds, 3)}

        for f in range(nframes):
            t = start + (end - start) * (f / nframes)
            scene.frame_set(int(round(t)))
            for d in range(DIRECTIONS):
                arm.rotation_euler = (arm.rotation_euler.x, arm.rotation_euler.y,
                                      (d / DIRECTIONS) * math.tau)
                centre_hips(arm, base_z, hips_name)
                name = f"{body_kind}_{clip}_{d}_{f}"
                rig.render_to(os.path.join(out_dir, f"{name}.png"))
                metas.append({
                    "name": name, "clip": clip_key, "direction": d, "frame": f,
                    "width": w, "height": h,
                    "anchor_x": round(ax, 2), "anchor_y": round(ay, 2),
                    "scale": rig.SPRITE_RENDER_SCALE,
                })
        print(f"[{clip}] {nframes} frames x {DIRECTIONS} dirs  "
              f"{time.time() - t0:.1f}s", flush=True)

    # Merge, do not replace. This file is shared with the wildlife renderer, and
    # an outright overwrite here would delete every animal sprite the moment
    # anyone re-rendered a single peasant clip -- exactly the bug that once
    # wiped buildings.json on a --only run.
    os.makedirs(out_dir, exist_ok=True)
    path = os.path.join(out_dir, "units.json")
    index = {"directions": DIRECTIONS, "clips": {}, "sprites": []}
    if os.path.exists(path):
        try:
            with open(path) as fh:
                index = json.load(fh)
        except (ValueError, OSError) as exc:
            print(f"!! ignoring unreadable units.json: {exc}", flush=True)
    index.setdefault("clips", {}).update(clips_meta)
    index["sprites"] = [s for s in index.get("sprites", [])
                        if s.get("clip") not in clips_meta] + metas
    index["directions"] = DIRECTIONS
    with open(path, "w") as fh:
        json.dump(index, fh, indent=2)
    print(f"DONE {len(metas)} unit sprites in {time.time() - t0:.1f}s", flush=True)


main()
