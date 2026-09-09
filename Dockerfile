# Fiefdom is a client-side game: the browser does the simulation and the
# rendering, in multiplayer as much as alone. The container serves the built
# files, keeps saved games and custom maps in a /data volume so they survive an
# update, holds the player accounts, and puts two to four of those players into
# the same match. All of that is why there is a small Node server here rather
# than plain nginx -- and all of it is Node built-ins, with no dependencies.

# ---- build ----
FROM node:20-alpine AS build
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
