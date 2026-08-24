# Fiefdom is a client-side game: the browser does the simulation and the
# rendering. The container serves the built files -- and now also keeps saved
# games and custom maps in a /data volume, so they survive a container update
# instead of living only in one browser's localStorage. That storage is the one
# reason there is a small Node server here rather than plain nginx.

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
# server.mjs uses only Node built-ins, so there is nothing to install.
COPY --from=build /app/dist ./dist
COPY docker/server.mjs ./server.mjs
# Saved games and custom maps land here. Map it to a host folder (Unraid
# appdata) and it outlives every future container update.
ENV DATA_DIR=/data
VOLUME /data
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
CMD ["node", "server.mjs"]
