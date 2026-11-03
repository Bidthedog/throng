#!/usr/bin/env bash
#
# Prepares an Ubuntu runner for throng (spec 062 FR-046). Needs root for apt and for the AppArmor profile, so CI runs
# it under sudo. Electron's sandbox stays on: the profile is what lets it start, the same step a developer takes.
#
#   sudo scripts/ci-linux-setup.sh
set -euo pipefail

export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq --no-install-recommends \
  xvfb xfwm4 dbus-x11 \
  zsh fish \
  fontconfig fonts-dejavu-core \
  libnss3 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libdrm2 libgbm1 libgtk-3-0t64 libasound2t64 \
  libnotify4 libsecret-1-0 libxss1 libxtst6 \
  gvfs apparmor-utils

# zsh stops at its new-user wizard and its insecure-directories question on a fresh account. Neither is throng's.
user=${SUDO_USER:-$USER}
home=$(getent passwd "$user" | cut -d: -f6)
for file in .zshrc .zshenv; do
  [ -e "$home/$file" ] || install -o "$user" -m 0644 /dev/null "$home/$file"
done
grep -q skip_global_compinit "$home/.zshenv" || echo 'skip_global_compinit=1' >>"$home/.zshenv"

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)
"$script_dir/linux/apparmor-profile.sh" install
