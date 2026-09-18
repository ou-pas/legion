# Capabilities

What you grant an [[concepts/agent]]. The default is to grant nothing, and every ticked box is a
decision.

## Repositories

None, read, or write. Write requires a git credential: without one, pushing is impossible, and Legion
refuses the launch instead of letting the session find out.

Read access to a repository that might be public is not refused up front. Guessing "private" locally
would mean querying GitHub, which would guarantee a false positive on public repositories. The clone
is what fails, plainly, when it has to.

## Secrets

Encrypted in the database, never displayed. An agent receives in its environment only the secrets
ticked for it. A `GITHUB_TOKEN` is only presented to github.com: presenting it elsewhere would hand it
to a third party.

## Rules

A rule is a standing instruction, injected into the system prompt of every session it concerns. It
can target every agent in the project, or be ticked agent by agent.

Rules bind harder than skills because they do not need to be invoked. A rule that says "invoke this
skill" is only a request.

An agent can suggest a rule from one of your inbox answers. It waits for your approval and applies to
nothing until approved.

A rule carries the repositories it concerns. With none, it applies everywhere, which remains the most
common case. Name one or more and it only enters sessions whose agent holds one of them. That is what
makes "default for this project" usable in a project with several repositories: a database convention
has no business in a front-end session.

A rule also carries a summary, and when it is filled it is the summary that enters the prompt. The
whole text is then placed in the session workspace, under `.claude/rules/`, and the prompt gives its
path. The agent always knows the rule exists and what it imposes, and reads the detail when it needs
it. Without a summary, the whole rule goes in, which is the right choice while it fits in a few
lines.

Finally a rule carries file patterns, the strongest lever of the three. When filled, the rule LEAVES
the prompt: its file is placed in the workspace, and Claude Code loads it on its own when the session
opens a covered file. The prompt keeps only its name, so the agent knows it exists and does not
invent a convention where one of yours already rules.

Patterns are written one per line, never comma-separated: a brace `{ts,tsx}` contains a comma, and
splitting on it would give two broken patterns that silently match nothing. They are relative to the
session workspace, so prefixed `repos/<repo>/`.

Only put patterns on a rule tied to FILES. A pattern triggers when the agent READS a covered file: a
scoped rule is not there on the first turn, and might never arrive if the agent wrote a new file
without reading any from the same folder. That is what you want from a convention, and unacceptable
for a guardrail. `secrets-jamais-en-clair` never gets patterns. Nor does a process rule: "commits
follow conventionalcommits" is about an action, not a file, and no pattern can express it.

The screen shows what the "default for this project" rules add to every prompt. It is a number worth
checking now and then: thirty rules of ten kilobytes are three hundred kilobytes paid on every turn
of every session, and nothing else flags it. A scoped rule counts there for its name only, and its
line says so: "out of prompt".

The session trace says what was loaded, when, and why: at startup, because a pattern matched, or
because the agent entered a folder carrying its own `CLAUDE.md`. It is the only way to check that a
scoped rule actually arrives, and it names the file that triggered it.

When you drop a file, `summary:`, `repos:` and `paths:` are declared in the frontmatter, next to
`name:` and `allAgents:`. `description:` is accepted as a synonym of `summary:`, and `paths:` has the
same name and shape as in Claude Code, so a `.claude/rules/` folder written for it can be dropped in
without rewriting, patterns included.

## Rules that come from the repository

A session also reads the `.claude/rules/*.md` of the repositories it cloned, and adds them to the
project's. They have nothing to declare: the file lives in the repository, so the rule only concerns
sessions that hold that repository.

A file with the same name as a project rule REPLACES it. That is intended: for a convention, the
versioned file is the up-to-date one, reviewed in a PR alongside the code it describes, and a copy in
the database would only be a drifting duplicate. Names are compared ignoring case and spaces.

Except on a locked rule. A repository file is written by anyone who can push, and an agent with
write access is one of them: without a lock, it could loosen its own constraints by committing a file
named after one of your guardrails. The lock is off by default, and goes on the few rules that exist
to constrain.

A substitution is never silent. The session trace says which rules a file replaced, and which ones a
lock refused.

A repository rule without `summary:` injects only its start, four hundred characters, plus its file
path. Without that cap, a twenty-seven kilobyte file would come back whole into the prompt through the
repository door.

## Skills

A skill is a reusable folder of instructions, with a `SKILL.md` as its entry point. It lives on disk
and the agent invokes it when needed. It is the right shape for going deeper, not for what must
always apply.

You can read a skill in the application before granting it. Judging from a two-line description what
will enter an agent's prompt amounts to signing blind.

## MCP servers

External tools, granted one by one. Same principle: an agent only receives what is ticked.

## Project defaults

The three capabilities that add an ability, rules, skills and MCP servers, carry the same "default
for this project" box. Ticked, the capability applies to every session in the project, and each agent
can still tick others for itself alone. The two lists add up, a duplicate counts once.

That is what lets you say "`lean-ctx` everywhere" once without reopening seven agent cards, while
keeping `impeccable` on the front-end agents only.

## The bundled skills

Five skills are built in and written at boot if absent.

A skill already on disk is yours to edit, and Legion never overwrites your changes. It does replace a
file that is still, byte for byte, a version it shipped earlier: that is how the French copies written
before 17/09 became English. Once you have changed a file, it stays as you left it, and the boot log
lists the skills it left alone. The same rule applied once to the database: agent titles, role prompts,
chains and the Legion project's rules and context that still held the exact French text Legion wrote
were moved to English, and anything edited kept its wording.

`grilling` is an interview technique: stress-testing a brief before the work starts. It belongs to
one role, the `interviewer` agent of the `feature` chain, and has no place elsewhere.

`specify`, `probe` and `slice` are the protocols of the `feature` chain, one per role. The chain
imposes the order of its steps and its gates; how each step goes about it lives in these skills, on
disk, where you can adapt it. See [[guides/chaines]].

`lean-ctx` is a context discipline: search before reading, read a range rather than a file, never
push three thousand lines of test output through your window. It applies to any agent that touches a
repository, which is why it is a project default rather than an agent grant. Every byte a session
lets into its context is paid again on every following turn, so leanness is not a minor saving: it
decides whether the work fits in the session's budget.

The four architecture books are not bundled: they were imported by hand. Their short version is a
rule, injected into every prompt; their long version is a skill, to invoke when a decision is truly
structural. Both tiers need to be wired, and for a while only the first was.

Access has no such box and never will. A secret and a repository open data: granting them to a whole
project by default would remove least privilege, which is the reason this page exists. That is the
dividing line: a capability adds an ability, an access opens data.

## Folders

An agent can receive a working folder, read, write, with or without delete rights. That is where it
drops its artifacts.

Each session also receives its run's artifacts folder, in write, and those of its family read-only:
the task that proposed it, the one blocking it, the one it waits for, and the ones it proposed. That
is what makes a brief saying "the contract is in /artifacts/<other task>/implementation.md" readable,
a sentence the product was already writing before the folder was mounted. Nobody writes into another
task's folder: the review trace keeps a single author, and nothing is copied, so there is nothing to
clean up afterwards.

## Network

An environment is a list of allowed hosts. An agent carrying one has its sessions run behind an
egress proxy that refuses everything else, on a docker network with no route outside. The model API
and the control plane stay reachable, otherwise the session could not work: those are the two
exceptions, and they are added automatically.

An agent without an environment is not walled off: its sessions go out freely. The wall is put up, it
is not inherited. Creating an environment restricts nobody until you assign it, from the agent card,
Network field.

What the wall protects is not the agent, it is the secrets it carries. A container that holds a write
token, goes out freely, and reads content you did not write, an issue or a web page, meets all three
conditions for a leak. `make network-audit` shows those three columns side by side, which no screen
does yet.

An environment created from the application is always an allowlist. The open environments that still
exist come from the install scripts, and an agent carrying one goes out as if it had none: the
difference is that the choice is written down.

Three spellings are refused on entry, because they open the wall without looking like it. A comma in
a host splits the proxy's allowlist line. A bare wildcard allows everything. A full URL matches
nothing, and the agent hits an unreadable refusal.

When an agent is walled off, launching a task is refused up front if a granted repository is not
reachable under its environment. The message names the host and the missing move. Without that
refusal, the clone would fail deep inside the container, after a model turn, on a proxy error nobody
reads.

Deleting an environment still carried by an agent is refused, and the message names the agents. That
is the opposite of rules and MCP servers, which are silently removed from agents: an allowlist
disappearing under a live agent changes what it can reach.

## Browser

The [[concepts/runner]]'s shared browser is granted agent by agent. Without the grant, the agent does
not receive the service address, so it cannot connect to it.

The address, `BROWSER_WS_ENDPOINT`, is not only for a manual Playwright script: a project's own
Vitest suite can connect to it too, for component tests that need a real browser rather than a DOM
emulator. [[guides/tests-navigateur]] has the wiring and what was checked.

## Read next

[[concepts/agent]] for the role, [[concepts/projet]] for what all of them share.

## What a container cannot do

A session container talks to the control plane through a single path, `/internal/`, and presents its
session's token there. That token only opens `/internal/sessions/<its own id>`.

The human API, `/api/*`, requires an operator session: a cookie opened from the login screen, or an
`Authorization: Bearer` header carrying the operator token, for tools such as `curl` or
`make responsive`. The operator token never enters a container. A boundary rule
(`operator-token-stays-home`, see [[guides/harnais]]) makes it impossible for any module that builds a
container spec or an `/internal` response to even import it.

Before 13/09 this page said the API only accepted calls from the machine hosting the control plane.
That address guard is gone: a container on a remote runner leaves through its host, on the same
tailnet address range as the operator's browser, and the address could no longer tell them apart.
