import {
  BUILDINGS, BUILD_MENU, PRICES, RATIONS, RATION_LEVELS, TAX_LEVELS,
  RESOURCE_LABELS, ALL_RESOURCES, FOOD_RESOURCES,
  SOLDIER_TYPES, SOLDIER_ORDER,
  type RationLevel, type Resource,
} from '../game/defs';
import type { GameState } from '../game/state';
import type { Placement } from '../game/placement';

/** The views the right-hand panel can show, in dropdown order. */
const VIEWS = [
  ['food', 'Food & Ale'],
  ['popularity', 'Popularity'],
  ['production', 'Production'],
  ['barracks', 'Barracks'],
  ['market', 'Market'],
] as const;
type ViewName = typeof VIEWS[number][0];

const CSS = `
:root {
  --panel: rgba(24, 19, 12, .93);
  --edge: rgba(196, 162, 96, .34);
  --ink: #ecdfc2;
  --gold: #f0c869;
  --warn: #e2794f;
  --good: #8fbf6a;
}
#ui, #ui * { box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
#ui { position: fixed; inset: 0; pointer-events: none; color: var(--ink); font-size: 12px; }
#ui .panel {
  background: var(--panel); border: 1px solid var(--edge); border-radius: 5px;
  box-shadow: 0 4px 18px rgba(0,0,0,.5); pointer-events: auto;
}

#topbar {
  /* Pinned BETWEEN the side panels rather than centred on the viewport.
     Centring plus a vw-based max-width is fragile: the arithmetic has to be
     re-derived every time a side panel changes width, and it silently starts
     overlapping when one grows. Anchoring to both edges cannot drift. */
  position: absolute; top: 10px; left: 214px; right: 282px;
  display: flex; flex-wrap: wrap; justify-content: center; gap: 2px 0;
  padding: 7px 10px; align-items: center;
}
#topbar .res { display: flex; align-items: baseline; gap: 5px; padding: 0 8px; }
#topbar .res + .res { border-left: 1px solid rgba(196,162,96,.16); }
#topbar .res .n { color: var(--gold); font-weight: 600; font-variant-numeric: tabular-nums; }
#topbar .res .k { opacity: .62; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; }

#stats { position: absolute; top: 10px; left: 12px; padding: 9px 11px; min-width: 190px; }
#stats .row { display: flex; justify-content: space-between; gap: 14px; line-height: 1.65; }
#stats .row b { color: var(--gold); font-weight: 600; font-variant-numeric: tabular-nums; }
#stats .bar { height: 5px; background: rgba(255,255,255,.10); border-radius: 3px; margin-top: 5px; overflow: hidden; }
#stats .bar i { display: block; height: 100%; background: var(--good); transition: width .3s, background .3s; }

#build { position: absolute; left: 12px; bottom: 12px; padding: 9px; width: 232px; }
#build h4 { margin: 7px 0 5px; font-size: 10px; letter-spacing: .09em;
  text-transform: uppercase; opacity: .58; font-weight: 600; }
#build h4:first-child { margin-top: 0; }
#build .items { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
#build button {
  pointer-events: auto; text-align: left; cursor: pointer;
  background: rgba(255,255,255,.045); color: var(--ink);
  border: 1px solid rgba(196,162,96,.20); border-radius: 3px;
  padding: 5px 6px; font-size: 11px; line-height: 1.3;
}
#build button:hover { background: rgba(255,255,255,.11); border-color: rgba(196,162,96,.45); }
#build button.on { background: rgba(240,200,105,.20); border-color: var(--gold); color: #fff; }
#build button.poor { opacity: .42; }
#build button .c { display: block; font-size: 9px; opacity: .66; margin-top: 1px; }

#controls { padding: 9px 11px; width: 218px; flex: 0 0 auto; margin-top: auto; }
#controls .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
  opacity: .58; margin-bottom: 4px; font-weight: 600; }
#controls .seg { display: flex; gap: 3px; margin-bottom: 9px; }
#controls .seg button {
  flex: 1; pointer-events: auto; cursor: pointer; padding: 4px 0; font-size: 10px;
  background: rgba(255,255,255,.045); color: var(--ink);
  border: 1px solid rgba(196,162,96,.20); border-radius: 3px;
}
#controls .seg button.on { background: rgba(240,200,105,.22); border-color: var(--gold); color: #fff; }
#controls .hint { font-size: 10px; opacity: .55; line-height: 1.5; }

#market { padding: 9px 11px; width: 392px; display: none;
  flex: 2 1 auto; min-height: 220px; overflow-y: auto; }
#market.open { display: block; }
#market .r { display: grid;
  grid-template-columns: 1fr auto auto auto auto auto auto;
  gap: 3px; align-items: center; line-height: 1.7; }
#market .r > span.nm { font-size: 11px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
#market .modes { display: flex; gap: 2px; }
#market .modes button { padding: 2px 5px; font-size: 9px; min-width: 22px; }
#market .modes button.on { background: rgba(240,200,105,.26); border-color: var(--gold); color: #fff; }
#market .thr { display: flex; align-items: center; gap: 2px; }
#market .thr b { min-width: 22px; text-align: right; font-size: 10px;
  color: var(--gold); font-variant-numeric: tabular-nums; }
#market .thr button { padding: 1px 5px; font-size: 10px; }
#market .head { display: grid;
  grid-template-columns: 1fr auto auto auto auto auto auto;
  gap: 3px; font-size: 9px; opacity: .5; text-transform: uppercase;
  letter-spacing: .05em; margin-bottom: 3px; }
#market .head span { text-align: center; }
#market .head span:first-child { text-align: left; }
#market .lvl { display: flex; align-items: center; gap: 1px; }
#market .lvl b { min-width: 24px; text-align: center; font-size: 10px;
  font-variant-numeric: tabular-nums; }
#market .lvl button { padding: 1px 4px; font-size: 10px; }
#market .tog { padding: 2px 6px; font-size: 9px; min-width: 30px; }
#market .tog.on { border-color: var(--gold); color: #fff; }
#market .tog.buy.on { background: rgba(120,170,220,.26); }
#market .tog.sell.on { background: rgba(240,200,105,.26); }
#market .lvl b.off { opacity: .3; }
#market .warn { color: var(--warn); font-size: 10px; margin-bottom: 6px; }
#market .totals { border-top: 1px solid rgba(196,162,96,.16); margin-top: 7px;
  padding-top: 6px; display: flex; justify-content: space-between; font-size: 11px; }
#market button { pointer-events: auto; cursor: pointer; font-size: 10px; padding: 2px 7px;
  background: rgba(255,255,255,.05); color: var(--ink);
  border: 1px solid rgba(196,162,96,.22); border-radius: 3px; }
#market button:hover { background: rgba(255,255,255,.13); }
#market h4 { margin: 0 0 6px; font-size: 10px; letter-spacing: .09em;
  text-transform: uppercase; opacity: .58; }

/* Right-hand column. Both panels live in flow here, so one growing can never
   land on top of the other -- which is exactly what happened when the ale
   block made the stats panel taller than the market's hard-coded offset. */
#rightcol { position: absolute; right: 12px; top: 10px; bottom: 12px;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  pointer-events: none; }
#rightcol > * { pointer-events: auto; }
/* Both scrollable with a floor, so neither can starve the other. The stats
   panel is ~23 rows once the popularity breakdown is open; left un-capped it
   squeezed the market down to a single visible row. */
/* One right-hand panel, one view at a time. Everything used to be on screen
   at once and the two large panels fought over the same column. */
#rightpanel { width: 268px; display: flex; flex-direction: column;
  min-height: 0; flex: 1 1 auto; padding: 8px 9px; }
#rightpanel.wide { width: 392px; }
#rightpanel.hidden { display: none; }
#rightpanel .head { display: flex; gap: 6px; align-items: center;
  margin-bottom: 7px; flex: 0 0 auto; }
#rightpanel select {
  flex: 1; pointer-events: auto; cursor: pointer;
  background: rgba(255,255,255,.06); color: var(--ink);
  border: 1px solid rgba(196,162,96,.28); border-radius: 3px;
  padding: 3px 5px; font-size: 11px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
#rightpanel select:focus { outline: 1px solid var(--gold); }
#rightpanel .head button {
  pointer-events: auto; cursor: pointer; padding: 3px 7px; font-size: 11px;
  background: rgba(255,255,255,.05); color: var(--ink);
  border: 1px solid rgba(196,162,96,.22); border-radius: 3px;
}
#rightpanel .view { display: none; overflow-y: auto; min-height: 0; flex: 1 1 auto; }
#rightpanel .view.on { display: block; }

#rightpanel h4 { margin: 7px 0 5px; font-size: 10px; letter-spacing: .09em;
  text-transform: uppercase; opacity: .58; font-weight: 600; }
#rightpanel h4:first-child { margin-top: 0; }
#rightpanel .food { border-bottom: 1px solid rgba(196,162,96,.16);
  padding-bottom: 7px; margin-bottom: 7px; }
#rightpanel .fr { display: flex; justify-content: space-between; line-height: 1.7; }
#rightpanel .fr b { font-variant-numeric: tabular-nums; }
#rightpanel .g { color: var(--good); }
#rightpanel .w { color: var(--warn); }
#rightpanel .n { color: var(--gold); }
#rightpanel .dim { opacity: .45; }
#rightpanel table { width: 100%; border-collapse: collapse; }
#rightpanel td { padding: 1px 0; font-size: 11px; font-variant-numeric: tabular-nums; }
#rightpanel td.r { text-align: right; width: 46px; }
#rightpanel td.name { opacity: .82; }
#rightpanel .hint { font-size: 10px; opacity: .5; margin-top: 6px; line-height: 1.45; }
/* Soldier rows need their own grid. Reusing #market .r crammed name, price,
   count and button into one column with no gaps. */
#view-barracks .r { display: grid;
  grid-template-columns: 1fr auto 22px 58px; gap: 8px; align-items: center;
  padding: 4px 0; border-bottom: 1px solid rgba(196,162,96,.12); }
#view-barracks .r > .nm { font-size: 11px; }
#view-barracks .r > .c { font-size: 10px; opacity: .72; white-space: nowrap; }
#view-barracks .r > .v { font-size: 11px; text-align: right; color: var(--gold); }
#view-barracks .tog { padding: 3px 6px; font-size: 10px; width: 100%; }
#view-barracks .tog.poor { opacity: .40; }
#view-barracks .row { display: flex; justify-content: space-between;
  margin-top: 8px; font-size: 11px; }
#view-barracks .warn { font-size: 11px; color: var(--warn); margin-bottom: 6px; }
#rightpanel .pf { display: flex; justify-content: space-between; line-height: 1.6;
  font-size: 11px; }
#rightpanel .pf span { opacity: .82; }
#rightpanel .pf b { font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }
#rightpanel .pf.zero { opacity: .38; }
#rightpanel .pf.total { border-top: 1px solid rgba(196,162,96,.16);
  margin-top: 4px; padding-top: 4px; }
#rightpanel .pf.total b { color: var(--gold); }
#market .warn { color: var(--warn); font-size: 10px; margin-bottom: 6px; }
#market .totals { border-top: 1px solid rgba(196,162,96,.16); margin-top: 7px;
  padding-top: 6px; display: flex; justify-content: space-between; font-size: 11px; }
#market .r { display: grid;
  grid-template-columns: 1fr auto auto auto auto auto auto;
  gap: 3px; align-items: center; line-height: 1.7; }
#market .r > span.nm { font-size: 11px; white-space: nowrap;
  overflow: hidden; text-overflow: ellipsis; }
#market .modes { display: flex; gap: 2px; }
#market .modes button { padding: 2px 5px; font-size: 9px; min-width: 22px; }
#market .modes button.on { background: rgba(240,200,105,.26); border-color: var(--gold); color: #fff; }
#market .thr { display: flex; align-items: center; gap: 2px; }
#market .thr b { min-width: 22px; text-align: right; font-size: 10px;
  color: var(--gold); font-variant-numeric: tabular-nums; }
#market .thr button { padding: 1px 5px; font-size: 10px; }
#market .head { display: grid;
  grid-template-columns: 1fr auto auto auto auto auto auto;
  gap: 3px; font-size: 9px; opacity: .5; text-transform: uppercase;
  letter-spacing: .05em; margin-bottom: 3px; }
#market .head span { text-align: center; }
#market .head span:first-child { text-align: left; }
#market .lvl { display: flex; align-items: center; gap: 1px; }
#market .lvl b { min-width: 24px; text-align: center; font-size: 10px;
  font-variant-numeric: tabular-nums; }
#market .lvl button { padding: 1px 4px; font-size: 10px; }
#market .tog { padding: 2px 6px; font-size: 9px; min-width: 30px; }
#market .tog.on { border-color: var(--gold); color: #fff; }
#market .tog.buy.on { background: rgba(120,170,220,.26); }
#market .tog.sell.on { background: rgba(240,200,105,.26); }
#market .lvl b.off { opacity: .3; }
#market .warn { color: var(--warn); font-size: 10px; margin-bottom: 6px; }
#market .totals { border-top: 1px solid rgba(196,162,96,.16); margin-top: 7px;
  padding-top: 6px; display: flex; justify-content: space-between; font-size: 11px; }
#market button { pointer-events: auto; cursor: pointer; font-size: 10px; padding: 2px 7px;
  background: rgba(255,255,255,.05); color: var(--ink);
  border: 1px solid rgba(196,162,96,.22); border-radius: 3px; }
#market button:hover { background: rgba(255,255,255,.13); }
#market h4 { margin: 0 0 6px; font-size: 10px; letter-spacing: .09em;
  text-transform: uppercase; opacity: .58; }

/* Right-hand column. Both panels live in flow here, so one growing can never
   land on top of the other -- which is exactly what happened when the ale
   block made the stats panel taller than the market's hard-coded offset. */
#rightcol { position: absolute; right: 12px; top: 10px; bottom: 12px;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  pointer-events: none; }
#rightcol > * { pointer-events: auto; }
/* Both scrollable with a floor, so neither can starve the other. The stats
   panel is ~23 rows once the popularity breakdown is open; left un-capped it
   squeezed the market down to a single visible row. */
#stats2 { padding: 9px 11px; width: 258px;
  flex: 1 1 auto; min-height: 130px; overflow-y: auto; }
#stats2 h4 { margin: 0 0 6px; font-size: 10px; letter-spacing: .09em;
  text-transform: uppercase; opacity: .58; }
#stats2 .food { border-bottom: 1px solid rgba(196,162,96,.16);
  padding-bottom: 7px; margin-bottom: 7px; }
#stats2 .fr { display: flex; justify-content: space-between; line-height: 1.7; }
#stats2 .fr b { font-variant-numeric: tabular-nums; }
#stats2 .g { color: var(--good); }
#stats2 .w { color: var(--warn); }
#stats2 .n { color: var(--gold); }
#stats2 table { width: 100%; border-collapse: collapse; }
#stats2 td { padding: 1px 0; font-size: 11px; font-variant-numeric: tabular-nums; }
#stats2 td.r { text-align: right; width: 46px; }
#stats2 td.name { opacity: .82; }
#stats2 .dim { opacity: .40; }
#stats2 .hint { font-size: 10px; opacity: .5; margin-top: 6px; line-height: 1.45; }
#stats2 .pop { border-top: 1px solid rgba(196,162,96,.16); margin-top: 7px; padding-top: 6px; }
#stats2 .pf { display: flex; justify-content: space-between; line-height: 1.6;
  font-size: 11px; }
#stats2 .pf span { opacity: .82; }
#stats2 .pf b { font-variant-numeric: tabular-nums; min-width: 34px; text-align: right; }
#stats2 .pf.zero { opacity: .38; }
#stats2 .pf.total { border-top: 1px solid rgba(196,162,96,.16);
  margin-top: 4px; padding-top: 4px; }
#stats2 .pf.total b { color: var(--gold); }

#notices { position: absolute; left: 50%; bottom: 74px; transform: translateX(-50%);
  display: flex; flex-direction: column; gap: 4px; align-items: center; }
#notices div { padding: 5px 11px; border-radius: 3px; font-size: 11px;
  background: rgba(24,19,12,.93); border: 1px solid var(--edge); }
#notices div.warn { color: var(--warn); border-color: rgba(226,121,79,.45); }

/* Narrow windows: the panels are sized for a desktop, and at laptop widths
   they otherwise overlap each other and cover the map. */
@media (max-width: 1000px) {
  #ui { font-size: 11px; }
  #build { width: 186px; padding: 7px; }
  #build button { font-size: 10px; padding: 4px 5px; }
  #controls { width: 178px; padding: 7px 8px; }
  #stats { min-width: 154px; padding: 7px 9px; }
  #topbar { padding: 5px 6px; }
  #topbar .res { padding: 0 5px; }
  #topbar .res .k { display: none; }
  /* the trade table needs its columns; never squeeze it below this */
  #rightcol { right: 6px; }
  #market { width: 330px; }
  #stats2 { width: 210px; padding: 7px 8px; }
}
@media (max-height: 780px) {
  #build h4 { margin: 5px 0 3px; }
  #build .items { gap: 3px; }
  #controls .seg { margin-bottom: 6px; }
}

#ghost { position: absolute; padding: 4px 8px; font-size: 11px; border-radius: 3px;
  background: rgba(24,19,12,.93); border: 1px solid var(--edge);
  transform: translate(-50%, -160%); display: none; white-space: nowrap; }
#ghost.bad { color: var(--warn); border-color: rgba(226,121,79,.5); }
`;

export class Hud {
  private root: HTMLElement;
  private topbar!: HTMLElement;
  private stats!: HTMLElement;
  private buildPanel!: HTMLElement;
  private controls!: HTMLElement;
  private marketPanel!: HTMLElement;
  private rightPanel!: HTMLElement;
  private viewSelect!: HTMLSelectElement;
  private views: Record<string, HTMLElement> = {};
  private view: ViewName = 'food';
  private rightCol!: HTMLElement;
  private notices!: HTMLElement;
  private ghost!: HTMLElement;

  onSelect: (name: string | null) => void = () => {};
  /** Try to recruit. Returns 'ok', or the reason it could not. */
  onRecruit: (type: string) => string = () => 'No barracks';
  /** Live soldier counts by type, for the barracks view. */
  armyCounts: () => Record<string, number> = () => ({});
  /** How many enemies are on the map, for the alarm in the stats panel. */
  enemyCount: () => number = () => 0;

  constructor(private state: GameState, private placement: Placement) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    this.root = document.createElement('div');
    this.root.id = 'ui';
    document.body.appendChild(this.root);

    this.buildTopbar();
    this.buildStats();
    this.buildBuildPanel();
    this.rightCol = this.el('div', this.root, '', 'rightcol');
    this.buildRightPanel();
    this.buildControls();

    this.notices = document.createElement('div');
    this.notices.id = 'notices';
    this.root.appendChild(this.notices);

    this.ghost = document.createElement('div');
    this.ghost.id = 'ghost';
    this.root.appendChild(this.ghost);
  }

  private el(tag: string, parent: HTMLElement, cls = '', id = ''): HTMLElement {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (id) e.id = id;
    parent.appendChild(e);
    return e;
  }

  private buildTopbar(): void {
    this.topbar = this.el('div', this.root, 'panel', 'topbar');
  }

  private buildStats(): void {
    this.stats = this.el('div', this.root, 'panel', 'stats');
  }

  private buildBuildPanel(): void {
    this.buildPanel = this.el('div', this.root, 'panel', 'build');
    for (const group of BUILD_MENU) {
      const h = this.el('h4', this.buildPanel);
      h.textContent = group.label;
      const items = this.el('div', this.buildPanel, 'items');
      for (const name of group.items) {
        const def = BUILDINGS[name];
        const b = document.createElement('button');
        b.dataset.name = name;
        b.title = def.description;
        const cost = Object.entries(def.cost)
          .map(([r, n]) => `${n} ${r}`).join(', ') || 'free';
        b.innerHTML = `${def.label}<span class="c">${cost}</span>`;
        b.onclick = () => {
          this.placement.select(name);
          this.onSelect(this.placement.selected);
        };
        items.appendChild(b);
      }
    }
  }

  private buildControls(): void {
    this.controls = this.el('div', this.rightCol, 'panel', 'controls');

    this.el('div', this.controls, 'lbl').textContent = 'Rations';
    const rs = this.el('div', this.controls, 'seg');
    for (const level of RATION_LEVELS) {
      const b = document.createElement('button');
      b.dataset.ration = level;
      b.textContent = level === 'none' ? 'None'
        : level === 'half' ? 'Half' : level === 'normal' ? 'Normal' : 'Extra';
      b.onclick = () => { this.state.rations = level as RationLevel; };
      rs.appendChild(b);
    }

    this.el('div', this.controls, 'lbl').textContent = 'Taxes';
    const ts = this.el('div', this.controls, 'seg');
    TAX_LEVELS.forEach((t, i) => {
      const b = document.createElement('button');
      b.dataset.tax = String(i);
      b.textContent = t.label.replace(' taxes', '');
      b.onclick = () => { this.state.taxLevel = i; };
      ts.appendChild(b);
    });

    // Soldier controls belong here, not only in the Barracks view. Box select
    // sat undiscovered behind a hint in a panel the player had no reason to
    // have open.
    this.el('div', this.controls, 'hint').innerHTML =
      'R / E rotate &nbsp; wheel zoom &nbsp; drag pan<br>' +
      'Esc cancels building &nbsp; M market &nbsp; T hide panel<br>' +
      '<b>Troops:</b> click select &nbsp; <b>shift-drag</b> box<br>' +
      'double-click all of a kind &nbsp; right-click move<br>' +
      'right-click your <b>wall or tower</b> to man it';
  }

  /**
   * Recruitment. Buy soldiers outright -- there is no weapons chain.
   *
   * Built once with live handlers, like the market, rather than re-rendered
   * from scratch each frame: a button rebuilt under the cursor eats the click.
   */
  private buildBarracks(): void {
    const panel = this.views['barracks'];
    this.el('h4', panel).textContent = 'Barracks';
    const warn = this.el('div', panel, 'warn');
    warn.dataset.role = 'nobarracks';
    warn.textContent = 'Build a barracks to recruit.';

    let siegeHeaderDone = false;
    for (const name of SOLDIER_ORDER) {
      const t = SOLDIER_TYPES[name];
      if (t.siege && !siegeHeaderDone) {
        siegeHeaderDone = true;
        this.el('h4', panel).textContent = 'Siege';
        const w2 = this.el('div', panel, 'warn');
        w2.dataset.role = 'nosiege';
        w2.textContent = 'Build a siege camp to make engines.';
      }
      const row = this.el('div', panel, 'r');
      row.dataset.soldier = name;

      const label = document.createElement('span');
      label.className = 'nm';
      label.textContent = t.label;
      label.title = t.description;
      row.appendChild(label);

      const price = document.createElement('span');
      price.className = 'c';
      const goods = Object.entries(t.cost).map(([r, n]) => `${n} ${r}`).join(' ');
      price.textContent = `${t.gold}g${goods ? ' + ' + goods : ''}`;
      row.appendChild(price);

      const count = document.createElement('span');
      count.className = 'v';
      count.dataset.count = name;
      row.appendChild(count);

      const b = document.createElement('button');
      b.className = 'tog';
      b.textContent = 'Recruit';
      b.dataset.recruit = name;
      b.onclick = () => {
        const r = this.onRecruit(name);
        if (r !== 'ok') this.state.notify(r, 'warn');
      };
      row.appendChild(b);
    }

    const foot = this.el('div', panel, 'row');
    foot.innerHTML = '<span>Soldiers</span><b data-role="armytotal">0</b>';
    const hint = this.el('div', panel, 'hint');
    hint.innerHTML = 'Click a soldier to select · <b>Shift-drag</b> for a box ·<br>'
                   + 'Double-click to take every one of that kind · Right-click to move';
  }

  private buildMarket(): void {
    this.marketPanel = this.views['market'];
    this.marketPanel.id = 'market';
    this.marketPanel.classList.add('view');
    this.el('h4', this.marketPanel).textContent = 'Market';
    const warn = this.el('div', this.marketPanel, 'warn');
    warn.dataset.role = 'nomarket';
    warn.textContent = 'Build a market to trade.';

    const head = this.el('div', this.marketPanel, 'head');
    for (const t of ['Good', 'Buy', 'below', 'Sell', 'above', '', '']) {
      const c = document.createElement('span');
      c.textContent = t;
      head.appendChild(c);
    }

    for (const r of ALL_RESOURCES) {
      const price = PRICES[r];
      if (!price) continue;
      const row = this.el('div', this.marketPanel, 'r');

      const label = document.createElement('span');
      label.className = 'nm';
      label.dataset.res = r;
      row.appendChild(label);

      // Buy and sell are independent, as in Stronghold: buy below one level,
      // sell above another, and leave a band between where nothing happens.
      const mkToggle = (kind: 'buy' | 'sell') => {
        const b = document.createElement('button');
        b.className = `tog ${kind}`;
        b.textContent = kind === 'buy' ? 'Buy' : 'Sell';
        b.dataset.tog = r;
        b.dataset.kind = kind;
        b.title = kind === 'buy'
          ? `Buy ${RESOURCE_LABELS[r]} whenever the stock falls below the level`
          : `Sell ${RESOURCE_LABELS[r]} whenever the stock rises above the level`;
        b.onclick = () => {
          const t = this.state.trade[r];
          if (kind === 'buy') t.buyOn = !t.buyOn; else t.sellOn = !t.sellOn;
          if ((t.buyOn || t.sellOn) && !this.state.hasMarket) {
            this.state.notify('Build a market to trade', 'warn');
          }
        };
        return b;
      };

      const mkLevel = (kind: 'buy' | 'sell') => {
        const wrap = document.createElement('div');
        wrap.className = 'lvl';
        const dec = document.createElement('button');
        dec.textContent = '\u2212';
        dec.onclick = () => {
          const t = this.state.trade[r];
          const cur = kind === 'buy' ? t.buyLevel : t.sellLevel;
          this.state.setTradeLevel(r, kind, cur - (cur > 50 ? 25 : 5));
        };
        const val = document.createElement('b');
        val.dataset.lvl = r;
        val.dataset.kind = kind;
        const inc = document.createElement('button');
        inc.textContent = '+';
        inc.onclick = () => {
          const t = this.state.trade[r];
          const cur = kind === 'buy' ? t.buyLevel : t.sellLevel;
          this.state.setTradeLevel(r, kind, cur + (cur >= 50 ? 25 : 5));
        };
        wrap.append(dec, val, inc);
        return wrap;
      };

      row.appendChild(mkToggle('buy'));
      row.appendChild(mkLevel('buy'));
      row.appendChild(mkToggle('sell'));
      row.appendChild(mkLevel('sell'));

      const buy = document.createElement('button');
      buy.textContent = `\u25b2${price[0]}`;
      buy.title = `Buy one now for ${price[0]} gold`;
      buy.onclick = () => {
        if (!this.state.hasMarket) { this.state.notify('Build a market to trade', 'warn'); return; }
        if (this.state.gold < price[0]) { this.state.notify('Not enough gold', 'warn'); return; }
        this.state.gold -= price[0];
        this.state.stock[r as Resource] += 1;
      };
      row.appendChild(buy);

      const sell = document.createElement('button');
      sell.textContent = `\u25bc${price[1]}`;
      sell.title = `Sell one now for ${price[1]} gold`;
      sell.onclick = () => {
        if (!this.state.hasMarket) { this.state.notify('Build a market to trade', 'warn'); return; }
        if (this.state.stock[r as Resource] < 1) {
          this.state.notify(`No ${RESOURCE_LABELS[r]} to sell`, 'warn'); return;
        }
        this.state.stock[r as Resource] -= 1;
        this.state.gold += price[1];
      };
      row.appendChild(sell);
    }

    const totals = this.el('div', this.marketPanel, 'totals');
    totals.dataset.role = 'totals';
  }

  /**
   * One panel, one view at a time, chosen from a dropdown.
   *
   * Views are built once and shown or hidden, never re-created: the market's
   * buttons carry real click handlers, so re-rendering it as innerHTML each
   * frame would throw them away.
   */
  private buildRightPanel(): void {
    this.rightPanel = this.el('div', this.rightCol, 'panel', 'rightpanel');

    const head = this.el('div', this.rightPanel, 'head');
    const sel = document.createElement('select');
    for (const [value, label] of VIEWS) {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      sel.appendChild(o);
    }
    sel.onchange = () => this.setView(sel.value as ViewName);
    head.appendChild(sel);
    this.viewSelect = sel;

    const hide = document.createElement('button');
    hide.textContent = '\u2715';
    hide.title = 'Hide this panel (T)';
    hide.onclick = () => this.rightPanel.classList.add('hidden');
    head.appendChild(hide);

    for (const [value] of VIEWS) {
      this.views[value] = this.el('div', this.rightPanel, 'view', `view-${value}`);
    }
    this.buildMarket();          // fills the market view with live controls
    this.buildBarracks();
    this.setView('food');
  }

  private setView(v: ViewName): void {
    this.view = v;
    this.viewSelect.value = v;
    for (const [name, el] of Object.entries(this.views)) {
      el.classList.toggle('on', name === v);
    }
    this.rightPanel.classList.toggle('wide', v === 'market');
    this.rightPanel.classList.remove('hidden');
  }

  /** T hides or shows the panel entirely. */
  toggleStats(): void {
    this.rightPanel.classList.toggle('hidden');
  }

  /** Step to the next view, for a keyboard shortcut. */
  cycleView(): void {
    const i = VIEWS.findIndex(v => v[0] === this.view);
    this.setView(VIEWS[(i + 1) % VIEWS.length][0]);
  }

  /** M jumps straight to the market, or hides the panel if already there. */
  toggleMarket(): void {
    if (this.view === 'market' && !this.rightPanel.classList.contains('hidden')) {
      this.rightPanel.classList.add('hidden');
    } else {
      this.setView('market');
    }
  }

  showGhost(screenX: number, screenY: number, text: string, ok: boolean): void {
    this.ghost.style.display = 'block';
    this.ghost.style.left = `${screenX}px`;
    this.ghost.style.top = `${screenY}px`;
    this.ghost.textContent = text;
    this.ghost.classList.toggle('bad', !ok);
  }

  hideGhost(): void {
    this.ghost.style.display = 'none';
  }

  update(): void {
    const s = this.state;

    // resource bar
    const shown: (Resource | 'gold')[] = [
      'gold', 'wood', 'stone', 'iron', 'pitch', 'wheat', 'flour',
      'bread', 'cheese', 'apples', 'meat', 'hops', 'ale', 'pigs',
    ];
    this.topbar.innerHTML = shown.map(r => {
      const n = r === 'gold' ? Math.floor(s.gold) : s.stock[r as Resource];
      const label = r === 'gold' ? 'Gold' : RESOURCE_LABELS[r as Resource];
      return `<div class="res" title="${label}">` +
             `<span class="n">${n}</span><span class="k">${label}</span></div>`;
    }).join('');

    // stats
    const pop = s.population;
    const pct = Math.round(s.popularity);
    const colour = pct >= 60 ? 'var(--good)' : pct >= 45 ? 'var(--gold)' : 'var(--warn)';
    // Warn on the yard BEFORE it is full: once it is, production is already
    // spilling, and the fix -- painting more squares -- takes a moment.
    const fill = (used: number, cap: number) => {
      const f = cap ? used / cap : 1;
      return f >= 0.95 ? 'var(--warn)' : f >= 0.8 ? 'var(--gold)' : 'var(--ink)';
    };
    const foes = this.enemyCount();
    const yardColour = fill(s.stockpileUsed, s.stockpileCapacity);
    const granaryColour = fill(s.totalFood, s.granaryCapacity);
    this.stats.innerHTML =
      `<div class="row"><span>Population</span><b>${pop} / ${s.housing}</b></div>` +
      `<div class="row"><span>Unemployed</span><b>${s.idle}</b></div>` +
      `<div class="row"><span>Food stores</span><b style="color:${granaryColour}">` +
        `${s.totalFood} / ${s.granaryCapacity}</b></div>` +
      `<div class="row"><span>Stockpile</span><b style="color:${yardColour}">` +
        `${s.stockpileUsed} / ${s.stockpileCapacity}</b></div>` +
      `<div class="row"><span>Popularity</span><b>${pct}</b></div>` +
      `<div class="bar"><i style="width:${pct}%;background:${colour}"></i></div>` +
      // Only shown when it matters. A permanent "Enemies 0" row trains the eye
      // to skip the line that one day says something else.
      (foes ? `<div class="row"><span style="color:var(--warn)">Enemies</span>` +
              `<b style="color:var(--warn)">${foes}</b></div>` : '');

    // build buttons: affordability and selection
    for (const b of Array.from(this.buildPanel.querySelectorAll('button'))) {
      const name = (b as HTMLElement).dataset.name!;
      const def = BUILDINGS[name];
      b.classList.toggle('on', this.placement.selected === name);
      b.classList.toggle('poor', !s.canAfford(def.cost));
    }
    for (const b of Array.from(this.controls.querySelectorAll('button'))) {
      const el = b as HTMLElement;
      if (el.dataset.ration) b.classList.toggle('on', s.rations === el.dataset.ration);
      if (el.dataset.tax) b.classList.toggle('on', s.taxLevel === Number(el.dataset.tax));
    }

    // market: stock, standing-order state and the running trade tally
    for (const el of Array.from(this.marketPanel.querySelectorAll('[data-res]'))) {
      const r = (el as HTMLElement).dataset.res as Resource;
      el.textContent = `${RESOURCE_LABELS[r]} (${s.stock[r]})`;
    }
    for (const el of Array.from(this.marketPanel.querySelectorAll('[data-lvl]'))) {
      const e = el as HTMLElement;
      const r = e.dataset.lvl as Resource;
      const kind = e.dataset.kind as 'buy' | 'sell';
      const t = s.trade[r];
      const on = kind === 'buy' ? t.buyOn : t.sellOn;
      e.textContent = String(kind === 'buy' ? t.buyLevel : t.sellLevel);
      e.classList.toggle('off', !on);
    }
    for (const b of Array.from(this.marketPanel.querySelectorAll('[data-tog]'))) {
      const e = b as HTMLElement;
      const t = s.trade[e.dataset.tog as Resource];
      b.classList.toggle('on', e.dataset.kind === 'buy' ? t.buyOn : t.sellOn);
    }
    const noMarket = this.marketPanel.querySelector('[data-role="nomarket"]') as HTMLElement;
    if (noMarket) noMarket.style.display = s.hasMarket ? 'none' : 'block';
    const totals = this.marketPanel.querySelector('[data-role="totals"]') as HTMLElement;
    if (totals) {
      totals.innerHTML =
        `<span>Trade earned</span><b class="g">${Math.round(s.tradeIncome)}</b>` +
        `<span>spent</span><b class="w">${Math.round(s.tradeSpend)}</b>`;
    }

    // --- right panel: only the visible view is rendered ----------------
    const led = s.ledger;
    const fmt = (n: number) => (n >= 9.95 ? n.toFixed(0) : n.toFixed(1));

    if (this.view === 'food' && !this.rightPanel.classList.contains('hidden')) {
      const foodMade = FOOD_RESOURCES.reduce((n, f) => n + led.producedPerMin(f), 0);
      const foodNeed = s.foodDemandPerMin;
      const foodNet = foodMade - foodNeed;
      const left = s.foodMinutesLeft;
      const netCls = foodNet > 0.05 ? 'g' : foodNet < -0.05 ? 'w' : 'n';

      const aleMade = led.producedPerMin('ale');
      const aleNeed = s.aleDemandPerMin;
      const cover = Math.round(s.aleCoverage * 100);
      const coverCls = cover >= 90 ? 'g' : cover >= 40 ? 'n' : 'w';
      const aleBlock = s.innCapacity === 0
        ? `<div class="fr"><span>Ale</span><b class="dim">no inn</b></div>`
        : `<div class="fr"><span>Drinking</span><b class="${coverCls}">${cover}%</b></div>` +
          `<div class="fr"><span>Made / drunk</span>` +
          `<b>${fmt(aleMade)} / ${fmt(aleNeed)}</b></div>` +
          `<div class="fr"><span>At the inns</span>` +
          `<b class="${s.aleInInns > 0 ? 'g' : 'w'}">${s.aleInInns}</b></div>`;

      this.views.food.innerHTML =
        `<h4>Food balance</h4>` +
        `<div class="food">` +
          `<div class="fr"><span>Produced</span><b class="g">${fmt(foodMade)} / min</b></div>` +
          `<div class="fr"><span>Eaten</span><b class="w">${fmt(foodNeed)} / min</b></div>` +
          `<div class="fr"><span>Balance</span><b class="${netCls}">` +
            `${foodNet > 0 ? '+' : ''}${fmt(foodNet)} / min</b></div>` +
          (left !== null
            ? `<div class="fr"><span>Stores last</span><b class="w">${fmt(left)} min</b></div>`
            : `<div class="fr"><span>Stores</span><b class="g">holding</b></div>`) +
        `</div>` +
        `<h4>Ale</h4><div>${aleBlock}</div>`;
    }

    if (this.view === 'popularity' && !this.rightPanel.classList.contains('hidden')) {
      const factors = s.popularityBreakdown();
      const sign = (v: number) =>
        (v > 0 ? '+' : '') + (Math.abs(v) < 10 ? v.toFixed(1).replace('.0', '') : Math.round(v));
      const rows = factors.map(f => {
        const zero = Math.abs(f.value) < 0.05;
        const colour = f.value > 0.05 ? 'g' : f.value < -0.05 ? 'w' : '';
        return `<div class="pf${zero ? ' zero' : ''}"><span>${f.label}</span>` +
               `<b class="${colour}">${sign(f.value)}</b></div>`;
      }).join('');
      const now = Math.round(s.popularity);
      const tgt = Math.round(s.popularityTarget);
      const drift = tgt === now ? 'steady' : tgt > now ? `rising to ${tgt}` : `falling to ${tgt}`;
      this.views.popularity.innerHTML =
        `<h4>Popularity — ${now}, ${drift}</h4>${rows}` +
        `<div class="pf total"><span>Heading for</span><b>${tgt}</b></div>`;
    }

    if (this.view === 'production' && !this.rightPanel.classList.contains('hidden')) {
      let rows = '';
      for (const r of ALL_RESOURCES) {
        const made = led.producedPerMin(r);
        const used = led.consumedPerMin(r);
        if (made < 0.05 && used < 0.05 && s.stock[r] === 0) continue;
        const net = made - used;
        const cls = net > 0.05 ? 'g' : net < -0.05 ? 'w' : '';
        rows += `<tr><td class="name">${RESOURCE_LABELS[r]}</td>` +
                `<td class="r">${fmt(made)}</td>` +
                `<td class="r dim">${fmt(used)}</td>` +
                `<td class="r ${cls}">${net > 0 ? '+' : ''}${fmt(net)}</td></tr>`;
      }
      if (!rows) rows = '<tr><td class="dim" colspan="4">nothing produced yet</td></tr>';
      this.views.production.innerHTML =
        `<h4>Per minute — made / used / net</h4><table>${rows}</table>` +
        (led.warm ? '' : '<div class="hint">measuring…</div>');
    }

    if (this.view === 'barracks' && !this.rightPanel.classList.contains('hidden')) {
      const panel = this.views.barracks;
      const has = s.buildings.some(b => b.name === 'barracks');
      const nowarn = panel.querySelector('[data-role="nobarracks"]') as HTMLElement;
      if (nowarn) nowarn.style.display = has ? 'none' : '';
      const hasSiege = s.buildings.some(b => b.name === 'siege_camp');
      const nosiege = panel.querySelector('[data-role="nosiege"]') as HTMLElement;
      if (nosiege) nosiege.style.display = hasSiege ? 'none' : '';
      const counts = this.armyCounts();
      let total = 0;
      for (const el of Array.from(panel.querySelectorAll('[data-count]'))) {
        const name = (el as HTMLElement).dataset.count!;
        const n = counts[name] ?? 0;
        total += n;
        el.textContent = n ? `${n}` : '';
      }
      for (const el of Array.from(panel.querySelectorAll('[data-recruit]'))) {
        const b = el as HTMLButtonElement;
        const t = SOLDIER_TYPES[b.dataset.recruit!];
        // Grey out for the reason it cannot be bought, and say which.
        const src = s.buildings.some(b => b.name === t.from);
        const why = !src ? (t.from === 'siege_camp' ? 'Build a siege camp first'
                                                    : 'Build a barracks first')
          : s.idle < 1 ? 'No idle peasant to take up arms'
          : s.gold < t.gold ? 'Not enough gold'
          : !s.canAfford(t.cost) ? 'Not enough materials'
          : '';
        b.classList.toggle('poor', why !== '');
        b.title = why || t.description;
      }
      const tot = panel.querySelector('[data-role="armytotal"]');
      if (tot) tot.textContent = String(total);
    }

    // notices
    const live = s.notices.filter(n => s.elapsed - n.at < 6);
    this.notices.innerHTML = live.map(
      n => `<div class="${n.kind}">${n.text}</div>`).join('');

    void RATIONS;
  }
}
