"""
Read skeletal animation out of a COLLADA (.dae) file.

Written because Blender 5.x removed its COLLADA importer entirely -- the only
importers left are alembic, fbx, obj, ply, stl, usd and gltf. Converting with
an external tool would mean a dependency the rest of this pipeline does not
have, and pinning an old Blender alongside the current one is worse.

It turns out none of that is needed. COLLADA stores skeletal animation as one
4x4 matrix per joint per keyframe, in plain XML, and that is the easiest
possible thing to read. This module does exactly that and nothing else: no
meshes, no materials, no skinning -- just the joint hierarchy, the rest pose
and the matrix tracks.

Written against 0 A.D.'s animation set (COLLADA 1.4.1, 24fps, ~56 keys per
clip, joints named `Biped_*`), which is CC BY-SA 3.0 -- see
docs/THIRD-PARTY.md before rendering anything from it.
"""

from __future__ import annotations
import xml.etree.ElementTree as ET

NS = {'c': 'http://www.collada.org/2005/11/COLLADASchema'}
_J = '{http://www.collada.org/2005/11/COLLADASchema}node'


class Clip:
    """One animation: a joint tree, a rest pose, and a matrix per key."""

    def __init__(self) -> None:
        self.parent: dict[str, str | None] = {}
        self.order: list[str] = []
        #: Rest-pose local matrix per joint, as 16 floats row-major.
        self.rest: dict[str, list[float]] = {}
        #: Local matrix per joint per keyframe.
        self.track: dict[str, list[list[float]]] = {}
        self.times: list[float] = []
        self.up_axis = 'Y_UP'

    @property
    def frames(self) -> int:
        return len(self.times)

    @property
    def duration(self) -> float:
        return self.times[-1] if self.times else 0.0


def _floats(text: str | None) -> list[float]:
    return [float(v) for v in (text or '').split()]


def _source_array(anim: ET.Element, sid: str) -> tuple[list[float], int]:
    """A COLLADA <source>'s float array and its accessor stride."""
    src = anim.find(f".//c:source[@id='{sid}']", NS)
    if src is None:
        return [], 1
    fa = src.find('c:float_array', NS)
    acc = src.find('.//c:accessor', NS)
    stride = int(acc.get('stride', '1')) if acc is not None else 1
    return _floats(fa.text if fa is not None else ''), stride


def load(path: str) -> Clip:
    root = ET.parse(path).getroot()
    clip = Clip()

    up = root.find('c:asset/c:up_axis', NS)
    if up is not None and up.text:
        clip.up_axis = up.text.strip()

    # --- skeleton -----------------------------------------------------------
    scene = root.find('c:library_visual_scenes', NS)
    if scene is None:
        return clip

    def walk(node: ET.Element, parent: str | None) -> None:
        jid = node.get('id')
        # A skeleton is often declared more than once in one file -- 0 A.D.
        # writes it a second time for the mesh's bind pose, which is how a
        # 102-joint rig reads as 204. The copies are identical, so the first
        # wins and the rest are skipped; leaving duplicates in `order` makes
        # every joint resolve twice for no gain.
        if jid in clip.parent:
            return
        if node.get('type') == 'JOINT' and jid:
            clip.parent[jid] = parent
            clip.order.append(jid)
            m = node.find('c:matrix', NS)
            # A joint with no <matrix> is at its parent's origin; identity is
            # the right rest for it rather than a reason to skip it, because
            # its children still need a place in the chain.
            clip.rest[jid] = _floats(m.text) if m is not None else [
                1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
            parent = jid
        for child in node.findall('c:node', NS):
            walk(child, parent)

    for node in scene.findall('.//c:visual_scene/c:node', NS):
        walk(node, None)

    # --- animation ----------------------------------------------------------
    anims = root.find('c:library_animations', NS)
    if anims is None:
        return clip

    for chan in anims.findall('.//c:channel', NS):
        target = chan.get('target') or ''
        joint = target.split('/')[0]
        if joint not in clip.parent:
            continue
        sampler = anims.find(f".//c:sampler[@id='{(chan.get('source') or '').lstrip('#')}']", NS)
        if sampler is None:
            continue
        inputs = {i.get('semantic'): (i.get('source') or '').lstrip('#')
                  for i in sampler.findall('c:input', NS)}
        if 'INPUT' not in inputs or 'OUTPUT' not in inputs:
            continue

        times, _ = _source_array(anims, inputs['INPUT'])
        values, stride = _source_array(anims, inputs['OUTPUT'])
        # Only whole-transform tracks are handled. 0 A.D. writes exactly these;
        # a file animating single components would need decomposing, and
        # guessing at it silently would be worse than declining it.
        if stride != 16:
            continue

        if len(times) > len(clip.times):
            clip.times = times
        clip.track[joint] = [values[i:i + 16] for i in range(0, len(values), 16)]

    return clip


def summary(clip: Clip) -> str:
    return (f'{len(clip.order)} joints, {len(clip.track)} animated, '
            f'{clip.frames} keys over {clip.duration:.2f}s '
            f'({clip.frames / clip.duration:.0f} fps), up={clip.up_axis}')
