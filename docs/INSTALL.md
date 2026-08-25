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

## Separate logins, separate saves (optional)

By default everyone who reaches the server shares one set of save slots. If more
than one person plays — say you and your kids — you can give each their own
private saves, gated by a login, using **Cloudflare Access** (free, part of
Cloudflare Zero Trust). Cloudflare does the actual login at the edge; the game
never sees a password.

**1. Put Access in front of the hostname.**
In the Cloudflare **Zero Trust** dashboard → **Access → Applications → Add an
application → Self-hosted**. Set the application domain to your game's hostname
(e.g. `fiefdom.example.com`). Add a **policy** that *allows* the emails who may
play (an "Emails" rule listing you and your family). Save.

**2. Find two values** from that application's **Overview**:
- your **team domain** — the part before `.cloudflareaccess.com` in your team's
  URL (e.g. `smarthomeworld68`);
- the **Application Audience (AUD)** tag.

**3. Give them to the container** as environment variables (the Unraid template
has fields for both):

| Variable | Value |
|---|---|
| `ACCESS_TEAM_DOMAIN` | your team domain, e.g. `smarthomeworld68` |
| `ACCESS_AUD` | the AUD tag from step 2 |

```bash
docker run -d --name fiefdom -p 8080:80 --restart unless-stopped \
  -v /mnt/user/appdata/fiefdom:/data \
  -e ACCESS_TEAM_DOMAIN=smarthomeworld68 \
  -e ACCESS_AUD=<your-aud-tag> \
  ghcr.io/halvar20000/fiefdom:latest
```

That is it. Now each person, after logging in through Cloudflare, gets their own
save slots and custom maps — the server verifies Cloudflare's signed token and
keeps each email's data in its own file under `/data/users/`. The title screen
shows who is signed in, with a **Log out** link.

Good to know:

- **The server only trusts a real, Cloudflare-signed token.** It checks the
  signature against Cloudflare's keys, plus the expiry, issuer and AUD — a forged
  or copied header does not work. Set both variables; the AUD is what ties tokens
  to *this* app rather than any app on your team.
- **On the LAN, bypassing Cloudflare, there is no login** — those visits share a
  single `local` profile. That `local` profile is also where your *existing*
  shared saves move to when you upgrade, so they are not lost; reach them by
  playing over the LAN, or start fresh under your login.
- Leave the two variables unset and nothing changes: one shared profile, as
  before.

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
