/**
 * The second page of starting a game: who is on the map, and where.
 *
 * Rival lords used to be a fixed number baked into each map, seated
 * automatically at eight compass points seventy-two tiles out. That decides
 * two things the player has every reason to want to decide -- how many enemies
 * there are, and who starts where -- and it decided them the same way every
 * time you replayed a map.
 *
 * The preview is drawn from `shapeTerrain`, the same function the game builds
 * the world with, so the picture you place a keep on IS the map you wake up
 * in. Anything else here would be a second implementation of the generator and
 * it would drift.
 */
import {
  shapeTerrain, heightFieldOf, findStartSite, isBuildable, GROUND_COLOURS,
} from '../game/worldgen';
import { MAP_W, MAP_H, type MapDef } from '../game/maps';
import { KEEP_COLOURS, decodeArrays, type CustomMap } from '../game/custom';
// NOT maps.ts's Difficulty. That one is the map's own rating -- Gentle, Fair,
// Harsh -- printed on the card. This is how hard the rival lords PLAY, which
// is the thing this screen sets.
import { DIFFICULTY, type Difficulty } from '../game/lord';

export interface Seat {
  x: number;
  z: number;
}

/** Who is playing, and from where. Slot 0 is always the human. */
export interface LordSetup {
  you: Seat;
  /** Rival lords, in FACTION_COLOURS order. Empty means build in peace. */
  rivals: Seat[];
  difficulty: Difficulty;
}

const DIFFS: Difficulty[] = ['easy', 'normal', 'heavy'];

/** Keeps this far apart, in tiles. Below it two castles share a doorstep. */
const MIN_SEPARATION = 42;

const CSS = `
#lords {
  position: fixed; inset: 0; z-index: 30; overflow: auto;
  display: flex; flex-direction: column; align-items: center;
  background:
    radial-gradient(120% 80% at 50% 0%, rgba(84,64,34,.55) 0%, rgba(16,16,14,0) 70%),
    #10100e;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; color: #ecdfc2;
  padding: 28px 20px 40px;
}
#lords h1 { font-size: 26px; letter-spacing: 5px; color: #f0c869; margin-bottom: 2px; }
#lords .sub { font-size: 12px; opacity: .6; letter-spacing: 2px; margin-bottom: 18px; }
#lords .board { display: flex; gap: 22px; align-items: flex-start; flex-wrap: wrap;
  justify-content: center; }
#lords canvas {
  image-rendering: pixelated; border: 1px solid #4a4034; border-radius: 4px;
  cursor: crosshair; background: #14130f; box-shadow: 0 8px 30px rgba(0,0,0,.5);
}
#lords .side { display: flex; flex-direction: column; gap: 10px; min-width: 268px; }
#lords .seat {
  display: flex; align-items: center; gap: 10px; padding: 9px 11px;
  border: 1px solid #3a3228; border-radius: 4px; background: rgba(30,27,22,.7);
  cursor: pointer;
}
#lords .seat.on { border-color: #f0c869; background: rgba(60,50,26,.7); }
#lords .seat.off { opacity: .38; }
#lords .dot { width: 13px; height: 13px; border-radius: 50%; flex: 0 0 auto; }
#lords .seat .nm { flex: 1; font-size: 13px; }
#lords .seat .at { font-size: 11px; opacity: .55; }
#lords .seat button {
  background: #2a251d; color: #ecdfc2; border: 1px solid #4a4034; border-radius: 3px;
  font: inherit; font-size: 11px; padding: 2px 8px; cursor: pointer;
}
#lords .hint { font-size: 11px; opacity: .55; line-height: 1.6; }
#lords .warn { font-size: 11px; color: #e2a05f; min-height: 15px; }
#lords .diff { display: flex; gap: 6px; align-items: center; margin-top: 4px; }
#lords .diff .lbl { font-size: 11px; opacity: .6; letter-spacing: 1px; margin-right: 4px; }
#lords .diff button {
  background: #2a251d; color: #ecdfc2; border: 1px solid #4a4034; border-radius: 3px;
  font: inherit; font-size: 11px; padding: 3px 9px; cursor: pointer;
}
#lords .diff button.on { border-color: #f0c869; color: #f0c869; }
#lords .acts { display: flex; gap: 12px; margin-top: 22px; align-items: center; }
#lords .go {
  background: #f0c869; color: #241d10; border: 0; border-radius: 4px;
  font: inherit; font-size: 15px; letter-spacing: 4px; font-weight: 700;
  padding: 12px 34px; cursor: pointer;
}
#lords .back {
  background: transparent; color: #ecdfc2; border: 1px solid #4a4034;
  border-radius: 4px; font: inherit; font-size: 12px; padding: 10px 18px; cursor: pointer;
}
`;

/**
 * Show the placement screen for `map`.
 *
 * Resolves with the setup, or null if the player went back to the map list.
 */
export function lordScreen(
  map: MapDef, difficulty: Difficulty,
): Promise<LordSetup | null> {
  return new Promise(resolve => {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'lords';
    document.body.appendChild(root);

    const h1 = document.createElement('h1');
    h1.textContent = map.name.toUpperCase();
    root.appendChild(h1);
    const sub = document.createElement('div');
    sub.className = 'sub';
    sub.textContent = 'CHOOSE YOUR ENEMIES · CHOOSE YOUR GROUND';
    root.appendChild(sub);

    // The map itself, obtained exactly as the game will obtain it: generated
    // from the settings, or decoded from the painted arrays. A hand-drawn map
    // shown as its seed would generate is not the map -- it is a different
    // map with the same name, and every keep placed on it would be placed on
    // terrain that does not exist.
    const custom = map.custom as CustomMap | undefined;
    const shape = custom
      ? (() => {
          const { corners, ground } = decodeArrays(custom);
          return {
            width: custom.w, height: custom.h, corners, groundType: ground,
            variant: new Uint8Array(custom.w * custom.h),
            cliff: new Uint8Array(custom.w * custom.h),
            flatTiles: [],
          };
        })()
      : shapeTerrain(map, MAP_W, MAP_H);
    const field = heightFieldOf(shape);
    const W = shape.width, H = shape.height;

    const board = document.createElement('div');
    board.className = 'board';
    root.appendChild(board);

    const SCALE = 3;
    const canvas = document.createElement('canvas');
    canvas.width = W * SCALE;
    canvas.height = H * SCALE;
    // Displayed larger than half-size: at 300px a tile is 1.5 screen pixels
    // and placing a keep on a particular bank of the river is guesswork.
    canvas.style.width = `${W * 2.4}px`;
    canvas.style.height = `${H * 2.4}px`;
    board.appendChild(canvas);
    const ctx = canvas.getContext('2d')!;

    // Rasterise once: the ground never changes while this screen is open, so
    // only the markers are redrawn as seats move.
    const ground = document.createElement('canvas');
    ground.width = W;
    ground.height = H;
    const gctx = ground.getContext('2d')!;
    const img = gctx.createImageData(W, H);
    for (let i = 0; i < W * H; i++) {
      const c = GROUND_COLOURS[shape.groundType[i]] ?? [0, 0, 0];
      // Shade by height so the tiers read: a flat colour map hides every
      // plateau and cliff, which is most of what makes a site good or bad.
      const cw = W + 1;
      const x = i % W, z = (i / W) | 0;
      const lift = 0.86 + shape.corners[z * cw + x] * 0.055;
      img.data[i * 4] = Math.min(255, c[0] * lift);
      img.data[i * 4 + 1] = Math.min(255, c[1] * lift);
      img.data[i * 4 + 2] = Math.min(255, c[2] * lift);
      img.data[i * 4 + 3] = 255;
    }
    gctx.putImageData(img, 0, 0);

    // --- seats --------------------------------------------------------------
    //
    // The human is auto-placed exactly where the game would have put him, so
    // the default opening is the one that was there before this screen existed.
    const you = custom?.start ?? findStartSite(field, shape.groundType);
    const seats: (Seat | null)[] = [you, null, null, null];
    // A painted map carries its author's keeps. Those are a statement, so they
    // seed the screen rather than being replaced by an automatic spread.
    (custom?.keeps ?? []).slice(0, 3).forEach((k, i) => { if (k) seats[i + 1] = k; });

    /** Somewhere buildable, far from every seat already taken. */
    function autoSeat(): Seat | null {
      const taken = seats.filter(Boolean) as Seat[];
      let best: Seat | null = null;
      let bestScore = -Infinity;
      for (let z = 20; z < H - 20; z += 4) {
        for (let x = 20; x < W - 20; x += 4) {
          if (!isBuildable(field, x - 1, z - 1, 5, 5)) continue;
          const near = Math.min(...taken.map(s => Math.hypot(s.x - x, s.z - z)));
          if (near < MIN_SEPARATION) continue;
          // Farthest from the nearest neighbour, so lords spread out rather
          // than lining up along one edge.
          if (near > bestScore) { bestScore = near; best = { x, z }; }
        }
      }
      return best;
    }

    // Seed the rivals with whatever the map suggests, so a player who just
    // wants the old behaviour presses BEGIN and gets it.
    for (let i = 0; i < Math.min(map.lords, 3); i++) {
      if (seats[i + 1]) continue;          // the map already said where
      const s = autoSeat();
      if (s) seats[i + 1] = s;
    }

    let picking = 0;          // which seat a click on the map moves
    let diff = difficulty;

    const side = document.createElement('div');
    side.className = 'side';
    board.appendChild(side);

    const warn = document.createElement('div');
    warn.className = 'warn';

    const rows: HTMLElement[] = [];
    const draw = () => {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(ground, 0, 0, canvas.width, canvas.height);
      seats.forEach((s, i) => {
        if (!s) return;
        const cx = s.x * SCALE, cz = s.z * SCALE;
        ctx.beginPath();
        ctx.arc(cx, cz, i === picking ? 13 : 10, 0, Math.PI * 2);
        ctx.fillStyle = KEEP_COLOURS[i].css;
        ctx.globalAlpha = 0.9;
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.lineWidth = i === picking ? 3 : 2;
        ctx.strokeStyle = i === picking ? '#fff' : '#1a1712';
        ctx.stroke();
      });
      rows.forEach((row, i) => {
        row.classList.toggle('on', i === picking);
        row.classList.toggle('off', !seats[i]);
        const at = row.querySelector('.at')!;
        at.textContent = seats[i] ? `${seats[i]!.x}, ${seats[i]!.z}` : 'not playing';
      });
    };

    KEEP_COLOURS.forEach((c, i) => {
      const row = document.createElement('div');
      row.className = 'seat';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.style.background = c.css;
      const nm = document.createElement('span');
      nm.className = 'nm';
      nm.textContent = i === 0 ? 'You' : c.name;
      const at = document.createElement('span');
      at.className = 'at';
      row.append(dot, nm, at);

      // The human cannot be removed; a rival can be switched off entirely,
      // which is how you choose the number of them.
      if (i > 0) {
        const tog = document.createElement('button');
        tog.textContent = seats[i] ? 'Remove' : 'Add';
        tog.onclick = e => {
          e.stopPropagation();
          if (seats[i]) {
            seats[i] = null;
          } else {
            const s = autoSeat();
            if (!s) { warn.textContent = 'No room left far enough from the others.'; return; }
            seats[i] = s;
            picking = i;
          }
          warn.textContent = '';
          tog.textContent = seats[i] ? 'Remove' : 'Add';
          draw();
        };
        row.appendChild(tog);
      }

      row.onclick = () => {
        if (!seats[i]) return;
        picking = i;
        draw();
      };
      rows.push(row);
      side.appendChild(row);
    });

    const hint = document.createElement('div');
    hint.className = 'hint';
    hint.textContent = 'Click a lord, then click the map to move his keep. '
      + 'Green and rock near a keep is what makes a start playable.';
    side.appendChild(hint);
    side.appendChild(warn);

    const diffWrap = document.createElement('div');
    diffWrap.className = 'diff';
    diffWrap.innerHTML = '<span class="lbl">THEY PLAY</span>';
    const diffBtns: Record<string, HTMLButtonElement> = {};
    for (const d of DIFFS) {
      const b = document.createElement('button');
      b.textContent = DIFFICULTY[d].label;
      b.className = d === diff ? 'on' : '';
      b.onclick = () => {
        diff = d;
        for (const k of DIFFS) diffBtns[k].classList.toggle('on', k === d);
      };
      diffBtns[d] = b;
      diffWrap.appendChild(b);
    }
    side.appendChild(diffWrap);

    canvas.onclick = ev => {
      const r = canvas.getBoundingClientRect();
      const x = Math.round((ev.clientX - r.left) / r.width * W);
      const z = Math.round((ev.clientY - r.top) / r.height * H);
      if (x < 8 || z < 8 || x > W - 9 || z > H - 9) {
        warn.textContent = 'Too close to the edge of the world.';
        return;
      }
      // The same test the game applies when it seats a keep, so a spot
      // accepted here cannot be refused a moment later.
      if (!isBuildable(field, x - 1, z - 1, 5, 5)) {
        warn.textContent = 'A keep needs five tiles of level ground.';
        return;
      }
      const clash = seats.some((s, i) =>
        s && i !== picking && Math.hypot(s.x - x, s.z - z) < MIN_SEPARATION);
      if (clash) {
        warn.textContent = `Keep them at least ${MIN_SEPARATION} tiles apart.`;
        return;
      }
      warn.textContent = '';
      seats[picking] = { x, z };
      draw();
    };

    const acts = document.createElement('div');
    acts.className = 'acts';
    root.appendChild(acts);

    const leave = () => { root.remove(); style.remove(); };

    const back = document.createElement('button');
    back.className = 'back';
    back.textContent = '← Another map';
    back.onclick = () => { leave(); resolve(null); };
    acts.appendChild(back);

    const go = document.createElement('button');
    go.className = 'go';
    go.textContent = 'BEGIN';
    go.onclick = () => {
      leave();
      resolve({
        you: seats[0]!,
        rivals: seats.slice(1).filter(Boolean) as Seat[],
        difficulty: diff,
      });
    };
    acts.appendChild(go);

    draw();
  });
}
