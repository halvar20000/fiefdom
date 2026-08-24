"""
The shared render rig.

Every single asset in the game -- keeps, hovels, trees, rocks, peasants -- is
rendered through THIS file and nothing else. That is the whole trick behind the
Stronghold look: it is not the models, it is one identical camera and one
identical sun applied to everything, so the sprites sit together as if they were
photographed in the same place at the same hour.

Conventions
-----------
* 1 Blender unit == 1 map tile.
* +X and +Z are the ground plane. +Y is up (we keep Blender's native +Z-up
  internally but expose tile coords as X/Y ground, see GROUND_UP note below).
* Camera: orthographic, elevation 30 deg, azimuth 45 + 90*k deg.
* Sun: fixed in WORLD space, so rotating the camera shows genuinely different
  lit and shadowed faces of a building -- exactly like the original.
"""

from __future__ import annotations

import json
import math
import os
import sys
from dataclasses import dataclass, asdict

import bpy
from mathutils import Vector

# --- projection ------------------------------------------------------------
# Must stay in lockstep with src/engine/iso.ts
ELEVATION_DEG = 30.0
AZIMUTHS_DEG = (45.0, 135.0, 225.0, 315.0)

TILE_PX_W = 32
SPRITE_RENDER_SCALE = 2
PIXELS_PER_UNIT = (TILE_PX_W / math.sqrt(2.0)) * SPRITE_RENDER_SCALE  # 45.25

# --- sun -------------------------------------------------------------------
# Chosen so that at azimuth 45 the light arrives from the upper-right of the
# screen, matching the shadows in the reference screenshots (they fall down-left).
SUN_ELEVATION_DEG = 48.0
SUN_GROUND_DIR = (1.0, -0.35)   # (x, z) before elevation is applied
SUN_STRENGTH = 3.6
SUN_COLOR = (1.0, 0.935, 0.82)  # warmer midday (visual pass 1.15)
SUN_SOFTNESS_DEG = 4.5          # softer disc; 2.4 gave hard black crenellation shadows

SKY_COLOR = (0.58, 0.555, 0.52)  # warm-neutral fill: cool sky greyed the shadows blue
SKY_STRENGTH = 0.52

# Fill matters more here than it would in a normal render. Every building is
# seen from four sides, and the two facing away from the sun must stay readable
# -- the original's sprites never go to black silhouette. This is deliberately
# strong for that reason, and warm so it does not grey the sandstone.
BOUNCE_COLOR = (0.78, 0.63, 0.42)   # warm light kicked back up off hot sand
BOUNCE_STRENGTH = 1.45

MARGIN_PX = 6                   # transparent breathing room around each sprite


@dataclass
class SpriteMeta:
    """Everything the game needs to place a rendered sprite back on the map."""
    name: str
    rotation: int          # 0..3, index into AZIMUTHS_DEG
    width: int             # px
    height: int            # px
    anchor_x: float        # px from sprite left to the tile-origin ground point
    anchor_y: float        # px from sprite top  to the tile-origin ground point
    footprint: list        # [w, h] in tiles
    scale: int             # SPRITE_RENDER_SCALE the sprite was rendered at


# ---------------------------------------------------------------------------
# scene plumbing
# ---------------------------------------------------------------------------

def reset_scene() -> None:
    """Wipe everything. Renders must never inherit state from a previous run."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = 'NONE'


def set_input(node, name: str, value) -> bool:
    """
    Set a shader node input by name, tolerating Blender's habit of renaming
    Principled BSDF sockets between releases. Returns False if absent.
    """
    if name in node.inputs:
        node.inputs[name].default_value = value
        return True
    return False


def setup_world() -> None:
    """Cool ambient sky fill. Without this, shadow sides read as dead black."""
    world = bpy.data.worlds.new("RigWorld")
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new("ShaderNodeBackground")
    bg.inputs["Color"].default_value = (*SKY_COLOR, 1.0)
    bg.inputs["Strength"].default_value = SKY_STRENGTH
    out = nt.nodes.new("ShaderNodeOutputWorld")
    nt.links.new(bg.outputs["Background"], out.inputs["Surface"])


def sun_vector() -> Vector:
    """Unit vector pointing from the ground TOWARD the sun."""
    el = math.radians(SUN_ELEVATION_DEG)
    gx, gy = SUN_GROUND_DIR
    glen = math.hypot(gx, gy)
    return Vector((
        (gx / glen) * math.cos(el),
        (gy / glen) * math.cos(el),
        math.sin(el),
    ))


def shadow_projected(points):
    """
    Where each point's shadow lands on the ground plane.

    Needed for framing: a building's cast shadow reaches well outside its own
    bounding box, and if the render is framed on geometry alone the shadow gets
    sliced off at the sprite edge, which looks obviously wrong once the sprite
    is placed on the map.
    """
    L = sun_vector()
    out = []
    for p in points:
        if p.z <= 1e-6 or L.z <= 1e-6:
            out.append(Vector((p.x, p.y, 0.0)))
        else:
            out.append(Vector((p.x - L.x * (p.z / L.z),
                               p.y - L.y * (p.z / L.z),
                               0.0)))
    return out


def setup_bounce() -> bpy.types.Object:
    """
    Weak warm fill from below-front, standing in for sunlight bouncing off the
    desert floor. Without it the shadowed walls go cold and grey, which was the
    single biggest thing making early renders look unlike the reference.
    """
    light = bpy.data.lights.new("Bounce", type='SUN')
    light.energy = BOUNCE_STRENGTH
    light.color = BOUNCE_COLOR
    light.angle = math.radians(45.0)

    obj = bpy.data.objects.new("Bounce", light)
    bpy.context.collection.objects.link(obj)

    L = sun_vector()
    direction = Vector((-L.x, -L.y, -0.35)).normalized()   # opposite side, from low down
    obj.location = direction * -40.0
    obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()
    return obj


def setup_sun() -> bpy.types.Object:
    light = bpy.data.lights.new("KeySun", type='SUN')
    light.energy = SUN_STRENGTH
    light.color = SUN_COLOR
    light.angle = math.radians(SUN_SOFTNESS_DEG)

    obj = bpy.data.objects.new("KeySun", light)
    bpy.context.collection.objects.link(obj)

    # Blender is Z-up: ground plane is XY, up is +Z.
    direction = sun_vector()
    obj.location = direction * 40.0
    # point the sun at the origin
    obj.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    return obj


def setup_camera(azimuth_deg: float) -> bpy.types.Object:
    cam_data = bpy.data.cameras.new("IsoCam")
    cam_data.type = 'ORTHO'
    cam_data.clip_start = 0.01
    cam_data.clip_end = 500.0

    cam = bpy.data.objects.new("IsoCam", cam_data)
    bpy.context.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    el = math.radians(ELEVATION_DEG)
    az = math.radians(azimuth_deg)
    direction = Vector((
        math.sin(az) * math.cos(el),
        -math.cos(az) * math.cos(el),
        math.sin(el),
    ))
    cam.location = direction * 100.0
    cam.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
    return cam


def setup_render(samples: int = 128, use_gpu: bool = True) -> None:
    """
    Cycles, because we need three things EEVEE will not give us reliably:
    real ambient occlusion in the stonework, physically soft sun shadows, and
    the shadow-catcher pass that bakes a contact shadow into the sprite alpha.
    """
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 6
    scene.cycles.diffuse_bounces = 3
    scene.cycles.glossy_bounces = 2
    scene.cycles.transmission_bounces = 2

    if use_gpu:
        prefs = bpy.context.preferences.addons.get('cycles')
        if prefs is not None:
            cprefs = prefs.preferences
            for backend in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
                try:
                    cprefs.compute_device_type = backend
                except TypeError:
                    continue
                cprefs.get_devices()
                enabled = False
                for dev in cprefs.devices:
                    dev.use = (dev.type != 'CPU')
                    enabled = enabled or dev.use
                if enabled:
                    scene.cycles.device = 'GPU'
                    break

    scene.render.film_transparent = True
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.image_settings.color_depth = '8'
    scene.render.image_settings.compression = 20
    scene.render.filter_size = 1.2          # slightly soft, avoids sprite aliasing crawl

    # Sprite art wants the colours we actually authored, not a film emulation.
    try:
        scene.view_settings.view_transform = 'Standard'
        scene.view_settings.look = 'None'
    except TypeError:
        pass


def add_shadow_catcher(size: float = 60.0) -> bpy.types.Object:
    """Invisible ground that receives the contact shadow into the alpha channel."""
    bpy.ops.mesh.primitive_plane_add(size=size, location=(0.0, 0.0, 0.0))
    plane = bpy.context.active_object
    plane.name = "ShadowCatcher"
    plane.is_shadow_catcher = True
    plane.visible_diffuse = False
    plane.visible_glossy = False
    return plane


# ---------------------------------------------------------------------------
# framing: fit the render exactly around the object, and remember where the
# tile origin ended up so the game can put the sprite back in the right place
# ---------------------------------------------------------------------------

def _world_bounds(objects) -> list:
    corners = []
    for obj in objects:
        if obj.type != 'MESH':
            continue
        mw = obj.matrix_world
        for c in obj.bound_box:
            corners.append(mw @ Vector(c))
    return corners


def frame_points(cam: bpy.types.Object, points, anchor_world: Vector):
    """
    Frame from explicit world points instead of mesh bounds.

    Animated units need this: the frame must be identical for every animation
    frame and facing, so it is computed once from a fixed box rather than from
    whatever the character's limbs happen to be doing on that frame.
    """
    return _frame_from_corners(cam, list(points), anchor_world)


def frame_object(cam: bpy.types.Object, objects, anchor_world: Vector,
                 extra_points=None):
    """
    Size the render so the subject fills it with a small margin, and compute the
    pixel position of `anchor_world` (the ground point of the object's tile
    origin) inside that render.

    Returns (width_px, height_px, anchor_x_px, anchor_y_px).
    """
    corners = _world_bounds(objects)
    if not corners:
        raise RuntimeError("nothing to frame")
    if extra_points:
        corners = corners + list(extra_points)
    return _frame_from_corners(cam, corners, anchor_world)


def _frame_from_corners(cam, corners, anchor_world: Vector):
    if not corners:
        raise RuntimeError("nothing to frame")

    # Blender evaluates matrix_world lazily. setup_camera() has just set the
    # camera's location and rotation, so without this the matrix is still
    # IDENTITY and the frame below gets computed in world space instead of
    # camera space -- every rotation then yields the same crop, sized by the
    # object's world X/Y extent, and the sprite no longer agrees with the
    # anchor. Symptom: buildings sit correctly at one rotation and visibly
    # slide off their footprint at the others.
    bpy.context.view_layer.update()

    view = cam.matrix_world.inverted()
    pts = [view @ c for c in corners]
    min_x = min(p.x for p in pts)
    max_x = max(p.x for p in pts)
    min_y = min(p.y for p in pts)
    max_y = max(p.y for p in pts)

    margin_units = MARGIN_PX / PIXELS_PER_UNIT
    min_x -= margin_units; max_x += margin_units
    min_y -= margin_units; max_y += margin_units

    width_px = max(2, int(math.ceil((max_x - min_x) * PIXELS_PER_UNIT)))
    height_px = max(2, int(math.ceil((max_y - min_y) * PIXELS_PER_UNIT)))
    # even dimensions keep the half-pixel maths honest when we halve for 1x
    width_px += width_px % 2
    height_px += height_px % 2

    scene = bpy.context.scene
    scene.render.resolution_x = width_px
    scene.render.resolution_y = height_px
    scene.render.resolution_percentage = 100

    # ortho_scale applies to the LARGER render dimension
    larger = max(width_px, height_px)
    cam.data.ortho_scale = larger / PIXELS_PER_UNIT

    # centre the camera on the framed box
    centre_view = Vector(((min_x + max_x) / 2.0, (min_y + max_y) / 2.0, 0.0))
    right = cam.matrix_world.to_3x3() @ Vector((1.0, 0.0, 0.0))
    up = cam.matrix_world.to_3x3() @ Vector((0.0, 1.0, 0.0))
    cam.location = cam.location + right * centre_view.x + up * centre_view.y

    # matrix_world is lazily evaluated -- without this the anchor below is
    # computed against the PRE-move camera and every sprite reports its anchor
    # as the exact image centre, which silently mis-places every building.
    bpy.context.view_layer.update()

    # where did the anchor land?
    view2 = cam.matrix_world.inverted()
    a = view2 @ anchor_world
    anchor_x = (a.x + (width_px / 2.0) / PIXELS_PER_UNIT) * PIXELS_PER_UNIT
    anchor_y = ((height_px / 2.0) / PIXELS_PER_UNIT - a.y) * PIXELS_PER_UNIT
    return width_px, height_px, anchor_x, anchor_y


def render_to(path: str) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def write_meta(path: str, metas) -> None:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump([asdict(m) for m in metas], fh, indent=2)


def argv_after_dashes() -> list:
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
