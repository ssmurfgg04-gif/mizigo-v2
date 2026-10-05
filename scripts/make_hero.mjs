/**
 * Optimize hero backgrounds → light webp assets.
 * Targets: desktop ≤ 240KB, mobile ≤ 200KB.
 */
import sharp from "sharp";
import { statSync } from "node:fs";

async function go() {
  // desktop: 1344x768 → 1440w is upscaling; keep 1344w, trim to 2.2:1 cinematic
  await sharp("/tmp/hero_desktop2.png")
    .resize({ width: 1344 }).blur(1.1)
    .webp({ quality: 72, effort: 6 })
    .toFile("public/hero-desktop.webp");

  // mobile: 768x1344 → 720w to trim bytes (retina-ish on most phones at CSS ~360-400px)
  await sharp("/tmp/hero_mobile.png")
    .resize({ width: 720 })
    .webp({ quality: 72, effort: 6 })
    .toFile("public/hero-mobile.webp");

  for (const f of ["public/hero-desktop.webp", "public/hero-mobile.webp"]) {
    const kb = statSync(f).size / 1024;
    const meta = await sharp(f).metadata();
    console.log(`${f}: ${kb.toFixed(0)}KB ${meta.width}x${meta.height}`);
  }
}
go();
