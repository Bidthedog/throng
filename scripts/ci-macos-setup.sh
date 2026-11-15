#!/usr/bin/env bash
#
# Prepares a hosted macOS runner for throng (spec 070 FR-036, research R27), as scripts/ci-linux-setup.sh prepares an
# Ubuntu one. A hosted Mac already has a logged-in desktop session, so there is no display server to start.
#
#   scripts/ci-macos-setup.sh
#
# Run as the runner's own account, never under sudo: Homebrew refuses root. Written for bash 3.2, the bash macOS ships,
# in case /usr/bin/env finds that one.
#
# Exit codes: 0 prepared · 1 a step failed · 2 run as root.
set -euo pipefail

log() {
	printf '[ci-macos-setup] %s\n' "$*" >&2
}

# fish is one of the shells the terminal specs start; zsh and bash are already there.
install_shells() {
	if command -v fish >/dev/null 2>&1; then
		log "fish is already installed: $(command -v fish)"
		return 0
	fi
	HOMEBREW_NO_AUTO_UPDATE=1 HOMEBREW_NO_INSTALL_CLEANUP=1 brew install --quiet fish
	log "installed fish: $(command -v fish)"
}

# zsh stops at its new-user wizard and its insecure-directories question on a fresh account. Neither is throng's. The
# same guard ci-linux-setup.sh writes.
guard_zsh() {
	local file
	for file in .zshrc .zshenv; do
		[ -e "$HOME/$file" ] || : >"$HOME/$file"
	done
	grep -q skip_global_compinit "$HOME/.zshenv" || printf 'skip_global_compinit=1\n' >>"$HOME/.zshenv"
}

# research R27's risk: a runner's display may be smaller than the 1920x1080 the Windows lane sets. Say what it is, so
# the first run answers that; never fail on it.
print_display() {
	log 'display:'
	system_profiler SPDisplaysDataType 2>/dev/null | grep -E 'Resolution|Display Type|Main Display' >&2 || log '  (no display reported)'
}

main() {
	if [ "$(id -u)" -eq 0 ]; then
		log 'run this as the runner account, not root: Homebrew refuses root'
		exit 2
	fi
	install_shells
	guard_zsh
	print_display
}

if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
	main "$@"
fi
