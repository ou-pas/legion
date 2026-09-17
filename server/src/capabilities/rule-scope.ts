// What goes into the prompt and what waits on disk.
//
// Rules used to be pasted verbatim into the system prompt of every session carrying them. That
// holds at 1 kB and eighteen rules; at 10 kB and thirty-four, a front-end agent would carry
// 140 kB of instructions before reading a line of code.
//
//  1. Repository scope: an Eloquent convention has no place in a front-end session. A rule now
//     carries its repositories, as an agent carries its own.
//  2. Summary and body: the prompt carries each applicable rule's summary, so the agent knows the
//     rule and what it imposes; the body sits in the workspace to read when needed. Unlike a
//     skill, the summary is always there, not an invitation that can be ignored.
//
// The default changes nothing: an empty summary means a short rule, sent whole as before, so
// existing rules migrate without a byte of difference.
//
// Pure module: no database, no disk. It decides, it does not write.

/** What preparing a rule needs. Structural on purpose: the module does not know the database
 *  row. */
export interface RuleLike {
  name: string;
  content: string;
  /** v42: no repository file may replace this rule. Travels to the container, where the merge
   *  happens. */
  locked?: boolean;
  /** Empty = the rule is short, its body is its summary. */
  summary: string;
  /** JSON `string[]`. Empty = applies whatever the repositories. */
  repoNames: string;
  /** v60: JSON `string[]` of globs. Empty = always applies. Optional because tests and the
   *  memory-to-rule suggestion have no opinion. */
  paths?: string;
}

export interface PreparedRule {
  name: string;
  /** v42: copied from the rule; the container needs it to settle a collision. */
  locked: boolean;
  /** What goes into the system prompt.
   *
   *  v62: empty means the rule is glob-scoped; its file carries it and the SDK loads it when it
   *  applies. The runner leaves it out of the section, but it stays in the merge so its lock
   *  still arbitrates. */
  head: string;
  /** The path cited in the prompt, or `null` when the prompt already carries the whole text.
   *
   *  v60: distinct from `diskPath`. A glob rule's file is written for the SDK to load, and
   *  inviting the agent to "read the full text" right after giving it would read as a
   *  contradiction. */
  file: string | null;
  /** v60: where the file is written in the workspace, or `null` when there is none. */
  diskPath: string | null;
  /** The file to write, frontmatter included, or `null`. */
  body: string | null;
}

/** Where bodies land, relative to the session workspace: the same `.claude/rules/` agents already
 *  know from repositories. */
export const RULES_DIR = ".claude/rules";

/** A rule name is human-written (accents, spaces, punctuation, sometimes a slash) and cannot be a
 *  file name as-is. Traversal is blocked by construction: no `/` survives. */
export function ruleSlug(name: string): string {
  const s = name
    // Diacritics are removed by their escaped Unicode range, never pasted raw: a combining
    // character is invisible in review and lost on copy.
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // A fully non-alphanumeric name ("⚠️") would give an empty slug, a path naming the folder
  // itself. The fallback slug "regle" predates the English move and is left unchanged.
  return s || "regle";
}

/** Does the rule apply to an agent carrying these repositories? An empty list applies everywhere
 *  (the default, so a migration never silently drops instructions); otherwise they must
 *  intersect. */
export function ruleApplies(
  rule: { repoNames: string },
  agentRepoNames: readonly string[],
): boolean {
  let scoped: string[];
  try {
    scoped = JSON.parse(rule.repoNames) as string[];
  } catch {
    return true; // an unreadable scope is no reason to silence a rule
  }
  if (!Array.isArray(scoped) || scoped.length === 0) return true;
  return scoped.some((r) => agentRepoNames.includes(r));
}

/** A rule's globs from their JSON column. An unreadable value gives an empty list: the worst case
 *  is the rule applying everywhere, its historical behaviour, rather than a guardrail silently
 *  vanishing. */
export function parseGlobs(paths: string | undefined): string[] {
  if (!paths) return [];
  try {
    const raw = JSON.parse(paths) as unknown;
    if (!Array.isArray(raw)) return [];
    return [
      ...new Set(
        raw
          .filter((g): g is string => typeof g === "string")
          .map((g) => g.trim())
          .filter(Boolean),
      ),
    ];
  } catch {
    return [];
  }
}

/** A rule written as Claude Code would write it (v60): a `.claude/rules/*.md` frontmatter carries
 *  `paths:`, the only field the SDK honours.
 *
 *  Two keys only, `name:` and `paths:`, short scalars safe to serialise. The summary stays out:
 *  free text, often multi-line, it would produce invalid YAML now and then, and the prompt is its
 *  only reader.
 *
 *  A `content` that already has frontmatter is left intact: stacking a second `---` block would
 *  break both. */
export function ruleFileText(name: string, globs: readonly string[], content: string): string {
  if (/^---\r?\n/.test(content)) return content;
  const lines = [`name: ${yamlScalar(name)}`];
  if (globs.length) lines.push("paths:", ...globs.map((g) => `  - ${yamlScalar(g)}`));
  return `---\n${lines.join("\n")}\n---\n\n${content}\n`;
}

/** A YAML scalar, always double-quoted: a human-written name sooner or later contains `:`, `#` or
 *  `*`. Newlines become a space. */
function yamlScalar(value: string): string {
  const escaped = value
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")
    .trim();
  return `"${escaped}"`;
}

/** Prepares a batch of rules, because file name collisions only show here: "API contracts" and
 *  "api-contracts" give the same slug, and the second body would silently replace the first. A
 *  numeric suffix is added here so the prompt cites exactly the path the runner writes.
 *
 *  Three fates for a rule:
 *
 *   · No summary, no glob: sent whole in the prompt, no file. The default (31 of 32 rules).
 *   · A summary (v41): the prompt carries the summary and cites the path of the body on disk.
 *   · Globs (v62): the rule leaves the prompt. The SDK loads its file when the session opens a
 *     matching file (`load_reason: 'path_glob_match'`).
 *
 *  The third was measured before being written: native loading was off until v61. Session
 *  `0CWpeiHGxMAx` (03/09) shows it in its trace:
 *
 *      instructions:        [".claude/rules/design-system-non-negociable.md"]
 *      instructionsReason:  "path_glob_match"
 *      instructionsTrigger: "repos/legion/web/src/tasks/TaskPage.tsx"
 *
 *  A glob fires when the agent reads a matching file, so a scoped rule is absent on the first turn
 *  and may never arrive if the agent writes a new file without reading one nearby. Fine for a
 *  convention, not for a guardrail: `secrets-jamais-en-clair` and process rules never take a
 *  glob (the screen says so). */
export function prepareRules(rules: readonly RuleLike[]): PreparedRule[] {
  const used = new Set<string>();
  return rules.map((r) => {
    const summary = r.summary.trim();
    const content = r.content.trim();
    const locked = r.locked === true;
    const globs = parseGlobs(r.paths);
    if (!summary && globs.length === 0)
      return { name: r.name, locked, head: content, file: null, diskPath: null, body: null };

    let slug = ruleSlug(r.name);
    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    used.add(slug);
    const diskPath = `${RULES_DIR}/${slug}.md`;
    return {
      name: r.name,
      locked,
      // v62: a glob rule has no head, which is the whole gain. An empty `head` keeps it out of
      // the section, and `promptBytes` counts it as ~0.
      head: globs.length > 0 ? "" : summary || content,
      // Generous writer, bitten on 04/09: a runner with an outdated image reads `file` and ignores
      // `diskPath`. With `file: null` it wrote no file for a glob rule, whose head is empty, so
      // the rule vanished from both prompt and disk. An up-to-date runner does not read `file` in
      // that branch; the runner's tolerant reader (`r.diskPath ?? r.file`) covers the other way.
      file: summary || globs.length > 0 ? diskPath : null,
      diskPath,
      body: ruleFileText(r.name, globs, content),
    };
  });
}

/** The real weight of a rule set in the system prompt, in UTF-8 bytes, measured rather than
 *  assumed: nothing used to say a prompt had grown. */
export function promptBytes(prepared: readonly PreparedRule[]): number {
  return prepared.reduce(
    (n, r) => n + Buffer.byteLength(`### ${r.name}\n${r.head}\n\n`, "utf8"),
    0,
  );
}
