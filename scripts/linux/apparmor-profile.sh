#!/usr/bin/env bash
#
# Lets THIS checkout's Electron, and its worktrees' Electrons, use the browser sandbox on a machine that restricts
# unprivileged user namespaces, as Ubuntu 23.10 and later do by default (spec 062 FR-002).
#
# What it does: writes one AppArmor profile, attached only to those Electron binaries, granting them `userns`. The
# profile is otherwise unconfined, so it limits nothing: throng can open any folder you can.
# What it does not do: change any system-wide setting, or touch any other program.
#
#   sudo scripts/linux/apparmor-profile.sh install
#   scripts/linux/apparmor-profile.sh status
#   sudo scripts/linux/apparmor-profile.sh remove
#
# A separate clone elsewhere is a separate checkout, and repeats the step.
# --root, --etc and --no-load exist for its test, which writes to a temporary folder without root.
set -euo pipefail

usage() {
  sed -n '10,12p' "$0" | sed 's/^# *//' >&2
  exit 2
}

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
root=$(cd -- "$script_dir/../.." && pwd -P)
etc=/etc/apparmor.d
load=1

action=${1:-}
[ $# -gt 0 ] && shift
while [ $# -gt 0 ]; do
  case "$1" in
    --root) root=$(cd -- "$2" && pwd -P); shift 2 ;;
    --etc) etc=$2; shift 2 ;;
    --no-load) load=0; shift ;;
    *) usage ;;
  esac
done

# Worktrees of a worktree's checkout belong to the main checkout, so a profile is keyed by the main checkout's path.
case "$root" in
  */.claude/worktrees/*) root=${root%%/.claude/worktrees/*} ;;
esac

hash=$(printf '%s' "$root" | sha256sum | cut -c1-12)
name="throng-dev-$hash"
file="$etc/$name"

case "$root" in
  *[\"\\]*)
    echo "This checkout's path contains a quote or a backslash, which an AppArmor profile cannot name: $root" >&2
    exit 1
    ;;
esac

case "$action" in
  install)
    if [ "$load" -eq 1 ] && ! command -v apparmor_parser >/dev/null 2>&1; then
      echo "apparmor_parser is not installed, so this machine has no AppArmor restriction for this step to lift." >&2
      exit 1
    fi
    cat >"$file.tmp" <<PROFILE
# Written by scripts/linux/apparmor-profile.sh for the throng checkout at:
# throng-checkout: $root
# It lets that checkout's Electron use its browser sandbox. Remove it with: sudo $root/scripts/linux/apparmor-profile.sh remove
abi <abi/4.0>,
include <tunables/global>

profile $name "$root{,/.claude/worktrees/*}/node_modules/electron/dist/electron" flags=(unconfined) {
  userns,
}
PROFILE
    mv "$file.tmp" "$file"
    if [ "$load" -eq 1 ]; then apparmor_parser -r "$file"; fi
    echo "Installed $file for $root"
    ;;
  remove)
    if [ ! -e "$file" ]; then
      echo "No profile is installed for $root"
      exit 0
    fi
    if [ "$load" -eq 1 ]; then apparmor_parser -R "$file"; fi
    rm -f "$file"
    echo "Removed $file"
    ;;
  status)
    if [ -e "$file" ]; then
      echo "Installed: $file covers $root and its worktrees"
    else
      echo "Not installed for $root"
      exit 1
    fi
    ;;
  *)
    usage
    ;;
esac
