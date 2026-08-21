"""Smoke test: does the rig run on this Blender, and does stone look like stone?"""
import sys, os, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy
from mathutils import Vector
import rig, materials

rig.reset_scene()
rig.setup_world()
rig.setup_sun()
rig.setup_render(samples=64)
cam = rig.setup_camera(rig.AZIMUTHS_DEG[0])
rig.add_shadow_catcher()

# a 2x2 tile block, 1.6 units tall, sitting on the ground
bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0.0, 0.0, 0.8))
cube = bpy.context.active_object
cube.scale = (1.0, 1.0, 0.8)
cube.data.materials.append(materials.castle_stone())

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(1.6, 0.4, 0.35))
beam = bpy.context.active_object
beam.scale = (0.5, 0.5, 0.35)
beam.data.materials.append(materials.timber())

bpy.ops.mesh.primitive_cone_add(radius1=0.9, depth=1.0, location=(-1.7, 0.0, 0.5))
roof = bpy.context.active_object
roof.data.materials.append(materials.thatch())

subjects = [cube, beam, roof]
w, h, ax, ay = rig.frame_object(cam, subjects, Vector((0.0, 0.0, 0.0)))
print(f"SMOKE framed {w}x{h} anchor=({ax:.1f},{ay:.1f})")

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_tmp", "smoke.png")
rig.render_to(out)
print("SMOKE wrote", out)
