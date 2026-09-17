#!/bin/sh
# A project's session image: a thin layer on top of the fleet base (09/09, simplified the same day).
#
# Kopee.me is a PHP repository; its sessions need `php8.2-cli` and friends, which
# `legion-session:latest` lacks. A hand-built image on the Mac proved it, and brought down two tasks
# the day the control plane moved machines, because nothing could rebuild it elsewhere, show it, or
# say it was seven days old.
#
# The Dockerfile is pasted into `projects.session_dockerfile`, next to the tag it builds
# (`projects.session_image`), not kept in a repository. v66 read `.legion/Dockerfile` from the
# project's repository, which meant cloning it on the host (which repository in a multi-repo
# project, how to clone without a token, where to keep it fresh). v67 removed all of that: the text
# arrives as an argument.
#
# The build gets the Dockerfile on stdin with an empty context (`docker build -t <tag> -f -
# <empty-dir>`), a throwaway `mktemp -d`, never the Legion clone.
#
# Trust: this Dockerfile is not reviewed like the three fleet images, it comes from a config field.
# The compensating contract: its first instruction must be exactly `FROM <base>` (the default session
# tag, passed as argument), and every later instruction `RUN`, `ENV` or `USER`. `COPY` is refused
# since v67: with no context it could only target nothing, or the ephemeral container's working
# directory, never what the operator thinks. The validation lives here, in POSIX sh, because this is
# where it protects; the TypeScript twin (`validateProjectDockerfile` in
# `server/src/infra/images/project.ts`) only warns before the click. `project.test.ts` checks that
# both agree.
#
# `USER` accepted since 12/09 (operator's decision): the base ends with `USER agent` (uid 1001, no
# sudo), so the first `RUN apt-get update` died with "Permission denied", exit 100, and installing an
# interpreter is the whole point. The cost: a Dockerfile that does not return to `USER agent` yields
# sessions running as root, and nothing here prevents it.
#
# Payload drift is caught with the same hash as `image-session` (Makefile), combined with the pasted
# Dockerfile's hash into one label: rebuilding the base or changing the Dockerfile makes the image
# stale, and the screen (`server/src/infra/images/project.ts`) reads it the same way.
#
#   sh scripts/project-image.sh validate <Dockerfile> <base-image>
#   sh scripts/project-image.sh build <tag> <base-image> <dockerfile>
#
# POSIX sh: runs in the ephemeral `docker:28-cli` container (Alpine, busybox) like `fleet-image.sh`,
# and on a bare Mac.

LABEL="legion.project-image-hash"
PAYLOAD_LABEL="legion.payload-hash"

usage() {
  echo "usage: project-image.sh validate <Dockerfile> <base-image> | build <tag> <base-image> <dockerfile>" >&2
  exit 2
}

sha256() {
  if command -v shasum >/dev/null 2>&1; then shasum -a 256 | cut -d' ' -f1
  else sha256sum | cut -d' ' -f1
  fi
}

# The trust rule, in plain POSIX sh (awk only for `toupper`, portable on busybox and macOS). A line
# ending in `\` continues the previous instruction and is never tested as a new keyword, or a
# legitimate multi-line `RUN` would be refused on its second line.
validate_dockerfile() {
  file=$1
  base=$2
  if [ ! -f "$file" ]; then echo "dockerfile not found: $file" >&2; return 1; fi
  saw_from=0
  cont=0
  bad=""
  while IFS= read -r line || [ -n "$line" ]; do
    t=$(printf '%s' "$line" | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
    if [ "$cont" = "1" ]; then
      case "$t" in *\\) cont=1 ;; *) cont=0 ;; esac
      continue
    fi
    [ -z "$t" ] && continue
    case "$t" in \#*) continue ;; esac
    if [ "$saw_from" = "0" ]; then
      norm=$(printf '%s' "$t" | tr -s '[:space:]' ' ')
      if [ "$norm" != "FROM $base" ]; then
        bad="the first instruction must be \"FROM $base\", found: $t"
        break
      fi
      saw_from=1
      case "$t" in *\\) cont=1 ;; esac
      continue
    fi
    word=$(printf '%s' "$t" | awk '{print toupper($1)}')
    case "$word" in
      RUN|ENV|USER) : ;;
      *)
        bad="instruction refused \"$word\" (only RUN, ENV and USER are accepted after FROM: no build context, so no COPY): $t"
        break
        ;;
    esac
    case "$t" in *\\) cont=1 ;; esac
  done < "$file"
  if [ -n "$bad" ]; then echo "$bad" >&2; return 1; fi
  if [ "$saw_from" = "0" ]; then echo "dockerfile empty or without FROM $base" >&2; return 1; fi
  return 0
}

cmd_build() {
  [ $# -ge 3 ] || usage
  tag=$1
  base=$2
  content=$3

  # `checkfile` holds the text to validate and hash (`validate_dockerfile` wants a file); `emptydir`
  # is the build context, empty on purpose. Both are removed on exit, success or not.
  checkfile=$(mktemp) || { echo "$tag: cannot create a temporary file" >&2; return 1; }
  emptydir=$(mktemp -d) || { rm -f "$checkfile"; echo "$tag: cannot create a temporary directory" >&2; return 1; }
  trap 'rm -f "$checkfile"; rm -rf "$emptydir"' EXIT

  printf '%s' "$content" > "$checkfile"

  validate_dockerfile "$checkfile" "$base" || { echo "$tag: Dockerfile refused (see above)" >&2; return 1; }

  # Same pipe as the Makefile's `image-session` recipe, repeated because `make` is not guaranteed on
  # a remote runner. `currentPayloadHash()` (server/src/infra/fleet-images.ts) and this pipe must
  # stay identical. `infra.test.ts` checks the TypeScript side against its own copy of the pipe;
  # nothing tests this one.
  payload_hash=$(ls runner-payload/*.mts | LC_ALL=C sort | while read -r f; do sha256 <"$f"; done | sha256)
  dockerfile_hash=$(sha256 <"$checkfile")
  image_hash=$(printf '%s:%s' "$payload_hash" "$dockerfile_hash" | sha256)

  built=$(docker image inspect "$tag" --format "{{index .Config.Labels \"$LABEL\"}}" 2>/dev/null || true)
  if [ -n "$image_hash" ] && [ "$image_hash" = "$built" ]; then
    echo "$tag: nothing to rebuild (base and Dockerfile unchanged since $(printf '%.12s' "$image_hash"))"
    return 0
  fi
  echo "$tag: building ($(printf '%.12s' "$built") → $(printf '%.12s' "$image_hash"))"
  docker build -t "$tag" -f - \
    --label "$LABEL=$image_hash" --label "$PAYLOAD_LABEL=$payload_hash" "$emptydir" < "$checkfile"
}

case "$1" in
  validate) shift; [ $# -ge 2 ] || usage; validate_dockerfile "$1" "$2" ;;
  build) shift; cmd_build "$@" ;;
  *) usage ;;
esac
