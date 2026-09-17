// Renders the brand PNGs from `public/icon.svg`, the only source of truth.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = resolve(HERE, "../public");
const SVG = readFileSync(resolve(PUBLIC, "icon.svg"), "utf8");

// The maskable and iOS icons have no rounded corner: the system applies its own mask.
const SQUARE = SVG.replace('rx="112" ', "");

// The badge is not an icon. Android renders it as a silhouette, keeping only alpha and tinting it
// itself, so a filled square becomes a blob. It gets the three masses in white on transparent,
// without the floor.
const BADGE = SVG.replace(/<rect width="512"[^/]*\/>/, "")
  .replaceAll(/fill="var\(--(mass|agent)[^"]*"/g, 'fill="#ffffff"')
  // Tight on the glyph: without the floor, the icon's viewBox would leave half the thumbnail empty
  // and the silhouette would be twice too small in the status bar.
  .replace('viewBox="0 0 512 512"', 'viewBox="136 118 240 264"');

// `bare` = transparent corners. The rounded icons need it, otherwise Chromium's canvas (black in
// dark mode) fills the corners. The square ones must not: iOS renders a transparent
// `apple-touch-icon` black.
const TARGETS = [
  { file: "icon-192.png", size: 192, svg: SVG, bare: true },
  { file: "icon-512.png", size: 512, svg: SVG, bare: true },
  { file: "icon-512-maskable.png", size: 512, svg: SQUARE, bare: false },
  { file: "apple-touch-icon.png", size: 180, svg: SQUARE, bare: false },
  { file: "badge.png", size: 96, svg: BADGE, bare: true },
];

const browser = await chromium.launch();
try {
  for (const { file, size, svg, bare } of TARGETS) {
    // The SVG carries both palettes; a home screen icon is rendered once at install and follows no
    // theme afterwards, so dark is a choice made here.
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      colorScheme: "dark",
    });
    await page.setContent(
      `<style>html,body{margin:0;padding:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`,
      { waitUntil: "load" },
    );
    const shot = await page.screenshot({ omitBackground: bare });
    mkdirSync(PUBLIC, { recursive: true });
    writeFileSync(resolve(PUBLIC, file), shot);
    console.log(`${file} — ${size}×${size} — ${(shot.length / 1024).toFixed(1)} kB`);
    await page.close();
  }
} finally {
  await browser.close();
}
