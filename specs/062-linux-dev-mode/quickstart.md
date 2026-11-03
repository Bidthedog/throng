# Quickstart: Validate Linux Dev Mode

## Prerequisites

Ubuntu 26.04 with GNOME, Node ≥ 22.12, `build-essential`, `python3`. `zsh` and `fish` to see those flavours.

## Start

```bash
npm ci
npm start                               # first run on Ubuntu: refuses, and names the next command
sudo scripts/linux/apparmor-profile.sh install
npm start                               # window opens with the sandbox on
```

Expected: the main window opens and stays open; settings land in `~/.config/throng-dev`, data in `~/.local/share/throng-dev`.

## Scenarios

| # | Do | Expect | Covers |
|---|---|---|---|
| 1 | Add a terminal | Your login shell is the default, and only installed shells are listed | FR-014 |
| 2 | Run `htop`, close the window, reopen | Same process, screen intact | FR-010, SC-002 |
| 3 | Run `sleep 999 &`, close the terminal, check `ps` | No `sleep` left | FR-018 |
| 4 | Project with `README.md` and `readme.md`: open, edit and save both | Two tabs, separate content | FR-020 |
| 5 | Delete a file in the explorer, look in Files → Trash, undo | Present in Trash, then restored | FR-024 |
| 6 | Tear a panel off, drag it back | Behaves as on Windows | FR-029 |
| 7 | Press the Linux focus and Resource Monitor chords | Each fires | FR-034 |
| 8 | Open the Resource Monitor while `yes > /dev/null` runs | CPU agrees with `top`; network says unavailable, with a reason | FR-037 |
| 9 | Start with `sudo` | Refusal message, no window | FR-019 |

## Automated

```bash
npm run test:unit
npm run test:component
npx vitest run --project contract packages/platform-linux/tests/contract
npx playwright test packages/ui/tests/e2e/linux-smoke.e2e.ts --workers=1
```

Everything else runs on CI: see [contracts/ci-lanes.md](contracts/ci-lanes.md).

## Remove

```bash
sudo scripts/linux/apparmor-profile.sh remove
```
