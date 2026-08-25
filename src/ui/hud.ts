import {
  BUILDINGS, BUILD_MENU, PRICES, RATIONS, RATION_LEVELS, TAX_LEVELS,
  RESOURCE_LABELS, ALL_RESOURCES, FOOD_RESOURCES,
  SOLDIER_TYPES, SOLDIER_ORDER,
  type RationLevel, type Resource,
} from '../game/defs';
import type { GameState } from '../game/state';
import type { Placement } from '../game/placement';
import type { Audio } from '../engine/audio';

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

/* Left-hand column, same reasoning as the right: both panels live in flow, so
   the build menu growing can never land on top of the stats panel. It used to
   be anchored to the bottom with no top bound, and once the castle and siege
   groups were added it was taller than the window and ran up over the food
   and popularity rows. */
#leftcol { position: absolute; left: 12px; top: 10px; bottom: 12px;
  display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
  pointer-events: none; }
#leftcol > * { pointer-events: auto; }
#stats { padding: 9px 11px; min-width: 190px; flex: 0 0 auto; }
#stats .row { display: flex; justify-content: space-between; gap: 14px; line-height: 1.65; }
#stats .row b { color: var(--gold); font-weight: 600; font-variant-numeric: tabular-nums; }
#stats .bar { height: 5px; background: rgba(255,255,255,.10); border-radius: 3px; margin-top: 5px; overflow: hidden; }
#stats .bar i { display: block; height: 100%; background: var(--good); transition: width .3s, background .3s; }

/* The build menu, Stronghold-style: a bar of categories with one open at a
   time. Every building laid out at once wanted 729px of column -- taller than
   most windows -- and buried the four you actually use under a scroll. */
#buildwrap { margin-top: auto; display: flex; flex-direction: column;
  align-items: flex-start; gap: 6px; min-height: 0; }

#buildbar { padding: 6px; width: 232px; flex: 0 0 auto;
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; }
#buildbar button { position: relative; pointer-events: auto; cursor: pointer;
  background: rgba(255,255,255,.045); color: var(--ink);
  border: 1px solid rgba(196,162,96,.20); border-radius: 3px;
  padding: 7px 2px 5px; font-size: 10px; letter-spacing: .02em; }
#buildbar button:hover { background: rgba(255,255,255,.11); border-color: rgba(196,162,96,.45); }
#buildbar button.open { background: rgba(240,200,105,.20); border-color: var(--gold); color: #fff; }
/* The digit shortcut, on the button that uses it. A key nobody can see is a
   key nobody presses. */
#buildbar button i { position: absolute; top: 1px; left: 3px;
  font-style: normal; font-size: 8px; opacity: .42; }

#buildmenu { padding: 8px; width: 232px; flex: 0 1 auto;
  min-height: 0; overflow-y: auto; }
#buildmenu.hidden { display: none; }
#buildmenu .items { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }
#buildmenu button {
  pointer-events: auto; cursor: pointer; text-align: center;
  display: flex; flex-direction: column; align-items: center; gap: 1px;
  background: rgba(255,255,255,.045); color: var(--ink);
  border: 1px solid rgba(196,162,96,.20); border-radius: 3px;
  padding: 4px 3px 5px; font-size: 10.5px; line-height: 1.25;
}
#buildmenu button:hover { background: rgba(255,255,255,.11); border-color: rgba(196,162,96,.45); }
#buildmenu button.on { background: rgba(240,200,105,.20); border-color: var(--gold); color: #fff; }
#buildmenu button.poor { opacity: .42; }
#buildmenu button canvas { display: block; width: 46px; height: 34px; }
#buildmenu button .c { font-size: 9px; opacity: .62; }
/* How many you already have, top-right of the tile. */
#buildmenu button { position: relative; }
#buildmenu button .n {
  position: absolute; top: 2px; right: 3px; min-width: 13px; padding: 0 3px;
  font-size: 9px; line-height: 13px; text-align: center; border-radius: 7px;
  background: rgba(240,200,105,.22); color: var(--gold); font-weight: 600;
  font-variant-numeric: tabular-nums; }
#buildmenu button.on .n { background: rgba(0,0,0,.35); color: #fff; }

#buildbar button.demolish { grid-column: 1 / -1; color: #e8b9a4; }
#buildbar button.demolish:hover { border-color: rgba(226,121,79,.6); }
#buildbar button.demolish.on {
  background: rgba(226,121,79,.26); border-color: var(--warn); color: #fff; }
#buildmenu::-webkit-scrollbar { width: 7px; }
#buildmenu::-webkit-scrollbar-thumb { background: rgba(196,162,96,.30); border-radius: 4px; }
#buildmenu::-webkit-scrollbar-track { background: transparent; }

/* Shrinkable rather than fixed. Rations and taxes are the part that must stay
   reachable; the key hints below them can scroll, and do on a short window now
   that the minimap wants a share of the column. */
#controls { padding: 9px 11px; width: 218px; margin-top: auto;
  flex: 0 1 auto; min-height: 108px; overflow-y: auto; }
#controls .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .08em;
  opacity: .58; margin-bottom: 4px; font-weight: 600; }
#controls .seg { display: flex; gap: 3px; margin-bottom: 9px; }
#controls .hintbar { display: flex; justify-content: space-between;
  cursor: pointer; pointer-events: auto; }
#controls .hintbar:hover { opacity: .9; }
#controls .hintbar .tw { font-weight: 400; letter-spacing: 0;
  text-transform: none; opacity: .7; }
#controls .hint.hidden { display: none; }
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
/* The floor matters: the minimap and the controls below are both fixed-height,
   and without it a short window squeezed this to 18px of unreadable stub. */
#rightpanel { width: 268px; display: flex; flex-direction: column;
  min-height: 140px; flex: 1 1 auto; padding: 8px 9px; overflow-y: auto; }
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
  #buildbar, #buildmenu { width: 186px; padding: 6px; }
  #buildmenu button { font-size: 10px; padding: 3px 2px 4px; }
  #buildmenu button canvas { width: 38px; height: 28px; }
  #controls { width: 178px; padding: 7px 8px; }
  #stats { min-width: 154px; padding: 7px 9px; }
  #topbar { padding: 5px 6px; }
  #topbar .res { padding: 0 5px; }
  #topbar .res .k { display: none; }
  /* the trade table needs its columns; never squeeze it below this */
  #rightcol { right: 6px; }
  #leftcol { left: 6px; }
  #market { width: 330px; }
  #stats2 { width: 210px; padding: 7px 8px; }
}
@media (max-height: 780px) {
  #buildmenu .items { gap: 3px; }
  #buildmenu button canvas { width: 38px; height: 28px; }
  #controls .seg { margin-bottom: 6px; }
}

/* Minimap. Sits above the controls in the right-hand column. */
#minimap { padding: 7px; flex: 0 0 auto; }
/* Square by its own 200x200 intrinsic size, but never so tall on a short
   window that it starves the panel above it. */
#minimap canvas { display: block; width: min(100%, 22vh); height: auto;
  margin: 0 auto; cursor: crosshair; border-radius: 3px;
  background: #14110c; image-rendering: pixelated; }
#minimap.hidden { display: none; }

/* What the cursor is over. */
#tip { position: absolute; display: none; pointer-events: none; max-width: 260px;
  padding: 5px 9px 6px; border-radius: 4px; background: rgba(24,19,12,.96);
  border: 1px solid rgba(196,162,96,.42); box-shadow: 0 3px 12px rgba(0,0,0,.5);
  transform: translate(14px, 14px); }
#tip .t { font-size: 11.5px; font-weight: 600; color: var(--gold); }
#tip .t.foe { color: var(--warn); }
#tip .s { font-size: 10px; opacity: .72; line-height: 1.5; margin-top: 2px; }

/* Trouble markers floating over the buildings they belong to. */
#flags { position: absolute; inset: 0; pointer-events: none; overflow: hidden; }
#flags .f {
  position: absolute; transform: translate(-50%, -100%);
  padding: 2px 7px 3px; border-radius: 9px; white-space: nowrap;
  font-size: 10px; line-height: 1.35; font-weight: 600; letter-spacing: .02em;
  background: rgba(30,22,12,.94); border: 1px solid var(--warn); color: #ffc9ab;
  box-shadow: 0 2px 8px rgba(0,0,0,.55);
}
#flags .f::after {
  content: ''; position: absolute; left: 50%; bottom: -4px; width: 6px; height: 6px;
  transform: translateX(-50%) rotate(45deg);
  background: rgba(30,22,12,.94);
  border-right: 1px solid var(--warn); border-bottom: 1px solid var(--warn);
}

#ghost { position: absolute; padding: 4px 8px; font-size: 11px; border-radius: 3px;
  background: rgba(24,19,12,.93); border: 1px solid var(--edge);
  transform: translate(-50%, -160%); display: none; white-space: nowrap; }
#ghost.bad { color: var(--warn); border-color: rgba(226,121,79,.5); }

/* ---- Phone layout: canvas first, everything else on demand --------------
   A phone is too narrow to wear the desktop's four always-open panel columns
   at once; together they leave a letterbox of actual game. So on a phone the
   columns are emptied into bottom sheets that open ONE AT A TIME over a dimming
   scrim, and the only permanent chrome is a slim resource ticker at the top and
   the thumb bar at the bottom. Which device is a "phone" is decided in main.ts
   by the SMALLEST viewport edge, not the width, so a handset stays in this mode
   when it is turned on its side (a tablet's short edge is still wider than any
   phone's long one). */

/* The positioned columns are emptied by enablePhoneLayout(); hide the shells. */
html.phone #leftcol, html.phone #rightcol { display: none; }

/* Resources become a one-line ticker pinned to the top, swipeable when the
   goods outrun the width. Population and popularity are prepended in code. */
html.phone #topbar {
  top: 0; left: 0; right: 0;
  border-radius: 0; border-width: 0 0 1px 0;
  flex-wrap: nowrap; justify-content: flex-start; gap: 0;
  overflow-x: auto; overflow-y: hidden; -webkit-overflow-scrolling: touch;
  scrollbar-width: none;
  padding: calc(4px + env(safe-area-inset-top)) 8px 4px;
}
html.phone #topbar::-webkit-scrollbar { display: none; }
html.phone #topbar .res { flex: 0 0 auto; padding: 0 7px; gap: 4px; }
/* Population and popularity lead the ticker, marked off from the goods. */
html.phone #topbar .res.stat .n { color: var(--ink); }
html.phone #topbar .res.stat + .res { border-left-color: rgba(196,162,96,.4); }

/* The scrim dims the game behind an open sheet and closes it when tapped. */
#scrim { position: fixed; inset: 0; z-index: 38; background: rgba(0,0,0,.45);
  opacity: 0; pointer-events: none; transition: opacity .2s; }
#scrim.open { opacity: 1; pointer-events: auto; }

/* A sheet rises from the bottom, above the scrim but below the thumb bar so the
   bar stays live to switch sheets or the scrim to dismiss. */
html.phone .sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
  display: flex; flex-direction: column; max-height: 70vh;
  background: rgba(20,16,10,.985); border-top: 1px solid var(--edge);
  border-radius: 16px 16px 0 0; box-shadow: 0 -8px 30px rgba(0,0,0,.55);
  transform: translateY(106%); transition: transform .24s ease;
  pointer-events: auto;
}
html.phone .sheet.open { transform: translateY(0); }
html.phone .sheet .grab { flex: 0 0 auto; align-self: center; width: 42px; height: 4px;
  margin: 9px 0 5px; border-radius: 3px; background: rgba(196,162,96,.55); }
html.phone .sheet .sheet-body {
  overflow-y: auto; -webkit-overflow-scrolling: touch;
  padding: 2px 10px calc(74px + env(safe-area-inset-bottom));  /* clear the bar */
  display: flex; flex-direction: column; gap: 10px; align-items: stretch;
}

/* Panels drop their fixed widths and fill the sheet. */
html.phone .sheet #stats,
html.phone .sheet #controls,
html.phone .sheet #rightpanel,
html.phone .sheet #buildwrap,
html.phone .sheet #buildbar,
html.phone .sheet #buildmenu,
html.phone .sheet #market {
  position: static; width: auto; max-width: none; min-width: 0; margin: 0;
  flex: 0 0 auto; max-height: none;
}
html.phone .sheet #buildwrap { gap: 8px; }
html.phone .sheet #buildbar { grid-template-columns: repeat(3, 1fr); }
html.phone .sheet #buildmenu .items { grid-template-columns: repeat(3, 1fr); }
html.phone .sheet #buildmenu button canvas { width: 100%; height: 40px; }
/* The panel's own close button is redundant once the whole sheet closes. */
html.phone .sheet #rightpanel .head button { display: none; }
html.phone .sheet #rightpanel select { flex: 1; }
html.phone .sheet #minimap { padding: 4px; }
html.phone .sheet #minimap canvas { width: min(92vw, 56vh); }

/* The thumb bar floats above scrim and sheets so it can always switch them. */
html.phone #pad { z-index: 44; }
/* Nothing needs the touch layout's up-shifted UI once panels are sheets. The
   extra class outweighs the touch rule that lifts #ui by 64px, which is injected
   later (from touch.ts) and would otherwise win the specificity tie. */
html.phone.touch #ui { bottom: 0; }
`;

export class Hud {
  private root: HTMLElement;
  private topbar!: HTMLElement;
  private stats!: HTMLElement;
  private buildPanel!: HTMLElement;
  private buildBar!: HTMLElement;
  private flags!: HTMLElement;
  private tip!: HTMLElement;
  private mini!: HTMLElement;
  private miniCv!: HTMLCanvasElement;
  private miniCtx: CanvasRenderingContext2D | null = null;
  /** The ground, rasterised once. Rebuilt only when the ground itself changes. */
  private miniGround: HTMLCanvasElement | null = null;
  private miniW = 1;
  private miniH = 1;
  /** Where the player clicked, in tiles. Wired up by main.ts. */
  onMinimapPick: (x: number, z: number) => void = () => {};
  /** Reused between frames, so a steady state allocates nothing. */
  private flagPool: HTMLElement[] = [];
  /** Which category is open, and which to reopen when B is pressed. */
  private openGroup: number | null = null;
  private lastGroup = 0;
  /** Wrecking tool armed. Read by the click handler in main.ts. */
  demolishing = false;
  /** Set by main.ts once the audio engine exists. */
  audio: Audio | null = null;
  private demolishBtn!: HTMLButtonElement;
  /** Fires when the tool is armed or disarmed, so the cursor can follow. */
  onDemolishChange: (on: boolean) => void = () => {};
  /** Fires when a phone sheet opens or closes, so the thumb bar can light up. */
  onDrawerChange: (name: 'build' | 'info' | 'map' | null) => void = () => {};
  /** Refreshes the sound buttons once main.ts has attached the engine. */
  syncSound: () => void = () => {};
  private controls!: HTMLElement;
  private marketPanel!: HTMLElement;
  private rightPanel!: HTMLElement;
  private viewSelect!: HTMLSelectElement;
  private views: Record<string, HTMLElement> = {};
  private view: ViewName = 'food';
  private leftCol!: HTMLElement;
  private rightCol!: HTMLElement;
  private notices!: HTMLElement;
  private ghost!: HTMLElement;
  /** The build bar + menu wrapper, so the phone layout can lift it into a sheet. */
  private buildWrap!: HTMLElement;
  /** Phone mode: columns become on-demand bottom sheets. Off on desktop/tablet. */
  private phone = false;
  /** Which bottom sheet is open on a phone, or null for none (canvas only). */
  private drawer: 'build' | 'info' | 'map' | null = null;
  private sheets: Record<string, HTMLElement> = {};
  private scrim!: HTMLElement;

  onSelect: (name: string | null) => void = () => {};
  /** Try to recruit. Returns 'ok', or the reason it could not. */
  onRecruit: (type: string) => string = () => 'No barracks';
  /** Arm the rally-flag tool: the next map click sets where new troops gather. */
  onSetRally: () => void = () => {};
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
    this.leftCol = this.el('div', this.root, '', 'leftcol');
    this.buildStats();
    this.buildBuildPanel();
    this.rightCol = this.el('div', this.root, '', 'rightcol');
    this.buildRightPanel();
    this.buildMinimap();
    this.buildControls();

    this.notices = document.createElement('div');
    this.notices.id = 'notices';
    this.root.appendChild(this.notices);

    this.tip = document.createElement('div');
    this.tip.id = 'tip';
    this.root.appendChild(this.tip);

    this.flags = document.createElement('div');
    this.flags.id = 'flags';
    this.root.appendChild(this.flags);

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
    this.stats = this.el('div', this.leftCol, 'panel', 'stats');
  }

  private buildBuildPanel(): void {
    const wrap = this.el('div', this.leftCol, '', 'buildwrap');
    this.buildWrap = wrap;
    this.buildPanel = this.el('div', wrap, 'panel hidden', 'buildmenu');
    this.buildBar = this.el('div', wrap, 'panel', 'buildbar');

    BUILD_MENU.forEach((group, gi) => {
      const items = this.el('div', this.buildPanel, 'items');
      items.dataset.group = String(gi);
      items.style.display = 'none';

      for (const name of group.items) {
        const def = BUILDINGS[name];
        const cost = Object.entries(def.cost)
          .map(([r, n]) => `${n} ${r}`).join(', ') || 'free';
        const b = document.createElement('button');
        b.dataset.name = name;
        b.title = `${def.label} — ${cost}\n${def.description}`;
        const tally = document.createElement('span');
        tally.className = 'n';
        b.appendChild(tally);
        const icon = document.createElement('canvas');
        icon.dataset.name = name;
        b.appendChild(icon);
        b.insertAdjacentHTML('beforeend',
          `<span>${def.label}</span><span class="c">${cost}</span>`);
        b.onclick = () => {
          if (this.demolishing) this.setDemolish(false);
          this.placement.select(name);
          this.onSelect(this.placement.selected);
          // On a phone the menu is a sheet over the map; once a building is in
          // hand, get it out of the way so the map is there to place it on.
          if (this.phone) this.openDrawer(null);
        };
        items.appendChild(b);
      }

      const cat = document.createElement('button');
      cat.dataset.group = String(gi);
      cat.innerHTML = `<i>${gi + 1}</i>${group.label}`;
      cat.onclick = () => this.openCategory(gi === this.openGroup ? null : gi);
      this.buildBar.appendChild(cat);
    });

    // Demolition sits on the build bar rather than in a category: it is a mode
    // you enter, not a thing you place, and it belongs next to the tools that
    // put buildings down rather than buried under one heading of them.
    const dem = document.createElement('button');
    dem.className = 'demolish';
    dem.innerHTML = '<i>X</i>Demolish';
    dem.title = 'Pull a building down. Half its cost comes back.';
    dem.onclick = () => this.setDemolish(!this.demolishing);
    this.demolishBtn = dem;
    this.buildBar.appendChild(dem);
  }

  /** Arm or disarm the wrecking tool. Cancels anything in hand. */
  setDemolish(on: boolean): void {
    this.demolishing = on;
    if (on) {
      this.placement.cancel();
      this.onSelect(null);
    }
    this.demolishBtn.classList.toggle('on', on);
    document.body.style.cursor = on ? 'crosshair' : '';
    this.onDemolishChange(on);
    // Same as picking a building: with the tool armed, the phone sheet has done
    // its job and should uncover the map it acts on.
    if (on && this.phone) this.openDrawer(null);
  }

  /**
   * The minimap.
   *
   * Backed by a canvas rather than the sprite batch: it is a top-down picture
   * of ground types, which the isometric renderer has no way to produce and no
   * reason to. Fixed at the map's own resolution and scaled by CSS, so a
   * 200x200 world is a 200x200 image however large the box is drawn.
   */
  private buildMinimap(): void {
    this.mini = this.el('div', this.rightCol, 'panel', 'minimap');
    this.miniCv = document.createElement('canvas');
    this.mini.appendChild(this.miniCv);
    this.miniCtx = this.miniCv.getContext('2d');

    const pick = (e: PointerEvent) => {
      const r = this.miniCv.getBoundingClientRect();
      const mx = ((e.clientX - r.left) / r.width) * this.miniW;
      const my = ((e.clientY - r.top) / r.height) * this.miniH;
      const [x, z] = this.miniToWorld(mx, my);
      this.onMinimapPick(x, z);
    };
    this.miniCv.addEventListener('pointerdown', e => {
      e.stopPropagation();
      this.miniCv.setPointerCapture(e.pointerId);
      pick(e);
    });
    // Dragging scrubs the view across the map, which is how every minimap
    // worth using behaves; capture keeps it working past the edge of the box.
    this.miniCv.addEventListener('pointermove', e => {
      if (e.buttons & 1) pick(e);
    });
  }

  /** Current camera rotation, needed by both the draw and the inverse. */
  private miniRot = 0;

  private miniToWorld(mx: number, my: number): [number, number] {
    const a = -this.miniRot * Math.PI / 2;
    const u = mx / this.miniW - 0.5, v = my / this.miniH - 0.5;
    const ru = u * Math.cos(a) - v * Math.sin(a);
    const rv = u * Math.sin(a) + v * Math.cos(a);
    return [(ru + 0.5) * this.miniW, (rv + 0.5) * this.miniH];
  }

  private worldToMini(x: number, z: number): [number, number] {
    const a = this.miniRot * Math.PI / 2;
    const u = x / this.miniW - 0.5, v = z / this.miniH - 0.5;
    const ru = u * Math.cos(a) - v * Math.sin(a);
    const rv = u * Math.sin(a) + v * Math.cos(a);
    return [(ru + 0.5) * this.miniW, (rv + 0.5) * this.miniH];
  }

  /** Hand over the rasterised ground. Called once, and again if it changes. */
  setMinimapGround(w: number, h: number, rgba: Uint8ClampedArray): void {
    this.miniW = w; this.miniH = h;
    this.miniCv.width = w; this.miniCv.height = h;
    const src = document.createElement('canvas');
    src.width = w; src.height = h;
    const sctx = src.getContext('2d');
    if (!sctx) return;
    const img = sctx.createImageData(w, h);
    img.data.set(rgba);
    sctx.putImageData(img, 0, 0);
    this.miniGround = src;
  }

  /**
   * Draw one frame of it.
   *
   * The view outline comes in as four world points rather than being worked
   * out here, because only the caller owns the camera -- and taking the real
   * screen corners means the outline is right at any zoom or rotation instead
   * of being an approximation that drifts from what is on screen.
   */
  drawMinimap(rotation: number, view: [number, number][],
              dots: { x: number; z: number; c: string; big?: boolean }[]): void {
    const ctx = this.miniCtx;
    if (!ctx || !this.miniGround || this.mini.classList.contains('hidden')) return;
    this.miniRot = rotation;
    const w = this.miniW, h = this.miniH;

    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(rotation * Math.PI / 2);
    ctx.drawImage(this.miniGround, -w / 2, -h / 2);
    ctx.restore();

    for (const d of dots) {
      const [mx, my] = this.worldToMini(d.x, d.z);
      ctx.fillStyle = d.c;
      const r = d.big ? 3 : 1.6;
      ctx.fillRect(mx - r, my - r, r * 2, r * 2);
    }

    if (view.length === 4) {
      ctx.strokeStyle = 'rgba(255,255,255,.85)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      view.forEach(([x, z], i) => {
        const [mx, my] = this.worldToMini(x, z);
        if (i === 0) ctx.moveTo(mx, my); else ctx.lineTo(mx, my);
      });
      ctx.closePath();
      ctx.stroke();
    }
  }

  toggleMinimap(): void {
    this.mini.classList.toggle('hidden');
  }

  /**
   * Switch the HUD into phone mode: lift the panel columns into bottom sheets.
   *
   * Called once, from main.ts, only for a handset. The panels keep their own
   * ids (all their styling is by id, not by column ancestry) so moving them out
   * of the columns changes where they sit and nothing about how they look or
   * behave -- every reference the per-frame update holds is still the same node.
   * Three sheets: BUILD (the build bar and menu), INFO (the summary box, the
   * economy panel and the rations/taxes/sound controls, stacked and scrolled),
   * and MAP (the minimap). One opens at a time over a scrim.
   */
  enablePhoneLayout(): void {
    this.phone = true;
    document.documentElement.classList.add('phone');

    this.scrim = document.createElement('div');
    this.scrim.id = 'scrim';
    this.scrim.onclick = () => this.openDrawer(null);
    this.root.appendChild(this.scrim);

    const sheet = (id: string, panels: HTMLElement[]): HTMLElement => {
      const s = document.createElement('div');
      s.id = id;
      s.className = 'sheet';
      const grab = document.createElement('div');
      grab.className = 'grab';
      // The handle is a second, obvious way to close, next to the scrim tap.
      grab.onclick = () => this.openDrawer(null);
      s.appendChild(grab);
      const body = document.createElement('div');
      body.className = 'sheet-body';
      for (const p of panels) body.appendChild(p);   // moves them out of the columns
      s.appendChild(body);
      this.root.appendChild(s);
      return s;
    };

    // The economy panel starts life hidden behind a keypress; in a sheet it is
    // the whole point of opening it, so let it always show.
    this.rightPanel.classList.remove('hidden');
    this.sheets = {
      build: sheet('sheet-build', [this.buildWrap]),
      info: sheet('sheet-info', [this.stats, this.rightPanel, this.controls]),
      map: sheet('sheet-map', [this.mini]),
    };
  }

  /**
   * Open one bottom sheet, or close all (pass null, or the one already open).
   *
   * A no-op off a phone, so callers -- the thumb-bar buttons -- need no guard.
   */
  openDrawer(name: 'build' | 'info' | 'map' | null): void {
    if (!this.phone) return;
    this.drawer = this.drawer === name ? null : name;
    for (const [k, el] of Object.entries(this.sheets)) {
      el.classList.toggle('open', k === this.drawer);
    }
    this.scrim.classList.toggle('open', this.drawer !== null);
    // The minimap hides itself with a class the desktop uses; make sure opening
    // its sheet actually shows it.
    if (this.drawer === 'map') this.mini.classList.remove('hidden');
    this.onDrawerChange(this.drawer);
  }

  /** Which sheet is open, for the thumb bar to light its buttons. Null off a phone. */
  openDrawerName(): 'build' | 'info' | 'map' | null {
    return this.phone ? this.drawer : null;
  }

  /** Show one category, or none. Pass the index already open to close it. */
  openCategory(gi: number | null): void {
    this.openGroup = gi;
    if (gi !== null) this.lastGroup = gi;
    this.buildPanel.classList.toggle('hidden', gi === null);
    for (const el of Array.from(this.buildPanel.children)) {
      const d = el as HTMLElement;
      d.style.display = Number(d.dataset.group) === gi ? '' : 'none';
    }
    for (const b of Array.from(this.buildBar.querySelectorAll('button'))) {
      b.classList.toggle('open', Number((b as HTMLElement).dataset.group) === gi);
    }
  }

  /** B: reopen whatever was last open, or the first category on a cold start. */
  toggleBuild(): void {
    this.openCategory(this.openGroup === null ? this.lastGroup : null);
  }

  /**
   * Draw the real building sprites onto the menu icons.
   *
   * Called once the atlas is loaded, because the atlas IS the icon set -- the
   * alternative is a second set of hand-made icons that silently stops matching
   * the buildings the day a sprite is re-rendered.
   *
   * Scaling is contain-but-never-upscale, so a wall reads as smaller than a
   * barracks instead of every icon being stretched to the same size.
   */
  /**
   * Buildings whose menu icon is not their own sprite, because they have none.
   * The stores are painted yards assembled from pile and bin sprites rather
   * than one building, so the icon borrows the empty deck and a single bin.
   */
  private static ICON_ALIAS: Record<string, string> = {
    stockpile: 'stockpile_deck',
    granary: 'granary_bin',
  };

  setIcons(atlas: {
    frames: Record<string, { x: number; y: number; w: number; h: number }>;
    texture: { image: unknown };
  }): void {
    const src = atlas.texture?.image as CanvasImageSource | undefined;
    if (!src) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    for (const el of Array.from(this.buildPanel.querySelectorAll('canvas'))) {
      const cv = el as HTMLCanvasElement;
      const name = cv.dataset.name!;
      const f = atlas.frames[`${Hud.ICON_ALIAS[name] ?? name}_0`];
      if (!f) { cv.style.display = 'none'; continue; }
      const W = cv.clientWidth || 46, H = cv.clientHeight || 34;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(H * dpr);
      const ctx = cv.getContext('2d');
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      const k = Math.min(W / f.w, H / f.h, 1);
      const w = f.w * k, h = f.h * k;
      ctx.drawImage(src, f.x, f.y, f.w, f.h, (W - w) / 2, (H - h) / 2, w, h);
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

    // Sound sits with the other standing settings rather than behind a menu:
    // it is a thing you reach for once and then leave alone, exactly like
    // rations and taxes.
    this.el('div', this.controls, 'lbl').textContent = 'Sound';
    const snd = this.el('div', this.controls, 'seg');
    const VOLS: [string, number][] = [['Off', 0], ['Low', 0.35], ['Full', 0.8]];
    const vBtns: HTMLButtonElement[] = [];
    VOLS.forEach(([label, v]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.onclick = () => {
        this.audio?.setVolume(v);
        // A sample of what was just chosen. Setting a volume and hearing
        // nothing is indistinguishable from the control not working.
        if (v > 0) this.audio?.play('notice');
        syncSound();
      };
      vBtns.push(b); snd.appendChild(b);
    });

    const spk = this.el('div', this.controls, 'seg');
    const spkBtn = document.createElement('button');
    spkBtn.onclick = () => {
      this.audio?.setSpeech(!this.audio.speech);
      syncSound();
      if (this.audio?.speech) this.audio.say('Messages will be read aloud');
    };
    spk.appendChild(spkBtn);

    const syncSound = () => {
      const a = this.audio;
      // Nearest preset, not an exact match. A stored volume from an older
      // build lit no button at all, which reads as the control being broken.
      let nearest = 0;
      if (a) {
        VOLS.forEach(([, v], i) => {
          if (Math.abs(a.volume - v) < Math.abs(a.volume - VOLS[nearest][1])) nearest = i;
        });
      }
      vBtns.forEach((b, i) => b.classList.toggle('on', !!a && i === nearest));
      spkBtn.textContent = a?.speech ? 'Spoken messages: on' : 'Spoken messages: off';
      spkBtn.classList.toggle('on', !!a?.speech);
    };
    this.syncSound = syncSound;

    // Soldier controls belong here, not only in the Barracks view. Box select
    // sat undiscovered behind a hint in a panel the player had no reason to
    // have open. It starts open for the same reason, and folds away with the
    // header once the keys are in the player's fingers.
    const hd = this.el('div', this.controls, 'lbl hintbar');
    const hint = this.el('div', this.controls, 'hint');
    hd.innerHTML = '<span>Controls</span><span class="tw">hide</span>';
    hd.onclick = () => {
      const off = hint.classList.toggle('hidden');
      hd.querySelector('.tw')!.textContent = off ? 'show' : 'hide';
    };
    hint.innerHTML =
      'R / E rotate &nbsp; wheel zoom &nbsp; drag pan<br>' +
      '<b>1-6</b> build menu &nbsp; <b>B</b> toggle it<br>' +
      '<b>V</b> mutes and unmutes<br>' +
      '<b>X</b> demolish a building (half cost back)<br>' +
      'Esc cancels building &nbsp; M market &nbsp; T hide panel<br>' +
      '<b>Troops:</b> click select &nbsp; <b>shift-drag</b> box<br>' +
      'double-click all of a kind &nbsp; right-click move<br>' +
      'right-click a <b>tower/gatehouse</b>, or a wall joined to one, to man it<br>' +
      '<b>F</b> lights your pitch ditches &nbsp; <b>Esc</b> pause / save';
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

    // The rally flag: where a freshly made soldier or engine walks to, instead
    // of milling about at the barracks door. Set here because this is where you
    // make them; a click on the map plants the flag, a click on the barracks
    // itself takes it down.
    const rally = document.createElement('button');
    rally.className = 'tog';
    rally.style.width = '100%';
    rally.textContent = 'Set rally point';
    rally.onclick = () => this.onSetRally();
    panel.appendChild(rally);
    const rallyHint = this.el('div', panel, 'hint');
    rallyHint.style.marginBottom = '8px';
    rallyHint.textContent = 'New troops gather at the flag. '
                          + 'Plant it on the map, or on the barracks to clear it.';

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
    sel.onchange = () => {
      this.setView(sel.value as ViewName);
      // Hand the keyboard back. Left focused, the dropdown keeps eating the
      // arrow keys and the camera cannot be driven until you click the map.
      sel.blur();
    };
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

  /**
   * Place the trouble markers for this frame.
   *
   * Takes screen coordinates already worked out by the caller, exactly as the
   * placement ghost does -- the HUD has no camera and should not grow one.
   *
   * Elements are pooled rather than rebuilt. This runs every frame, and
   * recreating a handful of nodes sixty times a second to say the same thing
   * is churn the browser has to clean up for no benefit.
   */
  setFlags(items: { x: number; y: number; text: string }[]): void {
    while (this.flagPool.length < items.length) {
      const el = document.createElement('div');
      el.className = 'f';
      this.flags.appendChild(el);
      this.flagPool.push(el);
    }
    this.flagPool.forEach((el, i) => {
      const it = items[i];
      if (!it) { el.style.display = 'none'; return; }
      el.style.display = '';
      el.style.left = `${Math.round(it.x)}px`;
      el.style.top = `${Math.round(it.y)}px`;
      if (el.textContent !== it.text) el.textContent = it.text;
    });
  }

  /**
   * Name what the cursor is over.
   *
   * Kept separate from the placement ghost even though both follow the mouse:
   * the ghost answers "may this go here", this answers "what is that", and
   * they are never wanted at the same moment. Folding them together would mean
   * a mode flag inside a thing whose whole job is to be glanced at.
   */
  showTip(screenX: number, screenY: number, title: string, sub: string, foe = false): void {
    // Flip to the other side of the cursor near the right or bottom edge,
    // rather than letting the box run off the screen.
    const flipX = screenX > window.innerWidth - 280;
    const flipY = screenY > window.innerHeight - 90;
    this.tip.style.display = 'block';
    this.tip.style.left = `${screenX}px`;
    this.tip.style.top = `${screenY}px`;
    this.tip.style.transform =
      `translate(${flipX ? 'calc(-100% - 14px)' : '14px'}, ${flipY ? 'calc(-100% - 14px)' : '14px'})`;
    const html = `<div class="t${foe ? ' foe' : ''}">${title}</div>`
               + (sub ? `<div class="s">${sub}</div>` : '');
    if (this.tip.innerHTML !== html) this.tip.innerHTML = html;
  }

  hideTip(): void {
    if (this.tip.style.display !== 'none') this.tip.style.display = 'none';
  }

  hideGhost(): void {
    this.ghost.style.display = 'none';
  }

  update(): void {
    const s = this.state;

    // resource bar
    // Ordered by hand rather than taken from ALL_RESOURCES: the bar reads
    // left to right as raw goods then food, which no declaration order gives
    // for free. The cost is that a new resource must be added HERE as well --
    // fish was produced, stored and eaten correctly while being invisible in
    // the bar, because this list had not been told about it.
    const shown: (Resource | 'gold')[] = [
      'gold', 'wood', 'stone', 'iron', 'pitch', 'wheat', 'flour',
      'bread', 'cheese', 'apples', 'meat', 'fish', 'hops', 'ale', 'pigs',
    ];
    // On a phone the summary box is a sheet, so the two numbers you watch
    // constantly -- how many people, how well liked -- lead the ticker where the
    // eye can keep them without opening anything.
    const lead = this.phone
      ? `<div class="res stat" title="Population">` +
          `<span class="n">${s.population}</span><span class="k">Pop</span></div>` +
        `<div class="res stat" title="Popularity">` +
          `<span class="n">${Math.round(s.popularity)}</span><span class="k">Liked</span></div>`
      : '';
    this.topbar.innerHTML = lead + shown.map(r => {
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
    const troops = Object.values(this.armyCounts()).reduce((n, v) => n + v, 0);
    const yardColour = fill(s.stockpileUsed, s.stockpileCapacity);
    const granaryColour = fill(s.totalFood, s.granaryCapacity);
    this.stats.innerHTML =
      `<div class="row"><span>Population</span><b>${pop} / ${s.housing}</b></div>` +
      `<div class="row"><span>Unemployed</span><b>${s.idle}</b></div>` +
      // Soldiers left the population roll when they took up arms, so without
      // this line recruiting reads as people simply vanishing.
      (troops ? `<div class="row"><span>Soldiers</span><b>${troops}</b></div>` : '') +
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

    // build buttons: affordability, selection and how many you already have
    const built: Record<string, number> = {};
    for (const b of s.buildings) built[b.name] = (built[b.name] ?? 0) + 1;
    for (const b of Array.from(this.buildPanel.querySelectorAll('button'))) {
      const name = (b as HTMLElement).dataset.name!;
      const def = BUILDINGS[name];
      b.classList.toggle('on', this.placement.selected === name);
      b.classList.toggle('poor', !s.canAfford(def.cost));
      const tally = b.querySelector('.n') as HTMLElement | null;
      if (tally) {
        const n = built[name] ?? 0;
        // Blank at zero rather than "0". A grid of zeroes is noise, and the
        // number is only interesting once there is one to count.
        tally.textContent = n ? String(n) : '';
        tally.style.display = n ? '' : 'none';
      }
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
      const rate = s.popularityRate;
      // The net rate is the number that decides everything, so it is the one
      // spelled out: not "heading for 51" but "+6 a minute, so this is going
      // to 100". A player balancing taxes against ale is reading this line.
      const drift = Math.abs(rate) < 0.05 ? 'steady'
        : rate > 0 ? (now >= 100 ? 'at its best' : 'rising')
        : (now <= 0 ? 'at rock bottom' : 'falling');
      const mins = Math.abs(rate) < 0.05 ? null
        : rate > 0 ? (100 - s.popularity) / rate : s.popularity / -rate;
      const eta = mins === null || mins > 90 ? ''
        : ` — ${mins < 1 ? 'under a minute' : `about ${Math.round(mins)} min`}`;
      this.views.popularity.innerHTML =
        `<h4>Popularity — ${now}, ${drift}</h4>${rows}` +
        `<div class="pf total"><span>Net per minute</span>` +
        `<b class="${rate > 0.05 ? 'g' : rate < -0.05 ? 'w' : ''}">${sign(rate)}</b></div>` +
        (eta ? `<div class="hint">${rate > 0 ? 'Reaching 100' : 'Reaching 0'}${eta}</div>` : '');
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
