# Installing Fiefdom on Unraid

Fiefdom runs in your browser. The container is a small web server handing over
static files, keeping your saves, and — when you want to play with other people
— holding the accounts and passing messages between players. There is **no
database and no API key**: set a port, add a folder for your saves, start it,
and play. An account is only needed to play against other people.

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
custom map are stored there, under `users/`: one file for the shared profile,
and one per registered player.

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

## Accounts, and playing together

By default anyone who reaches the server can play alone, and everybody shares
one set of save slots. Registering an account changes both of those things:

- **your saves become your own**, kept under `/data/users/` and invisible to
  everyone else;
- **you can join a multiplayer match**, which needs a name for the other
  players to see.

There is nothing to configure. Click **MULTIPLAYER** on the title screen and
the game asks for a username, an email address and a password. The email is an
identifier and a way to reach a player — **no mail is ever sent**, there is no
verification link to wait for and no SMTP server to set up. Passwords are
stored as a scrypt hash; the session is a cookie the server signs with a key it
keeps in `/data`.

> **Back up `/data`.** It now holds `accounts.json` and `session-secret`
> alongside the saves. Losing the folder means everyone registers again.

Single-player never asks for any of this. It works exactly as it did.

### Playing a match

One player creates the match and is its host; the others join from the list.
The host picks:

| Setting | What it does |
|---|---|
| **Map** | Any shipped map, or one drawn in the editor. |
| **Sides** | *Every lord for himself*, or *Allies*. Either way each player can change their own team number in the lobby, so 2v2 is a matter of two people picking the same number. |
| **Players** | Two to four. |
| **AI lords** | Up to four more castles, played by the same AI as single-player, at the difficulty the host sets. |

When everyone has pressed **READY**, the host places one keep per player on the
map — the same placement screen a solo game uses — and the match begins.

Things worth knowing:

- **A match runs at one speed.** Pause and fast-forward are off: each player's
  browser runs its own castle, so one player at 3× would simply grow three
  times as fast as the man he is fighting. **Esc** still opens the menu, but the
  war goes on behind it.
- **Matches cannot be saved.** A save is one castle's worth of a world three
  other people are also living in, so the slots are hidden during a match.
- **A dropped connection keeps your seat.** The server holds it, the client
  redials, and your castle keeps running throughout — what stops is knowing what
  the others are doing. **Closing the tab is leaving**, though: the world is in
  the browser, and reloading the page starts over.
- **Press Enter to talk** during a match. The panel on the left also carries a
  connection light, so "nobody is doing anything" and "the line is down" do not
  look alike.

### How much the server does

Still almost nothing. Every castle is simulated by its own player's browser,
and the server passes messages between them without looking inside — a few tens
of kilobytes a second for a four-player match. It does not simulate the game.

The honest consequence of that design: **a player who edits their own client
could lie about their own castle.** There is no server-side referee to catch it.
For a game you host for people you know, that is the same trust boundary the
save API already had; it is not a game to run for strangers.

## Reaching it from outside your network

A **Cloudflare Tunnel** is the tidy way: no ports forwarded and TLS handled for
you. Point the tunnel at `http://<tower-ip>:8080`.

**Multiplayer needs WebSockets.** A Cloudflare Tunnel passes them through with
no configuration; so does Caddy, and so does Traefik. nginx does **not** by
default — it needs the upgrade headers forwarded:

```nginx
location / {
    proxy_pass http://<tower-ip>:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Without those, single-player works and the lobby says "connection lost —
retrying", which is a confusing way to discover a proxy setting.

> If you expose it publicly, anyone with the address can play a single-player
> game and can read or overwrite the **shared** save profile, since that profile
> is unauthenticated by design. Registered players' saves are private to them.
> Put the whole thing behind your reverse proxy's auth if even that matters.

## Requirements

- A browser with **WebGL** support. Anything current will do.
- Roughly **16 MB** of assets downloaded on first visit, then cached. The
  container serves the sprite atlas with long cache headers, so the second
  visit is fast.

## Server load

Essentially none. The simulation, the pathfinding, the rival lords and the
rendering all happen in the visitor's browser — in a multiplayer match too,
where each player's browser runs its own castle and the server only relays what
they say about it. The container is a small Node server handing over files,
reading and writing a few kilobytes of saves, and forwarding a few tens of
kilobytes a second per match. It will sit near zero CPU.
