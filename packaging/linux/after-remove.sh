#!/bin/sh
# The .deb's postrm and the .rpm's postun (063 FR-007, FR-012): what the install script added, beyond the package's own
# files. Nothing under any home folder is touched. dpkg passes remove or purge, rpm passes 0; an upgrade passes neither.
set -e

case "${1:-}" in
  remove | purge | 0) ;;
  *) exit 0 ;;
esac

prefix=${THRONG_PACKAGE_TEST_PREFIX:-}
rm -f "$prefix/usr/bin/throng"
rm -f "$prefix/usr/share/nemo/actions/throng-open-project.nemo_action"
rm -f "$prefix/usr/share/kio/servicemenus/throng-open-project-kde.desktop"
rm -f "$prefix/usr/share/applications/throng-open-project.desktop"
rm -rf "$prefix/opt/throng-versions"
# rpm removes the package's files but not its folders, which it does not own (measured on Fedora 45).
rm -rf "$prefix/opt/throng"

if [ "$(id -u)" = 0 ]; then
  if [ -f /etc/apparmor.d/throng ]; then
    if command -v apparmor_parser >/dev/null 2>&1; then apparmor_parser --remove /etc/apparmor.d/throng >/dev/null 2>&1 || true; fi
    rm -f /etc/apparmor.d/throng
  fi
  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database /usr/share/applications || true; fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true; fi
fi
exit 0
