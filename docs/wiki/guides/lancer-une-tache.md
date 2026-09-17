# Running a task

The full cycle, from brief to pull request.

## Writing the brief

The brief becomes the [[concepts/session]]'s prompt. Four parts are enough: the context, the work,
what to check, what not to do.

The fourth is the one people skip and the one that pays most. Writing "do not touch server/" or
"never display a secret's value" saves an inbox round-trip and sometimes a whole session.

Avoid briefs that cross the agent's boundary. If the work needs a server route and a screen, and your
agents are split by domain, cut it into two tasks and make the second depend on the first.

## Choosing the complexity

Complexity picks the model. Judge on the care the work needs, not only its size. A short task whose
core is a security guarantee deserves better than a small model, even if it fits in fifty lines.

Complexity is frozen as soon as the task starts. Choose it before.

## Running it

A task filed in `todo` starts as soon as a [[concepts/runner]] has room. You can also run it by hand
from its page. If every runner is full, it joins the queue and starts on its own.

In the composer, Enter alone runs nothing. The Run button runs, and ⌘+Enter on Mac or Ctrl+Enter
elsewhere does the same, as for an inbox answer, from the title field as from the brief just below:
it is the same instruction sent to the agent, and the shortcut works for both. Running means an agent
and a container starting: a misplaced line break should not be enough.

## Following it

The Trace view shows tool calls live. The PR view shows the PR draft, then what was pushed. The
Artifacts view shows what the agent dropped. The left rail lists all of them, grouped, while a task is
open.

The Notes view is different from the other three. The trace says what happened; a note says what the
agent meant to tell you when it changed the task's status. Notes cross sessions: when a task failed
then ran again, the note explaining the failure belongs to the previous session, and that is where you
find it.

You can talk to the agent while it works. The message enters its conversation on the next turn, which
lets you correct a direction without stopping everything.

A forgotten screenshot is attached the same way, from the Brief view, without running again. The
agent receives a message naming the file and the path to read it. If its session is no longer
listening (paused on a question, or pushing), the screen says so: the file is dropped and the next
session will find it in its brief. Removing an attachment, on the other hand, waits for the session
to end, since the session holds its path.

The Brief view has its own shortcut, with a different effect: ⌘/Ctrl+Enter there saves, it runs
nothing. Editing a filed task's brief is not running it again.

## When it finishes

The task moves to `review`. Read the diff with [[guides/pre-review]] before merging: commenting line
by line and sending the review back costs a session, fixing after merge costs much more.

## When it fails

A session that ends badly produces a diagnostic in the [[guides/inbox]], with two possible moves: run
the task again with that diagnostic, or leave it in review.

Read the diagnostic critically. It is produced from the trace, and if the session was killed by an
outside cause, it will invent a plausible and wrong explanation. Check the session's duration: several
sessions dying at exactly the same round number are not three different bugs, they are a ceiling
somewhere.

## Read next

[[guides/inbox]], [[guides/pre-review]], [[reference/depannage]].
