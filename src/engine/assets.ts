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

/** Mean linear RGB of an sRGB RGBA byte image (or one layer of an array). */
export function meanLinear(px: Uint8Array | Uint8ClampedArray, offset = 0, count = px.length / 4): [number, number, number] {
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < count; i++) {
    const o = offset + i * 4;
    r += lin(px[o]); g += lin(px[o + 1]); b += lin(px[o + 2]);
  }
  return [r / count, g / count, b / count];
}

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
  /** Mean linear colour of each type's tiles, all variants together. */
  meanOf: (type: string) => [number, number, number];
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
  const means = new Map<string, [number, number, number]>();
  const meanOf = (type: string) => {
    let m = means.get(type);
    if (!m) {
      const t = Math.max(0, types.indexOf(type));
      m = meanLinear(data, t * variants * tilePx * tilePx * 4, variants * tilePx * tilePx);
      means.set(type, m);
    }
    return m;
  };

  return { texture, index, layerOf, meanOf };
}

export interface GroundArrays {
  colour: THREE.DataArrayTexture;
  normal: THREE.DataArrayTexture;
  types: string[];
  /** Map tiles one texture spans; a tile samples its own 1/span patch. */
  span: number;
  /** Mean linear colour of each type's albedo tile. */
  means: [number, number, number][];
}

/**
 * The ground for the 3D terrain: per type, an unlit colour tile and a normal
 * map, each spanning a 4x4 block of map tiles (tools/render/export_ground.py).
 * Two texture arrays, one layer per type; the shader lights them itself with
 * the same sun the buildings get.
 */
export async function loadGroundArrays(base: string): Promise<GroundArrays> {
  const index = await fetch(`${base}/ground.json${V}`).then(r => r.json()) as
    { types: string[]; span: number; px: number };
  const { types, span, px } = index;
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;

  const means: [number, number, number][] = [];
  const build = async (suffix: string, srgb: boolean) => {
    const data = new Uint8Array(px * px * 4 * types.length);
    for (let t = 0; t < types.length; t++) {
      const img = await loadImage(`${base}/${types[t]}_${suffix}.webp${V}`);
      ctx.drawImage(img, 0, 0, px, px);
      const src = ctx.getImageData(0, 0, px, px).data;
      const offset = t * px * px * 4;
      for (let y = 0; y < px; y++) {
        const row = (px - 1 - y) * px * 4;
        data.set(src.subarray(row, row + px * 4), offset + y * px * 4);
      }
      if (srgb) means[t] = meanLinear(src);
    }
    const tex = new THREE.DataArrayTexture(data, px, px, types.length);
    tex.format = THREE.RGBAFormat;
    tex.type = THREE.UnsignedByteType;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = 8;
    tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.needsUpdate = true;
    return tex;
  };
  const [colour, normal] = await Promise.all([build('col', true), build('nrm', false)]);
  return { colour, normal, types, span, means };
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
  /** One layer per page; every page the same size. */
  texture: THREE.DataArrayTexture;
  /** The pages as drawn, for anything that needs the pixels on the CPU side. */
  pages: HTMLCanvasElement[];
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
  maxH = 8192,
): Promise<PackedAtlas> {
  const loaded = await Promise.all(entries.map(async e => ({
    e, img: await loadImage(`${base}/${e.file}${V}`),
  })));

  loaded.sort((a, b) => b.e.height - a.e.height);   // shelf pack, tallest first

  // Shelves across the width, and when the next shelf would run past the
  // height a GPU can take, a new PAGE: another layer of the same texture.
  // One page used to be the whole budget, and it was spent.
  let x = padding, y = padding, shelfH = 0, usedW = 0, page = 0;
  const pageH: number[] = [];
  const placed: { e: PackEntry; img: HTMLImageElement; px: number; py: number; page: number }[] = [];

  for (const item of loaded) {
    const w = item.e.width + padding;
    const h = item.e.height + padding;
    if (x + w > maxW) { x = padding; y += shelfH; shelfH = 0; }
    if (y + Math.max(shelfH, h) + padding > maxH && y > padding) {
      pageH[page] = y + shelfH + padding;
      page++; x = padding; y = padding; shelfH = 0;
    }
    placed.push({ e: item.e, img: item.img, px: x, py: y, page });
    x += w;
    usedW = Math.max(usedW, x);
    shelfH = Math.max(shelfH, h);
  }
  pageH[page] = y + shelfH + padding;

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
  // Every page is the tallest page's height: layers of one texture share a
  // size, and a second page is usually a short one.
  const quad = (n: number) => Math.ceil(Math.max(1, n) / 4) * 4;
  // Clamped to maxW. Every sprite is placed with its right edge at or inside
  // maxW, so the clamp cannot cut anything off -- but a full shelf plus the
  // trailing padding, rounded up, lands a few pixels PAST the limit we chose
  // maxW to respect, and those few pixels are the difference between fitting a
  // GPU's maximum texture size and failing to upload at all.
  const W = Math.min(maxW, quad(usedW + padding));
  const H = Math.min(maxH, quad(Math.max(...pageH)));
  const pages: HTMLCanvasElement[] = [];
  const ctxs: CanvasRenderingContext2D[] = [];
  for (let p = 0; p <= page; p++) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    pages.push(canvas);
    ctxs.push(canvas.getContext('2d')!);
  }
  if (page > 0) {
    console.log(`[assets] atlas is ${page + 1} pages of ${W}x${H}`);
  }

  const frames: Record<string, Frame> = {};
  for (const p of placed) {
    ctxs[p.page].drawImage(p.img, p.px, p.py);
    frames[p.e.key] = {
      x: p.px, y: p.py, w: p.e.width, h: p.e.height,
      ax: p.e.ax, ay: p.e.ay, scale: p.e.scale,
      ...(p.page ? { page: p.page } : {}),
    };
  }

  // The pages, stacked into one array texture. A canvas texture flips its
  // rows on upload and the UV maths in SpriteBatch counts on that; an array
  // texture cannot be flipped by the driver, so the rows are laid bottom-up
  // here and the maths stays as it was.
  const layer = W * H * 4;
  const data = new Uint8Array(layer * pages.length);
  for (let p = 0; p < pages.length; p++) {
    const px = ctxs[p].getImageData(0, 0, W, H).data;
    const row = W * 4;
    for (let r = 0; r < H; r++) {
      data.set(px.subarray(r * row, (r + 1) * row), p * layer + (H - 1 - r) * row);
    }
  }
  const texture = new THREE.DataArrayTexture(data, W, H, pages.length);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.needsUpdate = true;
  return { image: '', size: [W, H], scale, frames, texture, pages };
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
  // ?atlasH=4096 on the URL forces the catalogue onto several shorter pages,
  // to exercise the paging on hardware that would never otherwise need it.
  const maxH = Number(new URLSearchParams(location.search).get('atlasH')) || 8192;
  const packed = await packFrames(base, entries, bMeta[0]?.scale ?? 2, 2, 8192, maxH);
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
