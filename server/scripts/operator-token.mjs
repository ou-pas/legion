// Reset an operator token from the machine hosting the control plane (13/09).
//
// The token is printed once, at the startup that creates it, which assumes someone reads the
// startup log. Legion updates itself from the screen and nobody watches a terminal then: without
// this script a self-updating instance could lock its operator out.
//
// It cannot show the current token: the database keeps only its hash, so that a leaked database
// gives no way in. There is no "recover", only "reset".
//
// Sessions already open stay open, which lets the operator reset the token without logging out.
//
// It lives in `server/`, not the root `scripts/` (knip said so): it talks to the server's database
// with the server's dependency, and a root declaring `better-sqlite3` for one script would install
// a native module for nothing on every machine.
import Database from "better-sqlite3";
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const SERVER = fileURLToPath(new URL("..", import.meta.url));

/** Same resolution as `server/src/shared/db.ts`: `LEGION_DB`, else `legion.db` in the server
 *  directory, the running control plane's cwd. The wrong database would store the hash where
 *  nobody reads it, and the script would still report success. */
const DB_PATH = process.env.LEGION_DB ?? join(SERVER, "legion.db");

if (!existsSync(DB_PATH)) {
  console.error(
    `⛔ database not found: ${DB_PATH}\n` +
      "   Run this script from the repository on the machine hosting the control plane,\n" +
      "   or give the path: LEGION_DB=/path/legion.db make operator-token",
  );
  process.exit(1);
}

const db = new Database(DB_PATH);
db.pragma("busy_timeout = 5000");

const token = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(token).digest("hex");

db.prepare(
  "INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
).run("operator.token_hash", hash);
db.close();

console.log(`\n  ${token}\n`);
console.log("Paste it into the sign-in screen. It will not be shown again.");
console.log("The old token no longer works; sessions already open stay open.");
