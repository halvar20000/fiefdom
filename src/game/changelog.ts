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
    version: '1.52.0',
    date: '2026-09-05',
    headline: 'The storehouse walks both ways.',
    sections: [
      {
        title: 'Changed',
        items: [
          'The storehouse fetches as well as delivers. It was only ever a drop-off, which answered a distant PRODUCER \u2014 a quarry, a fishery \u2014 and did nothing whatever for a distant consumer: a workshop draws its inputs from a real store and could not see a shed, so a mill out by the wheat walked to the stockpile for every sack it ground, and a bakery out by the mill walked there for every sack it baked. The shed stood between the two holding the flour and was allowed to help with one leg of four.',
          'A shed now looks at the manned workshops around it, keeps eight of whatever they eat on the shelf, and its carrier makes the walk to the yard instead of the miller. There is nothing to set: it stocks what the workings it stands in consume, and a shed with no workshop near it is the drop-off it always was.',
          'Which means a chain built out at the fields closes on itself. The mill drops its flour in the shed, the bakery takes it straight back out, and only the bread makes the journey home. Measured over ten minutes with a mill and a bakery thirty tiles from the stockpile, averaged over nine runs: 26 loaves with no shed, 38 with the shed as it was, 104 now. At forty-five tiles, 16 and 22 against 77.',
          'A shed keeps a few cycles\u2019 worth and not a shed full, on purpose. The walk comes off the workshop\u2019s critical path; the distance is not abolished. Forty sacks on the shelf would make a mill in the fields exactly as good as one built on the yard, and where things stand is meant to be a decision.',
          'The storehouse tooltip now says which half of its pile is which \u2014 "4 bread to go out \u00b7 8 wheat for the workings" \u2014 because the two look identical on the ground and mean opposite things.',
        ],
      },
    ],
  },
  {
    version: '1.51.0',
    date: '2026-09-04',
    headline: 'The ox goes to work.',
    sections: [
      {
        title: 'Changed',
        items: [
          'The ox tether hauls. Until now it was a licence and not a building: a quarry had to have one within fourteen tiles or it could not cut, and then the quarrymen carried every block to the stockpile on their own backs while the ox stood at its post for the whole game. The animal now walks the haul \u2014 out to the quarry with the sledge empty, back to the stockpile with a block on it \u2014 and the cutters stay at the rock face, stacking what they cut in the yard.',
          'The ox is a unit, not a picture. It is built and animated like the horses and the war dog: a heavy quadruped with the hump and the wide horns that tell it from a horse at sprite size, a yoke, and a sledge trailing on two shafts with a dressed block on it when loaded. The tether\u2019s own sprite has lost the ox that was painted into it and is now the post, the spare yoke, a water trough and the blocks waiting in the yard.',
          'A quarry stacks up to twelve blocks in its yard, and its tooltip says how many are waiting. Full, the cutters stop and say so \u2014 one ox is not enough for the stone three men can cut when the stockpile is a long way off, and a second tether beside the quarry is the answer. Measured over ten minutes with the stockpile thirty tiles away: 71 stone with one tether, 103 with two.',
          'Stone comes in faster than it did, and how much faster depends on where the stockpile is, which it never really did before. Six tiles away: 81 before, 107 now. Thirty tiles away: 36 before, 71 now.',
        ],
      },
    ],
  },
  {
    version: '1.50.0',
    date: '2026-09-04',
    headline: 'Six more maps, and ground that is shaped and not merely dressed.',
    sections: [
      {
        title: 'Added',
        items: [
          'Six new maps, and they differ in the shape of the land rather than only in what grows on it. The Salt Pan is flat from edge to edge \u2014 not one cliff on the whole map \u2014 with a shallow salt lake in the middle and no high ground to hold. The High Tables are flat-topped rocks standing over a canyon with a river in the bottom of it. The Broken Country is gullies and ridges with barely a field\u2019s worth of level ground: a third fewer places to seat a keep than any map before it. The Salt Coast runs down to a sea with bays and headlands and a strand along it. The Lake of Reeds is a quarter under water, in pools with reed beds and pitch seams around them. The Dune Sea is rank on rank of sand ridges, and the hardest ground to build on in the game.',
          'Five new settings on the generator to do it with \u2014 the height of the tiers, the grain of the elevation noise, lakes in the hollows, a sea along one edge, and dune ridges laid over the land. All optional: the six original maps generate exactly the ground they always did, because a save is a diff against the world its seed regenerates.',
          'A Relief pip on the map cards, derived from those numbers like the rest of them, so a card that says flat means flat.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Water is level ground, and the buildable test only ever read heights \u2014 so a lake was the flattest country on the map. The opening site could be chosen in the middle of one, and the placement screen\u2019s automatic seat, which looks for the point farthest from every other lord, would put a rival out in the sea where the game then refused to build his keep and lost him. Both now ask what the ground is as well as how level it is. Water within reach still counts for something: a shore is worth starting on, standing in it is not.',
          'Seating a keep by hand on water or bog is now refused on the placement screen, with a reason, instead of being accepted there and quietly failing a moment later.',
          'The Quiet Valley opens somewhere better as a result of the above \u2014 in the farmland in the south rather than on a stretch of river that scored as open ground.',
        ],
      },
    ],
  },
  {
    version: '1.49.2',
    date: '2026-09-03',
    headline: 'The gazelle stops being a bench.',
    sections: [
      {
        title: 'Changed',
        items: [
          'The gazelle is rebuilt. The old one was a slab on four posts with a straight tube for a neck: the head had the same cross-section as the neck it grew out of, so nothing in the silhouette said where the animal began, and the horns read as a pair of aerials. It now has a head set across the end of its neck with the muzzle dropped below it, three-segment horns swept back and eased forward the way a real pair are, a chest and a haunch instead of two flat walls, and legs that bend at the hock.',
          'It is also marked rather than merely shaped: a dark band down the flank, pale beneath it, and a pale rump. That is the part that carries at thirty pixels — an unmarked tan animal on tan ground is a blob whatever it is made of — and it costs nothing in silhouette.',
          'The graze clip drops the head off the bottom of the neck and dips the shoulders with it, instead of pointing the whole animal at the grass like a compass needle. The walk folds the knee on the way forward and straightens it for the stance it pushes back through.',
          'A herd is cheaper to draw than it was: the animal is measured and centred on the point it stands on rather than centred by hand, so each of its 160 sprites carries less empty air. That is 0.6 megapixels back off the atlas, better than half of what the herd was taking.',
        ],
      },
    ],
  },
  {
    version: '1.49.1',
    date: '2026-09-02',
    headline: 'The stockpile is a yard, not a shed.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Picking up a stockpile square or a granary bay showed a whole 3x3 shed hanging off the cursor, and the build menu drew the same shed as its icon — then laid down the single square it was always going to lay. The sheds are how the two stores looked before either became a yard painted a square at a time, and nothing has been able to build one for a long while; the artwork simply outlived the change and sat in the atlas, and every lookup that asked for a building called "stockpile" got it.',
          'A rival lord\'s yard had the same fault and worse: every one of his store squares was drawing a full 3x3 shed on a one-tile footprint.',
          'What a store draws now comes from one place and beats anything that merely shares its name. The sheds are gone from the atlas, which is also 0.8 megapixels back.',
        ],
      },
    ],
  },
  {
    version: '1.49.0',
    date: '2026-09-02',
    headline: 'Oil, boiled, and three ways to set the ground alight.',
    sections: [
      {
        title: 'Added',
        items: [
          'The Oil Smelter, which has been owed since the castle works went in. It boils pitch down into oil, and nothing else in the castle has any use for the stuff.',
          'The Oil Pot. A cauldron kept hot, laid the way you lay a killing pit. It tips over whatever comes to the foot of it — the hardest single blow anything on the ground deals — and then leaves the ground burning for twelve seconds. That second half is what a killing pit has not got: the blast is what it kills, the fire is what it denies.',
          'The Fire Thrower, at the mercenary post. He lobs pots of burning pitch: what he hits takes the blow and the ground takes the fire. He is the only unit in the game that denies ground rather than merely holding it, and the only one who can cost you the fight you have just won — the fire he lights burns your men as readily as theirs.',
          'Oil is a real good, made, stored, priced and sellable like any other. It sits in stoppered jars on the yard, which is a different shape from the pitch barrels beside it on purpose.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'A fire no longer burns the men standing on the wall above it. Fire is on the ground; a man on a walkway is a storey up. That was always slightly wrong and it is what makes an oil pot on your own rampart usable at all — it tips over whoever is at the foot of the wall and leaves your garrison alone.',
          'A new good with no artwork for the yard used to be stored, counted and spendable while the square it was sitting on drew nothing at all. Startup now checks the yards too, alongside the build menu, the recruit list and the resource ticker.',
        ],
      },
    ],
  },
  {
    version: '1.48.0',
    date: '2026-09-02',
    headline: 'Two engines that cannot hurt anybody.',
    sections: [
      {
        title: 'Added',
        items: [
          'The Siege Tower. It rolls a stair up to a wall: every man of yours near it can reach whoever is standing on top. That is the ladderman\'s trick on something that takes a catapult stone to stop, and it is the difference between a wall being a problem for one brave man and a wall being a problem for your army.',
          'The Portable Shield. A plank screen on two wheels. Everything behind it takes a third less from anything shot — and nothing at all off a sword. It buys you the walk up to the wall; it does not buy the fight at the top of it.',
          'Neither of them damages anything at all. What they carry is access: the tower carries men over a parapet, the screen carries them across the open ground in front of it. Both are as slow and as helpless as every other engine, so both want an escort.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Siege engines were framed by a guess — a box just big enough for a catapult\'s arm at full stretch. That is fine while every engine is a cart with something on top and wrong the moment one of them is a tower: the siege tower stands over twice that height and would have been rendered with its head cut off, silently, in all eight facings. The frame is measured from the poses that will actually be drawn now.',
        ],
      },
    ],
  },
  {
    version: '1.47.0',
    date: '2026-09-02',
    headline: 'There is a man in the keep now, and he can be killed.',
    sections: [
      {
        title: 'Added',
        items: [
          'The Lord. Yours stands at your keep from the first second of the game — purple, crowned, and the only figure on the field you can find at a glance. Every rival has one too, standing in his own.',
          'He is the strongest thing that walks: two hundred and forty health and a blow harder than any soldier\'s. He takes orders like anyone else, and he holds his ground until you tell him not to.',
          'And if he dies, the fief dies with him. That is the point of him. A keep is nine hundred health behind whatever wall you built around it; the man inside it is two hundred and forty and can be got at — which cuts both ways. You can win a war now by reaching one man instead of by knocking down a building, and so can the lord across the sand.',
          'The end screen says which of the two it was.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'A rival lord is out of his own muster. He is not packed into the next wave and walked across the map to be shot by your archers, which would have made every opponent beatable by standing still.',
          'Both lords start holding ground rather than aggressive. The default stance chases anything it notices, and for the one unit whose death ends the game that is a trap — a fief lost to a stance nobody chose. One keypress changes it when you mean to.',
        ],
      },
    ],
  },
  {
    version: '1.46.0',
    date: '2026-09-02',
    headline: 'Four legs, and nothing else on the field can keep up.',
    sections: [
      {
        title: 'Added',
        items: [
          'The Stables, and the Knight. A barracks can arm a man; it cannot mount one. He is the dearest soldier in the game and he earns it — he outruns everything on the field by half again, reaches further off the end of a lance than a swordsman does off a blade, and takes more punishment than anything else standing up.',
          'The Horse Archer, from the mercenary post. He brought his own horse, like every other mercenary brings his own everything. Shoots at an archer\'s range and rides away faster than anything can follow, and dies to almost any hand that reaches him.',
          'The War Dog, off the dog cage — which until now only frightened your own people. Eighteen gold and two of your own meat. Bites faster than anything else strikes, on the health of a slave. Loose several or none.',
          'Speed is the axis none of the rest of the army moves along. Everything on foot walks between 0.95 and 1.7 tiles a second; these three do 2.3 to 2.6. That is what cavalry is for — running down an engine, catching an archer who has just loosed, arriving somewhere before the thing that set off first.',
          'Not one of them goes up a wall. No stair in this castle was built for four legs, and the order now says so instead of claiming they cannot reach it.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'A horse or a dog no longer dies by turning into a falling peasant. The death animation is a human body and there is no animal version of it, so the four-legged hold their own pose for the moment they lie there.',
          'The mercenary post now sells five kinds of man, and every one of them still costs nothing but gold. Tranche 6 of the backlog is finished: both buildings that were waiting on troops to exist have them.',
        ],
      },
    ],
  },
  {
    version: '1.45.0',
    date: '2026-09-02',
    headline: 'Gold buys men who brought their own swords.',
    sections: [
      {
        title: 'Added',
        items: [
          'The Mercenary Post. Hires fighting men from across the sand, and gold is the whole price — no workshop, no armoury, no rack. Dearer per man than the barracks charges for his near-equivalent, and available the moment the treasury can pay. It is the answer to having no iron, and to having just lost your armoury.',
          'The Slave. Twelve gold. Barely armed, barely willing, and worth exactly what he costs: a wall\'s worth of arrows spent on slaves is a wall\'s worth not spent on your swordsmen.',
          'The Slinger. Throws stones quickly from not quite as far as an archer, and runs faster than anyone else on the field.',
          'The Arabian Swordsman. A swordsman who brought his own sword — quicker on his feet, thinner in the skin, and beholden to no blacksmith.',
          'The Assassin. Goes over a wall as though it were not there and kills what is standing on it. The hardest single blow any man deals, on forty-six health: send one at a tower, not at a battle.',
          'The Ladderman, from the siege camp. He carries a ladder and nothing else, and every man of yours standing near him can reach the enemy on a wall. Until now that was the assassin\'s trick alone, and one man at a time.',
          'Which means a wall is no longer simply a thing catapults answer. It can be climbed — but only where somebody is standing holding a ladder, and killing him takes the ladder away again that same instant.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'The mercenaries read as a different army from across the map: pale desert cloth, no helmets, and not a piece of kit among them that came out of your armoury. Because none of it did.',
        ],
      },
    ],
  },
  {
    version: '1.44.0',
    date: '2026-09-02',
    headline: 'One lathe, one anvil, and now a choice at each of them.',
    sections: [
      {
        title: 'Added',
        items: [
          'Three weapons workshops can each make a second thing. The poleturner turns pikes as well as spears, the blacksmith beats maces as well as swords, and the fletcher will build crossbows if you give him a little iron for the lock. Click the workshop to change what it is cutting; the tooltip says what it is on and what the other one is.',
          'The Pikeman. The front rank — heaviest armour in the game, slowest walk, and a reach of a full tile and a half, so he strikes before anything carrying a sword can answer him. Wants a pike and armour.',
          'The Maceman. Hits harder and faster than a swordsman on two thirds of his health: he wins the fight he picks and loses the one he is caught in. Send him at something rather than leaving him to hold a gate. Wants a mace and armour.',
          'The Crossbowman. Out-ranges an archer and each bolt bites nearly three times as deep — then he spends three seconds winding the thing back up, and he walks slower than anyone else on foot. A man for a wall you already hold. Wants a crossbow.',
          'Because each of the three comes off a workshop that was making something else, a bigger army now costs a decision rather than merely more gold. There is one lathe; spears or pikes, not both.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'The recruit panel groups itself by the building that trains each unit, with its own heading and its own "build one first" line. It used to be one hand-placed "Siege" header, which was exactly wide enough for the two buildings that existed.',
          'A soldier\'s price sits under his name rather than beside it. "55g + 1 pike + 1 armour" is half again the width of "20g + 1 spear", and on one line it pushed the Recruit button off the edge of the panel.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'The resource ticker no longer has to be told by hand about a new good. A resource missing from it was produced, stored, eaten and traded perfectly while being invisible — which is how fish shipped once. The game now says so on startup, the way it does about a building left out of the build menu.',
          'A soldier with no artwork drew as an unarmed peasant and said nothing about it. Startup now checks every recruitable unit has sprites, alongside the same check for buildings.',
          '"1 bows / 15s" in the fletcher\'s tooltip. Goods are named singular when there is one of them, everywhere, from one place.',
        ],
      },
    ],
  },
  {
    version: '1.43.0',
    date: '2026-09-02',
    headline: 'Two thirds of the artwork was transparent air.',
    sections: [
      {
        title: 'Changed',
        items: [
          'Every sprite is now cropped to the pixels that can actually be drawn. Each one used to carry the frame of the widest pose in its set — a spearman\'s frame is sized around his spear whatever he is doing — plus the whole soft tail of its cast shadow. A unit sprite was thirty-six per cent picture and sixty-four per cent nothing.',
          'That nothing was expensive. The entire scene is drawn from a single texture, because sprites split across two of them cannot be sorted against each other, and a single texture runs into a single hardware limit. The catalogue went from 8192x6588 to 8192x4272 without a pixel of it moving on screen: what a sprite carries changed, where it stands did not.',
          'Nothing looks different. The anchor is what positions a sprite, so cropping the frame and moving the anchor by the same amount is an identity, and the cut is made below the alpha the shader already throws away.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Five soldiers were carrying animations of themselves digging and swinging a pick. Nothing in the game can ask a soldier to do either — he is drawn standing, walking or striking, and that is the whole list — but the renderer had been handing every body the labourer\'s clip set anyway. Six hundred and forty sprites of an archer mining an imaginary seam, in the one texture that has a ceiling.',
        ],
      },
    ],
  },
  {
    version: '1.42.0',
    date: '2026-09-02',
    headline: 'Two guilds, and two men who will not fight for you.',
    sections: [
      {
        title: 'Added',
        items: [
          'The Engineers\' Guild, and the engineer. Stand him beside something the enemy has knocked about and he puts it back up, fastest on whatever is nearest to falling. He carries no weapon and does no damage at all, which is the point: a man who both mends and fights is just a swordsman with extra steps.',
          'The Tunnellers\' Guild, and the tunneller. Walk him up to an enemy building and he goes under it. No wall is thick enough to matter from below, and nothing he does makes a sound a catapult would. He will not fight either.',
          'Both work slowly and on purpose. A wall that comes back up as fast as a catapult knocks it down would make siege pointless, and a tunneller who dropped a gatehouse in ten seconds would make walls pointless. Bring several, or bring time.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'A new recruiting building would have told you to build a barracks. Which building trains a soldier was one of two fixed choices, and the "you need a barracks" and "you need a siege camp" messages were written out by hand beside it — so the first guild would have sent players to entirely the wrong building. The message now comes from the building the soldier actually names.',
          'A soldier left out of the recruit list was unrecruitable in silence — defined, priced, given sprites, and offered nowhere. The same hole the build menu had. The game now says so on startup, loudly, the way it does about stale artwork.',
        ],
      },
    ],
  },
  {
    version: '1.41.0',
    date: '2026-09-02',
    headline: 'Choose the ground, then choose who is standing on it.',
    sections: [
      {
        title: 'Added',
        items: [
          'Starting a game is two steps now. The first is the maps, and nothing else. The second is a picture of the map you picked, with every lord on it — you and up to three rivals — and you drag them where you want them before a stone is laid.',
          'How many rivals is yours to decide. It used to be fixed per map: The Quiet Valley was always peaceful and Cedar Ridge always had two, however you felt about it. The map still suggests a number and the screen opens with it, so pressing BEGIN gives you exactly what it always did — but you can now play the green map against three lords, or the crowded one alone.',
          'Where they start is yours too. Click a lord, click the ground. A keep needs five level tiles and forty-two tiles of distance from the next lord, and the screen says so rather than letting you find out afterwards. The rivals used to be seated automatically at the compass points, the same way every single time you replayed a map.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'The difficulty buttons moved to the second screen, where the lords they describe now live.',
          'The map the placement screen draws is the map you play. It is produced by the same generator the world is built from rather than a second drawing of it, so a river you placed a keep beside is the river that will be there. A hand-drawn map shows its own painted ground and opens with the keeps its author placed.',
        ],
      },
    ],
  },
  {
    version: '1.40.0',
    date: '2026-09-02',
    headline: 'Stairs, a pit and a bucket.',
    sections: [
      {
        title: 'Added',
        items: [
          'Wall stairs. A flight of timber steps that nobody stands on and that lets the curtain beside it be manned — so a long wall no longer needs a tower every few spans purely to give the archers a way up. Towers still earn their place by being stone, by being manned themselves, and by shooting from higher.',
          'Killing pits. Stakes under a brushwood lid, laid in runs and walkable, because a trap that blocks the path is a trap nobody walks into. The first man onto one goes in and takes whoever is beside him, and then it is spent — a hole in the ground and nothing more.',
          'Water pots. A stone butt that douses every fire near it and is emptied doing so. The answer to a fire ballista, and to your own pitch when it burns back towards your hovels.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Both new defences are consumed when they go off, like a pitch ditch. A trap you lay once and never think about again is not a decision; a line of them is a line you have to keep paying for.',
          'Neither will touch your own men. Pitch burns whoever is standing in it, on the reasoning that you lit it — but a pit under your own garrison would be a bug rather than a nuance, so the pit and the pot look only at the enemy.',
        ],
      },
    ],
  },
  {
    version: '1.39.0',
    date: '2026-09-02',
    headline: 'Twenty-one buildings you could not build, and a moat to dig.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Twenty-one buildings existed and could not be built. Every well, pond, statue, maypole, dancing bear, shrine, chapel, cathedral, tanner, turret, round tower, lookout tower and all seven of the punishments were costed, modelled, rendered and wired into the simulation — and none of them appeared in the build menu, because the menu is a hand-written list and nothing had added them to it. They are all there now, in three new groups, and the game says so loudly on startup if it ever happens again.',
          'The build menu had more categories than keys. The digit shortcuts stopped at 6 while there were seven groups, so Weapons could only be opened with the mouse. They follow the menu now, however long it grows.',
        ],
      },
      {
        title: 'Added',
        items: [
          'Moats. A wet ditch, painted in runs like a wall, that nothing crosses and nobody can stand on — the cheapest way to say "not here", and the reason to leave a gap where you do want them. Two wood a tile.',
          'Drawbridges, which are that gap. Down, it is a road and anyone may walk it, including the men coming for you. Up, it is a wall. G raises and drops every one you own at once, because hunting for each bridge in a line under fire is not a decision.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'The town menu is three groups now — Town, Faith and Fear — rather than one list of twenty-one. Gardens and gibbets were never the same kind of decision.',
        ],
      },
    ],
  },
  {
    version: '1.38.0',
    date: '2026-09-02',
    headline: 'Three more things to stand on, and height that finally counts.',
    sections: [
      {
        title: 'Added',
        items: [
          'A perimeter turret: one tile, its own stair, and manned standing alone. Scatter them across ground you want watched rather than walled. It anchors a curtain the way a tower does, but rises barely above the wall itself and falls to a third of the punishment, so it is a watch post and not a cheap tower.',
          'A round tower: a stone drum on a battered plinth, three tiles across, and twice a square tower\'s punishment before it falls — there is no corner on it for a stone to break off.',
          'A lookout tower: a timber shaft on a stone base with a railed nest on top, standing half a tile higher than anything else in the castle. Lightly built to match, at a quarter of a round tower\'s endurance.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Height on the walls now buys reach. A man posted anywhere used to gain the same fixed distance whether he stood on a wall or a tower, which would have made a lookout tower an expensive way to see nothing further. He now gains that same bonus plus more for every tile his deck stands above a plain tower\'s. Walls, towers and gatehouses all sit at or below that mark, so every one of them shoots exactly as far as it did before; only the two new tall ones gain.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'A tower the code had not been told about could not be manned. Which buildings a man can climb was a list of names — tower, gatehouse — so anything new would have been built, would have looked like a tower, and would have silently refused a garrison. The list is the other way round now: it names the curtain wall, the one thing that is a walkway rather than a building, and everything else that can be garrisoned is assumed to have its own stair.',
        ],
      },
    ],
  },
  {
    version: '1.37.0',
    date: '2026-09-02',
    headline: 'Every pig now yields two things, and one of them arms a man.',
    sections: [
      {
        title: 'Added',
        items: [
          'Hides, off the back of the slaughterhouse. Butchering a pig has always produced meat; it produces two hides with it now, and they pile up in the stockpile whether you have anything to do with them or not. They are a raw good like any other -- stored, shown in the bar, and sellable if you would rather have the gold.',
          'The tanner\'s workshop, which cures three hides into a suit of leather armour and racks it in the armoury beside the mail. It is not a new kind of kit: it is a second road to the same one. The armourer forges armour out of iron, the tanner cures it out of hides, and a swordsman does not care which he is handed. Pig farming has a war use now, and an iron-poor map is no longer a map without armoured men.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'A workshop can yield a second good from the same job. Meat and a hide come off one pig and it would be a nonsense to walk them to the yard separately, so the second good rides along with the first and is set down at the same moment. It is held to the room actually available, so a full stockpile stops hides just as it stops anything else.',
        ],
      },
    ],
  },
  {
    version: '1.36.0',
    date: '2026-09-02',
    headline: 'A shrine at the roadside, a cathedral over the town.',
    sections: [
      {
        title: 'Added',
        items: [
          'Three more rungs of religion either side of the church. A wayside shrine is a single tile, costs almost nothing and reaches eight souls -- it fits in the gaps nothing else will. A chapel is a vaulted hall under a bellcote at two thirds of a church. A cathedral is a great dome between two towers, reaching seventy-two, and it is the only building in the game that is both a mercy and an ornament: it counts toward beauty as well.',
          'Small is better value per head and large is better value per plot. Three churches and one cathedral both reach seventy-two people; the churches cost less stone and twelve tiles, the cathedral costs much more stone and nine. Stone is the currency of grandeur here, and land is what a cramped castle actually runs out of.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Coverage was counted by name. The religion lever looked for buildings called \'church\' and nothing else, which was right while there was exactly one of them and would have been quietly wrong the moment a chapel existed -- it would have been built, paid for, and reached nobody. Buildings declare which coverage they feed now, and the tally reads that, so the next one to be added cannot repeat it.',
        ],
      },
    ],
  },
  {
    version: '1.35.0',
    date: '2026-09-02',
    headline: 'Twelve ways to be loved, or feared.',
    sections: [
      {
        title: 'Added',
        items: [
          'Five things to be liked for: a well, an ornamental pond with reeds and ducks, a statue of yourself twice life size, a ribboned maypole on the green, and a dancing bear with its keeper. Beauty is summed and then eroded by the size of the town, so these are not a purchase you make once -- a fief that doubles needs more of them to stay as charmed as it was.',
          'Seven new ways to be feared, filling in the ladder either side of the gallows: stocks, a dunking stool, a stretching rack, a gibbet, a dog cage, a burning stake and a dungeon. Only the harshest one you own counts for anything, so they are rungs to climb rather than a set to collect -- building a gibbet beside your stocks buys you the gibbet\'s terms and wastes the stocks. Each rung trades more popularity for more tax than the one below it, from a thirty per cent tax rise for a day in the pillory to a hundred and forty for a dungeon and the gaolers to run it.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'The pond and the maypole want green ground, and the statue is stone only. A pond in the sand fools nobody, and the one building that says permanence ought to cost quarried stone to say it.',
        ],
      },
    ],
  },
  {
    version: '1.34.3',
    date: '2026-09-02',
    headline: 'The fifth kind of food finally counts for something.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'A fishery could never pay for itself. Popularity rewards variety at the granary on a ladder of three points a kind, but the ladder had only ever been built four rungs high while the game grew a fifth food -- so bread, cheese, apples and meat earned nine points and adding fish to them earned nine points as well. The rung is there now, and five kinds are worth twelve.',
          'The build menu\'s digit keys could open a category but never shut one. Clicking a category button has always toggled it; pressing its number only ever opened it, so there was no key that put the panel away and pressing the same digit twice did nothing the second time. The keys and the buttons behave the same way now.',
        ],
      },
    ],
  },
  {
    version: '1.34.2',
    date: '2026-09-02',
    headline: 'The four borrowed animations catch up with the rest.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Carrying, chopping, fishing and dying were still drawn from sprites baked for the old zoom. Those four clips come from 0 A.D. animation rather than the Mixamo set, they need a source archive that is not kept in the repository, and so they were quietly left behind when everything else was re-rendered at three times tile scale. They were being stretched half again beyond what they were baked for, which at full zoom is the difference between a figure and a smudge. Carrying is the one that showed: half the workforce is hauling something at any moment.',
          'A bug waiting in the renderer for whoever closed that gap. The script wrote a hard-coded scale of 2 into the manifest while the rig had already moved to 3, and the engine draws each sprite at the scale its manifest claims -- so a correct re-render would have produced correct sprites and then drawn every one of them half again too large. It reads the rig\'s own value now.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Those four clips are sampled as finely as everything else. Carrying goes from eight frames to twelve, chopping and dying from six to eight, fishing from eight to ten, each keeping the cycle length it always had. The finer sampling had already been written into the renderer during the zoom pass; only the sprites were missing.',
          'They are framed by measurement too, so a shouldered log and a fisherman\'s reach are inside the frame because they were measured rather than allowed for. Every sprite in the game is now baked at the same scale -- there is no longer a mixed-resolution corner of the atlas.',
        ],
      },
    ],
  },
  {
    version: '1.34.1',
    date: '2026-09-02',
    headline: 'Stop paying for empty air around every peasant.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Unit sprites were framed by a guess and mostly contained nothing. The renderer sized each frame from a cube derived from the unit\'s height, which had to be generous enough for the widest swing of the longest weapon and so was far too big for everything else — a peasant came out as twenty-four by thirty-seven pixels of figure inside a frame of one hundred and twenty by ninety-eight. The frame is now measured: the renderer walks every frame of every clip in every facing, takes the union of the actual mesh bounds, and fits to that. A peasant\'s frame drops to eighty by seventy-four, a spearman\'s to one hundred and four by ninety, and the four human bodies together take forty-one per cent less of the atlas — which is what decides how big a unit is allowed to be in the first place. Nothing on screen changes size; there is simply far less transparent margin behind it.',
          'A single black pixel in the corner of every peasant sprite. All three hundred and thirty-six of them carried one, in the same corner and at the same value, in all five clips and all eight facings. It was the denoiser rather than the scene — it damages the outermost ring of a small render, and which frame sizes it spoils is a lottery, so no choice of frame avoids it. Every sprite is now rendered two pixels larger on each side and cropped back down, which leaves the artefact outside the picture.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Every body now carries every clip. The atlas had gaps in it — no attack frames for the peasant, and no digging or mining frames for any of the three soldiers — because those combinations had never been rendered, and a sprite the atlas does not have is silently skipped rather than reported. The full set is four hundred and forty-eight frames larger and has no holes left to fall through.',
        ],
      },
    ],
  },
  {
    version: '1.34.0',
    date: '2026-09-01',
    headline: 'Zoom the whole way in, and find something worth looking at.',
    sections: [
      {
        title: 'Added',
        items: [
          'A fourth zoom level, at three times tile scale. A tile is 96 pixels across at full zoom where it used to be 64, a peasant stands about seventy pixels tall, and a keep fills better than five hundred. The camera stopped where it did for a reason — every sprite was baked at exactly twice tile scale, and one step further would have stretched each texel over more than a screen pixel — so the whole catalogue, all 1,700 sprites plus the ground tiles, has been re-rendered at three times instead.',
          'Half-timbered walls. Every town and workshop building is now a lime-plaster box caged in oak posts, rails and diagonal braces that stand proud of the panel and cast their own shadow across it. It is the single most recognisable thing about the buildings in the reference, and at the old zoom there was simply nowhere to put it.',
          'Roofs made of real courses. Shingle roofs are laid as overlapping split boards, staggered so the joints never line up; thatch is a deep mattress of straw bundles with rolled eaves, a rolled ridge and hazel rods pinning it down. Both are geometry rather than a texture on a smooth prism — what identifies a roof at a distance is the stepped edge and the lumpy silhouette, and no bump map changes a silhouette.',
          'Undressed stone footings under the timber buildings and along the curtain wall, rafter ends poking out beneath the eaves, boarded doors with iron bands, shuttered windows, coopered barrels, planked crates, log stacks and stacked firewood. Small things, but they are what the extra pixels are for.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Animation is sampled roughly half again as finely. A walk cycle is twelve frames where it was eight, an idle six where it was four, a siege engine\'s throw eight where it was six. Each clip now carries its own playback rate, so the cycles take exactly as long as they always did — more frames buys smoothness, not a slower stride.',
          'The keep gains corner pilasters, a string course dividing its two storeys, a boarded gate with steps up to it and a timber hoarding on the wall head. Towers grow corbels under their projecting decks, gatehouses get arch rings and a portcullis you can see through, and curtain wall gets a flagged walkway and a rubble base so a long run no longer meets the ground along one dead-straight line.',
          'Ground tiles render at 192 pixels rather than 128, which is what the new zoom needs to stay sharp.',
          'Oxen, cows and pigs are modelled as tapering barrels with dropped heads, horns and tails instead of stacked cuboids. The eye forgives a blocky building far more readily than a blocky animal.',
          'Wheat grows as thousands of individual stalks instead of flat yellow strips, hops climb their poles as spiralling bines instead of standing there as cones — the hop garden used to read as a plantation of small conifers — and tree canopies are pushed in and out of round so they are foliage rather than green balloons.',
          'Market stalls have a sagging ridged awning over a trestle of crates, sacks and a barrel, and the stockpile has a kerb round its paving, round bar stock and a stack of planks slightly out of true.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'The sprite atlas was allocating twice the texture it needed. Sprites packed to almost exactly 4096 pixels wide, the packer added its padding, and rounding the result up to a power of two doubled it — so half of a very large texture was transparent margin. It is sized to fit now, which more than pays for the sprites getting bigger.',
        ],
      },
    ],
  },
  {
    version: '1.33.0',
    date: '2026-08-31',
    headline: 'Arm your men: four weapons workshops and an armoury.',
    sections: [
      {
        title: 'Added',
        items: [
          'The weapons chain, in a new Weapons menu. The Poleturner\'s Workshop turns timber into spears and the Fletcher\'s Workshop into bows; the Blacksmith\'s Workshop beats iron into swords and the Armourer\'s Workshop forges mail. Everything they make is carried to the Armoury, and the Armoury is what the barracks arms a recruit from.',
          'The Armoury, a 3x3 store for finished kit. Each one holds forty pieces of all kinds together, so a second is a real decision rather than more painted squares. Its contents show in the resource bar and as a line in the summary panel, and clicking a weapon there opens its chain chart — ore climbing while swords stay flat is a blacksmith short of a worker.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'Recruits cost GOLD and their kit, and nothing else. A spearman is 20 gold and one spear, an archer 40 and one bow, a swordsman 80 with a sword and a suit of mail. No more timber or iron at the barracks: the workshop that made the weapon already spent it. An army is now limited by how fast your workshops turn out gear rather than by how fast the treasury fills — and iron finally has a job beyond being sold.',
          'Siege engines are unchanged and still cost timber and iron directly. An engine is built at the camp out of beams; it is not a man being handed a spear.',
          'The rival lords run the same chain on the same numbers. Break a lord\'s poleturner and his spearmen stop coming, exactly as breaking his bakery stops his bread.',
        ],
      },
      {
        title: 'Fixed',
        items: [
          'Siege engines — and everyone else — now face the right way. A catapult would stand with its back to the wall it was breaking, and a unit walking in some directions was drawn walking backwards: the sprite for a heading was picked as though the eight rendered facings ran the other way round. They run the way the models were turned now, so an engine turns to the building it is battering and a column marches the way it is going.',
          'The gazelle herd was modelled facing the opposite way to everyone else, which the facing fix would otherwise have made obvious. Handled in the engine, so the animals go on running head-first.',
        ],
      },
    ],
  },
  {
    version: '1.32.1',
    date: '2026-08-31',
    headline: 'The PAUSED banner keeps clear of the resource bar.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'At window widths where the resource bar wraps onto a second line, the PAUSED banner was drawn over its lower edge. It now sits under whatever height the bar actually has.',
        ],
      },
    ],
  },
  {
    version: '1.32.0',
    date: '2026-08-31',
    headline: 'Play at your own pace: pause, slow, normal, fast.',
    sections: [
      {
        title: 'Added',
        items: [
          'A Speed control at the top of the settings panel: Pause, Slow, Normal and Fast. Press Space to pause and unpause, or nudge the speed a notch at a time with the , and . keys. Pause remembers what you were running at, so unpausing from Fast puts you straight back to Fast.',
          'Pausing stops the world, not the game. Peasants freeze, the harvest stops, the raiders hold where they stand — but you can still rotate, pan, zoom, read any building under the cursor and line up a whole quarter of your castle before letting the clock run again. A PAUSED banner sits under the resource bar so the stillness is never mistaken for a hang. (The Esc menu is unchanged and still stops everything, drawing included.)',
          'Fast forward at three times speed, for the long quiet stretch while the granary fills or the wall goes up. It runs the same-sized steps as normal play, just more of them, so nothing walks through a wall or skips a harvest because you sped the game up.',
        ],
      },
    ],
  },
  {
    version: '1.31.0',
    date: '2026-08-28',
    headline: 'A pharmacy, a domed chapel, and the trebuchet.',
    sections: [
      {
        title: 'Added',
        items: [
          'The Pharmacy, a new town building. Like the church it tends your people — the church their soul, the pharmacy their health — and popularity rises with how much of the town it reaches. The two stack, so a settlement given both is markedly happier. Find it in the Town menu; its effect shows on the Popularity chart.',
          'The Trebuchet, the heavy siege engine above the catapult. Built at the Siege Camp, it out-ranges everything and each stone bites nearly twice as deep — but it crawls into position and reloads slowly, so it wants an escort and a good firing spot. Watch the great counterweight drop as it looses.',
        ],
      },
      {
        title: 'Changed',
        items: [
          'The church is now a domed stone chapel — an octagonal drum under a pale cupola with a lantern and finial — in place of the old spired parish church. Its role is unchanged; only the look.',
          'The catapult was rebuilt as a proper torsion mangonel: the arm now rests cocked back off its skein and whips forward through a padded crossbeam when it fires, a clearer silhouette that reads as a catapult at a glance.',
        ],
      },
    ],
  },
  {
    version: '1.30.0',
    date: '2026-08-27',
    headline: 'Charts that show why, how far back, and against whom.',
    sections: [
      {
        title: 'Added',
        items: [
          'Click Popularity (in the stats panel, or the top bar on a phone) for a new chart that shows WHY it is moving — food & ale, rations, taxes and fear each drawn as its own line around a zero rule. The tax line diving under while food climbs is the whole story of a town squeezed too hard, told at a glance.',
          'Every history chart now covers the WHOLE game, not just the last stretch. As a game runs long the chart quietly coarsens its resolution instead of forgetting how things began, so an hours-long siege still shows its opening moves.',
          'Click Gold once a rival is in play and the chart draws your treasury against the richest enemy lord’s, so you can see whether you are winning the war of economies — not just the war.',
        ],
      },
    ],
  },
  {
    version: '1.29.2',
    date: '2026-08-27',
    headline: 'Clicking a resource for its history actually works now.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Clicking a top-bar figure — Gold, Wood, and the rest — to open its history chart did nothing at all during real play. The bar redraws every frame, so the chip you pressed on was gone before you lifted your finger, and the click landed on empty bar instead. It now opens the moment you press, so the chart appears every time.',
        ],
      },
    ],
  },
  {
    version: '1.29.1',
    date: '2026-08-27',
    headline: 'Resource charts that show a line, not a filled block.',
    sections: [
      {
        title: 'Fixed',
        items: [
          'Clicking a steady resource — an untouched treasury, a stable wood pile — used to open a chart that looked blank: the line sat pinned to the top with the whole box filled in. Stock charts now zoom to their own range, so a flat figure reads as a flat line across the middle and small rises and falls are actually visible.',
        ],
      },
    ],
  },
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
