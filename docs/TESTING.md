# Testing

Two layers, neither of which adds a dependency.

## `npm test` -- the pure modules

`tests/*.test.ts` are Node's built-in test runner (`node --test`) over the
game's own modules, bundled on the fly by the esbuild that Vite already
brings. They cover what runs without a browser: the save format and its
upgrade ladder, the autosave ring, the seasons, the name tables, the
pathfinder, and the match's view of who is who.

    npm test            # everything
    npm test -- save    # only tests/save.test.ts

A test imports `./_dom` first if the module under test touches
`localStorage`; that file installs a Map-backed stand-in.

## `tools/e2e/smoke.mjs` -- the built game

Everything else needs WebGL and a page. The smoke test boots the built game in
a headless Chromium, starts a map, builds a little, runs ten minutes of the
simulation and fails on any page error. It talks to Chrome over the DevTools
protocol with a hand-rolled client (`tools/e2e/cdp.mjs`), so it needs only
Node and a Chromium.

    npm run build
    PORT=8931 STATIC_DIR=$PWD/dist DATA_DIR=/tmp/fiefdom-smoke node docker/server.mjs &
    chromium --headless=new --remote-debugging-port=9341 --no-sandbox \
             --use-gl=swiftshader --enable-unsafe-swiftshader &
    node tools/e2e/smoke.mjs http://127.0.0.1:8931/ 9341 /tmp/smoke.png

It prints the frame profile at the end (the same figures as **I** in the
game), so a build that got slow shows up as a number rather than a feeling.

`window.__game` is the handle both this and any ad-hoc poking use: `state`,
`army`, `factions`, `build(name, x, z)`, `stepSim(seconds)`, `snapshot()`,
`profile()`, `lordStatus()`, and more -- see the end of `src/main.ts`.
