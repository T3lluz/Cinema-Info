// Regenerates public/assets/favicon.svg, icons/*.png and apple-touch-icon.png.
// One-off tooling — run from the repo root with:
//   npm install sharp && node scripts/build-icons.mjs
import sharp from "sharp";
import { writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "public", "assets");

// Ticket geometry in a 512x512 viewBox
const x0 = 82, x1 = 430, y0 = 152, y1 = 360, r = 30, n = 27, mid = 256;
const perfX = 334;

const ticketPath = [
  `M ${x0 + r} ${y0}`,
  `H ${x1 - r}`,
  `A ${r} ${r} 0 0 1 ${x1} ${y0 + r}`,
  `V ${mid - n}`,
  `A ${n} ${n} 0 0 0 ${x1} ${mid + n}`,
  `V ${y1 - r}`,
  `A ${r} ${r} 0 0 1 ${x1 - r} ${y1}`,
  `H ${x0 + r}`,
  `A ${r} ${r} 0 0 1 ${x0} ${y1 - r}`,
  `V ${mid + n}`,
  `A ${n} ${n} 0 0 1 ${x0} ${mid - n}`,
  `V ${y0 + r}`,
  `A ${r} ${r} 0 0 1 ${x0 + r} ${y0}`,
  "Z",
].join(" ");

// Play triangle centred in the main (left) ticket section
const tcx = (x0 + perfX) / 2, tcy = mid, tr = 56;
const tri = [
  [tcx + tr, tcy],
  [tcx - tr / 2, tcy - (tr * Math.sqrt(3)) / 2],
  [tcx - tr / 2, tcy + (tr * Math.sqrt(3)) / 2],
];
const triPath =
  `M ${tri[0][0]} ${tri[0][1]} L ${tri[1][0]} ${tri[1][1]} L ${tri[2][0]} ${tri[2][1]} Z`;

const glyph = (scale = 1) => `
  <g transform="rotate(-10 256 256) translate(256 256) scale(${scale}) translate(-256 -256)">
    <path d="${ticketPath}" transform="translate(0 12)" fill="rgba(60,0,6,0.28)"/>
    <path d="${ticketPath}" fill="#ffffff"/>
    <line x1="${perfX}" y1="${y0 + 30}" x2="${perfX}" y2="${y1 - 30}"
      stroke="#c41e2a" stroke-width="11" stroke-linecap="round"
      stroke-dasharray="0.1 26" opacity="0.9"/>
    <path d="${triPath}" fill="#c41e2a" stroke="#c41e2a"
      stroke-width="30" stroke-linejoin="round"/>
  </g>`;

const defs = `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e02b3c"/>
      <stop offset="1" stop-color="#9c0f1b"/>
    </linearGradient>
  </defs>`;

const svg = ({ rounded, scale }) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-label="Cinema Info">
${defs}
  <rect width="512" height="512" ${rounded ? 'rx="115"' : ""} fill="url(#bg)"/>
${glyph(scale)}
</svg>
`;

const roundedSvg = svg({ rounded: true, scale: 1 }); // favicon / any-purpose
const squareSvg = svg({ rounded: false, scale: 1 }); // apple touch (iOS rounds it)
const maskableSvg = svg({ rounded: false, scale: 0.74 }); // safe-zone for masks

await mkdir(`${OUT}/icons`, { recursive: true });
await writeFile(`${OUT}/favicon.svg`, roundedSvg);

const render = (input, size, file) =>
  sharp(Buffer.from(input)).resize(size, size).png().toFile(`${OUT}/${file}`);

await Promise.all([
  render(roundedSvg, 192, "icons/icon-192.png"),
  render(roundedSvg, 512, "icons/icon-512.png"),
  render(maskableSvg, 192, "icons/maskable-192.png"),
  render(maskableSvg, 512, "icons/maskable-512.png"),
  render(squareSvg, 180, "apple-touch-icon.png"),
]);

console.log("icons written");
