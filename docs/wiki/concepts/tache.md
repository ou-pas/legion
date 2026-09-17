# Task

A task carries a title, a brief, an assigned [[concepts/agent|agent]], a complexity and a priority. Its
brief is what the agent really receives: it becomes the [[concepts/session]]'s prompt.

## The five columns

`later` is the parking lot. Nothing leaves it on its own, even with a scheduled date. That is where ideas
noted without commitment live.

`todo` is the queue. A task entering it will be launched as soon as a [[concepts/runner]] has room.
Filing a task in todo, moving it to todo, unblocking its dependency or restarting the server all lead to
the same place in under thirty seconds.

`doing` means a session is running. If you see `doing` with no live session, something ended badly: see
[[reference/depannage]].

`review` awaits your reading. It is where a session that finished its work lands, and also a session that
failed after producing something.

`done` closes the task. A done task can be archived, which removes it from the board without deleting
it.

## The brief

A useful brief fits in four parts: the context, the work, what to check, and what must not be done. The
last part is the one people forget, and often the most profitable. An agent that knows it must not
display a secret's value will not ask you for permission to do so.

The brief can be edited while no session is running. During a session the edit is refused: the spec has
already gone into the container, and rewriting the instruction afterwards would make the screen lie about
what the agent actually received.

## Complexity and model

Complexity picks the model through the project's routing. It can be set until the task has started. Once
a task has history, it is frozen: changing its complexity would rewrite after the fact the conditions
under which its work was done.

A forced model, in the same settings, takes precedence over that routing. Empty, complexity routing
chooses; an id set here wins, for this task only. The field shares the guard of complexity and priority:
it can be set until something has run, then freezes with the rest.

## The branch

Each task pushes its work to a branch of its own, named after
[conventionalbranch.org](https://conventionalbranch.org): a type, a slash, then a description taken from
the task title and a short key that sets it apart. That gives `feature/add-the-button-1a2b3c4d`, or
`bugfix/...`, or `chore/...`. The description uses only lowercase letters, digits and hyphens, because
that is all the convention allows.

The type comes from the same call that suggests the agent and the complexity while you write the title.
When that call does not answer, or answers something unexpected, the task is a `chore`: the label that
lies least when you do not know.

The branch is set the first time it is needed, then stored on the task, and never changes. Renaming the
task afterwards does not move it. That is intended: work already pushed stays on its branch, and both the
review diff and PR opening keep finding it. A branch following the title would leave commits behind
without a word.

The steps of a chain share one branch, as they share their artifacts folder. The first step to start
names it, the following ones reuse it.

Two exceptions. A task born from an existing pull request keeps that PR's branch: it belongs to someone
else, so it is not renamed. And tasks created before 30 August 2026 that have already run keep their old
`legion/…` branch: they pushed to it, and changing it would have emptied their diff.

## Dependencies and scheduling

A task can be blocked by several tasks at once. While one of them is not `done`, the blocked task is
never due, even in todo, and a manual launch is refused, naming what is missing. The board card shows how
many tasks block it, and the task page lists them with their status. The last one to finish releases it:
unblocking is decided in the transaction that finishes each blocker, once and only once, whatever the
order. A deleted blocker stops blocking, and if it was the last, the task starts in the deletion's
transaction.

A blocker sent back to in progress afterwards blocks nothing again. Unblocking is a consumed event, not a
recomputed state, which avoids a task that already started being held back by a decision made behind it.

A task can also carry a date: the scheduler launches it at that time, handling higher priorities first
when several due times coincide.

## Criteria and gate

A task can carry a validation command and one to three criteria, each with its mode. The slices of a
[[guides/chaines|feature chain]] are born that way, but nothing requires it: it is a property of the task,
not of the chain.

A task carrying criteria is a gated step, and the gate rule applies. Its agent can ask for it to go to
doing or review, and nothing else. If it asks for `done`, it is refused with a message saying only the
operator finishes this task, and the task does not move. From review, you decide: you move it to done, or
you run it again, and it restarts with the same agent and the same criteria.

## Read-only

A task can be marked read-only, at creation or in its settings until it has started. Its session then
clones the repositories read-only, whatever the agent's grant: nothing is pushed, no catch-up commit is
made at the end of the session, and no PR opens. The report arrives through the artifacts, usually
`implementation.md`.

It is the setting for audit, validation or inventory tasks. It exists because writing "push nothing" in a
brief is not enough: the end-of-session safety nets commit and push any tree left dirty, precisely so work
is never lost, and a pure reading task used to end as a change request full of leftovers. The grant holds
what the instruction cannot.

Marked this way, the task also launches on a repository whose forge is not declared: the forge only
serves to push and open PRs, which a read does not need.

## Tasks proposed by an agent

An agent that finds work outside its scope can propose a task. It arrives in `later`, with no agent
assigned, and is never launched automatically. The agent name it suggests is checked against the
project's real agents: an invented name is rejected and replaced with a warning.

The link between the two tasks is kept, and a task's page shows it under the Lineage heading: where it
comes from, what it proposed. While a child sleeps in `later`, the section says so, which handles the
case of a task proposed during a session going unnoticed for days.

When the suggested agent still exists in the project, a button assigns the task to it and moves it to
`todo`. It then goes like any other task in the queue, as soon as a [[concepts/runner]] has room. When
that agent no longer exists, no button is offered: the task opens, and you pick an agent yourself. A
button promising a launch bound to fail would be worth less than no button at all.

Approving a task never launches what it proposed. The section reminds, it does not decide.

## Prerequisites

An agent can propose a task saying it must come before its own. The originating task then becomes
blocked by the new one, with two visible effects. Lineage marks the line "prerequisite" on both sides,
and approving the originating task becomes a two-step action while the prerequisite is not done: the
button asks for confirmation, naming what is missing.

Nothing is launched for all that. A prerequisite arrives in `later` like any proposed task, and you are
the one who commits to it.

This case comes from a real failure. A screen was delivered, marked done, and it called routes that did
not exist: the agent had indeed flagged the gap by proposing a task, but nothing distinguished "there is
extra work" from "what I just delivered does not work without it".

## Read next

[[guides/lancer-une-tache]] for the full cycle, [[reference/statuts]] for the exhaustive list.
