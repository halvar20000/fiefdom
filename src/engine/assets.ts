import * as THREE from 'three';

/**
 * Cache-buster for every asset URL.
 *
 * These files have fixed names and changing contents, so without this a
 * long-lived cache serves last build's manifest and the game degrades
 * silently: an unknown ground type falls back to sand, and a sprite missing
 * from the manifest is skipped rather than drawn.
 */
declare const __BUILD_ID__: string;
const V = (() => {
  if (typeof __BUILD_ID__ === 'string') return `?v=${__BUILD_ID__}`;
  // Reaching here means the bundle was built without vite.config.ts, so asset
  // URLs are unversioned and any browser holding an older copy will keep it.
  // Silent last time; loud now.
  console.error(
    '[assets] built without __BUILD_ID__ — asset URLs are not versioned, so a '
    + 'stale cache cannot be busted. Check vite.config.ts reached the build.');
  return '';
})();

import type { Atlas, Frame } from './sprites';

export function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load ${url}`));
    img.src = url;
  });
}

interface TileIndex {
  tilePx: number;
  variants: number;
  types: string[];
}

/**
 * Ground tiles as a texture ARRAY rather than an atlas.
 *
 * An atlas would bleed neighbouring tile textures into each other at mipmap
 * levels, which shows up as coloured fringing along every tile edge once the
 * camera zooms out. Array layers are sampled independently, so this is simply
 * correct instead of nearly correct.
 */
export async function loadTileArray(base: string): Promise<{
  texture: THREE.DataArrayTexture;
  index: TileIndex;
  layerOf: (type: string, variant: number) => number;
}> {
  const index: TileIndex = await fetch(`${base}/tiles.json${V}`).then(r => r.json());
  const { tilePx, variants, types } = index;
  const depth = types.length * variants;

  const data = new Uint8Array(tilePx * tilePx * 4 * depth);
  const canvas = document.createElement('canvas');
  canvas.width = tilePx;
  canvas.height = tilePx;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  for (let t = 0; t < types.length; t++) {
    for (let v = 0; v < variants; v++) {
      const img = await loadImage(`${base}/${types[t]}_${v}.png${V}`);
      ctx.clearRect(0, 0, tilePx, tilePx);
      ctx.drawImage(img, 0, 0, tilePx, tilePx);
      const px = ctx.getImageData(0, 0, tilePx, tilePx).data;

      const layer = t * variants + v;
      const offset = layer * tilePx * tilePx * 4;
      // Array textures ignore flipY, so flip rows by hand.
      for (let y = 0; y < tilePx; y++) {
        const src = (tilePx - 1 - y) * tilePx * 4;
        data.set(px.subarray(src, src + tilePx * 4), offset + y * tilePx * 4);
      }
    }
  }

  const texture = new THREE.DataArrayTexture(data, tilePx, tilePx, depth);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.needsUpdate = true;

  const layerOf = (type: string, variant: number) => {
    const t = types.indexOf(type);
    return t < 0 ? 0 : t * variants + (variant % variants);
  };

  return { texture, index, layerOf };
}

interface SpriteMetaEntry {
  name: string; rotation: number;
  width: number; height: number;
  anchor_x: number; anchor_y: number;
  footprint: [number, number]; scale: number;
}

interface UnitMetaEntry {
  name: string; clip: string; direction: number; frame: number;
  width: number; height: number;
  anchor_x: number; anchor_y: number; scale: number;
}

export interface PackedAtlas extends Atlas {
  texture: THREE.CanvasTexture;
}

export interface BuildingAtlas extends PackedAtlas {
  footprints: Record<string, [number, number]>;
}

export interface UnitAtlas extends PackedAtlas {
  directions: number;
  clips: Record<string, ClipMeta>;
}

/**
 * `fps` is how fast this clip's frames are meant to be stepped.
 *
 * Optional, and absent means the old flat rate. Without it, raising a clip's
 * frame count stretched the clip in TIME rather than making it smoother --
 * twelve walk frames stepped at ten a second is a 1.2 second stride, and the
 * peasant's legs fall behind the speed he is actually travelling at.
 */
export interface ClipMeta { frames: number; fps?: number }

interface PackEntry {
  key: string; file: string;
  width: number; height: number; ax: number; ay: number;
  scale: number;
}

/**
 * Pack individually-rendered PNGs into one texture at load time.
 *
 * Done in the browser rather than as a build step so the Blender pipeline only
 * ever has to drop PNGs plus a JSON beside them -- there is no separate pack
 * stage to forget to re-run after a re-render.
 */
async function packFrames(
  base: string, entries: PackEntry[], scale: number, padding = 2, maxW = 2048,
): Promise<PackedAtlas> {
  const loaded = await Promise.all(entries.map(async e => ({
    e, img: await loadImage(`${base}/${e.file}${V}`),
  })));

  loaded.sort((a, b) => b.e.height - a.e.height);   // shelf pack, tallest first

  let x = padding, y = padding, shelfH = 0, usedW = 0;
  const placed: { e: PackEntry; img: HTMLImageElement; px: number; py: number }[] = [];

  for (const item of loaded) {
    const w = item.e.width + padding;
    const h = item.e.height + padding;
    if (x + w > maxW) { x = padding; y += shelfH; shelfH = 0; }
    placed.push({ e: item.e, img: item.img, px: x, py: y });
    x += w;
    usedW = Math.max(usedW, x);
    shelfH = Math.max(shelfH, h);
  }
  const totalH = y + shelfH + padding;

  // Exact size, NOT rounded up to a power of two.
  //
  // We are WebGL2 only (the sprite shader is GLSL3), where non-power-of-two
  // textures mipmap and repeat just like any other, so the rounding bought
  // nothing and cost a great deal: the shelf pack fills the width almost
  // exactly, so `usedW + padding` lands a pixel or two past the limit and
  // pot() doubles it. The atlas was allocated 8192 wide to hold 4096 pixels of
  // sprites -- half the texture, and half of a nine-figure byte count, was
  // transparent padding. At the render scale this file now loads, paying that
  // twice over is not affordable.
  //
  // Rounded to a multiple of four only, which keeps row strides aligned.
  const quad = (n: number) => Math.ceil(Math.max(1, n) / 4) * 4;
  const canvas = document.createElement('canvas');
  // Clamped to maxW. Every sprite is placed with its right edge at or inside
  // maxW, so the clamp cannot cut anything off -- but a full shelf plus the
  // trailing padding, rounded up, lands a few pixels PAST the limit we chose
  // maxW to respect, and those few pixels are the difference between fitting a
  // GPU's maximum texture size and failing to upload at all.
  canvas.width = Math.min(maxW, quad(usedW + padding));
  canvas.height = quad(totalH);
  if (canvas.height > maxW) {
    console.warn(`[assets] atlas is ${canvas.width}x${canvas.height}; taller `
      + `than ${maxW} will not upload on some hardware. Trim sprites, drop `
      + 'animation frames, or split the atlas across texture-array layers.');
  }
  const ctx = canvas.getContext('2d')!;

  const frames: Record<string, Frame> = {};
  for (const p of placed) {
    ctx.drawImage(p.img, p.px, p.py);
    frames[p.e.key] = {
      x: p.px, y: p.py, w: p.e.width, h: p.e.height,
      ax: p.e.ax, ay: p.e.ay, scale: p.e.scale,
    };
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return { image: '', size: [canvas.width, canvas.height], scale, frames, texture };
}

export async function buildSpriteAtlas(
  base: string, metaFile: string,
): Promise<BuildingAtlas> {
  const meta: SpriteMetaEntry[] = await fetch(`${base}/${metaFile}${V}`).then(r => r.json());
  const footprints: Record<string, [number, number]> = {};
  const entries: PackEntry[] = meta.map(m => {
    footprints[m.name] = m.footprint;
    return {
      key: `${m.name}_${m.rotation}`, file: `${m.name}_${m.rotation}.png`,
      width: m.width, height: m.height, ax: m.anchor_x, ay: m.anchor_y,
      scale: m.scale,
    };
  });
  const packed = await packFrames(base, entries, meta[0]?.scale ?? 2);
  return { ...packed, footprints };
}

export interface CombinedAtlas extends PackedAtlas {
  footprints: Record<string, [number, number]>;
  directions: number;
  clips: Record<string, ClipMeta>;
}

/**
 * Pack buildings, scatter and units into ONE texture.
 *
 * Everything must live in a single batch so the whole scene can be drawn as one
 * back-to-front stream. Split across two batches, a unit can never be sorted
 * between two buildings, and building shadows end up occluding people standing
 * in front of them.
 */
export async function buildCombinedAtlas(base: string): Promise<CombinedAtlas> {
  const [bMeta, uMeta] = await Promise.all([
    fetch(`${base}/buildings.json${V}`).then(r => r.json()) as Promise<SpriteMetaEntry[]>,
    fetch(`${base}/units.json${V}`).then(r => r.json()) as Promise<{
      directions: number;
      clips: Record<string, ClipMeta>;
      sprites: UnitMetaEntry[];
    }>,
  ]);

  const footprints: Record<string, [number, number]> = {};
  const entries: PackEntry[] = [];

  for (const m of bMeta) {
    footprints[m.name] = m.footprint;
    entries.push({
      key: `${m.name}_${m.rotation}`, file: `${m.name}_${m.rotation}.png`,
      width: m.width, height: m.height, ax: m.anchor_x, ay: m.anchor_y,
      scale: m.scale,
    });
  }
  for (const m of uMeta.sprites) {
    entries.push({
      key: `${m.clip}_${m.direction}_${m.frame}`, file: `${m.name}.png`,
      width: m.width, height: m.height, ax: m.anchor_x, ay: m.anchor_y,
      scale: m.scale,
    });
  }

  // 8192 rather than 4096: at sprite render scale 3 the whole catalogue needs
  // roughly 40 megapixels, and packing that into a 4096-wide shelf produces a
  // strip nearly 9000 tall -- past the 8192 texture limit of a good deal of
  // hardware. Laid out 8192 wide it comes out around 8192x5000, with both
  // dimensions inside the limit.
  const packed = await packFrames(base, entries, bMeta[0]?.scale ?? 2, 2, 8192);
  return {
    ...packed, footprints,
    directions: uMeta.directions, clips: uMeta.clips,
  };
}

export async function buildUnitAtlas(base: string, metaFile = 'units.json'): Promise<UnitAtlas> {
  const meta: {
    directions: number;
    clips: Record<string, ClipMeta>;
    sprites: UnitMetaEntry[];
  } = await fetch(`${base}/${metaFile}${V}`).then(r => r.json());

  const entries: PackEntry[] = meta.sprites.map(m => ({
    key: `${m.clip}_${m.direction}_${m.frame}`, file: `${m.name}.png`,
    width: m.width, height: m.height, ax: m.anchor_x, ay: m.anchor_y,
    scale: m.scale,
  }));
  const packed = await packFrames(base, entries, meta.sprites[0]?.scale ?? 2);
  return { ...packed, directions: meta.directions, clips: meta.clips };
}
