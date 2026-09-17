# What Legion is

Legion is a control room for putting Claude agents to work on real code. You describe a task and
assign it to an agent. The agent runs it in a throwaway container with only the access you
granted, and hands back a pushed branch, artifacts and a pull request. You read, you correct, you
decide.

It is neither a chat assistant nor an automatic pipeline. Several agents work in parallel while
you do something else, and the system interrupts you only when a decision is yours to make.

## What you actually do in it

You launch work. A launcher bar on the board, a composer the command palette opens from any
screen, a Kanban board per project, and a queue that picks up ready tasks as soon as a slot frees
up. A task can be scheduled for later, or wait on other tasks.

You follow what is running. A task's page shows the live trace, tool calls, cost, its branch diff
and its artifacts. The top bar counts what is waiting for you, gates and questions together,
across every project.

You answer. An agent can only reach you through the inbox, and an open question puts its session
on hold. The question arrives with what the agent read and what your answer will change, so you
can decide from the list without opening the session. On a phone, a push notification brings it
to you.

You review. The PR view shows the agent's draft, then the branch diff. You click a line, you
comment, and the comments pile up without being sent. When you send the review, the agent starts
again on the same branch with your remarks in its brief.

You decide what comes next. An approval gate stops the agent from closing a task itself. Merging
is a human gesture, never the agent's.

## What surrounds it

Chains, for an ordered series of steps where each task waits for the ones before it. Two ship
with the product. `feature` goes from an interview to human review in five steps, including a
Breakdown step whose batch you approve, and the slices of that batch become tasks in their own
right. `bugfix` has five as well, from reproduction to minimal fix.

Goals, for an open-ended objective whose breakdown you do not know. An orchestrator picks the next
specialist itself until the definition of done is met, with guardrails on budget, duration and
lack of progress. You approve the definition of done before anything starts.

Capabilities handed out agent by agent or to the whole project, gathered on one screen: standing
rules, invocable skills, MCP servers, network environments.

A usage wiki, served from the repository and therefore present in every session's clone. An agent
wondering what a gate is finds the answer without leaving its container.

## What sets it apart

Work never lives in only one place. Code is committed and pushed at regular intervals during the
session, not only at the end. A session cut short, a limit reached, Docker going down: at worst
you lose fifteen turns.

The container dies while waiting. When an agent asks a question, it pushes its work and its
container is destroyed. Nothing runs, nothing costs, and the conversation resumes intact on wake
because the SDK session is kept.

Permissions are not instructions. What an agent can read, write, reach or close is enforced on
the server. An agent told to close a gated task gets a refusal; it does not read a sentence
asking it not to.

The screen says nothing it does not know. This is the rule that took the most fixes: a verdict, a
gauge or a help text that states something false is worth less than an empty screen.

See also [[produit/principes]], [[produit/decisions]] and [[produit/etat]]. For daily use,
[[guides/premiers-pas]].
