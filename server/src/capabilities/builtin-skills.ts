// Skills shipped with Legion, written to disk at boot if absent, never rewritten once edited.
//
// On disk rather than in code, unlike built-in agents (chains/catalog.ts), because the two answer
// opposite needs: a built-in agent must not come back after deletion, while a skill must be
// editable by whoever uses it (D8, /artifacts/rtQLldYSm2/spec.md). A skill regenerated at every
// boot would silently overwrite that improvement.
//
// The folder is authoritative: if it exists, nothing is completed (the D16 test), and a file is
// replaced only when it is byte for byte a content Legion shipped earlier (17/09, when the skills
// moved to English). The accepted cost: a later skill fix never reaches an install that changed
// its copy.
//
// Writing is needed at all because otherwise the `interviewer` agent would point to a missing
// skill. `catalogInconsistencies()` (chains/catalog.ts) fails if a built-in agent cites a name
// absent from this registry.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { SKILLS_DIR } from "./capabilities.js";

export type BuiltinSkill = { name: string; files: { path: string; content: string }[] };

/** The role is `interviewer`, the technique `grilling` (D17): one word for both would prevent
 *  changing one without the other. */
export const GRILLING_SKILL_NAME = "grilling";
/** Context discipline. Named `lean-ctx` because the operator already used that name. */
export const LEAN_CTX_SKILL_NAME = "lean-ctx";
/** The three protocols of the `feature` chain (slice 05). As with `grilling`, the roles (`spec`,
 *  `prober`, `slicer`) and techniques have different names. Adapted from the operator's slice
 *  workflow to the container: nobody is at the window, everything goes through artifacts and
 *  the inbox. */
export const SPECIFY_SKILL_NAME = "specify";
export const PROBE_SKILL_NAME = "probe";
export const SLICE_SKILL_NAME = "slice";

const GRILLING_SKILL_MD = `---
name: grilling
description: Run an interview that puts a brief to the test BEFORE work starts — facts are looked up, trade-offs are asked. Use it as soon as a request arrives too thin to be run as is.
---

# Grilling — putting a brief to the test

Your job is not to write the spec the human has in mind. It is to discover WHAT THEY HAVE NOT
DECIDED YET, and to have them decide it — with the facts in front of them.

## The rule that governs everything else

**Facts are looked up. Trade-offs are asked.**

A question whose answer is in the repository is a question stolen from the human: it uses up a
round for nothing and only teaches you that they had not opened the file either. A decision you
take alone because it "seemed obvious" is a decision nobody took.

So, before EACH round:

1. Read the code involved. Not the file names: their content.
2. If a fact is missing and not in the repository (an external API, a library behaviour, a
   format), look it up on the web and **open the page** — never quote a search result summary
   you have not read.
3. What remains after these two passes, and only that, becomes a question.

## The shape of a round

A round = **a single** \`inbox_ask\` **call** with a \`form\` — never one question at a time, each
call costs the human a full pause/wake cycle. It reads in ten seconds, on a phone, without
opening the session. It contains:

- A title (\`question\`) that says what is being decided, ≤ 80 characters. An opening markdown of
  **5 lines at most**: what is settled, what the round closes. What you read (paths, lines,
  excerpts) goes in \`evidence\`, what the answer affects in \`impact\` — the screen shows them apart.
- 2 to 5 fields. The label IS the question, phrased as a question, ≤ 90 characters, with no
  context in it. One idea per field: an "and" in a label is two fields.
- On a choice: 2 to 4 options ≤ 60 characters that say what WILL HAPPEN ("One table per
  round"), never "Option A". Your **pre-checked recommendation** (\`default\`) and a \`hint\` that
  STARTS with the conclusion — "Recommended: X, because Y." — then, only if it changes the
  decision, one sentence on what the other choice costs. The human confirms, or contradicts you
  knowingly.
- An SVG when the question is about a shape (flow, state, tree): one more sentence never
  replaces a diagram.

No "why?" field: each question already has its free note, which comes back to you in
\`<fieldId>__note\`, and the round its comment (\`__comment\`). **Read them**: the real information is often there.

## What makes a bad round

- Asking for a surface preference ("which name do you prefer?") when a constraint in the code
  actually leaves only one option. Look first; if there is only one option, say it.
- Asking five detail questions before settling the underlying question they depend on.
  Order them: what makes the other questions moot comes first.
- Restating the agreement reached in the previous round instead of moving forward. A round that
  does not move the spec is a wasted round.
- Hiding a disagreement. If the human chooses what you did not recommend, write the decision AND
  write that it went against your recommendation, with their reason — not yours.

## When to stop

You stop when a round no longer produces a question that would change the work. Not when you
have reached a number of rounds: there is **no cap**, and the session's turn budget already
covers the risk of drift. A two-round interview on a clear request is a good interview.

Before the last round, ask for explicit confirmation: here is the spec, here is what it
commits to, do we keep it like this?

## What you produce

**\`spec.md\` in the run artifacts**, always. The shape:
   - the problem observed, with what the code confirms (file:line);
   - the decisions, **numbered**, each with THE HUMAN'S reason, quoted as such;
   - the alternatives set aside and why;
   - the questions left open — written as questions, never dressed up as facts;
   - how we will check it is done.
Then, two possible endings, and YOUR TASK says which one. Check whether it carries an approval
**gate**:

**With a gate — you are step 1 of a chain.** Leave the task for review, do not finish it, and
propose NOTHING: the Probe reads your \`spec.md\` and the Breakdown turns it into ordered slices.
Proposing here would duplicate the work the chain is going to cut.

**Without a gate — you are a standalone interview.** Propose **a task whose brief IS the spec**
(\`propose_task\`): a task cannot read another task's artifacts, but it always reads its own
brief. Still point to \`spec.md\` — the brief carries what is actionable, the file carries the
interview. A **prerequisite** is proposed first, and what waits for it CITES it: keep the
returned id, pass it back in \`blockerIds\`, otherwise both start in any order. Then finish your
task (\`update_task\` to \`done\`): the proposal arrives in "later", unassigned, the approval gate
is there, do not ask for a second one.

Cutting a spec into four tasks is NOT your job: it belongs to the \`slicer\`, which returns a
batch approved in one gesture. If the spec calls for a breakdown, say so in the proposal's brief.

## What you never write

A behaviour you have not checked, presented as a fact. If you cannot read it in the code or in
a page you opened, it is an open question. A spec that asserts gets believed; a spec that
separates what it knows from what it assumes gets followed.
`;

const LEAN_CTX_SKILL_MD = `---
name: lean-ctx
description: Keep your context lean — search before reading, read a range rather than a file, never pass a large output through your window. Invoke it at the START of a task that touches a repository you do not know, and read it again as soon as you feel the budget being spent without the work moving.
---

# Lean context

Your context window is finite, and it is the only limit that matters here: every byte you let
into it, you pay for again on every following turn. A two-thousand-line file read at turn 3 is
still there at turn 40, and it has cost thirty-seven times its price.

Being lean is therefore not penny-pinching. It is what decides whether the task fits in the
session or dies three turns from the goal.

## Search before reading

A pattern returns ten lines. A file returns a thousand. When you are looking for WHERE
something happens, you search; when you know where, you read.

    rg -n "registerXRoutes" server/src        # ten lines, you know where to go
    Read server/src/http/app.ts               # nine hundred lines, you do not know yet

A \`grep\` with context (\`-A 5\`, \`-B 3\`) is almost always enough to decide whether to open
the file. Read it afterwards, if the answer is yes.

## Read a range, not a file

Read tools take an offset and a length. You found your function at line 812: read from 790 to
860. You will read further if it falls short, and it will rarely fall short.

## Never reread what you just wrote

An edit tool that did not fail succeeded. Rereading the file to "check" doubles its price and
teaches you nothing. What checks an edit is the compiler or the test, not your eyes.

## Do not pass a large output through your window

It is the most expensive gesture of all, and the easiest to avoid.

    pnpm test                                 # three thousand green lines
    pnpm test 2>&1 | tail -20                 # the verdict

    git diff                                  # everything
    git diff --stat                           # the files and the volumes
    git diff -- server/src/sessions           # what you are actually looking at

    ls -R .                                   # no
    rg --files -g '*.test.ts' | wc -l         # a number, when a number is what you need

On a failing test, you want the failure, not the suite: \`| grep -B2 -A20 "not ok"\`. On a
build, \`| head -20\`: the following errors are almost always the same one.

## What you do not open

\`node_modules\`, \`vendor\`, \`dist\`, \`build\`, \`.git\`, a lock file, a test snapshot, a
minified file. If you need a fact that lives there, search for it, do not read it.

## Delegate a broad search

When you have subagents, an exploration that will touch twenty files is delegated: you get the
conclusion back, not the twenty files. It is the only way to read a lot without paying a lot.

## Write as you go

A fact you wrote in your artifact is a fact you can forget. A note costs a hundred bytes once;
the same fact kept "in mind" costs its passage on every turn, and it disappears anyway if the
session is resumed.

Write as you go, not at the end. It is also what makes your work readable if you stop before
finishing.

## The sign that it is time to stop and shrink

You reread the same files. You search again for something you had already found. You summarise
your own work to remember it. All three mean the same thing: your window already carries more
than you use.

Write the state down in your artifact, say what is left, and carry on from there.
`;

const SPECIFY_SKILL_MD = `---
name: specify
description: Give a request the shape of a spec — Problem, numbered observable behaviours, Seams, Decisions, Out of scope — with no code and no file path. Use it to write spec.md in the run artifacts, before the Probe reads it.
---

# The shape of a spec

You write \`spec.md\` in the run artifacts, from the request and from what the conversation
upstream has already settled. Three readers will go over it, in this order: the operator, who
approves it; the Probe, which counts what it leaves unsaid; the Breakdown, which turns it into
slices. Each one reads a specific section, and that is why the shape is not negotiable.

## The project's words

Use the project's words for its own concepts, those of the brief and its context. You do not
have the repository at hand: what depends on the code and is not said in the brief is not a
fact you guess, it is a question. What only the operator can decide is asked through the inbox,
in one round that carries all the questions at once. What remains open despite that is written
as a question, never dressed up as a fact.

## The shape

\`\`\`markdown
# <what this work is>

## Problem
What is missing or wrong, as the user sees it. Not the implementation.

## Behaviours
A NUMBERED list, from 1 to N, with no gap and no duplicate. Each behaviour is observable and
phrased as an outcome: something you could watch happen.

## Seams
Where the behaviour can be observed without going inside it, and why each seam earns its place.

## Decisions
X rather than Y, because Z. One line per decision.

## Out of scope
What this work deliberately does not do.
\`\`\`

The numbers matter: the Probe names an edge by the behaviour's number (\`B4/empty\`), and a
spec with no numbered behaviour, or with two behaviours sharing a number, cannot be probed — it
will come back to you. The behaviours become the slices' criteria, so each one must be
something you can watch.

Seams that already exist are worth more than new ones; the highest one that still observes the
behaviour is worth more than a lower one; the fewer there are, the better.

The Decisions section keeps the ones that come from upstream in place, as they are; you add
yours after them. That is where the Probe will later write the operator's answers, one line per
edge.

**No code, no file path.** The exception is a shape that prose really cannot pin down — a
state machine, a schema — inlined, reduced to the decision it encodes. Everything else ages
faster than the prose around it, and a spec that cites a renamed file still reads as true.

## What makes a bad spec

- A behaviour that describes a mechanism ("the server updates the column") rather than an
  outcome you watch ("the task shows as unblocked on the board").
- Two behaviours in one sentence. If an "and" separates two observable things, they are two
  numbers.
- A decision without its "because". A decision whose reason nobody knows gets argued again at
  every reread.
- A fact you have not checked, presented as a fact.

## When you are done

Drop \`spec.md\` and leave the task for review. You do not finish it: it is a gated step, the
operator approves it. Do not probe it yourself and do not write an edges file: that is the
Probe's work, and a checker that has seen the author's answer is no longer independent.
`;

const PROBE_SKILL_MD = `---
name: probe
description: Probe a spec against a fixed taxonomy of edges, count what it leaves open, and have the operator settle each open edge through the inbox, one round at a time. Use it on a written spec.md, before any breakdown.
---

# Probe — counting what a spec leaves unsaid

You look for the questions a spec does not ask. You do not judge it, you do not rewrite it, you
decide nothing in its place: you count, and you have it settled.

Your only input is \`spec.md\`, in the run artifacts. You have no access to the repository, and
that is on purpose: settling an edge from what the code does today is taking the code for the
spec — exactly the mistake this step exists to catch.

Every applicable category is raised, whatever impression the spec leaves on you.

## 0. Can the spec be probed?

A spec is probed through its NUMBERED behaviours. If there are none, or if two share the same
number, it cannot be probed: write it at the top of \`SPEC-EDGES.md\`, in one line that says
which of the two cases, and leave the task for review without asking any question. The operator
runs the Interview step again, then you.

## 1. Give each behaviour a shape

Take each numbered behaviour and classify what it operates on: \`numeric-range\`,
\`collection\`, \`text\`, \`date\`, \`stateful\`, \`io\`. Several shapes can apply.

Each numbered behaviour gets its shape line. A behaviour without a line is an oversight, not a
pass. A behaviour whose wording visibly calls for an edge but matches no shape is marked
\`unclassified — review by hand\`: a signal, never a block.

## 2. Raise only what applies

| Category | Question | Shapes |
|---|---|---|
| \`empty\` | What is the outcome for zero items, a single one, or null? | collection, text |
| \`boundary\` | What happens exactly at the threshold, and one step either side? | numeric-range, collection |
| \`precision\` | Where can precision be lost — money, rounding, time zone? What is the exact contract? | numeric-range, date |
| \`ordering\` | When two items are equal, is the order defined and stable? | collection |
| \`encoding\` | Which definition of length and equality — bytes, code points, graphemes? | text |
| \`idempotency\` | What happens if it runs twice on the same input? | stateful, io |
| \`concurrency\` | Two actors at the same time — what is guaranteed? | stateful, io |
| \`permission\` | Who is not allowed, and what exactly do they see? | always |

An edge is identified by the behaviour's number and the category: \`B4/empty\`. That id is what
travels, in the edges file, in the inbox question, and later in the slices' criteria.

## 3. Resolve each one

| State | Meaning |
|---|---|
| \`resolved\` / \`explicit\` | the spec answers it — cite the behaviour or decision that does |
| \`resolved\` / \`backstop\` | the rule is known but does not fit in prose — a property test will stand in for it |
| \`dismissed\` | does not apply here — **a written reason, always** |
| \`unresolved\` | nobody has dealt with it yet |

A dismissal is a written reason: "N/A: the input is a bounded enumeration, there is no
threshold."

A \`backstop\` is an obligation, not an escape hatch: it becomes a \`property\` criterion on the
slice that covers it, and the certifier will refuse that slice without the test's output.

## 4. Write the edges file

\`SPEC-EDGES.md\`, beside the spec, in the run artifacts:

\`\`\`
B2 — "failed webhooks are replayed"                shapes: stateful, io
  idempotency  unresolved   If the replay fires twice, does the target receive two calls?
  concurrency  resolved     explicit — behaviour 7 locks by webhook_id during the replay
  permission   dismissed    N/A — triggered by the system, never reached by a user

coverage: applicable 3 · resolved 2 · unresolved 1
\`\`\`

You count, you do not grade. This file has one writer, and it is you: the operator never edits
it. Their answer reaches you through the inbox, and you are the one who writes it down.

## 5. Have what remains open settled: one round, one question

Nobody is in the window. What is \`unresolved\` after your pass is not settled by waiting: it is
asked of the operator, through the inbox, and they are the only one who can do it.

A round = **one single inbox question**, with a \`form\`, that carries ALL the open edges of the
round: one field per edge, whose label starts with the edge's id (\`B4/empty — …\`) and whose id
repeats it with only the allowed characters (\`B4_empty\`). Never one edge per question: your
session goes to sleep at each question and only resumes on the answer, and there is only ever
one open question per Probe.

A well-formed field carries the question as it is in the edges file, as \`text\` or
\`textarea\`: it is a decision entrusted to you, not a choice among options you would have
invented. When the spec only lets two outcomes show, a \`radio\` with your recommendation as
\`default\` and its reason in one sentence in the \`hint\` ("Recommended: X, because Y."). An
opening markdown of five lines at most says how many edges are open and what the round closes.

The answer comes back to you as JSON, one key per field. For each key:

- a non-empty value resolves the edge: write it **in both places**, in \`SPEC-EDGES.md\`
  as \`resolved / explicit — human\` with the answer quoted, AND in the \`## Decisions\` section of
  \`spec.md\`, in one line that cites the behaviour in full ("Behaviour 4: …").
  It is because it is in the spec that a Probe run again will find it \`explicit\` without asking
  it again;
- an empty value resolves nothing: the edge stays \`unresolved\` and comes back in the next round.

A resolved edge is never asked again. If open edges remain, ask a new round, with only those.

## 6. Leave it for review

When no applicable edge is left unresolved: count again, rewrite the coverage line, and leave
the task for review. You do not finish it: it is a gated step, only the operator finishes it, on
the strength of the edges file.

If you are run again, you start from \`spec.md\` alone and rewrite \`SPEC-EDGES.md\` from
scratch. The answers already given are in the spec's decisions: you will find them \`explicit\`.
`;

const SLICE_SKILL_MD = `---
name: slice
description: Cut a probed spec into buildable slices, each with its observable outcome, its validation command and one to three criteria with a mode, dropped in slices.json so the operator approves the batch in one gesture. Use it when spec.md and SPEC-EDGES.md are in the run artifacts.
---

# Breakdown — from a probed spec to slices

A slice is a task that a fresh session carries from start to finish, and that the operator
judges on criteria written in advance. You write them, the operator approves the batch, and the
server turns them into tasks.

## 1. The gate, first

Read \`SPEC-EDGES.md\` in the run artifacts. **An applicable edge still \`unresolved\`
stops you here**: do not drop a batch, say which one in your report and leave the task for
review. Slicing on top of an open edge buries the question in a slice that cannot answer it.
The operator runs the Probe again, then you.

No edges file beside the spec: same thing. Probing is not your job.

## 2. Name the subject of each behaviour, and open it

For each behaviour you are going to slice, find the module that will carry it and **read it**.
You are done when you can name, for each one, the file and the exported symbol the slice will
touch. You read the repository; you do not write to it.

This is the step that catches a behaviour aimed at code nobody calls any more. A test file named
after a module does not prove the module is alive: open the import.

**While you are at it, look for what would make the change easy.** Make the change easy, then
make the easy change. A preparatory refactor you find becomes its own slice, the first one, and
everything else is blocked by it.

## 3. Cut vertically

Each slice cuts a narrow but complete path: schema, API, screen, tests. A finished slice
demonstrates itself on its own, and fits in a fresh session.

| Rule | Bound |
|---|---|
| Criteria | 1 to 3, never more: the server refuses the batch at the fourth — cut again |
| Blockers | only the slices that truly condition it |
| Preparatory refactor | its own slice, first |

**Broad refactors are the exception.** When a mechanical change breaks hundreds of callers at
once and no vertical cut can go green, sequence it: **expand**, the new shape beside the old
one, nothing breaks; **migrate**, one slice per batch sized to the blast radius, each blocked by
the expand, each green on its own because the old shape still holds; **contract**, the old
shape removed, blocked by every batch.

## 4. What a slice carries

- \`label\`: a non-empty label. It is not an identity, two slices can share one: in the batch, a
  slice is designated by its RANK, from 1 to N, in array order.
- \`successMeans\`: a single observable outcome. If it needs an "and", it is two slices.
- \`validatedBy\`: the exact command someone else runs to see what you saw.
  Keep the raw command, its whole output gets pasted; it is the criterion that says what to look
  for in it. Reducing the output to a number is the trap: a command that never ran still lets the
  counter return one, and a count reads as a success. When several steps or a condition are
  needed, it is a test: write it, and \`validatedBy\` runs it.
- \`criteria\`: one to three, each \`{ text, mode, edge? }\`. \`text\`: a behaviour you could
  watch happen. \`mode\`: exactly one of \`test\` (a test named in the suite, and its output),
  \`property\` (a property test, run, output shown), \`check\` (a command run, its whole
  output), \`human\` (what was looked at, and what was seen), \`waived\` (the written reason).
  \`edge\`: required on a \`property\`, the id of the edge covered, \`B4/empty\`. A criterion is
  designated by its position, from 1 to 3.
- \`blockedBy\`: the ranks of the slices that block it, each once, never its own.

Every edge the Probe resolved as \`backstop\` becomes a \`property\` criterion that cites it, on
the slice that covers it. A \`backstop\` nobody cites is not an oversight caught later: the
certifier refuses the slice.

No file path, no code, in the criteria text: they age faster than the prose around them.

## 5. The artifact

\`slices.json\`, in the run artifacts, exactly this shape:

\`\`\`json
{
  "slices": [
    {
      "label": "Blockers in a join table",
      "successMeans": "A task can be blocked by several tasks and is only released by the last one.",
      "validatedBy": "node --import tsx --test server/src/tasks/blockers.test.ts",
      "criteria": [
        { "text": "A task with two blockers stays blocked when the first one finishes", "mode": "test" },
        { "text": "The last blocker to finish releases the task once, whatever the order", "mode": "property", "edge": "B8/concurrency" }
      ],
      "blockedBy": []
    },
    {
      "label": "The board says by how many",
      "successMeans": "A task blocked by two tasks shows its two blockers.",
      "validatedBy": "pnpm --filter @legion/web test -- board",
      "criteria": [{ "text": "The count and names of the remaining blockers are visible on the card", "mode": "human" }],
      "blockedBy": [1]
    }
  ]
}
\`\`\`

The server refuses a faulty batch by naming all its faults, slice by slice then for the batch
(zero slices, blockers in a cycle). The refusal arrives in the brief of your next run: fix what
it names, drop it again. The batch read is the one present at the moment of approval: a new
drop replaces the previous one.

## 6. Leave it for review

When the batch is dropped, leave the task for review. You do not finish it: the operator's
approval of the batch is what finishes this step and creates the slices, in one gesture. In
your report, a numbered list: rank, label, what the slice delivers, what blocks it.
That is what the operator reads before approving, and it is where they judge the granularity.
`;

/** Built-in skills. `grilling` is an interview technique carried by one role; `lean-ctx` is a
 *  discipline for any agent touching a repository, meant as a project default rather than an
 *  agent grant. `specify`, `probe` and `slice` are the `feature` chain's protocols: the chain
 *  imposes step order and gates; how each step works lives here, on disk, editable. */
export const BUILTIN_SKILLS: BuiltinSkill[] = [
  { name: GRILLING_SKILL_NAME, files: [{ path: "SKILL.md", content: GRILLING_SKILL_MD }] },
  { name: LEAN_CTX_SKILL_NAME, files: [{ path: "SKILL.md", content: LEAN_CTX_SKILL_MD }] },
  { name: SPECIFY_SKILL_NAME, files: [{ path: "SKILL.md", content: SPECIFY_SKILL_MD }] },
  { name: PROBE_SKILL_NAME, files: [{ path: "SKILL.md", content: PROBE_SKILL_MD }] },
  { name: SLICE_SKILL_NAME, files: [{ path: "SKILL.md", content: SLICE_SKILL_MD }] },
];

/** sha256 of every file content Legion shipped before the current one, per skill. A file on disk
 *  hashing to one of these was never edited, so replacing it overrides nobody. Append the old hash
 *  when a skill's content changes. The French copies of 12/09 to 16/09 are the first entries. */
const SHIPPED_BEFORE: Record<string, readonly string[]> = {
  [GRILLING_SKILL_NAME]: ["1b5369adc075098906132d7738d79b49321a9ef0a5a10da8b50a54452e49b1a0"],
  [LEAN_CTX_SKILL_NAME]: ["a2ac2a6b29d3e65b13b3791cee413b1355057c01abeb4c1ec37139540e044c37"],
  [SPECIFY_SKILL_NAME]: ["846ab65f7b309e586dc62e74d205de1ce78f406af38715a4db6c338910b8276d"],
  [PROBE_SKILL_NAME]: ["f1c9ebc7a62644735c4c10f3bd01afb24134b971fd78d3a9d4594a7190ae3f64"],
  [SLICE_SKILL_NAME]: ["58656e3345252683372749536565c60b4246f3aae6e3147fd0345b22b5d1dc55"],
};

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** `kept` is every existing skill not upgraded; `edited` the part of it that differs from what
 *  Legion ships today (an operator's change, or a removed file), reported so an upgrade that did
 *  not happen is visible. */
export type BuiltinSkillsResult = {
  written: string[];
  upgraded: string[];
  kept: string[];
  edited: string[];
};

/** Replaces the files of an existing skill folder that still hold a previously shipped content,
 *  byte for byte, and says what the folder turned out to be. */
function upgradeUntouchedFiles(
  skill: BuiltinSkill,
  target: string,
  shipped: readonly string[],
): "upgraded" | "edited" | "current" {
  let upgraded = false;
  let edited = false;
  for (const file of skill.files) {
    const onDisk = path.join(target, file.path);
    const content = fs.existsSync(onDisk) ? fs.readFileSync(onDisk, "utf8") : null;
    if (content === file.content) continue;
    if (content !== null && shipped.includes(sha256(content))) {
      fs.writeFileSync(onDisk, file.content, "utf8");
      upgraded = true;
    } else edited = true;
  }
  if (upgraded) return "upgraded";
  return edited ? "edited" : "current";
}

/**
 * Writes missing built-in skills, and upgrades the files of existing ones nobody edited. `dir`
 * and `shippedBefore` exist for tests only.
 *
 * A skill whose folder exists is otherwise left intact (D16): a missing file is not recreated and
 * an edited file is not replaced. Completing it "just a little" would break that: an operator who
 * deliberately emptied a skill would see it grow back at every boot.
 */
export function installBuiltinSkills(
  dir: string = SKILLS_DIR,
  shippedBefore: Record<string, readonly string[]> = SHIPPED_BEFORE,
): BuiltinSkillsResult {
  const result: BuiltinSkillsResult = { written: [], upgraded: [], kept: [], edited: [] };
  for (const skill of BUILTIN_SKILLS) {
    const target = path.join(dir, skill.name);
    if (fs.existsSync(target)) {
      const state = upgradeUntouchedFiles(skill, target, shippedBefore[skill.name] ?? []);
      if (state === "upgraded") result.upgraded.push(skill.name);
      else result.kept.push(skill.name);
      if (state === "edited") result.edited.push(skill.name);
      continue;
    }
    fs.mkdirSync(target, { recursive: true });
    for (const file of skill.files)
      fs.writeFileSync(path.join(target, file.path), file.content, "utf8");
    result.written.push(skill.name);
  }
  return result;
}
