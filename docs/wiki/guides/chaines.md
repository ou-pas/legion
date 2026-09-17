# Chains and goals

A chain links several [[concepts/agent|agents]] around one intention: specify, probe, break down,
implement, review. Each step hands over to the next when it is done.

Two chains ship with the product. `bugfix` goes from reproduction to the minimal fix, in five steps,
and writes the failing test before writing the fix. `feature` carries the deeper work, and the rest
of this page describes it.

## The five steps of feature

Interview, Probe, Breakdown, Wiki, Human review. Each is blocked by the previous one at launch.

Interview questions you about the request, round by round, and writes the spec with your reasons.
Probe rereads that spec without ever opening the repository and counts what it leaves unsaid.
Breakdown reads both and proposes a batch of slices. Wiki writes what the run changed for the people
who use it. Human review makes a summary with links to each artifact.

Until 8 September, step 1 was held by an agent that wrote the spec alone, from the request, settling
on its own what it did not know. The interviewer holds it now, and does the opposite: it looks for
facts in the repository and on the web, then asks you for the trade-offs. The previous agent still
exists and can still be assigned to a standalone task.

Four of these five steps are gates: Interview, Probe, Breakdown and Human review. A gated step does
not finish on its own. Its agent puts it up for review, and you are the one who moves it to done. An
agent asking for `done` on a gated step is refused with a message saying so, and its task does not
move.

`feature` replaces `compound-engineer`, which went through nine fixed steps whatever the work. A copy
of `compound-engineer` already installed in a project stays as it is and keeps running: an installed
chain is a snapshot, not a link to the catalogue.

## The probe

The Probe agent has no access to the repository. It only reads the spec, and that is the point: a
spec judged while looking at the code is a spec reread through what already exists.

Next to the spec, it writes the edges file. Every numbered behaviour carries its form there, and
every applicable edge carries a state: resolved, dismissed with its reason, or unresolved. A spec
with no numbered behaviour cannot be probed, and the Probe writes that at the top of the file rather
than inventing an answer.

Edges still open go into a single [[guides/inbox|inbox]] question, one field per edge. There is only
ever one open question per Probe: its session stops there, resumes on your answer, and asks another
round as long as edges remain open. A field left empty resolves nothing, the edge comes back next
round. When no applicable edge is open any more, the Probe puts itself up for review, and you finish
it on the strength of the edges file.

## Breakdown and approving the batch

The Breakdown agent reads the spec and the edges file, drops a batch of slices, and puts itself up
for review. The batch is an artifact like any other: if it drops a second one, the latest present is
the one read.

You approve the batch in one move, from the page of the Breakdown step in review (Approve the batch).
That move alone finishes the step, and it does everything else in the same transaction: each slice
becomes a task of the run, blocked by the slices it declared, assigned to the agent the project binds
to the `build` role, carrying its validation command, its criteria and a gate; the Wiki step becomes
blocked by every slice; then Breakdown moves to done. All or nothing: an interrupted transaction
leaves neither task nor link, and the step stays in review.

An invalid batch is refused and nothing is created. All its faults are named, not just the first,
slice by slice then batch-wide, blocking cycles included. The refusal is shown and written into the
task's thread; you run the Breakdown step again, and its agent finds the refusal in its brief.

Approving twice is refused, since the step is already done. Approving from any status other than
review is refused too.

## What a slice is

A slice is a [[concepts/tache|task]] of the run with three things more.

One observable outcome, a single one, saying what you will be able to watch happen once it is done.
A validation command, the one you run to judge it. And one to three criteria, each with its mode:
`test` for a test named in the suite, `property` for a property test citing the edge it covers,
`check` for a command and its output, `human` for what was looked at, `waived` for a written reason.

One to three, because a slice that needs seven criteria is two slices. Criteria are referred to by
position, and the task page shows them in the same order as its agent's brief, with the validation
command.

A slice is a gated step. Its agent can put it up for review, never move it to done: you judge, on
criteria written before the code existed.

Slices that do not block each other start together as soon as a [[concepts/runner]] has room. Wiki
and Human review wait for all of them to be done.

## Roles and agents

A chain is written in terms of roles, not specific agents: interviewer, prober, slicer, librarian,
senior-dev. Each project then binds a real agent to each role. Without a binding, a fallback catalogue
provides a default agent.

That separation lets the same chain run on two projects that do not have the same agents.

## Artifacts

Each step declares the artifacts it must produce. The next step reads them. That is how information
passes from one agent to the next, since they share no memory.

An artifact is a file the agent drops in its folder, rendered in the interface. A step that does not
drop what it promised is visible at once.

The steps of a chain share the same artifacts folder: that is where `spec.md`, `SPEC-EDGES.md` and
`slices.json` live, and it is the only place the Probe agent can reach.

## Full capacity

At full capacity, a step joins the queue instead of stalling the chain. It starts as soon as a slot
frees up.

## Goals

A goal is a broader intention, broken down into tasks. It carries its own event history and survives
a server restart.

## Read next

[[concepts/tache]] for dependencies between tasks, [[concepts/agent]] for roles.
