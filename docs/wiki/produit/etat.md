# Where the product stands

Written on 26/08, reread against the code on 16/09. This page says what works, what is not
finished and what is known to be missing. It exists to answer the question that keeps coming back: does
this already exist?

## What runs every day

Projects, agents and their grants. Tasks on a board, the queue, the scheduler. Container sessions
with a live trace, artifacts, diff and pull request. Approval gates. The inbox: a card wherever a
question shows up, a dedicated page for answering a round of several questions, a draft that
survives closing the tab, and the same page frozen read-only as the round's history. Pause and
resume. Chains and goals. Line-by-line pre-review. The out-of-quota pause, where a session moves to
another of the project's accounts when one is left, and otherwise sleeps until the reset and
starts again on its own. The wiki, served in the app and present in every clone.

An operator session guards the human API. Every `/api/*` route asks for one; a browser opens it by
pasting the operator token, a tool presents the token as a bearer. The token is generated at the
first boot that finds none, printed once in the boot log, and never enters a container. Being on
the network is no longer authentication: it is the layer underneath, and deciding who can reach
the port is the job of the machine's firewall and the Tailscale ACLs, not of Node. Same-origin
checks on CORS and on mutations stop an arbitrary web page from driving the API with the
browser's cookie. `/internal` (the containers' channel, authenticated per session) and `/webhooks`
(signed by the forge) sit outside the operator session. The reasoning is in
[[produit/decisions|what authorizes the human API is a session, not a network]].

Legion answers from the phone. The screen installs as a PWA, receives push notifications and lays
itself out for a narrow screen, so a question that shows up while you are out gets answered from
the street and the session starts again. This is the recommended way to reply to an agent: nothing
to set up with a third party. It needs HTTPS, because browsers only register a service worker in a
secure context; [[guides/tls]] and [[guides/notifications-push]] cover the setup. There is no
offline mode, on purpose.

Discord is the second bridge, and it works both ways: the question's buttons answer the inbox and
the session starts again. It needs a bot of your own and two environment variables,
`DISCORD_BOT_TOKEN` and `DISCORD_CHANNEL_ID`. It suits someone who already lives in Discord; it is
not the default path.

## What just arrived

Connecting a provider instead of fetching a token. An Integrations tab in a project's settings has
a tile per provider: GitHub, GitLab and Linear. You click and follow the OAuth flow, or paste a
token you already have. Both paths store the credential under the name the rest of the product
reads, so clone, change requests and webhooks work straight away. A connection belongs to the
project, not to the operator.

A tile says what it knows about the token: the account, the date, the access the provider
reported, and whether Legion can renew it. What a provider does not publish is not invented, and
an absence reads as an absence. GitLab also asks for its instance, because a GitLab OAuth app is
registered per instance and the host belongs to the connection, not to Legion.

A repository is picked from a list instead of typed. Once connected, Legion asks the forge which
repositories the token reaches and offers them. The project's git identity fills in when the first
repository comes in, with the address the provider gives.

A connection's account can be caught up afterwards. Connections made before Legion knew how to ask
who owns a token stay silent; `make adopt-tokens` asks, writes down what the provider answers, and
leaves alone what is already known. Nothing on screen yet signals that this command has work to do.

A project holds several Claude credentials, in an order you set. The first in the list serves,
alone. When a session dies at the limit, the account that served is marked exhausted for the
window that closed, until it resets; if another account is available, the session starts again on
it immediately instead of sleeping. That state is shared, so other sessions do not rediscover it
one by one. The list only holds subscription tokens, and when they are all closed the session
waits rather than falling back to pay-as-you-go. The "Claude credentials" card, on the project page
next to the secrets, shows the list, each account's state and its rank, and answers "why is my
session running on this account". The reasoning is in [[produit/decisions]], the details in
[[guides/quotas]].

An inbox question has its page. A round of several questions is no longer filled in a channel's
column or under a scrolling thread: the questionnaire gets the whole screen, at its own address,
and the four places a question appears show the same card that leads there. A text or choice
question is still answered on its card. The draft is saved to the database half a second after each
change, so a round started on the train gets finished at the desk; the cards say "2 / 6" and offer
"Resume". Once answered, the page freezes read-only and becomes the round's history, with what you
set aside written out. The why and the two surfaces set aside are in [[produit/decisions]].

The shell went flat, and the top bar says where you are. Nothing that sits on the page has a
shadow any more: cards, panels and buttons are only outlined by their rule, and only what floats
(menu, popover, modal) keeps one. The bar names the screen ("Board", "Task / identifier",
"Channel"…) in the same place on every route; the product mark moved to the head of the icon rail,
system and wiki to its foot. A task's page has a right-hand panel open by default: the task's
settings while no session has run, the runtime afterwards (runner, container, model, cost, branch,
PR, dependencies, session identifier at the foot). The verdict of a finished session fits on one
line; the PR is a single icon in GitHub's colours, and the number of pushed files is a badge on the
"PR" rail row, which shows the draft then the diff in the same view. The details are in
[[produit/decisions|the flat shell and the task panel]].

The interface listens instead of polling. One event stream is open for the whole application, and
the server pushes whatever makes a screen stale: a task changing state, a question opening, a
branch pushed, an artifact dropped. The page refreshes when the thing happens instead of asking for
five lists every four seconds. Measured on an idle task page, one minute went from sixty-one
requests to five. Periodic refresh stays, once a minute, as a safety net if the stream drops. The
details are in [[produit/decisions|the screen listens instead of asking]].

The fleet of machines is declared and watched. The Runners page adds a runner without touching the
database, and a probe asks every machine every thirty seconds whether its Docker daemon answers. No
session goes to a machine that stopped answering, and the message says so in plain words instead of
blaming capacity. A machine that comes back becomes eligible on its own. Each runner can carry its
own callback address, the one its containers will call. A task can name its machine, next to "Run
the task again": the choice is strict, it refuses by naming the machine rather than falling back
elsewhere, and it applies to the next sessions, never to the one running. No chosen machine remains
the default. The details are in [[concepts/runner]].

A session's files travel. On a remote machine, the working directory, Claude's state, the package
cache and the project key are no longer paths on the control plane's disk but Docker volumes on
that machine, filled through the same daemon, without assuming any shell access there. The local
socket keeps exactly its old mounts: two deliberate paths were better than a unification that
would have broken workspace reuse on the day the first remote session was made to work. A remote
session's artifacts do not depend on any of this: the container drops them through the internal
API, so they land on the control plane whatever machine runs the session (measured on 01/09, pinned
by `sessions/artifacts-location.test.ts`).

A dropped connection no longer kills a remote session. The connection waiting for a container to
exit breaks when the machine goes to sleep, and that says nothing about the session: Legion waits,
asks the machine again whether it answers, and reattaches to the same container. Patience is capped
at half an hour per outage, and when it runs out the failure says "host unreachable" instead of
blaming the agent. In the same move, an `ssh://` machine is kept awake by `caffeinate` while at
least one session runs there, because a Mac with nobody at its keyboard thinks it is idle and
suspends the container without a word. That is the only place that assumes a shell on the remote
machine, and its absence is tolerated and reported.

Legion installs on a machine other than the developer's. A container built from the repository
serves the API and the screen on the same port, with its data and the server's SSH key mounted. It
carries the SSH client and the Docker CLI, so it drives the declared machines. The full procedure is
in [[guides/installer-sur-un-serveur]]. The home server has run it since 01/09, behind an HTTPS
front end since 13/09.

That server is the light half of the topology, and until 05/09 it could not execute anything at
all: its own daemon's runner mounted control plane paths that do not exist as such on the host when
the control plane runs in a container. Docker then created the missing folder instead of failing,
and the session started on an empty workspace without any sign. The mount mode is now decided on
the right question, "does the control plane share its filesystem with the daemon", and a
containerised install gives the local daemon volumes, just as it already did for a remote machine.

Staying light is therefore a decision rather than a fate, and it is still the default: the local
daemon's runner stays off. A session running there shares the control plane's disk and can fill
it; the disk guardrail bounds that risk without removing it, and that runner's ceiling (three 3 GB
sessions on 11 GB shared with the control plane) needs revisiting before it is switched on.

The update button works on that install too, since 01/09. It could not before: the image has
neither git nor a clone, so the Version card answered "nothing to compare" on a healthy machine. The
version is now baked into the image at build time, and the screen says which of the two modes it is
in. The gesture itself is an ephemeral, detached container, the counterpart of the detached script
in development mode: it moves the host's clone forward, rebuilds, and outlives the control plane it
replaces. For that, the container gets the host's Docker socket, which amounts to root on that
machine; the decision and its limit are in [[produit/decisions]].

Navigation centres on the project. An icon rail keeps projects on the left, each with its mark and
the number of decisions waiting for it; the next rail only knows the open project and collapses.
Everything about the machine sits in the top bar: status, what is stopped, search, wiki and system.
The inbox there became a summons rather than a page, grouped by project, and its count only
includes what is really stopped, never a notice. The global dashboard is gone; it aggregated
projects nobody looks at together.

Resuming in a terminal works whatever machine ran the session. The command the screen gave used to
name a folder on the control plane, so for a remote session it opened an empty conversation without
an error, in the operator's terminal. The state is now brought back on demand from the remote
machine's volume, over the same Docker access as everything else, and the command handed out is
unchanged. It is a one-way trip, on purpose: a second request copies nothing, or it would overwrite
the conversation that was just continued. A sleeping machine or a swept volume produce a sentence
that names them, never a command that will fail somewhere else.

With no project at all, the screen first says whether the ground holds (a Claude credential, Docker,
the session image) and names the fix for each gap before asking for a repository URL.

A task's page reads in two parts. The head does not scroll and carries the title, the gestures, the
verdict and whatever needs a decision now; the rest is a view that scrolls on its own and that the
rail picks. The eight views are addresses, so a link to a task's PR view can be pasted and shared,
the back button knows how to return, and the browser title names both the view and the task. The
rail rows never move: a view with no content says so rather than disappearing. The reasoning is in
[[produit/decisions]].

Plan usage is no longer shown anywhere, neither in the bar nor on a project's page. It could only be
measured with some credentials, and a gauge you have to interpret before believing it is worth less
than an empty spot. The reasoning is in [[produit/decisions]], the details in [[guides/quotas]]. The
out-of-quota pause is not affected: it reacts to a refusal, it measures nothing.

The concierge reads the control plane itself. You can ask it why a task failed and it fetches its
sessions' trace instead of answering from the summary compiled for it; a task URL pasted into the
question is enough, it extracts the identifier. Three reads are open to it: a task's details with
its sessions and their cost, the execution trace, and a keyword search. It still cannot change
anything, and it is given no write tool.

The concierge has a page. Opening it, you read what needs a decision before asking anything: the
situation report is the first turn of the conversation, written in sentences, with what is waiting
sorted into to do, soon and for information, and the tasks cited as links. It is computed on demand
and never on a timer; its age is shown and a link recomputes it. Turns live on the server, so what
you asked yesterday is still there and a conversation can be picked up again. The hover panel in the
bar stays, for a quick question from anywhere.

A session that pushed code leaves a PR behind, without anyone having to think about it. Opening
starts from the end of the session, not from a click; it no longer depends on the `pr.md` draft the
agent only writes on a chain step, and it applies to a session that failed after pushing too. The
"Create the PR" button stays, to reopen one that was closed, and since 14/09 it only shows (on the
channel as on the task page) where a push exists and no PR is open, never on `pr.md` alone.

The `feature` chain replaces `compound-engineer` in the catalogue: Interview, Probe, Breakdown,
Wiki, Human review, instead of nine fixed steps. The Interview writes the spec by asking you for the
trade-offs. The Probe rereads the spec without access to the repository and raises its edge cases as
one inbox question per round. The Breakdown step proposes a batch of slices you approve in one
gesture, and that gesture creates the tasks, links them together and holds the Wiki back until the
last one. A slice carries an observable outcome, a validation command and one to three criteria
with their mode, and its agent cannot close it. A copy of `compound-engineer` already installed
keeps running as it is.

Blocking between tasks became a graph. A task waits for as many tasks as needed, the board says how
many and the page says which, and the last one to finish releases it. The single "blocked by"
column no longer exists, in the code or in the database.

Checkpoints. Code is pushed during the session, not only at the end.

The turn budget. The agent knows its ceiling, is warned after thirty turns without producing
anything, and can propose a split rather than running into the wall.

GitLab. A forge port replaces the GitHub assumption that was sewn into three layers of the runtime.
Pushing a branch, opening a merge request and receiving webhooks all run against a self-hosted
instance (Framagit).

Capabilities that switch on at project level. A skill, a rule or a tool server can apply to every
agent at once, where you used to tick seven agent sheets to say the same thing seven times. Access
stays granted agent by agent: a capability adds an ability, an access opens data, and the second is
not handed out by default.

The Channel view, which reads a task as the conversation it already is. The brief is the first
message, the agent's words are another, what it does in between folds into one line, and the
waiting question is answered in the thread. It does not replace the board: the board says where the
work stands, the channel says what happened.

The discussion mode. Before a line is written, an interviewer agent looks for the facts in the
repository and on the web, then asks you for the trade-offs, one inbox round at a time; its
Interview view follows the rounds. Started on its own it ends by proposing a task whose brief is
the spec; inside `feature` it is the first step.

Attachments on a brief. A request is not always text: a screenshot of what is wrong, an export, a
mock-up. Files are attached when the task is created, or later from its Brief view, and they live in
the run's artifacts folder under a prefix that says where they came from. The agent receives them
named in its brief, with the path to read them, and an image it reads comes back to it as an image.
The Artifacts view keeps them apart: what the operator attached and what the agent dropped are two
lists. A file can be attached while a session works: it is readable at once, and a message in the
agent's conversation gives it the name and path. If the session is no longer listening, on hold on
a question for instance, the file waits for the next session, which finds it in its brief. Only
removal stays closed while a session runs, because it holds the path of what it received.

Reading artifacts across related tasks. A task proposed by another could receive in its brief the
path of a file it had no right to open. It now reads, read-only, the folders of its lineage: its
origin, its prerequisite, what it waits for, what it proposed.

The read-only task. An audit or a validation clones repositories without write access: nothing is
pushed, no catch-up commit, no PR, the report arrives as artifacts. Born from a real junk merge
request: a task briefed "push nothing" still delivered its regenerated lockfiles, because the
end-of-session safety nets push any dirty tree. The grant holds what the instruction cannot.

Inbound webhooks from forges. GitHub and Framagit call in when a change request moves: merged, the
task under review goes to done on its own (blocked tasks released, chain advanced, notification).
The `/webhooks` path is exposed through Tailscale Funnel and guarded by signature, not by address:
it is the product's first public surface, a decision recorded in
[[produit/decisions|the decisions]]. Connecting is one button per repository, and the hook is
created through the forge's API with the token from the vault.

Acknowledgement of what an agent says. Each event carries a number and the server replies how far
it has heard, so a report that does not get through is replayed instead of lost.

Missing Docker shows on screen. When no runner answers, or none has the image, the board's banner
and the badge at the top say so before anything is launched. A whole morning of sessions sent
nowhere paid for that.

A session that ends tidies its task, even when it succeeds. The tidying used to run only on
failure, assuming a successful agent tidies up itself. A task could therefore stay shown as
"doing" on work stopped an hour earlier, without coming back to anyone's attention.

A project's settings are arranged by the question you ask, not by the table that stores them.
General holds what the project is: name, colour, identifier, read-only output folder, injected
context. Repos holds everything about git: the repository list, commit identity and SSH key, three
settings that used to live in three different places. Secrets holds only the project's keys and
its Claude accounts, and Integrations its connections. Models gains the field that was missing: the
default model, shown as a fallback on eight screens and editable nowhere. Sessions holds the image
and the Dockerfile, Crate only exports a configuration, and importing a crate moved to the "New
project" modal, since what it creates is a project, not a setting of the one you are looking at.
Rules, skills, MCP servers, environments and chains sit together under Library. The details of the
moves are in [[produit/decisions]].

## What is not finished

A session's log lives in the control plane. Until it is written next to the agent, a container that
dies takes with it what it did not have time to report.

Removing the network wall and the whole environment concept was decided on 08/09 and not done:
egress isolation is opt-in and off on every working agent, and the environments module, its routes
and its screen are still there.

The Vite development server must still not be exposed (`vite --host`). It replaces nothing: what is
served off the machine is the BUILT screen, from the process that already carries the API.

The `process` runner mode, meant for development, applies no network policy, provides no browser
and skips the pre-launch checks. It does not have the properties the rest of the product claims.

The shared browser only ever stops by hand.

A goal's dollar budget guardrail can only apply between two sessions, because cost is only known
at the end of a run.

The test command declared on a repository is asked of the agent in its prompt, but nothing checks
that it ran. The server does know which repositories were pushed.

Artifacts never go away. Nothing clears them when a task is archived.

Open environments exist in the database but can no longer be created from the app.

One server route has no screen in front of it: creating a named agent (`POST
/api/projects/:p/agents`). The Agents screen only offers the library.

A connection does not renew. The refresh token is kept, encrypted, but nothing uses it: a Linear
connection therefore dies after twenty-four hours and has to be redone by hand.

Disconnecting a provider forgets its token on Legion's side without revoking it at the provider.
Revocation needs app authentication Legion does not have, since it ships no client secret. The
screen says so rather than suggesting otherwise.

The Issues page only reads Linear, although three providers can be connected.

The operator session has no way out and no rotation on screen. A sign-out call exists but no button
uses it, there is no list of open sessions, and regenerating the token is done in code. The sign-in
form also stops the browser from offering to save the token, so it gets pasted again each time.

The concierge's situation report does not refresh on its own. The global event stream exists, but
it does not trigger the report, and its timestamp ages on screen.

## Known gaps

Anyone who holds the operator token is the operator. There is no account, no second factor yet, no
rate limit on verification, and a shell on the control plane machine gets past every guard. The
token protects against a container on another machine, not against a compromised
host.

Some texts in the repository still describe an earlier state. The most visible: the mention of a
Telegram bridge, which was announced and never written.

See also [[produit/decisions]] and [[reference/depannage]].
