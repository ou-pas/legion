// The safety net of the i18n extraction: it measures instead of assuming.
//
// A text extraction should be invisible on screen. The only way to prove it on a diff this size is
// to compare the set of visible sentences before and after: a sentence moved from a component to a
// catalogue stays in the set, a reworded one leaves it. The script prints what disappeared and what
// appeared, and exits non-zero if either list is non-empty.
//
//   node web/scripts/text-audit.mjs <base-ref>         # default: main
//   node web/scripts/text-audit.mjs --remaining        # what is still hard-coded in components
//
// Known limit: extraction is lexical (regex), not a TypeScript parse. It over-collects (class
// names, API keys), harmlessly since those strings sit in both sets and cancel out. What it must not
// do is miss one, hence three sources: `"…"` literals, `` `…` `` templates and JSX text nodes.

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");
const SRC = join(ROOT, "web/src");

/** A "visible" string contains a letter and (a space or an accent). An identifier (`task-card`,
 *  `onDragEnd`, `sm`) is not one; "Save for later" is. Accents stay in the test: the French UI this
 *  was written for had one-word labels such as "Terminée". */
function isVisible(s) {
  if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;
  if (/^(https?:|mailto:|\.{0,2}\/)/.test(s)) return false;
  if (/^[a-z][a-z0-9-]*$/.test(s)) return false; // slug, key, class name
  return / /.test(s) || /[éèêëàâçùûüôöîïœÉÈÊÀÇÔÎ]/.test(s);
}

/** Strips line and block comments. A character scan, not a regex: the sentence
 *  "PRs legion/* ouvertes" contains `/*`, and a regex opened an imaginary comment there that
 *  swallowed everything up to the next `*` `/`, dropping dozens of sentences from one side only. */
function stripComments(src) {
  let out = "";
  let quote = null; // ", ' or ` currently open
  for (let i = 0; i < src.length; i++) {
    const c = src[i],
      next = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
        continue;
      }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    // `/*` opens a comment only where one can start: line start, or after `{`, `(`, `,`. In JSX
    // text such as "PRs legion/* ouvertes" it is glued to a word: a glob, not a comment.
    if (c === "/" && next === "*" && /(^|[\n{(,])\s*$/.test(out)) {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++;
      out += " ";
      continue;
    }
    out += c;
  }
  return out;
}

/** A sentence is compared as displayed, not as written: an escaped apostrophe and a plain one are
 *  the same screen. Otherwise moving an escaped string to a catalogue (where the apostrophe is
 *  written plainly) would look like a rewording. */
function unescape(s) {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
    .replace(/\\(['"`\\])/g, "$1");
}

function extract(src, { jsx = true } = {}) {
  const code = stripComments(src);
  const found = [];
  const push = (raw) => {
    const s = unescape(raw).replace(/\s+/g, " ").trim();
    if (isVisible(s)) found.push(s);
  };
  for (const m of code.matchAll(/"((?:[^"\\\n]|\\.)*)"/g)) push(m[1]);
  // No single-quoted literals: the code has none (oxfmt writes double quotes), and looking for them
  // split French at every apostrophe into phantom sentences present on one side only.
  // Templates: `${…}` holes become one token; the sentence's shape is what counts.
  for (const m of code.matchAll(/`((?:[^`\\]|\\.)*)`/g)) push(m[1].replace(/\$\{[^}]*\}/g, "•"));
  // JSX text nodes: `>Archive all tasks<`. Interpolated expressions get the same token as template
  // holes, otherwise `step {n}` (JSX, before) and `` `step ${n}` `` (catalogue, after) would compare
  // as different sentences for the same screen.
  // A TypeScript generic (`Record<Task["status"], string> satisfies …`) also falls between `>` and
  // `<`. Keywords are enough to reject those: `;` or `=` occur in real copy and would cut sentences.
  // An arrow's `>` (`(p) => <Link/>`) opens a fake node running to the next tag and picking up
  // `title=• desc=`; those crumbs change shape when the value moves to the catalogue.
  const CODE = /=>|\w=|\b(satisfies|Record|const|export|import|extends|readonly|typeof)\b/;
  // Only files containing JSX: on a `.ts` catalogue the sentences are already literals, seen above.
  if (jsx) {
    for (const m of maskExpressions(code).matchAll(/>([^<>]+)</g)) {
      if (!CODE.test(m[1])) push(m[1]);
    }
  }
  return found;
}

/** Replaces each `{…}` expression with its token, counting braces (a regex cannot). Without this,
 *  an expression containing JSX (`{g.budgetUsd !== null && <>…</>}`) made the whole text node drop,
 *  and the text before it was seen on neither side. */
function maskExpressions(code) {
  let out = "";
  for (let i = 0; i < code.length; i++) {
    if (code[i] !== "{") {
      out += code[i];
      continue;
    }
    let depth = 0,
      j = i;
    for (; j < code.length; j++) {
      if (code[j] === "{") depth++;
      else if (code[j] === "}" && --depth === 0) break;
    }
    const inner = code.slice(i + 1, j);
    // `{" "}` is a space on screen, not an interpolated value. Giving it `•` made a sentence split by
    // `{" "}` in JSX look reworded once whole again in the catalogue.
    if (/^\s*(["'])\s*\1\s*$/.test(inner)) out += " ";
    // An expression containing JSX is a boundary, not a hole: its text is still displayed and must
    // be read. The added angle brackets close the preceding text node like a real tag would.
    else if (inner.includes("<")) out += `<${maskExpressions(inner)}>`;
    else out += "•";
    i = j;
  }
  return out;
}

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (/\.tsx?$/.test(p)) files.push(p);
  }
  return files;
}

function worktreeStrings() {
  const bag = new Map();
  for (const file of walk(SRC)) {
    for (const s of extract(readFileSync(file, "utf8"), { jsx: file.endsWith(".tsx") })) {
      bag.set(s, (bag.get(s) ?? 0) + 1);
    }
  }
  return bag;
}

function baseStrings(ref) {
  const list = execFileSync("git", ["ls-tree", "-r", "--name-only", ref, "web/src"], { cwd: ROOT })
    .toString()
    .split("\n")
    .filter((f) => /\.tsx?$/.test(f));
  const bag = new Map();
  for (const file of list) {
    const src = execFileSync("git", ["show", `${ref}:${file}`], {
      cwd: ROOT,
      maxBuffer: 64e6,
    }).toString();
    for (const s of extract(src, { jsx: file.endsWith(".tsx") })) bag.set(s, (bag.get(s) ?? 0) + 1);
  }
  return bag;
}

// Shape changes accepted one by one, each checked by reading: the rendered sentence is identical,
// only the template's split moved (a value written in the template became a parameter). Any other
// difference still fails. These are the French strings of the original extraction, kept verbatim:
// they only matter when comparing against a ref from that era.
const ACCEPTED = new Set([
  // Dashboard: the name now comes from SHELL_TEXT.user.name, shared with the topbar avatar.
  "• l'opérateur",
  // Dashboard: the "… need you" part of the subtitle became its own entry (hidden at zero, as before).
  "• · • session(s) active(s)${needCount > 0 ?",
  "• · • session(s) active(s)•",
  "· • chose(s) ont besoin de vous",
  // SessionRow: the "started … ago / ended in …" ternary was nested in the subtitle template; its
  // two branches are now two entries, composed first.
  "• · ${ended === null ?",
  "démarrée il y a •",
  "terminée en •",
  // ReviewsPage: a fix task's brief was two templates joined with `+` around a ternary. It is one
  // catalogue sentence with the path as a parameter; the text sent to the agent is identical.
  "${comment.path ?",
  ': ""} :\\n\\n> •\\n\\n•',
  "Commentaire de review par • sur •#•",
  "Commentaire de review par • sur •#•• :\\n\\n> •\\n\\n•",
]);

/** Sets, not counts: two screens repeating a sentence now share one catalogue entry, and that
 *  deduplication is the goal. What must stay invariant is which sentences exist. */
function diff(before, after) {
  const gone = [...before.keys()]
    .filter((s) => !after.has(s) && !ACCEPTED.has(s))
    .map((s) => [s, 1]);
  const born = [...after.keys()]
    .filter((s) => !before.has(s) && !ACCEPTED.has(s))
    .map((s) => [s, 1]);
  return { gone, born };
}

/** `--remaining`: sentences still hard-coded in a component (catalogues excluded). */
function remaining() {
  const rows = [];
  for (const file of walk(SRC)) {
    const rel = relative(ROOT, file);
    if (/\/(text|vocabulary)(\/|\.ts$)/.test(rel)) continue;
    const n = extract(readFileSync(file, "utf8"), { jsx: file.endsWith(".tsx") }).length;
    if (n) rows.push([rel, n]);
  }
  rows.sort((a, b) => b[1] - a[1]);
  let total = 0;
  for (const [f, n] of rows) {
    total += n;
    console.log(String(n).padStart(4), f);
  }
  console.log(`\n${total} hard-coded sentences in ${rows.length} files.`);
}

const arg = process.argv[2] ?? "main";
if (arg === "--remaining") {
  remaining();
} else {
  const { gone, born } = diff(baseStrings(arg), worktreeStrings());
  const show = (title, rows) => {
    console.log(`\n${title}: ${rows.length}`);
    for (const [s, n] of rows.sort()) console.log(`  ${n > 1 ? `${n}× ` : ""}${JSON.stringify(s)}`);
  };
  show(`Gone since ${arg}`, gone);
  show(`New since ${arg}`, born);
  if (gone.length || born.length) {
    console.log("\nAn i18n extraction must change nothing on screen: both lists must be empty.");
    process.exit(1);
  }
  console.log("\nNo visible sentence lost or added. The screen is identical.");
}
