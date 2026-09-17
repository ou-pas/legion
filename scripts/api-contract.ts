#!/usr/bin/env -S node --import tsx
// What the screen calls, and what the server serves (26/08).
//
// A front-end task ships the call, a server task ships the route, and nothing forces the second to
// exist before the first. On 26/08 the Concierge panel reached `main` with a `POST /api/concierge`
// nobody served, because the endpoint's PR stayed open two days. Not the first time:
// `feat(environments): the screen from #38 finally has a server behind it`, a month earlier.
//
// `tsc` cannot see it: the two halves share no type, only a string.
//
// The script guesses nothing. It reads `/api/...` literals on both sides, replaces each dynamic
// segment with `:p`, and compares two sets.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;

function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (e === "node_modules" || e === "dist" || e.startsWith(".")) continue;
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(e)) out.push(p);
  }
  return out;
}

/**
 * Reads the literal starting at `i` (single, double or backtick quote) and returns its text with
 * interpolations replaced by `:p`.
 *
 * A scanner, not a regex: a `${}` may hold braces, parentheses and quotes
 * (`/api/wiki/${slug.split("/").pop()}`). The first version cut at the first `}` and returned
 * truncated paths: twenty-three false positives, an unusable check.
 */
function readLiteral(src, i) {
  const quote = src[i];
  if (quote !== "`" && quote !== '"' && quote !== "'") return null;
  let out = "", j = i + 1;
  while (j < src.length) {
    const c = src[j];
    if (c === "\\") { out += src[j + 1]; j += 2; continue; }
    if (c === quote) return { text: out, end: j };
    if (quote === "`" && c === "$" && src[j + 1] === "{") {
      let depth = 1; j += 2;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      out += ":p";
      continue;
    }
    if (c === "\n" && quote !== "`") return null;
    out += c; j++;
  }
  return null;
}

/** `/api/tasks/${taskId}/diff` and `/api/tasks/:id/diff` become the same path. The query string is
 *  dropped: it is not part of the routed path. */
function normalize(path) {
  return path
    .replace(/\?.*$/, "")
    // Hono parameter constraint: `/api/wiki/:slug{.+}` is the route `/api/wiki/:p`.
    .replace(/\{[^}]*\}/g, "")
    // An interpolation glued to the previous segment is a query, not a segment:
    // `/api/goals${projectId ? "?projectId=…" : ""}` is the route `/api/goals`.
    .replace(/([^/]):p$/, "$1")
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ":p")
    .replace(/\/+$/, "") || "/";
}

/** The verb of a `fetch(url, { method: "DELETE" })`. The in-house client (`post`, `patch`, `del`)
 *  carries it in its name, but some calls use bare `fetch` with `method:`; counting them all as
 *  GET invented missing routes that existed. */
function methodAfter(src, from) {
  let depth = 1, j = from;
  while (j < src.length && depth > 0) {
    if (src[j] === "(") depth++;
    else if (src[j] === ")") depth--;
    j++;
  }
  const m = /\bmethod\s*:\s*["'](\w+)["']/.exec(src.slice(from, j));
  return m ? m[1].toUpperCase() : "GET";
}

const served = new Map(); // "GET /api/x" -> file
for (const f of walk(join(ROOT, "server", "src"))) {
  if (f.includes(".test.")) continue;
  const src = readFileSync(f, "utf8");
  for (const m of src.matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*/g)) {
    const lit = readLiteral(src, m.index + m[0].length);
    if (!lit?.text.startsWith("/api/")) continue;
    served.set(`${m[1].toUpperCase()} ${normalize(lit.text)}`, f.slice(ROOT.length));
  }
}

// The web client goes through `api/client.ts`: `fetch(url)` = GET, `post/patch/del(url)` = the verb.
const called = new Map(); // "GET /api/x" -> [files]
// Every `/api/…` literal in the screen, whatever its form, for the reverse direction: a route
// reached by `new EventSource(url)`, an `href` or a URL built in a ternary is not dead, and
// counting it as such would be the noise that makes people abandon the tool.
const referenced = new Set();
const VERB_OF = { post: "POST", patch: "PATCH", put: "PUT", del: "DELETE", fetch: "GET" };
for (const f of walk(join(ROOT, "web", "src"))) {
  if (f.includes(".stories.") || f.includes(".test.")) continue;
  const src = readFileSync(f, "utf8");
  for (let i = 0; i < src.length; i++) {
    if (src[i] !== "`" && src[i] !== '"' && src[i] !== "'") continue;
    const lit = readLiteral(src, i);
    if (lit?.text.startsWith("/api/")) referenced.add(normalize(lit.text));
    if (lit) i = lit.end;
  }
  for (const m of src.matchAll(/\b(post|patch|put|del|fetch)\(\s*/g)) {
    const lit = readLiteral(src, m.index + m[0].length);
    if (!lit?.text.startsWith("/api/")) continue;
    const verb = m[1] === "fetch" ? methodAfter(src, lit.end + 1) : VERB_OF[m[1]];
    const key = `${verb} ${normalize(lit.text)}`;
    if (!called.has(key)) called.set(key, []);
    called.get(key).push(f.slice(ROOT.length));
  }
}

/**
 * A call is served if a route with the same verb has the same segment count and matches segment by
 * segment, `:p` accepting anything on either side.
 *
 * Either side counts: `goalAction(id, action)` writes `/api/goals/${id}/${action}` where the server
 * declares `pause`, `resume` and `kill` one by one. Literal equality reported one missing route
 * where there are three.
 */
const servedList = [...served.keys()].map((k) => {
  const [verb, path] = k.split(" ");
  return { verb, seg: path.split("/") };
});
function isServed(key) {
  if (served.has(key)) return true;
  const [verb, path] = key.split(" ");
  const seg = path.split("/");
  return servedList.some((r) =>
    r.verb === verb && r.seg.length === seg.length
    && r.seg.every((s, i) => s === seg[i] || s === ":p" || seg[i] === ":p"));
}

const missing = [...called].filter(([k]) => !isServed(k));
// A served route nobody calls from the screen is not necessarily dead: some are there for the
// outside (an OAuth callback). `api-pending.json` declares those; an undeclared one fails.
const refList = [...referenced].map((p) => p.split("/"));
const unused = [...served].filter(([k]) => {
  const seg = k.split(" ")[1].split("/");
  return !refList.some((r) => r.length === seg.length
    && r.every((s, i) => s === seg[i] || s === ":p" || seg[i] === ":p"));
});

// Clients no screen imports any more (29/08).
//
// The sets above compare `/api/…` literals found in `web/src/`, and `web/src/api/<domain>.ts` is in
// `web/src/`. A client keeping its literal after its last caller is gone makes its route look
// referenced. Found on 29/08: the navigation rework removed the global dashboard, the Concierge
// panel's only mount point, and `web/src/api/concierge.ts` kept `make contract` silent.
//
// A `web/src/api/` module is live if one of its exports is cited outside `web/src/api/`, then, by
// propagation, if a live module cites it (otherwise `client.ts`, used only by other clients, would
// be flagged).
const API_DIR = join(ROOT, "web", "src", "api");
const apiFiles = walk(API_DIR).filter((f) => !f.includes(".test.") && !f.includes(".stories."));
const exportsOf = new Map(); // file -> Set(exported names)
for (const f of apiFiles) {
  const src = readFileSync(f, "utf8");
  const names = new Set();
  for (const m of src.matchAll(/\bexport\s+(?:async\s+)?(?:const|function|class)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  for (const m of src.matchAll(/\bexport\s+\{([^}]*)\}/g))
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  exportsOf.set(f, names);
}
/** Names cited by a set of files, excluding their own export declarations. */
function citedIn(files) {
  const cited = new Set();
  for (const f of files) {
    const src = readFileSync(f, "utf8").replace(/\bexport\s+(?:async\s+)?(?:const|function|class)\s+[A-Za-z_$][\w$]*/g, "");
    for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\b/g)) cited.add(m[1]);
  }
  return cited;
}
const outsideApi = walk(join(ROOT, "web", "src"))
  .filter((f) => !f.startsWith(API_DIR) && !f.includes(".test.") && !f.includes(".stories."));
const live = new Set();
let citedOutside = citedIn(outsideApi);
for (const [f, names] of exportsOf) if ([...names].some((n) => citedOutside.has(n))) live.add(f);
// Fixed point, bounded by a handful of files: the naive loop is enough.
for (let changed = true; changed; ) {
  changed = false;
  const citedByLive = citedIn([...live]);
  for (const [f, names] of exportsOf)
    if (!live.has(f) && [...names].some((n) => citedByLive.has(n))) { live.add(f); changed = true; }
}
const orphanClients = apiFiles
  .filter((f) => !live.has(f) && exportsOf.get(f).size > 0)
  .map((f) => f.slice(ROOT.length));

// A known gap does not fail: it names who must fill it. An unknown gap fails, and so does a stale
// declaration, otherwise the file becomes a graveyard nobody reads.
const pending = JSON.parse(readFileSync(join(ROOT, "scripts", "api-pending.json"), "utf8"));
const declared = { missing: pending.missing ?? {}, unused: pending.unused ?? {}, orphanClients: pending.orphanClients ?? {} };

const newMissing = missing.filter(([k]) => !(k in declared.missing));
const newUnused = unused.filter(([k]) => !(k in declared.unused));
const newOrphans = orphanClients.filter((f) => !(f in declared.orphanClients));
const staleMissing = Object.keys(declared.missing).filter((k) => !missing.some(([m]) => m === k));
const staleUnused = Object.keys(declared.unused).filter((k) => !unused.some(([m]) => m === k));
const staleOrphans = Object.keys(declared.orphanClients).filter((k) => !orphanClients.includes(k));

console.log(`${served.size} route(s) served · ${called.size} called by the screen\n`);

if (newMissing.length) {
  console.log(`⛔ ${newMissing.length} CALL(S) WITHOUT A ROUTE, not declared — the screen asks for what nobody serves:`);
  for (const [k, files] of newMissing) console.log(`   ${k}\n      called by ${[...new Set(files)].join(", ")}`);
  console.log("   Serve the route, or declare it in scripts/api-pending.json, naming the task that will deliver it.\n");
}

if (newUnused.length) {
  console.log(`⛔ ${newUnused.length} ROUTE(S) NOBODY CALLS, not declared:`);
  for (const [k, f] of newUnused) console.log(`   ${k.padEnd(46)} ${f}`);
  console.log("   A server half without its screen is a gap too, the other way round.\n");
}

if (newOrphans.length) {
  console.log(`⛔ ${newOrphans.length} CLIENT(S) NO SCREEN IMPORTS ANY MORE, not declared:`);
  for (const f of newOrphans) console.log(`   ${f}`);
  console.log("   Its route believes it is called because the literal is still there. Bring the screen back, delete the client, or declare it.\n");
}

const stale = [...staleMissing, ...staleUnused, ...staleOrphans];
if (stale.length) {
  console.log(`⛔ ${stale.length} STALE declaration(s) in scripts/api-pending.json — the gap is filled, remove the line:`);
  for (const k of stale) console.log(`   ${k}`);
  console.log();
}

const debt = missing.length + unused.length + orphanClients.length - newMissing.length - newUnused.length - newOrphans.length;
if (debt) console.log(`· ${debt} known gap(s) declared in scripts/api-pending.json.`);

const fail = newMissing.length + newUnused.length + newOrphans.length + stale.length;
if (!fail) console.log("✓ contract holds: nothing new, nothing stale.");
process.exit(fail ? 1 : 0);
