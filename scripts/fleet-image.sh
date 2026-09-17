#!/bin/sh
# The fleet's shared images (browser, proxy), and the criterion deciding whether to rebuild them
# (03/09, task "the update rebuilds only one image out of three").
#
# `make image-session` ran on every update, `image-browser` and `image-proxy` never: a fix merged in
# `browser-image/` deployed nowhere. On 03/09 the browser service still ran Playwright 1.49 against a
# repository on 1.62; `chromium.connect()` refuses the handshake across versions, and the agent hit
# by it lost thirty-three minutes on a symptom far from its cause.
#
# Rebuilding all three every time would be a bad trade: `browser-image` starts from
# `mcr.microsoft.com/playwright:vX.Y.Z-noble`, several gigabytes, and these images almost never
# change while updates run on every tag.
#
# The criterion is the build context's hash, stamped as a label at build time: rebuild when the
# context on disk no longer hashes to what the deployed image carries. Same pattern as the session
# image's `legion.payload-hash` (`Makefile`, `server/src/infra/fleet-images.ts`), except the hash
# also decides here. The context rather than "paths touched by the update": a `git diff` between tags
# says nothing about the image actually on a runner (a machine added last week, a
# `docker system prune`, a hand-built image). The label describes what runs there.
#
# The hash covers every file of the context, content and relative path, ignoring `.dockerignore`:
# errors always go the safe way, one rebuild too many, never one too few.
#
# POSIX sh, no bashism or GNU-ism: it also runs in the ephemeral update container (`docker:28-cli`,
# Alpine with busybox, no bash), via `make SHELL=/bin/sh image-browser`.
#
#   sh scripts/fleet-image.sh hash <context-dir>
#   sh scripts/fleet-image.sh build <tag> <context-dir> [docker build args…]
#   sh scripts/fleet-image.sh playwright-version <Dockerfile>
#
# FLEET_IMAGE_FORCE=1 rebuilds without looking at the label (upstream base retagged, corrupt layer).
set -e

# Read back identically by `server/src/infra/fleet-images.ts` to tell the Infra screen a deployed
# image drifted.
LABEL="legion.context-hash"

usage() {
  echo "usage: fleet-image.sh hash <dir> | build <tag> <dir> [docker build args…] | playwright-version <Dockerfile>" >&2
  exit 2
}

# `shasum -a 256` on macOS, `sha256sum` on Alpine and Linux, like the Makefile's `image-session`.
sha256() {
  if command -v shasum >/dev/null 2>&1; then
    shasum -a 256 | cut -d' ' -f1
  else
    sha256sum | cut -d' ' -f1
  fi
}

# sha256 of the "<file sha256>  <relative path>" list, one file per line, sorted bytewise (LC_ALL=C,
# so two machines with different locales agree). The path is included: a renamed file changes the
# image, so it must change the hash.
context_hash() {
  dir=$1
  if [ ! -d "$dir" ]; then
    echo "⛔ context not found: $dir" >&2
    exit 1
  fi
  (
    cd "$dir" || exit 1
    find . -type f | LC_ALL=C sort | while IFS= read -r f; do
      printf '%s  %s\n' "$(sha256 <"$f")" "${f#./}"
    done
  ) | sha256
}

# What the targeted daemon (DOCKER_HOST, the runner) stamped on its image. Empty when the image is
# missing or predates the label: both rebuild, which is right.
built_hash() {
  docker image inspect "$1" --format "{{index .Config.Labels \"$LABEL\"}}" 2>/dev/null || true
}

cmd_build() {
  [ $# -ge 2 ] || usage
  tag=$1
  dir=$2
  shift 2
  hash=$(context_hash "$dir")
  built=$(built_hash "$tag")
  if [ -z "$FLEET_IMAGE_FORCE" ] && [ -n "$hash" ] && [ "$hash" = "$built" ]; then
    echo "$tag: context $dir unchanged ($(printf '%.12s' "$hash")), nothing to rebuild."
    return 0
  fi
  if [ -n "$FLEET_IMAGE_FORCE" ]; then
    echo "$tag: FORCED rebuild (FLEET_IMAGE_FORCE), hash not checked."
  elif [ -n "$built" ] && [ "$built" != "<no value>" ]; then
    echo "$tag: context $dir changed ($(printf '%.12s' "$built") → $(printf '%.12s' "$hash")), rebuilding."
  else
    echo "$tag: no hash stamped on this daemon, building."
  fi
  docker build -t "$tag" --label "$LABEL=$hash" "$@" "$dir"
}

# The Playwright version a Dockerfile pins on its `FROM` line, stamped as a second label on the
# browser image: the hash says there is drift, this says which ("the service runs 1.49.1, the
# repository is on 1.62.1", the sentence missing on 03/09). Read back identically by
# `repoPlaywrightVersion()` in `server/src/infra/fleet-images.ts`.
cmd_playwright_version() {
  [ $# -ge 1 ] || usage
  sed -n 's|^FROM .*playwright:v\([0-9][0-9.]*\)-.*|\1|p' "$1" | head -1
}

case "$1" in
  hash) shift; [ $# -ge 1 ] || usage; context_hash "$1" ;;
  build) shift; cmd_build "$@" ;;
  playwright-version) shift; cmd_playwright_version "$@" ;;
  *) usage ;;
esac
