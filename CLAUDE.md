For technologies, project structure and commands, read the active feature's plan at
`specs/<NNN>-*/plan.md` (the spec the current branch belongs to). `docs/architecture.md` is the
standing overview.

## Verifying done-ness

**`npm run gate` is the only thing that establishes work is done.** A green unit run, a passing spec
or "the tests I changed pass" is progress, not done-ness.

It runs the gating stages in CI's order, fail-fast: **lint → typecheck → build → unit → component →
integration → contract → e2e**, and clears the app/daemon/pty-agent/Playwright processes a run
leaves behind. Component sits right after unit because it is the second-cheapest layer (jsdom, no
app, no daemon, no shell).

**It runs on a GitHub-hosted runner, not here.** Dispatch it against a pushed ref:

```bash
gh workflow run gate.yml --ref <branch>
gh run watch <run-id> --exit-status
gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
```

- **Take the verdict from `run view`, not `run watch`.** `gh run watch` detaches early and its exit
  code lies both ways. If `status` is not `completed`, the run is still going.
- **Never run the gate locally.** It pins every core for the better part of an hour and exhausts the
  interactive desktop heap.
- Hosted runners are administrators with UAC disabled, so the `skipIfElevated()` specs cannot run
  there; `admin-reminder.reporter.ts` prints how many were skipped.

Rules for using it:

- **Fail-fast means stop, fix, re-run.** Fix the failing stage first — **running-tests** to re-run
  only what failed, **throng-testing** when it is an E2E flake rather than a defect.
- **Never bypass the E2E stage** to make the gate finish sooner.
- **A green gate is evidence about a commit's tree.** Quote the run URL and SHA when reporting done;
  re-run if anything changed after it.
- **A rewrite that changes no content needs no new gate.** After a rebase, squash or reworded
  message, prove the tree is unchanged — `git diff --stat <green-sha> HEAD` empty — and cite the
  original run. GitHub's required checks still re-run on the new head SHA; this rule only stops you
  dispatching `gate.yml` yourself.

## Running tests locally

`td` (test-discipline) drives every layer through `.test-discipline/adapters.json`: one runner per
vitest project (`unit`, `component`, `integration`, `contract`) plus `e2e` (Playwright, `@core` =
critical-path, `@extended` = regression). Use `td run --runner <id> --scope file|method --target …`
for the inner loop; `td audit` and `td rank` read the recorded telemetry.

- **Unit and component tests run locally freely.** They are the inner loop.
- **E2E does not run locally as a batch.** At most the one spec covering the change, at one worker,
  when a lower layer cannot show the failure. Push and let CI run the E2E lanes — never run the
  full suite or a tier on the workstation before pushing.
- **Integration and contract** run locally only for the files the change touches.

## E2E on CI

CI runs on a non-draft pull request to master and on dispatch, never on a bare push. It runs the
**`@core` lane** (capped at 50 tests, one job, one worker). The `@extended` lane runs in the gate and
the release pipeline. See *Two lanes* in `docs/testing.md`.

**Testing something only CI can answer** (anything that depends on administrator rights): push, then
`gh pr ready`. Every job runs on a ready PR and re-runs on each push; a draft or a bare branch push
starts nothing.

- **Every E2E test carries two tags**: a significance tag (`@core` or `@extended`) and a category tag
  (`@boot @terminal @editor @explorer @prefs @window @persistence @failure`).
  `packages/ui/tests/unit/e2e-tags.test.ts` fails the build for a test missing either — an untagged
  test runs in neither lane.
- **`packages/ui/tests/e2e/e2e-budget.json` is a ratchet and fails both ways.** Re-seed it in the
  same commit that adds or removes a test.
- **A spec that opens the preferences window, drives a context menu or runs a long-lived real shell
  goes in `packages/ui/tests/e2e/parallel-plan.json`** — `tier-plan.test.ts` enforces it. Such a spec
  steals focus, and throng closes menus on blur.
- **Share one app per file** via `openApp()` in `beforeAll` where the tests do not seed state before
  launch; a test that needs a seeded config root or database keeps its own app via `runOwnApp`. See
  `.claude/skills/throng-testing/references/writing-e2e.md`.
- **An E2E that disagrees with a unit test about a constant: check `dist` first.** Vitest resolves
  `@throng/core` to source; the Electron app loads `packages/core/dist`, which `tsc -b`'s buildinfo
  can wrongly believe current. `rm packages/core/tsconfig.tsbuildinfo`, `rm -rf packages/core/dist`,
  rebuild.

## Formatting is ESLint's job — never run Prettier here

There is no Prettier config and no `format` script; `npm run lint` (`eslint .`) is the only
formatter. Prettier's defaults (double quotes) rewrite every string in every file it touches. Fix
awkward wrapping by hand, or let ESLint do it.

## Before you add a requirement, find the one that already governs it

A requirement that changes existing behaviour needs a search for the requirement that already
describes it — in `specs/*/spec.md` and in the tests — before it is written:

```sh
grep -rn "<the behaviour, in the repo's words>" specs/*/spec.md
git grep -n "<the observable>" -- packages/*/tests
```

Search especially when the behaviour looks like an oversight rather than a decision, or when you are
reasoning from a guarantee you just wrote. Cite the right spec and FR — a wrong citation sends the
next reader to a requirement that says something else. An older requirement that should change is a
**supersession**, stated in the new spec with what it replaces and why (021 FR-042 over 007's
modality is the worked example). (Origin: 032 contradicted 019 FR-023 on a retired settings key.)

## One condition, one notice

A single condition raises a single notice, and the actions that resolve it live on that notice.

- **One surface per condition.** A second caller reporting the same state makes the first louder —
  flash it, do not raise another.
- **The report belongs to whatever owns the state**, not to the caller that bounced off it.
- **Say what is wrong, not what the user may not do.**
- **Inline, not a toast, for anything with an action attached** — a toast cannot carry a button.

## Cutting a release

**Load the `throng-release` skill** the moment a release is in play, before touching a file. It
owns the running order, the refusal conditions and the past failures, and supersedes the generic
`github-workflow:release` skill and `release-manager` agent. It asks for the version rather than
guessing, and the QA sign-off on the `release` Environment is a human act. `docs/releasing.md` is the
overview.

## Documentation

**Load `throng-docs` before writing, moving or reviewing any doc**, and run its audit before every
`gh pr create` / `gh pr edit` and every release tag. `README.md` is a short entry point; every other
topic has one home under `docs/`, indexed by `docs/README.md`, each page opening with a breadcrumb.
`packages/ui/tests/unit/docs-currency.test.ts` enforces the mechanical half in the gate.

## Area skills

Each area has a repo-local skill with its file map, binding constitutional rules and known traps:
core/DI, daemon and persistence, terminals and PTY, renderer, editor, config and preferences,
explorer and file ops, failure presentation, spec governance; E2E harness in `throng-testing`, build
and packaging in `throng-release`. **Load the owning skill in the session doing the work.** A
subagent is a deliberate choice for isolation or parallelism, and its brief names the skill to load.
`.claude/skills/README.md` holds the routing table.
