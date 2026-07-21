# Cinema Info

Mobile-friendly schedule for **Buen kino** — same info as the KinoProgram Chrome extension:

- Movies with posters
- Real start / end times (from eBillett)
- Sold ticket counts
- Filter by day and screen

## Live site

https://t3lluz.github.io/Cinema-Info/

## How data works

1. `scripts/fetch-data.mjs` snapshots the Buen program into `data/program.json` (Buen’s API blocks browser CORS)
2. The phone site live-updates **sold counts + real end times** from the DX/eBillett API when you open or refresh
3. Re-run the fetch script and push when the movie schedule itself changes

## Local

```bash
node scripts/fetch-data.mjs
python3 -m http.server 8080
```
