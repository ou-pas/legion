#!/bin/sh
# Build and start the control plane: the only install command, and the one the update container
# calls (01/09, slice 08 of the multi-host work).
#
# A script rather than a line in the guide: the image must carry the version it runs, otherwise the
# Version card has nothing to compare and the update button can never appear (measured on the
# server on 01/09). The values come from git, and `compose.yaml` cannot run a command. Neither the
# operator retyping a long line nor a copy inside the update container would stay in sync.
#
# One place, two callers: the human on the host, and the ephemeral container
# (`server/src/updates/docker-update.ts`), which mounts the clone at the same absolute path. The
# script is therefore identical in both cases, with no "am I in a container" branch.
set -eu

cd "$(dirname "$0")/.."

# Each value may be missing without failing: a never-tagged repository has no `describe`. The sha
# always exists in a clone, which is why the server checks it to know whether the image carries its
# version (`stamp.ts`).
GIT_DESCRIBE="$(git describe --tags --long 2>/dev/null || echo '')"
GIT_SHA="$(git rev-parse --short HEAD 2>/dev/null || echo '')"
GIT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '')"
GIT_ORIGIN="$(git config --get remote.origin.url 2>/dev/null || echo '')"
export GIT_DESCRIBE GIT_SHA GIT_BRANCH GIT_ORIGIN

# What the container cannot guess from inside. The clone's host path lets the update container
# mount it at the same path, so `compose.yaml`'s relative mounts still resolve on the host. The
# operator's HOME locates `~/.ssh`: the repository is private and `git fetch` needs a key.
LEGION_HOST_REPO="$(pwd)"
LEGION_HOST_HOME="${LEGION_HOST_HOME:-$HOME}"
export LEGION_HOST_REPO LEGION_HOST_HOME

# The host's time zone. Without it the container lives in UTC and every time the server writes (an
# inbox entry's "resuming at 13:07", a notification) is two hours off for the operator (seen 02/09:
# header 15:07, body 13:07). `/etc/timezone` on Debian/Ubuntu, the `/etc/localtime` link elsewhere;
# empty means UTC.
if [ -z "${TZ:-}" ]; then
  TZ="$(cat /etc/timezone 2>/dev/null || readlink /etc/localtime 2>/dev/null | sed 's|.*/zoneinfo/||' || echo '')"
fi
export TZ

echo "Legion ${GIT_DESCRIBE:-untagged} · ${GIT_SHA:-unknown sha} · ${GIT_BRANCH:-unknown branch}"
echo "clone: $LEGION_HOST_REPO · home: $LEGION_HOST_HOME"

exec docker compose -f deploy/compose.yaml up -d --build "$@"
