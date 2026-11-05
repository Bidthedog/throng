#!/usr/bin/env bash
# Creates throng's repository signing key, once (064 FR-009). The private half goes to the `release` Environment secret
# and to the backup file you name. The public half goes to site/throng-repo-key.asc, to be committed. Replacing the key
# later makes every repository user add the new one by hand, so keep the backup somewhere safe and out of this repo.
#
#   scripts/repo-signing-key.sh --backup <path-outside-the-repository>
set -euo pipefail

usage() { echo "usage: $0 --backup <path-outside-the-repository>" >&2; exit 2; }

[[ $# -eq 2 && $1 == --backup ]] || usage
backup=$2

root=$(git -C "$(dirname "${BASH_SOURCE[0]}")" rev-parse --show-toplevel)
public="$root/site/throng-repo-key.asc"

backup_dir=$(cd "$(dirname "$backup")" && pwd)
case "$backup_dir/" in
  "$root"/*) echo "refusing: $backup is inside the repository" >&2; exit 2 ;;
esac
if [[ -e $backup ]]; then echo "refusing: $backup already exists" >&2; exit 2; fi
if [[ -e $public ]]; then echo "refusing: $public already exists, so a key was already made" >&2; exit 2; fi

GNUPGHOME=$(mktemp -d)
export GNUPGHOME
trap 'gpgconf --kill all 2>/dev/null || true; rm -rf "$GNUPGHOME"' EXIT

# No passphrase, because a job signs with it unattended. The Environment's protection is what guards it.
gpg --batch --quiet --passphrase '' --quick-generate-key 'throng package repository' ed25519 sign never
fingerprint=$(gpg --batch --list-keys --with-colons | awk -F: '/^fpr:/ { print $10; exit }')

( umask 077; gpg --batch --armor --export-secret-keys "$fingerprint" > "$backup" )
gpg --batch --armor --export "$fingerprint" > "$public"
gh secret set REPO_SIGNING_KEY --env release --repo Bidthedog/throng < "$backup"

echo "Fingerprint: $fingerprint"
echo "Private key: REPO_SIGNING_KEY on the release Environment, and $backup"
echo "Public key:  $public, to be committed"
