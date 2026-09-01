"""
Procedural materials for the sprite renderer.

Node-generated rather than image-textured: keeps the pipeline scriptable and
licence-free, and at the 40-120px a building occupies on screen, procedural
stone with real bump and AO is indistinguishable from scanned stone.

Two hard-won rules encoded here:

1. Patterned materials (brick courses, planking) are driven by UV coordinates,
   not world position. World-space procedurals streak badly on vertical walls
   because a wall in the YZ plane has constant X. Call `uv_cube_project(obj)`
   on any mesh using these -- it gives per-face planar UVs at true world scale,
   so a 0.4-unit brick is 0.4 units on every face of every building.
2. No Mix / MixRGB nodes anywhere. Their socket naming has churned across
   releases and fails silently. Colours are combined with VectorMath MULTIPLY,
   and gradients come from ColorRamp. Both have been stable for years.

Frequencies are expressed in tiles: 1.0 == one map tile.
"""

from __future__ import annotations
import bpy


# --- geometry helper -------------------------------------------------------

def uv_cube_project(obj) -> None:
    """Per-face planar UVs at world scale. Required by any patterned material."""
    prev = bpy.context.view_layer.objects.active
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.cube_project(cube_size=1.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    obj.select_set(False)
    if prev is not None:
        bpy.context.view_layer.objects.active = prev


# --- node plumbing ---------------------------------------------------------

def _new(name: str):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat, nt, bsdf


def _set(node, name, value) -> bool:
    if name in node.inputs:
        node.inputs[name].default_value = value
        return True
    return False


def _uv(nt, scale=1.0):
    """UV coordinates, optionally rescaled. Use for anything with a pattern."""
    tc = nt.nodes.new("ShaderNodeTexCoord")
    m = nt.nodes.new("ShaderNodeMapping")
    _set(m, "Scale", (scale, scale, scale))
    nt.links.new(tc.outputs["UV"], m.inputs["Vector"])
    return m.outputs["Vector"]


def _pos(nt, scale=1.0):
    """World position. Use for non-directional grunge only."""
    g = nt.nodes.new("ShaderNodeNewGeometry")
    m = nt.nodes.new("ShaderNodeMapping")
    _set(m, "Scale", (scale, scale, scale))
    nt.links.new(g.outputs["Position"], m.inputs["Vector"])
    return m.outputs["Vector"]


def _ramp(nt, stops, vector=None):
    node = nt.nodes.new("ShaderNodeValToRGB")
    el = node.color_ramp.elements
    while len(el) > 1:
        el.remove(el[-1])
    el[0].position, el[0].color = stops[0]
    for pos, col in stops[1:]:
        el.new(pos).color = col
    if vector is not None:
        nt.links.new(vector, node.inputs["Fac"])
    return node


def _noise(nt, vector=None, scale=8.0, detail=8.0, roughness=0.55, distortion=0.0):
    n = nt.nodes.new("ShaderNodeTexNoise")
    _set(n, "Scale", scale)
    _set(n, "Detail", detail)
    _set(n, "Roughness", roughness)
    _set(n, "Distortion", distortion)
    if vector is not None:
        nt.links.new(vector, n.inputs["Vector"])
    return n


def _mulcol(nt, a_socket, b_socket):
    """Multiply two colours. VectorMath is stable where Mix is not."""
    v = nt.nodes.new("ShaderNodeVectorMath")
    v.operation = 'MULTIPLY'
    nt.links.new(a_socket, v.inputs[0])
    nt.links.new(b_socket, v.inputs[1])
    return v.outputs["Vector"]


def _mul(nt, a_socket, factor):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = 'MULTIPLY'
    nt.links.new(a_socket, m.inputs[0])
    m.inputs[1].default_value = factor
    return m.outputs["Value"]


def _add(nt, a_socket, b_socket):
    m = nt.nodes.new("ShaderNodeMath")
    m.operation = 'ADD'
    nt.links.new(a_socket, m.inputs[0])
    nt.links.new(b_socket, m.inputs[1])
    return m.outputs["Value"]


def _bump(nt, bsdf, height_socket, strength=0.5, distance=0.03):
    b = nt.nodes.new("ShaderNodeBump")
    _set(b, "Strength", strength)
    _set(b, "Distance", distance)
    nt.links.new(height_socket, b.inputs["Height"])
    nt.links.new(b.outputs["Normal"], bsdf.inputs["Normal"])
    return b


# ---------------------------------------------------------------------------
# materials
# ---------------------------------------------------------------------------

def castle_stone(name="CastleStone"):
    """
    Pale sandy limestone ashlar -- the Crusader keep and curtain walls.
    Courses are ~0.40 x 0.20 tiles, matching the block count visible in the
    reference keep screenshot (roughly 10 courses over a 2-tile-tall wall).
    """
    mat, nt, bsdf = _new(name)
    uv = _uv(nt)

    brick = nt.nodes.new("ShaderNodeTexBrick")
    nt.links.new(uv, brick.inputs["Vector"])
    _set(brick, "Scale", 1.0)
    # 0.40 x 0.20 was measured off the reference at the old zoom ceiling, where
    # a course was ten screen pixels. At three times tile scale the same block
    # is nearly forty across and reads as masonry from a toy castle, so the
    # course is tightened by a fifth: still the reference's proportions, but
    # enough blocks in a wall that the eye stops counting them.
    _set(brick, "Brick Width", 0.32)
    _set(brick, "Row Height", 0.16)
    _set(brick, "Mortar Size", 0.016)
    _set(brick, "Mortar Smooth", 0.20)
    _set(brick, "Bias", 0.0)
    # block-to-block colour variation lives in Color1/Color2
    # wide spread between the two block colours: the reference walls read as
    # patchwork, individual stones noticeably lighter and darker than neighbours
    _set(brick, "Color1", (0.87, 0.73, 0.47, 1.0))
    _set(brick, "Color2", (0.67, 0.53, 0.31, 1.0))
    _set(brick, "Mortar", (0.40, 0.34, 0.25, 1.0))

    # two weathering scales: broad staining plus tighter dirt streaks
    grime = _noise(nt, _pos(nt, 1.0), scale=2.2, detail=9.0, roughness=0.65)
    grime_ramp = _ramp(nt, [
        (0.30, (0.52, 0.47, 0.39, 1.0)),
        (0.62, (0.92, 0.88, 0.80, 1.0)),
        (1.00, (1.10, 1.06, 0.98, 1.0)),
    ], grime.outputs["Fac"])

    stain = _noise(nt, _pos(nt, 1.0), scale=0.8, detail=6.0, roughness=0.5)
    stain_ramp = _ramp(nt, [
        (0.35, (0.74, 0.69, 0.60, 1.0)),
        (0.65, (1.02, 1.00, 0.96, 1.0)),
    ], stain.outputs["Fac"])

    weathered = _mulcol(nt, grime_ramp.outputs["Color"], stain_ramp.outputs["Color"])
    nt.links.new(_mulcol(nt, brick.outputs["Color"], weathered),
                 bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.84)
    _set(bsdf, "Metallic", 0.0)

    # bump: mortar recesses plus fine pitting in the stone face
    pit = _noise(nt, _pos(nt, 1.0), scale=90.0, detail=6.0, roughness=0.7)
    height = _add(nt, _mul(nt, brick.outputs["Fac"], 1.0), _mul(nt, pit.outputs["Fac"], 0.28))
    _bump(nt, bsdf, height, strength=1.05, distance=0.034)
    return mat


def flagstone(name="Flagstone"):
    """Large flat paving slabs -- keep decks, stockpile floors, courtyards."""
    mat, nt, bsdf = _new(name)
    uv = _uv(nt)

    brick = nt.nodes.new("ShaderNodeTexBrick")
    nt.links.new(uv, brick.inputs["Vector"])
    _set(brick, "Scale", 1.0)
    _set(brick, "Brick Width", 0.52)
    _set(brick, "Row Height", 0.46)
    _set(brick, "Mortar Size", 0.020)
    _set(brick, "Mortar Smooth", 0.30)
    _set(brick, "Color1", (0.74, 0.65, 0.47, 1.0))
    _set(brick, "Color2", (0.63, 0.55, 0.39, 1.0))
    _set(brick, "Mortar", (0.42, 0.36, 0.28, 1.0))

    wear = _noise(nt, _pos(nt, 1.0), scale=6.0, detail=8.0, roughness=0.6)
    wear_ramp = _ramp(nt, [
        (0.32, (0.70, 0.66, 0.58, 1.0)),
        (0.66, (1.00, 0.98, 0.94, 1.0)),
    ], wear.outputs["Fac"])
    nt.links.new(_mulcol(nt, brick.outputs["Color"], wear_ramp.outputs["Color"]),
                 bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.90)

    grit = _noise(nt, _pos(nt, 1.0), scale=70.0, detail=6.0)
    h = _add(nt, _mul(nt, brick.outputs["Fac"], 1.0), _mul(nt, grit.outputs["Fac"], 0.22))
    _bump(nt, bsdf, h, strength=0.6, distance=0.018)
    return mat


def rough_stone(name="RoughStone"):
    """Undressed rubble -- quarry blocks, cliff faces, wall footings."""
    mat, nt, bsdf = _new(name)
    pos = _pos(nt, 1.0)

    vor = nt.nodes.new("ShaderNodeTexVoronoi")
    nt.links.new(pos, vor.inputs["Vector"])
    _set(vor, "Scale", 8.0)
    vor.feature = 'F1'

    ramp = _ramp(nt, [
        (0.02, (0.16, 0.15, 0.13, 1.0)),
        (0.30, (0.30, 0.27, 0.23, 1.0)),
        (0.72, (0.42, 0.38, 0.32, 1.0)),
        (1.00, (0.50, 0.45, 0.38, 1.0)),
    ], vor.outputs["Distance"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.92)

    grit = _noise(nt, pos, scale=80.0, detail=6.0)
    h = _add(nt, _mul(nt, vor.outputs["Distance"], 1.0), _mul(nt, grit.outputs["Fac"], 0.3))
    _bump(nt, bsdf, h, strength=1.0, distance=0.05)
    return mat


def timber(name="Timber", dark=False):
    """Structural beams and planking. Grain runs along UV.x."""
    mat, nt, bsdf = _new(name)
    uv = _uv(nt)

    # stretch the noise along the grain direction
    stretch = nt.nodes.new("ShaderNodeMapping")
    _set(stretch, "Scale", (0.22, 5.0, 1.0))
    nt.links.new(uv, stretch.inputs["Vector"])

    grain = _noise(nt, stretch.outputs["Vector"], scale=6.0, detail=9.0,
                   roughness=0.55, distortion=1.2)
    if dark:
        stops = [(0.25, (0.14, 0.09, 0.05, 1.0)),
                 (0.60, (0.26, 0.17, 0.09, 1.0)),
                 (1.00, (0.36, 0.25, 0.14, 1.0))]
    else:
        stops = [(0.22, (0.30, 0.19, 0.10, 1.0)),
                 (0.58, (0.50, 0.35, 0.19, 1.0)),
                 (1.00, (0.66, 0.50, 0.30, 1.0))]
    ramp = _ramp(nt, stops, grain.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.80)

    _bump(nt, bsdf, grain.outputs["Fac"], strength=0.45, distance=0.012)
    return mat


def shingle_wood(name="Shingle"):
    """
    Weathered split shingles -- greyer, cooler and more mottled than structural
    timber.

    A roof is the largest single surface on most of these buildings and it is
    seen almost face-on from this camera, so using the same warm `timber()` for
    the roof as for the posts flattened the two together. Silvered grey against
    dark oak separates them, and the strong board-to-board value spread keeps
    the individual shingles readable now that they are real geometry rather
    than a pattern.
    """
    mat, nt, bsdf = _new(name)
    uv = _uv(nt)

    # grain runs down the slope, i.e. along the short axis of a shingle
    stretch = nt.nodes.new("ShaderNodeMapping")
    _set(stretch, "Scale", (4.0, 0.30, 1.0))
    nt.links.new(uv, stretch.inputs["Vector"])
    grain = _noise(nt, stretch.outputs["Vector"], scale=7.0, detail=9.0,
                   roughness=0.6, distortion=0.9)
    ramp = _ramp(nt, [
        (0.20, (0.17, 0.12, 0.08, 1.0)),
        (0.50, (0.32, 0.24, 0.16, 1.0)),
        (0.78, (0.47, 0.37, 0.25, 1.0)),
        (1.00, (0.58, 0.47, 0.33, 1.0)),
    ], grain.outputs["Fac"])

    # board-to-board value shift: cell noise on world position, so neighbouring
    # shingles differ from each other rather than every board being identical
    board = nt.nodes.new("ShaderNodeTexVoronoi")
    nt.links.new(_pos(nt, 1.0), board.inputs["Vector"])
    _set(board, "Scale", 14.0)
    board_ramp = _ramp(nt, [
        (0.00, (0.74, 0.74, 0.74, 1.0)),
        (1.00, (1.18, 1.16, 1.12, 1.0)),
    ], board.outputs["Color"])

    nt.links.new(_mulcol(nt, ramp.outputs["Color"], board_ramp.outputs["Color"]),
                 bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.93)
    _bump(nt, bsdf, grain.outputs["Fac"], strength=0.55, distance=0.010)
    return mat


def thatch(name="Thatch"):
    """Straw roofing. The directional bump is what sells it."""
    mat, nt, bsdf = _new(name)
    uv = _uv(nt)

    # Straws run down the slope: stretch hard along one UV axis. Finer and
    # higher contrast than it used to be -- at three times tile scale the old
    # frequency put one straw across eight screen pixels, which averaged out to
    # flat card, and the ramp topped out too pale to read as anything but
    # bleached paper next to the lime panels below it.
    stretch = nt.nodes.new("ShaderNodeMapping")
    _set(stretch, "Scale", (34.0, 0.55, 1.0))
    nt.links.new(uv, stretch.inputs["Vector"])

    straw = _noise(nt, stretch.outputs["Vector"], scale=11.0, detail=12.0,
                   roughness=0.80, distortion=0.9)
    ramp = _ramp(nt, [
        (0.18, (0.20, 0.13, 0.05, 1.0)),
        (0.44, (0.46, 0.32, 0.13, 1.0)),
        (0.72, (0.72, 0.55, 0.24, 1.0)),
        (0.95, (0.88, 0.72, 0.38, 1.0)),
    ], straw.outputs["Fac"])

    # Broad clumping on world position, so one part of a roof is visibly
    # darker and damper than another rather than the whole slope being one
    # even tone.
    clump = _noise(nt, _pos(nt, 1.0), scale=5.5, detail=7.0, roughness=0.6)
    clump_ramp = _ramp(nt, [
        (0.30, (0.66, 0.62, 0.55, 1.0)),
        (0.70, (1.06, 1.04, 1.00, 1.0)),
    ], clump.outputs["Fac"])
    nt.links.new(_mulcol(nt, ramp.outputs["Color"], clump_ramp.outputs["Color"]),
                 bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.97)

    fine = _noise(nt, _pos(nt, 1.0), scale=42.0, detail=6.0)
    h = _add(nt, _mul(nt, straw.outputs["Fac"], 1.0), _mul(nt, fine.outputs["Fac"], 0.45))
    _bump(nt, bsdf, h, strength=1.15, distance=0.030)
    return mat


def plaster(name="Plaster", tint=(0.90, 0.87, 0.79)):
    """
    Daub / rendered walls on the smaller town buildings.

    Brightened toward a cream white so the timber framing and beams read as
    dark against it -- the half-timbered contrast of the reference, where the
    old tan-on-brown left walls and beams at nearly the same value. Callers
    that pass their own tint (a coloured kerb, say) are unaffected.
    """
    mat, nt, bsdf = _new(name)
    pos = _pos(nt, 1.0)
    n = _noise(nt, pos, scale=5.0, detail=8.0, roughness=0.6)
    r, g, b = tint
    ramp = _ramp(nt, [
        (0.28, (r * 0.78, g * 0.78, b * 0.78, 1.0)),
        (0.62, (r, g, b, 1.0)),
        (1.00, (min(r * 1.10, 1.0), min(g * 1.10, 1.0), min(b * 1.10, 1.0), 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.90)
    fine = _noise(nt, pos, scale=70.0, detail=5.0)
    _bump(nt, bsdf, fine.outputs["Fac"], strength=0.35, distance=0.010)
    return mat


def cloth(name="Cloth", colour=(0.62, 0.10, 0.10)):
    """Banners and awnings."""
    mat, nt, bsdf = _new(name)
    _set(bsdf, "Base Color", (*colour, 1.0))
    _set(bsdf, "Roughness", 0.86)
    weave = _noise(nt, _pos(nt, 1.0), scale=160.0, detail=3.0)
    _bump(nt, bsdf, weave.outputs["Fac"], strength=0.2, distance=0.004)
    return mat


def iron(name="Iron"):
    mat, nt, bsdf = _new(name)
    n = _noise(nt, _pos(nt, 1.0), scale=45.0, detail=6.0)
    ramp = _ramp(nt, [
        (0.28, (0.09, 0.09, 0.10, 1.0)),
        (0.78, (0.24, 0.23, 0.23, 1.0)),
    ], n.outputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    _set(bsdf, "Metallic", 0.85)
    _set(bsdf, "Roughness", 0.52)
    _bump(nt, bsdf, n.outputs["Fac"], strength=0.3, distance=0.008)
    return mat


# --- ground, rendered top-down into tile textures --------------------------

def ground_sand(name="GroundSand"):
    """
    Dry cracked desert earth with scattered pebbles.

    Feature sizes matter more than anything here. One tile renders at 128px, and
    detail finer than ~5px is averaged away by the render filter and reads as
    flat paper. Everything below is tuned to land in the 6-30px band, which is
    where the reference screenshots put their pebbles and cracks.
    """
    mat, nt, bsdf = _new(name)
    pos = _pos(nt, 1.0)

    # broad tonal drift across the tile
    base = _noise(nt, pos, scale=3.0, detail=8.0, roughness=0.6)
    base_ramp = _ramp(nt, [
        (0.22, (0.50, 0.39, 0.25, 1.0)),
        (0.52, (0.72, 0.60, 0.42, 1.0)),
        (0.86, (0.86, 0.76, 0.57, 1.0)),
    ], base.outputs["Fac"])

    # distinct pebbles: ~14 across a tile, so roughly 9px each
    peb = nt.nodes.new("ShaderNodeTexVoronoi")
    nt.links.new(pos, peb.inputs["Vector"])
    _set(peb, "Scale", 14.0)
    peb.feature = 'F1'
    peb_ramp = _ramp(nt, [
        (0.00, (1.22, 1.18, 1.10, 1.0)),
        (0.16, (0.96, 0.94, 0.90, 1.0)),
        (0.34, (0.74, 0.70, 0.64, 1.0)),
        (0.55, (1.00, 1.00, 1.00, 1.0)),
    ], peb.outputs["Distance"])

    # cracks
    cracks = nt.nodes.new("ShaderNodeTexVoronoi")
    nt.links.new(pos, cracks.inputs["Vector"])
    _set(cracks, "Scale", 5.0)
    cracks.feature = 'DISTANCE_TO_EDGE'
    crack_ramp = _ramp(nt, [
        (0.00, (0.46, 0.38, 0.28, 1.0)),
        (0.09, (0.92, 0.88, 0.82, 1.0)),
        (0.30, (1.02, 1.01, 1.00, 1.0)),
    ], cracks.outputs["Distance"])

    tone = _mulcol(nt, base_ramp.outputs["Color"], peb_ramp.outputs["Color"])
    nt.links.new(_mulcol(nt, tone, crack_ramp.outputs["Color"]), bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.96)

    grit = _noise(nt, pos, scale=26.0, detail=8.0, roughness=0.7)
    h = _add(nt, _mul(nt, cracks.outputs["Distance"], 0.9), _mul(nt, grit.outputs["Fac"], 0.55))
    h = _add(nt, h, _mul(nt, peb.outputs["Distance"], 0.8))
    _bump(nt, bsdf, h, strength=1.0, distance=0.055)
    return mat


def ground_grass(name="GroundGrass", dark=False):
    """Olive scrubby turf. The reference greens are far duller than pure green."""
    mat, nt, bsdf = _new(name)
    pos = _pos(nt, 1.0)

    clump = _noise(nt, pos, scale=9.0, detail=10.0, roughness=0.72, distortion=1.8)
    # Greener and more saturated than the old olive. The reference turf leads
    # green over red by a wide margin; the previous ramp led by six points and
    # read as dry khaki. Green is now close to twice the red, with a touch of
    # blue in the shadows for depth, and the light-to-dark spread is wider so
    # the ground has variation instead of a flat wash.
    if dark:
        stops = [(0.16, (0.04, 0.12, 0.05, 1.0)),
                 (0.45, (0.08, 0.22, 0.08, 1.0)),
                 (0.75, (0.14, 0.32, 0.12, 1.0)),
                 (1.00, (0.21, 0.42, 0.17, 1.0))]
    else:
        stops = [(0.16, (0.09, 0.19, 0.07, 1.0)),
                 (0.45, (0.15, 0.33, 0.11, 1.0)),
                 (0.75, (0.25, 0.47, 0.16, 1.0)),
                 (1.00, (0.36, 0.60, 0.23, 1.0))]
    ramp = _ramp(nt, stops, clump.outputs["Fac"])

    # individual tufts, ~24 across the tile. The highlight is kept nearer to
    # neutral-bright than before: pushing it to 1.24 desaturated the tips back
    # toward khaki, undoing the greener base.
    tuft = _noise(nt, pos, scale=24.0, detail=9.0, roughness=0.8, distortion=3.0)
    tuft_ramp = _ramp(nt, [
        (0.30, (0.74, 0.78, 0.70, 1.0)),
        (0.52, (1.00, 1.02, 0.98, 1.0)),
        (0.74, (1.12, 1.16, 1.06, 1.0)),
    ], tuft.outputs["Fac"])

    nt.links.new(_mulcol(nt, ramp.outputs["Color"], tuft_ramp.outputs["Color"]),
                 bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.95)

    h = _add(nt, _mul(nt, clump.outputs["Fac"], 0.5), _mul(nt, tuft.outputs["Fac"], 1.0))
    _bump(nt, bsdf, h, strength=1.0, distance=0.05)
    return mat


def ground_cliff(name="GroundCliff"):
    """
    Broken rock for cliff faces.

    Deliberately direction-free: tiles pick one of four UV orientations at
    random to break up repetition, so any material with obvious strata would
    have its bedding planes pointing four different ways along the same cliff.
    Chunky blocks and deep crevices read as rock from every orientation.

    Kept as BRIGHT as the plateau stone on purpose. The terrain shader already
    applies a lambert term, and a 2-step face turned away from the sun comes
    out at shade 0.50 -- so anything that looks correctly "cliff-dark" flat in
    Blender lands as near-black mud in game. The face reads as rock because of
    its structure, not because it is dim.
    """
    mat, nt, bsdf = _new(name)
    pos = _pos(nt, 1.0)

    # big broken blocks
    blocks = nt.nodes.new("ShaderNodeTexVoronoi")
    nt.links.new(pos, blocks.inputs["Vector"])
    _set(blocks, "Scale", 5.5)
    blocks.feature = 'F1'
    # Tone comes from the Color output, NOT Distance. Distance domes smoothly
    # towards each cell centre, so it shades every block identically and the
    # face averages out to one flat tone -- measured LOWER contrast than the
    # plateau stone it was supposed to beat. Color is random per cell, which
    # gives genuinely distinct blocks.
    block_ramp = _ramp(nt, [
        (0.00, (0.20, 0.18, 0.15, 1.0)),
        (0.35, (0.36, 0.32, 0.27, 1.0)),
        (0.70, (0.54, 0.49, 0.41, 1.0)),
        (1.00, (0.72, 0.65, 0.55, 1.0)),
    ], blocks.outputs["Color"])

    # ...with a gentle dome inside each block so they are not flat plates.
    dome = _ramp(nt, [
        (0.00, (0.80, 0.79, 0.77, 1.0)),
        (1.00, (1.12, 1.11, 1.09, 1.0)),
    ], blocks.outputs["Distance"])

    # Deep crevices between the blocks.
    #
    # These stops are tied to the voronoi Scale above. DISTANCE_TO_EDGE peaks
    # at roughly 0.5/Scale -- about 0.09 here -- so a ramp that only reaches
    # full brightness at 0.35 leaves the ENTIRE tile inside the dark crack
    # band, which is what turned the first attempt into flat brown mud.
    cracks = nt.nodes.new("ShaderNodeTexVoronoi")
    nt.links.new(pos, cracks.inputs["Vector"])
    _set(cracks, "Scale", 5.5)
    cracks.feature = 'DISTANCE_TO_EDGE'
    crack_ramp = _ramp(nt, [
        (0.000, (0.24, 0.22, 0.19, 1.0)),
        (0.030, (0.90, 0.88, 0.84, 1.0)),
        (0.060, (1.08, 1.06, 1.03, 1.0)),
    ], cracks.outputs["Distance"])

    grit = _noise(nt, pos, scale=34.0, detail=8.0, roughness=0.7)
    grit_ramp = _ramp(nt, [
        (0.35, (0.84, 0.82, 0.78, 1.0)),
        (0.55, (1.00, 1.00, 1.00, 1.0)),
        (0.78, (1.18, 1.16, 1.12, 1.0)),
    ], grit.outputs["Fac"])

    tone = _mulcol(nt, block_ramp.outputs["Color"], dome.outputs["Color"])
    tone = _mulcol(nt, tone, crack_ramp.outputs["Color"])
    nt.links.new(_mulcol(nt, tone, grit_ramp.outputs["Color"]), bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.95)

    h = _add(nt, _mul(nt, cracks.outputs["Distance"], 1.2),
             _mul(nt, grit.outputs["Fac"], 0.5))
    _bump(nt, bsdf, h, strength=1.0, distance=0.075)
    return mat


def ground_marsh(name="GroundMarsh"):
    """
    Pitch marsh: wet, grey-green bog with tar seeping through it.

    Two things it has to do at 45 px. It must read as GROUND you would not want
    to walk through -- so dark, mottled and cold against the warm sand, never
    tidy. And it must read as valuable, because it is the only place a pitch rig
    can stand, so black tar pools show through the sludge.

    Deliberately the coldest, darkest tile in the set. Every other ground here
    lives in the same warm sandstone family, and a hazard the player has to plan
    routes around needs to be identifiable at a glance from any zoom.
    """
    mat, nt, bsdf = _new(name)
    pos = _pos(nt, 1.0)

    # broad wet/dry mottling
    base = _noise(nt, pos, scale=9.0, detail=8.0, roughness=0.62, distortion=1.2)
    # Pushed grey rather than green. First pass sat only six points cooler than
    # grass_dark, and a hazard the player is expected to route AROUND has to be
    # identifiable in one glance at full zoom-out, not on close inspection.
    base_ramp = _ramp(nt, [
        (0.28, (0.14, 0.16, 0.16, 1.0)),
        (0.50, (0.24, 0.27, 0.26, 1.0)),
        (0.72, (0.33, 0.36, 0.35, 1.0)),
        (0.92, (0.41, 0.43, 0.42, 1.0)),
    ], base.outputs["Fac"])

    # tar seeps: small, very dark, high-contrast blotches
    tar = _noise(nt, pos, scale=17.0, detail=6.0, roughness=0.75, distortion=2.0)
    tar_ramp = _ramp(nt, [
        (0.40, (0.13, 0.13, 0.12, 1.0)),
        (0.52, (0.62, 0.64, 0.60, 1.0)),
        (0.66, (1.00, 1.00, 1.00, 1.0)),
    ], tar.outputs["Fac"])

    # fine silt, so a big expanse is not flat colour
    silt = _noise(nt, pos, scale=46.0, detail=7.0, roughness=0.65)
    silt_ramp = _ramp(nt, [
        (0.36, (0.84, 0.86, 0.84, 1.0)),
        (0.58, (1.00, 1.00, 1.00, 1.0)),
        (0.80, (1.14, 1.15, 1.12, 1.0)),
    ], silt.outputs["Fac"])

    tone = _mulcol(nt, base_ramp.outputs["Color"], tar_ramp.outputs["Color"])
    nt.links.new(_mulcol(nt, tone, silt_ramp.outputs["Color"]), bsdf.inputs["Base Color"])

    # Wet ground is glossier than dry. Roughness driven by the tar mask so the
    # seeps catch light and the drier sludge does not.
    rough = _ramp(nt, [
        (0.40, (0.34, 0.34, 0.34, 1.0)),
        (0.66, (0.88, 0.88, 0.88, 1.0)),
    ], tar.outputs["Fac"])
    nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])

    h = _add(nt, _mul(nt, base.outputs["Fac"], 0.5), _mul(nt, silt.outputs["Fac"], 0.5))
    _bump(nt, bsdf, h, strength=0.8, distance=0.03)
    return mat


def ground_water(name="GroundWater"):
    """
    Standing water: river, lake and shallow sea.

    The tile is rendered flat like every other ground, so the illusion has to
    come entirely from colour and specular. Two rules it must obey at 45 px.

    It has to be the only BLUE thing in the set, and unambiguously so. Marsh is
    already the dark cold tile, and a player glancing at a zoomed-out map must
    never have to decide which dark patch is bog he can trench and which is
    water he cannot touch -- so this is pushed properly blue rather than
    blue-grey, and lighter than marsh rather than darker.

    And it must not tile visibly. Water has no landmarks to hide a repeat
    behind, unlike rock or scrub, so the ripple runs at two scales that do not
    share a period and the highlight sits on the finer of the two.
    """
    mat, nt, bsdf = _new(name)
    pos = _pos(nt, 1.0)

    # depth mottling: shallows toward the pale end, open water toward the dark
    deep = _noise(nt, pos, scale=6.0, detail=6.0, roughness=0.55, distortion=0.6)
    # Measured, not guessed. The first pass came back at luma 163 against
    # sand's 168 -- as bright as the desert it is supposed to sit in, so it
    # read as pale ice. The rig's lighting lifts these values a long way, so
    # they are set low enough to land near marsh at 117.
    deep_ramp = _ramp(nt, [
        (0.30, (0.035, 0.105, 0.185, 1.0)),
        (0.52, (0.055, 0.150, 0.245, 1.0)),
        (0.74, (0.080, 0.200, 0.300, 1.0)),
        (0.94, (0.115, 0.260, 0.360, 1.0)),
    ], deep.outputs["Fac"])

    # ripple, deliberately at a scale that does not divide the depth noise
    ripple = _noise(nt, pos, scale=23.0, detail=7.0, roughness=0.70, distortion=1.6)
    ripple_ramp = _ramp(nt, [
        (0.42, (0.84, 0.88, 0.93, 1.0)),
        (0.60, (0.98, 1.00, 1.03, 1.0)),
        (0.78, (1.10, 1.13, 1.17, 1.0)),
    ], ripple.outputs["Fac"])

    nt.links.new(_mulcol(nt, deep_ramp.outputs["Color"], ripple_ramp.outputs["Color"]),
                 bsdf.inputs["Base Color"])

    # Glossy, but not a mirror: a uniform low roughness over a flat plane comes
    # back as one flat specular sheet with no shape in it at all.
    rough = _ramp(nt, [
        (0.35, (0.08, 0.08, 0.08, 1.0)),
        (0.70, (0.30, 0.30, 0.30, 1.0)),
    ], ripple.outputs["Fac"])
    nt.links.new(rough.outputs["Color"], bsdf.inputs["Roughness"])

    h = _add(nt, _mul(nt, ripple.outputs["Fac"], 0.7), _mul(nt, deep.outputs["Fac"], 0.3))
    _bump(nt, bsdf, h, strength=0.55, distance=0.02)
    return mat


def ground_scrub(name="GroundScrub"):
    """The patchy green-over-sand transition ground from the landscape shot."""
    mat, nt, bsdf = _new(name)
    pos = _pos(nt, 1.0)

    patch = _noise(nt, pos, scale=4.5, detail=9.0, roughness=0.65, distortion=1.6)
    # The green patches are pulled toward the grass tile's new green so the
    # sand-to-grass transition reads as one landscape rather than olive next to
    # emerald. The sandy stops (0.26, 0.96) are left alone -- they are the half
    # that has to bridge to bare sand.
    ramp = _ramp(nt, [
        (0.26, (0.66, 0.56, 0.38, 1.0)),
        (0.44, (0.44, 0.44, 0.22, 1.0)),
        (0.62, (0.20, 0.38, 0.14, 1.0)),
        (0.80, (0.34, 0.44, 0.20, 1.0)),
        (0.96, (0.74, 0.64, 0.44, 1.0)),
    ], patch.outputs["Fac"])

    tuft = _noise(nt, pos, scale=22.0, detail=9.0, roughness=0.78, distortion=2.6)
    tuft_ramp = _ramp(nt, [
        (0.32, (0.72, 0.72, 0.66, 1.0)),
        (0.54, (1.00, 1.00, 1.00, 1.0)),
        (0.76, (1.20, 1.18, 1.10, 1.0)),
    ], tuft.outputs["Fac"])

    nt.links.new(_mulcol(nt, ramp.outputs["Color"], tuft_ramp.outputs["Color"]),
                 bsdf.inputs["Base Color"])
    _set(bsdf, "Roughness", 0.95)

    h = _add(nt, _mul(nt, patch.outputs["Fac"], 0.4), _mul(nt, tuft.outputs["Fac"], 1.0))
    _bump(nt, bsdf, h, strength=1.0, distance=0.05)
    return mat
