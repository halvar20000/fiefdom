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
    version: '1.9.0',
    date: '2026-08-21',
    headline: 'Better worker animation, and soldiers that fall.',
    sections: [
      {
        title: 'Added',
        items: [
          'Soldiers now fall when killed instead of blinking out — a real death animation that plays before the body is gone.',
          'The fisherman finally has his own motion, working the water rather than miming a woodcutter\u2019s swing.',
          'The woodcutter\u2019s chop and the carrying walk are replaced with far more committed versions — a real wind-up and follow-through where there was barely any movement before.',
        ],
      },
      {
        title: 'Credit',
        items: [
          'These four animations come from 0 A.D. by Wildfire Games, CC BY-SA 3.0, retargeted onto Fiefdom\u2019s own character. They live under their own licence in a directory of their own; see docs/THIRD-PARTY.md.',
        ],
      },
    ],
  },
  {
    version: '1.8.0',
    date: '2026-08-21',
    headline: 'The map sounds like what is on it.',
    sections: [
      {
        title: 'Added',
        items: [
          'What you can see, you can hear. Scroll to the river and it laps; scroll to a quarry and you hear picks on stone; a woodcutter chops, a mill groans under its own weight, a brewery bubbles, the pens complain, a market murmurs, and pitch that has been lit crackles.',
          'It follows the camera. Bring something into view and it fades in, scroll off it and it fades out, and it sits left or right depending on which side of the screen it is on.',
          'Only working buildings are heard. A mill with nobody in it is a still wheel, and hearing it grind would be worse than hearing nothing.',
        ],
      },
    ],
  },
  {
    version: '1.7.0',
    date: '2026-08-21',
    headline: 'Sound, and messages read aloud.',
    sections: [
      {
        title: 'Added',
        items: [
          'Every message the game puts on screen is now also spoken, using your browser\u2019s own voice. Warnings are read in a lower register than news.',
          'Sounds for the things you do and the things done to you: timber set down when you build, a collapse when you demolish, a muster call for a recruit, stone coming apart when a building falls, and the pitch catching light.',
          'A quiet wind under all of it, so a desert reads as quiet rather than as broken.',
          'Sound controls sit with rations and taxes: Off / Low / Full, and spoken messages on or off. V mutes and unmutes in a hurry. Both settings are remembered.',
        ],
      },
      {
        title: 'How it is made',
        items: [
          'Nothing is sampled. Every sound is synthesised in the browser from three primitives — a struck tone, a band of filtered noise, and an envelope — for the same reasons every sprite comes out of Blender: nothing to licence, nothing added to the download, and one file deciding how the whole game sounds.',
        ],
      },
    ],
  },
  {
    version: '1.6.0',
    date: '2026-08-21',
    headline: 'Popularity works the way Crusader\u2019s does.',
    sections: [
      {
        title: 'Changed',
        items: [
          'Feed your people and take no taxes and you will reach 100. Popularity now ACCUMULATES: the modifiers are a rate per minute, not a score to settle at. It used to add up to 51 and sit there, which is why nothing short of extra rations got you past 70.',
          'Taxes are now something you pay for. Fair taxes cost 14 a minute; extra rations and three kinds of food more than cover it. That trade is the point of the whole economy.',
          'The popularity panel shows the net per minute and how long it will take, instead of a target number.',
          'Overcrowding is a nudge (-2) rather than a wall (-6). At -6 it exactly cancelled a fed, untaxed town, so a full settlement could never pass 67 however well it was run.',
          'People leave a little over twice as slowly. Popularity now travels the whole scale, so a town dips below 45 on its way somewhere better — and at the old rate a dip emptied eight people in forty seconds.',
        ],
      },
    ],
  },
  {
    version: '1.5.2',
    date: '2026-08-21',
    headline: 'Two camera fixes: it stops at the map edge, and it stops at all.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'The view can no longer be scrolled off the edge of the map. It used to keep the CENTRE on the map, which let half a screen of nothing hang past the border.',
          'Using the panel dropdown at the top right and then pressing an arrow key sent the view scrolling forever, with no way to steer it back. The dropdown swallowed the key-release, so the game went on believing the key was still held.',
          'Keys are now ignored while a dropdown or text box has the keyboard, the dropdown hands focus back as soon as you choose, and every held key is dropped if the window loses focus.',
        ],
      },
    ],
  },
  {
    version: '1.5.0',
    date: '2026-08-21',
    headline: 'The Fire Ballista.',
    sections: [
      {
        title: 'Added',
        items: [
          'Fire Ballista, from the siege camp: 150 gold, 20 wood and 5 iron. It shoots burning bolts nine tiles — further than any archer — and hits far harder.',
          'It is the first engine that shoots men rather than stone, and it cannot touch a wall at all. That makes it the answer to a column of soldiers or to somebody else\u2019s catapult, not a third way through a gatehouse.',
          'Like the ram and the catapult it never advances by itself. Put it where you want the ground covered and it holds there.',
        ],
      },
    ],
  },
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
