// Ask providers what they know about tokens never probed, pasted and granted alike (15/09, widened
// 16/09).
//
//   node --import tsx server/scripts/adopt-pasted-tokens.ts     (or `make adopt-tokens`)
//
// A `GITHUB_TOKEN` or `GITLAB_TOKEN` set by hand before the connections work has no `metadata`: the
// Integrations screen shows it as pasted, with no account or access, although the provider's probe
// could read both. Since round 6 granted tokens are included too: a successful flow never asked who
// owned the token, so every OAuth connection made before 16/09 shows no account. The criterion is
// therefore "never probed" (`probedAt` missing), for both origins, including rows old enough to
// have no `origin`, which `credentialOrigin` reads as granted.
//
// Not a migration: migrations run at startup, and this depends on the network. An instance booting
// while GitHub is unreachable would stop on a display enrichment.
//
// This file decides nothing: it resolves the database, refuses to work without the master key, and
// prints. The rules (a refused token writes nothing, nor does an unreachable provider, and a second
// pass finds nothing left) live in `src/connections/adopt-pasted.ts`, under tests. No test runs this
// file, so a guard placed here would have no proof.
//
// TypeScript rather than `.mjs` like `operator-token.mjs`: probing needs the provider adapters, and
// rewriting them in JavaScript would duplicate the one thing that matters here.
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// Type-only import, erased at compile time, so it loads nothing before `LEGION_DB` is set: that is
// why everything else goes through dynamic imports.
import type { AdoptReport } from "../src/connections/adopt-pasted.js";

// First: `server/.env` carries `LEGION_MASTER_KEY`, without which no token decrypts and so none can
// be probed, and may carry `LEGION_DB`. This is the server's loader, not a second one.
await import("../src/shared/env.js");

// The database is resolved from this file, and the script refuses to create one (the lesson of
// `network-audit.ts`): `db.ts` reads `LEGION_DB ?? "legion.db"`, relative to cwd, and `make` runs
// at the repository root while the server runs in `server/`. A tool that creates the database it
// should inspect reassures wrongly.
const DB_PATH =
  process.env.LEGION_DB ?? resolve(dirname(fileURLToPath(import.meta.url)), "..", "legion.db");
if (!existsSync(DB_PATH)) {
  console.error(`⛔ no database at ${DB_PATH}`);
  console.error("   Start the control plane once (make server) to create it, or point to it:");
  console.error("   LEGION_DB=/path/to/legion.db make adopt-tokens");
  process.exit(1);
}
// Set before the import: `db.ts` reads the variable when the module loads.
process.env.LEGION_DB = DB_PATH;

const { hasMasterKey } = await import("../src/shared/crypto.js");
if (!hasMasterKey()) {
  console.error("⛔ LEGION_MASTER_KEY missing: no token can be decrypted, so none can be probed.");
  console.error("   It lives in server/.env, next to the database.");
  process.exit(1);
}

// These imports register the adapters, as `connections/routes.ts` does.
await import("../src/connections/github-device.js");
await import("../src/connections/gitlab-device.js");
await import("../src/connections/linear-redirect.js");
const { ADOPT_OUTCOME, adoptPastedTokens } = await import("../src/connections/adopt-pasted.js");

console.log(`database: ${DB_PATH}\n`);

/** An empty scope list and an unknown one are opposite facts and must not read the same. */
function describe(report: AdoptReport): string {
  const scopes = report.probed?.scopes;
  return [
    report.probed?.account ?? "account not published",
    scopes === null || scopes === undefined
      ? "access not published"
      : scopes.join(", ") || "no access found",
  ].join(" · ");
}

/** One line per secret, for someone deciding whether to run it again. */
function line(report: AdoptReport): string {
  const where = `${report.secretName} (project ${report.projectId})`;
  switch (report.outcome) {
    case ADOPT_OUTCOME.adopted:
      return report.writtenAs
        ? `✓ ${where} → ${report.writtenAs}: ${describe(report)} (the old row is kept)`
        : `✓ ${where}: ${describe(report)}`;
    case ADOPT_OUTCOME.refused:
      return `✗ ${where}: the provider did not recognise this token. Nothing written, the row stays as is.`;
    case ADOPT_OUTCOME.unreachable:
      return `~ ${where}: nothing written (${report.why ?? "unknown cause"}). Run again later.`;
    // Not "run again": waiting does not bring a master key back.
    case ADOPT_OUTCOME.unreadable:
      return `⛔ ${where}: this token does not decrypt (${report.why ?? "unknown cause"}). Nothing written. Check LEGION_MASTER_KEY in server/.env.`;
    // The provider was not asked, so the line attributes nothing to it (15/09 fix: "the provider did
    // not recognise this token" about a provider never queried made a diagnosis long). The fix is
    // an operator action, pasting the token again, not waiting.
    case ADOPT_OUTCOME.incomplete:
      return `⛔ ${where}: ${report.why ?? "a value is missing"}. Nothing written, the provider was not queried. Paste this token again from the Integrations screen.`;
    default:
      return `· ${where}: ${report.writtenAs ?? "the target"} already exists on this project. Nothing touched.`;
  }
}

const reports = await adoptPastedTokens();
if (reports.length === 0) console.log("Nothing to adopt: every token has already been probed.");
for (const report of reports) console.log(line(report));

const written = reports.filter((r) => r.outcome === ADOPT_OUTCOME.adopted).length;
console.log(`\n${written} row(s) written, ${reports.length - written} left untouched.`);
