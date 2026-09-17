# Session

A session is one run of a [[concepts/tache]] by an [[concepts/agent]], in a container created for the
occasion and destroyed afterwards. Nothing survives it except what is pushed to git, what is dropped in
the artifacts, and what the callbacks write to the database.

## What happens at launch

Legion first checks what it is certain of, before creating anything. A repository URL that is neither
https nor SSH, an SSH URL on a project with no key, write access without a git credential, a Docker
daemon that does not answer: each of these causes an immediate, named refusal, without spending a model
turn. A refused task does not leave its column.

Then the container starts, clones the granted repositories, receives the prompt and the ticked secrets,
and the agent works. Every tool call is traced and readable live in the task's Trace view.

## Statuses

`starting`: the container is being created. A session that stays there more than four minutes without
getting a container is stopped automatically, and its task goes back to `later` with a notice naming
the cause.

`running`: the agent is working.

`waiting`: the agent asked a question and is asleep. The container is destroyed during the wait. Your
answer restarts it where it stopped. See [[guides/inbox]].

`blocked`: stopped on an approval decision. Same pause as `waiting`, container destroyed too, but no
automation is allowed to write to it: only your answer resumes it. See [[reference/statuts]].

`committing`: the work is being pushed to the task's branch.

`destroyed`: normal end. The ephemeral container was cleaned up, which is not an anomaly.

`failed`: abnormal end. The reason is persisted on the session, not just displayed: it stays readable
six months later.

## The branch

Each task has its branch, named after its title and type, for example
`feature/add-the-button-1a2b3c4d` ([[concepts/tache]] details the form). Every session of the same task
pushes there, including resumes after a pause or a review. A pull request open on that branch therefore
updates instead of a second one opening.

The branch is named at the first launch and never changes, even if the task is renamed later. Otherwise
an edited title would have moved the branch and left the previous commits where nobody looks for them.

Only repositories granted to the agent are pushed. A repository the agent clones by itself into its
workspace has neither address nor token on the server side: it is never pushed, and the next wake-up
wipes the folder. Since 09/09 the trace says so with a warning at the end of the session, the brief
forbids that clone, and the agent has the `request_repo` tool to ask for a project repository it lacks.
The request arrives in the inbox as an approval, the session blocks, and granting it puts the repository
on the agent's card before the resume, which clones it next to the others. The grant applies to all
future tasks of that agent, not only the one that asked: it is the same move as ticking the box on its
card. A question asked another way, through `inbox_ask` with a "grant" option the agent made up, grants
nothing.

## Checkpoints

A long session automatically commits and pushes whatever is not committed yet, every fifteen turns: it
is a safety net against losing a container that goes down (quota, failure, turn cap reached), nothing
more. These commits are called `chore: checkpoint (turn N)` and are not meant to last.

At the end of the session, before the final push, they disappear from the pushed history. Three cases:
if a real agent commit follows one or more checkpoints, they are folded into it (the agent's message and
author win); if the whole session only made checkpoints, they become a single commit titled after the
task (the PR draft if there is one, otherwise the task title); if checkpoints remain after the last real
commit, work started but never committed, they become a commit named for what it is. The
`chore: checkpoint` subject therefore never lands on a pushed branch.

The trace does not change: every checkpoint actually made during the session stays visible as it was in
the Trace view. It is the git history that is rewritten, not the account of what happened.

## Pausing a session

The pause button, on the task page, asks the agent to stop. It does not interrupt it: the agent finishes
the turn it started, pushes its work to the branch, then exits. An entry then appears in the
[[guides/inbox]], and answering it resumes the session exactly where it stopped, with its whole
conversation.

Nothing is lost and nothing keeps costing: the container is destroyed as for any pause, and a paused
session no longer holds a slot on its runner.

Pausing is refused during the commit phase. Interrupting a `push` in progress is the only way to lose
work with this mechanism, and the screen tells you so instead of refusing with no reason. A few seconds
later, it goes through.

It is also refused on a session that is starting: its container does not exist yet and there is nothing
to save. In that case, stop the session instead.

An agent may well finish its task before reading your request. The session then ends normally, and the
pause request has no effect: it stays visible in the trace, so the click does not seem lost.

## Resumes

A session can resume several times: after an [[guides/inbox]] answer, after a
[[guides/quotas|quota]] wake-up, after a pause you asked for, after a [[guides/pre-review|pre-review]]
is sent, and since 10 September after using up its turn budget while working. A resume continues the
model's conversation, it does not start from scratch. The number of resumes is recorded on the session;
the screen does not show it yet, the task's trace says it on each restart.

## Work longer than a container

A session container has a turn cap, and the SDK cuts off sharply at 400. That cap is not a deadline on
your task: as soon as the session has produced nothing for thirty turns, it is warned straight away,
whatever turn that happens on, not only near the cap. A pushed commit or a successful file write is
enough to reset the count.

If it is not moving forward, the agent first receives the measurement and a question, without anything
stopping: "no commit or write since turn 98, are you making progress, or is something broken?". Its
answer triggers no mechanism: it uses it to repair, to ask you, or to hand over for a re-split. If it is
STILL idle at turn 375, Legion itself stops this time and asks you, with what it was doing and since
when.

If instead it is moving forward, its work is pushed, the container is destroyed and it restarts right
away in a fresh container once it reaches 375 turns: same task, same branch, same conversation, turn
counter at zero. You have nothing to click, and nothing stops at night. A long run is thus a series of
bounded sessions, not one session stretched out; that is what keeps it from dying on the SDK cap.

A session that writes to no repository (an interview, an audit, a code read) does not get this pause at
all: reading at length is its job. It keeps the automatic restart.

There is no limit on the number of restarts. At the third, you are notified once, and you keep pause
and stop at all times.

## Taking over in your terminal

A task's page gives a command to paste: it opens the agent's conversation in your terminal, with all its
context, and you carry it on. It is one-way. The container session is over, and what you say next does
not go back to it.

When the session ran on a remote machine, its Claude state lives in a Docker volume on that machine.
Legion brings it back when you ask for the command, through the same Docker access that launched the
session, then gives you the usual command. Asking for the command again later copies nothing: the local
disk has become the reference, and overwriting it would erase the conversation you just continued.

Two situations give a sentence instead of a command, on purpose. If the machine does not answer, it is
named, along with the volume where the state waits: wake it and ask again. If the volume was swept,
because the session ended long ago or the project was purged, there is nothing left to resume. No
command is given in those cases: it would open an empty conversation without saying why, in the one
place where Legion can no longer explain anything to you.

## What remains afterwards

The diff pushed to the branch, the dropped artifacts, the full trace of tool calls, the cost in dollars,
the number of turns, and the end reason. The container no longer exists.

Cost reads at three scales, and they do not say the same thing. A run is a start or a resume, and the
model bills it separately: the right panel gives one line for each as soon as a session has been
resumed. The session's cost is the sum of its runs. The task's cost is the sum of its sessions, and it
only appears if the task ran more than once: running a task again creates a new session, it does not
resume the previous one.

Time reads on three lines, and the gap between them is what teaches something. Duration is wall-clock
time, from start to end, waits included: a session that spent the night waiting for an inbox answer
shows eleven hours. Work is the sum of its runs, so the time someone was doing something. The model
share, within it, is what was spent waiting for a model response, the rest being tool execution.

Eleven hours of wall time for twenty minutes of work is a fact about your organisation, not about the
agent: the inbox question waited, or the queue was full, or the quota was exhausted. A session whose
work time comes close to its wall time, conversely, waited for nobody.

The three lines only appear when known. Sessions from before 10 September 2026 only have their wall
time: the runtime did not yet record a run's duration, and showing zero would suggest they worked
instantly.

Artifacts are read from the task's Artifacts view. Text and an HTML report render in a sandboxed frame,
an image renders directly, and any other binary is not previewed at all: it downloads. The frame has a
bounded height, so a report taller than it opens in a tab from the button in its bar.

An HTML report is code written by an agent, and it is treated as such. The document runs in an opaque
origin: its scripts run, but they see neither the screen's DOM, nor the cookies, nor the content of an
API response, even when calling it. Confinement comes from two places so that opening in a tab is
covered too, where the frame attribute no longer applies: the screen's sandbox attribute, and a
Content-Security-Policy header the server sets on every artifact it serves.

## Read next

[[concepts/runner]] for the machine hosting all this, [[reference/depannage]] when things go wrong.
