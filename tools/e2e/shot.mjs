/**
 * Boot the built game headless, start a map, build a little, and write a
 * handful of screenshots at set zooms and rotations. The eyes of the 3D
 * renderer work: run it with and without ?r3d=0 and compare.
 *
 *   node tools/e2e/shot.mjs http://127.0.0.1:8931/?r3d=0 9341 /tmp/shots sprites
 *   node tools/e2e/shot.mjs http://127.0.0.1:8931/ 9341 /tmp/shots meshes
 */
import { CDP, getJSON } from './cdp.mjs';
import fs from 'node:fs';

const [url, port, outDir, tag = 'shot'] = process.argv.slice(2);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
fs.mkdirSync(outDir, { recursive: true });

const ver = await getJSON(`http://127.0.0.1:${port}/json/version`);
const c = new CDP(); await c.connect(ver.webSocketDebuggerUrl);
const { targetId } = await c.send('Target.createTarget', { url: 'about:blank' });
const { sessionId: s } = await c.send('Target.attachToTarget', { targetId, flatten: true });
await c.send('Page.enable', {}, s); await c.send('Runtime.enable', {}, s);
await c.send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false }, s);

const problems = [];
c.onEvent = m => {
  if (m.method === 'Runtime.exceptionThrown') problems.push('exception: ' + m.params.exceptionDetails.exception?.description);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    problems.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description).join(' '));
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
const shot = async name => {
  await ev(`window.__game.redraw()`); await sleep(400);
  await ev(`window.__game.redraw()`); await sleep(200);
  const r = await c.send('Page.captureScreenshot', { format: 'png' }, s);
  fs.writeFileSync(`${outDir}/${tag}_${name}.png`, Buffer.from(r.data, 'base64'));
  log('saved', name);
};

await c.send('Page.navigate', { url }, s);
if (!await waitFor(`!!document.querySelector('#menu button')`, 120)) { console.error('menu never came up'); process.exit(1); }
await ev(`[...document.querySelectorAll('button')].find(b => /CHOOSE LORDS/.test(b.textContent)).click()`);
await sleep(1500);
await ev(`window.__t0 = performance.now(); [...document.querySelectorAll('button')].find(b => /BEGIN/.test(b.textContent))?.click()`);
if (!await waitFor(`!!window.__game && document.getElementById('loading')?.classList.contains('done')`, 240)) { console.error('game never came up:', await ev(`document.getElementById('loading')?.textContent`)); process.exit(1); }
log('game up', await ev(`((performance.now() - window.__t0) / 1000).toFixed(1)`), 's from Begin to map');
await sleep(2000);

// The same little town every run, so two renderers can be compared.
log('built', await ev(`(() => { const g = window.__game; const k = g.state.buildings.find(b => b.name === 'keep');
  let n = 0; for (const name of ['woodcutter', 'hovel', 'hovel', 'wheat_farm', 'granary', 'stockpile', 'well', 'market', 'bakery', 'barracks', 'mill', 'quarry']) { let ok = false;
    for (let z = k.z - 12; z < k.z + 12 && !ok; z++) for (let x = k.x - 12; x < k.x + 12 && !ok; x++) if (g.build(name, x, z) === name) ok = true;
    if (ok) n++; } return n; })()`), 'of 12');
// A stretch of curtain wall with a gatehouse and towers, and two hovels
// turned a quarter and a half: the rotation code paths.
log('castle', await ev(`(() => { const g = window.__game; const k = g.state.buildings.find(b => b.name === 'keep');
  const out = {};
  out.wall = g.buildLine('wall', k.x - 6, k.z + 8, k.x + 8, k.z + 8).built;
  out.tower = g.build('tower', k.x - 8, k.z + 7);
  out.gate = g.build('gatehouse', k.x + 1, k.z + 8);
  g.placement.select('hovel'); g.placement.turnBy(1);
  out.hovel1 = g.build('hovel', k.x - 6, k.z + 4);
  g.placement.select('hovel'); g.placement.turnBy(2);
  out.hovel2 = g.build('hovel', k.x - 3, k.z + 4);
  g.placement.cancel();
  return JSON.stringify(out); })()`));
await ev(`window.__game.stepSim(120)`);
await sleep(1500);

await shot('z0_r0');
await ev(`window.__game.iso.zoomBy(2)`); await shot('z2_r0');
await ev(`window.__game.iso.rotateBy(1)`); await shot('z2_r1');
await ev(`window.__game.iso.rotateBy(1)`); await shot('z2_r2');
await ev(`window.__game.iso.zoomBy(1)`); await shot('z3_r2');
// free camera: between the sprite rotations, at an in-between zoom
await ev(`window.__game.iso.rotateBy(-2); window.__game.iso.rotateByDeg(-25); window.__game.iso.zoomByFactor(0.8); window.__game.iso.settle()`);
await shot('free_az20');
await ev(`window.__game.iso.rotateByDeg(-120); window.__game.iso.settle()`);
await shot('free_az260');
await ev(`window.__game.iso.rotateByDeg(145); window.__game.iso.settle()`);
// a raid, so there are soldiers to look at: let them march a while, then
// look at wherever they are
await ev(`window.__game.spawnRaid(12); window.__game.stepSim(75)`);
log('raiders', await ev(`(() => { const g = window.__game; const s = g.army.soldiers.filter(x => x.side !== 0);
  if (!s.length) return 'none';
  // the biggest cluster: the raider with most others within six tiles
  let best = s[0], bn = -1;
  for (const a of s) { const n = s.filter(b => Math.hypot(a.x - b.x, a.z - b.z) < 6).length; if (n > bn) { bn = n; best = a; } }
  g.iso.target.set(best.x, g.terrain.heightAt(best.x, best.z), best.z); g.iso.zoomBy(3); g.iso.settle();
  return s.length + ' soldiers, ' + bn + ' near ' + best.type + ' at ' + best.x.toFixed(1) + ',' + best.z.toFixed(1)
    + ' types ' + [...new Set(s.map(x => x.type))].join('/'); })()`));
await shot('raid');
await ev(`window.__game.iso.rotateByDeg(90); window.__game.iso.settle()`);
await shot('raid_b');
// the ghost: a wall run in hand, hovering over the keep's doorstep
await ev(`window.__game.iso.rotateBy(2); window.__game.iso.zoomBy(-1)`);
await ev(`(() => { const g = window.__game; const k = g.state.buildings.find(b => b.name === 'keep');
  g.placement.select('wall'); g.placement.dragFrom = { x: k.x - 4, z: k.z + 6 }; g.placement.moveTo(k.x + 6, k.z + 6); })()`);
await shot('ghost');
await ev(`window.__game.placement.cancel()`);
log('profile:\n' + await ev(`window.__game.profileLines()`));
if (problems.length) console.error('PROBLEMS:\n' + problems.slice(0, 20).join('\n'));
process.exit(0);
