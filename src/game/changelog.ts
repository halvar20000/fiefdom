/**
 * What changed, and when.
 *
 * This file is the ONLY copy. It ships inside the bundle, so the running game
 * can show its own release notes, and there is deliberately no CHANGELOG.md
 * beside it: two copies of a changelog is two copies that disagree by the
 * third release. It also lives under `src/`, which the Dockerfile already
 * copies wholesale -- a root-level file would need adding to that COPY list by
 * hand, and forgetting exactly that is what shipped a half-broken image once
 * already.
 *
 * Newest first. `version` must match package.json, which is what the header
 * displays and what the image is tagged with.
 */

export interface Release {
  version: string;
  /** ISO date, so it sorts and reads the same everywhere. */
  date: string;
  headline: string;
  sections: { title: string; items: string[] }[];
}

export const RELEASES: Release[] = [
  {
    version: '1.4.0',
    date: '2026-08-21',
    headline: 'A minimap, and water on every map.',
    sections: [
      {
        title: 'Added',
        items: [
          'A minimap above the controls. Click or drag on it to send the view there. It turns with the camera, and the white outline is your actual screen corners projected onto the ground, so it is right at any zoom or rotation rather than an approximation.',
          'Keeps show as large dots — yours white, each rival in his own colour — so you can see where everyone sits at a glance. N hides it.',
          'Every shipped map now has a river running down its wadi, and pitch marsh along the banks.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Bank pitch is not scaled by a map\u2019s marsh setting. The two driest maps bias marsh down hard — that is their character — and used to end up with none at all and a pitch rig that could never be built. Now they get a usable seam beside the water and stay dry everywhere else.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Loading a save drains any water a restored building would be standing in, the same way it already cleared trees. Terrain is regenerated from the map rather than stored, so adding rivers moved the ground under existing saves.',
        ],
      },
    ],
  },
  {
    version: '1.3.0',
    date: '2026-08-21',
    headline: 'Far fewer trees. You can see your own town again.',
    sections: [
      {
        title: 'Changed',
        items: [
          'Vegetation density roughly halved. Lush ground put something on 40% of its flat tiles and grass on 30% — that is not woodland, it is a hedge you cannot see your buildings through.',
          'The editor\u2019s Vegetation settings were rescaled to match. "Few" now covers 6% of lush ground where it used to cover 20%, and "Many" covers 32% where it used to cover 80%.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Loading a save now clears any tree standing where a restored building goes. The scatter is regenerated from the map rather than stored, so tuning its density used to risk growing a palm through somebody\u2019s granary.',
        ],
      },
    ],
  },
  {
    version: '1.2.0',
    date: '2026-08-21',
    headline: 'Hover anything to find out what it is.',
    sections: [
      {
        title: 'Added',
        items: [
          'A tooltip naming whatever is under the cursor, with the detail that matters for it: workers and output for a workshop, what is on a store square, how many a hovel houses, and damage on anything hurt.',
          'It reads rival buildings too, so scouting an enemy castle tells you the same things about it as your own.',
          'It shows while the wrecking tool is armed as well, reading "Pull down the Iron Mine" — knowing what is about to go is worth most at exactly that moment.',
        ],
      },
    ],
  },
  {
    version: '1.1.0',
    date: '2026-08-21',
    headline: 'Buildings say when they have nobody to work them.',
    sections: [
      {
        title: 'Added',
        items: [
          'A marker floats over any building that is short of workers — "no worker" when it is empty, "short 2" when it is partly staffed. It stays up for as long as the problem does, rather than flashing past as a notice you can miss.',
          'At most twelve show at once. If the whole town is unstaffed you have one problem, not forty, and the population figure already says so.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-08-21',
    headline: 'First release. A working castle economy, a war, and a map editor.',
    sections: [
      {
        title: 'The settlement',
        items: [
          'Full production chains: timber, stone, iron and pitch; wheat to flour to bread; hops to ale and the inn; pigs and hunted game to meat; fish from the water.',
          'A paintable stockpile and granary whose squares show what is actually stored on them, and fill up if you do not expand.',
          'The storehouse: a drop-off out at the workings, so a distant quarry or fishery keeps producing while one carrier does the long haul.',
          'Rations, taxes, popularity, ale and food variety, all feeding one popularity figure you can read the breakdown of.',
          'Demolish anything but the keep and get half its cost back.',
        ],
      },
      {
        title: 'The castle and the war',
        items: [
          'Curtain walls, gatehouses and towers, with archers you can post on them for extra reach and where melee cannot touch them.',
          'Soldiers bought outright at the barracks — no weapons chain. A recruit leaves the population: he eats nothing, pays no tax, and his bed takes someone new.',
          'Siege camps building rams and catapults, the only things that break stone. They never advance on their own.',
          'Up to three rival lords who build a real economy under your rules, and who fight each other before they turn on you.',
          'Pitch marsh you can trench and set alight under an advancing column.',
        ],
      },
      {
        title: 'Maps',
        items: [
          'Six maps that genuinely differ, from a wooded valley with no opposition to a drought with three lords already dividing it.',
          'A map editor: start on bare desert and paint seven ground types, raise and lower hills, and place every keep by hand.',
          'Import a picture — a top-down minimap reads straight into the ground.',
          'Water: the one ground nothing crosses and nothing stands on.',
        ],
      },
      {
        title: 'Running it',
        items: [
          'Save, load and pause, with three slots. Saves live in your browser.',
          'Packaged for Unraid and published as a multi-architecture container image.',
          'Every sprite in the game is generated procedurally in Blender. Nothing comes from an asset pack.',
        ],
      },
    ],
  },
];

export const CURRENT = RELEASES[0];
