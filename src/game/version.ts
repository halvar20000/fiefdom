/**
 * What build this is.
 *
 * The version comes from package.json at build time, so the number in the
 * corner of the title screen, the number in package.json and the tag on the
 * container image cannot drift apart. The build id is the git sha, which is
 * what actually identifies a running container -- two builds of "1.0.0" are
 * indistinguishable without it, and telling them apart is the whole reason the
 * line exists.
 */

declare const __VERSION__: string;
declare const __BUILD_ID__: string;

export const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : '0.0.0';
export const BUILD = typeof __BUILD_ID__ === 'string' ? __BUILD_ID__ : 'dev';

/** "v1.0.0 · 1c51cca" */
export function versionLine(): string {
  return `v${VERSION} · ${BUILD}`;
}
