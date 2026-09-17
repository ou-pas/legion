#!/bin/sh
# Generate the allowlist from ALLOWED_HOSTS (comma-separated) then start tinyproxy.
# Runs as `tinyproxy`, not root (05/09): allowlist.txt already exists and belongs to that user
# (Dockerfile). It is the only path written here; writing any other file fails, as it should.
: "${ALLOWED_HOSTS:?ALLOWED_HOSTS is required}"
printf '%s\n' "$ALLOWED_HOSTS" | tr ',' '\n' | sed '/^$/d' > /etc/tinyproxy/allowlist.txt
echo "[proxy] allowlist:" && cat /etc/tinyproxy/allowlist.txt
exec tinyproxy -d -c /etc/tinyproxy/tinyproxy.conf
