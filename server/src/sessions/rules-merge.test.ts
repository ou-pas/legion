// Merging the two rule sources. The module ships in the session image, which has no TypeScript:
// imported as is, THE CODE THAT RUNS is what is tested.
//
// These tests hold the precedence. The repository wins (operator's decision of 27/08, right for a
// convention), except on a locked rule, because a repository file is written by anyone who can
// push, agent included. If that line moves unintentionally, an agent can loosen its own leash, and
// nothing else would say so.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mergeRules,
  parseRuleFile,
  renderRulesSection,
  repoHead,
  REPO_HEAD_MAX,
} from "../../../runner-payload/rules-merge.mjs";
// The other half of the boundary: the one that WRITES the frontmatter the module above rereads.
import { ruleFileText } from "../capabilities/rule-scope.js";

type Rule = {
  name: string;
  head: string;
  file: string | null;
  body: string | null;
  locked: boolean;
};
type RepoRule = { name: string; summary: string; body: string; path: string; repo: string };

const projet = (over: Partial<Rule> = {}): Rule => ({
  name: "never-plain-secrets",
  head: "No plain-text secret.",
  file: null,
  body: null,
  locked: false,
  ...over,
});

const depot = (over: Partial<RepoRule> = {}): RepoRule => ({
  name: "never-plain-secrets",
  summary: "Repository version.",
  body: "body",
  path: "./repos/backend/.claude/rules/never-plain-secrets.md",
  repo: "backend",
  ...over,
});

describe("parseRuleFile: a rule file's frontmatter", () => {
  it("without frontmatter, the name comes from the file", () => {
    const r = parseRuleFile("eloquent-conventions.md", "# Eloquent\n\nNo Repository.");
    assert.equal(r.name, "eloquent-conventions");
    assert.equal(r.summary, "");
    assert.equal(r.body, "# Eloquent\n\nNo Repository.");
  });

  it("`description:` counts as `summary:`: the key of files written for Claude Code", () => {
    // Without it, dropping in an existing `.claude/rules/` folder would give thirty-four rules without
    // summary, hence thirty-four truncated heads, and all the work on summaries would be lost.
    const r = parseRuleFile("x.md", "---\ndescription: One sentence.\n---\nbody");
    assert.equal(r.summary, "One sentence.");
    assert.equal(r.body, "body");
  });

  it("frontmatter `name:` wins over the file name", () => {
    assert.equal(parseRuleFile("x.md", '---\nname: "Real name"\n---\nbody').name, "Real name");
  });
});

describe("repoHead: what a repository rule may inject", () => {
  it("its summary when it has one", () => {
    assert.deepEqual(repoHead({ summary: "short", body: "x".repeat(9999) }), {
      head: "short",
      truncated: false,
    });
  });

  it("ONLY ITS BEGINNING when it has none, otherwise 27 kB come back through the window", () => {
    const v = repoHead({ summary: "", body: "x".repeat(9999) });
    assert.equal(v.truncated, true);
    assert.ok(v.head.length <= REPO_HEAD_MAX, `expected <= ${REPO_HEAD_MAX}, got ${v.head.length}`);
  });

  it("a short rule without summary passes whole, without truncation mark", () => {
    assert.deepEqual(repoHead({ summary: "", body: "three words" }), {
      head: "three words",
      truncated: false,
    });
  });

  it("the cut prefers a line end to the middle of a word", () => {
    const body = "a".repeat(300) + "\n" + "b".repeat(300);
    assert.equal(repoHead({ summary: "", body }).head, "a".repeat(300));
  });
});

describe("mergeRules: the precedence of the two sources", () => {
  it("THE REPOSITORY REPLACES a project rule with the same name", () => {
    const { rules, overridden } = mergeRules([projet()], [depot()]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.head, "Repository version.");
    assert.equal(rules[0]!.source, "backend");
    assert.equal(overridden.length, 1);
  });

  it("A LOCKED RULE CANNOT BE REPLACED, and the file is refused", () => {
    // The case justifying the lock: an agent with write rights pushes a file named after a guardrail.
    // Without this refusal it just loosened its own leash.
    const { rules, blocked, overridden } = mergeRules([projet({ locked: true })], [depot()]);
    assert.equal(rules.length, 1);
    assert.equal(rules[0]!.head, "No plain-text secret.");
    assert.equal(rules[0]!.source, null);
    assert.equal(overridden.length, 0);
    assert.equal(blocked.length, 1);
  });

  it("the comparison ignores case and surrounding spaces", () => {
    const { overridden } = mergeRules(
      [projet({ name: "Never-Plain-Secrets" })],
      [depot({ name: " never-plain-secrets " })],
    );
    assert.equal(overridden.length, 1);
  });

  it("without collision, both sources add up", () => {
    const { rules, overridden } = mergeRules([projet()], [depot({ name: "eloquent-conventions" })]);
    assert.equal(rules.length, 2);
    assert.equal(overridden.length, 0);
  });

  it("an EMPTY repository rule does not enter: a title without instruction reads as an oversight", () => {
    const { rules } = mergeRules([], [depot({ name: "empty", summary: "", body: "   " })]);
    assert.deepEqual(rules, []);
  });

  it("no source returns an empty list, not an exception", () => {
    assert.deepEqual(mergeRules(undefined, null).rules, []);
  });
});

describe("renderRulesSection: one section, one place rendering it", () => {
  it("names the repository a rule comes from, and quotes the full text path", () => {
    const { rules } = mergeRules([], [depot({ name: "eloquent" })]);
    const out = renderRulesSection(rules);
    assert.match(out, /### eloquent \(from repo backend\)/);
    assert.match(out, /FULL TEXT: \.\/repos\/backend\/\.claude\/rules\//);
  });

  it("SAYS a head is truncated, otherwise the agent believes it has the whole rule", () => {
    const { rules } = mergeRules([], [depot({ summary: "", body: "x".repeat(9999) })]);
    assert.match(renderRulesSection(rules), /only its beginning/);
  });

  it("a short project rule has neither origin nor path", () => {
    const out = renderRulesSection(mergeRules([projet()], []).rules);
    assert.match(out, /### never-plain-secrets\nNo plain-text secret\./);
    assert.doesNotMatch(out, /FULL TEXT/);
    assert.doesNotMatch(out, /from repo/);
  });

  it("no rule = no section, not an empty title", () => {
    assert.equal(renderRulesSection([]), "");
  });
});

// The boundary between the two frontmatter grammars (v60).
//
// There are two, structurally: `ruleFileText` WRITES the frontmatter in TypeScript on the server,
// `parseRuleFile` REREADS it in the runner payload. They cannot share code (the same boundary that
// ruled out a shared slug, see the header of `rules-merge.mts`), so nothing would stop one drifting
// from the other.
//
// Nothing but these tests. They do the ROUND TRIP: what the server writes, the runner must reread
// identically. Drift shows here and nowhere else: malformed frontmatter does not fail, it reads as
// a body without header.
//
// v62: what leaves the prompt, and what stays. A glob-scoped rule is loaded by the SDK when it
// applies: injecting it too would say it twice. But it must not vanish from the prompt WITHOUT A
// TRACE: a front agent seeing no `web/` convention would invent one. The section NAMES it without
// its text, and these tests hold both halves of that compromise.
describe("renderRulesSection: a scoped rule leaves the prompt but announces itself there", () => {
  it("a scoped rule's TEXT is no longer in the section", () => {
    const out = renderRulesSection([
      { name: "design-system", head: "", file: null, body: null, locked: false, source: null },
    ]);
    assert.match(
      out,
      /design-system/,
      "its NAME stays: otherwise the agent does not know it exists",
    );
    assert.match(out, /Rules that load when they apply/);
    assert.doesNotMatch(
      out,
      /### design-system\n/,
      "no section of its own: that is the weight removed",
    );
  });

  it("it is called NON-NEGOTIABLE despite having no text", () => {
    // "Not in the prompt" does not mean "optional". Without that word a missing rule reads as a
    // suggestion, the opposite of what it is.
    const out = renderRulesSection([
      { name: "x", head: "", file: null, body: null, locked: false, source: null },
    ]);
    assert.match(out, /ALSO non-negotiable/);
  });

  it("both kinds coexist in a single section", () => {
    const out = renderRulesSection([
      {
        name: "secrets",
        head: "No plain-text secret.",
        file: null,
        body: null,
        locked: true,
        source: null,
      },
      { name: "design-system", head: "", file: null, body: null, locked: false, source: null },
    ]);
    assert.match(out, /### secrets\nNo plain-text secret\./);
    assert.match(out, /- design-system/);
    // Anchored `^##` rather than `/## Rules/`: the `### Rules that load…` subtitle contains the same
    // substring, and the unanchored version counted two titles where there is one.
    assert.equal(out.match(/^## /gm)?.length, 1, "one level-2 title, not two stacked sections");
  });

  it("ONLY scoped rules still give a section, never an orphan title", () => {
    const out = renderRulesSection([
      { name: "a", head: "", file: null, body: null, locked: false, source: null },
    ]);
    assert.match(out, /^## Rules/);
    assert.doesNotMatch(out, /## Rules \(non-negotiable, apply to ALL your work\)\n\n\n/);
  });

  it("a scoped repository rule's origin is stated there too", () => {
    const out = renderRulesSection([
      {
        name: "php-conventions",
        head: "",
        file: null,
        body: null,
        locked: false,
        source: "backend",
      },
    ]);
    assert.match(out, /- php-conventions \(from repo backend\)/);
  });
});

describe("ruleFileText → parseRuleFile: the round trip between the two grammars", () => {
  it("a simple name and a body cross unchanged", () => {
    const text = ruleFileText("eloquent-conventions", [], "No Repository.");
    const relu = parseRuleFile("eloquent-conventions.md", text) as { name: string; body: string };
    assert.equal(relu.name, "eloquent-conventions");
    assert.equal(relu.body, "No Repository.");
  });

  it("a name containing significant YAML characters crosses too", () => {
    // `:` opens a pair, `#` a comment, `*` an anchor. Unquoted, the document is invalid and the name
    // read back would be truncated, or the whole file read as body.
    const nom = 'Eloquent: no Repository #1 "strict"';
    const relu = parseRuleFile("x.md", ruleFileText(nom, ["a/**"], "body")) as {
      name: string;
      body: string;
    };
    assert.equal(relu.name, nom, "the name must come back identical, quotes and colons included");
    assert.equal(relu.body, "body");
  });

  it("globs do NOT pollute the body read back", () => {
    // `parseRuleFile` does not know `paths:` and need not: the SDK honours it. What matters is that it
    // removes the whole block: a `paths:` left in the body would go into the prompt as if it were an
    // instruction.
    const text = ruleFileText(
      "front",
      ["repos/front/**/*.tsx", "repos/front/**/*.ts"],
      "# Conventions\n\nsome text",
    );
    const relu = parseRuleFile("front.md", text) as { body: string };
    assert.equal(relu.body, "# Conventions\n\nsome text");
    assert.doesNotMatch(relu.body, /paths:/);
  });

  it("a file already carrying frontmatter does not get a second one", () => {
    // Otherwise the first block would become body and the second would no longer be at the top: both
    // would be lost, silently.
    const depose = '---\nname: "set by hand"\npaths:\n  - "x/**"\n---\n\nsome text';
    assert.equal(ruleFileText("other name", ["y/**"], depose), depose);
    const relu = parseRuleFile("z.md", ruleFileText("other name", ["y/**"], depose)) as {
      name: string;
    };
    assert.equal(
      relu.name,
      "set by hand",
      "the file's frontmatter is authoritative over the database name",
    );
  });
});
