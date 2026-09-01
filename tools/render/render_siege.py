"""
Render siege engines, eight facings per frame.

    blender -b -P tools/render/render_siege.py -- --out public/assets/sprites

Same conventions as render_wildlife.py: one camera azimuth (camera rotation
re-indexes the facing) and one fixed frame for every sprite. Merges into the
shared units.json rather than replacing it.
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

import rig
import siege

DIRECTIONS = 8


def parse_args():
    argv = rig.argv_after_dashes()
    out = os.path.join(os.getcwd(), "public", "assets", "sprites")
    samples, only = 96, None
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--samples":
            samples = int(argv[i + 1]); i += 2
        elif argv[i] == "--only":
            only = argv[i + 1].split(","); i += 2
        else:
            i += 1
    return out, samples, only


def merge_units(out_dir, clips_meta, metas):
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
    return len(index["sprites"]), len(index["clips"])


def main():
    out_dir, samples, only = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    t_all = time.time()
    metas, clips_meta = [], {}

    for engine, builder in siege.BUILDERS.items():
        clips = {c: n for c, n in siege.CLIPS.items() if c.startswith(engine + "_")}
        if only:
            clips = {c: n for c, n in clips.items() if c in only or engine in only}
        if not clips:
            continue

        rig.reset_scene()
        rig.setup_world()
        rig.setup_sun()
        rig.setup_bounce()
        rig.setup_render(samples=samples)
        rig.add_shadow_catcher(size=5.0)

        root, objs, parts = builder()

        # One fixed frame per engine, sized for the yaw sweep and the arm at
        # full stretch -- a catapult arm reaches well past the chassis.
        r, top = siege.SCALE * 1.05, siege.SCALE * 1.55
        box = [Vector((sx * r, sy * r, sz))
               for sx in (-1, 1) for sy in (-1, 1) for sz in (0.0, top)]
        cam = rig.setup_camera(rig.AZIMUTHS_DEG[0])
        w, h, ax, ay = rig.frame_points(cam, box + rig.shadow_projected(box),
                                        Vector((0.0, 0.0, 0.0)))
        print(f"{engine} frame {w}x{h} anchor=({ax:.1f},{ay:.1f})", flush=True)

        for clip, (nframes, seconds) in clips.items():
            clips_meta[clip] = {"frames": nframes,
                                "fps": round(nframes / seconds, 3)}
            for f in range(nframes):
                t = f / nframes
                for d in range(DIRECTIONS):
                    siege.pose(parts, clip, t)
                    root.rotation_euler = (0.0, 0.0, (d / DIRECTIONS) * math.tau)
                    bpy.context.view_layer.update()
                    name = f"{clip}_{d}_{f}"
                    rig.render_to(os.path.join(out_dir, f"{name}.png"))
                    metas.append({
                        "name": name, "clip": clip, "direction": d, "frame": f,
                        "width": w, "height": h,
                        "anchor_x": round(ax, 2), "anchor_y": round(ay, 2),
                        "scale": rig.SPRITE_RENDER_SCALE,
                    })
            print(f"[{clip}] {nframes} x {DIRECTIONS} dirs "
                  f"{time.time() - t_all:.1f}s", flush=True)
        _ = objs

    total, nclips = merge_units(out_dir, clips_meta, metas)
    print(f"units.json holds {total} sprites across {nclips} clips", flush=True)
    print(f"DONE {len(metas)} siege sprites in {time.time() - t_all:.1f}s", flush=True)


main()
