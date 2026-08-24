# Installing Fiefdom on Unraid

Fiefdom runs entirely in your browser. The container is a small web server
handing over static files and keeping your saves, so there is **no database, no
API key and no account to create** — set a port, add a folder for your saves,
start it, and play.

## Community Applications

1. **Apps** → search for **fiefdom** → **Install**.
2. Set **WebUI Port** if 8080 is already taken on your server.
3. Leave the **Saves** path (`/data`) pointing at its default appdata folder.
4. **Apply**, then click the container's **WebUI**.

That is the whole setup.

## Without Community Applications

**Docker** → **Add Container** → **Template: none**, then:

| Field | Value |
|---|---|
| Name | `fiefdom` |
| Repository | `ghcr.io/halvar20000/fiefdom:latest` (or pin one, e.g. `:1.18.0`) |
| Network Type | `Bridge` |
| WebUI | `http://[IP]:[PORT:8080]` |
| Port | container `80` → host `8080` |
| Path | container `/data` → host `/mnt/user/appdata/fiefdom` |

Or from the command line:

```bash
docker run -d --name fiefdom -p 8080:80 --restart unless-stopped \
  -v /mnt/user/appdata/fiefdom:/data \
  ghcr.io/halvar20000/fiefdom:latest
```

## Where saved games live

**On the server, in `/data`** — map that to a host folder (the template
defaults it to `/mnt/user/appdata/fiefdom`) and your three save slots and every
custom map are stored there as a single `store.json`.

That means:

- They **survive container updates** and recreates, like any appdata.
- They are the **same in every browser and on every device** that reaches the
  server — no more "my saves vanished" when you open a different address.
- Back them up by backing up that folder, same as any other appdata.

Two things worth knowing:

- **Map the volume.** If you leave `/data` unmapped the game still runs, but it
  falls back to storing saves in the browser's `localStorage` — per-browser
  again, and a container recreate can lose them.
- **Upgrading keeps your old saves.** The first time the new server starts
  against an empty `/data`, any saves your browser was already holding are
  copied up to the server automatically.

> Saves are read and written over a small unauthenticated API on the same port
> as the game. Anyone who can reach the game can read or overwrite the saves —
> which is the same trust boundary the game already had. Keep it on your LAN or
> behind your own access control, as below.

## Reaching it from outside your network

A **Cloudflare Tunnel** is the tidy way: no ports forwarded and TLS handled for
you. Point the tunnel at `http://<tower-ip>:8080`.

Nothing in Fiefdom needs WebSockets or any special protocol today — it is
plain HTTP — so any reverse proxy will do.

> If you expose it publicly, remember there are no accounts. Anyone with the
> address can play — and can read or overwrite the shared saves in `/data`, since
> the save API is unauthenticated. Put it behind Cloudflare Access or your
> reverse proxy's auth if that matters to you.

## Requirements

- A browser with **WebGL** support. Anything current will do.
- Roughly **16 MB** of assets downloaded on first visit, then cached. The
  container serves the sprite atlas with long cache headers, so the second
  visit is fast.

## Server load

Essentially none. The simulation, the pathfinding, the rival lords and the
rendering all happen in the visitor's browser. The container is a small Node
server handing over files and reading/writing a few kilobytes of saves, and
will sit near zero CPU.
