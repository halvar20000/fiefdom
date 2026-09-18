/**
 * Boot the built game in a headless Chromium, start a map, run the
 * simulation, and fail on any page error.
 *
 *   node docker/server.mjs &     (PORT=8931 STATIC_DIR=dist DATA_DIR=/tmp/x)
 *   chromium --headless=new --remote-debugging-port=9341 --no-sandbox \
 *            --use-gl=swiftshader --enable-unsafe-swiftshader &
 *   node tools/e2e/smoke.mjs http://127.0.0.1:8931/ 9341
 *
 * This is the test that catches what unit tests cannot: the WebGL, asset-path
 * and base-URL class of bug that only appears in the built container. It
 * drives the game through window.__game, the debug handle main.ts exposes,
 * and prints the frame profile at the end so a slow build shows up as a
 * number. Exit code 1 on any console error, uncaught exception, or a game
 * that does not come up within two minutes.
 */
import { CDP, getJSON } from './cdp.mjs';
import fs from 'node:fs';

const url = process.argv[2] ?? 'http://127.0.0.1:8931/';
const port = process.argv[3] ?? '9341';
const shotPath = process.argv[4];   // optional: where to write a screenshot
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const ver = await getJSON(`http://127.0.0.1:${port}/json/version`);
const c = new CDP(); await c.connect(ver.webSocketDebuggerUrl);
const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: s } = await c.send('Target.attachToTarget', { targetId, flatten: true });
await c.send('Page.enable', {}, s); await c.send('Runtime.enable', {}, s);
await c.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }, s);

const problems = [];
c.onEvent = m => {
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + m.params.exceptionDetails.exception?.description);
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    problems.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
  }
};
const ev = async expression => {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, s);
  if (r.exceptionDetails) throw new Error('evaluate threw: ' + r.exceptionDetails.exception?.description);
  return r.result.value;
};
const waitFor = async (expr, seconds) => {
  for (let i = 0; i < seconds; i++) { if (await ev(expr)) return true; await sleep(1000); }
  return false;
};

await c.send('Page.navigate', { url }, s);
if (!await waitFor(`!!document.querySelector('#menu button')`, 120)) { console.error('menu never came up'); process.exit(1); }
log('menu up');
await ev(`[...document.querySelectorAll('button')].find(b => /CHOOSE LORDS/.test(b.textContent)).click()`);
await sleep(1500);
await ev(`[...document.querySelectorAll('button')].find(b => /BEGIN/.test(b.textContent))?.click()`);
if (!await waitFor(`!!window.__game`, 120)) { console.error('game never came up:', await ev(`document.getElementById('loading')?.textContent`)); process.exit(1); }
log('game up');
await sleep(2000);

// Build a little and run ten minutes of the world.
log('built', await ev(`(() => { const g = window.__game; const k = g.state.buildings.find(b => b.name === 'keep');
  let n = 0; for (const name of ['woodcutter', 'hovel', 'wheat_farm', 'granary']) { let ok = false;
    for (let z = k.z - 14; z < k.z + 14 && !ok; z++) for (let x = k.x - 14; x < k.x + 14 && !ok; x++) if (g.build(name, x, z) === name) ok = true;
    if (ok) n++; } return n; })()`), 'of 4');
await ev(`window.__game.stepSim(600)`);
await sleep(2500);
const state = await ev(`(() => { const g = window.__game; return { elapsed: Math.round(g.state.elapsed), population: g.state.population,
  buildings: g.state.buildings.length, rivals: g.factions.map(f => f.name), soldiers: g.army.soldiers.length }; })()`);
log('after 10 min:', JSON.stringify(state));
log('profile:\n' + await ev(`window.__game.profileLines()`));
if (shotPath) {
  const r = await c.send('Page.captureScreenshot', { format: 'png' }, s);
  fs.writeFileSync(shotPath, Buffer.from(r.data, 'base64'));
}
if (problems.length) { console.error('PROBLEMS:\n' + problems.join('\n')); process.exit(1); }
log('ok');
process.exit(0);
