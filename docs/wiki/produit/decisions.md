# Settled decisions

What the product has decided, and why. The reasons matter as much as the conclusions: without
them, the debate gets reopened three months later without knowing what had already been learned.

A decision below that a later one overturned says so where it stands. It stays on the page,
because the path that led to the current state is part of the answer.

## One operator, on their own machine

The control plane was built for a single operator, listening locally. That assumption runs through
everything: secrets are decrypted on the server with a master key from the environment, the
database is a SQLite file, Docker runs on the same machine.

What it cost on 26/08: a session container could call the interface, since it knows the control
plane's address for its own callbacks. The answer then was to reserve the interface to loopback,
which a container cannot imitate, rather than invent an authentication nobody needed.

On 01/09, "on their own machine" became "on their own machines", and that was a setting: loopback
stayed the default, and the tailnet could replace it. See "Tailnet membership is the
authentication" below.

The "no authentication" half of this decision ended on 13/09. The interface now asks for an
operator session; see "What authorizes the human API is a session, not a network". The single
operator remains.

## The container dies while waiting

When an agent asks a question, its container is destroyed. That was counter-intuitive at first,
because the first instinct is to keep the container to avoid reinstalling, and it became the
central invariant: nothing runs, nothing costs, and the conversation resumes intact thanks to the
SDK's session identifier.

The price accepted at the time was recloning repositories on wake. It has since shrunk: each
session keeps its `/workspace` on the runner's disk and a package cache is shared by all sessions,
so a wake fetches instead of cloning and does not reinstall dependencies. The invariant itself did
not move: a waiting session has no container.

## The network is not isolated by default

An agent without an environment has no egress restriction. This decision was made, reversed and
made again on the same day, which is worth telling.

In the morning, switching to a wall by default looked obvious. In the evening, an audit showed the
real map: six agents out of seven carried a write token, three carried an API key none of their
tools used, and the agent the wall isolated best was the only one carrying nothing. Isolation aimed
beside what it protects costs blocked work without buying safety.

The wall did not disappear, it became a choice again: a `limited` environment assigned to an agent
isolates its sessions. What disappeared is the wall by default. The rule that will be worth
something is still to be written, and it will tie both ends together: an agent carrying a secret
should not combine free egress with reading content it did not write.

Removing the wall and the environment concept altogether was decided on 08/09 and has not been
done; [[produit/etat]] tracks it.

## The forge is declared on the repository

Not on the project, because a project can mix a GitLab front end and a GitHub library. Not in the
infrastructure, because that part is about machines, and putting it there would separate the forge
from the secrets that make it work.

It is suggested when the host is recognisable and refused otherwise. A self-hosted instance is not
called `gitlab.com`: guessing would present the wrong credential, and the failure would arrive at
clone time, inside the container, blaming a secret that had in fact been granted.

## Declaring a repository's forge is the authorization

The control plane talks to forges without going through the egress proxy, and a GitLab's API
address is derived from its repository URL. So on 5 September it seemed prudent to also require the
host to appear in a server allowlist, `LEGION_FORGE_HOSTS`.

Three days were enough to show what that cost. A project on a Framagit instance, three repositories
declared as GitLab, a token granted to the agent: the clone died asking again for a username,
because the variable was not set. The repositories had been created before the list existed, so
nothing had ever asked for it to be filled in. The only trace was a warning in the internal log,
which nobody reads before a failure.

The reasoning that settled it: creating a repository means typing its URL and picking its forge in
the menu next to it. That gesture names the host and the token, in the same form, at the same
moment. Asking for it to be repeated in a server file added a restart and no information. And an
allowlist stored in the same database as the repositories it controls would have controlled
nothing: it would have come in through the door it guards, authorising itself.

What really protects stayed, and depends on no setting: a repository whose forge is neither
declared nor certain from its host receives no credential. That refusal, not the list, is what
stops a GitHub token from landing with a third party.

The list keeps a single entry point, importing a crate, and that is the only place it earned its
keep: a crate is a file written on another machine, so whoever writes the file is not whoever
writes the list.

## Cloning, pushing and fetching do not vary from one forge to another

It is git, the same everywhere. What varies comes down to two things: the credential presented (a
twenty-line table, and that is all of what unblocks the push) and the review API, which does
deserve an abstraction. A per-forge strategy on cloning would have produced an abstraction with a
single implementation, differing by one string.

## The turn ceiling is a ramp, not a cliff

The SDK cuts a session off at four hundred turns. A task that was too big therefore died in the
middle of its work. An exhausted turn budget is not an anomaly like spinning in place or a cost
drift: it is a task bigger than one run, and the two are not handled the same way. The agent is
warned as soon as thirty turns pass without producing anything, whatever turn that happens on, and
decides for itself; if the session is still inert at turn three hundred and seventy-five, it pauses
rather than dying.

## Cost is not a criterion

The subscription makes the bill irrelevant. What is scarce is time and the quota window. Amounts
shown are a measure of scale, never an argument.

A per-session token ceiling existed, inherited from a time when the reasoning was different. It was
removed on 8 September, and its history says why it had to go rather than be tuned: its counter was
not even called before 3 September, so the ceiling did not exist; once wired, it took two fixes the
next day for false positives built into its design, and a third was withdrawn.

What it believed it measured, a session spending without progressing, is measured more reliably by
stall detection, on identical repetition. That is also where the reset came from without which the
ceiling was unusable: it was only a second reader of it.

## Task statuses barely connect

Five statuses, and a single transition rule: `later` only connects with `todo`. A committed task is
not postponed, a postponed task gets committed before going further. The rest of the moves are
free, including running a task already in review again.

## A task can wait for several tasks

Blocking between tasks is a graph, no longer a single "blocked by" field. The reason is the
`feature` chain: a spec is cut into slices, some of them independent, and the Wiki step must wait
for all slices, not the last one in order. Human review waits for them in turn, but through the
Wiki, because a following step has no business knowing how many slices there are. It was a wide
refactor, eighteen readers of the original column, decided on 28/08 against a linear
recommendation, because a forced order between two slices that do not read each other is one more
lie in the model.

It has been done since 29/08: the link table carries the blocking, the readers moved to it, and the
column was removed from the schema. What remains of the old model is the release rule, which did
not change: a link is consumed when its blocker goes to done, so a blocker run again afterwards does
not re-block what it had released.

## The chain is called feature, and it is sliced

`compound-engineer` is rewritten in place in the catalogue under the name `feature`. The name first:
it pairs with `bugfix` on the board without explanation, and a name that says what the chain is for
ages better than a name that describes its mechanism.

Rewritten in place rather than added alongside, because the catalogue is the source and a chain
installed in a project is a snapshot that does not move. Copies already running are therefore left
alone. So is `bugfix`: a fix skips the spec and the probe, and forcing a batch of slices on it would
be ceremony for its own sake.

A slice's criteria live in a separate column on the task, not as prose in the brief, because the
mode is what the gate uses and parsing agent text later is the wrong direction.

## Step 1 of feature is an interview, not a write-up

The agent that wrote the chain's spec worked alone: it started from a thin request and decided for
itself what it did not know. The discussion mode's interviewer does the opposite: it looks for the
facts in the repository and on the web, then asks for the trade-offs, and it produces the same file
in the same place. The two coexisted for a month producing the same artifact, and the chain used the
weaker of the two. So the step changes hands.

The previous agent stays in the catalogue with its technique, because it can still be assigned to
a standalone task, and because a catalogue entry that is removed disappears from the projects that
use it. The step changed hands, not the library.

The step's gate carries more weight than before. An interview outside a chain ends by proposing a
task whose brief is the spec, and that task landing in `later` is the approval gate. Inside the chain
there is nothing to propose: the Probe reads the approved spec and the Breakdown step turns it into
ordered slices. The step tells its agent so, rather than relying on its restraint.

What does not change, and what remains of the August decision to run the discussion mode alongside
the chain: the button that starts an interview still creates a standalone task, with no chain. A
project with no chain installed therefore keeps the whole discussion mode. Rerouting that button to
the chain would have removed it wherever the chain is not installed, which is the case for the
project where the need arose.

## The concierge fetches what it is asked about, instead of commenting on a summary

Settled on 13/09, against the read-only stance that had held until then, and on a usage trace
rather than an intuition. Since it went live, the concierge had held two conversations. The first
asked what was running, and got back what the board already shows, less well. The second asked why
a task was in error, and ran into its own limits before writing them out itself: "I cannot access
the URL directly", "the technical details of why they failed are not in my context", "I can only
inform, not act".

The only two real questions asked therefore wanted exactly what it did not have: a session's trace,
and the right to act. It was not a model defect. The context compiled for it is a summary, and a
summary never holds the line you are looking for.

It gets three reads of the control plane: a task's details with its sessions, the execution trace
that says why a session ended the way it did, and a task search. Refusal stays the default: no file
tool, no system tool, and a guard that refuses any name outside those three by interrupting the
session. Writing will come separately, because it needs a confirmation in the thread that the
current round-trip cannot carry.

What it costs: a conversation can now make several calls instead of one, and so takes more time and
more tokens than a single turn. That is the price of an answer that looks, and it compares with the
two conversations the version that did not look produced.

## The concierge has a page, and its situation report is the first turn of its conversation

Set at the end of August, and partly undone since (see just above for the tools, and
[[produit/etat]] for what remains to do on the page itself). Chosen over a panel that only answers
questions asked. The operator who opens Legion does not have a question yet; they need to know which
one to ask. An empty hover panel is nothing, you just opened it and are about to type; an empty page
is a broken promise.

The situation report is therefore written before anything is asked, and it takes the place of the
first turn rather than a banner above the thread. Three things fall into place together: the page is
never empty, the interface stays a conversation, and the history has somewhere to live.

It is computed on demand and cached, never on a timer. A clock that calls a model spends while you
sleep, and it is the same mistake as the endpoint that counted our calls and turned off the quota
gauge. The price of this choice is that the report ages; it shows its age, and a link recomputes it.
The global event stream has existed since 02/09, but nothing wires it to the report yet, and that
debt is visible on screen rather than hidden.

The hover panel in the bar stays. It is the quick question from anywhere, the page is where you come
back, exactly like the inbox badge and the inbox.

Turns are written on the server. The client used to send them with every call, which got two things
wrong: nothing survived a reload, and the browser was the source of truth for what had been said.

## Every task that writes code ends in a PR

Set on 30/08. This is not the approval gate: the gate says whether a human must validate a result,
the PR says where the code lands and how it gets read. A task without a gate still wrote code.

Opening is triggered by the fact, not by an intention. A session that ends with a push with changes
in its trace opens the PR, and the server does it, at the one place allowed to make a session
terminal. An invariant that relies on an agent remembering is an invariant you lose, and 30/08 gave
three examples.

Since 07/09, the question is asked of the task and not of the session that ends. Asked per session,
the rule missed twice in a row on the same task: the push from a session killed by the sweep
arrived after its recorded end, and the run that followed, finding the commit already on the branch,
pushed without changes. The code existed, the PR did not, and the button was needed. Since the forge
finds a request already open on the branch, widening the question creates no duplicate.

The `pr.md` draft was a condition; it becomes a preference. It is only asked of the agent when the
step declares its expected artifacts, so never on a standalone task: that day, a session pushed six
files and a branch and left no PR. When it exists it wins, because the agent read the diff. When it
does not, title and body are built from the task's name, its brief and the pushed repositories. A PR
without a hand-written description is better than no PR: it can be read, and completed.

A session that fails after pushing opens its PR too. The end status does not decide whether to open,
it decides the form, and the reason for stopping goes in the body. Opening nothing would leave an
orphan branch nobody finds.

Three guardrails come with it. A mock session never opens a real PR. Opening is idempotent, and the
forge carries that property: it finds the request already open on the branch and returns its URL,
so two session ends do not create two. And a failure to open is never fatal: it is named in the
task's trace and nothing else moves. The session is finished and the code is pushed; failing the
task over a forge outage would lose the work twice.

The "Create the PR" button stays, to reopen one that was closed. It is no longer the only path.

## The PR button only appears on pushed code

Decided on 14 September, after an interview task that had only produced a plan showed "Open the PR"
on its channel. The click could never succeed: the forge answers "No commits between main and
legion/…". `pr.md` alone no longer arms anything, neither the channel's button nor the task page's:
a draft without a commit cannot succeed, so it must not arm a gesture that can only fail. The signal
is the same one that already opens the PR on its own (a `repo_push` with changes on one of the task's
sessions), and screen and server hold the same rule rather than two neighbouring rules.

A PR already open marks itself. The reopen gesture only comes back if the forge says the PR is
closed: a live PR has nothing to reopen, and the click stays hidden while the state is unknown rather
than flickering between two reads.

The server holds the same lock. `POST /api/tasks/:id/pr` answers 422 when no repository was pushed,
instead of falling back to the repositories granted to the agent. That fallback protected a purged
trace that does not exist, since `session_events` are never deleted outside the full deletion of a
goal.

## Plan usage is no longer shown

Decided on 30 August, after a day spent repairing the measurement rather than guessing why it did
not come. A plan's percentage can only be read with a credential from a normal login. The control
plane's token comes from `claude setup-token` and lacks the profile scope: it is refused on
`/api/oauth/profile`, on `/api/oauth/usage`, and even in the CLI, where `claude -p "/usage"` falls
back to a cost summary as with an invalid token.

Reading the system keychain from the server and running the CLI in a session container were examined
and set aside: the first asks for authorization again at every Node update and only knows the
machine's account, the second goes back through the credential that lacks the scope.

What was left was a number for measurable accounts and an admission for the others. That is what was
refused: a gauge that only measures some accounts is a gauge you have to interpret before believing
it, and "not measurable with this token" took a spot in the bar without teaching anything. The
out-of-quota pause stays: it measures nothing, it reacts to a refusal.

[[guides/quotas]] holds the details, so the question does not reopen without its answer.

## A project holds several Claude credentials, in an order

Decided on 8 September. A project could only hold one subscription token, because credentials lived
in the secrets table and posting a name again replaces the value: adding a second token erased the
first, without a word. A session at the limit therefore had only one way out, sleeping until the
reset, even when another account was available.

Credentials have their own table, with a rank. Two options were set aside. Putting the rank in the
variable name, `CLAUDE_CODE_OAUTH_TOKEN_2`, needed no migration, but a variable's name is cited
elsewhere, in an agent's grants and in MCP headers: a name that means two things lasts six months,
then someone adds a `_3` nobody reads. Adding a rank column to secrets would have made every secret
pay for two of them, and the screen would have had to explain a field that is useless in almost
every case.

The switch itself costs nothing, which is what makes the feature cheap: the credential is read again
at every container start. The work was not switching, it was knowing which one is exhausted, until
when, and sharing that across sessions. Exhaustion was first stored per credential and window pair,
then simplified on 8 September: you only discover exhaustion by using the account, and you only use
it if it is free, so two windows can never be closed at the same time on the same account. One
column is enough, the last known time is the right one, and the window that closed it is written
next to it to say so.

The list only holds subscription tokens, no API key. Falling back to pay-as-you-go would have been an
unlimited last resort, so a spend decided by an outage. When all of the project's subscriptions are
closed, the session sleeps, and that is normal behaviour, not a defect. An API key remains a project
secret, only read when the list is empty.

[[guides/quotas]] describes what you see when it happens.

## The "Claude credentials" card

Decided on 8 September, following the previous decision: the server already held the ordered list
and the out-of-quota switch, without any screen showing them. The order could only be set through
the API, and nothing answered "why is my session running on this account".

The card lives on the project page, next to the secrets, not on a separate screen: it is the same
gesture as for a secret, applied to an ordered list rather than a set. It absorbs the former
`GET /api/projects/:id/credential` (singular), which already asked which account won without giving
the rank or what was exhausted; the singular route is removed with it.

The most frequent case will not be an account serving, it will be all accounts closed at once, the
session asleep until the first reset. That is why this verdict takes precedence over all others at
the top of the card, rather than waiting for the list to be read line by line to deduce it.

## A branch is named once, and never renamed

Branches used to be called `legion/<identifier>`. Three defects at once: `legion` is not a type in
the sense of [conventionalbranch.org](https://conventionalbranch.org), the identifier mixes cases
while the convention only allows lowercase, and nothing in the name says what the branch contains.
Since 30 August, a branch is written `feature/`, `bugfix/` or `chore/` followed by a description
taken from the task's title.

The real issue is not the form, it is the timing. A branch derived from the title changes when the
title changes, and work already pushed ends up on a branch nothing names any more: not the review
diff, not the PR opening, not the wake of a waiting session. Nobody is warned. So the branch is fixed
on first use and stored on the task; after that it is read, never recomputed.

The type comes from the classifier that already suggests the agent and the complexity, and falls
back to `chore` when it does not know. That is deliberate: a documentation fix sent to `feature/`
would lie more than an overly cautious `chore/`. There is no selector for this field and there will
not be one; it drives nothing, it names.

Tasks launched before this change keep their old branch: they pushed to it, and giving them a new
one would have emptied their diff for an aesthetic gain. Renaming branches on the forge was set aside
for the same reason, and more so: some carry open pull requests.

## The title convention is read from the repository, not configured

On 1 September, a PR opened by Legion was rejected by its target repository's CI on its title,
"legion: AI-1942 ...". Thirteen minutes later a human had put "feat:" by hand and the check passed.
It was exactly the mistake the previous decision had fixed for branches, left untouched on titles.

The first half of the answer was obvious: the suggested title takes the conventional type of the
task's branch, which is enough to pass the check and needs neither network nor token. A session's
commit message takes the same, and stops cutting the title mid-character along the way.

The second half was less so. A title is not right only by its form: the two repositories of one
project place the issue identifier in two different places, one in parentheses at the end, the
other right after the colon. No convention written in advance can be right for both.

A per-project "commit convention" setting was set aside. A field you fill in once is a field that
lies a month later, and it would have to be filled in per repository, not per project. So Legion
reads each repository's latest merged titles and gives them to the agent as examples. An example
shows the language, the scope and where the identifier goes in one go, where a sentence describing
all three gets argued over.

Two things this read does not do. It blocks nothing when it fails: the conventional-type title
remains, and the failure shows in the trace. And it comes with no format check on Legion's side,
because the target repository's CI already does that, and does it better. Two gates checking the
same thing end up disagreeing.

## Filtering a remote source is the source's job

It is not up to the front end to filter Linear issues, it is up to Linear. Settled on 1 September,
on a measurement taken against the real workspace.

The screen loaded the fifty most recently updated open issues, then applied the assignee, state and
team filters on top. The workspace has more than two hundred and fifty. `AI-1942` is open, assigned
to the operator, and ranks two hundred and seventeenth: it had never come down from the server.
Selecting yourself in the list would have returned an empty page, with nothing on it to tell "you
have no open issue" from "your question was never asked". That is the real defect, and it is worse
than a missing result: a filter that finds less than no filter teaches something false to whoever
reads it.

The principle goes beyond this screen. Filtering a paginated remote source on the client is a
category error: you filter a sample believing you filter a set, and the sample was chosen by a
criterion (most recently updated) that has nothing to do with the question asked. The front end can
sort, group and format what it has. It cannot answer a question about what it did not ask for.

The same measurement showed the twin symptom, with the same cause. The list of people was derived
from the assignees of the loaded batch, so ten names for twenty-six members. It now comes from the
workspace's members, which brings in those with no open issue and drops deactivated accounts. Teams
and state labels join them, for a reason that follows from the decision itself: once the filter
runs at Linear, the issues shown are the filter's result, and deriving the menus from them would
shrink them with every choice.

The window of fifty did not go away, it stopped being arbitrary: the search is no longer in any old
batch but in a precise question, and the count shown says when it hits the ceiling. Real pagination
remains to be done the day fifty filtered results bother someone.

## A task view is an address

A task's page had nine tabs, on a card that came ninth in a stack of blocks. They became ten views,
each with its path. Settled on 1 September, and it reverses a line written two days earlier.

That line said: a distinct subject gets a route and a rail row; another look at the same object gets
a tab. It had served to give the Settings sections their addresses while keeping a task's tabs. It
predicts nothing useful. The crate and the repositories are two looks at a project as much as the
diff and the brief are two looks at a task, and the former became addresses without anyone
objecting.

What really separates the two cases is number and structure. Nine entries falling into three named
families do not fit on a horizontal bar, because a horizontal bar cannot name a group. The rail can,
it already does it for the project, and the run, the contract and the delivery were spelled out in
code comments without anything showing them. The criteria, which were a permanent panel above the
tabs, finally find a place: they are the task's contract, read with its brief.

The page now reads in two parts. The head does not scroll and carries what depends on no view: the
title, the gestures, the verdict, and what needs a decision now, an agent's question, a batch to
approve, the blockers that explain why the run button is missing. The view fills the rest and
scrolls on its own. That was the real defect, of which the tabs were only the most visible symptom:
nine blocks had piled up because each one, taken alone, deserved to be always there.

The rail rows never move, and that is a choice. What the rail shows is decided by the path and
nothing else, while whether a report exists is deduced from the session's event stream, which lives
in the page. Rather than lift the page's state up to the menu, the rows are always there and a view
with no content says in plain words what it lacks. A menu whose entries do not move beats a menu that
moves, and an empty view explains what a missing row does not. The price is that the old bar's
counters (rounds, events, artifacts, open review comments) are no longer shown.

Old addresses keep working. The `?vue=` parameter had been in the URL for a week, so in bookmarks and
in messages, and a link that asked for nothing does not get broken.

There are eight views today: the diff merged into the PR view on 05/09 and the settings route left
on 12/09, both below.

## A remote machine only has its Docker daemon, and two paths beat one

Nothing is installed on a machine that runs sessions. No agent, no service, no script: Docker is
assumed reachable, and nothing more. That constraint decided the rest. Filling a remote session's
working directory therefore goes through a container, via the same daemon as everything else, and
never through a shell assumed to be open over there.

The local socket keeps exactly its old mounts. Unifying the two cases would have been more elegant
and will be cheaper another day, but that day was not the one when the first remote session was
made to work: reusing a working directory between two wakes is built on those mounts, it works, and
breaking it for symmetry would have paid for progress with a regression. The accepted price is two
paths to read instead of one, and a test that freezes the local behaviour so nobody changes it
thinking they are simplifying.

## A secret comes in through standard input, or it does not come in

A repository's key has to reach a remote machine. Three doors existed, and two leak. An environment
variable can be read back from the container's configuration for its whole life, which is already
why a session's spec no longer travels that way. A temporary file placed on the remote machine
survives precisely the failure that prevents removing it. That leaves standard input, which is
written nowhere.

The volume holding the key is removed at every container end, even when the session pauses to ask a
question: the wake puts one back from the control plane's disk, which is the only source. A secret
lingering between two sessions is exposure time gained for nothing.

## Documentation lives in the repository

The usage wiki and this product documentation are versioned files, not database rows. They are
therefore in every session's clone, and an agent that needs to know what a gate is reads it without
anyone inventing a tool to serve it.

## Tailnet membership is the authentication

Decided on 01/09, with the multi-machine work. The control plane moves to the home server and
sessions run on the Macs, so the operator must be able to open the app from a machine other than the
one hosting the API. Loopback could no longer be the only answer.

It was not replaced by a token or a login page: it was replaced by another network. Tailscale is
WireGuard between the machines of a single account, so "this packet comes from 100.64.0.0/10" is a
property of the network exactly like "this packet comes from 127.0.0.1": a web page cannot declare
it, and a container on a Docker bridge cannot imitate it. What changes is not the nature of the
check, it is its perimeter.

What follows, and explains what was not written. No TLS, because the tailnet already encrypts every
link end to end and one more certificate would be a moving part that expires. No login page, because
the only account it would protect is the one that already authorised the machine into the tailnet.
The `/internal` port keeps checking its session token route by route, whatever the setting: the
address was never what authenticated it, so opening the human API takes nothing away from it.

The limit, in one sentence: there is no application authentication, so anyone on the tailnet is the
operator. A compromised tailnet machine, or a device added to the account by mistake, gets the whole
interface. That limit is acceptable for a single operator whose tailnet holds only their three
machines, and it stops being acceptable the day someone else joins, or the day a tailnet machine
runs code you did not write.

That limit was reached, and this decision has been superseded since 13/09. The condition written just
above described the product's very job: Legion runs code nobody wrote by hand on those machines. An
agent container on a remote machine goes out through its host, so it arrives as `100.x`, and the
guard cannot tell it from the operator's browser. Measured rather than assumed: a `curl` from a
runner machine got 200 on `/api/bootstrap`, presenting nothing. What authorizes the human API is now
an operator session; see "What authorizes the human API is a session, not a network" below. Tailnet
membership remains useful, but it only does one thing now: narrow who can talk to the port.

The guard and its `LEGION_LISTEN` setting were removed on 13/09, along with the shortcut that should
not have been taken (exposing the Vite development server, whose relay would have made every request
arrive as 127.0.0.1). What the guard refused, the session refuses too, and for better reasons; what
it cost remained whole: a 403 returned before the token was read, and a special case to plan for
every front end. A layer you have to work around at every new setup is no longer a layer.

Limiting who can talk to the port is still useful, but it is no longer Node's job: the socket must
stay open on every interface so containers can call `/internal` back. That job belongs to the
machine's firewall and to Tailscale ACLs, and in the cloud to the security group.

What was missing on 01/09, and has been done since: the server did not serve the built front end, so
the screen only opened from the control plane's machine. `web/dist` is now served by the SAME process
as the API (`server/src/http/static.ts`), with an SPA fallback. There was no relay in front at the
time, because a proxy would have replaced the browser's address with its own and left the address
guard nothing to decide. Since the guard is gone, that reason no longer holds, and an HTTPS front end
now sits in front (next decision). Static serving is an addition, not a condition: a missing
`web/dist` is the everyday development case, where the screen lives on Vite.

See also [[produit/principes]] and [[produit/etat]].

## TLS comes back, because the browser requires it

Decided on 13/09. It revises the "no TLS" of the decision above, and how is worth saying, because the
reasoning of 01/09 was not wrong.

It still holds for what it aimed at. The tailnet already encrypts every link end to end, so a
certificate added no confidentiality and added a part that expires. What changed is not that
reasoning, it is the premise: the product was built for local use, and it is now looked at from a
phone.

The phone's notification channel will be an installed PWA with Web Push. A service worker only
registers in a secure context, and that constraint comes from the browser, not from us. Without TLS
there is no service worker, so no push, so no mobile channel. The certificate is no longer there to
encrypt, it is there to unlock a browser API.

The setup chosen is Caddy with a Let's Encrypt certificate obtained through a DNS-01 challenge, on
`legion.legionhq.dev`, listening on the machine's Tailscale address. DNS-01 needs no inbound
reachability: the certificate is obtained by proving you own the domain, not that you can be reached
from outside. Nothing opens on the internet, and the only change is a name and a certificate in front
of the API. The address moved to `app.legionhq.dev` the same day; see "The PWA is the screen, not a
second application".

A correction to this page, written the same day a few hours later. The first version said tailnet
membership would remain the authentication behind Caddy. That was wrong, and dangerously so: a relay
makes every request arrive on loopback, so a guard that accepts loopback accepts everything it
relays, without any screen saying so. That is the incident `http/static.ts` documents about a proxy,
and the one `guard.ts` documents about `vite --host`. This setup is only safe because there is now an
operator session underneath, and loopback no longer authorizes anything anywhere. Without it, the
choice was between TLS and the guard.

Alternative set aside: `tailscale serve`, which does the same job in one command with nothing to
renew. It serves on `machine.tailnet.ts.net`, and a Web Push subscription belongs to its origin.
Switching to `legionhq.dev` later would kill every subscription and mean reinstalling the PWA on every
device. The domain had just been bought when the question came up, so the final origin might as well
be taken right away.

A quirk of `.dev` worth knowing: the domain is on browsers' HSTS preload list, which forces HTTPS on
it. There is no plain-text fallback, even in development. The certificate is not a comfort, it is the
only way to open the page.

## What authorizes the human API is a session, not a network

Decided and built on 13/09. It replaces the address guard as AUTHORIZATION, and supersedes "Tailnet
membership is the authentication" from 01/09.

The September reasoning rested on a true property: a source address cannot be declared, so a
container on a Docker bridge cannot pass itself off as the operator's machine. What undid it was not
a mistake but another decision, the multi-machine one. A container running on a remote machine goes
out through its host's network, which hides it behind the host's tailnet address. It therefore
arrives from an address the guard accepts, and no address rule can tell apart two processes on the
same machine. That is structural.

The measurement before the conclusion: a `curl` run from one of the runner machines got 200 on
`/api/bootstrap` without presenting anything at all.

What authorizes is therefore an operator session. And it really is the session, not the token: the
token is one way to obtain one, a security key will be a second once there is TLS (WebAuthn requires
a secure context), SSO a third if Legion becomes a product. A guard that compared a token would have
to be reopened at every new way in.

The token is created at the first boot that finds none, and printed once in the boot log. Generated
rather than set through a variable, because a fresh install must be safe without anyone thinking
about it, and "I will set it later" is exactly the state this API stayed open in. The database only
keeps its hash. A browser exchanges it for a cookie the page's script cannot read; a tool presents it
as a bearer.

All the security comes down to one sentence: this token never enters a container. An agent only
receives the token of ITS session, which only opens that session's internal channel. The sentence is
not an intention, it is a boundary rule checked at build time (`operator-token-stays-home`): no
module outside the domain can read the token, so none can slip it into a spec or into a container's
environment.

What it does not protect, and that is accepted: an agent that got a shell on the control plane
machine reads the environment, and that is the end of it. The token protects against a container on
another machine, not against a compromised host.

What remains to do as exposure grows: rate limiting on verification, rotation, and the CSRF question
on a public origin. None is justified while the token is a second layer behind the tailnet rather
than the only one.

## The pipe is not the session, and the machine's sleep is not its business

Decided on 01/09, with the multi-machine work. Two consequences of one fact: a session runs on a
machine Legion does not control, and that machine sleeps.

The first is a reading rule. The connection waiting for a remote container to exit breaks for
reasons that say nothing about the session, and until then a break read as an agent exiting with an
error. A transport break is no longer a conclusion: wait, ask the machine again whether it answers,
reattach to the same container. It is the same rule as at server start, where Docker is asked before
a session is declared dead, and the same incident taught it. Patience is capped and the final
failure names the host, because a session that reattaches forever holds a slot nobody gets back.

The second bends the "nothing to install on remote machines" constraint, and that should be said
rather than left to look like an oversight. Keeping a Mac awake means running a command on it, so an
SSH shell: it is the only place in Legion that assumes one. Nothing is installed, `caffeinate` is
part of macOS, and above all nothing depends on it. A host that is not a Mac, a command not found, an
SSH that refuses: the absence is reported once and sessions start anyway. The general rule stays the
one of the multi-machine work, and this exception is acceptable exactly because it is optional by
construction.

See also [[concepts/runner]].

## The Docker socket enters the control plane's container

Decided on 01/09, so the update button exists on a server install. The control plane's container
mounts `/var/run/docker.sock`, which a versioned file in this repository explicitly said not to do
three days earlier. The reversal deserves its reasons.

What it amounts to, without softening: control of the host's Docker daemon is equivalent to root on
that machine. A process talking to that socket can start a privileged container, mount the system
root and do what it likes with it. It is not one more permission, it is the last one.

Why it is accepted here, and only here. The home server is dedicated to the control plane: no agent
session runs on it, they are on the Macs declared as runners. The code running in this container is
this repository's, not what an agent just wrote. And the control plane already drives, over
`ssh://`, the Docker daemons of the other machines: refusing it its own host's daemon protected less
than it seemed. What it gets here, it already had elsewhere, and since 02/09 the ephemeral update
container EXERCISES that power too, rebuilding the session image on every enabled `ssh://` runner
after restarting the control plane.

The gesture that requires it has no other form. Updating Legion rebuilds and replaces the container
that serves the interface, so the process applying the update cannot be the one being replaced. In
development, the answer is a detached script that outlives the server; on a server, a detached
container that outlives the container. There is no way to start a container without talking to the
daemon.

The alternative set aside, and why. A socket proxy with an allowlist, or a tiny agent installed on
the host, would reduce the surface to `run` and `build`. Both cost a part to maintain on the machine,
and the multi-machine work holds precisely because of the "nothing to install" constraint. The day
someone other than the operator has an account on that server, or the day a session runs on it, this
decision reopens, and the allowlist proxy is the prepared answer.

The limit reads together with [[produit/decisions|tailnet membership is the authentication]] above.
The two multiplied: anyone on the tailnet was the operator, and the operator can now have a container
started on the server. Since 13/09 the first factor is the operator token rather than the tailnet;
the consequence of holding it is just as large.

See also [[guides/mettre-a-jour]] and [[guides/installer-sur-un-serveur]].

## The screen listens instead of asking

Decided on 02/09, after a measurement. An open, idle task page ran a cycle of five requests every four
seconds: tasks, lineage, inbox, per-project badges, artifacts. That is seventy-five calls a minute
per viewer, fifteen of them the full task list, which weighs about 460 kB. Seven megabytes a minute
to learn, most of the time, that nothing happened.

The server already knew everything the screen asked for again. Every change goes through an internal
event bus since the first version, and that bus was served over SSE for an open session, never for
the whole application. The global stream therefore created nothing: it serves what existed.

What flows in this stream is deliberately thin. A type and identifiers, never a body. No task name,
no answer text, no file content. The screen receives "something changed on this task" and asks the
route it already knows. Sending the data down two paths would have produced two truths to reconcile,
and brought back the megabytes just removed.

Polling is not removed, it is slowed down. Lists that refreshed every four seconds now do so every
sixty. A stream that dies silently is a plausible failure, and a screen that lies is worse than a
slow one: the interval stays as a safety net, with a maximum delay of one minute in that case only.
On reconnection, the screen asks for everything again, because it cannot know what it missed during
the gap.

The transport stays SSE, like a session's trace. WebSocket was set aside at the start of the project
and nothing in this work reopens it: there is nothing to send the other way, and a single operator.

See also [[concepts/session]].

## The webhook door is a signature, not an address

Decided on 03/09, with the webhooks batch. A merged PR must finish its task without the operator, and
forges cannot reach the tailnet: it was either poll the forge in a loop or accept a first public
surface. Polling was set aside by the operator, explicitly because the project aims at other users
eventually: the public surface will come anyway, so the way to build one might as well be set now.

The `/webhooks` prefix is Legion's first path whose door is neither loopback nor the tailnet: it is a
per-request proof (HMAC of the body at GitHub, header token at GitLab, constant-time comparison, a
size cap before reading). It sits outside the human API's guard as `/internal` does (the address
guard at the time, the operator session since 13/09), reserved on the static side so the screen's
fallback is never served there, and exposed through Tailscale Funnel on that path only. The rest of
the API does not change model.

Two things set this secret apart from everything the vault already held, and both are accepted. It
is durable where a session token is ephemeral. And it is the first secret Legion HANDS to a third
party: it also lives in the hook's configuration, at GitHub or on the GitLab instance. That is why
creating it requires the master key: an instance without `LEGION_MASTER_KEY` refuses to connect
rather than write in clear, on its disk, a secret that also lives elsewhere.

The webhook itself has no authority: it identifies, and the decision reads the real state on the
forge again before moving anything. A payload forged with a stolen secret can, at worst, trigger
rereads. See [[concepts/forge]] and [[guides/webhooks-entrants]].

## The flat shell and the task panel

Decided on 04/09, on an HTML mock-up validated by the operator after a ten-screen exploration in
Stitch. What was kept is a STRUCTURE, not a visual world: flat (a surface that sits on the page has
no shadow, only its rule outlines it, and only what floats above the page keeps one); the product
mark at the head of the icon rail and the workstation settings (system, wiki) at its foot, away from
the projects; the top bar naming the screen in the same place on every route, from the same table as
the document title; on a task's page, a right-hand panel open by default. What was set aside was set
aside explicitly: GitHub's palette copied (Nord stays), numbers the product does not measure (fleet
cost, latency, temperature), objects it does not have (Fleet, Telemetry, Approvals), double
navigation. The drawing-board grid goes too: tried without it, compared side by side on the same
page, removed. A surface is outlined by its rule, not laid on a grid. The `--grid-*` tokens stay, to
put it back in one stroke.

The right-hand panel has two faces and never both: while no session has run, the task's settings,
what you decide BEFORE; once a session exists, the runtime, what you observe AFTER, with the session
identifier at the foot because that is what gets copied into a message or a `docker logs`. The
session decides the face, not a tab. "Settings" therefore left the views rail: a row for what the
panel already shows said the same thing in two places. The route stayed for a while, as a bare
address, then was removed on 12/09 for lack of a single link still pointing at it; see "Ghosts leave
the router" below.

The verdict of a finished session fits on one line, and the PR is ONE icon there: shape and colour
say the state, the number says which one, the word stays in the accessible name. The colours are
GitHub's, on purpose (that is where the operator learned them and finds them again by clicking) and
they are only used for this icon. The repository is only named when the task pushes several. The
file count leaves the banner for a badge on the "Diff" rail row: it is the only piece of data that
goes up from the page to the rail, through React Query's cache, and it is kept narrow on purpose. No
row moves, only a number crosses. The rule "the rail is a pure function of the path" still holds for
the ROWS.

See [[concepts/session]] and `docs/DESIGN.md`.

## The diff is read in the PR view

Decided on 05/09, on an HTML mock-up of three layouts (`docs/directions/direction-pr-diff.html`,
variant A chosen by the operator). A task's delivery was read in two rail views: "Diff" (tree, files,
pre-review) and "PR" (the `pr.md` draft, merge state, the create button). You do not create a PR
without reading it, which was the point of the PR view; but you read it without seeing what it
changes, and created it from a view where the diff was not.

The PR view now reads like a GitHub page: the draft at the top, short, then the diff and its
pre-review below, long. The create button sits just before the files it will publish. The "Diff" row
leaves the rail, and the file-count badge moves to the "PR" row. The `/diff` segment and the inherited
`?vue=diff` redirect to `/pr`, without a history entry. The segment was removed in turn on 12/09, once
the grace period was over and no link was left to fix; the inherited `?vue=diff` still reaches `/pr`.
See "Ghosts leave the router".

Two other layouts were drawn and set aside: a "draft" banner above the diff, which let the draft
exist in two places; and a PR view with two segments, "Description" and "Files", which carried the
separation one notch closer. Along the way, the draft's body is rendered as markdown: it used to show
as a raw code block, asterisks and table bars visible, and that is what the forge will do with it
anyway.

## Inbox round: one question per screen, a summary to send

Decided on 07/09, on a mock-up of three ways to cut the same round (direction A chosen by the
operator: "great design, let's stick to it"). Round 2 of AI-2219 arrived with six questions, three
tables and a twenty-line preamble, served as one block: argument, question, options and
recommendation followed each other without hierarchy, and the decision to make drowned in what
justified it. The problem was not quantity, it was the lack of cutting.

The round now reads one question per screen: the title is the field's label, the argument is what
the agent wrote just before that field and nothing else, its "## 3." title line removed since the
screen already numbers. The action receipt (what the agent read and what the round touches), which an
ordinary question shows in full, is folded at the head of a round and never unfolded by default: on
AI-2219 it came before the first decision by twenty lines. A first version folded the blocks before
the first field into it, and question 1's argument disappeared with them; reread on the real round,
the format has no preamble, the first block is already the first question's argument. A rail on the
left keeps the coherence the view no longer shows: the chosen answer is written under each question,
and you see at a glance what is decided and what remains. The agent's recommendation is preselected
and labelled; going through the screens with Cmd+Enter means "I follow you".

Sending and commenting live on the summary, a seventh screen. You reread the six answers at once,
fix a line by reopening it, and the comment covers the whole round. The per-question note that had
existed since 25/08 goes away: what you have to tell the agent almost always spills beyond a single
answer, and six more text boxes were part of what made the round unreadable. The comment goes in the
same JSON as the answers, under `__comment`; per-field notes are still accepted by the server for
answers coming from elsewhere. A single-question round skips the summary: it would reread nothing.

What it costs, accepted: a few more clicks for whoever reads everything and answers in one go, and
related questions read separately, with the rail making up for what the view does not show.

Two other cuts were drawn and set aside. The decision sheet, showing the six answers first and the
argument on demand: the fastest to triage, but it folded the comparison tables the agent had taken
the trouble to draw, and it needed a short title per question. The strict-grammar thread, keeping
today's topology while forcing three fixed levels on each question: the least code, but still six
cards to scroll, and badges that do not fit long labels.

## A question has its page; the channel only shows a card

Decided on 07/09, a few hours after the round cut above, on the same mock-up pushed one notch
further. The cut had fixed a round's readability, not its place: the questionnaire is two thousand
pixels tall, and there are two thousand pixels nowhere in a channel column 240 to 440 px wide. Pinned
above the thread it crushed it; capped and made scrollable, it opened a second scrollbar in the same
column, which the operator summed up while looking at the screen: "this is wrong, there are two
scrolls".

The rule that comes out fits in one sentence. A single surface asks the question, a dedicated page at
`/p/<project>/inbox/<question>`; every other place leads there through a card. It is the relationship
Claude's artifacts have with the conversation that produces them, and that comparison is what got the
principle accepted.

The scope is settled and narrow: a form with at least two fields goes to the page. A text question, a
choice question and a single-field form are answered on their card, as before. The threshold lives in
one place in the code, because it decides three things at once, and two copies of a threshold end up
diverging.

The card is one component rendered by four frames: the last turn of a channel's thread, the head of a
task's page, the rows of the Inbox page, the rows of the bar's waiting panel. Four frames, zero
copies, and the same grammar everywhere: who asks and since when, the title, what you can do. That is
what lets you recognise a question before reading it.

The draft lives in the database, in two columns of the inbox entry, not in the browser: you settle
two points on the train and finish at the desk, and local storage would have kept the work on the
wrong device. There is no "partially answered" status for all that. The temptation was a fifth status
next to `open`; it would have made every reader of the column (the rail badge, the waiting panel, the
session guard, the sweep) carry a distinction that changes nothing in what they do. A session sleeps
exactly the same with or without a draft. "Partially answered" is therefore derived for the screen,
never a state of the model, and answering clears the draft since it no longer describes anything.

An interview's rounds are not linked by a column either. They already share their task, and their
order is their creation order: "Round 2 of 3" is computed. A position column would have had to be
maintained at every round, and would have been wrong the first day a round arrives out of sequence.
The computation leaves out entries that wait for nobody, a task wait or an out-of-quota pause, or the
number would say five rounds on an interview that had three. The server does this computation, and it
has to: the rule reads the reason of every entry of the task, closed ones included, and the screen
does not have them all.

The same page freezes read-only once answered. No other address, no other component: the link pasted
somewhere keeps leading to the same place, and an interview's history is the sequence of its pages.
The switch follows the entry's status, not a local state, so an answer that came from Discord or
another tab freezes the page on its own.

A second surface had been drawn and is set aside: an artifact-style panel in the Channels view, the
open question in the widened details column, the thread still visible on the left. Its only gain is
keeping the thread in sight, and the folded context at the head of the page plus the "Open the
channel" link cover that without another surface. It would only exist above 1200 px, so it would not
replace the page, it would add to it: two surfaces to maintain for one component. If keeping the
thread in sight is missed in use, it will be one more frame around the same card, not a second
implementation.

## Configuration is arranged by the question, not by the table

Settled on 09/09, after a survey of the sixty-four routes and the content of the thirteen
configuration screens. What triggered the decision fits in one sentence from the operator: a
project's Settings area is messy, you cannot tell where anything is.

The screens were arranged by database table. The project's name, its colour and its Claude accounts
lived under "Secrets and identity" because they are columns of `projects` and `credentials`; the SSH
key lived under "Execution" because it travels with the image in the same form. The question "where
do I set access to my git repositories" therefore had three answers: Repos for the URL, Execution for
the key, Agents for the grant. Ten screen descriptions ended up saying where the rest of the gesture
was, and a screen that has to explain that is a screen in the wrong place.

The navigation mechanism does not change, and that is the day's second decision, taken after trying
three others. One rail at a time: entering a configuration section replaces the project rail with
that section's rows, and "Project" with a back arrow returns to the board. What is added is a
cross-fade between the two, because an instant swap does not say whether you changed level or
screen.

Three forms were drawn then set aside. Horizontal tabs above the content kept the project rail
visible, but made navigation read on two axes, and seven tabs are already the most a bar can take. A
rail unfolding its sections as an accordion kept a single reading direction, at the cost of a
seventeen-row rail. A third column next to the project rail took four hundred and fifty pixels of
width before the content, and did not carry over to a phone, where two columns do not exist. The
swap carries over as is: on a phone the rails become a drawer, and the same list replaces the other
with the same fade.

What changes is therefore the content of the rows, not their mechanics. Project holds what the
project is and what it owns: General, Repos, Secrets, Models, Sessions, Crate, Danger (Integrations
joined on 15/09). Library holds what can be given to agents: Rules, Skills, MCP servers, Chains.
Agents keeps its registry and its sheets, without a sub-rail. The task rail does not move either.

The name "Library" frees "Capabilities", which in the wiki means what is granted to an agent and on
screen meant the library of what exists. Both meanings had coexisted from the start, and that is the
kind of collision you stop seeing once you have written it.

The injected context joins General, with the name and colour: it is what the project is. It remains
the only standing text set at project level, the other two being rules and an agent's role.

The four settings that existed in the database without a screen are exposed rather than removed. The
project's default model was shown on eight screens and editable nowhere; it joins Project, Models
tab, above the routing it is the fallback of. An agent's inbox access and preferred machine join its
sheet, Engine section. A task's forced model joins its settings, with the chosen machine that was
only reachable from a failure's verdict. A column the server reads and nobody can write is a promise
half kept.

The global inbox goes away. The 26/08 decision had made the inbox a summons grouped by project rather
than a page, and `/inbox` outlived it without a menu entry, reachable only from the palette. The
palette now sends to the inbox of the last opened project, and the bar's panel keeps covering every
project.

The first batch is invisible and it is the one that matters. The eighteen task links in the
application pointed at `/tasks/<id>`, which redirects to the canonical address under the project,
which nothing linked to. Four buttons still pointed at `/infra`. As long as a redirect serves as a
link, the canonical address is a fiction and every new link copies the wrong model. Links therefore
point at canonical addresses, and a gate refuses any internal link to a redirect, on the model of
`make contract`: the list of redirects becomes declared debt and not a graveyard.

Renaming the paths comes last, once the rest is in place. They are bilingual today, and they move to
English: the project convention said French for docs and discussion, English for code and
identifiers, and a URL segment is an identifier. The on-screen labels stayed French at the time, and
that was the point not to confuse; since 16/09 the whole interface is in English. It is the most
expensive and least urgent change, and it fixes nothing observed in use.

## Ghosts leave the router

Settled on 12/09, navigation work batch G, the last step of the target proposed on 09/09. Four
addresses were served by `web/src/router.tsx` without any rail listing them or any link pointing at
them: a screen you only find by knowing its URL, and that nobody knows needs maintaining.

`…/taches/$taskId/settings` duplicated the page's right-hand panel, which has carried a task's
settings since 04/09. `…/taches/$taskId/diff` redirected to `/pr` since the diff is read there, under
the draft (05/09); the grace period that decision gave itself is over. `/systeme/modeles` redirected
unconditionally to `/systeme/general` since the model catalogue was folded in there. All three go:
removed, not kept as redirects, since nothing points at them any more. The inherited `?vue=diff`
still reaches `/pr`; that is a separate mechanism, for links already pasted in messages, and it was
not part of the batch.

The global inbox goes away, which the 09/09 decision above had already settled without carrying it
out: `/inbox` had no menu entry any more, reachable only from the palette and a breadcrumb. The
palette now sends to the inbox of the last opened project, with the same computation as the root
route `/`: the last visited project (`readLastProjectId`), otherwise the first in the list, and
nothing at all while no project exists. Not a third behaviour for a question already answered
elsewhere.

The task rail called a task's thread "Interview", the project rail called the same thread
"Channels". Both render the SAME component on the SAME segments (checked in the code, not assumed,
before deciding), so both now carry the same word, "Channel". The title of the Channels page itself
stays plural: it names the LIST of the project's live channels, not one thread.

## Paths move to English

Settled on 12/09, navigation work, batch 5, the last one. The project convention said French for
docs and discussion, English for code and identifiers, and a URL segment is an identifier. `/systeme`
becomes `/system`, `/systeme/infra` becomes `/system/runners` since the row already says "Runners",
`/systeme/journal` becomes `/system/logs`, `/systeme/statistiques` becomes `/system/analytics`. Under
a project, `/canaux` becomes `/channels`, `/taches` becomes `/tasks`, `/planifiees` becomes
`/scheduled`, and in settings `/modeles` becomes `/models`, `/execution` becomes `/runtime`, `/coffre`
becomes `/crate`.

`/capabilities` becomes `/libraries`. The path follows the "Library" label that batch 2b set, in the
plural like every collection segment in the repository: tasks, goals, agents, channels, reviews,
issues. The label stays singular: it names the section, while the path lists what it holds, the same
gap as `/project` shown as "Settings". `regles` becomes `rules`; skills, mcp and environments were
already in English but move with the registry that holds them.

On-screen labels did not move in this batch; they moved to English with the rest of the interface on
16/09. Every old address is still served, as a direct redirect to the new one: a bookmark or a pasted
link keeps working, and `navRedirectLinks` (`scripts/arch-metrics.ts`) forbids a link in the
repository from pointing at an address that redirects, on the model of `make contract`.

## The PWA is the screen, not a second application

Settled on 13/09, PWA batch. The starting idea was a small mobile application with reduced features,
next to the desktop screen. It does not hold: deciding in advance what is missing means rebuilding
every piece you end up wanting, and two origins would mean two operator sessions, two sets of
subscriptions and, when the day comes, two passkeys. A Web Push subscription and a passkey are bound
to the ORIGIN, not to the account.

Legion therefore serves the same screen under the same name. What changes on a phone is the layout,
and it has been there since 13/09: below 640 pixels the rail disappears and a tab bar takes over. The
first version of that bar carried Board, Inbox, Channels and More; later decisions below replaced
it. What is not adapted yet stays reachable, less comfortable, instead of absent.

Two files are enough to make this screen an installable application: a manifest and a service
worker. The service worker ONLY does push, with no cache and no offline mode: a service worker that
serves cached responses is the surest way to freeze a screen on a dead version, and Legion updates by
rebuilding itself.

The address moved from `legion.legionhq.dev` to `app.legionhq.dev` in the same move, while no
subscription existed yet. The old name redirects with a 302: a permanent redirect gets engraved in the
browser cache and cannot be taken back.

## Push is an output of `notifyOut`, not a notifier

Settled on 13/09, PWA batch. Discord is a notifier: the registry (`inbox/notifiers.ts`) passes it
text already written and does not know the vocabulary of events. The decision at the time named
Telegram next to Discord; that notifier was announced and never written. Push must be able to narrow
itself to what really waits for the operator, so it needs the event's name, which only `notifyOut`
holds.

It plugs in there, next to outgoing webhooks, and inherits without rewriting them the global kill
switch, the anti-spam and the filter convention: a subscription carries its list of events, and empty
means all. By default, everything pushes.

## A single board lane on a phone

Settled on 13/09, after a trial on an iPhone 16. Stacked, the five lanes make a page you scroll
through without ever taking it in: what you came to see ends up among the done cards. The board
therefore renders a single lane at the compact breakpoint, chosen from a row of pills that carry the
counts; that replaces the glance you had over the five columns at once.

Rendered, not hidden: a lane hidden in CSS would keep its cards in the DOM, so in dnd-kit's tree and
in the tab order. The breakpoint is therefore read in JavaScript (`ui/use-media-query.ts`), which
stays the exception; breakpoints live in CSS everywhere else.

Drag and drop changed sensors in the same batch. A `PointerSensor` treats mouse and finger the same
way: six pixels of movement and the card goes, but six pixels are the start of a finger scroll. Mouse
and touch now each have their own, and by finger it is a 250 ms long press.

## The tab bar exists everywhere, not only inside a project

Settled on 13/09, while going through the screens on an iPhone. The compact breakpoint hides both
rails and hands navigation to the tab bar, but that bar only rendered under `/p/`. Measured result at
393 pixels: `/system`, `/wiki` and the concierge showed zero navigation elements. In a browser the
back button gets you out; an installed app has no address bar, so the screen was a dead end.

Outside a project, the bar therefore carries a single destination, "Projects", pointing at the root,
the switch that already knows which project to reopen, and the place's sub-navigation in its "More"
drawer. The drawer only appears if it has something to show: a target that opens onto nothing reads
as a failure.

The solution tried first was giving those screens their rails back instead of the bar. Measured and
dropped: the wiki's rail is a list of pages, and it left 24 pixels of content out of 659.

## A task's page becomes a stack again when its columns stack

Settled on 13/09, after a trial on an iPhone 16. In two columns, a task's page fills exactly the
content area: the head stays put, the view scrolls under it. Stacked (which the panel already does
below 1100 pixels) those same rules turn against it. The main column claimed a height already taken
by the panel, and the permission to shrink below its content brought it down to ZERO: measured at
393 pixels, it was 0 pixels tall while its head was 767. All its content overflowed over the panel,
title under the toolbar, buttons floating among the runtime cards.

In a column, the page is therefore an ordinary stack again: each part keeps its content's height and
the content area scrolls, once, as everywhere else.

The title and its six gestures stack too at the phone breakpoint. `flex-wrap` was tried and changes
nothing: it only kicks in if the children do not FIT, and the title shrinks instead of forcing the
wrap. It fell to fifty pixels and its text overflowed its box.

A task's page joins the addresses measured by `make responsive`. It was missing, and it is where you
land from a notification.

## The phone bar carries the whole level, and it scrolls

Settled on 13/09, second version of mobile navigation, at the operator's request after a trial. The
first put three fixed destinations and tucked everything else behind "More": you entered Settings,
landed on General, and reaching Repos meant reopening the drawer. Two taps for every jump between two
neighbours of the same section, on the screen where the gesture must be shortest.

The hierarchy to follow already existed in the code. `railRowsFor(pathname)` has always returned the
list for where you are, the project's or the section's, with a back row at the top. That is exactly
"a submenu shows when you enter it, with an arrow to go back up". The bar therefore no longer keeps a
list of its own: it renders the rail's, lying down. Rail and bar show the same thing, one standing,
the other lying, and the same function decides.

The back row is pinned outside the scroll: it is the only target whose absence traps you, and an exit
that slides away when you swipe is not an exit. The current entry is brought into view at every
navigation, which is the only thing that makes a scrolling bar usable; without it, entering a section
through a link on the page leaves the bar on its first row.

Targets have a fixed width rather than sharing the bar. Half a row visible at the right edge says the
list continues, better than a shadow nobody reads as an invitation.

Group headings do not survive going horizontal, and that is accepted: a heading is a column landmark.
Order is kept, so neighbours stay neighbours.

The "More" drawer disappears with this version.

## The phone bar keeps what says where you are, and folds the rest

Settled on 14/09, at the operator's request. The bar carries five families: where you are, what is
waiting, the version, the workstation gestures, the switches. At 393 pixels they do not fit on one
line: the bar wrapped, went from 44 to 95 pixels, and its second row had only a bell on it.

What stays visible is what says where you are: the open project and the screen's name. The rest opens
with one tap on a row of its own.

A fold, not a menu. The hidden tools are not choices in a list: they are buttons that each open their
own surface, the palette, the waiting panel, the concierge's. Nesting them in a menu would stack two
floating layers, which breaks the focus trap of both. They stay themselves, in a panel that only
carries them.

And that panel FLOATS, it does not push. The first version gave it a row: the bar went from 61 to 115
pixels and the whole screen dropped fifty-four pixels while you touched an icon. A tool panel has no
reason to move what you are reading.

It unfolds INSIDE THE BAR, to the left of the target that opens it, over the screen's name, which you
have just looked away from to tap anyway. The second version put it under the bar: it no longer
pushed anything, but it covered what you came to look at instead of what you had just left. It closes
at the first tap elsewhere. The bar keeps its 61 pixels, open or closed.

Above the breakpoint, the group is `display: contents`: its children stay exactly the children of the
bar they were, and nothing moves on a wide screen. It is the only way to add a mechanism on the phone
without paying for it elsewhere.

The project switcher appears in the bar, and only below the breakpoint. It was missing: both rails
leave the flow on a phone, so there was no path from one project to another. The menu is the same as
the rail head's, never a second list. Its trigger is the project's square and a chevron, not its
name: the screen's name is three centimetres away, and two texts in a 393-pixel bar compete for the
one thing that must be read at a glance.

## A broken screen keeps its navigation, and says which of the two cases it is

Settled on 14/09, direction A of `docs/directions/direction-erreur.html`. An installed application has
no address bar, so no reload button: a screen that crashes is a dead end, and reopening the app brings
you back to the same place. TanStack rendered its default, "Something went wrong" on a white
background.

The error screen is a SHEET, in the same language as the empty states (dashed frame, ruled lines, no
mascot) with a tear, the only touch of colour in the series. A broken screen is a case of "there is
nothing to show", and the application already had a grammar for saying that.

It renders in place of the ROUTE, not of the shell: both bars survive the failure. That is what
separates a failed page from a dead end.

Two causes, two sentences, and the difference is what matters. The STALE screen is by far the most
frequent case and is not a bug: Legion updates by rebuilding itself, the screen is split into a
hundred and eighteen files named by hash, and a page left open asks, on the next navigation, for a
file the new build no longer serves. There, you can promise that reloading is enough. Everywhere else
you cannot, and you do not say so. The distinction is read from the error message, which each engine
writes its own way; when in doubt it falls back to the crash, because announcing "it is just stale"
wrongly would send you reloading in a loop.

## A fact is fetched, a choice is asked

Settled on 15/09, connections work. Wherever Legion asked you to paste a personal access token, it
offers to connect the provider; wherever it had you fill in by hand a value an API can give, it goes
and gets it. The operator arrives, clicks, authenticates, and it is connected. What is left to ask is
what is a matter of choice.

A connection belongs to the PROJECT, not to the operator. Two projects do not have the same rights to
give their agents, and a connection set on the operator would give them all of them.

Both paths coexist, the button and the paste. It is not a comfort fallback: a Linear OAuth app belongs
to a workspace and leaves a trace visible to all its admins, and you do not always want that. What
decides is not where a token comes from but what it is allowed to do, and that is something a probe
observes.

Legion ships no client secret. The `client_id` is public and travels in the repository; a
`client_secret` in an application everyone installs at home is not a secret. That is what closes
revocation at the provider, and the screen says so.

## Two columns on secrets, and only one is encrypted

Settled on 15/09, connections work. A credential now carries two more fields: `refresh_ciphertext`,
encrypted like the token itself, and `metadata`, plain JSON.

The invariant of `metadata` fits in one sentence: everything stored there can be read without the
master key, so no secret goes in. That is what makes it queryable in SQL, fixable by a data patch, and
displayable. It holds what is known about a token without opening it: the account, the access
observed, the instance, the header format, the date of the probe.

The name is generic on purpose. `renewal` was proposed and refused: this field serves everything an
integration needs to know about a credential, not only renewal.

## A data patch does not block startup

Settled on 15/09, connections work, on the model of `rappasoft/laravel-patches`. Legion had schema
steps and nothing to transform content. Patches run at startup, after migrations, and three
departures are accepted: no `down`, because a data patch that undoes itself is an illusion; no batch
number; and above all, a failing patch does not stop startup. A failed schema must block, failed
content must not.

What depends on the NETWORK is not a patch. Probing a provider to learn who owns a token is a command
the operator runs when they want, `make adopt-tokens`: an instance starting while GitHub is
unreachable must not stop for a display enrichment.

## The PWA is the recommended bridge, Discord the second

Settled on 16/09. Answering an agent that is waiting goes through several paths, and they are not
equal in use.

The PWA is the one to recommend: nothing to install with a third party, nothing to configure, the
push notification arrives on the phone and the gesture happens in the product itself. The Discord
bridge stays, both ways, and it needs a bot plus two environment variables. That price is reasonable
for someone who already lives in Discord; it is not reasonable as the default path.

What it changes for what gets written: the front page puts the phone and its notification forward.
Discord is named among what the product can do, never in the first promise. Announcing what the
reader will not get by installing is the surest way to disappoint them on the first try.

Telegram was announced and never written.
