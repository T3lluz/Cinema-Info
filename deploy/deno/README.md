# Hosting the bridge

Cinema Info's two server-side pieces — `dx-web-login` (seat maps and
check-in counts) and `omdb-lookup` (film metadata) — are plain
`Deno.serve` handlers. Nothing in them is Supabase-specific, so the same
files under `supabase/functions/` run unchanged anywhere Deno runs.

## Why the bridge exists at all

`app.dx.no` sends no CORS headers, so a browser cannot read it, and the
shared DX account needs a password that must never reach the client. The
bridge holds the session and answers with counts or a whole hall. There
is no database anywhere in Cinema Info — the schedule is the committed
`public/data/program.json`.

## Why it is no longer on Supabase

Supabase bills its Realtime quota per **organisation** and its Fair Use
Policy restricts **every project in that organisation** at once. In
September 2026 an unrelated project blew the free 2 M-message Realtime
quota and `cinema-info` — which has no Realtime code and whose
`supabase_realtime` publication holds zero tables — was restricted with
it. Every bridge call returned `402`, so seat maps and scan counts
vanished while the schedule kept rendering from the snapshot.

## Current deployment: t3lluserver, over Tailscale Funnel

Live at:

- `https://t3lluserver.tail5b2262.ts.net/dx-web-login`
- `https://t3lluserver.tail5b2262.ts.net/omdb-lookup`

Funnel gives a real public HTTPS certificate with no domain to buy and
no ports opened on the router. `public/index.html` points at these
through `window.CINEMA_INFO_BRIDGE`; delete that block and `app.js`
falls back to the Supabase URLs.

| | |
| --- | --- |
| Host | `t3lluserver` (Ubuntu 26.04), user `fredde` |
| Runtime | Deno in `~/.deno`, installed per-user — no root |
| Source | `~/cinema-info-bridge/{dx-web-login,omdb-lookup}.ts` |
| Services | `systemd --user`: `cinema-dx` (8787), `cinema-omdb` (8788) |
| Binding | `127.0.0.1` only; the Funnel is the sole caller |
| Secrets | `~/cinema-info-bridge/dx.env`, mode `600` |
| Restart | `Restart=always`, and `Linger=yes` carries it across reboots |

`DX_EMAIL` and `DX_PASSWORD` are read from `dx.env`. `OMDB_API_KEY` is
optional there — without it `omdb-lookup` falls back to a public key.

### Everyday commands

```bash
systemctl --user status cinema-dx cinema-omdb
```

```bash
journalctl --user -u cinema-dx -n 50 --no-pager
```

```bash
sudo docker exec tailscale tailscale funnel status
```

### Shipping a change to the functions

```bash
scp supabase/functions/dx-web-login/index.ts fredde@100.105.77.87:~/cinema-info-bridge/dx-web-login.ts
```

```bash
ssh fredde@100.105.77.87 'systemctl --user restart cinema-dx'
```

Tailscale itself runs in a `--network=host` Docker container on that
box, which is why the CLI is only reachable through `docker exec` and
why Funnel can proxy to a loopback port.

## PORT and HOST

Both functions read `PORT` and `HOST` from the environment, defaulting
to Deno's own behaviour when unset. That lets the two run side by side
self-hosted while staying deployable to Supabase or Deno Deploy, which
assign the port themselves.

## Alternative: Deno Deploy

The same files deploy unchanged:

```bash
deployctl deploy --project=cinema-info-dx --entrypoint=supabase/functions/dx-web-login/index.ts
```

Set `DX_EMAIL` / `DX_PASSWORD` (and optionally `OMDB_API_KEY`) in the
project's environment variables, then point `CINEMA_INFO_BRIDGE` at the
resulting `.deno.dev` URLs.

## Typechecking

```bash
deno check supabase/functions/dx-web-login/index.ts supabase/functions/omdb-lookup/index.ts
```

## One thing to know

Supabase's gateway checked the anon key before a request reached the
function. Funnel has no such gate, so these endpoints are open to anyone
who has the URL — as they effectively already were, since the anon key
ships inside a public GitHub Pages bundle. The bridge does hold a real
DX session, so if you want it closed, add a shared-secret header check
at the top of each handler and send it from `callDxProxy`.
