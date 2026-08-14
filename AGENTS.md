# Cinema Info

Mobile-friendly PWA showing the Buen kino schedule. See `README.md` for the
full product description and data model.

## Cursor Cloud specific instructions

### What this is

- A **static, dependency-free** vanilla-JS PWA under `public/`: `index.html`,
  `js/app.js`, `css/styles.css`, `sw.js`, plus `data/program.json` (a committed
  snapshot the app reads at runtime via `./data/program.json`). There is **no
  `package.json`, no build step, and no npm install** for the app itself.
- Node scripts in `scripts/` use only Node built-ins (`node:fs`, global
  `fetch`), except `build-icons.mjs` which needs `sharp` (only for regenerating
  the committed PWA icons — not needed to run the app).
- `supabase/functions/dx-web-login/index.ts` is a Deno Edge Function that
  holds the shared DX session for always-on admissions/seat maps (credentials
  in Supabase Vault, never in the static site).

### Running the app (primary dev workflow)

- Serve `public/` as static files, exactly as `README.md` documents:
  `node scripts/dev-server.mjs`, then open `http://127.0.0.1:8080/`.
  That process stays up and reloads the tab when files under `public/`
  change. `python3 -m http.server 8080 --directory public` is the
  no-reload fallback.
- The app works fully offline of any backend because `public/data/program.json`
  is committed; sold counts try to live-update from the DX/eBillett API but the
  schedule renders from the snapshot regardless.
- No lint/test/build tooling is configured in this repo — there is nothing to
  lint or unit-test. "Building" the app is just serving `public/`.
- Do not open localhost or drive the browser to verify UI. The maintainer
  tests on the local server and replies with feedback.

### Refreshing / debugging data (optional, network-dependent)

- `node scripts/fetch-data.mjs` rewrites `public/data/program.json` from Buen's
  API + DX/eBillett. It needs outbound network to `buenkino.no` and `api.dx.no`
  (both reachable from the cloud VM). Restore the committed snapshot afterward
  (`git checkout -- public/data/program.json`) if you only ran it to test.
- `DX_EMAIL=… DX_PASSWORD=… node scripts/dx-session.mjs <path>` is for
  shell debugging against `app.dx.no`. The PWA itself needs no per-user
  DX login — see `.cursor/skills/dx-account/SKILL.md`.

### Publishing (GitHub Pages)

- Production URL: `https://t3lluz.github.io/Cinema-Info/`
- Publish with `.github/workflows/deploy-pages.yml` (push to `main` or
  workflow_dispatch). **Repo admin one-time setup:** Settings → Pages →
  Source must be **GitHub Actions**, not “Deploy from a branch”. Legacy
  branch deploys have been stuck in `deployment_queued`.
- The workflow stages `public/` into the Pages artifact; it does not
  publish `scripts/`, `supabase/`, or `.github/`.
- Every deploy stamps a unique cache-bust token (the short commit SHA)
  into `_site/index.html` and `_site/sw.js` via `scripts/stamp-version.mjs`.
  Do not hand-edit `?v=` or `cinema-info-v…` — a forgotten bump used to
  leave phones on the old CSS/JS after push. Local `public/` placeholders
  are enough for the local server.
