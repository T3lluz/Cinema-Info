# Running the bridge on Deno Deploy

Cinema Info's two server-side pieces — `dx-web-login` (seat maps and
check-in counts) and `omdb-lookup` (film metadata) — are plain
`Deno.serve` handlers. Nothing in them is Supabase-specific, so the same
files under `supabase/functions/` run unchanged on Deno Deploy.

## Why you would do this

Supabase bills its Realtime quota per **organisation**, and its Fair Use
Policy restricts **every project in that organisation** at once. In
September 2026 an unrelated project on the same free organisation blew
the 2 M-message Realtime quota, and `cinema-info` — which uses no
Realtime at all — was restricted with it: every bridge call returned
`402`, so seat maps and scan counts vanished while the schedule (read
from the committed `program.json` and the public DX API) kept working.

Giving the bridge its own host means an unrelated project can no longer
take the seat maps down.

## Deploy

Two separate Deno Deploy projects, one per function. Either use the
dashboard's GitHub integration (point it at this repo and set the
entrypoint), or `deployctl`:

```bash
deno install -gArf jsr:@deno/deployctl
```

```bash
deployctl deploy --project=cinema-info-dx --entrypoint=supabase/functions/dx-web-login/index.ts
```

```bash
deployctl deploy --project=cinema-info-omdb --entrypoint=supabase/functions/omdb-lookup/index.ts
```

Check the current flags against <https://docs.deno.com/deploy/> — the
CLI changes faster than this file does.

## Secrets

Set these in each project's dashboard under Settings → Environment
Variables. They are the same names the Supabase deployment already uses.

| Project | Variable | Notes |
| --- | --- | --- |
| `cinema-info-dx` | `DX_EMAIL` | Shared read-only DX account |
| `cinema-info-dx` | `DX_PASSWORD` | Never goes near the browser |
| `cinema-info-omdb` | `OMDB_API_KEY` | Optional; falls back to a public key |

`sharedCredentials()` in `dx-web-login` already prefers these variables
and only falls back to Supabase Vault, so off Supabase the Vault path
simply never runs. Both variables must be set there or the bridge
cannot mint a DX session.

## Point the app at it

Uncomment the `CINEMA_INFO_BRIDGE` block near the bottom of
`public/index.html` and fill in the two `*.deno.dev` origins. `app.js`
reads it at startup and falls back to the Supabase URLs when it is
absent, so the app keeps working either way and switching hosts needs no
change to the bundle.

## One thing to know

Supabase's gateway checks the anon key before a request reaches the
function; Deno Deploy has no such gate, so these endpoints are open to
anyone who finds the URL. In practice that is what they already are —
the anon key ships inside the client bundle on a public GitHub Pages
site — but the bridge does hold a real DX session, so if you want it
closed, add a shared-secret header check at the top of each handler and
send it from `callDxProxy`.

## Going back

Delete the `CINEMA_INFO_BRIDGE` block from `index.html`. The app returns
to the Supabase Edge Functions on the next load.
