#!/bin/sh
# The .deb's preinst and the .rpm's pre (063 FR-011, research D5). `dpkg -i` and `dnf install` would otherwise install an
# older package over a newer one. dpkg passes `upgrade <installed>`, rpm passes 2. @PACKAGE_VERSION@ is filled in by
# scripts/stage-runtime.mjs.
set -e

version='@PACKAGE_VERSION@'

refuse() {
  echo "throng $1 is installed, which is newer than this package ($version), so nothing was changed." >&2
  echo "To go back to this version, remove throng first. Your projects and settings are kept." >&2
  exit 1
}

case "${1:-}" in
  upgrade)
    if [ -n "${2:-}" ] && command -v dpkg >/dev/null 2>&1 && dpkg --compare-versions "$2" gt "$version"; then
      refuse "$2"
    fi
    ;;
  2)
    if command -v rpm >/dev/null 2>&1; then
      # rpm would expand a percent sign written in a scriptlet when it builds the package.
      percent=$(printf '\045')
      installed=$(rpm -q --qf "$percent{VERSION}" throng 2>/dev/null) || installed=''
      order=$(rpm --eval "$percent{lua:print(rpm.vercmp('$installed','$version'))}" 2>/dev/null) || order=''
      if [ "$order" = 1 ]; then refuse "$installed"; fi
    fi
    ;;
esac
exit 0
