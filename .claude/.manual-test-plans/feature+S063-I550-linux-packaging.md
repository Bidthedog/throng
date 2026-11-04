# Manual test plan: feature/S063-I550-linux-packaging

Spec: `specs/063-linux-packaging/spec.md`

Set up once: download the `throng-deb` artifact from the branch's `release.yml` rehearsal. Test on Ubuntu with GNOME. Close any throng you have open from a source checkout.

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Install and find it on the desktop | signed off | 5c9bccc307ae | 2026-11-04 | |
| MT-02 | The newer-version notice | signed off | d0ef04565c40 | 2026-11-04 | |
| MT-03 | Remove it | signed off | d0ef04565c40 | 2026-11-04 | |
| MT-04 | The archive under a sandbox restriction | signed off | d0ef04565c40 | 2026-11-04 | |

## MT-01: Install and find it on the desktop

Covers: FR-003, FR-004, FR-006, FR-007, FR-014
Paths: `packaging/linux/launcher.sh`, `packaging/linux/after-install.sh`, `packaging/linux/apparmor-profile.tpl`, `electron-builder.yml`

### Steps

1. Run `sudo apt install ./throng-<version>-amd64.deb`. It finishes without asking for anything else.
2. Open the Activities overview and search for throng. It appears with the throng icon and name.
3. Open it from there. The throng window opens, and its dock icon is the throng icon, not a generic one.
4. Add a terminal and run a command. It runs in your shell, and the output appears.
5. Type `throng` in a separate terminal. The running window comes forward, and no second window opens.

### Negative cases

- Your source checkout's projects do not appear: the packaged copy has its own data.

## MT-02: The newer-version notice

Covers: FR-009, FR-010, FR-011
Paths: `packages/ui/src/renderer/common/installed-version-notice.tsx`, `packages/ui/src/main/installed-version-monitor.ts`, `packages/core/src/abstractions/installed-version.ts`

### Steps

1. If throng is installed, run `sudo apt remove throng`. Install the older build from the `linux-upgrade-fixture` artifact, and open it with a terminal running.
2. In a separate terminal, install the newer `.deb`. It finishes, and throng stays open with its terminal still working.
3. Click the throng window. A notice names both versions and says restarting may end the terminals. It reads clearly, and its restart icon sits on the card.
4. Hover the restart icon: its tooltip says Restart throng. Click it. The window closes, and the new version opens, as Help → About shows.

### Negative cases

- Dismiss the notice, then focus the window again. It does not come back.
- With the newer version installed, run `sudo dpkg -i` on the older `.deb`. It refuses in plain words, and throng still opens at the newer version.

## MT-03: Remove it

Covers: FR-012, FR-013
Paths: `packaging/linux/before-remove.sh`, `packaging/linux/after-remove.sh`, `packages/daemon/src/removed-install-watch.ts`

### Steps

1. With throng open, run `sudo apt remove throng`. It finishes, and the window stays open.
2. Close the window. Within a minute, no throng process is left in the system monitor.
3. Search the Activities overview for throng. It is gone, and `throng` in a shell is not found.
4. Install the `.deb` again and open it. Your projects and settings are still there.

### Negative cases

- Your files under `.config/throng` and `.local/share/throng` were not touched by the removal, and your projects' database, `throng.db`, is in `.local/share/throng`.

## MT-04: The archive under a sandbox restriction

Covers: FR-004, FR-008
Paths: `packaging/linux/launcher.sh`, `packaging/linux/after-pack.cjs`

### Steps

1. Download the `throng-tarball` artifact and extract it into a folder with a space in its name.
2. Double-click `throng` in the file manager, or run it from a shell. A message says the sandbox cannot start from this folder, names the folder, and says to move it to a path with no spaces. It is readable, and throng does not open.
3. Move the folder to a path with no spaces, and start it again. A message says the sandbox cannot start, and gives two commands. It is readable, and throng does not open.
4. Run those two commands, then start it again. The throng window opens.
5. Close it, wait a minute, and delete the folder. It deletes with no error, and nothing of it remains running.

### Negative cases

- Nothing suggests turning the sandbox off.
