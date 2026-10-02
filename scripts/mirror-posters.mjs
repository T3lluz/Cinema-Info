#!/usr/bin/env node
/**
 * Copies every Buen poster thumbnail the snapshot uses into the site as
 * `posters/<asset file name>`, on the same origin as the app.
 *
 *   node scripts/mirror-posters.mjs <site dir>
 *
 * The app still shows posters straight from Buen's Sanity CDN. The copy is
 * for the opening ripple (public/js/ripple.js), which photographs the page
 * and needs to read the pixels of what it photographs: Sanity answers 403
 * to any request that carries a cross-origin `Origin` header, so a browser
 * can display those posters but never read them. Fetched here, without an
 * Origin, they come back fine.
 *
 * Run by the Pages deploy on the staged copy, so nothing lands in the repo.
 * Locally, `node scripts/mirror-posters.mjs public` fills the git-ignored
 * public/posters/ for testing the ripple on the dev server. A poster that
 * fails to download is skipped; the ripple then leaves that one out.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
if (!dir) {
  console.error("usage: node scripts/mirror-posters.mjs <site dir>");
  process.exit(1);
}

const program = JSON.parse(readFileSync(join(dir, "data", "program.json"), "utf8"));
const urls = [
  ...new Set(
    (program.shows || [])
      .map((s) => s.posterUrl)
      .filter((u) => typeof u === "string" && u.startsWith("https://cdn.sanity.io/"))
  ),
];

/** Same rule as `mirroredPoster` in public/js/ripple.js. */
const fileName = (url) => decodeURIComponent(new URL(url).pathname.split("/").pop() || "");

const out = join(dir, "posters");
mkdirSync(out, { recursive: true });

let saved = 0;
let failed = 0;
const queue = [...urls];
async function worker() {
  for (let url = queue.shift(); url; url = queue.shift()) {
    const name = fileName(url);
    if (!/^[\w.-]+$/.test(name)) continue;
    const path = join(out, name);
    if (existsSync(path)) {
      saved++;
      continue;
    }
    try {
      // The thumbnail the app shows, as a JPEG (no Accept: the CDN's
      // auto=format would otherwise pick a format by browser).
      const res = await fetch(url, { headers: { "User-Agent": "cinema-info-mirror" } });
      if (!res.ok) throw new Error(String(res.status));
      writeFileSync(path, Buffer.from(await res.arrayBuffer()));
      saved++;
    } catch (err) {
      failed++;
      console.warn(`mirror-posters: ${name}: ${err.message}`);
    }
  }
}
await Promise.all(Array.from({ length: 6 }, worker));
console.log(`mirrored ${saved}/${urls.length} posters into ${out}${failed ? ` (${failed} failed)` : ""}`);
