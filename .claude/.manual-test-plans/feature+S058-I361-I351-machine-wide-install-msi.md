# Manual test plan: machine-wide installation and the MSI (spec 058)

Spec: `specs/058-machine-wide-install-msi/spec.md`

| ID | Title | Status | Signed off at | Date | Reason |
|---|---|---|---|---|---|
| MT-01 | Setup, installed just for me | signed off | 88102b299666 | 2026-10-22 | |
| MT-02 | Setup, installed for everyone | signed off | 88102b299666 | 2026-10-22 | |
| MT-03 | Declining the administrator prompt | signed off | 88102b299666 | 2026-10-22 | |
| MT-04 | The MSI, interactively, in both scopes | signed off | 88102b299666 | 2026-10-22 | |
| MT-05 | Upgrading or removing an everyone-install someone else is using | signed off | 88102b299666 | 2026-10-22 | |
| MT-06 | Several copies, one running throng | signed off | 88102b299666 | 2026-10-22 | |
| MT-07 | Uninstall keeps other people's data | signed off | 88102b299666 | 2026-10-22 | |
| MT-08 | Downgrading a copy in place | signed off | 88102b299666 | 2026-10-22 | |

**How these were signed off.** At the maintainer's direction (2026-10-21), every group was run on
GitHub-hosted Windows runners rather than by hand, by `scripts/verify-hand-tests.mjs` driving the
real setup and MSI dialogs through UI Automation: `release.yml` with `hand_tests=true`, run
[39699265655](https://github.com/Bidthedog/throng/actions/runs/39699265655) at `88102b29`, all
eight groups green. Each group's `hand-test-MT-0N` artifact holds its per-step verdict and a
screenshot at every dialog. Steps a runner physically cannot perform are recorded as `runner-gap`
with the stand-in used: UAC is off (no prompt to decline or approve), the desktop is already
High integrity (the app's level is measured, not compared), and the job cannot restart mid-run.

Every group needs a Windows 11 VM you can restart and snapshot, with one administrator account and
two standard accounts, and the four downloads from this branch's `release.yml` rehearsal run
(`throng-setup`, `throng-msi`, `throng-portable`, `throng-archive` artifacts). Restore the clean
snapshot before each group.

## MT-01: Setup, installed just for me

Covers: FR-001, FR-002, FR-006, FR-017b, SC-004
Paths: `packaging/installer.nsh`, `packaging/nsis/**`, `electron-builder.yml`

### Steps
1. Signed in as a standard account, double-click `throng-setup-<version>.exe`. A page asks who to install for, with **Only for me** selected.
2. Leave it selected and finish the wizard. No administrator prompt appears at any point.
3. Open the Start menu. A shortcut named **throng (per-user)** is there. Open it; throng starts and a terminal works.
4. Open **Settings → Apps → Installed apps**. An entry reads **throng <version> (per-user)**.

### Negative cases
- Signed in as the other standard account, the shortcut and the entry are absent.

## MT-02: Setup, installed for everyone

Covers: FR-004, FR-005, FR-007, FR-012, FR-013, SC-001, SC-002, SC-010
Paths: `packaging/installer.nsh`, `packaging/nsis/**`, `electron-builder.yml`, `packages/ui/src/main/daemon-lifecycle.ts`

### Steps
1. As the administrator, run the setup, choose **Anyone who uses this computer**. One administrator prompt appears; approve it.
2. Finish with **Run throng** ticked. throng opens; open a terminal and run `whoami /groups | findstr /i "Mandatory"`. It shows **Medium** Mandatory Level, not High.
3. The Start menu shows **throng (all users)**; *Installed apps* shows **throng <version> (all users)**.
4. Sign in as a standard account. **throng (all users)** is in its Start menu. Open it: throng starts on the first attempt, and a terminal works.
5. With both accounts signed in and throng open in each (fast user switching), create a project in one. It does not appear in the other's project list, and neither sees the other's terminals.

### Negative cases
- At no point after the single approval in step 1 is a second administrator prompt shown.

## MT-03: Declining the administrator prompt

Covers: FR-010a, FR-003a
Paths: `packaging/nsis/multiUserUi.nsh`, `packages/core/src/config/msi-project.ts`, `packaging/msi-project.cjs`

### Steps
1. As a standard account, run the setup, choose **Anyone who uses this computer**, and press **No** (or cancel) at the administrator prompt. A message says installing for everyone needs administrator approval, nothing was installed, and you can choose *Only for me* or try again.
2. Close the message. The page asking who to install for is still showing.
3. Choose **Only for me** and finish. throng installs for that account, with no prompt.
4. Restore the snapshot. Repeat steps 1–3 with `throng-<version>.msi`: choosing all users and declining the prompt shows the same explanation and leaves the scope choice showing.

### Negative cases
- After declining, nothing appears in *Installed apps* and no Start-menu shortcut exists until step 3.

## MT-04: The MSI, interactively, in both scopes

Covers: FR-003a, FR-017a, FR-017b, FR-007
Paths: `packages/core/src/config/msi-project.ts`, `packaging/msi-project.cjs`, `electron-builder.yml`

### Steps
1. As a standard account, double-click the MSI and finish with the default scope. No administrator prompt appears. The Start menu shows **throng MSI (per-user)** and *Installed apps* shows **throng (MSI, per-user)**.
2. As the administrator, double-click the MSI and choose **all users**; approve the one prompt. The Start menu shows **throng MSI (all users)** for every account, and *Installed apps* shows **throng (MSI, all users)**.
3. Finish with the launch option ticked. In the throng that opens, a terminal running `whoami /groups | findstr /i "Mandatory"` shows **Medium**.

### Negative cases
- The MSI never installs into the setup's folder: neither `%LOCALAPPDATA%\Programs\throng` nor `%ProgramFiles%\throng` changes.
- When a standard account chooses **all users** in the MSI and an administrator approves the prompt, the elevated wizard carries on and the original window closes without an "interrupted" or "ended prematurely" page.

## MT-05: Upgrading or removing an everyone-install someone else is using

Covers: FR-015, FR-016a
Paths: `packaging/installer.nsh`, `packaging/nsis/installSection.nsh`, `packaging/in-use.mjs`, `packages/core/src/config/install-in-use.ts`, `packages/core/src/config/msi-project.ts`

### Steps
1. Install the setup for everyone. Sign in as a standard account, open throng and start a terminal running `ping -t localhost`. Switch user back to the administrator.
2. Run the same setup again interactively. It refuses before changing anything, naming the standard account, and says to try again once they have closed throng.
3. Run it unattended from an elevated prompt: `throng-setup-<version>.exe /S /allusers`, then `echo %errorlevel%`. It prints **3010**. Switch to the standard account: its throng and the ping are still running.
4. Restart the VM. Both accounts launch throng normally; *About throng* shows the installed version.
5. Restore the snapshot and repeat steps 1–4 with the MSI (`msiexec /i throng-<version>.msi /qn`, elevated). The interactive removal (`msiexec /x`) shows a message naming the account, and nothing else: no second notice follows it (in particular not Windows Installer's own "a program run as part of the setup did not finish as expected"), the dialog closes and nothing is removed.

### Negative cases
- In no step is the standard account's throng or terminal closed.

## MT-06: Several copies, one running throng

Covers: FR-017, FR-018, FR-018a, FR-018b, FR-019, FR-021, FR-021a, FR-022, SC-005, SC-006, SC-007
Paths: `packages/ui/src/main/instance-guard.ts`, `packages/ui/src/main/main.ts`, `packages/core/src/config/instance-identity.ts`, `packages/ui/src/renderer/common/different-copy-notice.tsx`, `packages/ui/src/main/instance-paths.ts`, `packages/ui/src/main/daemon-lifecycle.ts`

### Steps
1. As the standard account, install the MSI just for you. Then as the administrator, install the setup just for you, the setup for everyone and the MSI for everyone, and extract the archive to `C:\tools\throng`. Every install completes with no warning about the others. (One account cannot hold the MSI in both scopes — a Windows Installer limit, in [installation](../../docs/installation.md#more-than-one-copy).)
2. Open **throng (per-user)**, create a project, start a terminal running `ping -t localhost`.
3. Open **throng (per-user)** again. No second window opens; the existing one comes to the front.
4. Open **throng MSI (all users)**. No second window opens; the running window shows a notice naming its own folder and version and saying to close it first to open the other copy.
5. Close throng, leaving the terminal running. Open **throng MSI (all users)**: the same project is listed and the ping terminal reattaches.
6. Extract the previous release's zip (alpha10) to `C:\tools\throng-old` and run its `throng.exe` while the current throng is open. No second throng starts; the running window comes forward with no notice.
7. Close everything; run `C:\tools\throng-old\throng.exe` alone. It opens the same projects and attaches to the newer copy's daemon, which and whose ping terminal from step 2 are untouched (the previous release refuses to retire a daemon that is not its own, #192; it cannot be changed, FR-021a note). A current copy of a different build does replace the daemon, ending the terminal: checked on the runner by the hand-test driver with a second current copy built with another build id.
8. As the standard account, uninstall **throng MSI (per-user)**. Every other copy is still in the Start menu and opens.

### Negative cases
- Never two throng windows of different copies at once.
- With an installed throng open, `npm start` in a source checkout still opens a separate dev throng (its own data), and the installed one keeps its terminals.

## MT-07: Uninstall keeps other people's data

Covers: FR-016, FR-019
Paths: `packaging/installer.nsh`

### Steps
1. Install the setup for everyone. As a standard account, open throng and create a project named **Theirs**.
2. As the administrator, open throng and create a project named **Mine**.
3. As the administrator, uninstall **throng <version> (all users)** and tick **also delete my projects and settings**.
4. Reinstall for everyone. As the administrator, **Mine** is gone. As the standard account, **Theirs** is still listed.

### Negative cases
- An unattended uninstall (`"…\Uninstall throng.exe" /S /allusers`) deletes neither account's projects.

## MT-08: Downgrading a copy in place

Covers: FR-022, FR-025, 020 FR-016a
Paths: `packaging/nsis/installSection.nsh`, `packages/core/src/config/msi-project.ts`

### Steps
1. Install this build's setup for everyone. Run the previous release's setup (alpha10) and choose **Anyone who uses this computer**. It refuses, saying a newer version is installed; this build is still installed.
2. Run the previous release's setup choosing **Only for me**. It installs alongside: both copies are in the Start menu and each reports its own version in *About throng* (opened one at a time).

### Negative cases
- The refused downgrade in step 1 removes nothing.
