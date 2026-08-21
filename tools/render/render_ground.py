"""
Render ground tile textures, top-down, through the same lighting rig.

    blender -b -P tools/render/render_ground.py -- --out public/assets/tiles

Why top-down and why bake the sun in:
the terrain is a real 3D mesh, so its texture must be a plan view. Because the
sun is fixed in world space and most ground is flat, baking the sun into the
tile gives every pebble and crack its own little shadow for free, and a flat
tile looks identical under all four camera rotations -- which is exactly the
behaviour we want. Sloped tiles get an extra lambert term applied in-engine.

Each type gets several variants, rendered by sliding the plane across world
space so the position-driven procedurals produce a genuinely different patch.
The game then picks a variant per tile, which is what stops 40,000 tiles from
looking like wallpaper.
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
import materials as M

TILE_PX = 128
VARIANTS = 4

TYPES = {
    "sand":       lambda: M.ground_sand(),
    "scrub":      lambda: M.ground_scrub(),
    "grass":      lambda: M.ground_grass(dark=False),
    "grass_dark": lambda: M.ground_grass(dark=True),
    "rock":       lambda: M.rough_stone(),
    "cliff":      lambda: M.ground_cliff(),
    "marsh":      lambda: M.ground_marsh(),
}


def top_down_camera(centre):
    cam_data = bpy.data.cameras.new("TopCam")
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = 1.0
    cam_data.clip_start = 0.01
    cam_data.clip_end = 200.0
    cam = bpy.data.objects.new("TopCam", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = (centre[0], centre[1], 50.0)
    cam.rotation_euler = (0.0, 0.0, 0.0)   # looking straight down -Z
    return cam


def plane(centre, mat):
    cx, cy = centre
    verts = [(cx - 0.5, cy - 0.5, 0.0), (cx + 0.5, cy - 0.5, 0.0),
             (cx + 0.5, cy + 0.5, 0.0), (cx - 0.5, cy + 0.5, 0.0)]
    mesh = bpy.data.meshes.new("Ground")
    mesh.from_pydata(verts, [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new("Ground", mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)
    M.uv_cube_project(obj)
    return obj


def main():
    argv = rig.argv_after_dashes()
    out_dir = os.path.join(os.getcwd(), "public", "assets", "tiles")
    samples = 64
    i = 0
    while i < len(argv):
        if argv[i] == "--out": out_dir = argv[i + 1]; i += 2
        elif argv[i] == "--samples": samples = int(argv[i + 1]); i += 2
        else: i += 1

    index = {"tilePx": TILE_PX, "variants": VARIANTS, "types": list(TYPES.keys())}
    t0 = time.time()

    for ti, (tname, make_mat) in enumerate(TYPES.items()):
        for v in range(VARIANTS):
            rig.reset_scene()
            rig.setup_world()
            rig.setup_sun()
            rig.setup_bounce()
            rig.setup_render(samples=samples)

            scene = bpy.context.scene
            scene.render.film_transparent = False      # ground is opaque
            # tighter reconstruction filter: the default 1.2 blurs away the
            # pebble-scale detail these tiles exist to provide
            scene.render.filter_size = 0.70
            scene.render.resolution_x = TILE_PX
            scene.render.resolution_y = TILE_PX

            # slide across world space so each variant samples different noise
            centre = (13.7 * v + 3.1 * ti, 9.3 * ti - 5.7 * v)
            plane(centre, make_mat())
            top_down_camera(centre)

            path = os.path.join(out_dir, f"{tname}_{v}.png")
            rig.render_to(path)
            print(f"[tile {tname} v{v}] -> {os.path.basename(path)}", flush=True)

    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "tiles.json"), "w") as fh:
        json.dump(index, fh, indent=2)
    print(f"DONE tiles in {time.time() - t0:.1f}s -> {out_dir}", flush=True)


main()
