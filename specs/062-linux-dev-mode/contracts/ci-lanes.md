# Contract: Linux CI Lanes

Windows jobs in `ci.yml` and `gate.yml` are not edited (FR-046).

## `ci.yml`, new jobs, same trigger and draft guard

| Job | Runs |
|---|---|
| `Linux: unit / component` | `npm run test:unit`, `npm run test:component` with `--tags-filter='!regression'` |
| `Linux: integration / contract` | build, then both layers, on a real shell set |
| `Linux: E2E (@core + @linux)` | `scripts/ci-linux-setup.sh`, then Playwright at one worker, under `xvfb-run` with `xfwm4` |

## `gate.yml`, new job `gate-linux`

Same stages through `npm run gate` with `THRONG_GATE_E2E_GREP='@core|@linux'`, since FR-046 sets the Linux E2E scope to the `@core` lane plus Linux's own specs. Honours `only`. `report-failure` needs it too.

## `scripts/ci-linux-setup.sh`

Installs `xvfb xfwm4 zsh fish fontconfig libnotify4 libsecret-1-0 gvfs` and the libraries Electron needs, then runs `scripts/linux/apparmor-profile.sh install`, proving the documented step on every run.

## Skips

`admin-reminder.reporter.ts` equivalent: the run prints how many Windows-only tests were skipped, with reasons available in the JSON report (SC-008).

## Required checks

Adding the Linux jobs to master's required checks is a repository setting, done by the maintainer once the lanes have proved stable.
