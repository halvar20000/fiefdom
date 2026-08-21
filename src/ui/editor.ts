import * as THREE from 'three';
import { Terrain } from '../engine/terrain';
import { IsoCamera } from '../engine/camera';
import { loadTileArray } from '../engine/assets';
import { GROUND_TYPES } from '../game/worldgen';
import {
  encodeMap, saveMap, hashVariant, auditMap, decodeArrays, KEEP_COLOURS,
  type CustomMap,
} from '../game/custom';

/**
 * The map editor.
 *
 * Runs its own tiny scene rather than booting the game with the simulation
 * switched off. The game module carries workers, an army, three rival lords
 * and a save system, none of which mean anything while painting ground, and
 * threading an "is this the editor" flag through all of it would put a branch
 * in every one of those systems for the benefit of a screen that only needs a
 * terrain and a camera.
 *
 * Painting writes straight into the same Terrain the game uses, so what is on
 * screen here is literally what the map will look like in play.
 */

const CSS = `
#ed { position: fixed; inset: 0; z-index: 20; pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #ecdfc2;
  font-size: 12px; }
#ed .panel { position: absolute; background: rgba(24,19,12,.94);
  border: 1px solid rgba(196,162,96,.34); border-radius: 5px;
  box-shadow: 0 4px 18px rgba(0,0,0,.5); pointer-events: auto; padding: 9px; }
#ed .lbl { font-size: 10px; letter-spacing: .08em; text-transform: uppercase;
  opacity: .58; margin: 8px 0 4px; font-weight: 600; }
#ed .lbl:first-child { margin-top: 0; }
#ed .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
#ed button { pointer-events: auto; cursor: pointer; text-align: left;
  background: rgba(255,255,255,.045); color: #ecdfc2;
  border: 1px solid rgba(196,162,96,.20); border-radius: 3px;
  padding: 5px 7px; font: inherit; font-size: 11px; }
#ed button:hover { background: rgba(255,255,255,.11); border-color: rgba(196,162,96,.45); }
#ed button.on { background: rgba(240,200,105,.20); border-color: #f0c869; color: #fff; }
#ed .sw { display: inline-block; width: 9px; height: 9px; border-radius: 2px;
  margin-right: 6px; vertical-align: -1px; border: 1px solid rgba(0,0,0,.4); }
#ed #tools { left: 12px; top: 12px; width: 208px; }
#ed #head { left: 50%; top: 12px; transform: translateX(-50%); padding: 7px 14px;
  display: flex; gap: 14px; align-items: center; }
#ed #head b { color: #f0c869; letter-spacing: .12em; }
#ed #head .st { opacity: .62; font-size: 11px; }
#ed #act { right: 12px; top: 12px; width: 196px; }
#ed #act button { width: 100%; text-align: center; margin-bottom: 5px; }
#ed #act .go { background: #f0c869; color: #10100e; border-color: #f0c869; font-weight: 600; }
#ed #act .go:hover { background: #ffdc86; }
#ed .hint { font-size: 10px; opacity: .5; line-height: 1.5; margin-top: 7px; }
#ed .warn { color: #e2794f; font-size: 10.5px; line-height: 1.5; margin-top: 6px; }
#ed input { width: 100%; font: inherit; font-size: 11px; padding: 5px 6px;
  background: rgba(0,0,0,.35); color: #ecdfc2; border-radius: 3px;
  border: 1px solid rgba(196,162,96,.28); }
#ed .seg { display: flex; gap: 3px; }
#ed .seg button { flex: 1; text-align: center; padding: 4px 0; font-size: 10px; }
`;

/** Swatches are indicative, not the real texture — just enough to tell them apart. */
const BRUSHES: { g: string; label: string; swatch: string; key: string }[] = [
  { g: 'sand', label: 'Sand', swatch: '#c9a978', key: '1' },
  { g: 'scrub', label: 'Scrub', swatch: '#9d9a5e', key: '2' },
  { g: 'grass', label: 'Grass', swatch: '#7f9c4e', key: '3' },
  { g: 'grass_dark', label: 'Lush', swatch: '#557436', key: '4' },
  { g: 'rock', label: 'Rock', swatch: '#8e8b83', key: '5' },
  { g: 'marsh', label: 'Pitch marsh', swatch: '#4a4438', key: '6' },
];

const SIZES = [1, 3, 5, 9, 15];
const MAX_LEVEL = 5;

type Tool =
  | { kind: 'paint'; ground: number }
  | { kind: 'raise' } | { kind: 'lower' }
  | { kind: 'keep'; who: number };   // 0 = the player, 1.. = rivals

export function showEditor(
  width: number, height: number, existing?: CustomMap | null,
): Promise<void> {
  return new Promise(resolve => {
    void run(width, height, existing ?? null, resolve);
  });
}

async function run(
  W: number, H: number, existing: CustomMap | null, done: () => void,
): Promise<void> {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;display:block;z-index:10';
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10100e);

  const tiles = await loadTileArray('/assets/tiles');
  const terrain = new Terrain({ width: W, height: H, layers: 20 }, tiles.texture);
  scene.add(terrain.mesh);

  // the canvas we start from: flat sand everywhere
  const ground = new Uint8Array(W * H);
  if (existing) loadInto(existing, terrain, ground, W, H);
  else {
    for (let z = 0; z <= H; z++) for (let x = 0; x <= W; x++) terrain.setCorner(x, z, 0);
  }
  repaintAll(terrain, ground, W, H, tiles.layerOf);
  terrain.rebuild();

  const iso = new IsoCamera();
  iso.target.x = W / 2; iso.target.z = H / 2;
  // setBounds clamps the target itself, so it goes after the centring.
  iso.setBounds(0, W, 0, H);
  const resize = () => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    iso.setViewport(window.innerWidth, window.innerHeight);
    iso.apply();
  };
  window.addEventListener('resize', resize);
  resize();

  // --- UI -----------------------------------------------------------------
  const root = document.createElement('div');
  root.id = 'ed';
  document.body.appendChild(root);

  let tool: Tool = { kind: 'paint', ground: 0 };
  let size = 5;
  let name = existing?.name ?? 'My map';
  let lords = existing?.lords ?? 1;
  let trees = existing?.trees ?? 1;
  let start: { x: number; z: number } | null = existing?.start ?? null;
  const keeps: ({ x: number; z: number } | null)[] =
    [0, 1, 2].map(i => existing?.keeps?.[i] ?? null);

  const el = (tag: string, parent: HTMLElement, cls = '', id = '') => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (id) e.id = id;
    parent.appendChild(e);
    return e;
  };

  const head = el('div', root, 'panel', 'head');
  head.innerHTML = '<b>MAP EDITOR</b><span class="st"></span>';
  const stat = head.querySelector('.st')!;

  const tools = el('div', root, 'panel', 'tools');
  el('div', tools, 'lbl').textContent = 'Ground';
  const gGrid = el('div', tools, 'grid');
  const gBtns: HTMLButtonElement[] = [];
  BRUSHES.forEach((b, i) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<span class="sw" style="background:${b.swatch}"></span>${b.label}`;
    btn.title = `${b.label}  (${b.key})`;
    btn.onclick = () => { tool = { kind: 'paint', ground: i }; syncTools(); };
    gBtns.push(btn); gGrid.appendChild(btn);
  });

  el('div', tools, 'lbl').textContent = 'Height';
  const hSeg = el('div', tools, 'seg');
  const raise = document.createElement('button');
  raise.textContent = 'Raise  (Q)';
  raise.onclick = () => { tool = { kind: 'raise' }; syncTools(); };
  const lower = document.createElement('button');
  lower.textContent = 'Lower  (Z)';
  lower.onclick = () => { tool = { kind: 'lower' }; syncTools(); };
  hSeg.append(raise, lower);

  el('div', tools, 'lbl').textContent = 'Keeps';
  const kGrid = el('div', tools, 'grid');
  const kBtns: HTMLButtonElement[] = [];
  KEEP_COLOURS.forEach((c, i) => {
    const btn = document.createElement('button');
    btn.innerHTML = `<span class="sw" style="background:${c.css}"></span>${c.name}`;
    btn.title = i === 0
      ? 'Click the map to set where you begin'
      : `Click the map to seat ${c.name}`;
    btn.onclick = () => { tool = { kind: 'keep', who: i }; syncTools(); };
    kBtns.push(btn); kGrid.appendChild(btn);
  });
  const clearKeeps = document.createElement('button');
  clearKeeps.textContent = 'Clear keeps';
  clearKeeps.style.cssText = 'width:100%;text-align:center;margin-top:4px';
  clearKeeps.onclick = () => {
    start = null;
    keeps.fill(null);
    syncMarkers(); syncTools();
  };
  tools.appendChild(clearKeeps);

  el('div', tools, 'lbl').textContent = 'Brush';
  const sSeg = el('div', tools, 'seg');
  const sBtns: HTMLButtonElement[] = [];
  SIZES.forEach(s => {
    const btn = document.createElement('button');
    btn.textContent = String(s);
    btn.onclick = () => { size = s; syncTools(); };
    sBtns.push(btn); sSeg.appendChild(btn);
  });

  el('div', tools, 'hint').innerHTML =
    '<b>Arrows / WASD</b> move the view<br>'
    + 'drag to paint &nbsp; right-drag also pans<br>'
    + 'wheel zooms &nbsp; R / E rotate<br>'
    + '<b>[ ]</b> brush size &nbsp; <b>1-6</b> ground<br>'
    + 'pick a keep, then click where it goes';

  const act = el('div', root, 'panel', 'act');
  el('div', act, 'lbl').textContent = 'Map name';
  const nameIn = document.createElement('input');
  nameIn.value = name;
  nameIn.oninput = () => { name = nameIn.value; };
  act.appendChild(nameIn);

  el('div', act, 'lbl').textContent = 'Rival lords';
  const lSeg = el('div', act, 'seg');
  const lBtns: HTMLButtonElement[] = [];
  [0, 1, 2, 3].forEach(n => {
    const btn = document.createElement('button');
    btn.textContent = String(n);
    btn.onclick = () => { lords = n; syncTools(); };
    lBtns.push(btn); lSeg.appendChild(btn);
  });

  el('div', act, 'lbl').textContent = 'Vegetation';
  const tSeg = el('div', act, 'seg');
  const tBtns: HTMLButtonElement[] = [];
  const TREES = [0, 0.5, 1, 2];
  ['None', 'Few', 'Some', 'Many'].forEach((lab, i) => {
    const btn = document.createElement('button');
    btn.textContent = lab;
    btn.onclick = () => { trees = TREES[i]; syncTools(); };
    tBtns.push(btn); tSeg.appendChild(btn);
  });

  el('div', act, 'lbl').textContent = 'Map';
  const saveBtn = document.createElement('button');
  saveBtn.className = 'go';
  saveBtn.textContent = 'SAVE MAP';
  act.appendChild(saveBtn);
  const backBtn = document.createElement('button');
  backBtn.textContent = 'Back to menu';
  act.appendChild(backBtn);
  const warnBox = el('div', act, 'warn');

  /**
   * Keep markers: a post and a flag at the chosen tile.
   *
   * Drawn as plain meshes rather than through the sprite batch, which the
   * editor does not have -- the point is only to show WHERE, and a coloured
   * post reads at any zoom without needing the building's art.
   */
  const markers = new THREE.Group();
  scene.add(markers);

  function syncMarkers() {
    for (const m of [...markers.children]) {
      markers.remove(m);
      const mesh = m as THREE.Mesh;
      mesh.geometry?.dispose();
      (mesh.material as THREE.Material)?.dispose();
    }
    const spots: ({ x: number; z: number } | null)[] = [start, ...keeps];
    spots.forEach((p, i) => {
      if (!p) return;
      const colour = KEEP_COLOURS[i].hex;
      const y = terrain.heightAt(p.x, p.z);
      const post = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 4.2, 0.35),
        new THREE.MeshBasicMaterial({ color: colour }));
      post.position.set(p.x + 0.5, y + 2.1, p.z + 0.5);
      markers.add(post);
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(3, 0.12, 3),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.55 }));
      pad.position.set(p.x + 0.5, y + 0.08, p.z + 0.5);
      markers.add(pad);
    });
  }
  syncMarkers();

  function syncTools() {
    gBtns.forEach((b, i) =>
      b.classList.toggle('on', tool.kind === 'paint' && tool.ground === i));
    raise.classList.toggle('on', tool.kind === 'raise');
    lower.classList.toggle('on', tool.kind === 'lower');
    sBtns.forEach((b, i) => b.classList.toggle('on', SIZES[i] === size));
    kBtns.forEach((b, i) => {
      b.classList.toggle('on', tool.kind === 'keep' && tool.who === i);
      const set = i === 0 ? !!start : !!keeps[i - 1];
      b.style.opacity = set ? '1' : '.62';
    });
    lBtns.forEach((b, i) => b.classList.toggle('on', i === lords));
    tBtns.forEach((b, i) => b.classList.toggle('on', TREES[i] === trees));
  }
  syncTools();

  function updateStat() {
    const counts = new Array(GROUND_TYPES.length).fill(0);
    for (let i = 0; i < ground.length; i++) counts[ground[i]]++;
    const pct = (n: number) => Math.round((n / ground.length) * 100);
    stat.textContent = BRUSHES
      .map((b, i) => `${b.label} ${pct(counts[i])}%`)
      .filter((_, i) => counts[i] > 0)
      .join('  ·  ');
  }
  updateStat();

  // --- painting -----------------------------------------------------------
  let painting = false, panning = false;
  let lastX = 0, lastY = 0;
  let dirty = false;
  /** Last tile stamped this stroke, so a fast drag draws a line not a dotted trail. */
  let lastTile: { x: number; z: number } | null = null;

  /** Tiles touched since the last rebuild, so a drag is not 40,000 tiles a frame. */
  const stamp = (cx: number, cz: number) => {
    const r = Math.floor(size / 2);
    if (tool.kind === 'keep') {
      const spot = { x: cx, z: cz };
      if (tool.who === 0) start = spot;
      else {
        keeps[tool.who - 1] = spot;
        // How many lords play follows how many you have seated, so the number
        // on the card and the flags on the map cannot disagree.
        lords = Math.max(lords, keeps.filter(Boolean).length);
      }
      syncMarkers(); syncTools();
      return;
    }
    if (tool.kind === 'paint') {
      for (let z = cz - r; z <= cz + r; z++) {
        for (let x = cx - r; x <= cx + r; x++) {
          if (x < 0 || z < 0 || x >= W || z >= H) continue;
          const t = z * W + x;
          if (ground[t] === tool.ground) continue;
          ground[t] = tool.ground;
          dirty = true;
        }
      }
      if (dirty) repaintArea(cx - r - 1, cz - r - 1, size + 2, size + 2);
    } else {
      const d = tool.kind === 'raise' ? 1 : -1;
      // Corners, not tiles: raising a tile means lifting its four corners, and
      // sharing them with the neighbours is what makes the ground tier
      // continuously instead of leaving one-tile pillars everywhere.
      for (let z = cz - r; z <= cz + r + 1; z++) {
        for (let x = cx - r; x <= cx + r + 1; x++) {
          if (x < 0 || z < 0 || x > W || z > H) continue;
          const v = terrain.cornerHeight(x, z) + d;
          terrain.setCorner(x, z, Math.max(0, Math.min(MAX_LEVEL, v)));
        }
      }
      dirty = true;
      // A height change alters which tiles read as cliff, so their textures
      // have to be recomputed too, not only their geometry.
      repaintArea(cx - r - 2, cz - r - 2, size + 4, size + 4);
      syncMarkers();   // a flag on ground that just moved must move with it
    }
  };

  function repaintArea(x0: number, z0: number, w: number, h: number) {
    for (let z = z0; z < z0 + h; z++) {
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || z < 0 || x >= W || z >= H) continue;
        paintTile(terrain, ground, W, x, z, tiles.layerOf);
      }
    }
  }

  /**
   * Stamp from the last tile to this one.
   *
   * Pointer events are sampled, not continuous: a quick drag delivers a
   * handful of positions metres apart on the map and paints a dotted trail of
   * separate blobs. Walking the line between them is what makes a brush feel
   * like a brush.
   */
  const strokeTo = (x: number, z: number) => {
    // A keep is one spot, not a stroke: interpolating it would drop a flag on
    // every tile the pointer crossed and leave it wherever the drag ended.
    if (tool.kind === 'keep') { if (!lastTile) stamp(x, z); lastTile = { x, z }; return; }
    if (!lastTile) { stamp(x, z); lastTile = { x, z }; return; }
    const dx = x - lastTile.x, dz = z - lastTile.z;
    const steps = Math.max(Math.abs(dx), Math.abs(dz));
    for (let i = 1; i <= steps; i++) {
      stamp(Math.round(lastTile.x + (dx * i) / steps),
            Math.round(lastTile.z + (dz * i) / steps));
    }
    if (steps === 0) stamp(x, z);
    lastTile = { x, z };
  };

  const pick = (px: number, py: number) => {
    const g = iso.screenToGround(px, py);
    if (!g) return null;
    const x = Math.floor(g.x), z = Math.floor(g.z);
    if (x < 0 || z < 0 || x >= W || z >= H) return null;
    return { x, z };
  };

  canvas.addEventListener('contextmenu', e => e.preventDefault());
  canvas.addEventListener('pointerdown', e => {
    lastX = e.clientX; lastY = e.clientY;
    if (e.button === 2 || e.button === 1) { panning = true; return; }
    if (e.button !== 0) return;
    painting = true;
    lastTile = null;
    const p = pick(e.clientX, e.clientY);
    if (p) strokeTo(p.x, p.z);
  });
  const onMove = (e: PointerEvent) => {
    if (panning) {
      // Same signs as the game's drag-pan; this had Y inverted, so a
      // right-drag moved the view the wrong way vertically.
      iso.panByPixels(-(e.clientX - lastX), e.clientY - lastY);
      lastX = e.clientX; lastY = e.clientY;
      return;
    }
    if (!painting) return;
    const p = pick(e.clientX, e.clientY);
    if (p) strokeTo(p.x, p.z);
  };
  window.addEventListener('pointermove', onMove);
  const onUp = () => {
    if (painting) updateStat();
    painting = false; panning = false; lastTile = null;
  };
  window.addEventListener('pointerup', onUp);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    iso.zoomBy(e.deltaY < 0 ? 1 : -1);
  }, { passive: false });

  /**
   * Held keys, polled in the frame loop.
   *
   * The map is 200 tiles across and the window shows perhaps thirty of them,
   * so without this the editor can only ever paint the middle of the map --
   * which is precisely what it did on the first cut. Panning is on the same
   * arrows and WASD the game uses, so it needs no learning.
   */
  const held = new Set<string>();
  const onKeyUp = (e: KeyboardEvent) => held.delete(e.key.toLowerCase());
  window.addEventListener('keyup', onKeyUp);
  // Losing focus mid-key never delivers the keyup, and the view would then
  // scroll to the edge of the map on its own and stay there.
  const onBlur = () => held.clear();
  window.addEventListener('blur', onBlur);

  const onKey = (e: KeyboardEvent) => {
    if (document.activeElement === nameIn) return;
    const k = e.key.toLowerCase();
    held.add(k);
    // Arrows scroll the page otherwise, which drags the whole editor about.
    if (k.startsWith('arrow')) e.preventDefault();
    if (k === 'r') iso.rotateBy(1);
    if (k === 'e') iso.rotateBy(-1);
    if (k === 'q') { tool = { kind: 'raise' }; syncTools(); }
    if (k === 'z') { tool = { kind: 'lower' }; syncTools(); }
    if (k >= '1' && k <= '6') { tool = { kind: 'paint', ground: Number(k) - 1 }; syncTools(); }
    if (k === '[') { size = SIZES[Math.max(0, SIZES.indexOf(size) - 1)]; syncTools(); }
    if (k === ']') { size = SIZES[Math.min(SIZES.length - 1, SIZES.indexOf(size) + 1)]; syncTools(); }
  };
  window.addEventListener('keydown', onKey);

  saveBtn.onclick = () => {
    const audit = auditMap(terrain, ground);
    const seated = keeps.filter(Boolean) as { x: number; z: number }[];
    const m = encodeMap(name.trim() || 'Untitled', W, H,
                        terrain.corners, ground, lords, trees, existing?.id,
                        start, seated);
    const err = saveMap(m);
    if (err) { warnBox.textContent = `Not saved: ${err}`; return; }
    const near: string[] = [];
    const all = [start, ...seated].filter(Boolean) as { x: number; z: number }[];
    for (let a = 0; a < all.length; a++) {
      for (let b = a + 1; b < all.length; b++) {
        const d = Math.round(Math.hypot(all[a].x - all[b].x, all[a].z - all[b].z));
        if (d < 45) near.push(`Two keeps are only ${d} tiles apart.`);
      }
    }
    warnBox.innerHTML = `Saved as <b>${m.name}</b>.`
      + (audit.warnings.length ? '<br>' + audit.warnings.join('<br>') : '')
      + (near.length ? '<br>' + near.join('<br>') : '');
  };

  backBtn.onclick = () => {
    window.removeEventListener('keydown', onKey);
    window.removeEventListener('keyup', onKeyUp);
    window.removeEventListener('blur', onBlur);
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('resize', resize);
    renderer.dispose();
    canvas.remove();
    root.remove();
    style.remove();
    done();
  };

  (window as unknown as Record<string, unknown>).__editor = {
    iso, terrain, ground, held,
    place: (who: number, x: number, z: number) => {
      tool = { kind: 'keep', who }; stamp(x, z);
    },
    keeps: () => ({ start, rivals: keeps }),
    save: () => saveBtn.click(),
  };

  // --- loop ---------------------------------------------------------------
  let lastFrame = performance.now();
  const frame = () => {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastFrame) / 1000);
    lastFrame = now;

    const pan = 900 * dt;
    if (held.has('arrowleft') || held.has('a')) iso.panByPixels(-pan, 0);
    if (held.has('arrowright') || held.has('d')) iso.panByPixels(pan, 0);
    if (held.has('arrowup') || held.has('w')) iso.panByPixels(0, -pan);
    if (held.has('arrowdown') || held.has('s')) iso.panByPixels(0, pan);

    if (dirty) { terrain.rebuild(); dirty = false; }
    iso.apply();
    renderer.render(scene, iso.camera);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

// --- shared tile painting ---------------------------------------------------

function paintTile(
  terrain: Terrain, ground: Uint8Array, W: number, x: number, z: number,
  layerOf: (type: string, variant: number) => number,
) {
  const c0 = terrain.cornerHeight(x, z);
  const c1 = terrain.cornerHeight(x + 1, z);
  const c2 = terrain.cornerHeight(x + 1, z + 1);
  const c3 = terrain.cornerHeight(x, z + 1);
  const slope = Math.max(c0, c1, c2, c3) - Math.min(c0, c1, c2, c3);
  const type = GROUND_TYPES[ground[z * W + x]] ?? 'sand';
  terrain.layer[z * W + x] = layerOf(slope >= 2 ? 'cliff' : type, hashVariant(x, z));
}

function repaintAll(
  terrain: Terrain, ground: Uint8Array, W: number, H: number,
  layerOf: (type: string, variant: number) => number,
) {
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) paintTile(terrain, ground, W, x, z, layerOf);
}

function loadInto(m: CustomMap, terrain: Terrain, ground: Uint8Array, W: number, H: number) {
  const { corners, ground: g } = decodeArrays(m);
  for (let z = 0; z <= H; z++) {
    for (let x = 0; x <= W; x++) {
      // Read through the map's own dimensions so a size change lands the old
      // map in a corner rather than shearing it.
      const v = (x <= m.w && z <= m.h) ? corners[z * (m.w + 1) + x] : 0;
      terrain.setCorner(x, z, v);
    }
  }
  for (let z = 0; z < Math.min(H, m.h); z++) {
    for (let x = 0; x < Math.min(W, m.w); x++) ground[z * W + x] = g[z * m.w + x];
  }
}
