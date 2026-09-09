/**
 * The multiplayer lobby: find a match, or make one.
 *
 * Two screens in one overlay -- the list of open matches, and the room you sit
 * in once you have joined one -- because they are two views of a single
 * conversation with the server and moving between them should not feel like
 * navigating anywhere.
 *
 * The host does one thing nobody else does: place the keeps. That reuses the
 * single-player placement screen (`lordScreen`), so the map a match is fought
 * on is chosen exactly the way a solo game's is, and the picture the host puts
 * a keep on is the terrain everyone wakes up in.
 */

import { MAPS, type MapDef } from '../game/maps';
import { DIFFICULTY, type Difficulty } from '../game/lord';
import { BANNERS, YOU_CSS } from '../game/banners';
import { listMaps, defOf } from '../game/custom';
import { lordScreen, type SeatPlan } from './lords';
import { net } from '../net/socket';
import type { LobbyRow, MatchView, MatchMode, ServerMessage } from '../net/protocol';
import { me, logout, type Account } from '../net/session';

const CSS = `
#lobby {
  position: fixed; inset: 0; z-index: 30; overflow: auto;
  display: flex; flex-direction: column; align-items: center;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(84,64,34,.55) 0%, rgba(16,16,14,0) 70%),
    #10100e;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #ecdfc2;
  padding: 34px 20px 44px;
}
#lobby h1 { font-size: 30px; letter-spacing: 8px; color: #f0c869; margin: 0 0 2px; }
#lobby .sub { font-size: 11px; opacity: .55; letter-spacing: 2px; margin-bottom: 20px; }
#lobby .wrap { width: 100%; max-width: 820px; }
#lobby .bar {
  display: flex; align-items: center; gap: 12px; margin-bottom: 14px;
  font-size: 11px; opacity: .75;
}
#lobby .bar .grow { flex: 1; }
#lobby .dotstate { width: 8px; height: 8px; border-radius: 50%; background: #79c06a; }
#lobby .dotstate.bad { background: #d4694a; }
#lobby .dotstate.wait { background: #e2a05f; }
#lobby .panel {
  background: rgba(24,19,12,.88); border: 1px solid rgba(196,162,96,.24);
  border-radius: 6px; padding: 16px 18px; margin-bottom: 14px;
}
#lobby h3 {
  font-size: 12px; letter-spacing: 3px; color: #f0c869; margin: 0 0 12px;
  font-weight: 600;
}
#lobby .row {
  display: flex; align-items: center; gap: 12px; padding: 10px 12px;
  border: 1px solid #3a3228; border-radius: 4px; background: rgba(30,27,22,.7);
  margin-bottom: 8px;
}
#lobby .row .nm { flex: 1; font-size: 13px; }
#lobby .row .meta { font-size: 11px; opacity: .55; }
#lobby .empty { font-size: 11px; opacity: .45; padding: 6px 2px 2px; line-height: 1.7; }
#lobby button {
  background: #2a251d; color: #ecdfc2; border: 1px solid #4a4034; border-radius: 3px;
  font: inherit; font-size: 11px; padding: 6px 12px; cursor: pointer;
}
#lobby button:hover:not(:disabled) { border-color: #f0c869; color: #f0c869; }
#lobby button:disabled { opacity: .35; cursor: default; }
#lobby button.on { border-color: #f0c869; color: #f0c869; }
#lobby button.go {
  background: #f0c869; color: #241d10; border: 0; font-size: 13px;
  letter-spacing: 3px; font-weight: 700; padding: 10px 22px;
}
#lobby .fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
  gap: 12px; }
#lobby label { display: block; font-size: 10px; opacity: .55; margin-bottom: 4px;
  letter-spacing: 1px; }
#lobby input[type=text], #lobby select {
  width: 100%; box-sizing: border-box; padding: 7px 9px; background: #100e0a;
  color: #ecdfc2; font: inherit; font-size: 12px; border: 1px solid #4a4034;
  border-radius: 3px;
}
#lobby input:focus, #lobby select:focus { outline: none; border-color: #f0c869; }
#lobby .seg { display: flex; gap: 6px; }
#lobby .seg button { flex: 1; white-space: nowrap; }
#lobby .players { display: flex; flex-direction: column; gap: 8px; }
#lobby .player { display: flex; align-items: center; gap: 10px; padding: 9px 11px;
  border: 1px solid #3a3228; border-radius: 4px; background: rgba(30,27,22,.7); }
#lobby .player .dot { width: 12px; height: 12px; border-radius: 50%; flex: 0 0 auto; }
#lobby .player .nm { flex: 1; font-size: 13px; }
#lobby .player .tag { font-size: 10px; opacity: .5; letter-spacing: 1px; }
#lobby .player.away { opacity: .45; }
#lobby .chat {
  height: 150px; overflow: auto; font-size: 11px; line-height: 1.75;
  background: #100e0a; border: 1px solid #3a3228; border-radius: 3px;
  padding: 8px 10px; margin-bottom: 8px;
}
#lobby .chat b { color: #f0c869; font-weight: 600; }
#lobby .chat .sys { opacity: .5; font-style: italic; }
#lobby .say { display: flex; gap: 8px; }
#lobby .say input { flex: 1; }
#lobby .acts { display: flex; gap: 10px; align-items: center; margin-top: 16px; }
#lobby .acts .grow { flex: 1; }
#lobby .err { font-size: 11px; color: #e2a05f; min-height: 16px; margin-top: 8px; }
`;

/** What the caller gets back: enough to boot the world. */
export interface LobbyResult {
  match: MatchView;
  you: number;
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));

/** Every map a match can be played on: the shipped ones and this player's own. */
function allMaps(): MapDef[] {
  const custom = listMaps().map(m => defOf(m));
  return [...MAPS, ...custom];
}

/**
 * Open the lobby. Resolves when a match begins, or with null if the player
 * goes back to the title screen.
 */
export function lobbyScreen(account: Account): Promise<LobbyResult | null> {
  return new Promise(resolve => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'lobby';
    root.innerHTML = `
      <h1>MULTIPLAYER</h1>
      <div class="sub">SIGNED IN AS ${escapeHtml(account.username.toUpperCase())}</div>
      <div class="wrap">
        <div class="bar">
          <span class="dotstate wait" id="lb-dot"></span>
          <span id="lb-state">connecting…</span>
          <span class="grow"></span>
          <button id="lb-signout">Sign out</button>
          <button id="lb-back">← Title screen</button>
        </div>
        <div id="lb-body"></div>
      </div>`;
    document.body.appendChild(root);

    const body = root.querySelector<HTMLDivElement>('#lb-body')!;
    const dot = root.querySelector<HTMLSpanElement>('#lb-dot')!;
    const state = root.querySelector<HTMLSpanElement>('#lb-state')!;

    let matches: LobbyRow[] = [];
    let match: MatchView | null = null;
    let error = '';
    /** Chat and the server's own notices, interleaved as they arrived. */
    let lines: { who: string | null; text: string }[] = [];
    /** Set while the host is on the placement screen, so the room stops redrawing. */
    let placing = false;

    const maps = allMaps();
    const form = {
      name: `${account.username}'s war`,
      mapId: maps[0]?.id ?? '',
      mode: 'versus' as MatchMode,
      aiLords: 0,
      maxPlayers: 2,
      difficulty: 'normal' as Difficulty,
    };

    const finish = (result: LobbyResult | null) => {
      offMsg();
      offStatus();
      root.remove();
      style.remove();
      resolve(result);
    };

    // --- the two screens ----------------------------------------------------

    const drawList = () => {
      const rows = matches.map(m => `
        <div class="row">
          <span class="nm">${escapeHtml(m.name)}</span>
          <span class="meta">${escapeHtml(m.map)} · ${m.mode === 'coop' ? 'co-op' : 'versus'}
            · ${m.ai} AI · ${m.players}/${m.max}</span>
          <button data-join="${m.id}" ${m.players >= m.max || m.state !== 'lobby'
            ? 'disabled' : ''}>${m.state === 'lobby' ? 'Join' : 'In progress'}</button>
        </div>`).join('');

      body.innerHTML = `
        <div class="panel">
          <h3>OPEN MATCHES</h3>
          ${rows || `<div class="empty">Nobody is waiting. Start one below —
            the others will see it the moment you do.</div>`}
        </div>
        <div class="panel">
          <h3>START A MATCH</h3>
          <div class="fields">
            <div>
              <label for="lb-name">Name</label>
              <input type="text" id="lb-name" maxlength="40" value="${escapeHtml(form.name)}">
            </div>
            <div>
              <label for="lb-map">Map</label>
              <select id="lb-map">${maps.map(m =>
                `<option value="${escapeHtml(m.id)}"${m.id === form.mapId ? ' selected' : ''}
                  >${escapeHtml(m.name)}</option>`).join('')}</select>
            </div>
            <div>
              <label>Sides</label>
              <div class="seg">
                <button data-mode="versus" class="${form.mode === 'versus' ? 'on' : ''}"
                  >Free-for-all</button>
                <button data-mode="coop" class="${form.mode === 'coop' ? 'on' : ''}"
                  >Allies</button>
              </div>
            </div>
            <div>
              <label for="lb-max">Players</label>
              <select id="lb-max">${[2, 3, 4].map(n =>
                `<option value="${n}"${n === form.maxPlayers ? ' selected' : ''}
                  >${n}</option>`).join('')}</select>
            </div>
            <div>
              <label for="lb-ai">AI lords as well</label>
              <select id="lb-ai">${[0, 1, 2, 3, 4].map(n =>
                `<option value="${n}"${n === form.aiLords ? ' selected' : ''}
                  >${n === 0 ? 'none' : n}</option>`).join('')}</select>
            </div>
            <div>
              <label for="lb-diff">They play</label>
              <select id="lb-diff">${(['easy', 'normal', 'heavy'] as Difficulty[]).map(d =>
                `<option value="${d}"${d === form.difficulty ? ' selected' : ''}
                  >${DIFFICULTY[d].label}</option>`).join('')}</select>
            </div>
          </div>
          <div class="acts">
            <span class="grow"></span>
            <button class="go" id="lb-create">CREATE</button>
          </div>
          <div class="err">${escapeHtml(error)}</div>
        </div>`;

      for (const b of Array.from(body.querySelectorAll<HTMLButtonElement>('[data-join]'))) {
        b.onclick = () => { error = ''; net.send({ t: 'join', id: b.dataset.join! }); };
      }
      for (const b of Array.from(body.querySelectorAll<HTMLButtonElement>('[data-mode]'))) {
        b.onclick = () => { form.mode = b.dataset.mode as MatchMode; drawList(); };
      }
      const nameEl = body.querySelector<HTMLInputElement>('#lb-name')!;
      nameEl.oninput = () => { form.name = nameEl.value; };
      const bind = <T,>(id: string, set: (v: string) => T) => {
        const el = body.querySelector<HTMLSelectElement>(id)!;
        el.onchange = () => { set(el.value); };
      };
      bind('#lb-map', v => { form.mapId = v; });
      bind('#lb-max', v => { form.maxPlayers = Number(v); });
      bind('#lb-ai', v => { form.aiLords = Number(v); });
      bind('#lb-diff', v => { form.difficulty = v as Difficulty; });

      body.querySelector<HTMLButtonElement>('#lb-create')!.onclick = () => {
        const map = maps.find(m => m.id === form.mapId);
        if (!map) { error = 'Pick a map first.'; drawList(); return; }
        error = '';
        net.send({
          t: 'create', name: form.name, map, mode: form.mode,
          aiLords: form.aiLords, maxPlayers: form.maxPlayers,
          difficulty: form.difficulty,
        });
      };
    };

    const drawRoom = (m: MatchView) => {
      const you = m.players.find(p => p.username === account.username);
      const host = !!you?.host;
      const here = m.players.filter(p => p.here);
      const everyoneReady = here.every(p => p.ready || p.host);
      const enough = here.length >= 2;

      const players = m.players.map(p => `
        <div class="player${p.here ? '' : ' away'}">
          <span class="dot" style="background:${
            p.slot === you?.slot ? YOU_CSS : BANNERS[p.slot % BANNERS.length].css}"></span>
          <span class="nm">${escapeHtml(p.username)}${p.host ? ' — host' : ''}</span>
          <button data-team="${p.slot}" ${p.slot === you?.slot ? '' : 'disabled'}
            >Team ${p.team}</button>
          <span class="tag">${!p.here ? 'AWAY' : p.host ? 'HOST' : p.ready ? 'READY' : 'WAITING'}</span>
        </div>`).join('');

      const chatHtml = lines.map(l => l.who === null
        ? `<div class="sys">${escapeHtml(l.text)}</div>`
        : `<div><b>${escapeHtml(l.who)}</b> ${escapeHtml(l.text)}</div>`).join('');

      body.innerHTML = `
        <div class="panel">
          <h3>${escapeHtml(m.name.toUpperCase())}</h3>
          <div class="empty" style="margin-bottom:12px">
            ${escapeHtml(m.map.name)} · ${m.mode === 'coop' ? 'allies' : 'every lord for himself'}
            · ${m.aiLords} AI ${m.aiLords === 1 ? 'lord' : 'lords'}
            (${DIFFICULTY[m.difficulty].label.toLowerCase()})
            · up to ${m.maxPlayers} players
          </div>
          <div class="players">${players}</div>
          <div class="empty">Same team number means allies. Change your own to
            pick a side.</div>
        </div>
        <div class="panel">
          <h3>TALK</h3>
          <div class="chat" id="lb-chat">${chatHtml}</div>
          <div class="say">
            <input type="text" id="lb-say" maxlength="300" placeholder="Say something…">
            <button id="lb-send">Send</button>
          </div>
        </div>
        <div class="acts">
          <button id="lb-leave">Leave match</button>
          <span class="grow"></span>
          ${host
            ? `<button class="go" id="lb-start" ${enough && everyoneReady ? '' : 'disabled'}
                >PLACE KEEPS &amp; BEGIN</button>`
            : `<button class="go" id="lb-ready">${you?.ready ? 'NOT READY' : 'READY'}</button>`}
        </div>
        <div class="err">${escapeHtml(error)}</div>`;

      const chat = body.querySelector<HTMLDivElement>('#lb-chat')!;
      chat.scrollTop = chat.scrollHeight;

      const say = body.querySelector<HTMLInputElement>('#lb-say')!;
      const send = () => {
        const text = say.value.trim();
        if (!text) return;
        net.send({ t: 'chat', text });
        say.value = '';
      };
      body.querySelector<HTMLButtonElement>('#lb-send')!.onclick = send;
      say.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); send(); } };

      for (const b of Array.from(body.querySelectorAll<HTMLButtonElement>('[data-team]'))) {
        b.onclick = () => {
          const p = m.players.find(x => x.slot === Number(b.dataset.team));
          if (!p) return;
          // Cycling through as many teams as there are players is enough: any
          // arrangement of four players into sides is reachable that way, and a
          // free-text field for a team number is a worse way to say it.
          net.send({ t: 'team', team: (p.team % m.maxPlayers) + 1 });
        };
      }
      body.querySelector<HTMLButtonElement>('#lb-leave')!.onclick = () => {
        net.send({ t: 'leave' });
      };
      body.querySelector<HTMLButtonElement>('#lb-ready')?.addEventListener('click', () => {
        net.send({ t: 'ready', on: !you?.ready });
      });
      body.querySelector<HTMLButtonElement>('#lb-start')?.addEventListener('click', () => {
        void placeAndStart(m);
      });
    };

    /**
     * The host's last step: seat every castle on the map, then start.
     *
     * The lobby overlay is hidden rather than torn down, because the placement
     * screen can be backed out of and the room has to still be there behind it.
     */
    const placeAndStart = async (m: MatchView) => {
      const here = m.players.filter(p => p.here);
      const labels = [
        ...here.map(p => p.username),
        ...Array.from({ length: m.aiLords }, (_, k) => `AI: ${BANNERS[
          (here.length + k) % BANNERS.length].name}`),
      ];
      const colours = labels.map((_, i) =>
        i === 0 ? YOU_CSS : BANNERS[i % BANNERS.length].css);
      const plan: SeatPlan = {
        labels, colours,
        title: 'SEAT THE LORDS',
        sub: `${m.map.name.toUpperCase()} · ONE KEEP FOR EACH`,
        action: 'BEGIN',
      };

      placing = true;
      root.style.display = 'none';
      const setup = await lordScreen(m.map, m.difficulty, plan);
      root.style.display = '';
      placing = false;
      if (!setup) { drawRoom(m); return; }

      // lordScreen hands back the host's own seat separately from the rest;
      // the wire wants one flat list in slot order, host first.
      net.send({ t: 'start', seats: [setup.you, ...setup.rivals] });
    };

    const redraw = () => {
      if (placing) return;
      if (match) drawRoom(match); else drawList();
    };

    // --- server traffic -----------------------------------------------------

    const offMsg = net.on((msg: ServerMessage) => {
      switch (msg.t) {
        case 'lobby': matches = msg.matches; if (!match) redraw(); return;
        case 'match':
          // Entering a room clears whatever was said in the last one.
          if (msg.match?.id !== match?.id) lines = [];
          match = msg.match;
          error = '';
          if (!match) net.send({ t: 'sub' });
          redraw();
          return;
        case 'chat':
          lines.push({ who: msg.from, text: msg.text });
          if (lines.length > 100) lines.shift();
          redraw();
          return;
        case 'note':
          lines.push({ who: null, text: msg.msg });
          if (lines.length > 100) lines.shift();
          redraw();
          return;
        case 'err': error = msg.msg; redraw(); return;
        case 'begin': finish({ match: msg.match, you: msg.you }); return;
      }
    });

    const offStatus = net.onStatus((s, detail) => {
      dot.className = `dotstate ${s === 'open' ? '' : s === 'connecting' ? 'wait' : 'bad'}`;
      state.textContent = s === 'open' ? 'connected'
        : s === 'connecting' ? 'connecting…'
        : s === 'lost' ? `${detail ?? 'connection lost'} — retrying…`
        : 'offline';
      if (s === 'open') net.send({ t: 'sub' });
    });

    root.querySelector<HTMLButtonElement>('#lb-back')!.onclick = () => {
      if (match) net.send({ t: 'leave' });
      net.close();
      finish(null);
    };
    root.querySelector<HTMLButtonElement>('#lb-signout')!.onclick = async () => {
      net.close();
      await logout();
      finish(null);
    };

    net.open();
    redraw();
  });
}

/**
 * The whole multiplayer entry point: make sure there is an account, then open
 * the lobby. Resolves with the match to play, or null if the player backed out
 * at any point.
 */
export async function multiplayer(
  signIn: () => Promise<Account | null>,
): Promise<LobbyResult | null> {
  const account = await me() ?? await signIn();
  if (!account) return null;
  return lobbyScreen(account);
}
