// Renders `public/icon.svg` to PNG at the sizes an operating system asks for.
//
// The PNGs are derived: the SVG is the source of truth, and it can be read, diffed and fixed. A PNG
// made by hand becomes untouchable within a week because nobody knows where it came from.
//
// Chromium because the repository already has it (Playwright, for `make responsive`) and rasterising
// an SVG is what a browser does best; an image library for files regenerated three times a year
// would be one more dependency to audit.
//
// Run again after any SVG change: `node web/scripts/make-icons.mjs`. The PNGs are committed, so
// neither the build nor CI needs Chromium.
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, "..", "public");
const svg = readFileSync(join(publicDir, "icon.svg"), "utf8");

// 192 and 512 are the sizes the manifest spec asks for; 180 is what iOS takes for the home screen
// (`apple-touch-icon`), and iOS does not accept SVG.
const SIZES = [180, 192, 512];

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
for (const size of SIZES) {
  await page.setViewportSize({ width: size, height: size });
  // An HTML page around the SVG, not the SVG alone: opened directly, Chromium honours its
  // `width`/`height` (512) and small captures get a corner of the icon. The sized `<img>` sets the
  // scale. `setContent` rather than a URL: no request, so no race between render and capture.
  const src = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  await page.setContent(
    `<body style="margin:0"><img src="${src}" width="${size}" height="${size}"></body>`,
  );
  await page.waitForFunction(() => document.images[0]?.complete === true);
  const png = await page.screenshot({ omitBackground: true });
  const name = size === 180 ? "apple-touch-icon.png" : `icon-${size}.png`;
  writeFileSync(join(publicDir, name), png);
  console.log(`${name} — ${png.length} bytes`);
}
await browser.close();
