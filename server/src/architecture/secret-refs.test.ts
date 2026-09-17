// No template composes an auth prefix onto a secret reference (15/09).
//
// `${SECRET:NAME}` (`resolveSecretRefs`, `capabilities/capabilities.ts`) substitutes a secret's
// value into hand-written config (MCP server headers, container env). It knows only a name, not
// `metadata.authFormat`, so the config author would write `Bearer ` in front without knowing
// whether the token stored under that name wants one.
//
// Not theoretical since adoption: `connections/adopt-pasted.ts` stores a Linear personal key under
// `LINEAR_TOKEN`, and that key is sent raw; a template composing `Bearer` breaks it. The demo seed
// and the MCP screen placeholder did exactly that, the mistake `AUTH_FORMAT` removed from the code,
// left in the examples where it gets copied.
//
// Absolute threshold: each occurrence is a broken config someone is asked to copy. A text scan,
// not an import graph: these strings are data (a placeholder, a seed JSON).
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** An auth scheme (RFC 9110: a word, then a space) stuck before a secret reference:
 *  `Bearer ${SECRET:X}`, `token ${SECRET:X}`, `Basic ${SECRET:X}`. */
const COMPOSED_PREFIX = /\b[A-Za-z][A-Za-z0-9-]* \$\{SECRET:/;

/** Comments are stripped first: this file and `resolveSecretRefs` quote `Bearer ${SECRET:…}` to
 *  explain why not to write it, and a rule you cannot name in a comment stops being explained.
 *
 *  Not a parser: a string containing `//` gets truncated. Harmless here, the error can only go
 *  towards missing a twisted case, never a false positive. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/[^\n]*/g, " ");
}

/** Markdown counts: adding `docs/wiki` without widening this pattern scanned zero files, since the
 *  wiki is all `.md`. A guard that can find nothing is worse than none, because it reassures. */
const SCANNED = /\.(ts|tsx|mts|md)$/;

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) sources(path, out);
    else if (SCANNED.test(entry)) out.push(path);
  }
  return out;
}

describe("secret references in templates", () => {
  it("no example or seed composes a prefix before `${SECRET:…}`", () => {
    // The five trees where a template can live. `docs/wiki` matters most: a guide page is written
    // to be copied. `server/scripts` and `runner-payload` ship config to a container.
    const guilty = [
      ...sources(join(ROOT, "server", "src")),
      ...sources(join(ROOT, "server", "scripts")),
      ...sources(join(ROOT, "web", "src")),
      ...sources(join(ROOT, "runner-payload")),
      ...sources(join(ROOT, "docs", "wiki")),
    ]
      .filter((path) => COMPOSED_PREFIX.test(withoutComments(readFileSync(path, "utf8"))))
      .map((path) => relative(ROOT, path));

    assert.deepEqual(
      guilty,
      [],
      "`${SECRET:…}` only sees a name: the header format is not composed there, it is read from `metadata.authFormat`",
    );
  });
});
