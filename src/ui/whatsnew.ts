import { RELEASES } from '../game/changelog';
import { VERSION, BUILD, versionLine } from '../game/version';

/**
 * Release notes, in the game.
 *
 * A changelog nobody can reach from the thing it describes is a changelog
 * nobody reads. This is reachable from the title screen and from the pause
 * menu, so "what am I actually running, and what changed" is answerable
 * without leaving the game or opening the repository.
 */

const KEY = 'fiefdom.seenVersion';

const CSS = `
#wn { position: fixed; inset: 0; z-index: 40; display: flex;
  align-items: center; justify-content: center; padding: 24px;
  background: rgba(10,9,7,.78); backdrop-filter: blur(2px);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #ecdfc2; }
#wn .box { width: min(720px, 100%); max-height: 100%; overflow-y: auto;
  background: rgba(24,19,12,.98); border: 1px solid rgba(196,162,96,.34);
  border-radius: 7px; padding: 20px 22px; box-shadow: 0 10px 40px rgba(0,0,0,.6); }
#wn h2 { font-size: 15px; color: #f0c869; letter-spacing: .08em; margin-bottom: 2px; }
#wn .sub { font-size: 10.5px; opacity: .55; margin-bottom: 16px; }
#wn .rel { border-top: 1px solid rgba(196,162,96,.16); padding-top: 14px; margin-top: 14px; }
#wn .rel:first-of-type { border-top: none; padding-top: 0; margin-top: 0; }
#wn .ver { display: flex; align-items: baseline; gap: 10px; margin-bottom: 4px; }
#wn .ver b { font-size: 14px; color: #f0c869; }
#wn .ver span { font-size: 10.5px; opacity: .5; }
#wn .head { font-size: 12px; opacity: .85; margin-bottom: 12px; line-height: 1.55; }
#wn h3 { font-size: 10px; letter-spacing: .09em; text-transform: uppercase;
  opacity: .55; margin: 12px 0 5px; font-weight: 600; }
#wn ul { list-style: none; }
#wn li { font-size: 11.5px; line-height: 1.62; padding-left: 14px; position: relative;
  margin-bottom: 4px; opacity: .88; }
#wn li::before { content: '·'; position: absolute; left: 3px; color: #c8a55f; }
#wn .close { margin-top: 20px; width: 100%; padding: 10px; font: inherit;
  font-size: 12px; letter-spacing: .1em; cursor: pointer; font-weight: 600;
  color: #10100e; background: #f0c869; border: none; border-radius: 5px; }
#wn .close:hover { background: #ffdc86; }
`;

export function showWhatsNew(): void {
  if (document.getElementById('wn')) return;

  const style = document.createElement('style');
  style.textContent = CSS;
  style.id = 'wn-style';
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'wn';

  const box = document.createElement('div');
  box.className = 'box';
  box.innerHTML =
    `<h2>WHAT'S NEW</h2><div class="sub">Running ${versionLine()}</div>`
    + RELEASES.map(r =>
        `<div class="rel"><div class="ver"><b>Version ${r.version}</b>`
        + `<span>${r.date}</span></div>`
        + `<div class="head">${r.headline}</div>`
        + r.sections.map(sec =>
            `<h3>${sec.title}</h3><ul>`
            + sec.items.map(i => `<li>${i}</li>`).join('')
            + '</ul>').join('')
        + '</div>').join('');

  const close = document.createElement('button');
  close.className = 'close';
  close.textContent = 'CLOSE';
  box.appendChild(close);
  root.appendChild(box);
  document.body.appendChild(root);

  const dismiss = () => {
    // Remember what has been read, so the "new" dot only appears for a version
    // this browser has not seen.
    localStorage.setItem(KEY, VERSION);
    root.remove();
    style.remove();
    window.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); dismiss(); } };
  window.addEventListener('keydown', onKey);
  close.onclick = dismiss;
  root.onclick = e => { if (e.target === root) dismiss(); };
}

/** Has this browser seen the running version's notes? */
export function isUnread(): boolean {
  try {
    return localStorage.getItem(KEY) !== VERSION;
  } catch {
    return false;
  }
}

/**
 * The clickable version line. Used by both the title screen and the pause
 * menu, so they cannot disagree about what is running.
 */
export function versionButton(): HTMLElement {
  const el = document.createElement('button');
  el.className = 'verline';
  el.title = 'What changed in this version';
  el.innerHTML = `v${VERSION} <span class="b">${BUILD}</span>`
    + (isUnread() ? '<i class="dot"></i>' : '');
  el.onclick = e => { e.stopPropagation(); showWhatsNew(); };
  return el;
}

export const VERSION_CSS = `
.verline { pointer-events: auto; cursor: pointer; position: relative;
  background: none; border: none; font: inherit; font-size: 10.5px;
  color: #ecdfc2; opacity: .5; letter-spacing: .04em; padding: 4px 6px; }
.verline:hover { opacity: .95; }
.verline .b { opacity: .55; }
.verline .dot { position: absolute; top: 2px; right: 0; width: 5px; height: 5px;
  border-radius: 50%; background: #f0c869; }
`;
