# Runner

A runner is a machine that executes [[concepts/session|sessions]]. It carries a maximum number of
concurrent sessions, and can be disabled without being deleted.

## Docker or process

A `docker` runner creates one container per session, on the local socket or on a remote host through
`ssh://`. That is the normal mode: isolation comes from the container, and the network is closed by
default.

A `process` runner starts the agent in a process, with no container. It is for tests and for
developing the control plane itself. It isolates nothing.

## Declaring a machine

The Declare a machine card, at the bottom of System → Runners, adds a runner to the fleet: a name, a
Docker URL, a callback address and a number of concurrent sessions. Nothing needs installing on the
added machine. Its Docker daemon only has to be reachable, typically at
`ssh://operator@192.168.1.20`.

The name matters: it is what an agent carries as its runner preference. A name already taken is
refused, and so is a malformed URL, before the machine enters the list.

The machine is probed immediately, and the answer comes back with the creation. A declared machine
whose daemon does not answer does exist, but receives no session while it stays silent, and the screen
says so right then rather than at the first task that does not move.

The callback address is the control plane's address as seen from the added machine. It only makes
sense on a remote machine: the container running there calls the control plane back to report what it
is doing, and if it called `localhost` it would call its own machine, where nobody is. Left empty, the
local server's address is used.

There is no button to delete a runner. Disabling it is enough to take it out of play, and nothing is
lost.

## Reaching the control plane from another machine

The UI opens from any machine that can reach the control plane, and asks for an operator token the
first time. The token is shown only once, at the boot that creates it; if lost, `make operator-token` on
the control plane machine sets a new one.

There is no network setting any more. Until 13 September, the API only accepted a list of addresses,
and `LEGION_LISTEN` opened it to the tailnet. That stopped holding once sessions ran on remote machines:
an agent container leaves through its host's network, so it arrives with that host's tailnet address,
and no address rule can tell it apart from the operator's browser. A session authorises now, and the
reasoning is in [[produit/decisions]] under "What authorizes the human API is a session, not a
network".

The `/internal` port has not changed: every call requires the token of the session speaking, and that
token only opens that session.

Restricting who can even reach the port is still a good idea, but it happens in the machine's firewall
or in the Tailscale ACLs. The server itself must keep its port open on every interface, otherwise
containers can no longer report on their work.

## The health probe

Every thirty seconds, Legion asks each enabled runner whether its daemon answers, and records the time
of the last answer. The runner's card shows it.

That is what makes it possible to put sessions on machines that sleep. A closed laptop stops answering,
Legion sees it and sends it nothing more: the task stops on "no reachable runner" instead of launching
into the void and staying in progress for hours. The reopened machine becomes reachable again on its
own, without touching anything.

A machine is only declared unreachable after two passes without an answer, not one. A connection hiccup
should not take a machine out of the fleet for the next thirty seconds; the price of that stability is
that a machine really switched off stays eligible for a minute at most.

The [[reference/depannage|control plane log]] only receives state changes, never the heartbeat. A log
receiving a line every thirty seconds per machine would be a log nobody reads.

## What travels to a remote machine

On the local socket, a session's files are folders on the machine: its working directory, its Claude
state, the shared package cache, the project key. On a remote machine, those paths mean nothing. Docker
interprets them over there, where they do not exist, and creates empty folders of the same name. The
session used to start with no repository, no credentials and no key, and nothing said so.

A session on a remote machine now works in Docker volumes held by that machine. They are named
`legion-workspace-<session>`, `legion-claude-<session>` and `legion-secrets-<session>`, plus a
`legion-pkg-cache` shared by every session on the machine. The mount points inside the container are
the same, so the image, the clone and the rest know nothing of the difference.

The clone happens inside the session container, not from the control plane. That is what makes it
indifferent to the machine: it never needed a path from here.

The project key is the only file that really has to cross, since it exists only on the control plane's
disk. It enters its volume through the standard input of a bootstrap container, with no network,
through the same Docker daemon as everything else. Nothing is assumed on the remote machine apart from
Docker: no shell, no tool to install. The key appears neither on a command line, nor in an environment
variable, nor in a temporary file on the remote machine, because all three can be read back later. Its
volume is removed every time a container ends, including when the session pauses for a question: the
wake-up puts one back.

Working volumes survive the pause, exactly as folders do locally. They go when the task is done or
deleted, and the orphan cleanup in System → Runners sees them, counts them and removes them along with
containers and networks.

Artifacts never had to travel: the session drops them through the internal API, the same channel as
its spec and its events, so they land on the control plane whichever machine runs the session. A test
pins it (`sessions/artifacts-location.test.ts`).

## The PATH of a non-interactive SSH, on macOS

A macOS machine perfectly reachable over SSH can refuse every session with `command not found`. The
cause is not Docker but the PATH: a non-interactive SSH does not read `~/.zshrc`, and `/usr/local/bin`,
where Docker Desktop puts its command, is not always in it. The remote Docker client calls
`docker system dial-stdio` on the machine, does not find it, and the probe declares the machine
unreachable.

It depends on the machine, which makes the symptom confusing: the SSH of some macOS versions already
provides `/usr/local/bin` by default, and the same command then works with no configuration.

The fix is one line in `~/.zshenv` on the remote machine, the only file a non-interactive shell reads:

```sh
export PATH="/usr/local/bin:$PATH"
```

## A sleeping machine must not fill the process table

Probing a sleeping machine costs a process for the duration of the budget, and that process has a
child: the docker command aimed at an `ssh://` host carries a real ssh client under it. The first
version killed the command at the budget and left the child orphaned. Over a whole night with two
sleeping machines, orphans reached nine thousand processes in the control plane container, the table
filled up, and not a single docker command could start any more, including the one that would have
fixed it.

Two defences since: the timeout kills the whole process group, not just the command, and the control
plane container runs with a real PID 1 (`init: true` in the compose file) that reaps whatever still
escapes. The symptom, should it come back: `pthread_create failed: Resource temporarily unavailable` on
everything touching docker, while the machine itself is fine.

The check is one command, from the control plane:

```sh
ssh operator@the-machine docker system dial-stdio < /dev/null
```

A protocol error is a good sign: the command was found. A `command not found` is the symptom described
here.

## The pipe is not the session

While a session runs on a remote machine, Legion keeps a connection open to it to learn when the
container exits. That connection breaks for reasons unrelated to the session: a machine going to sleep,
a network hiccup, a laptop switching wifi. The container does not die. It sleeps with its machine and
resumes on wake.

So Legion tells the two apart, and does not conclude on a disconnection. When the connection drops, it
waits, asks the machine again whether its daemon answers, and reattaches to the same container as soon
as it comes back. A session no longer dies from a twenty-minute sleep, and the work running meanwhile
is still there. It is the same rule as at server start: ask Docker before declaring a session dead.

That patience is bounded. The window given to a machine that stopped answering is half an hour per
disconnection, and the number of reattachments is limited: a machine switched off for the night does
not hold its runner slot until morning, and a connection that breaks on every attempt is a broken
network, not a sleeping machine. When patience runs out, the session fails saying "host unreachable"
rather than blaming the agent for exiting with an error. The container may well still be up on the
remote machine.

## A Mac does not sleep while it works

A session can run for two hours without anyone touching the keyboard of the machine hosting it. On a
Mac, that is exactly the definition of idleness, and macOS suspends everything after its delay. Nothing
flags it: the container does not crash, it freezes, until someone wakes the machine.

So while at least one session runs on an `ssh://` machine, Legion holds a `caffeinate -i` there, the
macOS tool that asks not to sleep from idleness. It drops with the last session, and sessions on the
same machine share it.

This is one of the only places in Legion that assumes a shell on the remote machine, and it is optional
by construction. On a machine that is not a Mac, or lacks the command, a warning says so once and
sessions start anyway. A session refusing to start because a comfort command is missing would be a bad
trade.

Closing a laptop lid puts the machine to sleep no matter what: `caffeinate -i` only covers idleness. The
reattachment described just above handles that case.

## Fleet consumption, and the third measurement added in a hurry

The reachability probe (30 s) says whether a runner answers; it says nothing of what it has under the
hood. On 02/09, a session failed on "No space left on device" because the mini's Docker VM was full and
nothing showed it before the failure. Hence three measurements, added to the same probe pass, never
confused with one another.

The Docker VM: what the `legion-*` containers consume (`docker stats`), against what the daemon has
(`docker info`). That is the capacity that matters for launching one more session.

The machine itself: load and memory of the Mac hosting that VM, read with `uptime` and `vm_stat` over
ssh. It is the SECOND place in the repository that assumes a remote shell (the first is `caffeinate
-i`, previous section), with the same tolerance: a host that is not a Mac, an ssh that refuses, a blown
budget are reported, they never make a runner "unreachable".

The VM's disk, not the host machine's. A `df /` in the disk sentinel (a DEDICATED, long-lived
container, never a fresh one) says what the disk really has.

The first version of this measurement (02/09) ran `docker run --rm --entrypoint df <image>`, a fresh
container on every probe. On 04/09 the same failure happened again (task `javxU8Wwjx`, disk at 0 bytes
free, down to a broken `git status`) and the probe showed NOTHING beforehand: creating a container
writes a new layer, and that is precisely what fails on a full disk, exactly when the measurement
becomes urgent. A first fix probed with `docker exec` inside an ALREADY RUNNING `legion-*` container,
but only when a session was running: an IDLE runner (zero sessions, and the fleet shares its disk with
development databases that are not ours) had nothing to join, and its very first session was never
protected from an already full disk. `infra/metrics/index.ts` now relies on a DISK SENTINEL
(`infra/disk-sentinel.ts`): one DEDICATED, long-lived container per runner, modelled on the shared
browser service, recreated only if missing or stopped, never in order to measure. `docker exec` always
joins a process that already exists there, even on a disk with 0 bytes free. If creation itself fails
(sentinel missing AND disk already full on the very first pass), the absence is reported with its
reason, never an invented number.

Launching a session is now refused below 4,096 MB free (`DISK_FREE_MB_MIN`,
`infra/metrics/index.ts`), the same move as the repository wall or the daemon probe in
`sessions/runner/manager.ts`: `runTask` refuses BEFORE creating any container, naming the remaining
margin. The threshold is sized to leave room for a repair move after the refusal (rebuilding the
browser image, the heaviest at 3.9 GB), not for the weight of an ordinary session (a few tens of MB,
shared pnpm cache included). A missing or stale measurement refuses nothing: only a KNOWN measurement
CERTAINLY below the threshold blocks, in the spirit of `sessions/preflight.ts`.

A sleeping machine is probed for NONE of the three: `infra/metrics/store.ts` rereads the same
reachability predicate as routing (`runnerReachable`) before issuing any command, the direct defence
against the nine thousand orphan processes described above. Values live in RAM (last known, with its
age); only the VM and the machine keep a history (`runner_metrics`, 48 h) for the sparkline on the
Runners screen. The disk has a threshold only, no trend to draw.

## The network

A session's network is internal, with an egress proxy holding a domain allowlist. An agent that needs
to reach a specific service needs that domain allowed. This restriction is why a session cannot install
a package from a registry that is not allowed.

The wall is optional. An agent without an [[guides/capacites|environment]] runs on an open network; the
environment is what closes it, and it is a choice made on the agent.

Git over SSH crosses the wall when it is up, without widening it: the proxy lets port 22 through to
hosts already allowed, and nothing else. A closed environment is therefore not a dead end for `git@`
repositories.

## The session image

Sessions run on a locally built image. It ships the runner payload, the scripts that drive the SDK
inside the container. When those scripts change, the image has to be rebuilt, otherwise sessions keep
running the old version with nothing to flag it.

Those scripts are written in TypeScript and compiled at build time, by the `make image-session` recipe.
The container receives JavaScript; what the TypeScript brings is that the session contract, the object
the control plane sends and the payload reads, is typed on both sides. A field renamed on one side
fails at compile time instead of breaking the first session.

The image holds no secret. It carries the public fingerprints of github.com and gitlab.com, used to
recognise those servers; a project's private key is mounted at launch and dies with the container.

A [[concepts/projet|project]] can name another image for its own sessions. That lets a PHP or Python
repository run without imposing its tools on every other project. The named image must exist on the
host: Legion does not fetch it from afar, because a hand-typed name that goes off to query a remote
registry makes you wait until the timeout instead of failing at once.

A project can also paste a Dockerfile into its own configuration, next to the tag it declares. It is a
thin layer over the base image: the first line must be exactly `FROM` followed by that image, and the
following lines accept only `RUN` and `ENV`. There is no build context behind this Dockerfile, so no
`COPY` either. The Build here button, on the project screen, starts the build on a chosen runner; it
runs in the same ephemeral container as the other image rebuilds, without cloning anything. The hash
stamped into the image combines the payload's and the Dockerfile text's: rebuilding the base or changing
the Dockerfile both make the project's image stale.

Legion computes a hash of the payload and stamps it into the image at build time. System → Runners
compares that hash with the one on disk and, when the image is stale, says so on the card of the machine
concerned, with a button that rebuilds it there and nowhere else. A missing image carries the same
button, for the same reason: what fixes both is the same build, and absence is the case where nothing
starts any more. Two implementations of the same computation exist, one in shell in the Makefile and one
in TypeScript, and a test compares their results: without it, the two could drift silently, and a stale
image would be declared up to date.

## The shared browser

A runner can host a browser service, shared between the sessions of the same runner, granted agent by
agent. An agent without the grant does not receive the service address. If the service does not start,
the session goes without a browser rather than not going: it is a verification tool, not a dependency.

## Full capacity

When every runner is full, a task launched by hand or by the scheduler joins the queue instead of
failing. It starts as soon as a slot frees up. Full capacity is not an outage, so launching does not
require a live daemon at that moment.

No room and nobody answering are two different things, and the message says which. A full queue is
solved by waiting or raising a ceiling; "no reachable runner" is solved by waking a machine. A task
hitting the second case does not join the queue: it raises the error, because waiting for a switched-off
machine is not waiting your turn.

## Choosing a task's machine

By default no machine is chosen and Legion arbitrates: it sets aside machines that sleep, that are full,
that lack disk, and takes the least loaded of what remains. That has always been the behaviour, and it
stays the default.

A task can name its machine. The control is on the task page, next to Run the task again, which is
where you are when the question comes up: a session just fell because the machine no longer had its
image, and other machines in the fleet do.

The choice is hard. Legion routes only there, and does not fall back elsewhere if the machine stops
answering: the task is refused, naming the machine, because a silent fallback would cancel exactly the
move you just made. A chosen but full machine is still a capacity matter: the task joins the queue and
starts when a slot frees up, like any other.

The choice stays set until changed. Clearing it hands control back to Legion. A chosen machine that no
longer answers shows as such in the list, next to its name, and the reason is written under the control
rather than hidden behind a greyed-out button.

It applies to the next sessions, never to the running one: a session keeps the machine where it
reserved its slot, as a container's memory limits remain those it was created with. Changing the
machine while a session works is refused, and the refusal says so.

It is a looser setting than the others: title, agent or complexity freeze once the task has started,
whereas the machine can change between two sessions, including on a task a failure left in progress.
It is the brief's rule, for the same reason: amending then running again is normal use.

## What a session receives

Three settings, on the runner's card in System → Runners: how many sessions can run at once, how much
memory each receives, and how much CPU.

They live on the runner and not on the project, because that is where machines differ. A desktop
machine and a dedicated server do not have the same room to give, and one project can run on both.

Memory is not a comfort detail. An agent working on the interface has to start Storybook and drive a
browser to check its components, as the repository's conventions require. Storybook alone takes between
500 and 800 MB. Within the gigabyte granted by default until 26 August, that check was impossible: the
kernel killed the session, and the failure surfaced as an ordinary error code.

Lowering a ceiling while sessions run kills nothing. Running sessions finish, and the queue simply stops
launching new ones. Changing memory or CPU does not touch running sessions either: a container's limits
are set when it is created, and the new setting applies to the next ones.

## What Docker really has

Beneath the runner's ceilings sits another: the daemon's. On Docker Desktop, the virtual machine has its
own memory allocation, and it has the last word. Three 4 GB sessions in an 8 GB virtual machine do not
make 12 GB available, they bring it down.

So the runner card compares what your ceilings reserve in the worst case with what Docker declares
having, and says so when it does not fit. When Docker does not answer on that point, the screen says so
too, rather than letting you believe the check happened.

## Read next

[[reference/depannage]] for Docker failures, [[concepts/session]] for what runs inside.
