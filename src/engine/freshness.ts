/**
 * Catch stale assets loudly.
 *
 * Both ways this can go wrong are silent by construction. `layerOf()` returns
 * 0 for a ground type it has never heard of, and layer 0 is sand -- so painted
 * water renders as desert. `push()` skips any sprite with no frame, so a
 * building draws nothing at all. Neither logs; both look like a broken feature
 * rather than a cached file, and both were reported that way.
 *
 * A manifest older than the code is always a deployment problem -- a cache, a
 * half-copied build, an un-run render script -- and never something the player
 * can be expected to deduce. So say it, on screen, in words.
 */

let shown = false;

export function reportStaleAssets(missing: string[]): void {
  if (!missing.length || shown) return;
  shown = true;

  console.error('[assets] the manifests are older than this build. Missing:', missing);

  const el = document.createElement('div');
  el.style.cssText = [
    'position:fixed', 'left:50%', 'top:12px', 'transform:translateX(-50%)',
    'z-index:9999', 'max-width:min(680px,92vw)', 'padding:12px 16px',
    'background:rgba(58,20,12,.97)', 'border:1px solid #e2794f', 'border-radius:6px',
    'color:#ffd9c6', 'font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace',
    'box-shadow:0 6px 24px rgba(0,0,0,.6)', 'cursor:pointer',
  ].join(';');
  el.innerHTML =
    '<b style="color:#ffb08a">Your browser is using cached assets from an older build.</b><br>'
    + 'Water will draw as sand and new buildings will not draw at all. '
    + 'Hard-refresh to fix it: <b>Ctrl-Shift-R</b> (<b>Cmd-Shift-R</b> on a Mac).<br>'
    + `<span style="opacity:.7">Missing from the manifests: ${missing.join(', ')}</span>`
    + '<br><span style="opacity:.55">(click to dismiss)</span>';
  el.onclick = () => el.remove();
  document.body.appendChild(el);
}

/** Ground types the code knows that the tile manifest does not. */
export function missingTiles(known: readonly string[], manifest: readonly string[]): string[] {
  return known.filter(t => !manifest.includes(t)).map(t => `tile:${t}`);
}

/** Sprites the code expects that the atlas has no frame for. */
export function missingSprites(
  expected: readonly string[], frames: Record<string, unknown>,
): string[] {
  return expected.filter(n => !frames[`${n}_0`]).map(n => `sprite:${n}`);
}
