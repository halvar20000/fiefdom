# Installing Fiefdom on Unraid

Fiefdom runs entirely in your browser. The container is only a web server
handing over static files, so there is **no database, no API key and no account
to create** — set a port, start it, and play.

## Community Applications

1. **Apps** → search for **fiefdom** → **Install**.
2. Set **WebUI Port** if 8080 is already taken on your server.
3. **Apply**, then click the container's **WebUI**.

That is the whole setup.

## Without Community Applications

**Docker** → **Add Container** → **Template: none**, then:

| Field | Value |
|---|---|
| Name | `fiefdom` |
| Repository | `ghcr.io/halvar20000/fiefdom:latest` |
| Network Type | `Bridge` |
| WebUI | `http://[IP]:[PORT:8080]` |
| Port | container `80` → host `8080` |

Or from the command line:

```bash
docker run -d --name fiefdom -p 8080:80 --restart unless-stopped \
  ghcr.io/halvar20000/fiefdom:latest
```

## Where saved games live

**In your browser, not on the server.** Fiefdom keeps its three save slots in
`localStorage` on whichever machine you play from.

That means:

- Saves do **not** follow you between devices or between browsers.
- Clearing site data for the address you play on **deletes them**.
- Nothing in `/mnt/user/appdata` needs backing up, because there is nothing
  there — which is also why this container needs no volume.

If you want saves that follow you around, that needs a server-side save API;
it is not built yet. Play from one browser in the meantime.

## Reaching it from outside your network

A **Cloudflare Tunnel** is the tidy way: no ports forwarded and TLS handled for
you. Point the tunnel at `http://<tower-ip>:8080`.

Nothing in Fiefdom needs WebSockets or any special protocol today — it is
plain HTTP — so any reverse proxy will do.

> If you expose it publicly, remember there are no accounts. Anyone with the
> address can play. There is nothing to steal (saves are in the visitor's own
> browser), but it is your bandwidth.

## Requirements

- A browser with **WebGL** support. Anything current will do.
- Roughly **16 MB** of assets downloaded on first visit, then cached. The
  container serves the sprite atlas with long cache headers, so the second
  visit is fast.

## Server load

Essentially none. The simulation, the pathfinding, the AI lord and the
rendering all happen in the visitor's browser. The container is nginx serving
files and will sit near zero CPU.
