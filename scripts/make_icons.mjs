/**
 * MIZIGO — icon set generator.
 * Rasterizes the route-M mark (public/logo.svg) into favicon / PWA / OG images.
 * Run: node scripts/make_icons.mjs
 */
import sharp from "sharp";
import { mkdirSync, writeFileSync } from "node:fs";

const INK = "#17181C";
const BRAND = "#E8590C";
const PAPER = "#F7F6F3";

// mark svg (tile + glyph), tileSize = drawn size
function markSvg({ size, radiusRatio = 9 / 32, pad = 0, bg = INK, fg = "#FFFFFF" } = {}) {
  const s = size, r = s * radiusRatio;
  const k = s / 32; // glyph scale
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect x="${pad}" y="${pad}" width="${s - 2 * pad}" height="${s - 2 * pad}" rx="${r}" fill="${bg}"/>
  <g transform="translate(${pad} ${pad}) scale(${(s - 2 * pad) / 32})">
    <g stroke="${fg}" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M8.5 22.7 L8.5 9.3 L13.3 16"/>
      <path d="M18.7 16 L23.5 9.3 L23.5 22.7"/>
    </g>
    <circle cx="16" cy="18.2" r="2.9" fill="${BRAND}"/>
  </g>
</svg>`;
}

// maskable: glyph inside the 80% safe zone, full-bleed bg
function maskableSvg(size) {
  return markSvg({ size, radiusRatio: 0, pad: 0, bg: INK, fg: "#FFFFFF" }).replace(
    /<rect[^>]*>/,
    `<rect x="0" y="0" width="${size}" height="${size}" fill="${INK}"/>`
  ).replace(
    /<g transform="translate\(0 0\) scale\([^)]*\)">/,
    `<g transform="translate(${size * 0.1} ${size * 0.1}) scale(${size * 0.8 / 32})">`
  );
}

// 1200x630 OG card: ink field, big mark left, wordmark right
function ogSvg() {
  const w = 1200, h = 630;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${INK}"/>
  <rect x="96" y="158" width="314" height="314" rx="88" fill="${INK}" stroke="#2E3036" stroke-width="2"/>
  <g transform="translate(112 174) scale(8.94)">
    <g stroke="#FFFFFF" stroke-width="2.7" stroke-linecap="round" stroke-linejoin="round" fill="none">
      <path d="M8.5 22.7 L8.5 9.3 L13.3 16"/>
      <path d="M18.7 16 L23.5 9.3 L23.5 22.7"/>
    </g>
    <circle cx="16" cy="18.2" r="2.9" fill="${BRAND}"/>
  </g>
  <text x="492" y="335" font-family="DejaVu Sans, Arial, sans-serif" font-size="112" font-weight="bold" letter-spacing="-4" fill="#FFFFFF">MIZIGO</text>
  <text x="496" y="400" font-family="DejaVu Sans, Arial, sans-serif" font-size="34" font-weight="bold" fill="#8B8D94">Move anything. Anywhere in Nairobi.</text>
  <rect x="496" y="440" width="26" height="6" rx="3" fill="${BRAND}"/>
</svg>`;
}

const jobs = [
  ["public/favicon-16.png", 16], ["public/favicon-32.png", 32],
  ["public/apple-touch-icon.png", 180],
  ["public/icon-192.png", 192], ["public/icon-512.png", 512],
].map(([out, size]) =>
  sharp(Buffer.from(markSvg({ size }))).png().toFile(out).then(() => console.log("✓", out))
);

jobs.push(
  sharp(Buffer.from(maskableSvg(512))).png().toFile("public/icon-maskable-512.png")
    .then(() => console.log("✓ public/icon-maskable-512.png")),
);

// favicon.ico (16+32 multi-size)
jobs.push(
  Promise.all([
    sharp(Buffer.from(markSvg({ size: 16 }))).png().toBuffer(),
    sharp(Buffer.from(markSvg({ size: 32 }))).png().toBuffer(),
  ]).then(([p16, p32]) => {
    // ICO container: header(6) + 2 entries(16) + images
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(2, 4);
    const entry = (img, i, offset) => {
      const e = Buffer.alloc(16);
      e.writeUInt8(img ? 16 : 0, 0); e.writeUInt8(0, 1);
      e.writeUInt16LE(1, 2); e.writeUInt16LE(32, 4);
      e.writeUInt32LE(img.length, 8); e.writeUInt32LE(offset, 12);
      return e;
    };
    const off1 = 6 + 32;
    const ico = Buffer.concat([header, entry(p16, 1, off1), entry(p32, 2, off1 + p16.length), p16, p32]);
    writeFileSync("public/favicon.ico", ico);
    console.log("✓ public/favicon.ico");
  })
);

jobs.push(
  sharp(Buffer.from(ogSvg())).png({ quality: 90 }).toFile("public/og.png")
    .then(() => console.log("✓ public/og.png"))
);

await Promise.all(jobs);
mkdirSync("public", { recursive: true });
console.log("done");
