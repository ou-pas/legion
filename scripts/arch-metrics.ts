#!/usr/bin/env -S node --import tsx
// What the code weighs, measured by the compiler (05/09).
//
// A craft rule written in `CLAUDE.md` ("no `any`", "a component without stories does not exist") is
// read by nobody at the moment it is broken: `tsc` does not see it, nor the linter, and review sees
// it one time in three. None of the resulting numbers was ever decided; they arrived one commit at a
// time.
//
// It does not judge existing debt or ask for repayment. It measures it, freezes it in
// `scripts/arch-metrics-baseline.json`, and the tests in `server/src/architecture/` refuse growth.
// Same model as `scripts/api-pending.json`: known debt is declared, a stale declaration fails too.
//
// The compiler, not regexes: a non-null `!` is the same character as negation, `!=`, `!==`, and "a
// body spread in a call argument" cannot be grepped. TypeScript is already a dev dependency; its AST
// is read without a program or type checker, so without a compilation's cost.
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// `typescript` is not a root dependency (the root only has oxlint, oxfmt and tsx); it is resolved
// from `web/` rather than adding a root dependency for one script. Loaded with `require`: an
// `import type` would resolve from this file's folder, not `web/`, and fail. Hence `ts: any`.
const ts: any = createRequire(join(ROOT, "web", "package.json"))("typescript");

/** The three measured roots and nothing else: `drizzle/` (migrations are history) and root configs
 *  are not product code. */
const ROOTS = ["server/src", "web/src", "runner-payload"];
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "storybook-static"]);
const CODE = /\.(ts|tsx|mts|mjs|cjs|js)$/;
const STYLE = /\.css$/;

/** The closed breakpoint scale (13/09, `docs/DESIGN.md` § Width). Ten distinct values lived in
 *  twenty-eight media queries, each screen picking its own. Three steps; an eleventh value fails
 *  instead of being added.
 *
 *  `min-width` is refused outright: the product is wide-screen first, so a media query subtracts.
 *  Mixing in phone-first rules would leave nobody knowing which rule wins. */
const BREAKPOINTS = new Set([640, 900, 1180]);
const MEDIA_WIDTH = /\(\s*(min|max)-width:\s*(\d+)px\s*\)/g;

/** `server/src/architecture/` excludes itself: the harness measures the product, and counting itself
 *  would make each new rule move its own thresholds. */
const SELF = "server/src/architecture/";

function walk(dir: string, out: string[] = [], match: RegExp = CODE): string[] {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return out; }
  for (const e of entries) {
    if (SKIP_DIRS.has(e) || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out, match);
    else if (match.test(e)) out.push(p);
  }
  return out;
}

const isTest = (f: string): boolean => /\.test\.[tj]sx?$/.test(f);
const isStories = (f: string): boolean => /\.stories\.tsx?$/.test(f);

/** Path relative to the repository root with POSIX separators: the baseline's key, identical on
 *  every machine. */
const rel = (abs: string): string => relative(ROOT, abs).split(sep).join("/");

function scriptKind(file: string): any {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX;
  if (/\.(ts|mts)$/.test(file)) return ts.ScriptKind.TS;
  return ts.ScriptKind.JS;
}

// Two shapes, which the ratchet treats differently:
//   · list: membership ("this file nests deeper than 4"). Who is in it counts, not how many: a new
//     entry is a regression even if another left the same day.
//   · map: a count per file ("this file has 12 `!`"). Per file, because a global total would let
//     debt move from one module to another silently.

// The four line counters (`files.over500/800`, `functions.over100/200`) were removed on 09/09.
// Measured in statements, which the formatter does not move, they pointed at the wrong files:
// `builtin-skills.ts` flagged at 581 lines for 28 statements, the biggest file cleared at 216.
// oxlint's `complexity` replaces them. See size.test.ts.
const NESTING_LIMIT = 4; // "no nesting > 4" (CLAUDE.md): depth ≥ 5 is reported.

/** Session states written by hand instead of coming from the enum: adding a state then means
 *  finding every string in the repository. */
const STATUS_LITERALS = new Set([
  "starting", "running", "waiting", "blocked", "committing", "destroyed", "failed",
]);
/** The files allowed to cite these strings: they define them. */
const STATUS_OWNERS = /(^|\/)(session-terminal|lifecycle)\.ts$|-enums\.ts$/;

/** The only folder that writes a task's status (06/09). The transition table lives in
 *  `tasks/lifecycle.ts`; elsewhere it is called, not bypassed. Six files wrote the column directly,
 *  each with its own `WHERE` clause, so its own rule, invisible to readers of the others. */
const TASK_STATUS_OWNER = "server/src/tasks/";

/** Server modules not required to have a test: declarations (`types`, `schema`, `*-enums`,
 *  `step`), assembly (`index`), history (`migrations/`), and routes, whose testing is separate work.
 *
 *  `step.ts` is a declaration, not a folder (15/09): `migrations/step.ts` and `patches/step.ts` only
 *  carry a type. Exempting all of `patches/`, as a first version did, would have exempted the files
 *  transforming production data, whose test is the only safety net. */
const NO_TEST_EXPECTED = (r: string): boolean =>
  /\/migrations\//.test(r) ||
  /(^|\/)(index|types|schema|step)\.ts$/.test(r) ||
  /-enums\.ts$/.test(r) ||
  /(^|\/)([a-z-]+-)?routes\.ts$/.test(r);

/** Screen modules requiring neither stories nor a test: the two entry points. */
const NO_STORY_EXPECTED = (r: string): boolean => /(^|\/)(main|router)\.tsx$/.test(r);

/** Redirecting addresses (nav work, batches A-F) that no link in the repository may target: the gate
 *  of the last batch (nav/G). `web/src/router.tsx` still serves them (bookmarks, external links,
 *  server error messages, command palette); it declares the redirect mechanism, so it is the only
 *  file excluded from the scan (`NAV_ROUTER_FILE`).
 *
 *  `/tasks/…`, `/goals/…`, `/agents/…` only redirect when the id is found, but the correct address
 *  is always the project-scoped one, so targeting them stays forbidden.
 *
 *  Not listed: bare `/p/$projectId/tasks/$taskId` is canonical (nav batch 5, 12/09). Its
 *  `beforeLoad` only redirects to absorb a legacy `?vue=`. A rule on "every `beforeLoad` calling
 *  `redirect(`" would flag the most used address in the repository.
 *
 *  The French paths below are the legacy addresses being redirected, kept verbatim. */
const NAV_REDIRECT_TARGETS = new Set([
  "/infra",
  "/logs",
  "/analytics",
  // Nav batch 5 (12/09): `/systeme` → `/system`, the five old addresses still redirect.
  "/systeme",
  "/systeme/infra",
  "/systeme/journal",
  "/systeme/statistiques",
  "/systeme/general",
  // Nav batch 5 (12/09): `canaux` → `channels`.
  "/p/$projectId/canaux",
  "/p/$projectId/canaux/$taskId",
  // Nav batch 5 (12/09): `taches` → `tasks`. The eight views follow their parent route, see
  // `TASK_VIEW_PATH` (tasks/task-views.ts).
  "/p/$projectId/taches/$taskId",
  "/p/$projectId/taches/$taskId/interview",
  "/p/$projectId/taches/$taskId/report",
  "/p/$projectId/taches/$taskId/timeline",
  "/p/$projectId/taches/$taskId/brief",
  "/p/$projectId/taches/$taskId/criteria",
  "/p/$projectId/taches/$taskId/artifacts",
  "/p/$projectId/taches/$taskId/pr",
  "/p/$projectId/taches/$taskId/notes",
  // Nav batch 5 (12/09): `planifiees` → `scheduled`.
  "/p/$projectId/planifiees",
  "/p/$projectId",
  "/p/$projectId/project",
  "/p/$projectId/project/chaines",
  // Nav batch 5 (12/09): `modeles` → `models`, `execution` → `runtime`, `coffre` → `crate`.
  "/p/$projectId/project/modeles",
  "/p/$projectId/project/execution",
  "/p/$projectId/project/coffre",
  // Nav batch 5 (12/09): `capabilities` → `libraries` (the path follows the Library label),
  // `regles` → `rules`. `skills`, `mcp` and `environments` move with the registry holding them.
  "/p/$projectId/capabilities",
  "/p/$projectId/capabilities/skills",
  "/p/$projectId/capabilities/regles",
  "/p/$projectId/capabilities/chaines",
  "/p/$projectId/capabilities/mcp",
  "/p/$projectId/capabilities/environments",
  "/tasks/$taskId",
  "/goals/$goalId",
  "/agents/$agentId",
  "/concierge/conversations",
  "/concierge/conversations/$conversationId",
  // Nav batch 2a: General absorbed Context. `repos` is not here: its screen grew the git identity
  // and SSH key, but its address did not move.
  "/p/$projectId/project/contexte",
]);
const NAV_ROUTER_FILE = "web/src/router.tsx";

/** The value of a literal `to` on this node, or `null`, whether a JSX attribute
 *  (`<Link to="/infra">`, `<Link to={"/infra"}>`) or an object property (`{ to: "/infra" }`,
 *  `redirect({ to: "/infra" })`). `path:` never counts (`task-screens.stories.tsx` declares a harness
 *  route on `path: "/tasks/$taskId"`, not a link), nor does a dynamic `to` (`to={view}`). */
function navToLiteral(node: any): string | null {
  if (ts.isJsxAttribute(node) && node.name.getText() === "to") {
    const v = node.initializer;
    if (!v) return null;
    if (ts.isStringLiteralLike(v)) return v.text;
    if (ts.isJsxExpression(v) && v.expression && ts.isStringLiteralLike(v.expression)) {
      return v.expression.text;
    }
    return null;
  }
  if (ts.isPropertyAssignment(node) && ts.isStringLiteralLike(node.initializer)) {
    const name = node.name;
    const key = ts.isIdentifier(name) || ts.isStringLiteralLike(name) ? name.text : null;
    if (key === "to") return node.initializer.text;
  }
  return null;
}

/** The four components that already show their pending state (16/09, `ui/busy.ts`), recognised by
 *  JSX name alone. */
const BUSY_COMPONENTS = new Set(["Button", "IconBtn", "IconButton", "ConfirmAction"]);
/** `onClick` for the first three, `onConfirm` for `ConfirmAction`. Checking both on every element
 *  costs less than switching on the name. */
const BUSY_HANDLER_PROPS = new Set(["onClick", "onConfirm"]);

function jsxTagName(opening: any): string | null {
  return ts.isIdentifier(opening.tagName) ? opening.tagName.text : null;
}

function jsxAttr(opening: any, name: string): any {
  return opening.attributes.properties.find(
    (p: any) => ts.isJsxAttribute(p) && p.name && p.name.getText() === name,
  );
}

/** `navigate(...)` (tanstack-router `useNavigate()`) is the only exemption: a route transition awaits
 *  no server response, and `void navigate(...)` is the established idiom here. Without it
 *  `task-card.tsx` was a false positive when the rule landed. */
function isNavigateCall(expr: any): boolean {
  return ts.isCallExpression(expr) && ts.isIdentifier(expr.expression) && expr.expression.text === "navigate";
}

/** True if `fn` (an `onClick`/`onConfirm` value) discards the promise it produces instead of
 *  returning it. The two forms found on 16/09 across the 22 fixed call sites: an expression body
 *  `() => void call()`, or a block body where a `.then/.catch/.finally` call is a statement rather
 *  than a `return`. Known blind spot: a handler passed by reference (`onClick={myHandler}`) that
 *  discards further down the file; following the reference is out of scope, and the inline form is
 *  the most frequent. */
function discardsPromise(fn: any): boolean {
  if (!fn) return false;
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return false;
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) {
    return ts.isVoidExpression(fn.body) && !isNavigateCall(fn.body.expression);
  }
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return false;
  return body.statements.some((s: any) => {
    if (!ts.isExpressionStatement(s)) return false;
    if (ts.isVoidExpression(s.expression)) return !isNavigateCall(s.expression.expression);
    if (!ts.isCallExpression(s.expression)) return false;
    const callee = s.expression.expression;
    return (
      ts.isPropertyAccessExpression(callee) &&
      ["then", "catch", "finally"].includes(callee.name.text)
    );
  });
}

const isFunctionLike = (n: any): boolean =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) || ts.isSetAccessorDeclaration(n);

/** +1 depth. `else if` adds none: it is written flat, and counting it would make three successive
 *  cases a depth of 3. */
const NESTS = (n: any): boolean =>
  ts.isIfStatement(n) || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n) ||
  ts.isWhileStatement(n) || ts.isDoStatement(n) || ts.isSwitchStatement(n) ||
  ts.isTryStatement(n) || ts.isConditionalExpression(n);

/** The access chain left of an expression: `c.req.param("id")` gives ["c", "req", "param"],
 *  `uninstallChain(c.req.param("id"))` gives ["uninstallChain"]. The root matters, not the text:
 *  the first version searched "c.req" in the spread's text and took
 *  `...uninstallChain(c.req.param("id"))` for a spread request body, a false positive on a metric
 *  meant to be zero. */
function accessChain(expr: any): string[] {
  const chain: string[] = [];
  for (let n = expr; n; ) {
    if (ts.isCallExpression(n) || ts.isNonNullExpression(n) || ts.isAwaitExpression(n) ||
        ts.isParenthesizedExpression(n) || ts.isElementAccessExpression(n)) { n = n.expression; continue; }
    if (ts.isPropertyAccessExpression(n)) { chain.unshift(n.name.text); n = n.expression; continue; }
    if (ts.isIdentifier(n)) { chain.unshift(n.text); return chain; }
    return chain;
  }
  return chain;
}

/** Is the object literal holding this spread a call argument? Walks up nested objects and arrays and
 *  stops at the first function: beyond it is a callback body, not the same argument. */
function insideCallArgument(node: any): boolean {
  for (let n = node.parent; n; n = n.parent) {
    if (isFunctionLike(n)) return false;
    if (ts.isCallExpression(n) || ts.isNewExpression(n)) return true;
    if (!ts.isObjectLiteralExpression(n) && !ts.isArrayLiteralExpression(n) &&
        !ts.isPropertyAssignment(n) && !ts.isSpreadAssignment(n)) return false;
  }
  return false;
}

/** `.set({ status: "running" })`: is the literal the value of a `status` property passed to
 *  `.set(...)` or `.values(...)`? */
function inStatusUpdate(node: any): boolean {
  const prop = node.parent;
  if (!prop || !ts.isPropertyAssignment(prop) || prop.name.getText() !== "status") return false;
  for (let n = prop.parent; n; n = n.parent) {
    if (isFunctionLike(n)) return false;
    if (ts.isCallExpression(n)) return /\.(set|values)$/.test(n.expression.getText());
  }
  return false;
}

/** `db.update(schema.tasks).set({ … status … })`: a write of a task's status.
 *
 *  Starts from `.set(…)` and walks the chain down to `update(schema.tasks)`, the only way to tell
 *  `tasks` from `sessions`, `inboxMessages` or `reviewComments`, which all have a `status` column.
 *
 *  The argument is tested on its text, not its properties, since `status` also arrives through a
 *  spread ternary (`...(status !== undefined ? { status } : {})`, task-patch.ts). Known ceiling: a
 *  `.set()` whose value mentions `status` without writing the column would count. None exists, and
 *  that false positive would show in the failure message; a silent bypass would show nowhere. */
function isTaskStatusUpdate(node: any): boolean {
  if (!ts.isCallExpression(node)) return false;
  if (!ts.isPropertyAccessExpression(node.expression) || node.expression.name.text !== "set") return false;
  const arg = node.arguments[0];
  if (!arg || !ts.isObjectLiteralExpression(arg) || !/\bstatus\b/.test(arg.getText())) return false;
  for (let n = node.expression.expression; n; ) {
    if (ts.isCallExpression(n)) {
      if (ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "update")
        return n.arguments[0]?.getText() === "schema.tasks";
      n = n.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(n)) { n = n.expression; continue; }
    return false;
  }
  return false;
}

/** A metric is either a list of memberships (`"path (5)"`, `"path:12 → …"`, or a bare path) or a map
 *  of counts per file. */
export type ArchMetric = string[] | Record<string, number>;
export type ArchMetrics = Record<string, ArchMetric>;
type MetricMap = Record<string, number>;

const bump = (map: MetricMap, key: string): void => { map[key] = (map[key] ?? 0) + 1; };

/** True if `node`'s subtree contains a `readFileSync` call (to follow
 *  `readFileSync(...).toString()`) or a reference to a `tracked` identifier: how a variable derived
 *  from a read (`const real = src.slice(...)`, itself derived further) propagates the mark until
 *  `tracked` stops growing (see the fixed-point loop in `measure`). */
function mentionsSourceRead(node: any, tracked: Set<string>): boolean {
  if (ts.isCallExpression(node)) {
    const callee = node.expression;
    const name = ts.isIdentifier(callee)
      ? callee.text
      : ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : null;
    if (name === "readFileSync") return true;
  }
  if (ts.isIdentifier(node) && tracked.has(node.text)) return true;
  let found = false;
  ts.forEachChild(node, (c: any) => { if (!found && mentionsSourceRead(c, tracked)) found = true; });
  return found;
}

/** True if `node`'s subtree references a `tracked` identifier, without `mentionsSourceRead`'s bare
 *  `readFileSync` fallback. Finds assertions reusing a read variable (one read, N assertions), not a
 *  direct read inside an assertion (`assert.equal(readFileSync(p, "utf8"), "x")`), which is usually
 *  a fixture the test just wrote, already counted by `sourceReadInTests`; counting it here too would
 *  drown the signal (see `workspace-reuse.test.ts`). */
function referencesTracked(node: any, tracked: Set<string>): boolean {
  if (ts.isIdentifier(node) && tracked.has(node.text)) return true;
  let found = false;
  ts.forEachChild(node, (c: any) => { if (!found && referencesTracked(c, tracked)) found = true; });
  return found;
}

/** `assert(...)`, `assert.equal(...)`, `assert.match(...)`: the only form used here
 *  (`node:assert/strict`, never another import name or framework). */
const isAssertCallee = (callee: any): boolean =>
  (ts.isIdentifier(callee) && callee.text === "assert") ||
  (ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "assert");

/** One pass, one `createSourceFile` per file: no TypeScript program, so no module or type
 *  resolution. */
export function measure(): ArchMetrics {
  const files = ROOTS.flatMap((r) => walk(join(ROOT, r)))
    .filter((f) => !rel(f).startsWith(SELF))
    .sort();

  const m = {
    "nesting.over4": [] as string[],
    nonNull: {} as MetricMap, anyKeyword: {} as MetricMap, asUnknown: {} as MetricMap,
    unvalidatedBody: {} as MetricMap, bodySpreadInRoute: [] as string[],
    dynamicImportInternal: {} as MetricMap, consoleCalls: {} as MetricMap, statusLiterals: {} as MetricMap,
    taskStatusWritesOutsideTasks: {} as MetricMap,
    storiesMissing: [] as string[], testsMissing: [] as string[], defaultExports: [] as string[],
    sourceReadInTests: {} as MetricMap, sourceAssertionsInTests: {} as MetricMap,
    navRedirectLinks: [] as string[],
    breakpointsOffScale: [] as string[],
    discardedButtonPromises: [] as string[],
  };

  const present = new Set(files.map(rel));

  for (const abs of files) {
    const r = rel(abs);
    const src = readFileSync(abs, "utf8");
    const stories = isStories(abs);
    const test = isTest(abs);
    // Tests and stories are outside the size and style measures: a long test file is often a
    // complete one, and production rules would push toward writing less. They still count for
    // co-location.
    const production = !test && !stories;

    if (production) {

      if (r.startsWith("web/src/") && r.endsWith(".tsx") && !NO_STORY_EXPECTED(r)) {
        const stem = r.slice(0, -4);
        if (!present.has(`${stem}.stories.tsx`) && !present.has(`${stem}.test.tsx`)) m.storiesMissing.push(r);
      }
      // An `<x>-store.ts` is covered by `<x>.test.ts` (10/09). The structure work moved queries out
      // of rule files: a store has no behaviour of its own, its owner's test runs it against a real
      // database. One test file per store meant 21 files verifying nothing more. A store whose
      // owner has no test still counts.
      if (r.startsWith("server/src/") && r.endsWith(".ts") && !NO_TEST_EXPECTED(r)) {
        const stem = r.slice(0, -3);
        const owner = stem.endsWith("-store") ? stem.slice(0, -"-store".length) : null;
        const covered =
          present.has(`${stem}.test.ts`) || (owner !== null && present.has(`${owner}.test.ts`));
        if (!covered) m.testsMissing.push(r);
      }
    }

    const sf = ts.createSourceFile(abs, src, ts.ScriptTarget.Latest, true, scriptKind(abs));
    const lineOf = (pos: number): number => sf.getLineAndCharacterOfPosition(pos).line + 1;
    const isRouteFile = /(^|\/)([a-z-]+-)?routes\.ts$/.test(r);
    // Stories are scanned here (unlike `production`): a story teaches the wrong pattern as much as
    // a component. Only tests are excluded (`router.test.ts` navigates to the old addresses on
    // purpose to prove redirects still work), and `router.tsx`, which declares them.
    const checkNavLinks = !test && r !== NAV_ROUTER_FILE;
    // A button that calls the server shows its pending state (16/09, spec 2jan8IZn61). Web only,
    // outside tests (a mock may legitimately return nothing) and stories (nothing awaits a real
    // response there).
    const checkButtonPromises = r.startsWith("web/src/") && !test && !stories;
    let maxDepth = 0;

    // A test can read a source once and assert on it ten times; counting reads alone does not move
    // when the tenth assertion is added. First collect variables derived from a read, to a fixed
    // point since derivation chains (`const real = src.slice(...)`, then
    // `const code = real.replace(...)`), then count assertion calls holding one anywhere in their
    // arguments (`assert.equal(/foo/.test(src), false)` counts).
    const sourceVars = new Set<string>();
    if (test) {
      let changed = true;
      while (changed) {
        changed = false;
        const collectSourceVars = (node: any): void => {
          if (ts.isVariableDeclaration(node) && node.initializer && ts.isIdentifier(node.name) &&
              !sourceVars.has(node.name.text) && mentionsSourceRead(node.initializer, sourceVars)) {
            sourceVars.add(node.name.text);
            changed = true;
          }
          ts.forEachChild(node, collectSourceVars);
        };
        collectSourceVars(sf);
      }
    }

    const visit = (node: any, depth: number): void => {
      const elseIf = node.parent && ts.isIfStatement(node.parent) && node.parent.elseStatement === node;
      const d = NESTS(node) && !elseIf ? depth + 1 : depth;
      if (d > maxDepth) maxDepth = d;

      if (production) {
        if (ts.isNonNullExpression(node)) bump(m.nonNull, r);
        if (node.kind === ts.SyntaxKind.AnyKeyword) bump(m.anyKeyword, r);
        if (ts.isAsExpression(node) && ts.isAsExpression(node.expression) &&
            node.expression.type.kind === ts.SyntaxKind.UnknownKeyword) bump(m.asUnknown, r);
        if (ts.isCallExpression(node) && /(^|\.)console\.[a-z]+$/.test(node.expression.getText())) {
          bump(m.consoleCalls, r);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword &&
            r.startsWith("server/src/")) {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteralLike(arg) && arg.text.startsWith(".")) bump(m.dynamicImportInternal, r);
        }
        // `c.req.json<Body>()`: the generic declares a shape instead of checking it, on a body
        // that comes from the network.
        if (ts.isCallExpression(node) && node.typeArguments?.length &&
            ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "json" &&
            ts.isPropertyAccessExpression(node.expression.expression) &&
            node.expression.expression.name.text === "req") bump(m.unvalidatedBody, r);
        // `insert({ ...body })` in a route: what the client sent reaches the database without anyone
        // saying which fields it may write.
        if (isRouteFile && ts.isSpreadAssignment(node)) {
          const chain = accessChain(node.expression);
          const fromBody = chain[0] === "body" || (chain[0] === "c" && chain[1] === "req");
          if (fromBody && insideCallArgument(node)) m.bodySpreadInRoute.push(`${r}:...${node.expression.getText()}`);
        }
        // Server only: it owns the enum. The screen receives these states as strings with no shared
        // type, so comparing literals is its only option.
        if (r.startsWith("server/src/") && ts.isStringLiteralLike(node) &&
            STATUS_LITERALS.has(node.text) && !STATUS_OWNERS.test(r)) {
          const p = node.parent;
          const compared = p && ts.isBinaryExpression(p) && [
            ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken,
            ts.SyntaxKind.EqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsToken,
          ].includes(p.operatorToken.kind);
          if (compared || inStatusUpdate(node)) bump(m.statusLiterals, r);
        }
        if (r.startsWith("server/src/") && !r.startsWith(TASK_STATUS_OWNER) && isTaskStatusUpdate(node)) {
          bump(m.taskStatusWritesOutsideTasks, r);
        }
      }
      // An internal link targeting a redirecting address (nav batch G gate): links must target the
      // canonical address. Only a literal `to` counts.
      if (checkNavLinks) {
        const literal = navToLiteral(node);
        if (literal !== null && NAV_REDIRECT_TARGETS.has(literal)) {
          m.navRedirectLinks.push(`${r}:${lineOf(node.getStart(sf))} → to="${literal}"`);
        }
      }
      // A button that discards its promise no longer shows its pending state: `Button`/`IconBtn`/
      // `ConfirmAction` spin on their own when the handler returns a promise (`ui/busy.ts`), and
      // `void` or a missing `return` silently disables that. An explicit `loading` prop exempts the
      // element: the other legitimate way to drive the spinner (hand-tracked state, as in
      // `connections/connections-card.tsx`).
      if (checkButtonPromises && (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node))) {
        const tag = jsxTagName(node);
        if (tag && BUSY_COMPONENTS.has(tag) && !jsxAttr(node, "loading")) {
          for (const propName of BUSY_HANDLER_PROPS) {
            const attr = jsxAttr(node, propName);
            const value = attr?.initializer;
            const handler = value && ts.isJsxExpression(value) ? value.expression : null;
            if (discardsPromise(handler)) {
              m.discardedButtonPromises.push(
                `${r}:${lineOf(node.getStart(sf))} → <${tag} ${propName}>`,
              );
            }
          }
        }
      }
      // A test reading the source of the code it checks instead of calling it (11/09, completed
      // 12/09). The structure work asked each domain batch to remove these; measured the
      // same way at both ends of the work, the count did not go down (53 → 54). The counter is
      // deliberately coarse (`readFileSync` also counts reads of files the test wrote itself), but
      // it is the command that measured the drift, so the ratchet freezes what it already measured.
      //
      // One read can carry many assertions (`graceful-stop.test.ts` had 25), so
      // `sourceAssertionsInTests` counts assertion calls with an argument derived from a read
      // variable (review of task CGmoJHm7Hz). Same trade-off: an assertion on a file the test wrote
      // counts like one on product source.
      //
      // Neither sees a read through `fs/promises` `readFile` or `execFileSync("cat", …)` (used in
      // `infra/infra.test.ts`).
      if (test && ts.isCallExpression(node)) {
        const callee = node.expression;
        const name = ts.isIdentifier(callee)
          ? callee.text
          : ts.isPropertyAccessExpression(callee)
            ? callee.name.text
            : null;
        if (name === "readFileSync") bump(m.sourceReadInTests, r);
        if (sourceVars.size > 0 && isAssertCallee(callee) &&
            node.arguments.some((a: any) => referencesTracked(a, sourceVars))) {
          bump(m.sourceAssertionsInTests, r);
        }
      }
      // Stories must export a default: CSF3.
      if (!stories && (ts.isExportAssignment(node)
          ? !node.isExportEquals
          : ts.canHaveModifiers(node) && (ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Default) !== 0)) {
        m.defaultExports.push(`${r}:${lineOf(node.getStart(sf))}`);
      }
      ts.forEachChild(node, (c: any) => visit(c, d));
    };
    visit(sf, 0);
    if (production && maxDepth > NESTING_LIMIT) m["nesting.over4"].push(`${r} (${maxDepth})`);
  }

  // Stylesheets, which neither the import graph nor the TypeScript AST see. A text scan is enough to
  // read a value in a media query; a CSS parser would be a dependency to read three numbers.
  for (const abs of walk(join(ROOT, "web/src"), [], STYLE).sort()) {
    const r = rel(abs);
    readFileSync(abs, "utf8").split("\n").forEach((line, i) => {
      for (const [, kind, px] of line.matchAll(MEDIA_WIDTH)) {
        if (kind === "min" || !BREAKPOINTS.has(Number(px)))
          m.breakpointsOffScale.push(`${r}:${i + 1} → ${kind}-width: ${px}px`);
      }
    });
  }

  // Cast local to this loop: each field of `m` has a precise type so `bump(m.nonNull, r)` types
  // cleanly, but reassigning `m[k]` for a generic `k` needs an index signature.
  const rec = m as Record<string, ArchMetric>;
  for (const [k, v] of Object.entries(m)) {
    rec[k] = Array.isArray(v)
      ? v.sort()
      : Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)));
  }
  return m;
}

const BASELINE = join(ROOT, "scripts", "arch-metrics-baseline.json");
export const baselinePath = BASELINE;

const BASELINE_HEADER = [
  "THE ARCHITECTURE DEBT, MEASURED AND FROZEN. Generated by `make arch-baseline`",
  "(= `node --import tsx scripts/arch-metrics.ts --write-baseline`). Do not edit by hand.",
  "The tests in server/src/architecture/ refuse a STALE baseline as much as a",
  "regression: a number that goes down must be recorded again, otherwise the progress becomes",
  "slack for the next regression and nobody sees it go by.",
];

const total = (v: ArchMetric): number =>
  Array.isArray(v) ? v.length : Object.values(v).reduce((a, b) => a + b, 0);

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const all = measure();
  const only = args.includes("--only") ? args[args.indexOf("--only") + 1] : null;
  if (only && !(only in all)) {
    console.error(`unknown metric: ${only}\nknown: ${Object.keys(all).join(", ")}`);
    process.exit(2);
  }
  const m: ArchMetrics = only ? { [only as string]: all[only as string] as ArchMetric } : all;

  if (args.includes("--write-baseline")) {
    // No timestamp or sha (08/09). `generatedAt` and `commit` changed on every regeneration, so two
    // branches regenerating always conflicted, even with identical metrics, and parallel PRs are
    // the normal case. Nothing read them (`ratchet.ts` reads only `metrics`); `git log` answers.
    writeFileSync(BASELINE, `${JSON.stringify({ _: BASELINE_HEADER, metrics: all }, null, 2)}\n`);
    console.log(`baseline written: ${rel(BASELINE)}`);
    for (const [k, v] of Object.entries(all)) console.log(`   ${k.padEnd(24)} ${total(v)}`);
  } else if (args.includes("--pretty")) {
    for (const [k, v] of Object.entries(m)) {
      const entries = Array.isArray(v) ? v : Object.entries(v).map(([f, n]) => `${f} (${n})`);
      console.log(`\n${k} — ${total(v)}${Array.isArray(v) ? "" : ` in ${entries.length} file(s)`}`);
      for (const e of entries) console.log(`   ${e}`);
    }
    console.log();
  } else {
    console.log(JSON.stringify(m, null, 2));
  }
}
