#!/usr/bin/env -S node --import tsx
// What the code does, and what the docs say about it (28/08).
//
// `docs/plan.md` was declared the source of truth in `CLAUDE.md`, written on 18/08 and never
// touched again. On 28/08 six domains existed in the code that it never mentioned (`concierge`,
// `portability`, `updates`, `integrations`, `channels`, `interviews`), and nothing turned red.
// A document does not compile, so a wrong one never fails loudly.
//
// The dumbest check that works: every domain of `server/src/` and `web/src/` is declared in
// `doc-map.json`, with the wiki page describing it or the reason it has none. It fails on an
// undeclared domain, on a page that does not exist, and on a declaration that no longer applies
// (like `api-pending.json`).
//
// It does not judge whether the page is right; it only makes sure a new domain cannot land without
// someone answering "where is this documented?".
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

/** Folders that are not domains: plumbing and the design system. They have nothing to tell a user,
 *  and asking them for a page would be noise. */
const PLOMBERIE = {
  server: ["http", "shared", "routes"],
  web: ["ui", "api", "app", "i18n"],
};

function domaines(base, exclus) {
  const dir = join(ROOT, base);
  return readdirSync(dir)
    .filter((e) => !exclus.includes(e) && statSync(join(dir, e)).isDirectory())
    .sort();
}

const map = JSON.parse(readFileSync(join(ROOT, "scripts/doc-map.json"), "utf8"));
const trouves = new Map();
for (const d of domaines("server/src", PLOMBERIE.server)) trouves.set(`server/${d}`, true);
for (const d of domaines("web/src", PLOMBERIE.web)) trouves.set(`web/${d}`, true);

const declares = { ...map.documente, ...map.sans_page };
const echecs = [];

// 1. A domain nobody declared: the case that cost ten days.
for (const dom of trouves.keys()) {
  if (!(dom in declares))
    echecs.push(
      `${dom} — undeclared domain. Add its page under "documente", or say under ` +
        `"sans_page" why it has none and who must write it.`
    );
}

// 2. A declaration naming nothing: the domain was renamed or removed.
for (const dom of Object.keys(declares)) {
  if (!trouves.has(dom))
    echecs.push(`${dom} — declared but the domain no longer exists. Remove the line.`);
}

// 3. An announced page that is not there, worse than no link: it suggests the question was handled.
for (const [dom, page] of Object.entries(map.documente)) {
  if (!existsSync(join(ROOT, "docs/wiki", page)))
    echecs.push(`${dom} — the announced page "${page}" does not exist.`);
}

const nbDoc = Object.keys(map.documente).length;
const nbSans = Object.keys(map.sans_page).length;
console.log(`${trouves.size} domain(s) · ${nbDoc} documented · ${nbSans} declared without a page`);

if (echecs.length) {
  console.error(`\n⛔ doc contract broken — ${echecs.length}:\n`);
  for (const e of echecs) console.error(`  · ${e}`);
  console.error("\nThe list lives in scripts/doc-map.json.");
  process.exit(1);
}
console.log("\n✓ contract holds: every domain knows where it is described, or why it is not.");
