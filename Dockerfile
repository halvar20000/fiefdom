# Fiefdom is a pure client-side game: the browser does the simulation and the
# rendering, so the container is nothing but a web server handing over static
# files. No database, no API, no secrets -- which is why this is a great deal
# shorter than most self-hosted app images.

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci || npm install
COPY tsconfig.json index.html ./
COPY src ./src
COPY public ./public
# `npm run build` typechecks first, so a broken build never ships as an image.
RUN npm run build

# ---- runtime ----
FROM nginx:alpine
# The sprite atlas is ~1300 PNGs. Serving them with sane cache headers is the
# difference between a one-second load and a slow one on every single visit.
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD wget -qO- http://localhost/ >/dev/null 2>&1 || exit 1
