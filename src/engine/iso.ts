/**
 * Isometric projection constants.
 *
 * Stronghold uses classic 2:1 "game isometric": a unit ground square projects to
 * a diamond twice as wide as it is tall. With a 45 degree azimuth that requires a
 * camera elevation of exactly 30 degrees (sin 30 = 0.5), NOT atan(0.5) -- atan(0.5)
 * is the slope of the diamond edge on screen, which is a different angle.
 *
 * Derivation, camera at azimuth phi, elevation theta, orthographic:
 *   screen-right r = ( cos phi, 0, -sin phi )
 *   screen-up    u = ( -sin phi sin theta, cos theta, -cos phi sin theta )
 * A unit square (0,0)..(1,1) in world XZ projects to a diamond of
 *   width  = 2 cos phi          = 1.41421 world units on screen
 *   height = 2 sin phi sin theta = 0.70711 world units on screen
 * width/height = 1/sin theta = 2  =>  theta = 30 degrees.
 */

export const AZIMUTH_DEG = 45;
export const ELEVATION_DEG = 30;

export const ELEVATION = (ELEVATION_DEG * Math.PI) / 180;
export const AZIMUTH = (AZIMUTH_DEG * Math.PI) / 180;

/** Tile footprint in screen pixels at zoom 1.0 (matches Stronghold's 32x16). */
export const TILE_PX_W = 32;
export const TILE_PX_H = 16;

/**
 * Pixels per world unit measured perpendicular to the view direction.
 * A unit ground square spans 2*cos(45) = sqrt(2) world units horizontally on
 * screen, and we want that to be TILE_PX_W pixels.
 */
export const PIXELS_PER_WORLD_UNIT = TILE_PX_W / Math.SQRT2; // 22.627

/**
 * One terrain elevation step in world units.
 * Stronghold steps by ~8 screen px per level. A world-vertical unit draws
 * cos(theta) * PIXELS_PER_WORLD_UNIT px tall, so 8px => 8/(cos30*22.627) = 0.408.
 */
export const HEIGHT_STEP = 0.408;

/** Sprites are pre-rendered at this multiple of zoom 1.0 so they stay crisp when zoomed in. */
export const SPRITE_RENDER_SCALE = 2;

/** Available zoom levels, as multipliers of PIXELS_PER_WORLD_UNIT. */
export const ZOOM_LEVELS = [1, 1.5, 2] as const;

/** The four camera rotations, in azimuth degrees. */
export const ROTATIONS = [45, 135, 225, 315] as const;
export type RotationIndex = 0 | 1 | 2 | 3;

/** Number of pre-rendered facing directions for animated units. */
export const UNIT_DIRECTIONS = 8;

/**
 * Which of the 8 pre-rendered unit sprites to show.
 *
 * Unit headings are stored in world space, so rotating the camera does not
 * re-render anything: it just shifts which direction index faces the viewer.
 * Each 90 degree camera step equals 2 of the 8 direction slots.
 */
export function unitDirectionIndex(headingRad: number, rotation: RotationIndex): number {
  const step = (Math.PI * 2) / UNIT_DIRECTIONS;
  const raw = Math.round(headingRad / step);
  return (((raw - rotation * 2) % UNIT_DIRECTIONS) + UNIT_DIRECTIONS) % UNIT_DIRECTIONS;
}

/**
 * Direction from the map to the camera, for a given rotation.
 *
 * This MUST match tools/render/rig.py::setup_camera or rendered sprites will not
 * sit correctly on the ground. Blender is Z-up and we are Y-up, so the rig's
 * (x, y, z) becomes our (x, z, -y):
 *     rig:    ( sin az * cos el, -cos az * cos el, sin el )
 *     engine: ( sin az * cos el,  sin el,  cos az * cos el )
 */
export function cameraDirection(rotation: RotationIndex): [number, number, number] {
  const az = (ROTATIONS[rotation] * Math.PI) / 180;
  const cosEl = Math.cos(ELEVATION);
  return [Math.sin(az) * cosEl, Math.sin(ELEVATION), Math.cos(az) * cosEl];
}

/**
 * Sun direction, matching tools/render/rig.py exactly.
 * Terrain is lit in-engine with this so slopes shade the same way the baked
 * sprite shadows do. Get this wrong and buildings look pasted on.
 */
export const SUN_DIRECTION: [number, number, number] = (() => {
  const el = (48.0 * Math.PI) / 180;
  const gx = 1.0, gz = -0.35;
  const glen = Math.hypot(gx, gz);
  return [(gx / glen) * Math.cos(el), Math.sin(el), (gz / glen) * Math.cos(el)];
})();

/**
 * How far toward the camera a sprite must be pushed so it sits in front of the
 * ground it stands on.
 *
 * A sprite is a flat quad drawn at ONE depth, and that depth comes from its
 * tile origin -- which, depending on rotation, is usually the footprint's
 * FARTHEST corner. Every ground tile under the building is then nearer than the
 * sprite and wins the depth test, so the terrain draws over the building's
 * base and it looks half-buried.
 *
 * The fix is to bias the sprite to the depth of its nearest footprint corner.
 * Corner offsets from the origin are (0,0), (w,0), (0,d) and (w,d); the nearest
 * is whichever maximises the dot product with the camera direction, which
 * separates cleanly per axis.
 */
export function footprintDepthBias(w: number, d: number, rotation: RotationIndex): number {
  const az = (ROTATIONS[rotation] * Math.PI) / 180;
  const cosEl = Math.cos(ELEVATION);
  const cx = Math.sin(az) * cosEl;
  const cz = Math.cos(az) * cosEl;

  // Measured FROM THE SPRITE ANCHOR, which spriteAnchor() puts at (x, z + d).
  // Relative to that, the footprint corners are (0,0), (w,0), (0,-d), (w,-d);
  // the bias is the closest of them along the view direction.
  //
  // Getting this wrong does not shift the sprite -- it clips it. Every sprite
  // is drawn at one uniform depth, and on flat ground a constant-depth plane
  // meets the terrain along a line of constant screen-y, so an under-biased
  // building gets sliced off by its own ground in a hard horizontal line.
  return Math.max(0, w * cx) + Math.max(0, -d * cz);
}

/**
 * Where to anchor a ground-standing sprite whose model was built extending into
 * Blender +X / +Y from its origin.
 *
 * The rig puts the Blender camera at -cos(az) on Y while the engine camera uses
 * +cos(az) on Z, so engine_z == -blender_y. A model occupying Blender y 0..d
 * therefore lands on engine z -d..0. Anchoring at z + d slides it back onto the
 * tiles it is supposed to cover. Without this a 3x3 keep is drawn three tiles
 * away from its own footprint, and units correctly walking around the footprint
 * appear to walk straight through the building.
 */
export function spriteAnchor(x: number, z: number, d: number): [number, number] {
  return [x, z + d];
}

/**
 * Depth key for painter-ordering objects on a tile grid, under a given rotation.
 *
 * Must equal the ordering of dot(point, cameraDirection), i.e.
 *   x * sin(azimuth) + z * cos(azimuth)
 * evaluated at azimuth 45 + 90*rotation. Cases 1 and 3 were previously the
 * negation of that, so those two rotations sorted front-to-back: people behind
 * a building were painted over it. The depth buffer masked this until sprites
 * stopped writing depth, at which point painter's order became the only thing
 * holding the scene together.
 */
export function depthKey(x: number, z: number, rotation: RotationIndex): number {
  switch (rotation) {
    case 0: return x + z;    // azimuth  45
    case 1: return x - z;    // azimuth 135
    case 2: return -x - z;   // azimuth 225
    default: return z - x;   // azimuth 315
  }
}
