---
name: throng-clear-dev-state
description: Wipe throng's dev-mode state — stop the dev app, its daemon, its pty-agent and any orphaned child terminals, then delete %APPDATA%\throng-dev and %USERPROFILE%\.throng-dev. Use this whenever a dev throng is behaving oddly and you want to rule out leftover state: a stale layout or database, a wedged session, a daemon still running from a previous launch or from an E2E run, "it works in a fresh instance but not mine", or a data folder that will not delete because something holds it. Also use it when the user says clear/reset/wipe the dev settings, start from a clean slate, kill throng, or asks why a deleted folder comes back. It never touches the INSTALLED throng's data in %APPDATA%\throng.
---

# Clear throng's dev state

## Why this exists

Two things make "just delete the folder" unreliable, and both surprise people.

**throng's daemon is meant to outlive its window.** Terminals keep running when the UI closes
(Principle III) — that is a feature, not a leak. So closing throng, or an E2E run finishing, leaves a
`node …/packages/daemon/dist/main.js` and often a `pty-agent-entry.js` alive. They hold the dev data
folder open, so deleting it fails with a permission error while Task Manager shows nothing called
"throng". Every attempt to clear state fails for a reason that is invisible.

**The dev and installed instances look alike.** Both are Electron apps called throng; both spawn
`node.exe`. Killing by process name would take out the user's real, installed throng along with the
dev one. The discriminator is the **command line**: a dev process was launched from the repository.

## Doing it

Run the bundled script. It stops the processes in the right order, waits for handles to release, and
then removes the folders with retries:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .claude/skills/throng-clear-dev-state/scripts/clear-dev-state.ps1
```

Useful variations:

| Goal | Flag |
|---|---|
| See what it would do, change nothing | `-WhatIf` |
| Keep the data, just stop the processes | `-KeepData` |
| Rename the folders aside instead of deleting | `-Backup` |
| Target a different checkout or worktree | `-RepoRoot D:\git\throng` |

Prefer `-Backup` when the user is investigating a suspected data problem rather than simply wanting a
clean slate. A renamed folder can still be inspected; a deleted one has taken the evidence with it.

The script reports each process it stops and each folder it removes. Relay that — "it worked" is much
less useful than "it stopped a daemon that had been running since your last test run", which tells
the user something about how they got here.

## What it deliberately leaves alone

- **`%APPDATA%\throng`** — the INSTALLED instance's data: real projects, layouts and settings. Only
  the `throng-dev` variants are cleared. If a user genuinely wants the installed data gone, that is a
  different and much more consequential request; confirm it explicitly rather than folding it in here.
- **Processes outside the repository**, including an installed throng the user has open.
- **`%LOCALAPPDATA%\throng-updater`**, which is not state this is about.

## After running it

The dev instance starts empty: no projects, no layout, default settings. Say so, because a user who
was mid-investigation will otherwise wonder where their projects went.

If the point was to test whether stale state caused a defect, the next step is to reproduce with the
clean instance. Two outcomes, both informative: the defect vanishes, so it lived in the data or in a
stale process; or it survives, and state is now eliminated as a cause.

## When it cannot delete a folder

The script retries and then fails loudly rather than reporting success. That almost always means a
process outside the repository holds the folder — a throng launched from a different worktree, or one
started by hand from another checkout. Find it with:

```powershell
Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*throng*' } |
  Select-Object ProcessId, Name, CommandLine
```

Then re-run with `-RepoRoot` pointed at that checkout, so the kill stays scoped to something the user
actually intends to stop.
