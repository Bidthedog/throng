#!/bin/sh
# Runs as the .deb's postinst and the .rpm's posttrans. The .rpm's post is rpm-post.sh, because it comes before the old
# package's obsolete files are gone (063 research D2). The version is filled in by scripts/stage-runtime.mjs. No braces around plain names and no percent signs: electron-builder and rpm expand both.
#
# A running copy never runs from /opt/throng, the tree the package manager owns. It runs from a folder of hard links to
# that tree. An upgrade replaces files by renaming new ones over them, so the old links keep the old bytes at the same
# path, and a copy left open keeps working (FR-009).
set -e
# Whatever the caller's umask, only root may write to what every account runs (FR-005). Measured: an install from a
# hosted runner left the versions folder world-writable.
umask 022

# dpkg passes configure, or abort-* on a failed upgrade, which has nothing to do. rpm's posttrans passes 1 or 2.
case "${1:-}" in
  configure | '' | 1 | 2) ;;
  *) exit 0 ;;
esac

version='@VERSION@'
prefix=${THRONG_PACKAGE_TEST_PREFIX:-}
payload=$prefix/opt/throng
versions=$prefix/opt/throng-versions
target=$versions/$version
command_link=$prefix/usr/bin/throng

mkdir -p "$versions"
chmod 0755 "$versions"
rm -rf "$target.new" "$target.old"
cp -al "$payload" "$target.new" 2>/dev/null || {
  rm -rf "$target.new"
  cp -a "$payload" "$target.new"
}
if [ -e "$target" ]; then mv "$target" "$target.old"; fi
mv "$target.new" "$target"
rm -rf "$target.old"

ln -sfn "$version" "$versions/current.new"
mv -T "$versions/current.new" "$versions/current"
mkdir -p "$(dirname "$command_link")"
ln -sfn "$versions/current/throng" "$command_link"

# 067 FR-033: the "Open as throng project" item, one file for each file manager.
install_item() {
  mkdir -p "$prefix$2"
  cp -f "$payload/resources/file-manager/$1" "$prefix$2/$1"
  chmod 0644 "$prefix$2/$1"
}
install_item throng-open-project.nemo_action /usr/share/nemo/actions
install_item throng-open-project-kde.desktop /usr/share/kio/servicemenus
install_item throng-open-project.desktop /usr/share/applications

# Only root can set up the sandbox. A package script always is.
if [ "$(id -u)" = 0 ]; then
  profile_active=
  profile=$payload/resources/apparmor-profile
  if command -v apparmor_parser >/dev/null 2>&1 && [ -d /etc/apparmor.d ] &&
    grep -qs Y /sys/module/apparmor/parameters/enabled; then
    # Ubuntu 22.04's AppArmor rejects abi/4.0, and has no restriction for the profile to lift.
    if apparmor_parser --skip-kernel-load --debug "$profile" >/dev/null 2>&1; then
      cp -f "$profile" /etc/apparmor.d/throng
      if [ -x /usr/bin/ischroot ] && /usr/bin/ischroot; then
        profile_active=1 # An image being built: it loads at boot.
      elif apparmor_parser --replace /etc/apparmor.d/throng >/dev/null 2>&1; then
        profile_active=1
      fi
    else
      echo "throng: this AppArmor does not accept the profile, so it was skipped." >&2
    fi
  fi

  # Asked as an unprivileged account, because root passes regardless. --map-root-user is what a restriction refuses.
  if [ -n "$profile_active" ] ||
    setpriv --reuid=65534 --regid=65534 --clear-groups unshare --user --map-root-user true >/dev/null 2>&1; then
    chmod 0755 "$target/chrome-sandbox"
  else
    chmod 4755 "$target/chrome-sandbox"
  fi

  if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database /usr/share/applications || true; fi
  if command -v gtk-update-icon-cache >/dev/null 2>&1; then gtk-update-icon-cache -q -t /usr/share/icons/hicolor || true; fi
fi

# A version left behind by an earlier upgrade goes once nothing runs from it. An account's copy still open keeps its own.
in_use() {
  for link in /proc/[0-9]*/exe; do
    running=$(readlink "$link" 2>/dev/null) || continue
    case "$running" in
      "$1"/*) return 0 ;;
    esac
  done
  return 1
}
for dir in "$versions"/*; do
  [ -d "$dir" ] && [ ! -L "$dir" ] && [ "$dir" != "$target" ] || continue
  in_use "$dir" || rm -rf "$dir"
done
exit 0
