/**
 * Phone and tablet controls.
 *
 * The desktop game is a mouse and a keyboard: left-drag pans, left-click
 * selects, right-click orders, and letters do the rest. None of the right
 * button or the letters exist on a glass slab. This module supplies the
 * missing half -- a thumb bar for the actions that were keys, a pinch to zoom,
 * and a "command" toggle so a tap can march the selected troops without a
 * second mouse button.
 *
 * Deliberately thin. It adds a bar and reports gestures; every action it fires
 * is one the game already had, routed through the same handlers as the mouse,
 * so touch and desktop can never drift into two different games.
 *
 * The feature-detect and the page-gesture lock follow the Dadud/fiefdom fork's
 * touch.ts (AGPL); the pad and the pinch handling here are our own and wire to
 * our own input model.
 */

/** Force on with `?touch=1`, off with `?touch=0`, else detect a coarse pointer. */
export function isTouchUi(): boolean {
  if (typeof window === 'undefined') return false;
  const forced = new URLSearchParams(window.location.search).get('touch');
  if (forced === '1' || forced === 'true') return true;
  if (forced === '0' || forced === 'false') return false;
  return window.matchMedia('(pointer: coarse)').matches
    && !window.matchMedia('(pointer: fine)').matches;
}

/** Stop the page itself scrolling, bouncing or pinch-zooming under the game. */
export function lockPageGestures(): void {
  const html = document.documentElement;
  html.style.touchAction = 'none';
  document.body.style.touchAction = 'none';
  document.body.style.overscrollBehavior = 'none';
  const stop = (e: Event) => e.preventDefault();
  document.addEventListener('gesturestart', stop, { passive: false });
  // A two-finger move anywhere but a real panel is the map's to handle.
  document.addEventListener('touchmove', e => {
    if ((e.target as HTMLElement | null)?.closest('#ui, #menu, #pause, #ed, #wn')) return;
    if (e.touches.length > 1) e.preventDefault();
  }, { passive: false });
}

export type PadMode = 'select' | 'command';

export interface PadHooks {
  rotate(dir: 1 | -1): void;
  zoom(dir: 1 | -1): void;
  toggleBuild(): void;
  pause(): void;
  /** Told when the mode flips, so the map cursor can reflect it. */
  onMode(mode: PadMode): void;
}

const CSS = `
#pad { position: fixed; left: 0; right: 0; bottom: 0; z-index: 25;
  display: none; gap: 6px; padding: 8px 10px calc(8px + env(safe-area-inset-bottom));
  justify-content: center; pointer-events: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
html.touch #pad { display: flex; }
#pad button { pointer-events: auto; min-width: 54px; height: 48px; padding: 0 10px;
  font: inherit; font-size: 13px; font-weight: 600; color: #ecdfc2;
  background: rgba(24,19,12,.94); border: 1px solid rgba(196,162,96,.34);
  border-radius: 8px; box-shadow: 0 3px 12px rgba(0,0,0,.5);
  -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
#pad button:active { background: rgba(44,34,19,.98); }
#pad button.on { background: rgba(240,200,105,.22); border-color: #f0c869; color: #fff; }
#pad .grow { flex: 0 0 auto; }
/* The build menu and panels are laid out for a mouse; give them room to be
   tapped and keep them clear of the bar. */
html.touch #build button, html.touch #buildbar button,
html.touch #buildmenu button, html.touch #controls button { min-height: 34px; }
html.touch #ui { bottom: 64px; }
`;

/**
 * Build the thumb bar. Returns the current mode getter and a setter, so the
 * canvas handler can ask "are we commanding?" on each tap.
 */
export function makeTouchPad(hooks: PadHooks): {
  mode: () => PadMode; setMode: (m: PadMode) => void;
} {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const pad = document.createElement('div');
  pad.id = 'pad';

  let mode: PadMode = 'select';

  const btn = (label: string, on: () => void, cls = '') => {
    const b = document.createElement('button');
    b.className = cls;
    b.textContent = label;
    // pointerup, not click: click is delayed ~300ms on some mobile browsers,
    // and a build game wants the tap to register the instant the thumb lifts.
    b.addEventListener('pointerup', e => { e.preventDefault(); e.stopPropagation(); on(); });
    pad.appendChild(b);
    return b;
  };

  btn('↺', () => hooks.rotate(-1));       // rotate left
  btn('↻', () => hooks.rotate(1));         // rotate right
  btn('−', () => hooks.zoom(-1));          // zoom out
  btn('+', () => hooks.zoom(1));                // zoom in

  const cmd = btn('Move', () => setMode(mode === 'command' ? 'select' : 'command'), 'grow');

  btn('Build', () => hooks.toggleBuild());
  btn('☰', () => hooks.pause());           // menu

  function setMode(m: PadMode) {
    mode = m;
    cmd.classList.toggle('on', m === 'command');
    cmd.textContent = m === 'command' ? 'Ordering' : 'Move';
    hooks.onMode(m);
  }

  document.body.appendChild(pad);
  return { mode: () => mode, setMode };
}

export interface PinchHooks {
  zoom(dir: 1 | -1): void;
}

/**
 * Two-finger pinch to zoom, on the canvas.
 *
 * Steps our discrete zoom rather than scaling freely -- the camera only has a
 * few zoom levels, and a smooth pinch that snaps on release feels more broken
 * than a pinch that steps as it crosses each threshold. A threshold on the
 * distance ratio is what turns a continuous pinch into those steps.
 */
export function attachPinch(canvas: HTMLElement, hooks: PinchHooks): void {
  const active = new Map<number, { x: number; y: number }>();
  let baseDist = 0;

  const dist = () => {
    const [a, b] = [...active.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  };

  canvas.addEventListener('pointerdown', e => {
    if (e.pointerType !== 'touch') return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (active.size === 2) baseDist = dist();
  });
  canvas.addEventListener('pointermove', e => {
    if (!active.has(e.pointerId)) return;
    active.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (active.size !== 2 || baseDist <= 0) return;
    const ratio = dist() / baseDist;
    if (ratio > 1.25) { hooks.zoom(1); baseDist = dist(); }
    else if (ratio < 0.8) { hooks.zoom(-1); baseDist = dist(); }
  });
  const drop = (e: PointerEvent) => { active.delete(e.pointerId); baseDist = 0; };
  canvas.addEventListener('pointerup', drop);
  canvas.addEventListener('pointercancel', drop);

  /** True while two fingers are down, so the pan handler can stand aside. */
  (canvas as unknown as { pinching: () => boolean }).pinching = () => active.size >= 2;
}
