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
    version: '1.29.0',
    date: '2026-08-27',
    headline: 'Build within your lands, and rams that obey.',
    sections: [
      {
        title: 'Changed',
        items: [
          'You can no longer build across the whole map. Building is now limited to your lands — a generous area around your keep. The one way to claim more ground is stone: raise a wall, tower or gatehouse and the border pushes out around it, so your castle grows by walling in land, as in Stronghold. While you have a building in hand, the highlighted ground shows exactly where it may go.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'The battering ram now obeys move orders. It used to clamp onto the first enemy building it passed and refuse to budge; now, while marching to where you send it, it ignores everything and only batters the building you actually park it at. (Setting it to Hold with H also makes it hold its fire.)',
        ],
      },
    ],
  },
  {
    version: '1.28.0',
    date: '2026-08-27',
    headline: 'Richer resource charts.',
    sections: [
      {
        title: 'Added',
        items: [
          'Click a food good and the chart now shows your food produced against food eaten on one graph — when the lines cross, a shortage is opening up, plain to see.',
          'Click a good with a chain — wheat, flour, hops, ale — and the whole chain is drawn together, so a pile-up upstream next to a flat line downstream points straight at the bottleneck.',
          'Every chart’s header now shows the rate of change, e.g. “+12/min” in green or a fall in red, and the history it keeps was extended to cover a long game.',
        ],
      },
    ],
  },
  {
    version: '1.27.0',
    date: '2026-08-27',
    headline: 'Click a resource to see its history.',
    sections: [
      {
        title: 'Added',
        items: [
          'Click any figure in the top bar — Gold, Wood, Bread, and the rest, plus Population and Popularity — and a chart pops up showing how it has moved over the game so far. Handy for spotting a slow drain before it becomes a crisis, or seeing whether a new farm actually turned your food around.',
        ],
      },
    ],
  },
  {
    version: '1.26.0',
    date: '2026-08-27',
    headline: 'Choose how hard the rival lords fight.',
    sections: [
      {
        title: 'Added',
        items: [
          'A rival-strength setting on the title screen — Easy, Normal or Heavy. It scales how fast and how large an army each lord raises, how big and how soon his waves come, and the economy that pays for all of it, so a Heavy lord fields a real army (up to 48 strong) that can genuinely come for your keep.',
          'Normal is stronger than the lords were before, and Heavy much stronger still; pick Easy for a gentler game. Your choice is remembered and saved with the game.',
        ],
      },
    ],
  },
  {
    version: '1.25.2',
    date: '2026-08-27',
    headline: 'The fisherman fishes at the water.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'A fisherman stood on the grass behind his hut instead of at the shore. He now walks to the nearest water and works from the bank, facing it, as he should.',
        ],
      },
    ],
  },
  {
    version: '1.25.1',
    date: '2026-08-27',
    headline: 'Blows that connect.',
    sections: [
      {
        title: 'Changed',
        items: [
          'Close-quarters attacks now land where they should. A swordsman, spearman or battering ram lunges into its target on each blow and eases back — so the ram meets the wall it is breaking and a sword-stroke reaches the man it is aimed at, instead of striking across a gap. Archers and catapults still loose from where they stand.',
          'Woodcutters and other workers stand closer to what they are working, so a man felling a tree is swinging at the trunk rather than a step back from it.',
        ],
      },
    ],
  },
  {
    version: '1.25.0',
    date: '2026-08-25',
    headline: 'Rise to be the greatest lord in the land.',
    sections: [
      {
        title: 'Added',
        items: [
          'Your standing is now measured against the rival lords by one fair yardstick — the size of your people, the worth of your army, the extent of your holdings and your treasury — and when you pull ahead of every rival you are told: "You are now the greatest lord in the land!" Lose the lead and a rival takes the honour back.',
          'A ladder of titles earned from that same standing — Lord, Knight, Baron, Earl, Duke, Prince, King — announced as you climb, so even on a peaceful map you feel your fief growing in stature.',
          'The end tally now shows the title you earned and your final standing among the lords.',
        ],
      },
    ],
  },
  {
    version: '1.24.0',
    date: '2026-08-25',
    headline: 'A proper end to the war.',
    sections: [
      {
        title: 'Added',
        items: [
          'When the last rival keep falls, his whole castle is now put to the torch and cleared from the map — buildings razed and burning, his leaderless troops quit the field, his workers gone — so the ground you won is truly yours instead of a frozen enemy town you can no longer touch.',
          'A victory tally in the spirit of Stronghold: time played, your largest settlement, gold amassed, popularity, buildings standing, rivals defeated, enemy troops destroyed and men lost. Choose "Survey the field" to look over your conquest, or "Return to title".',
          'Losing your own keep now ends the game too, with a matching defeat screen, rather than just carrying on.',
        ],
      },
    ],
  },
  {
    version: '1.23.0',
    date: '2026-08-25',
    headline: 'Tell troops to hold their ground.',
    sections: [
      {
        title: 'Added',
        items: [
          'A defensive stance. Select troops and press H — or use the stance button that appears at the bottom of the screen — and they hold their ground: they attack anything that comes within reach but never move to chase it, so you can post archers on a ford or spearmen at a gate and trust them to stay put. Press H again to send them back on the attack.',
          'Holding troops wear a cool steel tint so you can see at a glance which of your men are standing guard, and the stance is remembered in your saved game. An explicit move order still moves them; only the automatic pursuit is held.',
        ],
      },
    ],
  },
  {
    version: '1.22.1',
    date: '2026-08-25',
    headline: 'The river crossing is now a proper causeway.',
    sections: [
      {
        title: 'Changed',
        items: [
          'The ford that joins a divided map is now two tiles wide instead of one — a small causeway across the river rather than a single-file thread, so it reads as a bridge and a column is not funnelled over it one at a time. Only the water is widened; the banks are untouched.',
        ],
      },
    ],
  },
  {
    version: '1.22.0',
    date: '2026-08-25',
    headline: 'The enemy can always be reached.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'A river could cut the map in two and strand the enemy lord on the far bank with no way across — a game you could neither win nor lose. Now the map guarantees a land route to every rival: where a river divides you, it carves a ford (a strip of dry sand) across the narrowest crossing so your army can march over.',
          'Long marches through a narrow gap — a ford, or a gap in a wall — no longer fail. The pathfinder used to give up on very long routes that funnel through a single tile; it now searches as far as it needs to for a route that genuinely exists.',
        ],
      },
    ],
  },
  {
    version: '1.21.0',
    date: '2026-08-24',
    headline: 'Separate players, separate saves, via a login.',
    sections: [
      {
        title: 'Added',
        items: [
          'More than one person can now play on the same server, each with their own private saved games and custom maps, gated by a login. It uses Cloudflare Access: Cloudflare handles the login at the edge, the server verifies the signed identity token, and every player’s data is kept apart. The title screen shows who is signed in, with a Log out link.',
          'Turn it on by setting the ACCESS_TEAM_DOMAIN and ACCESS_AUD variables and adding a Cloudflare Access application in front of your hostname — see INSTALL.md. Leave them unset and nothing changes: one shared profile as before.',
        ],
      },
      {
        title: 'Good to know',
        items: [
          'On your LAN (bypassing Cloudflare) there is no login, so those visits share one “local” profile — which is also where any existing shared saves move to when you upgrade, so nothing is lost.',
        ],
      },
    ],
  },
  {
    version: '1.20.0',
    date: '2026-08-24',
    headline: 'Rally flag: send new troops where you want them.',
    sections: [
      {
        title: 'Added',
        items: [
          'A rally point for your barracks and siege camp. Open the Barracks panel, click "Set rally point", then click anywhere on the map to plant a flag — every soldier and siege engine you make from then on marches straight to it instead of milling about at the door, so your army forms up where you need it. Click the flag onto the barracks to clear it, or press Esc to cancel while placing.',
          'The flag is remembered in your saved game.',
        ],
      },
    ],
  },
  {
    version: '1.19.0',
    date: '2026-08-24',
    headline: 'Saved games and maps now live on the server.',
    sections: [
      {
        title: 'Changed',
        items: [
          'Saved games and custom maps are now stored on the server, in a /data folder, instead of only in your browser. On Unraid, map /data to appdata and they survive every container update and are the same in every browser and on every device — no more saves seeming to vanish after an update or when you open the game from a different address.',
          'Upgrading loses nothing: the first time the new version runs, any saves your browser was already holding are copied up to the server automatically.',
          'If the /data volume is left unmapped the game still works — it falls back to storing saves in your browser as before — so map the volume to get the durability.',
        ],
      },
      {
        title: 'Under the hood',
        items: [
          'The container is now a small dependency-free Node server rather than nginx; it serves the game with the same careful cache rules as before and adds a tiny storage API. A corrupt or half-written save is now refused rather than crashing the menu.',
        ],
      },
    ],
  },
  {
    version: '1.18.0',
    date: '2026-08-24',
    headline: 'Cut down the rival lord’s workers to break his economy.',
    sections: [
      {
        title: 'Added',
        items: [
          'Your soldiers can now kill the rival lord’s labourers, not just his troops. An archer or swordsman standing among his workers with no enemy soldier to face will cut them down — and each one killed costs that lord the person AND the staffed slot on the building he worked, so the job stops until the lord can spare someone to walk in a replacement. Sit archers over his fields and his economy grinds to a halt.',
          'Soldiers still fight soldiers first — they only turn on workers when there is no enemy soldier in range — and they do not give chase after them, so an ordered march is never derailed and a wall archer keeps his post while thinning the workers below.',
        ],
      },
      {
        title: 'Note',
        items: [
          'This cuts one way for now: your own workers are still safe from enemy soldiers. Making it symmetric — so a raid through your town costs you workers too — is a deliberate later step.',
        ],
      },
    ],
  },
  {
    version: '1.17.1',
    date: '2026-08-24',
    headline: 'The rival lord stops piling his buildings in a heap.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'The rival lord packed every building edge to edge, and because a roof overhangs its footprint by a tile or two, his castle came out an unreadable red heap with the store squares buried under the roofs. He now keeps a one-tile gap around his roofed buildings — houses, workshops, farms — so his town reads, while his wall ring, towers and store yards still tile tight the way they are meant to.',
        ],
      },
    ],
  },
  {
    version: '1.17.0',
    date: '2026-08-24',
    headline: 'The rival lord’s castle has people in it.',
    sections: [
      {
        title: 'Added',
        items: [
          'The rival lords now have visible workers. His economy was always real — his mill needs wheat, his bakery needs flour, and razing either has always stopped his bread — but his labour was an invisible headcount and his castle looked deserted. Now every staffed job has a figure that walks between the workplace and his stores, in his own colour, so you can watch his economy run and see it falter when you break a link in the chain.',
          'He farms for variety too, not just wheat: apple orchards and dairy and pig farms join his food chain where the ground allows, the same second-tier farms the player has. A one-crop enemy starved the instant his single chain was cut; now his food is spread across bread, apples, cheese and meat.',
        ],
      },
      {
        title: 'Note',
        items: [
          'This is the first step of a larger effort to have the AI lord play the full game the player does. Still to come: the ale, faith and market buildings (which need him to care about popularity, as the player does), and making his haulage physical so blocking a supply route — not only felling a building — can starve him.',
        ],
      },
    ],
  },
  {
    version: '1.16.1',
    date: '2026-08-24',
    headline: 'Group your troops by touch.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'On a phone or tablet you can now select more than one soldier, so more than one can be posted on a wall or tower. Selecting used to need a shift-drag box or a double-click — neither of which a touchscreen has — so every tap replaced the selection and only a single man could ever be sent up.',
          'Now a tap adds a soldier to the group (tap him again to drop him), a tap on empty ground clears the group, and a double-tap takes every soldier of that kind — the touch stand-ins for shift-click and double-click. Mouse and keyboard are unchanged.',
        ],
      },
    ],
  },
  {
    version: '1.16.0',
    date: '2026-08-24',
    headline: 'A phone shows the game, not the menus.',
    sections: [
      {
        title: 'Changed',
        items: [
          'On a phone the four panel columns no longer sit on top of the map at once. The map now fills the screen; the only permanent chrome is a slim resource strip along the top and the thumb bar along the bottom.',
          'The thumb bar gained Map, Info and Build buttons. Each opens one panel as a sheet that slides up over the map and closes again with a tap on the handle or the dimmed background — one at a time, so the game is always right there behind it.',
          'Picking a building, or arming the wrecking tool, closes the build sheet on its own, so the map you are about to place on is uncovered the moment you need it.',
          'Population and how well you are liked lead the top strip, since those are the two numbers you watch without wanting to open anything.',
        ],
      },
      {
        title: 'Unchanged',
        items: [
          'Tablets and desktops keep the always-open panels — there is room for them, and nothing about that layout moved.',
        ],
      },
    ],
  },
  {
    version: '1.15.0',
    date: '2026-08-24',
    headline: 'A warmer, greener, more varied land.',
    sections: [
      {
        title: 'Added',
        items: [
          'Oak trees — tall, round-canopied broadleaves that mix in with the palms so a landscape is no longer a field of identical trees. They favour the lush green ground, the way real woodland does, so where the land is richest the trees look it.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Town buildings are brighter. Their plaster was a dull tan that swallowed the timber framing; it is now a cream white, so the dark beams and roofs stand out and a street reads as buildings rather than a brown mass.',
          'The whole world is lit warmer. The sun carries a touch more gold and the ambient sky is warmer too, so stone, thatch and skin all sit under one sunlit key instead of the flat, cool light from before. Every sprite in the game — ground, buildings, people, animals, siege engines — was re-rendered under it so nothing looks lit from a different day.',
          'Trees are scattered with more variety: oak and olive lead on green ground, palms hold the drier edges, and bushes fill between, so no two stretches of country look stamped from the same mould.',
        ],
      },
    ],
  },
  {
    version: '1.14.0',
    date: '2026-08-22',
    headline: 'Greener ground.',
    sections: [
      {
        title: 'Changed',
        items: [
          'Grass is a richer, more saturated green instead of dry olive — the biggest single step toward the look of the games this is modelled on. Lush ground under trees deepened to match.',
          'Scrub, the sand-to-grass transition, was pulled the same way so a green field no longer sits olive-edged against emerald.',
        ],
      },
    ],
  },
  {
    version: '1.13.0',
    date: '2026-08-22',
    headline: 'Churches, gardens, and rule by fear.',
    sections: [
      {
        title: 'Added',
        items: [
          'Church — raises popularity by how much of your town it reaches, the way ale does, but needs no barrels behind it.',
          'Garden — a pretty thing that lifts popularity. The bonus is capped and erodes as the town grows, so a big settlement must keep adding them.',
          'Gallows — rule by fear: popularity falls, but frightened people pay their taxes and gold from tax rises sharply. Its own popularity hit drives some away, which is the tension of it.',
        ],
      },
    ],
  },
  {
    version: '1.12.0',
    date: '2026-08-22',
    headline: 'Playable on a phone or tablet.',
    sections: [
      {
        title: 'Added',
        items: [
          'On a touch device a thumb bar appears with rotate, zoom, build and menu, and a Move toggle. One finger drags the map and taps to select; pinch to zoom.',
          'With Move on, a tap orders the selected troops -- march or man a wall -- the touch stand-in for the mouse\u2019s right click.',
          'It only shows on a real touch device (or with ?touch=1); a desktop with a mouse is untouched.',
        ],
      },
    ],
  },
  {
    version: '1.11.0',
    date: '2026-08-22',
    headline: 'Walls need stairs to man them.',
    sections: [
      {
        title: 'Changed',
        items: [
          'A stretch of curtain wall can only be manned if it joins a tower or gatehouse — the buildings with stairs. A bare ring of wall with no tower is now just an obstacle, as in Crusader, so towers earn their place instead of being optional.',
          'The rival lords play by the same rule and no longer send men toward walls they could never climb.',
        ],
      },
    ],
  },
  {
    version: '1.10.1',
    date: '2026-08-21',
    headline: 'Unraid now sees updates without a manual force.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Unraid showed "up to date" against a newer image, so every update had to be forced by hand. The image is now published as a plain Docker schema-2 manifest list with no provenance or SBOM attestations -- the format Unraid\u2019s update checker actually reads. This is the same fix media-vault already uses.',
          'This is a packaging change only; the game is identical to 1.10.0.',
        ],
      },
    ],
  },
  {
    version: '1.10.0',
    date: '2026-08-21',
    headline: 'Arrows and bolts you can see fly.',
    sections: [
      {
        title: 'Added',
        items: [
          'Archers loose a visible arrow at their target; the fire ballista and the catapult throw a glowing bolt. Each arcs from shooter to mark and fades as it goes.',
          'Melee troops and the ram, which strike at contact, throw nothing — only real ranged fire draws a projectile.',
        ],
      },
    ],
  },
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
