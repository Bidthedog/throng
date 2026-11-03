#!/bin/sh
# The .deb's prerm and the .rpm's preun (063 FR-012). Only a real removal counts: an upgrade keeps the version folders,
# and a copy left open is still running from one of them. dpkg passes `remove`, rpm passes 0.
# A running copy is not killed (FR-013): its daemon ends by itself once nothing is connected to it.
set -e

case "${1:-}" in
  remove | 0) ;;
  *) exit 0 ;;
esac

rm -rf "${THRONG_PACKAGE_TEST_PREFIX:-}/opt/throng-versions"
exit 0
