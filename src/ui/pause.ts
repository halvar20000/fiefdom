import {
  listSlots, writeSlot, clearSlot, setBootIntent, playTime, savedWhen,
  type SaveGame,
} from '../game/save';
import { versionButton, VERSION_CSS } from './whatsnew';

const CSS = `
#pause {
  position: fixed; inset: 0; z-index: 40; display: grid; place-items: center;
  background: rgba(8,8,7,.78); backdrop-filter: blur(2px);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #ecdfc2;
}
#pause .box {
  width: min(460px, 92vw); background: rgba(24,19,12,.97);
  border: 1px solid rgba(196,162,96,.34); border-radius: 7px;
  box-shadow: 0 12px 40px rgba(0,0,0,.6); padding: 20px 22px 18px;
}
#pause h2 { font-size: 20px; letter-spacing: 6px; color: #f0c869; margin-bottom: 2px; }
#pause .hint { font-size: 10.5px; opacity: .5; margin-bottom: 16px; }
#pause .row { display: flex; gap: 8px; margin-bottom: 8px; }
#pause button {
  flex: 1; padding: 10px 12px; font: inherit; font-size: 12px; cursor: pointer;
  color: #ecdfc2; background: rgba(60,48,28,.7);
  border: 1px solid rgba(196,162,96,.3); border-radius: 4px;
}
#pause button:hover { background: rgba(84,66,36,.9); border-color: rgba(240,200,105,.6); }
#pause button.primary { background: #f0c869; color: #10100e; font-weight: 600; border-color: #f0c869; }
#pause button.primary:hover { background: #ffdc86; }
#pause button.danger:hover { border-color: #e2794f; color: #ffb391; }
#pause h4 { font-size: 10px; letter-spacing: 2px; opacity: .55; text-transform: uppercase;
            margin: 16px 0 7px; }
#pause .slot {
  display: grid; grid-template-columns: 1fr auto auto; gap: 7px; align-items: center;
  padding: 7px 9px; margin-bottom: 5px; font-size: 11px;
  background: rgba(40,32,19,.6); border: 1px solid rgba(196,162,96,.16); border-radius: 4px;
}
#pause .slot .who { line-height: 1.45; }
#pause .slot .when { font-size: 9.5px; opacity: .55; }
#pause .slot.empty .who { opacity: .4; font-style: italic; }
#pause .slot button { flex: none; padding: 5px 11px; font-size: 10.5px; }
#pause .msg { font-size: 11px; margin-top: 12px; min-height: 15px; color: #8fbf6a; }
#pause .msg.bad { color: #e2794f; }
#pause .ver { text-align: center; margin-top: 12px; }
${VERSION_CSS}
`;

export interface PauseHooks {
  /** Build a snapshot of the running game. */
  snapshot(): SaveGame;
  onResume(): void;
}

/**
 * The in-game menu: resume, save, load, or leave.
 *
 * Loading and quitting both go out through a page reload rather than rebuilding
 * the world in place -- see the note in save.ts. The simulation is already
 * stopped by the caller before this opens, so nothing ticks while it is up.
 */
export function showPause(hooks: PauseHooks): void {
  if (document.getElementById('pause')) return;

  const style = document.createElement('style');
  style.textContent = CSS;
  style.id = 'pause-style';
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'pause';
  document.body.appendChild(root);

  const box = document.createElement('div');
  box.className = 'box';
  root.appendChild(box);

  const close = () => {
    root.remove();
    style.remove();
    hooks.onResume();
  };

  const h2 = document.createElement('h2');
  h2.textContent = 'PAUSED';
  box.appendChild(h2);
  const hint = document.createElement('div');
  hint.className = 'hint';
  hint.textContent = 'Esc to resume';
  box.appendChild(hint);

  // Reachable mid-game as well as from the title screen: "what am I running"
  // is a question you ask when something looks wrong, which is rarely while
  // you are still sitting on the menu.
  const ver = document.createElement('div');
  ver.className = 'ver';
  ver.appendChild(versionButton());

  const msg = document.createElement('div');

  const top = document.createElement('div');
  top.className = 'row';
  const resume = document.createElement('button');
  resume.className = 'primary';
  resume.textContent = 'Resume';
  resume.onclick = close;
  const quit = document.createElement('button');
  quit.className = 'danger';
  quit.textContent = 'Quit to menu';
  quit.onclick = () => {
    setBootIntent({ kind: 'menu' });
    location.reload();
  };
  top.append(resume, quit);
  box.appendChild(top);

  // --- slots ---
  const slotsHead = document.createElement('h4');
  slotsHead.textContent = 'Saved games';
  box.appendChild(slotsHead);

  const slotsWrap = document.createElement('div');
  box.appendChild(slotsWrap);

  box.appendChild(ver);

  const say = (text: string, bad = false) => {
    msg.textContent = text;
    msg.className = bad ? 'msg bad' : 'msg';
  };

  const render = () => {
    slotsWrap.textContent = '';
    for (const info of listSlots()) {
      const row = document.createElement('div');
      row.className = 'slot' + (info.save ? '' : ' empty');

      const who = document.createElement('div');
      who.className = 'who';
      if (info.save) {
        who.innerHTML = `<b>${info.slot}.</b> ${info.save.map.name}` +
          ` — ${playTime(info.save.elapsed)}` +
          `<div class="when">${savedWhen(info.save.savedAt)}</div>`;
      } else {
        who.textContent = `${info.slot}. ${info.error ?? 'empty'}`;
      }
      row.appendChild(who);

      const saveBtn = document.createElement('button');
      saveBtn.textContent = info.save ? 'Overwrite' : 'Save';
      saveBtn.onclick = () => {
        const err = writeSlot(info.slot, hooks.snapshot());
        if (err) say(`Could not save: ${err}`, true);
        else { say(`Saved to slot ${info.slot}.`); render(); }
      };
      row.appendChild(saveBtn);

      const loadBtn = document.createElement('button');
      loadBtn.textContent = info.save ? 'Load' : '—';
      loadBtn.disabled = !info.save;
      loadBtn.onclick = () => {
        setBootIntent({ kind: 'load', slot: info.slot });
        location.reload();
      };
      row.appendChild(loadBtn);

      // A delete that needs a second click, because a mis-click here is the
      // one action in this menu that destroys something.
      if (info.save) {
        const del = document.createElement('button');
        del.className = 'danger';
        del.textContent = 'Delete';
        let armed = false;
        del.onclick = () => {
          if (!armed) { armed = true; del.textContent = 'Sure?'; return; }
          clearSlot(info.slot);
          say(`Slot ${info.slot} deleted.`);
          render();
        };
        row.appendChild(del);
        row.style.gridTemplateColumns = '1fr auto auto auto';
      }

      slotsWrap.appendChild(row);
    }
  };
  render();

  msg.className = 'msg';
  box.appendChild(msg);

  // Esc closes, and is swallowed here so it does not also reach the game.
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.stopPropagation();
    e.preventDefault();
    window.removeEventListener('keydown', onKey, true);
    close();
  };
  window.addEventListener('keydown', onKey, true);
}
