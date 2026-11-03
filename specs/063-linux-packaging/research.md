# Research: Linux Packaging

## D1. Build tool

electron-builder's `deb`, `rpm` and `tar.gz` targets, because `electron-builder.yml` already owns the Windows set and
its Linux targets accept custom maintainer scripts. Its `getSanitizedVersion` maps `-` to `~` for deb and rpm, so
`1.0.0-alpha12` becomes `1.0.0~alpha12`, which both tools sort below `1.0.0`. No mapping of our own is needed; the
harness asserts the recorded package version.

## D2. A running copy across an upgrade (FR-009)

**Decision: a running copy never runs from the package-owned tree.** The package owns `/opt/throng`. Its post-install
builds `/opt/throng-versions/<version>` as a hard-link farm of that tree (`cp -al`) and points
`/opt/throng-versions/current` at it. `/usr/bin/throng` and the desktop entry go through `current`.

Why this holds: dpkg and rpm replace a file by writing a temporary and renaming it over the target, and unlink files
that left the package. Neither writes into an existing inode, so a hard link taken before the upgrade keeps the old
bytes. The old version's folder stays complete and at its original path, so a new window, a reload, a respawned
pty-agent and a lazily loaded native module all read the version that is running.

Rejected:

- **Leave Chromium's zygote and `/proc/self/exe` to cope.** They cover Electron's own children, not throng's renderer
  files, daemon modules, pty-agent or natives, all of which are plain files read on demand.
- **Payload as a tarball extracted by the post-install.** The package manager would not know the files, so
  verification and ownership queries stop working.
- **Copying the tree per user at start.** About 300 MB per account, per launch.

A hard link costs no space while the versions are the same inodes. A version left behind by an upgrade is pruned by
the next package operation once no process runs from it. Package scripts run as root, so they can read every account's
`/proc/<pid>/exe`.

rpm installs the new package's files, runs `%post`, and only then removes the old package's obsolete files. The links
are therefore taken in `%posttrans`, after those are gone. dpkg removes them before `postinst`.

## D3. The launcher (FR-008, 062 display default)

A sandbox failure kills Electron before any JavaScript runs, so a check inside throng cannot report it. On Linux,
`afterPack` renames Electron's binary to `throng-bin` and writes a POSIX shell `throng` in its place, in all three
formats. It:

1. Passes when `chrome-sandbox` is setuid root, or when `unshare --user --map-root-user true` succeeds. Plain
   `unshare --user` succeeds under Ubuntu's restriction, so it proves nothing.
2. Otherwise writes the problem and the exact fix to stderr, shows it in the first dialog tool it finds, and exits 1.
3. Adds `--ozone-platform=x11` unless the user's `settings.json` opts in to native Wayland.

The fix it gives is setuid `chrome-sandbox` in that folder, which needs no profile and applies to that folder only.

## D4. The sandbox from a package (FR-007)

The post-install loads an AppArmor profile that grants `userns` to `/opt/throng-versions/*/throng-bin` only, where
AppArmor is enabled and accepts `abi/4.0`. It then asks whether the sandbox works for an unprivileged account, by
running the D3 test through `setpriv` as `nobody`, because root passes it regardless. If that fails it sets
`chrome-sandbox` setuid root, otherwise 0755. No sysctl is touched.

Ubuntu 22.04's AppArmor rejects `abi/4.0`; the profile is skipped with a message and its kernel has no restriction.

## D5. Downgrade refusal (FR-011)

`dpkg -i` installs an older package, and so does `dnf install`, which treats it as a downgrade and exits 0 (measured on
Fedora 45). So each package's pre-install script compares the installed version with its own and exits 1 when its own is
older: `dpkg --compare-versions` for the `.deb`, `rpm.vercmp` through `rpm --eval` for the `.rpm`. Removing first clears
it, which is the deliberate route the spec names.

The version reaches the scripts through `stage-runtime.mjs`, which fills `@VERSION@` into copies under
`packages/ui/build/linux`. electron-builder's own `${word}` macro throws on unknown names, so the scripts never use
that spelling.

## D6. The version notice (FR-010)

`IInstalledVersion` is a platform seam. Linux reads `<versions>/current/resources/app/package.json` when this copy runs
from a versions folder, and answers null for an archive, a source run or a missing file. Windows answers null: its
installers already refuse while in use (058). Main asks on focus and once a minute, and raises one notice per installed
version. The notice's Restart action relaunches through `current`.

Restarting ends the terminals because `ensureDaemon` retires a daemon of a different build (058 FR-021a). The notice
says so.

## D7. A removed copy's daemon (FR-013)

The daemon outlives the window by design, so closing the window does not end it. On Linux it watches its own entry
file: when the entry is gone and no client is connected, it runs its normal SIGTERM shutdown. The check runs when the
last client leaves and every 30 seconds. Removal itself kills nothing. An upgrade leaves the entry in place (D2), so an
upgrade never triggers it. Whether a platform does this is `hostTraits().exitWhenEntryRemoved`, false on Windows, whose
portable daemon is handled by `ensureDaemon` (#429).

## D8. Verification (FR-017, FR-018, FR-021)

A new harness, `scripts/verify-linux-package.mjs`, leaves `verify-installer.mjs` untouched. It reuses the existing step
vocabulary, so Windows verdicts do not change shape:

| Step | Meaning on Linux |
|---|---|
| `install` | the package manager installed it, leaving nothing world-writable (`not-applicable` for the archive) |
| `launch` | a window opened through the launcher, and no process carries `--no-sandbox` |
| `version-match` | filename, package manager record and installed manifest agree |
| `self-contained` | the daemon's `/proc/<pid>/exe` is the bundled runtime |
| `shortcut` | the desktop entry, icon and `throng` command exist |
| `no-service` | no systemd unit names throng |
| `core-journey` | a project is created and a terminal runs a command on the app's own daemon |
| `reattach` | the daemon survives the window and the same pid is reused |
| `in-use-upgrade` | an open older copy survives the upgrade, the notice appears, data survives, and a downgrade is refused |
| `checksum-match` | the digest is of these bytes |
| `no-write` | the install tree is unchanged by a run |
| `uninstall` | everything the package installed is gone |
| `residue-scan` | nothing remains, the daemon has ended by itself, and user data is intact |

Nothing is `unproven` on Linux: `RUNNER_LIMITED_STEPS` does not change. A real desktop's application list and icon are
in the manual test plan.

The `.rpm` runs in a privileged `fedora` container, as a non-root account because throng refuses to start as root. The
`.deb` and archive run on `ubuntu-24.04`, which restricts user namespaces, so the profile and the archive's refusal are
both exercised for real. The build runs on `ubuntu-22.04`, the oldest supported glibc (FR-020).

`in-use-upgrade` needs an older package. The build job also packages this tree as version `0.9.0`, uploaded as a
fixture artifact that is never declared and never published.
