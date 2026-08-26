import { setBootIntent } from '../game/save';

/**
 * The end screen: a Stronghold-style tally when the war is decided.
 *
 * Shown once, when the last rival keep falls (victory) or the player's own keep
 * does (defeat). Deliberately not modal over a dead game only -- the player can
 * dismiss it and pan across the field they just won, then it does not come back,
 * which is exactly what the original does with its "continue" after the score.
 */

const CSS = `
#over {
  position: fixed; inset: 0; z-index: 60; display: grid; place-items: center;
  background: rgba(8,8,7,.82); backdrop-filter: blur(2px);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #ecdfc2;
  animation: overfade .5s ease;
}
@keyframes overfade { from { opacity: 0 } to { opacity: 1 } }
#over .box {
  width: min(440px, 92vw); background: rgba(24,19,12,.98);
  border: 1px solid rgba(196,162,96,.34); border-radius: 8px;
  box-shadow: 0 16px 50px rgba(0,0,0,.7); padding: 24px 26px 20px; text-align: center;
}
#over h2 { font-size: 24px; letter-spacing: 5px; margin-bottom: 4px; }
#over.win h2 { color: #f0c869; }
#over.lose h2 { color: #e2794f; }
#over .sub { font-size: 11px; opacity: .6; margin-bottom: 18px; }
#over table { width: 100%; border-collapse: collapse; margin-bottom: 18px; }
#over td { padding: 6px 4px; font-size: 12.5px; border-bottom: 1px solid rgba(196,162,96,.12); }
#over td.k { text-align: left; opacity: .78; }
#over td.v { text-align: right; color: #f0c869; font-weight: 600; font-variant-numeric: tabular-nums; }
#over tr:last-child td { border-bottom: 0; }
#over .row { display: flex; gap: 8px; }
#over button {
  flex: 1; padding: 11px 12px; font: inherit; font-size: 12px; cursor: pointer;
  color: #ecdfc2; background: rgba(60,48,28,.7);
  border: 1px solid rgba(196,162,96,.3); border-radius: 4px;
}
#over button:hover { background: rgba(84,66,36,.9); border-color: rgba(240,200,105,.6); }
#over button.primary { background: #f0c869; color: #10100e; font-weight: 600; border-color: #f0c869; }
#over button.primary:hover { background: #ffdc86; }
`;

export interface GameOverOpts {
  win: boolean;
  /** Rows for the tally, in display order. */
  stats: { label: string; value: string | number }[];
  /** Called when the player dismisses the screen to look over the map. */
  onStay: () => void;
}

export function showGameOver(opts: GameOverOpts): void {
  if (document.getElementById('over')) return;

  if (!document.getElementById('over-style')) {
    const style = document.createElement('style');
    style.id = 'over-style';
    style.textContent = CSS;
    document.head.appendChild(style);
  }

  const root = document.createElement('div');
  root.id = 'over';
  root.className = opts.win ? 'win' : 'lose';
  document.body.appendChild(root);

  const box = document.createElement('div');
  box.className = 'box';
  root.appendChild(box);

  const h2 = document.createElement('h2');
  h2.textContent = opts.win ? 'VICTORY' : 'DEFEAT';
  box.appendChild(h2);

  const sub = document.createElement('div');
  sub.className = 'sub';
  sub.textContent = opts.win
    ? 'The last rival keep has fallen. The field is yours.'
    : 'Your keep has fallen. The fief is lost.';
  box.appendChild(sub);

  const table = document.createElement('table');
  table.innerHTML = opts.stats.map(s =>
    `<tr><td class="k">${s.label}</td><td class="v">${s.value}</td></tr>`).join('');
  box.appendChild(table);

  const row = document.createElement('div');
  row.className = 'row';
  const title = document.createElement('button');
  title.className = 'primary';
  title.textContent = 'Return to title';
  title.onclick = () => { setBootIntent({ kind: 'menu' }); location.reload(); };
  const stay = document.createElement('button');
  stay.textContent = opts.win ? 'Survey the field' : 'Look on';
  stay.onclick = () => { root.remove(); opts.onStay(); };
  row.append(title, stay);
  box.appendChild(row);
}
