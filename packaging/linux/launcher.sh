#!/bin/sh
#
# What `throng` is on Linux, in every package (063 FR-006, FR-008). Electron's binary sits beside it as `throng-bin`.
#
# A sandbox failure kills Electron before any of throng's JavaScript runs, so throng cannot report it itself, and a
# start from the desktop would show nothing at all. This runs first, says what is wrong and how to fix it, and never
# turns the sandbox off.

self=$(readlink -f -- "$0")
root=$(dirname -- "$self")
helper="$root/chrome-sandbox"

# The desktop entry electron-builder writes starts the copy in the package's own tree. A running copy never runs from
# there (063 research D2), so this hands over to the installed version.
case "$root" in
  /opt/throng) exec /opt/throng-versions/current/throng "$@" ;;
esac

namespaces_work() {
  # The .deb and .rpm set this up themselves (063 FR-007). Their AppArmor profile applies to throng-bin alone, so a
  # test run from this script would be refused where throng-bin is allowed.
  case "$root" in
    /opt/throng-versions/*) return 0 ;;
  esac
  # Without the tool there is nothing to go on, so Electron decides, and reports on stderr.
  command -v unshare >/dev/null 2>&1 || return 0
  # --map-root-user is what the restriction refuses: a bare `unshare --user` succeeds under it.
  unshare --user --map-root-user true >/dev/null 2>&1
}

helper_is_set_up() {
  [ -u "$helper" ] && [ "$(stat -c %u -- "$helper" 2>/dev/null)" = 0 ]
}

show_problem() {
  printf '%s\n' "$1" >&2
  [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || return 0
  if command -v zenity >/dev/null 2>&1; then
    zenity --error --no-markup --title=throng --text="$1" >/dev/null 2>&1
  elif command -v kdialog >/dev/null 2>&1; then
    kdialog --title throng --error "$1" >/dev/null 2>&1
  elif command -v xmessage >/dev/null 2>&1; then
    xmessage -center "$1" >/dev/null 2>&1
  elif command -v notify-send >/dev/null 2>&1; then
    notify-send throng "$1" >/dev/null 2>&1
  fi
}

if namespaces_work; then
  :
elif case "$root" in *' '*) true ;; *) false ;; esac; then
  # Chromium splits the helper's path at spaces, and dies with no message of its own (measured on Ubuntu 24.04).
  show_problem "throng cannot start its browser sandbox from this folder, and does not run without one.

This system restricts the user namespaces the sandbox needs, so throng has to use its sandbox helper, and the helper cannot run from a path with a space in it:

  $root

Move the folder to a path with no spaces, and start throng again."
  exit 1
elif ! helper_is_set_up; then
  quoted=$(printf '%s' "$helper" | sed "s/'/'\\\\''/g")
  show_problem "throng cannot start its browser sandbox on this machine, and does not run without one.

This system restricts the user namespaces the sandbox needs. To allow it for this folder only, run:

  sudo chown root:root '$quoted'
  sudo chmod 4755 '$quoted'

Then start throng again. The .deb and .rpm packages set this up themselves."
  exit 1
fi

# Chromium picks its display backend before main's JavaScript runs, so XWayland is asked for here (062 FR-028).
case "${XDG_CONFIG_HOME:-}" in
  /*) config_home=$XDG_CONFIG_HOME ;;
  *) config_home=$HOME/.config ;;
esac
settings="${THRONG_CONFIG_ROOT:-$config_home/throng}/settings.json"
if ! { [ -r "$settings" ] && tr -d ' \t\r\n' <"$settings" | grep -q '"nativeWayland":true'; }; then
  set -- --ozone-platform=x11 "$@"
fi

exec "$root/throng-bin" "$@"
