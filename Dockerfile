# Fiefdom is a client-side game: the browser does the simulation and the
# rendering, in multiplayer as much as alone. The container serves the built
# files, keeps saved games and custom maps in a /data volume so they survive an
# update, holds the player accounts, and puts two to four of those players into
# the same match. All of that is why there is a small Node server here rather
# than plain nginx -- and all of it is Node built-ins, with no dependencies.

# ---- build ----
#
# Pinned to BUILDPLATFORM -- the machine doing the building -- and NOT to the
# architecture being built for. What comes out of this stage is `dist/`:
# JavaScript, JSON and PNGs, which are the same bytes whether they will be
# served by an x86 box or an ARM one. Running the build twice, once per target,
# bought nothing and cost everything:
#
# CI builds amd64 and arm64, and the arm64 half ran Node under QEMU emulation.
# On 2026-09-09 that stopped working -- `npm ci` died with "qemu: uncaught
# target signal 4 (Illegal instruction)" on a runner image that had moved
# underneath us. Because the process died from a SIGNAL rather than exiting,
# buildkit waited on it instead of failing, and the job sat there for ninety
# minutes reporting nothing at all.
#
# With this, the arm64 image has no RUN in it whatsoever: it is a base image and
# some files copied in, so no ARM binary is ever executed at build time and the
# emulator is never involved. It is also roughly twice as fast, because npm and
# vite now run once rather than once per architecture.
FROM --platform=$BUILDPLATFORM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
# vite.config.ts is load-bearing, not optional: it defines __BUILD_ID__, which
# stamps ?v=<id> onto every asset URL. Left out of this list once already, and
# the build did not fail -- Vite simply ran with defaults, the define never
# happened, and the asset URLs shipped unversioned. A browser holding an
# `immutable` copy of tiles.json from an older image then never re-asks for it,
# so water renders as sand no matter what the server sends.
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY public ./public
# `npm run build` typechecks first, so a broken build never ships as an image.
RUN npm run build

# ---- runtime ----
FROM node:20-alpine
WORKDIR /app
# Just the built site and the little dependency-free server. No node_modules --
# it uses only Node built-ins, so there is nothing to install.
COPY --from=build /app/dist ./dist
# The whole docker/ folder, not just server.mjs: the server grew three siblings
# when multiplayer arrived (accounts.mjs, ws.mjs, lobby.mjs) and it imports
# them by relative path. Copying one file built an image that started and then
# died on the first import, which is a slow way to find out.
COPY docker/*.mjs ./
# Saved games, custom maps, player accounts and the key that signs their
# sessions all land here. Map it to a host folder (Unraid appdata) and it
# outlives every future container update -- and losing it means everyone has to
# register again.
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
CMD ["node", "server.mjs"]
