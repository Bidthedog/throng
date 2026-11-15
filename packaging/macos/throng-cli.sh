#!/bin/sh
#
# The `throng` command on macOS (spec 070 FR-024a, research R20). Shipped as Contents/Resources/bin/throng inside the
# app bundle; Install 'throng' command links /usr/local/bin/throng here.
#
#   throng [folder ...]
#
# Each argument that is not an option becomes an absolute path, because the app does not start in the caller's
# folder. The app is started detached, so the terminal is free at once and closing it does not end throng; a throng
# already running takes the folders through its single-instance handover.
set -eu

# This script's real location, following the link /usr/local/bin/throng is, and any link to that. macOS's readlink
# had no -f before 12.3, so the chain is walked by hand.
self=$0
while [ -L "$self" ]; do
  target=$(readlink "$self")
  case $target in
    /*) self=$target ;;
    *) self=$(dirname -- "$self")/$target ;;
  esac
done
bin_dir=$(cd -P -- "$(dirname -- "$self")" && pwd)
contents=$(cd -P -- "$bin_dir/../.." && pwd)
app="$contents/MacOS/throng"

if [ ! -x "$app" ]; then
  echo "throng: the app this command belongs to is gone ($contents). Install the 'throng' command again from throng." >&2
  exit 1
fi

# Rebuild the argument list with every path made absolute. `set --` on a growing list keeps each argument whole,
# spaces and all, with no array (POSIX sh has none).
count=$#
i=0
while [ "$i" -lt "$count" ]; do
  arg=$1
  shift
  case $arg in
    -*|/*) ;;
    *) arg="$PWD/$arg" ;;
  esac
  set -- "$@" "$arg"
  i=$((i + 1))
done

nohup "$app" "$@" >/dev/null 2>&1 &
