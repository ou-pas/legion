# Principles

These are the rules that survived use. Each one was paid for by a failure, which is what separates
it from an intention. They win over implementation comfort.

## The screen says nothing it does not know

A verdict, a gauge or a help text that states something false is worth less than an empty screen,
because it inspires a confidence nothing backs. The rule was born from an Environments screen that
promised "an agent without an environment has no network access" while the runtime let everything
out. It served again the day the Repos page claimed the system ran test commands when it only
asked a model to run them.

In practice: a check nobody performs is not written in the present tense.

## Permissions are enforced, not requested

What an agent can read, write, reach or close is controlled on the server. An agent that tries to
close a gated task gets a refusal; it does not read a sentence asking it to refrain. An inbox tool
is not only removed from its list, it is also refused if the agent calls it.

The same logic holds for secrets, injected only when they are checked for that agent, and for the
network when an agent is given a `limited` environment, enforced by an allowlist proxy.

## Work never lives in only one place

Code is committed and pushed during the session, not only at the end. Two tasks lost on the same
evening had the same root cause: their work existed only in a throwaway container until the last
second, and any abrupt ending took it away.

Corollary: a last step only counts if you get to it.

## An agent is not a mere executor

It knows its turn budget from the first turn. If it judges the task will not fit, it is expected to
push what it has, write down what remains and propose a task to split the work. Renegotiating a
badly cut scope is an engineering judgement, not an admission of failure.

It can also propose a prerequisite, declaring that something must happen before its own work. That
option was missing the day an agent delivered a screen that talked to routes that did not exist,
while mentioning their absence in a report nobody read.

## Irreversible gestures stay human

Approving a task, merging, approving a definition of done. An agent writes the draft, the human
pulls the trigger. Opening a pull request is not on that list: the server opens one for any
session that pushed code, because an open PR commits nobody to anything and merging stays yours. An approval
gate is a flag on the task, not a sentence in a prompt.

## The inbox is the only channel for interruptions

An agent reaches you only through it, and an open question puts its session on hold. The question
carries what the agent read and what your answer will change, so you can decide from the list.
When it has several independent questions, it asks them all at once as a round, rather than in as
many wake cycles.

## Refuse only what is certain

A check that refuses wrongly is worse than no check: it blocks legitimate work and ends up
disabled. Pushing without a credential is impossible, so it is refused before the container is
created. Reading a repository that might be public may be legitimate, so the attempt is allowed
and the clone fails plainly.

The same caution applies to automated checks: a scan that produces false positives stops being
believed, then stops being run.

## Back-and-forths get written down

A decision reversed the same day looks like indecision when you only read the outcome. The
reasoning on both sides therefore lives in the commit message and, when it sheds light on the code,
in a comment. [[produit/decisions]] gathers the ones that matter.

See also [[produit/ce-qu-est-legion]] and [[guides/capacites]].
