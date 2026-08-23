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
