/**
 * Talking to the other lords, mid-siege.
 *
 * A small panel down the left edge that stays out of the way: the last few
 * lines, and a box that opens on Enter and closes on Escape or on sending, with
 * lines ageing out on their own so nothing is left sitting there. It also carries
 * the connection light, because a match where the line has dropped looks exactly
 * like a match where nobody is doing anything, and the difference matters
 * enormously to the player.
 *
 * The one fiddly part is the keyboard. The game reads keys off `window`, so a
 * typed "s" would scroll the camera south while you are trying to say
 * "stone?". Every key event from the input is stopped where it is raised, so it
 * never reaches the window listener at all.
 */

import type { MatchRuntime } from '../net/match';

const CSS = `
#mchat {
  /* Under the stats box, not above the build menu: the build menu grows a row
     taller whenever a category is opened, and anything anchored to the bottom
     left ends up underneath it. This strip of the left edge is empty in the
     desktop and the touch layout alike. */
  position: fixed; left: 12px; top: 190px; z-index: 12; width: 300px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  color: #ecdfc2; pointer-events: none;
}
#mchat .lines {
  display: flex; flex-direction: column; gap: 2px; margin-bottom: 6px;
  max-height: 40vh; overflow: hidden;
  font-size: 11px; line-height: 1.5; text-shadow: 0 1px 3px rgba(0,0,0,.9);
}
#mchat .lines div {
  background: rgba(14,12,9,.62); padding: 3px 7px; border-radius: 3px;
  align-self: flex-start; max-width: 100%; word-break: break-word;
}
#mchat b { color: #f0c869; font-weight: 600; }
#mchat .sys { opacity: .6; font-style: italic; }
#mchat .bar {
  display: flex; align-items: center; gap: 7px; font-size: 10px;
  letter-spacing: 1px; opacity: .65; text-shadow: 0 1px 3px rgba(0,0,0,.9);
}
#mchat .dot { width: 7px; height: 7px; border-radius: 50%; background: #79c06a; }
#mchat .dot.bad { background: #d4694a; }
#mchat input {
  pointer-events: auto; width: 100%; box-sizing: border-box; margin-top: 6px;
  padding: 6px 8px; background: rgba(16,14,10,.95); color: #ecdfc2;
  font: inherit; font-size: 12px; border: 1px solid #f0c869; border-radius: 3px;
}
#mchat input:focus { outline: none; }
#mchat input[hidden] { display: none; }
/* A phone has far less room either side of the map, and the touch build pad
   takes the bottom. Narrower, and fewer lines, rather than a panel that covers
   a third of the world. */
@media (max-width: 720px) {
  #mchat { width: 190px; top: 150px; }
  #mchat .lines { max-height: 22vh; font-size: 10px; }
}
`;

/** How long a line stays on screen once nothing new has arrived. */
const LINGER_MS = 22_000;
/** Most lines shown at once. */
const MAX_LINES = 6;

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/**
 * Attach the panel. Returns a teardown, and a `tick` the frame loop calls so
 * lines age out without a timer of their own.
 */
export function showMatchChat(mp: MatchRuntime): { tick(): void; remove(): void } {
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'mchat';
  root.innerHTML = `
    <div class="lines" id="mc-lines"></div>
    <div class="bar"><span class="dot" id="mc-dot"></span><span id="mc-hint">ENTER TO TALK</span></div>
    <input id="mc-in" maxlength="300" placeholder="Say something…" hidden>`;
  document.body.appendChild(root);

  const linesEl = root.querySelector<HTMLDivElement>('#mc-lines')!;
  const dot = root.querySelector<HTMLSpanElement>('#mc-dot')!;
  const hint = root.querySelector<HTMLSpanElement>('#mc-hint')!;
  const input = root.querySelector<HTMLInputElement>('#mc-in')!;

  /** How many of the runtime's chat lines we have already turned into rows. */
  let shown = 0;
  let rows: { html: string; at: number }[] = [];
  let dirty = true;

  const open = () => {
    input.hidden = false;
    input.focus();
  };
  const shut = () => {
    input.value = '';
    input.hidden = true;
    input.blur();
  };

  // Enter opens the box from anywhere; every key inside it is the box's alone.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Enter' || !input.hidden) return;
    const target = e.target as HTMLElement | null;
    // Not while some other field has focus -- the pause menu, a rename box.
    if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
    e.preventDefault();
    open();
  };
  window.addEventListener('keydown', onKey);

  input.addEventListener('keydown', e => {
    // Stopped here so the game's own window listener never sees it: otherwise
    // typing scrolls the camera and picks build menu entries.
    e.stopPropagation();
    if (e.key === 'Escape') { shut(); return; }
    if (e.key !== 'Enter') return;
    const text = input.value.trim();
    if (text) mp.say(text);
    shut();
  });
  input.addEventListener('keyup', e => e.stopPropagation());
  input.addEventListener('keypress', e => e.stopPropagation());

  const tick = () => {
    // New lines out of the runtime's rolling buffer.
    while (shown < mp.chat.length) {
      const line = mp.chat[shown++];
      rows.push({
        html: `<b>${escapeHtml(line.from)}</b> ${escapeHtml(line.text)}`,
        at: performance.now(),
      });
      dirty = true;
    }
    // The runtime trims its own buffer at 80 lines; if it has, our index is
    // past the end and would never catch up again.
    if (shown > mp.chat.length) shown = mp.chat.length;

    const now = performance.now();
    const kept = rows.filter(r => now - r.at < LINGER_MS).slice(-MAX_LINES);
    if (kept.length !== rows.length) { rows = kept; dirty = true; }
    if (dirty) {
      linesEl.innerHTML = rows.map(r => `<div>${r.html}</div>`).join('');
      dirty = false;
    }

    const bad = !mp.connected;
    dot.classList.toggle('bad', bad);
    hint.textContent = bad ? 'CONNECTION LOST — RECONNECTING' : 'ENTER TO TALK';
  };

  return {
    tick,
    remove() {
      window.removeEventListener('keydown', onKey);
      root.remove();
      style.remove();
    },
  };
}
