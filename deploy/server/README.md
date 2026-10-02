# Cinema Info on t3lluz.com

The app runs at **https://t3lluz.com/CinemaInfo/** as well as on GitHub
Pages. Both copies are the same files from `main`, and both talk to the
same server, which lives on t3lluserver next to the rest of t3lluz.com.

```
                 Cloudflare tunnel                 tailnet (Caddy)
 public ──────── t3lluz.com/CinemaInfo* ─┐   ┌── t3lluz.com/CinemaInfo*  ── Fredde's devices
                                         ▼   ▼   feedback.t3lluz.com
 GitHub Pages ── /CinemaInfo/api/* ──► cinema-info (Deno, server/main.ts)
                                         :8080  app, API      (public)
                                         :8081  feedback hub  (Caddy only)
```

## What the server does

- **Serves the app** under `/CinemaInfo/`, built from `main` by `update.sh`
  exactly as the Pages workflow builds it (stamped build token, mirrored
  posters).
- **Prefetches everything live** (`server/live.ts`). It reads DX on
  everyone's behalf, on the same windows the app uses:

  | | How often |
  | --- | --- |
  | Seat charts and check-ins, doors open | every 6 s |
  | Seat charts, today | every minute |
  | Seat charts, next two days / next two weeks | 3 min / 10 min |
  | Sold counts, within 4 h of the doors | every 6 s |
  | Sold counts, rest of the programme | every 2 min |
  | Check-in history for past showings | once, in the background |

  The app collects all of it for today and the day on screen in one GET,
  `/CinemaInfo/api/live`, answered from memory (with an ETag, so an
  unchanged answer is a 304). Whatever it covers is stamped as just read,
  so the app's own per-showing reads only go out for what it left out. If
  the server does not answer, the app waits 30 s and reads DX itself.
- **Runs the DX bridge** (`supabase/functions/dx-web-login`) in-process at
  `/CinemaInfo/api/dx`. `seats` and `scanned` answer from the prefetch
  cache when it is fresh enough. The shared DX session is never handed to
  browsers any more.
- **Runs film lookups** (`supabase/functions/omdb-lookup`) at
  `/CinemaInfo/api/omdb`.
- **Takes feedback** at `/CinemaInfo/api/feedback` (6 notes per address
  per 10 minutes) and stores it in `data/feedback.json`.
- **Serves the feedback hub** on its admin port. Caddy proxies
  `feedback.t3lluz.com` to it, which only resolves on the tailnet, and the
  port refuses any address outside Caddy's network besides.

## Layout on the server

| | |
| --- | --- |
| `~/docker/cinema-info/repo` | deploy checkout of `main` (do not work in it) |
| `~/docker/cinema-info/build/current` | the live site, a symlink to `site-<sha>` |
| `~/docker/cinema-info/data` | `feedback.json`, `live-cache.json` (hall layouts, final check-ins) |
| `~/docker/cinema-info/.env` | `DX_EMAIL`, `DX_PASSWORD`, `OMDB_API_KEY`, `TUNNEL_TOKEN` (mode 600) |
| `~/docker/caddy` | Caddy routes `/CinemaInfo` and `feedback.`, plus the `split-dns` responder |
| `~/.config/systemd/user/cinema-info-deploy.{service,timer}` | the deploy poller |

## Deploying

Merge to `main`. Within a minute `cinema-info-deploy.timer` notices, and
`update.sh` resets the checkout, builds the site into a new directory,
and swaps the `current` symlink. Server code changes (`server/`,
`supabase/functions/`) restart the container. The bot's snapshot commits
deploy the same way, so t3lluz.com never lags GitHub Pages.

```bash
journalctl --user -u cinema-info-deploy -n 20 --no-pager   # what deployed
~/docker/cinema-info/repo/deploy/server/update.sh --force  # rebuild now
docker logs -f cinema-info                                 # the server
curl -s https://t3lluz.com/CinemaInfo/api/health           # prefetch state
```

## The public URL

Public DNS for `t3lluz.com` used to point at the proxy's tailnet address,
so nothing on it was reachable from outside. Making `/CinemaInfo` public
without exposing the dashboard takes two halves:

1. **Tailnet devices answer t3lluz.com themselves.** The `split-dns`
   container in `~/docker/caddy` answers every `t3lluz.com` name with
   `100.70.193.66`, and a Tailscale split-DNS entry sends tailnet
   devices to it. For them nothing changes, whatever public DNS says.
2. **Public DNS for the apex points at a Cloudflare tunnel**, whose only
   route is `t3lluz.com/CinemaInfo*` to `cinema-info:8080`. Every other
   path on the apex gets a 404 from Cloudflare and never reaches this
   box. `*.t3lluz.com` keeps its tailnet-only record.

`go-public.sh` does the second half, and refuses to start until the first
is in place. It needs a Cloudflare token that can edit tunnels; the DNS
token Caddy uses gains that with one extra permission (Account,
Cloudflare Tunnel, Edit). `go-public.sh --rollback` undoes the DNS change.

## Retired: the Funnel bridge

`deploy/deno/README.md` describes the previous setup, two `systemd --user`
Deno services behind Tailscale Funnel. Funnel is off for that node, so
the bridge only answered on the tailnet and staff off it got no seat
maps. The server
above replaces it; `cinema-dx` and `cinema-omdb` are stopped and disabled.
