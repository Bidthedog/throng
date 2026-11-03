#!/usr/bin/env bash
#
# Runs a command on a real X display with a real window manager (spec 062 research R6): focus, stacking and the title
# bar's controls mean nothing without one, so bare Xvfb would answer questions the desktop answers differently.
#
#   scripts/ci-linux-display.sh npm run test:e2e:raw -- --grep '@core|@linux'
set -euo pipefail

display=:99
Xvfb "$display" -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
xvfb_pid=$!
trap 'kill "$xvfb_pid" 2>/dev/null || true' EXIT

export DISPLAY=$display
for _ in $(seq 1 50); do
  if xfwm4 --version >/dev/null 2>&1 && [ -S "/tmp/.X11-unix/X${display#:}" ]; then break; fi
  sleep 0.1
done

# Theme and compositor off: nothing here is measuring them, and a compositor adds a frame of latency to every paint.
dbus-run-session -- bash -c 'xfwm4 --compositor=off --sm-client-disable >/dev/null 2>&1 & exec "$@"' _ "$@"
