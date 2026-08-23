import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

/** package.json is the one place the version number is written. */
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

/**
 * A build id, stamped into the bundle and appended to every asset URL.
 *
 * The game's own assets live under /assets/tiles and /assets/sprites, which
 * share a URL prefix with Vite's fingerprinted bundles but are NOT
 * fingerprinted themselves -- their names are fixed and their contents change
 * whenever the Blender pipeline is re-run. Served with the long cache those
 * bundles want, a browser keeps last month's manifest forever: an unknown
 * ground type silently falls back to layer 0, which is sand, and a sprite the
 * manifest has never heard of is simply not drawn. Both are invisible
 * failures, and both were reported as such.
 *
 * Appending ?v=<id> makes every asset URL change when the build does, so the
 * long cache stays correct instead of becoming a trap.
 */
function buildId(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString().trim();
  } catch {
    // No git in the Docker build context, and none needed -- any value that
    // changes per build does the job.
    return String(Date.now());
  }
}

export default defineConfig({
  define: {
    __BUILD_ID__: JSON.stringify(process.env.BUILD_ID || buildId()),
    __VERSION__: JSON.stringify(pkg.version),
  },
});
