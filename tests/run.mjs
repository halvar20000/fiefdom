/**
 * The test runner: `npm test`.
 *
 * No framework. The tests are TypeScript files under tests/ that import the
 * game's own modules; esbuild (already here, under Vite) bundles each one to
 * a plain module in a scratch directory and Node's built-in runner executes
 * them. Nothing is added to package.json's dependencies, which is the whole
 * reason it is done this way: the project's identity is that three.js is the
 * one runtime dependency, and a test framework would be the second thing in
 * node_modules that has to keep working.
 *
 * What can be tested here is what runs without a browser: the save format,
 * the seasons, the name tables, the pathfinder, the match's view of who is
 * who. The simulation as a whole needs WebGL and a page, and is driven from
 * outside through window.__game instead (see docs/TESTING.md).
 */
import { build } from 'esbuild';
import { readdirSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, '.build');
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const only = process.argv[2];   // `npm test -- save` runs tests/save.test.ts alone
const files = readdirSync(here)
  .filter(f => f.endsWith('.test.ts') && (!only || f.includes(only)))
  .map(f => join(here, f));
if (!files.length) { console.error('no tests match', only); process.exit(1); }

await build({
  entryPoints: files,
  outdir: out,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
  // Vite's compile-time constants, as vite.config.ts defines them.
  define: { '__VERSION__': '"0.0.0-test"', '__BUILD_ID__': '"test"', 'import.meta.env.DEV': 'false' },
});

const built = readdirSync(out).filter(f => f.endsWith('.test.mjs')).map(f => join(out, f));
const r = spawnSync(process.execPath, ['--test', ...built], { stdio: 'inherit' });
process.exit(r.status ?? 1);
