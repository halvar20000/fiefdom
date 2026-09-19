"""
Export every static model as glTF for the 3D renderer.

    blender -b -P tools/render/export_glb.py -- --only keep,hovel
    tools/render/export_models.sh                 # all of them, one process each

The builders are the ones the sprite renderers use, unchanged. What glTF
cannot carry is their procedural node materials, so those are BAKED -- but
per MATERIAL, not per model. Each distinct material (castle stone, dark
timber, thatch, a particular cloth colour ...) is baked once, on a flat
4x4-tile plane, into a small tileable colour texture and a tangent-space
normal map. The models keep the world-scale cube-projected UVs their
patterns were built on, and the engine repeats the tile across them.

Why not one bake per model, which is the obvious thing: a 1024^2 texture
spread over every face of a 3x3 keep gives a mortar line about one texel,
and the bricks -- the thing that makes it a castle -- blur away at the zoom
the game is played at. A tile is 256 texels per map tile whatever the model,
which is more than the sprites had. It is also ~25 textures instead of 300,
and a .glb that is geometry only.

Output, under public/assets/models/:
    <name>.glb          geometry, normals, UVs, tangents; materials by key
    models.json         footprints
    mat/<key>_col.webp  baked colour, 4x4 tiles, repeating
    mat/<key>_nrm.webp  tangent-space normal, same
    materials.json      key -> textures, roughness, emissive

A material's key is a hash of its node tree, so two builders that call
castle_stone() get one texture and a cloth in a new colour gets its own.
"""

from __future__ import annotations
import hashlib
import json
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy

import rig
import buildings
import props
import piles

#: The bake plane is this many map tiles on a side; the texture repeats at
#: that period on the model. Big enough that a 3-tile wall face holds at
#: most one seam of the world-space grime, small enough to keep the texture
#: dense.
TILE_SPAN = 4
#: Texels for a patterned material (brick, plank, thatch) and for a plain
#: one (cloth, iron, leaves: noise only, no pattern to keep sharp).
RES_PATTERN = 1024
RES_PLAIN = 256


def parse_args():
    argv = rig.argv_after_dashes()
    out = os.path.join(os.getcwd(), "public", "assets", "models")
    only = None
    i = 0
    while i < len(argv):
        if argv[i] == "--out":
            out = argv[i + 1]; i += 2
        elif argv[i] == "--only":
            only = argv[i + 1].split(","); i += 2
        else:
            i += 1
    return out, only


# ---------------------------------------------------------------------------
# scene plumbing
# ---------------------------------------------------------------------------

def deselect_all():
    for o in bpy.context.selected_objects:
        o.select_set(False)


def setup_bake_scene():
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 8
    scene.cycles.use_denoising = False
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.margin = 4
    scene.render.bake.use_clear = True


def triangulate(obj):
    deselect_all()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    mod = obj.modifiers.new("tri", 'TRIANGULATE')
    mod.quad_method = 'BEAUTY'
    mod.ngon_method = 'BEAUTY'
    bpy.ops.object.modifier_apply(modifier=mod.name)


# ---------------------------------------------------------------------------
# material identity
# ---------------------------------------------------------------------------

def _val(v):
    try:
        return tuple(round(x, 5) for x in v)
    except TypeError:
        return round(v, 5) if isinstance(v, float) else v


def material_key(mat) -> str:
    """A hash of everything that decides what the material looks like."""
    nt = mat.node_tree
    parts = []
    for n in sorted(nt.nodes, key=lambda n: n.name):
        row = [n.name, n.bl_idname]
        for s in n.inputs:
            if hasattr(s, "default_value"):
                row.append((s.name, _val(s.default_value)))
        if n.bl_idname == "ShaderNodeValToRGB":
            row.append(n.color_ramp.interpolation)
            row.append([(round(e.position, 5), _val(e.color)) for e in n.color_ramp.elements])
        for prop in ("noise_dimensions", "voronoi_dimensions", "feature", "distance",
                     "offset_frequency", "squash_frequency", "vector_type", "operation",
                     "blend_type", "invert"):
            if hasattr(n, prop):
                row.append((prop, getattr(n, prop)))
        parts.append(repr(row))
    for l in nt.links:
        parts.append(f"{l.from_node.name}.{l.from_socket.identifier}->{l.to_node.name}.{l.to_socket.identifier}")
    return "m" + hashlib.sha1("\n".join(parts).encode()).hexdigest()[:10]


def is_patterned(mat) -> bool:
    """Does anything read the UV coordinate? Then it is a brick, plank or
    thatch pattern that must stay sharp; noise-only materials can be small."""
    for n in mat.node_tree.nodes:
        if n.bl_idname == "ShaderNodeTexCoord" and n.outputs["UV"].is_linked:
            return True
    return False


def emissive_of(mat):
    """(colour, strength) for an emission-only material, else None."""
    for n in mat.node_tree.nodes:
        if n.bl_idname == "ShaderNodeEmission":
            return list(n.inputs["Color"].default_value)[:3], float(n.inputs["Strength"].default_value)
    return None


def bsdf_of(mat):
    return next((n for n in mat.node_tree.nodes if n.bl_idname == "ShaderNodeBsdfPrincipled"), None)


# ---------------------------------------------------------------------------
# material tile bake
# ---------------------------------------------------------------------------

def save_webp(img, path, quality):
    scene = bpy.context.scene
    scene.render.image_settings.file_format = 'WEBP'
    scene.render.image_settings.quality = quality
    scene.render.image_settings.color_mode = 'RGB'
    img.save_render(path)


def bake_material_tile(mat, key, mat_dir):
    """
    Bake `mat` on a TILE_SPAN x TILE_SPAN plane into mat/<key>_col.webp and
    mat/<key>_nrm.webp. The plane is added to the current scene next to the
    model and removed again; only the selection is baked.
    """
    patterned = is_patterned(mat)
    res = RES_PATTERN if patterned else RES_PLAIN

    deselect_all()
    bpy.ops.mesh.primitive_plane_add(size=TILE_SPAN, location=(0.0, 0.0, 50.0))
    plane = bpy.context.active_object
    # the plane's UV is 0..1; the patterns want map tiles, so every Mapping
    # node hung off a UV coordinate is scaled up by the span
    bake_mat = mat.copy()
    nt = bake_mat.node_tree
    for n in nt.nodes:
        if n.bl_idname == "ShaderNodeMapping" and n.inputs["Vector"].is_linked:
            src = n.inputs["Vector"].links[0].from_socket
            if src.node.bl_idname == "ShaderNodeTexCoord" and src.name == "UV":
                sc = n.inputs["Scale"].default_value
                n.inputs["Scale"].default_value = (sc[0] * TILE_SPAN, sc[1] * TILE_SPAN, sc[2] * TILE_SPAN)
    plane.data.materials.append(bake_mat)

    col = bpy.data.images.new(f"{key}_col", res, res, alpha=False)
    col.colorspace_settings.name = 'sRGB'
    nrm = bpy.data.images.new(f"{key}_nrm", res, res, alpha=False)
    nrm.colorspace_settings.name = 'Non-Color'

    def bake(img, kind):
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        nt.nodes.active = tex
        deselect_all()
        plane.select_set(True)
        bpy.context.view_layer.objects.active = plane
        if kind == 'DIFFUSE':
            bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, use_clear=True, margin=4)
        else:
            bpy.ops.object.bake(type='NORMAL', normal_space='TANGENT', use_clear=True, margin=4)
        nt.nodes.remove(tex)

    t0 = time.time()
    bake(col, 'DIFFUSE')
    bake(nrm, 'NORMAL')
    save_webp(col, os.path.join(mat_dir, f"{key}_col.webp"), 85)
    save_webp(nrm, os.path.join(mat_dir, f"{key}_nrm.webp"), 92)
    print(f"    material {key} ({mat.name}) {res}px in {time.time() - t0:.1f}s", flush=True)
    bpy.data.objects.remove(plane, do_unlink=True)
    bpy.data.materials.remove(bake_mat)
    bpy.data.images.remove(col)
    bpy.data.images.remove(nrm)


def ensure_material(mat, out_dir, registry) -> str:
    """Bake `mat`'s tile if this key has never been seen; return the key."""
    key = material_key(mat)
    if key in registry:
        return key
    mat_dir = os.path.join(out_dir, "mat")
    os.makedirs(mat_dir, exist_ok=True)
    entry = {"name": mat.name, "roughness": 0.85}
    em = emissive_of(mat)
    if em:
        entry["emissive"] = em[0]
        entry["emissiveStrength"] = em[1]
    else:
        bsdf = bsdf_of(mat)
        if bsdf is not None:
            entry["roughness"] = round(float(bsdf.inputs["Roughness"].default_value), 3)
        if not os.path.exists(os.path.join(mat_dir, f"{key}_col.webp")):
            bake_material_tile(mat, key, mat_dir)
        entry["col"] = f"mat/{key}_col.webp"
        entry["nrm"] = f"mat/{key}_nrm.webp"
        entry["span"] = TILE_SPAN
    registry[key] = entry
    return key


# ---------------------------------------------------------------------------
# model export
# ---------------------------------------------------------------------------

def build(name, builder):
    rig.reset_scene()
    setup_bake_scene()
    obj, footprint = builder()
    obj.name = name
    # geom.join leaves the origin wherever the first part sat. Bake the
    # transform into the data so object space IS tile space: origin at the
    # north-west corner of the footprint, +X across, +Y (Blender) down the
    # footprint -- the convention the sprite anchor already assumes.
    deselect_all()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    triangulate(obj)
    return obj, footprint


def export_glb(obj, path):
    deselect_all()
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=True,
        export_materials='EXPORT',
        export_image_format='NONE',
        export_animations=False,
        export_skins=False,
    )


def export_static(name, builder, out_dir, registry):
    obj, footprint = build(name, builder)
    slots = [m for m in obj.data.materials if m is not None]
    keys = [ensure_material(m, out_dir, registry) for m in slots]

    # Then strip every material to a plain BSDF named by its key, so the
    # glTF carries the name and nothing else.
    for slot, key in zip(slots, keys):
        nt = slot.node_tree
        nt.nodes.clear()
        bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
        slot.name = key
    print(f"[{name}] footprint={footprint} verts={len(obj.data.vertices)} "
          f"mats={len(keys)} {sorted(set(keys))}", flush=True)
    export_glb(obj, os.path.join(out_dir, f"{name}.glb"))
    return footprint


def load_json(path):
    if os.path.exists(path):
        with open(path) as fh:
            return json.load(fh)
    return {}


def save_json(path, data):
    with open(path, "w") as fh:
        json.dump(dict(sorted(data.items())), fh, indent=1)


def main():
    out_dir, only = parse_args()
    os.makedirs(out_dir, exist_ok=True)
    registry_all = {**buildings.REGISTRY, **props.REGISTRY, **piles.REGISTRY}
    names = [n for n in registry_all if not only or n in only]

    manifest_path = os.path.join(out_dir, "models.json")
    materials_path = os.path.join(out_dir, "materials.json")
    manifest = load_json(manifest_path)
    materials = load_json(materials_path)

    t_all = time.time()
    for name in names:
        t0 = time.time()
        fp = export_static(name, registry_all[name], out_dir, materials)
        manifest[name] = {"footprint": list(fp)}
        print(f"  -> {name}.glb in {time.time() - t0:.1f}s", flush=True)
        # Written after EVERY model: this Blender build crashes now and then
        # in the bake, and a crash must not lose the ones already done.
        save_json(manifest_path, manifest)
        save_json(materials_path, materials)

    print(f"DONE {len(names)} models in {time.time() - t_all:.1f}s -> {out_dir}", flush=True)


if __name__ == "__main__":
    main()
