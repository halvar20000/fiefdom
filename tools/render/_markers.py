"""Render markers at known Blender points, then report their pixel positions.

Ground truth for the sprite anchor convention: if the engine's assumed mapping
is right, marker offsets from the reported anchor must match its prediction.
"""
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bpy, numpy as np
from mathutils import Vector
import rig, materials as M

OUT = "/private/tmp/claude-501/-Users-thomasherbrig-AI-Traiding/c04f873d-5caa-4703-b296-2b11d5fe65ad/scratchpad/markers"
os.makedirs(OUT, exist_ok=True)
W = D = 3.0
MARKS = {                      # name: (blender point, emission colour)
    "origin": ((0.0, 0.0, 0.0), (1, 0, 0)),
    "plusX":  ((W,   0.0, 0.0), (0, 1, 0)),
    "plusY":  ((0.0, D,   0.0), (0, 0, 1)),
}

def emissive(colour):
    mat = bpy.data.materials.new("m")
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    e = nt.nodes.new("ShaderNodeEmission")
    e.inputs["Color"].default_value = (*colour, 1.0)
    e.inputs["Strength"].default_value = 40.0
    o = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(e.outputs["Emission"], o.inputs["Surface"])
    return mat

report = {}
for rot, az in enumerate(rig.AZIMUTHS_DEG):
    rig.reset_scene(); rig.setup_world(); rig.setup_sun(); rig.setup_bounce()
    rig.setup_render(samples=16)
    objs = []
    for name, (p, col) in MARKS.items():
        bpy.ops.mesh.primitive_cube_add(size=0.16, location=p)
        o = bpy.context.active_object
        o.data.materials.append(emissive(col))
        objs.append(o)
    cam = rig.setup_camera(az)
    w, h, ax, ay = rig.frame_object(cam, objs, Vector((0.0, 0.0, 0.0)))
    path = os.path.join(OUT, f"m{rot}.png")
    rig.render_to(path)

    im = bpy.data.images.load(path)
    a = np.array(im.pixels[:], dtype=np.float32).reshape(im.size[1], im.size[0], 4)
    a = a[::-1]                                    # PNG rows are bottom-up here
    found = {}
    for name, (_, col) in MARKS.items():
        c = np.array(col, dtype=np.float32)
        # pixel is this marker if its dominant channel matches and it is bright
        rgb = a[:, :, :3]; alpha = a[:, :, 3]
        dom = np.argmax(rgb, axis=2)
        want = int(np.argmax(c))
        mask = (dom == want) & (rgb.max(axis=2) > 0.5) & (alpha > 0.5)
        ys, xs = np.nonzero(mask)
        found[name] = [round(float(xs.mean()), 1), round(float(ys.mean()), 1)] if len(xs) else None
    report[f"rot{rot}"] = {"sprite": [w, h], "anchor": [round(ax,1), round(ay,1)], "marks": found}

print("MARKERS " + json.dumps(report))
