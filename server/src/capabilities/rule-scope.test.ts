// The default changes nothing: a rule without scope or summary behaves exactly as before v41,
// or the migration would silently remove instructions from sessions.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  parseGlobs,
  prepareRules,
  promptBytes,
  ruleApplies,
  ruleSlug,
  RULES_DIR,
} from "./rule-scope.js";

const rule = (over: Partial<Parameters<typeof prepareRules>[0][number]> = {}) => ({
  name: "convention",
  content: "the whole body",
  summary: "",
  repoNames: "[]",
  ...over,
});

describe("ruleApplies, repository scope", () => {
  it("applies an empty scope everywhere: the previous behaviour and the default", () => {
    assert.equal(ruleApplies({ repoNames: "[]" }, []), true);
    assert.equal(ruleApplies({ repoNames: "[]" }, ["acme"]), true);
  });

  it("requires an intersection for a named scope", () => {
    assert.equal(ruleApplies({ repoNames: '["backend"]' }, ["backend"]), true);
    assert.equal(ruleApplies({ repoNames: '["backend"]' }, ["acme"]), false);
  });

  it("needs only one repository in common", () => {
    assert.equal(ruleApplies({ repoNames: '["backend","docker"]' }, ["acme", "backend"]), true);
  });

  it("does not silence the rule on an unreadable scope", () => {
    // Err towards showing too much rather than hiding an instruction.
    assert.equal(ruleApplies({ repoNames: "not json" }, []), true);
  });
});

describe("ruleSlug, a human name becomes a file name", () => {
  // Accented on purpose: diacritics must be stripped.
  it("drops accents, spaces and capitals", () => {
    assert.equal(ruleSlug("Café API — snake case"), "cafe-api-snake-case");
  });

  it("lets no slash survive: traversal is impossible by construction", () => {
    assert.equal(ruleSlug("../../etc/passwd"), "etc-passwd");
    assert.equal(ruleSlug("/absolute"), "absolute");
  });

  it("still returns a name when no character is alphanumeric", () => {
    // Otherwise the path would name the folder itself.
    assert.equal(ruleSlug("!!!"), "regle");
  });
});

describe("prepareRules, head, body and the path between them", () => {
  it("without summary or glob, the body is the head and nothing goes to disk", () => {
    assert.deepEqual(prepareRules([rule()]), [
      {
        name: "convention",
        locked: false,
        head: "the whole body",
        file: null,
        diskPath: null,
        body: null,
      },
    ]);
  });

  it("with a summary, the head is the summary and the body goes to the workspace", () => {
    const [p] = prepareRules([rule({ name: "Eloquent", summary: "No Repository." })]);
    assert.equal(p!.head, "No Repository.");
    assert.equal(p!.file, `${RULES_DIR}/eloquent.md`);
    assert.equal(p!.diskPath, `${RULES_DIR}/eloquent.md`);
    assert.match(p!.body!, /^---\nname: "Eloquent"\n---\n\nthe whole body\n$/);
  });

  it("does not let two names with the same slug overwrite each other", () => {
    // Without a suffix the second body would silently replace the first.
    const [a, b] = prepareRules([
      rule({ name: "API contracts", summary: "r1", content: "body 1" }),
      rule({ name: "api-contracts", summary: "r2", content: "body 2" }),
    ]);
    assert.equal(a!.file, `${RULES_DIR}/api-contracts.md`);
    assert.equal(b!.file, `${RULES_DIR}/api-contracts-2.md`);
  });

  it("treats a whitespace summary as absent", () => {
    assert.equal(prepareRules([rule({ summary: "   " })])[0]!.file, null);
  });
});

describe("globs (v60), when the rule applies", () => {
  it("writes a file and removes the rule from the prompt (v62)", () => {
    // Session `0CWpeiHGxMAx` proved the SDK loads the file at the right time
    // (`load_reason: 'path_glob_match'`); before that proof v60 wrote the file without removing
    // anything.
    const [p] = prepareRules([rule({ name: "front", paths: '["repos/front/**/*.tsx"]' })]);
    assert.equal(p!.head, "", "empty head = the file carries it, the prompt no longer does");
    assert.equal(p!.diskPath, `${RULES_DIR}/front.md`);
    assert.match(p!.body!, /paths:\n  - "repos\/front\/\*\*\/\*\.tsx"/);
  });

  it("sets `file` for a scoped rule: an outdated runner writes from it alone", () => {
    // Bitten on 04/09: an image that ignores `diskPath` wrote no file for a rule with an empty
    // head, so the rule vanished from prompt and disk.
    const [p] = prepareRules([rule({ name: "front", paths: '["a/**"]' })]);
    assert.equal(p!.file, p!.diskPath, "both fields carry the same path");
    assert.ok(p!.body, "and there is a body to write");
  });

  it("still writes no file for a rule with neither summary nor globs", () => {
    // 31 of 32 rules are in this case and must keep going whole into the prompt.
    const [p] = prepareRules([rule()]);
    assert.equal(p!.file, null);
    assert.equal(p!.diskPath, null);
    assert.equal(p!.body, null);
  });

  it("lets globs win over a summary: the mechanisms do not stack", () => {
    // Keeping both would say the rule twice, which v62 exists to avoid.
    const [p] = prepareRules([rule({ summary: "a summary", paths: '["a/**"]' })]);
    assert.equal(p!.head, "", "the summary does not go into the prompt: the glob wins");
    assert.ok(p!.diskPath, "the file still exists: it carries the rule");
  });

  it("drops a scoped rule's prompt weight to almost nothing", () => {
    const bare = promptBytes(prepareRules([rule({ content: "x".repeat(10_000) })]));
    const scoped = promptBytes(
      prepareRules([rule({ content: "x".repeat(10_000), paths: '["a/**"]' })]),
    );
    assert.ok(bare > 10_000, `expected > 10 000 bytes, got ${bare}`);
    assert.ok(scoped < 60, `expected < 60 bytes (name and newlines), got ${scoped}`);
  });

  it("writes a valid .claude/rules file: frontmatter then body", () => {
    const [p] = prepareRules([rule({ name: "Eloquent: no Repository", paths: '["a/**","b/**"]' })]);
    assert.equal(
      p!.body,
      '---\nname: "Eloquent: no Repository"\npaths:\n  - "a/**"\n  - "b/**"\n---\n\nthe whole body\n',
    );
  });

  it("leaves content that already has frontmatter intact", () => {
    // A second `---` block would break both.
    const dropped = '---\npaths:\n  - "x/**"\n---\n\n# My rule\n\nsome text';
    const [p] = prepareRules([rule({ summary: "a summary", content: dropped })]);
    assert.equal(p!.body, dropped);
  });

  it("quotes a name with significant YAML characters", () => {
    // An unquoted `:` or `#` makes the frontmatter invalid, and Claude Code silently reads the
    // rule as headerless body.
    const [p] = prepareRules([rule({ name: 'a: b #c "d"', paths: '["x/**"]' })]);
    assert.match(p!.body!, /^---\nname: "a: b #c \\"d\\""\n/);
  });

  it("reads unreadable glob JSON as an empty list, never a vanishing rule", () => {
    assert.deepEqual(parseGlobs("not json"), []);
    assert.deepEqual(parseGlobs('{"not":"an array"}'), []);
    assert.deepEqual(parseGlobs(undefined), []);
    assert.equal(prepareRules([rule({ paths: "broken" })])[0]!.diskPath, null);
  });

  it("deduplicates and trims globs", () => {
    assert.deepEqual(parseGlobs('["  a/** ","a/**","","b/**"]'), ["a/**", "b/**"]);
  });
});

describe("promptBytes, the measure", () => {
  it("counts the head, not the body", () => {
    const short = promptBytes(
      prepareRules([rule({ summary: "three words", content: "x".repeat(10_000) })]),
    );
    const long = promptBytes(prepareRules([rule({ content: "x".repeat(10_000) })]));
    assert.ok(short < 100, `expected < 100 bytes, got ${short}`);
    assert.ok(long > 10_000, `expected > 10 000 bytes, got ${long}`);
  });

  // Accented on purpose: an accented letter is two UTF-8 bytes.
  it("counts bytes, not characters", () => {
    const plain = promptBytes([
      { name: "n", locked: false, head: "aaa", file: null, diskPath: null, body: null },
    ]);
    const accented = promptBytes([
      { name: "n", locked: false, head: "ààà", file: null, diskPath: null, body: null },
    ]);
    assert.equal(accented - plain, 3);
  });
});

describe("the lock travels to the container", () => {
  it("is copied as-is and false by default", () => {
    assert.equal(prepareRules([rule()])[0]!.locked, false);
    assert.equal(prepareRules([rule({ locked: true })])[0]!.locked, true);
    assert.equal(prepareRules([rule({ locked: true, summary: "short" })])[0]!.locked, true);
  });
});
