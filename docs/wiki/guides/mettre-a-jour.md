# Updating Legion

Legion updates itself. The Version card, in System → General, compares the running code with the
repository's tags on GitHub, and offers a button when something newer exists.

## Two modes, and the card says which

The move works on both sides, but it does not do the same thing, so the Version card shows where you
are next to the version.

git clone: the everyday mode, on your workstation. The code runs from a folder tracked by git, the
card reads that folder directly, and the update moves the clone.

Docker container: a server install, made with [[guides/installer-sur-un-serveur|the guide]]. There is
no clone to read inside a container, so the version is stamped into the image at build time. It is
the version that RUNS, and that is intended: the host's clone may have moved on without the image
being rebuilt, and in that window the disk and the process do not say the same thing. The card
answers for the process.

The criterion is not a setting: it is the presence of `.git`. A fact, so nothing to get wrong.

## What the Version card says

The pill at the top of the card carries the state, and there are only four.

Up to date: the running code carries the latest published tag.

Ahead: the running code is later than the latest tag. That is the normal state when you develop in
this repository. The card counts the commits between you and the tag, and reminds you how to set the
next one.

A version available, named by its tag: GitHub carries a newer version than yours. The card lists the
subjects of the commits in between, because "six commits behind" helps nobody decide whether to
update now.

Unknown: the comparison could not be made. The note says which reason applies, and each has its
remedy.

The same tag appears in the top bar as soon as a version exists. It leads to System → General.

## What keeps the button from appearing

A version can exist without the move being possible right away. The note under the card says so, and
the obstacle clears on its own in the first three cases.

Sessions are running. An update restarts the control plane for one to three minutes. Session
containers survive it, but during that time they lose access to the file, task and inbox tools, and a
turn in flight can break there. The card offers Suspend the sessions and update: each session
finishes its turn, pushes its work, then starts again on its own once the update is done.

The working tree has uncommitted changes. Moving to a tag over them would overwrite them silently.

You are not on `main`. The update only starts from `main` or `master`, so that a click never leaves a
working branch.

In container mode, the image was built without its version. It knows neither which commit it runs nor
from which repository, so there is nothing to compare and nowhere to go. This happens when
`docker compose` is run by hand instead of `./deploy/up.sh`, the script that computes those values
and stamps them. Rebuilding with the script is enough.

## When the comparison fails

GitHub answers "not found" for a private repository queried without a token. It does not answer
"forbidden". That is why the card asks for a `GITHUB_TOKEN` secret with read access, on the project
that declares this repository in its repo list: that token is the one presented, and no other.

A refused token means it has expired or is too narrow. An origin that is not GitHub means there is
nothing to compare. And no answer is still no answer.

## What happens after the click, on a clone

The database is backed up first, before anything moves. Migrations have no way back, so that copy is
the only return path there is.

Then the script fetches the tags, moves to the target, reinstalls dependencies and rebuilds the session
image. It runs detached from the control plane, because the process applying the update is the one
being replaced: the server restarts halfway through.

The UI goes quiet meanwhile, and that is expected. Everything is written to a log under
`server/data/updates/`, whose path is shown when the update starts.

## What happens after the click, in a container

Same problem, so same shape. There a detached script survives the process it replaces; here a
detached container survives the container. Legion launches an ephemeral `docker:28-cli` named
`legion-update`, which fetches the tags, fast-forwards the host's clone to the target version, then
rebuilds and restarts. The control plane is destroyed in the middle of that last step, and the
ephemeral container carries on.

It fast-forwards the clone instead of checking out the tag, and the difference matters on a server:
`git checkout v0.5.0` would leave the clone on a detached HEAD, so the next update would refuse to
start. Fast-forward reaches the same version while keeping the branch. It fails if the server's clone
carries changes that would be overwritten, which is exactly the intended refusal.

The container's name is the lock. Docker refuses two containers with the same name, so two updates
cannot cross, even if the control plane restarts between the two clicks: a lock held by the daemon
survives that restart, which an in-memory lock cannot.

The log is in the same place, `server/data/updates/` on the host. If the file stays empty,
`docker logs -f legion-update` carries the message: the container refuses to start before opening the
log when the clone path is wrong.

This server runs no session itself, but the fleet does: after `./deploy/up.sh`, the ephemeral
container rebuilds ALL THREE IMAGES on EVERY enabled `ssh://` runner
(`DOCKER_HOST=<runner> make image-session`, then `image-browser`, then `image-proxy`, the same targets
as on a workstation). In that order, and after the restart, not before: the new control plane must
already be answering while each machine builds (2 to 4 minutes each). A runner that does not answer
(asleep, unreachable) logs its failure without failing the update. The runner card in System → Runners keeps saying so
for it, naming the image, until the next manual `make <target>` or the next update.

The two shared images are rebuilt ONLY if their context folder changed: they compare its fingerprint
with the `legion.context-hash` label stamped into the image the machine carries. On an unchanged
context, the log line says so and returns at once; otherwise every tag would download the several
gigabytes of the Playwright base again on every Mac. `FLEET_IMAGE_FORCE=1 make image-browser` skips
the check, when it is the image itself you want to rebuild.

What the update does NOT catch up on by itself: the script played by the ephemeral container is
written by the control plane from BEFORE the update. The update that brings a change to that script
therefore still plays the old move; it is the NEXT one that plays the new. To avoid waiting after a
browser or proxy fix, one `DOCKER_HOST=<runner> make image-browser` per machine is enough, and the
runner card says which one needs it.

A machine asleep during the update keeps its old image: the update log says so (the rebuild failed,
with no consequence for this update), and the next update will catch it up if it is awake then. Since
7 September the Log screen says it too: when the file ends, the control plane rereads it and records
one entry per update, machine by machine and image by image, as a warning as soon as one failed. A
rebuild started from the card leaves the same entry, under "infra".

In System → Runners, that machine's card carries a note saying its session image is stale, and a Rebuild here
button, which replays exactly the update's move for that machine alone, without touching the control
plane. The button returns at once; the note says a rebuild is in progress, then disappears when the
image matches the repository again, two to four minutes later. Each rebuild's log is in
`server/data/updates/`, as `rebuild-<runner>-<date>.log`.

For all this to exist, the container receives the host's Docker socket. That is a heavy permission,
written down with its reasons in [[produit/decisions]].

## Publishing a version

An update only exists if there is a tag to aim at. Set it from the repository:

```
VERSION=v0.2.0 make release
```

The target refuses a number that is not of the form `vX.Y.Z`, a tag that already exists, and a dirty
tree. It creates the tag and pushes it. Other machines see it at their next check, which runs every
thirty minutes.
