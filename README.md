# Cinema Info

Mobile-friendly schedule for **Buen kino** — same info as the KinoProgram Chrome extension:

- Movies with posters
- Real start / end times (from eBillett)
- Live sold / capacity / occupancy per show, with sold-out and few-left flags
- Progress bar + minutes left for shows playing right now
- Sales statistics (per day, per week, top movies)
- Filter by day — past days stay scrollable as history accumulates
- Finished showings are ticked off and struck through, so a day, a film,
  or a whole week can be read at a glance
- Live: everything on screen re-reads itself every 5 seconds, hands off
- Norwegian/English + light/dark theme
- Optional DX account connection for **admissions** — how many of the sold tickets have been scanned
- …and a **seat map** per showing: which seats are sold, and which of those are already inside

## Staying live

The app runs on a five-second beat. Every beat it redraws whatever the
clock has moved — progress bars, the timeline's now-marker, the line
through a showing that has just finished — and re-reads every figure
that has come due. Nothing needs refreshing by hand; a screen left on at
the box office keeps itself current.

Not everything needs the same beat, so what gets read when depends on
whether it can actually move:

| | Every 5 s | Slower |
| --- | --- | --- |
| **Sold counts** | showings on screen, and anything within 4 hours of its doors | the rest of the programme, every 2 minutes |
| **Check-in counts** | from 15 min before a showing starts to 15 min after it ends | every 45 s while the doors are shut |
| **Seat maps** | the same door window, for charts that are open | every 45 s |
| **The programme itself** | — | every 2 minutes |

So the numbers you are looking at are never more than five seconds old,
while a showing three weeks out — which gains a ticket every few hours,
and there are dozens of them — is not worth a lookup twelve times a
minute. At most **eight** showings are read per beat, urgent ones first,
which comfortably covers a day and puts a ceiling on what the app asks
of DX however much a tab happens to be listing.

A redraw only touches the page when the markup it built differs from
what is already there. Twelve times a minute, almost all of them change
nothing and cost nothing — and the ones that do change leave your scroll
position, your focus and the seat you are hovering exactly where they
were. Beats stop while the tab is in the background and pick straight up
when you come back.

## Admissions (scanned tickets)

With a DX account connected, every show gets an admission strip showing
how many of its sold tickets have been scanned at the door:

| Colour | Meaning |
| --- | --- |
| Green — *Alle inne* | everyone who bought a ticket is inside |
| Amber — *7 mangler* | people are still coming in (*7 møtte ikke* once the film is over) |
| Grey — *Ingen inne ennå* | doors are open, nobody scanned yet |
| Dashed — *Ingen skann-data* | DX is connected but returned no number for this show |

The day header sums the same thing (`104/117 inne`), and the Movies tab
carries a compact badge per showing. Counts are fetched for **previous
days as well**: a show whose count was never fetched is picked up in the
background however old it is, and once a show is well over its count is
final and cached, so reopening the app shows yesterday's numbers without
asking DX again.

## What is done

A showing that is over is not just faded: its time and title are struck
through, a thin **Ferdig** rail runs down the card's left edge, and its
poster goes grey. The same line runs through the finished bars in the
header timeline, through past showings in the Movies tab, and through
the day strip, where a day whose last film has ended is ticked off. Day
headers and movie tiles count it up — *3/5 ferdig*, or *Dagen er ferdig*
once nothing is left. A film that is playing gets the same left rail
with **Nå**.

## Seat map

Every showing with numbered seats gets a seat chart, including when
nothing has sold yet. On phones it folds out from a **Salkart** button
under the card; on tablets and desktops (from 700px) there is room for
it, so it is already open — each hall drawn on a stage of one shape, so
neighbouring showings line up however many rows their auditorium has.
The hall is drawn as DX draws it — screen at the top, row 1 nearest it,
row numbers down both sides — with one square per seat:

| Square | Meaning |
| --- | --- |
| Outline | free |
| Red — *Solgt* | sold; the show has not opened its doors yet |
| Amber — *Ikke skannet* | sold, and that guest has not arrived |
| Green — *Inne* | sold and scanned at the door |
| Blue — *Reservert* | held by a reservation, not yet paid or collected |
| Struck through — *Stengt* | closed off, in the hall map or for this one showing |

Red turns into amber/green the moment scanning becomes relevant, so
before the doors open the chart answers "how is it selling?" and after
they open it answers "who is still missing?". Tap or hover a seat to
read its row and number.

Seats are matched by DX's own `seatId`, so a square is exactly the seat
printed on the ticket. Reserved and blocked seats come from the same
`seatStatuses` DX's own seat map paints, with `/reservations` filling
any hold that statuses omit, so every reserved seat shows as a blue
square on the chart.

The hall geometry is fetched once per auditorium and kept on the device
for a month; opening a chart after that costs one purchase-list lookup,
the same call the admission counts already use. The charts that are open
by screen width are fetched as they scroll into view, so a wide day list
never asks for more halls than you actually reach.

### Connecting

Connect under **Settings → DX-konto** with the same email and password
you use in **DX Check-in** / on [app.dx.no](https://app.dx.no).

Check-in state lives in one place: `app.dx.no`'s purchase list, where
each ticket carries `used` / `usedDateTime` once it has been scanned at
the door, next to the `seatId` it was sold for. `app.dx.no` sends no
CORS headers, so a browser on GitHub Pages cannot read it directly. A
small Supabase Edge Function (`supabase/functions/dx-web-login`) holds
the DX session and returns just what the app draws:

- **Login** completes the official `app.dx.no` → Auth0 (`login.dx.no`) →
  `apiweb/callback` flow and stores the resulting session cookies as an
  opaque token on this device only.
- **Counts** (`action: "scanned"`) are fetched in batches — one call
  covers a dozen events and returns `{ eventId: { scanned, sold } }`,
  counting `used` tickets and leaving refunds out of both totals.
- **Seats** (`action: "seats"`) answers for one event with
  `{ seatId: 1 | 2 | 3 | 4 }` (sold / scanned / held / blocked — holds
  are staff reservations *and* seats sitting in a customer's checkout,
  read from `/seatStatuses` plus `/reservations` for the showing's
  ticket sale, tickets from the purchase list on top)
  plus, the first time a device meets an auditorium, its geometry from
  `/seatMaps/{locationId}`: rows of seats at x/y, map-blocked seats
  flagged, and seat numbers shifted to the ones printed on the tickets.

DX signs a session out after about three days, but the Auth0 SSO cookie
behind it lasts longer; the function renews the session from that cookie
by itself and hands back a fresh token. If you tick **Keep me signed
in**, your password is stored on this device (only) so the app can also
sign in again on its own once even the SSO cookie expires.

### When numbers don't show up

The connected settings panel lists the source, the last sync time, how
many showings have scan data, and whether auto-renew is on. **Test
innslipp** runs one lookup against a real show and prints the bridge
status plus a per-event line (e.g. `92703 → 5/9 used`), so a blank
column can always be explained.

To preview how admissions and the seat map look without a DX account,
open the site with `?previewScanned=1` (example numbers derived from
sold, in a hall generated from the show's capacity).

## Live site

https://t3lluz.github.io/Cinema-Info/

## Install on your phone

The site is a PWA with a proper app icon:

- **iPhone/iPad**: open the site in Safari → Share → *Add to Home Screen*
- **Android**: open the site in Chrome → menu → *Add to Home screen* / *Install app*

It launches full-screen like a native app and keeps working offline with the
last-seen program. Icons are generated by `scripts/build-icons.mjs`
(`npm install sharp && node scripts/build-icons.mjs`).

## How data works

1. `scripts/fetch-data.mjs` snapshots the Buen program into `data/program.json` (Buen’s API blocks browser CORS)
2. `.github/workflows/refresh-program.yml` runs that script nightly and commits when the schedule changed
3. The phone site live-updates **sold counts + real end times** from the DX/eBillett API on its five-second beat
4. With a connected DX account, it also pulls **scanned ticket** counts, for past days as well

The nightly run matters for history: Buen’s API drops a show the moment
it starts, so the script re-asks DX about the showings that have left the
feed over the last two weeks — that keeps their sold counts final and
their DX event ids alive. Skipping runs for longer than that loses those
days. Run it by hand any time with `node scripts/fetch-data.mjs`.

### When a film is taken off the programme

Programming changes, and a showing that is no longer playing has to
leave the app rather than sit there being advertised. Buen's feed lists
every showing from now on, so anything still to come that has left the
feed has been pulled or moved, and it is dropped from the snapshot. For
a showing that has already begun the feed cannot say — it drops those
either way — so DX itself is asked: an event DX no longer has was
deleted, and the showing goes, unless tickets were sold for it, in which
case it played and stays as history. Every removal is named in the
workflow log.

The app keeps its own copy of what it has seen, for offline use and for
check-in numbers, and prunes it against each snapshot the same way, so a
film removed in DX cannot linger on one phone. It also re-reads the
snapshot every couple of minutes while open — a screen left on for days
notices films that were added, moved or dropped — and if DX answers "no
such event" for a showing still to come, that showing is taken out of
the list there and then.

## Local

```bash
node scripts/fetch-data.mjs
python3 -m http.server 8080
```

To read DX by hand while debugging — purchase lists, seat statuses, who
is signed in — `scripts/dx-session.mjs` walks the same login the Edge
Function does and prints any `app.dx.no` path as JSON:

```bash
DX_EMAIL=… DX_PASSWORD=… node scripts/dx-session.mjs /api/v1/auth/
```

Keep those out of the repo: pass them per command, or keep them in a
git-ignored `.env.local`. `.cursor/skills/dx-account/SKILL.md` has the
rest — which endpoints answer what, and the quirks worth knowing.
