# Installing on a server

Legion normally runs on the operator's machine. This guide describes the other arrangement: the
control plane on an always-on machine, and the sessions on the powerful machines, declared as
[[concepts/runner|runners]]. It is the multi-machine topology, and it inverts the initial intuition:
the control plane is the light half.

Everything fits in one container, which serves the API and the UI in plain HTTP on the same port.
There is no systemd unit to write: `restart: unless-stopped` is enough to bring the server back after a
reboot. The tailnet encrypts traffic between machines. HTTPS is still needed as soon as you want the
PWA or push notifications, and it is added by a front end in front of the container, never by Node:
see [[guides/tls]].

## What you need first

A Linux server with Docker 28 or newer, `docker compose`, and git. Legion asks for nothing else: node
is in the image.

Tailscale installed on the server and on the machines that will run sessions, under the same account.
That is what gives the server an address reachable from your workstation without opening a port to
the internet.

An SSH key on the server, without a passphrase, at `~/.ssh/id_ed25519`, with its public half
authorised on each session machine. Nothing can type a passphrase inside a container.

On each session machine: Docker running, and SSH access enabled (on macOS, Sharing then Remote Login).
Nothing else to install there, that is the whole point of the chosen pattern.

## Clone and configure

```
git clone <repository-url> ~/legion
cd ~/legion
cp server/.env.example server/.env
```

Three values matter in `server/.env`, the rest can stay empty:

`LEGION_MASTER_KEY`, generated with `openssl rand -hex 32`. It decrypts the secrets stored in the
database. If you are migrating from another machine, reuse that machine's key: a new key makes
already-encrypted secrets unreadable.

The Claude credential, `CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`. Without it sessions run in
mock mode.

`LEGION_CALLBACK_URL`, which must be the server's tailnet address, for example
`http://workshop-server:8790`. The example value (`host.docker.internal`) only works for a local
Docker Desktop: from a container running on another machine, it points at nothing. It is a fallback,
each runner can carry its own.

The data folder must exist before the first start, otherwise Docker creates it as root:

```
mkdir -p server/data
```

## Build and start

```
cd ~/legion && ./deploy/up.sh
```

Call this script rather than `docker compose` directly. It computes four things the compose file
cannot compute itself: the sha, the tag, the branch and the clone's origin, which are stamped into the
image. That is what lets the Version card say what is running and lets the update button exist. It
also sets the clone path and the operator's HOME, which the update container needs. An image built
without it still starts, and the server then honestly says it does not know what it is running.

The build compiles `better-sqlite3` and builds the UI, which takes a few minutes the first time. After
that the container restarts on its own, including after a server reboot.

Read the log:

```
docker compose -f deploy/compose.yaml logs -f
```

Three things to look for. The operator token, printed once, on the first boot that creates it: copy
it now, it will never be shown again (only its hash is stored). If you lose it, set a new one from inside the container, since node is not
on the host: `docker compose -f deploy/compose.yaml exec control-plane node scripts/operator-token.mjs`.
On a development clone, `make operator-token` does the same.
The control plane's start line, which says the API is protected by an operator session. And the line
saying the built UI is served on the same port: if it says the opposite, the UI build failed and the
container only serves JSON.

Then open `http://<server-tailnet-name>:8790` from your workstation and log in with the token. It is
the same address for the UI and the API, there is only one origin.

## Declaring the session machines

The server is the light half of the topology, and the powerful machines do the work. Its own runner,
the local daemon's, has been able to run sessions since 05/09: the files of a session launched there
are Docker volumes, as on a remote machine, because the control plane's paths do not exist as such on
the host when it runs in a container. Before that date the session started on an empty workspace,
without anything saying so.

Leaving it off is still the recommended setting, and that is a decision, not a default: a session
running on the server's daemon shares the control plane's disk and can fill it. The disk guardrail
limits that risk without removing it, and this runner's current ceiling, three 3 GB sessions on 11 GB
shared with the control plane, needs revisiting before it is turned on.

Add each powerful machine from System → Runners, or in one request (the API requires the operator
token):

```
curl -X POST http://<server-tailnet-name>:8790/api/runners \
  -H "authorization: Bearer $LEGION_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"name":"macbook","dockerHost":"ssh://operator@macbook","callbackUrl":"http://workshop-server:8790"}'
```

`dockerHost` is the machine's SSH URL, as seen from the server. `callbackUrl` is the address at which
that machine's containers call the control plane back: it is resolved over there, so `localhost` and
`host.docker.internal` are silent mistakes. It is the server's tailnet address.

The response carries the verdict of an immediate probe. A `reachable: false` names the cause, and the
most frequent one is the SSH server's fingerprint missing from the `known_hosts` mounted into the
container. Fill it on the host, once:

```
ssh-keyscan macbook >> ~/.ssh/known_hosts
```

## Updating

The Update button on the Version card (System → General) works here, as on a development workstation.
It does what you would do by hand, inside an ephemeral container named `legion-update`: fetch the tags, fast-forward the host's
clone to the target version, then rebuild and restart. That container is launched detached because it
destroys the one that launched it, and it survives that destruction.

The UI goes quiet during the rebuild, which takes several minutes. The log is written to
`server/data/updates/` on the host, and its path is shown when the update starts. If that file stays
empty, `docker logs -f legion-update` says why.

The same move by hand, if you prefer to watch it:

```
cd ~/legion && git fetch --tags --prune && git merge --ff-only v0.5.0
./deploy/up.sh
```

Fast-forward rather than `git checkout v0.5.0`: checking out a tag leaves the clone on a detached HEAD,
and the next update would refuse to start from there. It fails, cleanly, if the server's clone carries
changes that would be overwritten.

Data does not move, it lives in `server/data` on the host. `docker image prune` reclaims the space of
previous images when it starts running short.

Two things can stop the button from being offered on a server. Running sessions, on any machine: the
card then offers to suspend them first (see [[guides/mettre-a-jour]]). And an image built without
`./deploy/up.sh`, which does not know what version it runs: the card says so and gives the remedy,
rebuilding with the script.

## Moving from another machine

The move is not scripted, because it happens once and is better done while watching. Stop Legion on
both sides, then copy the state:

```
scp -r server/data/* workshop-server:legion/server/data/
scp server/legion.db  workshop-server:legion/server/data/legion.db
```

After replacing `legion.db` on the server, delete the old database's journal files:
`rm server/data/legion.db-wal server/data/legion.db-shm`. If they stay, SQLite replays the old
database's journal over the new one, which wipes the data without breaking the main file: you see an
empty database while the file is intact. Stopping the container before copying (see above) keeps
SQLite from recreating them during the transfer.

The database changes place along the way: it lives next to the code on a development clone, and in
the data folder on the server, because that folder is what is mounted into the container. Also carry
`LEGION_MASTER_KEY` over unchanged, otherwise the stored secrets no longer decrypt.

Declared [[concepts/runner|runners]] travel with the database. Check their `callbackUrl` after the
migration: it probably named the old machine.

The operator token travels too, since only its hash is stored in the database: the token you used on
the old machine still opens the new one.

## What the container can and cannot do

It carries the SSH client and the Docker CLI, which is enough to drive the daemons of the declared
machines. It does not carry git: the version it shows is the one stamped into the image at build
time, and that is deliberate. A mounted clone would describe the host's disk, which may have moved on
without the image being rebuilt; the question the Version card answers is "what is running", not
"what is on disk".

It receives four things from the host, and nothing else: the data folder (database included), the SSH
key read-only, the `known_hosts`, and the Docker socket. The rest of its filesystem is disposable.

The socket is the only addition worth pausing on. It gives the container control of the host's
daemon, which amounts to root on that machine. It is there for one thing, launching the container that
updates Legion, and the decision is written down with its reasons and its limit in
[[produit/decisions]]. Sessions still do not run here.

Authentication: since 13/09, `/api/*` goes through a same-origin check, then requires an operator
session (a cookie opened with the token printed at first boot, or `Authorization: Bearer` with that
token). Being on the tailnet is no longer enough to drive the API. Who can reach the port at all is no
longer Node's job either: the socket listens on every interface so that containers can call
`/internal` back, and limiting it belongs to the machine's firewall and the Tailscale ACLs. See
[[produit/decisions]].

This page was written before the first real installation. If a command diverges from what your server
does, fix it here in the same move.
