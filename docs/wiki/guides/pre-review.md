# Pre-review

Pre-review lets you comment on a branch's diff line by line and send the whole thing back to the
agent, without going through the forge's conversation.

## Why not in the PR conversation

Since 30/08, a session that pushed code opens its change request on its own, so pre-review no longer
happens before the PR exists. What it keeps is something else: the loop between you and the agent
stays on the branch and inside Legion. A comment written here resumes a session with the whole review;
the same comment written on GitHub reaches nobody, because nothing goes to fetch it.

The original reason for this page was that a PR opened too early makes noise. It was reversed, and
[[produit/decisions]] says why: a pushed branch nobody finds costs more than an early PR, which can
always be closed.

## Reading the diff

The diff is read in the task's PR view, under the draft the agent wrote: what will be published, then
what it changes. The screen compares the task's branch with the repository's default branch. Every
file starts folded: on a fifty-file diff, opening everything drowns the review.

The tree on the left is the map. Folders are compacted as in a file explorer, each file shows its
count of added and removed lines, and a dot marks the ones that already carry comments. Clicking a
file unfolds it and scrolls there.

## Commenting

A click on a line sets the anchor. A shift-click on another line extends the range, in the same file
and on the same side of the diff. A range straddling old and new would mean nothing to the agent,
which rereads its own branch.

The comment is written in a multi-line field. Enter makes a line break, Cmd or Ctrl plus Enter sends,
Escape cancels.

Each comment keeps a frozen excerpt of the line as it was when you wrote it. If the branch moves, the
comment still says what it was about.

## Sending

The send button resumes a session on the same branch with the whole review. It costs a session, so it
asks for a two-step confirmation.

If the resume fails, nothing is lost: the comments become editable again and the task gets its
previous state back. Sending is atomic.

If every runner is full, the review joins the queue and the task starts again on its own.

## What is left afterwards

The PR is already open on the task's branch, so later pushes update it instead of opening a second
one. The Create the PR button is there to reopen one that was closed, or to open one on a task whose
trace no longer carries a push.

## Read next

[[concepts/session]] for resumes, [[guides/lancer-une-tache]] for the full cycle.
