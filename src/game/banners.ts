/**
 * One banner per faction: the tint its troops and its stone are drawn in, and
 * the flat colour that stands for it in menus.
 *
 * This lived inside main.ts while the only thing that needed it was the code
 * drawing rival lords. Multiplayer gave it a second reader -- the lobby, which
 * has to show four players in the colours they will actually fly, before any
 * world exists to draw. A table two screens apart is a table that drifts, so it
 * is one table now.
 *
 * Two strengths per banner, and the difference is deliberate. A soldier is
 * twenty-odd pixels and has to read as hostile at a glance, so his tint is
 * heavy. A castle covers a third of the screen, and that same heavy tint over
 * that much stone stops looking like a banner colour and starts looking like a
 * broken render.
 */

export interface Banner {
  name: string;
  /** Troop tint, strong. */
  unit: [number, number, number];
  /** Stone tint, soft. */
  stone: [number, number, number];
  /** For menus, the lobby and the placement screen. */
  css: string;
}

/**
 * The player's own colour. Not in the list below: the player's stone and troops
 * are drawn untinted, and this is only ever used to name them in a menu.
 */
export const YOU_CSS = '#f0c869';

/**
 * Seven, which is one player plus the six AI lords a full map can hold.
 *
 * Red needs the least push: warming warm sandstone reads immediately. Cooling
 * it only neutralises, so blue and violet are pushed harder to land at the same
 * apparent distance from the player's own stone. The four after them were added
 * for multiplayer and follow the same rule -- pushed until they read as far
 * from bare sandstone as red does, not until the numbers look symmetrical.
 */
export const BANNERS: Banner[] = [
  { name: 'the Red Lord',    unit: [1.50, 0.62, 0.55], stone: [1.30, 0.78, 0.70], css: '#e2794f' },
  { name: 'the Blue Lord',   unit: [0.55, 0.80, 1.60], stone: [0.62, 0.86, 1.48], css: '#6f9fd8' },
  { name: 'the Violet Lord', unit: [1.22, 0.56, 1.50], stone: [1.14, 0.72, 1.36], css: '#b07fd0' },
  { name: 'the Green Lord',  unit: [0.58, 1.42, 0.66], stone: [0.70, 1.28, 0.78], css: '#79c06a' },
  { name: 'the White Lord',  unit: [1.35, 1.35, 1.32], stone: [1.22, 1.22, 1.20], css: '#d8d4c6' },
  { name: 'the Black Lord',  unit: [0.52, 0.50, 0.54], stone: [0.66, 0.64, 0.68], css: '#6d6a70' },
  { name: 'the Teal Lord',   unit: [0.52, 1.30, 1.34], stone: [0.66, 1.20, 1.24], css: '#5fc0bd' },
];

/** The banner for a faction, wrapping round rather than going undefined. */
export const bannerOf = (i: number): Banner => BANNERS[i % BANNERS.length];
