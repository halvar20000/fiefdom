"""
Build a peasant body onto the Mixamo rig.

Why this exists instead of a downloaded character: Mixamo's animation exports
carry the skeleton but no mesh, and the skeleton alone has everything that
actually matters -- a real 1.8m adult's proportions, which is precisely what the
KayKit mannequin gets wrong. Given the rig, the body is cheaper to generate than
to source, and generating it means the silhouette is a hooded tunic rather than
a grey robot we would then have to pretend was a peasant.

Binding is rigid: every piece belongs wholly to one bone, with overlapping
spheres at the joints to hide the seams. Heat-map auto-weighting fails on
disjoint geometry, and even at the ~70 screen pixels a peasant occupies once
the camera is zoomed the whole way in, rigid limbs with a sphere over the joint
are indistinguishable from smooth skinning.

The segment and subdivision counts here were chosen for a figure sixteen pixels
tall and are now roughly four times that, so they have gone up to match: an arm
of eight sides is visibly a prism at this size, and a head of sixty faces is
visibly a die.
"""

from __future__ import annotations
import math

import bpy
import bmesh
from mathutils import Vector

import materials as M

# Default only; the real prefix is detected from the rig and passed in,
# because Mixamo emits "mixamorig:" for characters and "mixamorig1:" for
# animations from the same session.
DEFAULT_PREFIX = "mixamorig:"


def bone_points(arm, name, prefix=DEFAULT_PREFIX):
    """World-space head and tail of a rest-pose bone."""
    b = arm.data.bones[prefix + name]
    return arm.matrix_world @ b.head_local, arm.matrix_world @ b.tail_local


def _mesh_from_bm(bm, name, mat, group, arm, prefix=DEFAULT_PREFIX):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    obj.data.materials.append(mat)

    vg = obj.vertex_groups.new(name=prefix + group)
    vg.add(range(len(mesh.vertices)), 1.0, 'REPLACE')
    return obj


def limb(arm, name, p0, p1, r0, r1, mat, group, segments=12, prefix=DEFAULT_PREFIX):
    """Tapered cylinder from p0 to p1, capped with spheres at both joints."""
    from mathutils import Matrix
    bm = bmesh.new()
    axis = (p1 - p0)
    length = axis.length
    if length < 1e-6:
        bm.free()
        return None
    axis.normalize()
    up = Vector((0, 0, 1)) if abs(axis.z) < 0.95 else Vector((1, 0, 0))
    side = axis.cross(up).normalized()
    fwd = axis.cross(side).normalized()

    rings = []
    for t, r in ((0.0, r0), (1.0, r1)):
        centre = p0 + (p1 - p0) * t
        ring = []
        for i in range(segments):
            a = (i / segments) * math.tau
            v = centre + side * (math.cos(a) * r) + fwd * (math.sin(a) * r)
            ring.append(bm.verts.new(v))
        rings.append(ring)

    bm.verts.ensure_lookup_table()
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[1]))

    # joint spheres so rigid binding does not open gaps when the limb bends
    for centre, r in ((p0, r0), (p1, r1)):
        bmesh.ops.create_icosphere(bm, subdivisions=1, radius=r * 0.98,
                                   matrix=Matrix.Translation(centre))

    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_from_bm(bm, name, mat, group, arm, prefix)


def blob(arm, name, centre, radius, mat, group, squash=1.0, subdiv=3, prefix=DEFAULT_PREFIX):
    from mathutils import Matrix
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius,
                               matrix=Matrix.Translation(centre))
    if squash != 1.0:
        for v in bm.verts:
            v.co.z = centre.z + (v.co.z - centre.z) * squash
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_from_bm(bm, name, mat, group, arm)


def skirt(arm, name, top_z, bottom_z, r_top, r_bottom, mat, group, segments=16, prefix=DEFAULT_PREFIX):
    """The tunic hem -- a flared band that reads as clothing, not bare legs."""
    bm = bmesh.new()
    rings = []
    for z, r in ((top_z, r_top), (bottom_z, r_bottom)):
        ring = []
        for i in range(segments):
            a = (i / segments) * math.tau
            ring.append(bm.verts.new(Vector((math.cos(a) * r, math.sin(a) * r * 0.72, z))))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((rings[0][i], rings[0][j], rings[1][j], rings[1][i]))
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return _mesh_from_bm(bm, name, mat, group, arm)


def build(arm, palette=None, prefix=DEFAULT_PREFIX, kit=None):
    """
    Generate the body and bind it to `arm`. Returns the joined mesh object.

    `palette` overrides the cloth colours so soldiers and different trades can
    be told apart later without touching the geometry.

    `kit` adds equipment -- helmet, weapon, shield. Each piece is bound to a
    BONE's vertex group, not parented to the object, so it follows the Mixamo
    animation for free: a spear bound to RightHand swings with the arm through
    every frame of every clip without a line of animation code.

    Equipment is authored in the rest pose. The arms are out to the sides
    there, so a shaft drawn vertically THROUGH the hand stays vertical relative
    to the hand and reads as carried, rather than skewering the ground.
    """
    p = palette or {}
    tunic = M.cloth("PeasantTunic", colour=p.get('tunic', (0.72, 0.65, 0.48)))
    hose = M.cloth("PeasantHose", colour=p.get('hose', (0.31, 0.25, 0.18)))
    hood = M.cloth("PeasantHood", colour=p.get('hood', (0.50, 0.38, 0.22)))
    skin, _, bsdf = M._new("PeasantSkin")
    M._set(bsdf, "Base Color", (*p.get('skin', (0.52, 0.36, 0.25)), 1.0))
    M._set(bsdf, "Roughness", 0.74)
    boot = M.cloth("PeasantBoot", colour=p.get('boot', (0.20, 0.15, 0.11)))

    parts = []
    hips_h, _ = bone_points(arm, prefix=prefix, name="Hips")
    _, sp2_t = bone_points(arm, prefix=prefix, name="Spine2")
    neck_h, _ = bone_points(arm, prefix=prefix, name="Neck")
    head_h, head_t = bone_points(arm, prefix=prefix, name="Head")

    # torso
    parts.append(limb(arm, "pe_torso", hips_h - Vector((0, 0, 0.02)), sp2_t,
                      0.115, 0.135, tunic, "Spine1", segments=10, prefix=prefix))
    parts.append(limb(arm, "pe_neck", neck_h, head_h, 0.045, 0.045, skin, "Neck", segments=6, prefix=prefix))

    # head and hood
    head_c = (head_h + head_t) * 0.5
    parts.append(blob(arm, "pe_head", head_c, 0.098, skin, "Head", squash=1.05, prefix=prefix))
    parts.append(blob(arm, "pe_hood", head_c + Vector((0, 0.012, 0.018)), 0.115,
                      hood, "Head", squash=1.0, prefix=prefix))

    # tunic hem, hanging from the hips
    parts.append(skirt(arm, "pe_skirt", hips_h.z + 0.02, hips_h.z - 0.30,
                       0.135, 0.185, tunic, "Hips", prefix=prefix))

    for side in ("Left", "Right"):
        arm_h, arm_t = bone_points(arm, f"{side}Arm", prefix=prefix)
        fore_h, fore_t = bone_points(arm, f"{side}ForeArm", prefix=prefix)
        hand_h, hand_t = bone_points(arm, f"{side}Hand", prefix=prefix)
        up_h, up_t = bone_points(arm, f"{side}UpLeg", prefix=prefix)
        leg_h, leg_t = bone_points(arm, f"{side}Leg", prefix=prefix)
        foot_h, foot_t = bone_points(arm, f"{side}Foot", prefix=prefix)
        toe_h, toe_t = bone_points(arm, f"{side}ToeBase", prefix=prefix)

        parts.append(limb(arm, f"pe_{side}_uparm", arm_h, arm_t, 0.052, 0.042,
                          tunic, f"{side}Arm", prefix=prefix))
        parts.append(limb(arm, f"pe_{side}_forearm", fore_h, fore_t, 0.042, 0.033,
                          skin, f"{side}ForeArm", prefix=prefix))
        parts.append(blob(arm, f"pe_{side}_hand", (hand_h + hand_t) * 0.5, 0.042,
                          skin, f"{side}Hand", subdiv=1, prefix=prefix))

        parts.append(limb(arm, f"pe_{side}_thigh", up_h, up_t, 0.072, 0.055,
                          hose, f"{side}UpLeg", prefix=prefix))
        parts.append(limb(arm, f"pe_{side}_shin", leg_h, leg_t, 0.055, 0.040,
                          hose, f"{side}Leg", prefix=prefix))
        parts.append(limb(arm, f"pe_{side}_foot", foot_h, toe_h, 0.048, 0.040,
                          boot, f"{side}Foot", segments=6, prefix=prefix))
        parts.append(limb(arm, f"pe_{side}_toe", toe_h, toe_t, 0.040, 0.030,
                          boot, f"{side}ToeBase", segments=6, prefix=prefix))

    # Height of the BODY, before any kit goes on.
    #
    # The renderer scales the whole mesh so its z extent equals the unit
    # height. A spear reaches well above the head, so measuring after the kit
    # is fitted makes the SPEAR 0.52 tall and shrinks the man inside it by
    # about a fifth -- spearmen would stand visibly shorter than peasants for
    # no reason a player could ever work out. Record the body's own extent and
    # let the renderer scale by that instead.
    _zs = [v.co.z for o in parts if o is not None for v in o.data.vertices]
    body_z_extent = (max(_zs) - min(_zs)) if _zs else 0.0

    # --- equipment ---------------------------------------------------------
    k = kit or {}
    steel = M.iron()
    haft = M.timber("HaftWood", dark=True)

    if k.get('crown'):
        # A band with points on it, over the hood rather than instead of it.
        # A crown is the ONE piece of kit in the game that has to be legible at
        # a glance from any facing, because the man wearing it is the man you
        # lose the game by losing -- so it is gold, it sits proud of the head,
        # and its points break the silhouette.
        gold = M.cloth("Crown", colour=(0.86, 0.68, 0.24))
        band = head_c + Vector((0.0, 0.0, 0.070))
        parts.append(limb(arm, "pe_crown", band - Vector((0.0, 0.0, 0.018)),
                          band + Vector((0.0, 0.0, 0.022)), 0.104, 0.104,
                          gold, "Head", segments=10, prefix=prefix))
        for i in range(6):
            a = (i / 6) * math.tau
            d = Vector((math.cos(a) * 0.088, math.sin(a) * 0.088, 0.0))
            parts.append(limb(arm, f"pe_crownpt_{i}", band + d,
                              band + d + Vector((0.0, 0.0, 0.052)),
                              0.020, 0.006, gold, "Head", segments=4, prefix=prefix))

    if k.get('helmet'):
        parts.append(blob(arm, "pe_helm", head_c + Vector((0.0, 0.0, 0.012)), 0.109,
                          steel, "Head", squash=0.92, prefix=prefix))
        # nasal bar, so the helmet is not just a shiny scalp at 24 px
        parts.append(limb(arm, "pe_nasal", head_c + Vector((0.0, -0.088, 0.045)),
                          head_c + Vector((0.0, -0.086, -0.045)), 0.013, 0.011,
                          steel, "Head", segments=5, prefix=prefix))

    weapon = k.get('weapon')
    if weapon:
        hand_h, hand_t = bone_points(arm, "RightHand", prefix=prefix)
        grip = (hand_h + hand_t) * 0.5
        if weapon == 'spear':
            parts.append(limb(arm, "pe_spear", grip + Vector((0.0, 0.0, -0.30)),
                              grip + Vector((0.0, 0.0, 0.62)), 0.014, 0.012,
                              haft, "RightHand", segments=6, prefix=prefix))
            parts.append(limb(arm, "pe_spearhead", grip + Vector((0.0, 0.0, 0.60)),
                              grip + Vector((0.0, 0.0, 0.76)), 0.028, 0.004,
                              steel, "RightHand", segments=6, prefix=prefix))
        elif weapon == 'sword':
            parts.append(limb(arm, "pe_grip", grip + Vector((0.0, 0.0, -0.09)),
                              grip + Vector((0.0, 0.0, 0.02)), 0.017, 0.017,
                              haft, "RightHand", segments=5, prefix=prefix))
            parts.append(limb(arm, "pe_guard", grip + Vector((-0.075, 0.0, 0.03)),
                              grip + Vector((0.075, 0.0, 0.03)), 0.013, 0.013,
                              steel, "RightHand", segments=5, prefix=prefix))
            parts.append(limb(arm, "pe_blade", grip + Vector((0.0, 0.0, 0.04)),
                              grip + Vector((0.0, 0.0, 0.46)), 0.026, 0.012,
                              steel, "RightHand", segments=5, prefix=prefix))
        elif weapon == 'pike':
            # A pike is not a longer spear by a little. It is half again the
            # man's height, and that is the entire silhouette: at sprite scale
            # the shaft is what tells a pikeman from a spearman across a field,
            # long before the armour does. The head is SMALLER than a spear's
            # for the same reason -- a broad head on a shaft this long reads as
            # a halberd.
            parts.append(limb(arm, "pe_pike", grip + Vector((0.0, 0.0, -0.42)),
                              grip + Vector((0.0, 0.0, 0.98)), 0.013, 0.011,
                              haft, "RightHand", segments=6, prefix=prefix))
            parts.append(limb(arm, "pe_pikehead", grip + Vector((0.0, 0.0, 0.96)),
                              grip + Vector((0.0, 0.0, 1.10)), 0.019, 0.003,
                              steel, "RightHand", segments=6, prefix=prefix))
        elif weapon == 'mace':
            # Short haft, heavy head. Nothing about a mace reads at range
            # except the lump on the end, so the head is deliberately oversized
            # against a real one and the flanges stick out far enough to break
            # the circle -- a plain ball comes back as a lollipop.
            parts.append(limb(arm, "pe_macehaft", grip + Vector((0.0, 0.0, -0.10)),
                              grip + Vector((0.0, 0.0, 0.26)), 0.016, 0.015,
                              haft, "RightHand", segments=5, prefix=prefix))
            head = grip + Vector((0.0, 0.0, 0.32))
            parts.append(blob(arm, "pe_macehead", head, 0.064, steel,
                              "RightHand", squash=0.95, subdiv=2, prefix=prefix))
            for i in range(4):
                a = (i / 4) * math.tau
                d = Vector((math.cos(a), math.sin(a), 0.0))
                parts.append(limb(arm, f"pe_maceflange_{i}", head, head + d * 0.100,
                                  0.028, 0.009, steel, "RightHand",
                                  segments=4, prefix=prefix))
        elif weapon == 'crossbow':
            # Held across the body, not upright: a crossbow is a stock pointed
            # at something with a short prod athwart it, and the cross is the
            # whole reason the shape is recognisable at all. Built on the LEFT
            # hand like the bow, so the right arm's motion reads as cocking it.
            lh_h, lh_t = bone_points(arm, "LeftHand", prefix=prefix)
            lgrip = (lh_h + lh_t) * 0.5
            parts.append(limb(arm, "pe_xbow_stock",
                              lgrip + Vector((0.0, 0.0, -0.14)),
                              lgrip + Vector((0.0, 0.0, 0.34)), 0.026, 0.018,
                              haft, "LeftHand", segments=5, prefix=prefix))
            parts.append(limb(arm, "pe_xbow_prod",
                              lgrip + Vector((-0.27, 0.0, 0.28)),
                              lgrip + Vector((0.27, 0.0, 0.28)), 0.016, 0.014,
                              steel, "LeftHand", segments=5, prefix=prefix))
            parts.append(limb(arm, "pe_xbow_string",
                              lgrip + Vector((-0.26, 0.05, 0.28)),
                              lgrip + Vector((0.26, 0.05, 0.28)), 0.006, 0.006,
                              M.cloth("BowString", colour=(0.86, 0.83, 0.74)),
                              "LeftHand", segments=4, prefix=prefix))
        elif weapon == 'club':
            # A length of wood with a heavier end. Nothing about a slave should
            # read as equipment -- this is the only "weapon" in the set that is
            # plainly just a stick.
            parts.append(limb(arm, "pe_club", grip + Vector((0.0, 0.0, -0.08)),
                              grip + Vector((0.0, 0.0, 0.30)), 0.016, 0.028,
                              haft, "RightHand", segments=5, prefix=prefix))
        elif weapon == 'scimitar':
            # Curved, in three straight segments -- the same trick the bow uses,
            # and for the same reason: at this size a curve is three lines and
            # the eye supplies the rest. The sweep is what tells him from the
            # swordsman he otherwise matches.
            parts.append(limb(arm, "pe_scim_grip", grip + Vector((0.0, 0.0, -0.09)),
                              grip + Vector((0.0, 0.0, 0.02)), 0.017, 0.017,
                              haft, "RightHand", segments=5, prefix=prefix))
            pts = [(0.03, 0.00), (0.18, 0.03), (0.32, 0.10), (0.43, 0.21)]
            for i in range(len(pts) - 1):
                (z0, y0), (z1, y1) = pts[i], pts[i + 1]
                parts.append(limb(arm, f"pe_scim_{i}",
                                  grip + Vector((0.0, y0, z0)),
                                  grip + Vector((0.0, y1, z1)),
                                  0.026 - i * 0.005, 0.021 - i * 0.005,
                                  steel, "RightHand", segments=5, prefix=prefix))
        elif weapon == 'dagger':
            # Short enough that the silhouette is a man with empty hands until
            # you look, which is the whole idea of him.
            parts.append(limb(arm, "pe_dag_grip", grip + Vector((0.0, 0.0, -0.06)),
                              grip + Vector((0.0, 0.0, 0.02)), 0.014, 0.014,
                              haft, "RightHand", segments=5, prefix=prefix))
            parts.append(limb(arm, "pe_dag_blade", grip + Vector((0.0, 0.0, 0.02)),
                              grip + Vector((0.0, 0.0, 0.20)), 0.018, 0.004,
                              steel, "RightHand", segments=5, prefix=prefix))
        elif weapon == 'sling':
            # A sling is a cord and a pouch, and neither is visible at ninety
            # pixels. What IS visible is the loop of it hanging from the hand,
            # so that is what gets built: an open arc of cord with the pouch at
            # the bottom of it, hanging where a weapon would be.
            cord = M.cloth("SlingCord", colour=(0.74, 0.68, 0.52))
            # Big, and hanging clear of the body. The first cut was a tight
            # loop the size of a real one and it was invisible -- at this size
            # a slinger with a correctly proportioned sling is a man with
            # nothing in his hands, which is already what the slave is.
            n = 10
            for i in range(n):
                a0 = (i / n) * math.tau
                a1 = ((i + 1) / n) * math.tau
                r, cz = 0.17, -0.24
                parts.append(limb(arm, f"pe_sling_{i}",
                                  grip + Vector((0.0, math.sin(a0) * r,
                                                 cz + math.cos(a0) * r)),
                                  grip + Vector((0.0, math.sin(a1) * r,
                                                 cz + math.cos(a1) * r)),
                                  0.009, 0.009, cord, "RightHand",
                                  segments=4, prefix=prefix))
            parts.append(blob(arm, "pe_sling_pouch",
                              grip + Vector((0.0, 0.0, -0.41)), 0.042,
                              M.cloth("SlingPouch", colour=(0.42, 0.33, 0.22)),
                              "RightHand", squash=0.8, subdiv=2, prefix=prefix))
        elif weapon == 'ladder':
            # The one piece of kit in the game that is bigger than the man
            # carrying it, and deliberately: a ladderman has to be findable in
            # a crowd from across the map, because everything he is for happens
            # where he is standing.
            for i, dx in enumerate((-0.075, 0.075)):
                parts.append(limb(arm, f"pe_ladder_rail_{i}",
                                  grip + Vector((dx, 0.0, -0.40)),
                                  grip + Vector((dx, 0.0, 0.74)), 0.014, 0.014,
                                  haft, "RightHand", segments=5, prefix=prefix))
            for i in range(7):
                z = -0.34 + i * 0.18
                parts.append(limb(arm, f"pe_ladder_rung_{i}",
                                  grip + Vector((-0.075, 0.0, z)),
                                  grip + Vector((0.075, 0.0, z)), 0.010, 0.010,
                                  haft, "RightHand", segments=4, prefix=prefix))
        elif weapon == 'bow':
            lh_h, lh_t = bone_points(arm, "LeftHand", prefix=prefix)
            lgrip = (lh_h + lh_t) * 0.5
            # three straight segments read as a curve at sprite scale
            for i, (z0, z1, dy) in enumerate([(-0.34, -0.12, 0.05), (-0.12, 0.12, 0.0),
                                              (0.12, 0.34, 0.05)]):
                parts.append(limb(arm, f"pe_bow_{i}",
                                  lgrip + Vector((0.0, dy, z0)),
                                  lgrip + Vector((0.0, 0.0 if i == 1 else dy, z1)),
                                  0.013, 0.013, haft, "LeftHand", segments=5, prefix=prefix))
            parts.append(limb(arm, "pe_string", lgrip + Vector((0.0, 0.05, -0.34)),
                              lgrip + Vector((0.0, 0.05, 0.34)), 0.004, 0.004,
                              M.cloth("BowString", colour=(0.86, 0.83, 0.74)),
                              "LeftHand", segments=4, prefix=prefix))

    if k.get('shield'):
        lf_h, lf_t = bone_points(arm, "LeftForeArm", prefix=prefix)
        centre = lf_h.lerp(lf_t, 0.62)
        parts.append(blob(arm, "pe_shield", centre + Vector((0.0, -0.06, 0.0)), 0.135,
                          M.cloth("ShieldFace", colour=k.get('shield_colour', (0.55, 0.16, 0.14))),
                          "LeftForeArm", squash=0.34, prefix=prefix))
        parts.append(blob(arm, "pe_boss", centre + Vector((0.0, -0.10, 0.0)), 0.036,
                          steel, "LeftForeArm", squash=0.6, prefix=prefix))

    parts = [p for p in parts if p is not None]

    # join into one mesh; vertex groups survive the join
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in parts:
        o.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    body = bpy.context.view_layer.objects.active
    body.name = "Peasant"
    body["body_z_extent"] = body_z_extent

    # Bind. Vertices are in world space and the object sits at identity, so
    # matrix_parent_inverse alone cancels the armature's transform -- the body
    # stays exactly where it was authored and then follows the rig.
    body.parent = arm
    body.matrix_parent_inverse = arm.matrix_world.inverted()
    mod = body.modifiers.new("Armature", 'ARMATURE')
    mod.object = arm
    mod.use_vertex_groups = True

    for poly in body.data.polygons:
        poly.use_smooth = True
    return body
