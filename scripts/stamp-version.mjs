#!/usr/bin/env node
/**
 * Rewrites the PWA cache-bust tokens in index.html and sw.js so a new
 * deploy cannot be served from an old service-worker cache or a sticky
 * GitHub Pages asset URL. The committed files keep placeholder integers;
 * the deploy workflow stamps the live site with the commit SHA.
 *
 *   node scripts/stamp-version.mjs <dir> <version>
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2];
const version = process.argv[3];
if (!dir || !version || !/^[A-Za-z0-9._-]+$/.test(version)) {
  console.error("usage: node scripts/stamp-version.mjs <dir> <version>");
  process.exit(1);
}

function stamp(file, replacements) {
  const path = join(dir, file);
  let text = readFileSync(path, "utf8");
  for (const { re, to, label } of replacements) {
    const next = text.replace(re, to);
    if (next === text) {
      console.error(`stamp-version: ${label} not found in ${path}`);
      process.exit(1);
    }
    text = next;
  }
  writeFileSync(path, text);
}

stamp("index.html", [
  {
    re: /css\/styles\.css\?v=[^"'\s]+/g,
    to: `css/styles.css?v=${version}`,
    label: "styles.css?v=",
  },
  {
    re: /js\/app\.js\?v=[^"'\s]+/g,
    to: `js/app.js?v=${version}`,
    label: "app.js?v=",
  },
]);

stamp("sw.js", [
  {
    re: /const CACHE = "cinema-info-v[^"]+";/,
    to: `const CACHE = "cinema-info-v${version}";`,
    label: "CACHE",
  },
  {
    re: /\.\/css\/styles\.css\?v=[^"'\s]+/,
    to: `./css/styles.css?v=${version}`,
    label: "precache styles.css?v=",
  },
  {
    re: /\.\/js\/app\.js\?v=[^"'\s]+/,
    to: `./js/app.js?v=${version}`,
    label: "precache app.js?v=",
  },
]);

console.log(`stamped ${version} into ${dir}`);
