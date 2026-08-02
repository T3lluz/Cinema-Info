# Cinema Info

Mobile-friendly PWA showing the Buen kino schedule. See `README.md` for the
full product description and data model.

## Cursor Cloud specific instructions

### What this is

- A **static, dependency-free** vanilla-JS PWA: `index.html`, `app.js`,
  `styles.css`, `sw.js`, plus `data/program.json` (a committed snapshot the app
  reads at runtime via `./data/program.json`). There is **no `package.json`,
  no build step, and no npm install** for the app itself.
- Node scripts in `scripts/` use only Node built-ins (`node:fs`, global
  `fetch`), except `build-icons.mjs` which needs `sharp` (only for regenerating
  the committed PWA icons — not needed to run the app).
- `supabase/functions/dx-web-login/index.ts` is a Deno Edge Function used only
  for the optional DX admissions/seat-map feature.

### Running the app (primary dev workflow)

- Serve the repo root as static files, exactly as `README.md` documents:
  `python3 -m http.server 8080`, then open `http://localhost:8080/`.
- The app works fully offline of any backend because `data/program.json` is
  committed; sold counts try to live-update from the DX/eBillett API but the
  schedule renders from the snapshot regardless.
- No lint/test/build tooling is configured in this repo — there is nothing to
  lint or unit-test. "Building" the app is just serving the static files.

### Refreshing / debugging data (optional, network-dependent)

- `node scripts/fetch-data.mjs` rewrites `data/program.json` from Buen's API +
  DX/eBillett. It needs outbound network to `buenkino.no` and `api.dx.no`
  (both reachable from the cloud VM). Restore the committed snapshot afterward
  (`git checkout -- data/program.json`) if you only ran it to test.
- `DX_EMAIL=… DX_PASSWORD=… node scripts/dx-session.mjs <path>` and the DX
  admissions/seat features require real DX credentials (not in the repo).
  See `.cursor/skills/dx-account/SKILL.md`.
