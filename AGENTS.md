# Cinema Info

Mobile-friendly PWA showing the Buen kino schedule. See `README.md` for the
full product description and data model.

## Cursor Cloud specific instructions

### What this is

- A **static, dependency-free** vanilla-JS PWA under `public/`: `index.html`,
  ES modules in `js/` (`app.js` entry, `core`, `data`, `ui`, `day`, `movies`,
  `stats`, `settings`, `sheet`, `seats`, `i18n`), `css/styles.css`, `sw.js`,
  plus `data/program.json` (a committed
  snapshot the app reads at runtime via `./data/program.json`). There is **no
  `package.json`, no build step, and no npm install** for the app itself.
- Node scripts in `scripts/` use only Node built-ins (`node:fs`, global
  `fetch`), except `build-icons.mjs` which needs `sharp` (only for regenerating
  the committed PWA icons — not needed to run the app).
- `supabase/functions/dx-web-login/index.ts` and `omdb-lookup/index.ts` are
  Deno request handlers (`export handler`) for seat maps / check-ins and film
  lookups. Credentials never ship in the static site.
- `server/` is the Deno server on t3lluz.com (`server/main.ts`): it serves
  the app at `/CinemaInfo/`, mounts both handlers under `/CinemaInfo/api`,
  prefetches live DX figures (`server/live.ts`, read by `public/js/live.js`
  through `/api/live`) and stores staff feedback for the private hub
  (`server/hub.html`). Typecheck with `deno check server/main.ts`.
  Deployment: `deploy/server/README.md`.

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

### Publishing (GitHub Pages and t3lluz.com)

- Production URLs: `https://t3lluz.com/CinemaInfo/` and
  `https://t3lluz.github.io/Cinema-Info/`. Both publish `main` on their own:
  t3lluz.com through a one-minute poller on the server
  (`deploy/server/update.sh`, same staging as the Pages workflow), Pages
  through the workflow below.
- Publish with `.github/workflows/deploy-pages.yml` (push to `main` or
  workflow_dispatch). **Repo admin one-time setup:** Settings → Pages →
  Source must be **GitHub Actions**, not “Deploy from a branch”. Legacy
  branch deploys have been stuck in `deployment_queued`.
- The workflow stages `public/` into the Pages artifact; it does not
  publish `scripts/`, `supabase/`, or `.github/`.
- Every deploy stamps a unique cache-bust token (the short commit SHA)
  into `_site/index.html`, `_site/sw.js` and every `_site/js/*.js` import
  (`?v=dev` placeholders) via `scripts/stamp-version.mjs`.
  Do not hand-edit `?v=` or `cinema-info-v…` — a forgotten bump used to
  leave phones on the old CSS/JS after push. Local `public/` placeholders
  are enough for the local server.
- The version people see (Settings → Version, e.g. `2.4.0 (a1b2c3d)`) is
  `APP_RELEASE` in `public/js/core.js` plus that build token. Bump
  `APP_RELEASE` with every change that ships: patch for fixes, minor for
  features. Snapshot-only deploys keep the release and change the build.
