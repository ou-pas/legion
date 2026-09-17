// capabilities: what the session puts on its disk before talking to the model.
//
// Split from `runReal` on 06/09 with no behaviour change. Three steps that are one: repositories
// learn to ignore `.claude/`, granted skills are written under `<cwd>/.claude/skills`, and rule
// bodies are written then merged with those the cloned repositories carry.
//
// Together because they all write the workspace's `.claude/` and all depend on the clone (a
// repository's `.claude/rules/*.md` only exist after it). Split, they would pass `cwd` and `repos`
// around and step on each other.
//
// It reads and writes a real disk, so it is not tested in memory; it imports without side effects,
// and the rule it applies, the merge itself, lives in rules-merge, tested apart
// (`rules-merge.test.ts`).
import fsx from "node:fs";
import pathx from "node:path";
import { MAX_RULE_BYTES, mergeRules, parseRuleFile, renderRulesSection } from "./rules-merge.mjs";
import type { ClonedRepo } from "./repo-grants.mjs";
import type { Report } from "./runner-io.mjs";
import type { SessionSpec } from "./session-spec.mjs";

/** What these three steps receive: the relevant part of the spec, the workspace, the cloned
 *  repositories, and the event log. `loadCapabilities` passes it all to each. */
type CapabilityDeps = {
  spec: Pick<SessionSpec, "skills" | "rules" | "builtinTools">;
  cwd: string;
  repos: ClonedRepo[];
  report: Report;
};

/** Belt and braces: even if the agent copied .claude/ into a repository, it would not go out with
 *  `git add -A` (review 5b #1).
 *
 *  Moved out of the skills block (v41): a session with no skill but with rule bodies would have
 *  written an unexcluded `.claude/`, and the first `git add -A` would have put project instructions
 *  into a PR. */
async function excludeClaudeFromRepos({ spec, repos, report }: CapabilityDeps) {
  if ((spec.skills?.length ?? 0) === 0 && (spec.rules?.length ?? 0) === 0) return;
  for (const r of repos) {
    try {
      fsx.mkdirSync(pathx.join(r.dir, ".git", "info"), { recursive: true });
      fsx.appendFileSync(pathx.join(r.dir, ".git", "info", "exclude"), "\n.claude/\n");
    } catch (err) {
      await report("run_warning", {
        message: `exclude .claude/ failed: ${(err as Error)?.message}`,
      });
    }
  }
}

/** Granted skills (Phase 5b): shipped in the payload, written to <cwd>/.claude/skills/<name>
 *  (auto-discovered by the CLI from cwd), then enabled through the `skills` option. */
async function writeSkills({ spec, cwd, report }: CapabilityDeps): Promise<string[]> {
  const skillNames: string[] = [];
  if (Array.isArray(spec.skills) && spec.skills.length) {
    const skillsRoot = pathx.resolve(cwd, ".claude", "skills");
    for (const s of spec.skills) {
      const dir = pathx.resolve(skillsRoot, s.name);
      let wrote = 0;
      for (const f of s.files ?? []) {
        const dest = pathx.resolve(dir, f.path);
        if (dest !== dir && !dest.startsWith(dir + pathx.sep)) continue; // no traversal
        fsx.mkdirSync(pathx.dirname(dest), { recursive: true });
        fsx.writeFileSync(dest, Buffer.from(f.b64, "base64"));
        wrote++;
      }
      if (wrote) skillNames.push(s.name);
    }
    if (skillNames.length) await report("capabilities", { skills: skillNames });
  }
  return skillNames;
}

/** v41/v42: rules. Project bodies written to disk, merged with the repositories' rules, then the
 *  `## Rules` section rendered once.
 *
 *  The merge can only happen here: a repository's `.claude/rules/*.md` exist only after the clone.
 *  The server sends its rules as data and renders nothing itself; half a section written there could
 *  not be removed when a file replaces it. */
async function loadRules({ spec, cwd, repos, report }: CapabilityDeps): Promise<string> {
  let rulesSection = "";
  const projectRules = Array.isArray(spec.rules) ? spec.rules : [];

  // 1. Project bodies, in <cwd>/.claude/rules: outside any repository, so outside the end-of-session
  //    `git add -A`. The path comes from the spec, not recomputed: it is the one the prompt cites. It
  //    is still checked to stay under the folder, even though it comes from us.
  //
  //    v60: `diskPath`, not `file`. They diverge as soon as a rule has globs, because such a file is
  //    written for the SDK to load, not to be cited in the prompt. Writing from `file` would skip
  //    exactly the files v60 exists to write.
  const rulesRoot = pathx.resolve(cwd, ".claude", "rules");
  for (const r of projectRules) {
    // `?? r.file`: a tolerant reader, not decorative. Server and image deploy separately; a pre-v60
    // server only sends `file`, and reading only `diskPath` would silently write no rule body at all.
    const path = r.diskPath ?? r.file;
    if (!path || !r.body) continue;
    const dest = pathx.resolve(cwd, String(path));
    if (!dest.startsWith(rulesRoot + pathx.sep)) continue;
    fsx.mkdirSync(pathx.dirname(dest), { recursive: true });
    fsx.writeFileSync(dest, String(r.body), "utf8");
  }

  // 2. Repository scan. One level, `.claude/rules/*.md`, no recursion: a convention is a file, not a
  //    tree, and descending would read kilobytes nobody asked for.
  const repoRules = [];
  for (const r of repos) {
    const dir = pathx.join(r.dir, ".claude", "rules");
    let names;
    try {
      names = fsx.readdirSync(dir);
    } catch {
      continue;
    }
    for (const f of names) {
      if (!/\.mdc?$/i.test(f)) continue;
      const full = pathx.join(dir, f);
      try {
        if (fsx.statSync(full).size > MAX_RULE_BYTES) continue;
        const parsed = parseRuleFile(f, fsx.readFileSync(full, "utf8"));
        repoRules.push({ ...parsed, repo: r.name, path: `./repos/${r.name}/.claude/rules/${f}` });
      } catch (err) {
        await report("run_warning", {
          message: `rule ${full} unreadable: ${(err as Error)?.message}`,
        });
      }
    }
  }

  // 3. The merge, and the trace says it. A silent substitution is exactly what we do not want: the
  //    operator must be able to read that a file replaced their rule and that a lock refused another.
  const merged = mergeRules(projectRules, repoRules);
  rulesSection = renderRulesSection(merged.rules);
  if (merged.rules.length || merged.blocked.length)
    await report("capabilities", {
      rules: merged.rules.length,
      rulesFromRepo: merged.rules.filter((r) => r.source).length,
      rulesOverridden: merged.overridden.map((o) => `${o.name} ← ${o.path}`),
      rulesBlocked: merged.blocked.map((b) => `${b.name} ← ${b.path}`),
    });
  return rulesSection;
}

/** The order is the contract: exclusion first, before a single file enters a repository, then
 *  skills, rules last, the only step needing the cloned repositories.
 *
 * `cwd` is the workspace, outside any repository and so outside the final `git add -A`; `repos` are
 * the cloned repositories whose `.claude/rules` are scanned.
 */
export async function loadCapabilities(deps: CapabilityDeps) {
  await excludeClaudeFromRepos(deps);
  // v65: what the session may call, stated in the trace next to skills and rules. `tools` is a real
  // exposure list: a tool not in it does not exist for the model and disappears without an event (no
  // call, so no refusal, so nothing to read). A line naming the list makes a shrink visible the day
  // it was not intended.
  await deps.report("capabilities", { tools: deps.spec.builtinTools ?? [] });
  return {
    skillNames: await writeSkills(deps),
    rulesSection: await loadRules(deps),
  };
}
