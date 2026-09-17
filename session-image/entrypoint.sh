#!/bin/sh
# The one thing the container does before becoming a session.
#
# The project's SSH key is mounted read-only on /run/legion/ssh-key with the host's uid. `ssh`
# refuses a key owned by neither root nor the current user, and one the group can read: a bind
# mount cannot satisfy either, since uids on both sides have no reason to match. The symptom would
# be "bad ownership or modes for file", deep in a log, after a model turn.
#
# So we take our own copy at 0600; the mounted file stays untouched. Without a mount (almost every
# session) this script only execs the command.
set -eu

if [ -r /run/legion/ssh-key ]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  cp /run/legion/ssh-key "$HOME/.ssh/id_legion"
  chmod 600 "$HOME/.ssh/id_legion"
fi

# The operator's `known_hosts`, when mounted next to the key. Copied for the same reason: it arrives
# with the host's uid and a 0600 file would be unreadable here. The fingerprints baked into the
# image (/etc/ssh/ssh_known_hosts) are still consulted: ssh reads both files.
if [ -r /run/legion/known-hosts ]; then
  mkdir -p "$HOME/.ssh"
  chmod 700 "$HOME/.ssh"
  cp /run/legion/known-hosts "$HOME/.ssh/known_hosts"
  chmod 644 "$HOME/.ssh/known_hosts"
fi

exec "$@"
