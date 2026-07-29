---
name: dx-account
description: Read live data out of DX (app.dx.no / api.dx.no) for Buen kino — sign in with the shared read-only DX account, list what DX still has programmed, and check sold/scanned/seat data for one showing. Use when debugging admissions, seat maps, missing or stale showings, or anything in scripts/fetch-data.mjs or supabase/functions/dx-web-login.
---

# DX account

Cinema Info reads Buen kino's box office out of DX. Two surfaces matter, and
only one of them needs a login.

## Public — no login (this is what CI uses)

`api.dx.no/v3` answers for a single event without any credentials, which is
why `scripts/fetch-data.mjs` can run in GitHub Actions with no secrets:

```bash
curl -s -H 'Accept: application/json' -H 'Referer: https://checkout.ebillett.no/' \
  https://api.dx.no/v3/partners/202/events/92703
```

- `200` → the event exists; `ticketSale` carries `sold`, `reserved`,
  `capacity`, `available`, and `begin` / `end` are the real times.
- **`404` / `410` → the showing has been removed from DX programming.** This
  is the authoritative signal that a show is gone, and the only one available
  for a showing that has already started (Buen's own program feed drops those
  regardless of whether they were cancelled).

Buen's program feed is public too, and is the source for what is programmed
from now on — it lists upcoming showings only:

```bash
curl -s 'https://www.buenkino.no/api/program?includeDocuments=true&first=500'
```

## Signed in — `app.dx.no`

Needed for check-in state (which tickets were scanned) and seat status, since
those live in the partner purchase list. In the browser this goes through
`supabase/functions/dx-web-login`; from a shell use the same flow via
`scripts/dx-session.mjs`.

### Credentials

The DX account is a **read-only** partner login (role
`culture_full_read_only` on partner `202`, Buen). Take it from the
environment — never write it into a file, a commit, a log, or a PR:

```bash
DX_EMAIL=… DX_PASSWORD=… node scripts/dx-session.mjs /api/v1/auth/
```

Cloud agents get these from Cursor Dashboard → Cloud Agents → Secrets as
`DX_EMAIL` and `DX_PASSWORD`, so they are injected into the VM and stay out
of the repo. If they are missing, ask for them to be added there rather than
hardcoding them. On a personal machine, keep them in the shell/`.env.local`
(git-ignored) and export them per command as above.

A login mints a session token (opaque cookie bundle). Reuse it to avoid
logging in repeatedly while debugging — it survives a few days:

```bash
export DX_TOKEN=$(node scripts/dx-session.mjs --token)   # after a login
node scripts/dx-session.mjs /api/v1/partners/202/events?cinema=1
```

`scripts/dx-session.mjs` also exports `openDxSession()` for one-off Node
scripts:

```js
const { openDxSession } = await import("./scripts/dx-session.mjs");
const dx = await openDxSession();          // env credentials or DX_TOKEN
const list = await dx.get("/api/v1/partners/202/purchases?eventId=92703");
```

### Endpoints worth knowing

| Path | What it gives |
| --- | --- |
| `/api/v1/auth/` | who is signed in, and which partners they may read |
| `/api/v1/partners/202/purchases?eventId=…` | every ticket: `used` / `usedDateTime` (scanned), `seatId`, `annulled` (refund) |
| `/api/v1/partners/202/events/{id}` | one event with its `ticketSales` (ids, capacity, `freeSeating`) |
| `/api/v1/partners/202/seatStatuses?ticketSaleIds=…` | per-seat `reserved` / `blocked` for one showing |
| `/api/v1/partners/202/seatMaps/{locationId}` | hall geometry: rows, seat ids, x/y, blocked seats |
| `/api/v1/partners/202/events?cinema=1&search=…&perPage=…&page=…` | the programme list — paged, `search` and `cinema` filter, but **no date filter**, so don't try to walk it by day |

Notes that cost time to rediscover:

- Seat numbers in `seatMaps` are one higher than the number printed on the
  ticket; the offset is derived per hall (lowest number − 1).
- `annulled` tickets are refunds and must not count as sold or hold a seat.
- The `app.dx.no` session cookie lasts about a day, the Auth0 SSO cookie
  behind it about three; the session can be reminted from the SSO cookie
  without a password, which is what `openDxSession()` tries first.
- `app.dx.no` sends no CORS headers, so a browser can never call it
  directly — that is the whole reason the Edge Function exists.
