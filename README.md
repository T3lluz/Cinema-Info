# Cinema Info

Mobile-friendly schedule for **Buen kino** — same info as the KinoProgram Chrome extension:

- Movies with posters
- Real start / end times (from eBillett)
- Sold ticket counts
- Filter by day and screen

## Live site

https://t3lluz.github.io/Cinema-Info/

## How data works

1. `scripts/fetch-data.mjs` snapshots the Buen program (no browser CORS) into `data/program.json`
2. GitHub Actions refreshes that file about every 15 minutes
3. The phone site also live-updates sold counts + end times from the DX/eBillett API when you open or refresh

## Local

```bash
node scripts/fetch-data.mjs
# open index.html via any static server, e.g.
python3 -m http.server 8080
```
