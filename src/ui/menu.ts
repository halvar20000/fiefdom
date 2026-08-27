import { MAPS, ratings, type MapDef } from '../game/maps';
import { listSlots, setBootIntent, playTime, savedWhen } from '../game/save';
import { listMaps, deleteMap, defOf, type CustomMap } from '../game/custom';
import { versionButton, VERSION_CSS } from './whatsnew';
import { currentUser, isSignedIn, store } from '../game/backend';
import { DIFFICULTY, type Difficulty } from '../game/lord';

const DIFF_KEY = 'fiefdom.difficulty';
const DIFFS: Difficulty[] = ['easy', 'normal', 'heavy'];
function readDifficulty(): Difficulty {
  const v = store.getItem(DIFF_KEY);
  return v === 'easy' || v === 'normal' || v === 'heavy' ? v : 'normal';
}

/** Minimal HTML escaping for an email shown in the footer. */
function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
}

/**
 * What the player chose. The menu can send you to the editor as well as into
 * a game, so it cannot just resolve with a map.
 */
export type MenuChoice =
  | { kind: 'play'; map: MapDef; difficulty: Difficulty }
  | { kind: 'edit'; edit: CustomMap | null };

/**
 * The title screen: pick a map, then play.
 *
 * Resolves with the chosen map and tears itself down. The world is not
 * generated until this settles, so the choice actually shapes the terrain
 * rather than being applied to a map that already exists.
 */
const CSS = `
#menu {
  position: fixed; inset: 0; z-index: 30; overflow: auto;
  display: flex; flex-direction: column; align-items: center;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(84,64,34,.55) 0%, rgba(16,16,14,0) 70%),
    #10100e;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #ecdfc2;
  padding: 40px 20px 56px;
}
#menu h1 {
  font-size: 46px; letter-spacing: 10px; font-weight: 600; color: #f0c869;
  text-shadow: 0 2px 14px rgba(0,0,0,.7); margin-bottom: 4px;
}
#menu .sub { font-size: 12px; opacity: .6; letter-spacing: 2px; margin-bottom: 26px; }
#menu .maps {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(268px, 1fr));
  gap: 12px; width: 100%; max-width: 900px;
}
#menu .map {
  text-align: left; cursor: pointer; padding: 14px 16px 13px;
  background: rgba(24,19,12,.88); border: 1px solid rgba(196,162,96,.28);
  border-radius: 6px; transition: border-color .12s, background .12s, transform .12s;
}
#menu .map:hover { border-color: rgba(240,200,105,.6); background: rgba(34,27,17,.95); }
#menu .map.on {
  border-color: #f0c869; background: rgba(44,34,19,.98);
  transform: translateY(-1px); box-shadow: 0 6px 18px rgba(0,0,0,.45);
}
#menu .map h3 { font-size: 15px; color: #f0c869; margin-bottom: 3px; font-weight: 600; }
#menu .map .diff { font-size: 10px; letter-spacing: 1px; text-transform: uppercase; }
#menu .map .diff.Gentle { color: #8fbf6a; }
#menu .map .diff.Fair   { color: #f0c869; }
#menu .map .diff.Harsh  { color: #e2794f; }
#menu .map .diff.Yours  { color: #9ac0e0; }
#menu .map.mine { border-color: rgba(154,192,224,.30); }
#menu .map.mine.on { border-color: #9ac0e0; }
#menu .own { display: flex; gap: 5px; margin-top: 9px; }
#menu .own button { flex: 1; padding: 5px 0; font: inherit; font-size: 10px;
  cursor: pointer; color: #ecdfc2; background: rgba(255,255,255,.06);
  border: 1px solid rgba(196,162,96,.24); border-radius: 3px; }
#menu .own button:hover { background: rgba(255,255,255,.13); }
#menu .own button.danger { color: #10100e; background: #e2794f; border-color: #e2794f; }
#menu .map.make { display: flex; flex-direction: column; justify-content: center;
  border-style: dashed; border-color: rgba(196,162,96,.34); min-height: 120px; }
#menu .map.make h3 { color: #f0c869; }
#menu .map.make p { margin-bottom: 0; }
#menu .map p { font-size: 11.5px; line-height: 1.55; opacity: .78; margin: 7px 0 10px; }
#menu .stat { display: grid; grid-template-columns: 62px 1fr; gap: 8px;
              align-items: center; font-size: 10px; margin-top: 3px; opacity: .85; }
#menu .pips { display: flex; gap: 3px; }
#menu .pip { width: 15px; height: 5px; border-radius: 1px; background: rgba(236,223,194,.16); }
#menu .pip.on { background: #c8a55f; }
#menu .foe { font-size: 10.5px; margin-top: 9px; padding-top: 8px;
             border-top: 1px solid rgba(196,162,96,.14); }
#menu .foe b { color: #e2794f; }
#menu .foe.none b { color: #8fbf6a; }
#menu .diff { margin-top: 24px; display: flex; align-items: center; gap: 7px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
#menu .diff .lbl { font-size: 11px; letter-spacing: .08em; text-transform: uppercase;
  opacity: .55; margin-right: 4px; }
#menu .diff button { padding: 6px 16px; font: inherit; font-size: 12px; cursor: pointer;
  color: #ecdfc2; background: rgba(60,48,28,.6);
  border: 1px solid rgba(196,162,96,.3); border-radius: 5px; }
#menu .diff button:hover { background: rgba(84,66,36,.85); border-color: rgba(240,200,105,.55); }
#menu .diff button.on { background: rgba(240,200,105,.22); border-color: var(--gold, #f0c869);
  color: #fff; font-weight: 600; }
#menu .go {
  margin-top: 16px; padding: 12px 44px; font: inherit; font-size: 14px;
  letter-spacing: 3px; cursor: pointer; color: #10100e; background: #f0c869;
  border: none; border-radius: 5px; font-weight: 600;
}
#menu .go:hover { background: #ffdc86; }
#menu .go:disabled { opacity: .35; cursor: default; }
#menu .saves { width: 100%; max-width: 900px; margin-top: 24px; }
#menu .saves h4 { font-size: 10px; letter-spacing: 2px; opacity: .5;
                  text-transform: uppercase; margin-bottom: 8px; text-align: center; }
#menu .slot { display: grid; grid-template-columns: 1fr auto; gap: 10px;
              align-items: center; padding: 9px 13px; margin-bottom: 6px; font-size: 11.5px;
              background: rgba(24,19,12,.8); border: 1px solid rgba(196,162,96,.2);
              border-radius: 5px; }
#menu .slot .when { font-size: 9.5px; opacity: .5; }
#menu .slot button { padding: 6px 16px; font: inherit; font-size: 11px; cursor: pointer;
                     color: #10100e; background: #c8a55f; border: none; border-radius: 4px;
                     font-weight: 600; }
#menu .slot button:hover { background: #f0c869; }
#menu .note { margin-top: 16px; font-size: 10.5px; opacity: .45; max-width: 620px;
              text-align: center; line-height: 1.6; }
#menu .ver { margin-top: 10px; }
${VERSION_CSS}
`;

export function showMenu(): Promise<MenuChoice> {
  return new Promise(resolve => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'menu';
    document.body.appendChild(root);

    const h1 = document.createElement('h1');
    h1.textContent = 'FIEFDOM';
    root.appendChild(h1);

    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = 'HOLD THE LAND · WORK IT · KEEP IT';
    root.appendChild(sub);

    const grid = document.createElement('div');
    grid.className = 'maps';
    root.appendChild(grid);

    let chosen: MapDef = MAPS[0];
    const cards: HTMLElement[] = [];

    MAPS.forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'map' + (i === 0 ? ' on' : '');

      const head = document.createElement('h3');
      head.textContent = m.name;
      card.appendChild(head);

      const diff = document.createElement('div');
      diff.className = `diff ${m.difficulty}`;
      diff.textContent = m.difficulty;
      card.appendChild(diff);

      const p = document.createElement('p');
      p.textContent = m.blurb;
      card.appendChild(p);

      for (const r of ratings(m)) {
        const row = document.createElement('div');
        row.className = 'stat';
        const label = document.createElement('span');
        label.textContent = r.label;
        const pips = document.createElement('span');
        pips.className = 'pips';
        for (let k = 0; k < 4; k++) {
          const pip = document.createElement('span');
          pip.className = 'pip' + (k < r.value ? ' on' : '');
          pips.appendChild(pip);
        }
        row.append(label, pips);
        card.appendChild(row);
      }

      const foe = document.createElement('div');
      foe.className = 'foe' + (m.lords ? '' : ' none');
      foe.innerHTML = m.lords === 0
        ? 'Opposition: <b>none</b> — build in peace'
        : m.lords === 1
          ? 'Opposition: <b>1 rival lord</b>'
          : `Opposition: <b>${m.lords} rival lords</b> — and they fight each other`;
      card.appendChild(foe);

      card.onclick = () => {
        chosen = m;
        for (const c of cards) c.classList.remove('on');
        card.classList.add('on');
      };
      cards.push(card);
      grid.appendChild(card);
    });

    // Hand-drawn maps sit in the same grid as the shipped ones: they are
    // played exactly the same way, and a separate list would imply otherwise.
    const mine = listMaps();
    for (const m of mine) {
      const def = defOf(m);
      const card = document.createElement('div');
      card.className = 'map mine';

      const head = document.createElement('h3');
      head.textContent = m.name;
      card.appendChild(head);

      const diff = document.createElement('div');
      diff.className = 'diff Yours';
      diff.textContent = 'Your map';
      card.appendChild(diff);

      const p = document.createElement('p');
      p.textContent = `Painted ${savedWhen(m.savedAt)}.`;
      card.appendChild(p);

      const foe = document.createElement('div');
      foe.className = 'foe' + (m.lords ? '' : ' none');
      foe.innerHTML = m.lords === 0
        ? 'Opposition: <b>none</b>'
        : `Opposition: <b>${m.lords} rival lord${m.lords > 1 ? 's' : ''}</b>`;
      card.appendChild(foe);

      const row = document.createElement('div');
      row.className = 'own';
      const ed = document.createElement('button');
      ed.textContent = 'Edit';
      ed.onclick = e => {
        e.stopPropagation();
        root.remove(); style.remove();
        resolve({ kind: 'edit', edit: m });
      };
      const del = document.createElement('button');
      del.textContent = 'Delete';
      del.onclick = e => {
        e.stopPropagation();
        // Two clicks, because there is no undo and no copy of this anywhere.
        if (del.dataset.armed) { deleteMap(m.id); card.remove(); return; }
        del.dataset.armed = '1';
        del.textContent = 'Really?';
        del.classList.add('danger');
      };
      row.append(ed, del);
      card.appendChild(row);

      card.onclick = () => {
        chosen = def;
        for (const c of cards) c.classList.remove('on');
        card.classList.add('on');
      };
      cards.push(card);
      grid.appendChild(card);
    }

    const make = document.createElement('div');
    make.className = 'map make';
    make.innerHTML = '<h3>+ Draw your own</h3>'
      + '<p>Start from bare desert and paint the ground and hills yourself.</p>';
    make.onclick = () => {
      root.remove(); style.remove();
      resolve({ kind: 'edit', edit: null });
    };
    grid.appendChild(make);

    // How hard the rival lords play. Remembered between games.
    let difficulty = readDifficulty();
    const diffWrap = document.createElement('div');
    diffWrap.className = 'diff';
    diffWrap.innerHTML = '<span class="lbl">Rival lords</span>';
    const diffBtns: Record<Difficulty, HTMLButtonElement> = {} as never;
    for (const d of DIFFS) {
      const b = document.createElement('button');
      b.textContent = DIFFICULTY[d].label;
      b.className = d === difficulty ? 'on' : '';
      b.onclick = () => {
        difficulty = d;
        store.setItem(DIFF_KEY, d);
        for (const k of DIFFS) diffBtns[k].classList.toggle('on', k === d);
      };
      diffBtns[d] = b;
      diffWrap.appendChild(b);
    }
    root.appendChild(diffWrap);

    const go = document.createElement('button');
    go.className = 'go';
    go.textContent = 'BEGIN';
    const leave = () => { root.remove(); style.remove(); };
    go.onclick = () => { leave(); resolve({ kind: 'play', map: chosen, difficulty }); };
    root.appendChild(go);

    // Saved games, if there are any. Hidden entirely when there are none --
    // an empty "Saved games" heading on a first run is just noise.
    const saved = listSlots().filter(i => i.save);
    if (saved.length) {
      const wrap = document.createElement('div');
      wrap.className = 'saves';
      const h4 = document.createElement('h4');
      h4.textContent = 'Or continue a saved game';
      wrap.appendChild(h4);
      for (const info of saved) {
        const row = document.createElement('div');
        row.className = 'slot';
        const who = document.createElement('div');
        who.innerHTML = `<b>${info.slot}.</b> ${info.save!.map.name}` +
          ` — ${playTime(info.save!.elapsed)}` +
          `<div class="when">${savedWhen(info.save!.savedAt)}</div>`;
        const btn = document.createElement('button');
        btn.textContent = 'Load';
        btn.onclick = () => {
          setBootIntent({ kind: 'load', slot: info.slot });
          location.reload();
        };
        row.append(who, btn);
        wrap.appendChild(row);
      }
      root.appendChild(wrap);
    }

    const ver = document.createElement('div');
    ver.className = 'ver';
    ver.appendChild(versionButton());
    root.appendChild(ver);

    // Who is signed in, when Cloudflare Access is in front. Each signed-in
    // player has their own saves; the log-out link is Cloudflare's own.
    if (isSignedIn() && currentUser()) {
      const who = document.createElement('div');
      who.className = 'note';
      who.innerHTML = `Signed in as <b>${escapeHtml(currentUser()!)}</b> — your saves are your own. `;
      const out = document.createElement('a');
      out.textContent = 'Log out';
      out.href = '/cdn-cgi/access/logout';
      out.style.color = 'var(--gold, #f0c869)';
      who.appendChild(out);
      root.appendChild(who);
    }

    const note = document.createElement('div');
    note.className = 'note';
    note.textContent = 'Esc in game to pause, save, load or leave. '
                     + 'The first load takes a moment while the sprites are read.';
    root.appendChild(note);
  });
}
