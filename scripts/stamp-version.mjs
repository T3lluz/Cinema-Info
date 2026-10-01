#!/usr/bin/env node
/**
 * Rewrites the PWA cache-bust tokens so a new deploy cannot be served
 * from an old service-worker cache or a sticky GitHub Pages asset URL.
 *
 * The committed files carry `?v=dev` on every stylesheet, script and
 * module import, and `cinema-info-vdev` as the cache name; the deploy
 * workflow stamps the live copy with the commit SHA:
 *
 *   node scripts/stamp-version.mjs <dir> <version>
 *
 * Modules import each other as `./core.js?v=dev`. Every one of those
 * must carry the same token, or the browser loads two copies of a
 * module (and two copies of the app's state) — so this refuses to stamp
 * if any relative import is missing it.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const version = process.argv[3];
if (!dir || !version || !/^[A-Za-z0-9._-]+$/.test(version)) {
  console.error("usage: node scripts/stamp-version.mjs <dir> <version>");
  process.exit(1);
}

const ASSET_RE = /(\.(?:js|css))\?v=[A-Za-z0-9._-]+/g;
const jsDir = join(dir, "js");
const files = [
  "index.html",
  "sw.js",
  ...readdirSync(jsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => join("js", f)),
];

let problems = 0;
for (const file of files) {
  const path = join(dir, file);
  const text = readFileSync(path, "utf8");

  if (file.startsWith("js")) {
    for (const m of text.matchAll(/\bfrom\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      if (!/\.js\?v=/.test(m[1])) {
        console.error(`stamp-version: ${file} imports ${m[1]} without ?v=`);
        problems++;
      }
    }
  }

  let next = text.replace(ASSET_RE, `$1?v=${version}`);
  if (file === "sw.js") {
    const named = next.replace(/const CACHE = "cinema-info-v[^"]*";/, `const CACHE = "cinema-info-v${version}";`);
    if (named === next && !next.includes(`cinema-info-v${version}`)) {
      console.error("stamp-version: CACHE name not found in sw.js");
      problems++;
    }
    next = named;
  }
  if ((file === "index.html" || file === "sw.js") && next === text) {
    console.error(`stamp-version: no ?v= tokens found in ${file}`);
    problems++;
  }
  writeFileSync(path, next);
}

if (problems) process.exit(1);
console.log(`stamped ${version} into ${files.length} files in ${dir}`);
