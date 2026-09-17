// A modified skill is never overwritten: D8 made executable (/artifacts/rtQLldYSm2/spec.md). A
// skill regenerated at boot would silently undo the operator's edits. The D16 test is below.
// Symmetrically, a missing skill must be written, or the built-in agent arrives broken.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import {
  BUILTIN_SKILLS,
  GRILLING_SKILL_NAME,
  installBuiltinSkills,
  PROBE_SKILL_NAME,
  SLICE_SKILL_NAME,
  SPECIFY_SKILL_NAME,
} from "./builtin-skills.js";

const root = mkdtempSync(join(tmpdir(), "legion-skills-"));
after(() => rmSync(root, { recursive: true, force: true }));

let n = 0;
const freshDir = () => {
  const dir = join(root, `s${++n}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

describe("built-in skills, written when absent", () => {
  it("writes the interview skill on first boot, with its SKILL.md", () => {
    const dir = freshDir();
    const res = installBuiltinSkills(dir);
    assert.deepEqual(res.written.sort(), [...BUILTIN_SKILLS].map((s) => s.name).sort());
    assert.deepEqual(res.kept, []);
    const md = fs.readFileSync(join(dir, GRILLING_SKILL_NAME, "SKILL.md"), "utf8");
    // `listSkills()` reads the frontmatter: without `description:` the skill shows unexplained.
    assert.match(md, /^---\nname: grilling\ndescription: .+/);
  });

  it("rewrites nothing on second boot", () => {
    const dir = freshDir();
    installBuiltinSkills(dir);
    const res = installBuiltinSkills(dir);
    assert.deepEqual(res.written, []);
    assert.deepEqual(res.kept.sort(), [...BUILTIN_SKILLS].map((s) => s.name).sort());
  });

  it("D16: a modified skill survives a restart, to the letter", () => {
    const dir = freshDir();
    installBuiltinSkills(dir);
    const md = join(dir, GRILLING_SKILL_NAME, "SKILL.md");
    const mine =
      "---\nname: grilling\ndescription: my own technique\n---\n\nTwo rounds, no more.\n";
    fs.writeFileSync(md, mine, "utf8");
    fs.writeFileSync(join(dir, GRILLING_SKILL_NAME, "examples.md"), "my examples", "utf8");

    installBuiltinSkills(dir);

    assert.equal(fs.readFileSync(md, "utf8"), mine);
    assert.equal(
      fs.readFileSync(join(dir, GRILLING_SKILL_NAME, "examples.md"), "utf8"),
      "my examples",
    );
  });

  describe("a copy Legion shipped earlier", () => {
    // The French copies of 12/09-16/09 are known by hash only; a stand-in content plays their role.
    const OLD =
      "---\nname: grilling\ndescription: ancienne version\n---\n\nUne question à la fois.\n";
    const shipped = {
      [GRILLING_SKILL_NAME]: [createHash("sha256").update(OLD, "utf8").digest("hex")],
    };
    const md = (dir: string) => join(dir, GRILLING_SKILL_NAME, "SKILL.md");
    const current = BUILTIN_SKILLS.find((s) => s.name === GRILLING_SKILL_NAME)!.files[0]!.content;

    it("is upgraded when untouched", () => {
      const dir = freshDir();
      installBuiltinSkills(dir);
      fs.writeFileSync(md(dir), OLD, "utf8");

      const res = installBuiltinSkills(dir, shipped);

      assert.deepEqual(res.upgraded, [GRILLING_SKILL_NAME]);
      assert.equal(res.kept.includes(GRILLING_SKILL_NAME), false);
      assert.equal(fs.readFileSync(md(dir), "utf8"), current);
    });

    it("is left alone and reported once someone edited it, even by one byte", () => {
      const dir = freshDir();
      installBuiltinSkills(dir);
      fs.writeFileSync(md(dir), `${OLD}\n`, "utf8");

      const res = installBuiltinSkills(dir, shipped);

      assert.deepEqual(res.upgraded, []);
      assert.deepEqual(res.edited, [GRILLING_SKILL_NAME]);
      assert.equal(fs.readFileSync(md(dir), "utf8"), `${OLD}\n`);
    });

    it("upgrades once: the next boot finds the current content and reports nothing", () => {
      const dir = freshDir();
      installBuiltinSkills(dir);
      fs.writeFileSync(md(dir), OLD, "utf8");
      installBuiltinSkills(dir, shipped);

      const res = installBuiltinSkills(dir, shipped);

      assert.deepEqual(res.upgraded, []);
      assert.deepEqual(res.edited, []);
    });
  });

  it("leaves a hand-emptied folder empty: the folder is authoritative, not its content", () => {
    // Completing a missing SKILL.md would decide in place of the operator who deleted it.
    const dir = freshDir();
    installBuiltinSkills(dir);
    fs.rmSync(join(dir, GRILLING_SKILL_NAME, "SKILL.md"));

    const res = installBuiltinSkills(dir);

    assert.ok(res.kept.includes(GRILLING_SKILL_NAME), "the emptied folder is kept as-is");
    assert.equal(fs.existsSync(join(dir, GRILLING_SKILL_NAME, "SKILL.md")), false);
  });

  // The `feature` chain's three protocols (slice 05). Checked: not style but the instructions a
  // containerised agent cannot guess (one inbox question per round, the answer written in both
  // places, the exact shape of slices.json, a criterion's five modes).
  const content = (name: string) =>
    BUILTIN_SKILLS.find((s) => s.name === name)!.files.find((f) => f.path === "SKILL.md")!.content;

  it("registers specify, probe and slice, each with its frontmatter", () => {
    const dir = freshDir();
    installBuiltinSkills(dir);
    for (const name of [SPECIFY_SKILL_NAME, PROBE_SKILL_NAME, SLICE_SKILL_NAME]) {
      const md = fs.readFileSync(join(dir, name, "SKILL.md"), "utf8");
      assert.match(md, new RegExp(`^---\\nname: ${name}\\ndescription: .+`), name);
    }
  });

  it("probe asks a round as one inbox question, writes in both places, leaves for review", () => {
    const md = content(PROBE_SKILL_NAME);
    assert.match(md, /one single inbox question/);
    assert.match(md, /one field per edge/);
    assert.match(md, /SPEC-EDGES\.md/);
    assert.match(md, /explicit — human/);
    assert.match(md, /`## Decisions` section of\s+`spec\.md`/);
    assert.match(md, /leave the task for review/);
    for (const cat of [
      "empty",
      "boundary",
      "precision",
      "ordering",
      "encoding",
      "idempotency",
      "concurrency",
      "permission",
    ])
      assert.match(md, new RegExp(`\`${cat}\``), cat);
  });

  it("slice states the slices.json shape, the one-to-three criteria rule and the five modes", () => {
    const md = content(SLICE_SKILL_NAME);
    assert.match(md, /`slices\.json`/);
    for (const key of ["label", "successMeans", "validatedBy", "criteria", "blockedBy", "edge"])
      assert.match(md, new RegExp(`"${key}"`), key);
    assert.match(md, /1 to 3/);
    for (const mode of ["test", "property", "check", "human", "waived"])
      assert.match(md, new RegExp(`\`${mode}\``), mode);
    // The example must be valid JSON of the fixed shape, or the agent copies a mistake.
    const example = /```json\n([\s\S]+?)\n```/.exec(md)![1]!;
    const lot = JSON.parse(example) as {
      slices: { blockedBy: number[]; criteria: { mode: string }[] }[];
    };
    assert.equal(lot.slices.length, 2);
    assert.deepEqual(lot.slices[1]!.blockedBy, [1]);
  });

  it("specify's shape: Problem, numbered Behaviours, Seams, Decisions, Out of scope, no code or path", () => {
    const md = content(SPECIFY_SKILL_NAME);
    for (const section of [
      "## Problem",
      "## Behaviours",
      "## Seams",
      "## Decisions",
      "## Out of scope",
    ])
      assert.match(md, new RegExp(section), section);
    assert.match(md, /NUMBERED/);
    assert.match(md, /No code, no file path/);
  });

  it("gives every built-in skill a SKILL.md at its root", () => {
    // `listSkills()` and `packSkills()` (capabilities.ts) start from this file.
    for (const s of BUILTIN_SKILLS) {
      assert.ok(
        s.files.some((f) => f.path === "SKILL.md"),
        `${s.name} without SKILL.md`,
      );
      assert.match(s.name, /^[\w][\w.-]*$/, `${s.name}: name refused by packSkills`);
    }
  });
});
