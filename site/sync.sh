#!/bin/sh
# Copies what site/ shows from docs/: a copy goes stale the day its source moves, so re-run this
# after regenerating a diagram or retaking the screenshots.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
site="$root/site"

mkdir -p "$site/diagrams" "$site/assets/screens"

for name in architecture session-lifecycle task-workflow phone-path; do
  cp "$root/docs/diagrams/$name.html" "$site/diagrams/$name.html"
done

# The screenshots do not exist until they are taken: nothing to copy is not an error.
for shot in "$root"/docs/assets/screens/*.png; do
  [ -f "$shot" ] || continue
  cp "$shot" "$site/assets/screens/"
done
