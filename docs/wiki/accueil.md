# Home

Legion puts Claude agents to work on your repositories, each in its own container, with only the
access you grant it. You describe a task, assign it, and read the diff before it becomes a pull
request.

This wiki describes the product as it works. It lives in `docs/wiki/` in the repository, so it is
versioned with the code and present in every session's clone: an agent wondering what an approval
gate is finds the answer without leaving its container.

## Two corpora, two questions

This wiki answers "how do I use it": concepts, guides, reference. It changes when usage changes.

The [[produit/ce-qu-est-legion|Product]] section answers "what is it, and why is it built this
way": what the product is today, who it is for, the principles that hold, the decisions made and
their reasons, and [[produit/etat|where it stands]]. It changes when the product changes.

Both are maintained. A code change often touches neither, sometimes one, rarely both.

## Where to start

If you are new to Legion, read [[guides/premiers-pas]] then [[guides/lancer-une-tache]]. Together
they take about ten minutes and cover the whole cycle, from brief to PR.

If a session went wrong, [[reference/depannage]] lists the failures already met and what causes
them.

## The six objects

Everything else rests on them.

A [[concepts/projet]] gathers repositories, agents and secrets. An [[concepts/agent]] is a role
with its grants. A [[concepts/tache]] is a unit of work assigned to an agent. A
[[concepts/session]] is one run of that task in a container. A [[concepts/runner]] is the Docker
machine hosting those containers. A [[concepts/forge]] is where a repository is hosted, GitHub or
GitLab, and decides which secret is presented to git. The [[guides/inbox]] is the only place an
agent can interrupt you.

## The guides

[[guides/capacites]] explains what you grant an agent: rules, skills, MCP servers, secrets,
repositories, network.

[[guides/pre-review]] shows how to comment a diff line by line and send the review back to the
agent before any PR.

[[guides/quotas]] describes what happens when you reach your subscription's limit, and how a
session goes to sleep and resumes on its own.

[[guides/coffre]] explains how to take a project's configuration to another machine, in an
encrypted file that can carry the secrets.

[[guides/mettre-a-jour]] describes how Legion updates itself, what can block it, and how to
publish a version.

[[guides/taches-planifiees]] explains how to produce work at a fixed time, what a cron expression
means here, and why a missed run is not caught up.

[[guides/concierge]] introduces the one who reads the control plane and talks to you about it:
the situation report you read when you arrive, and why it never refreshes on its own.

[[guides/installer-sur-un-serveur]] describes the other arrangement: the control plane on an
always-on machine, serving the API and the screen from a container, and sessions on the strong
machines declared as runners.

[[guides/ci]] describes the gates that run on every pull request, the branch protection setting to
set by hand so they really count, and how the stories gate left the browser to run everywhere.

[[guides/harnais]] describes the architecture gates: boundaries between contexts, code nobody
imports any more, security advisories, coverage thresholds. Above all it explains how to read a
failure, declare a debt you accept, and pay it off.

[[guides/mutation]] explains how to measure what a domain's tests really hold, by breaking the
code one line at a time, and why that measure blocks nothing.

[[reference/statuts]] gives the full list of task and session statuses, with what each one
guarantees.
