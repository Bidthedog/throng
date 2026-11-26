<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/046-side-panes-and-project-list/plan.md
<!-- SPECKIT END -->

`docs/architecture.md` is the standing overview.

## Verifying done-ness

**A green full `pipeline.yml` run is the only thing that establishes work is done.** A green unit
run, a passing spec, green PR CI or "the tests I changed pass" is progress, not done-ness.

Three workflows, nothing else (spec 072; *The three pipelines* in `docs/testing.md`):

- **`ci.yml`** — every push to a PR, drafts included: lint, typecheck, unit, component, contract and
  the `critical-path` integration subset, on Linux, no E2E, every job to completion. One required
  check, `CI verdict`. Target 5 minutes. A PR that changes only files no job reads skips the jobs and
  passes the verdict (072 FR-004a; the list is `scripts/ci-changes.mjs`).
- **`pipeline.yml`** — nightly on master and on dispatch: every layer on Windows, Linux and macOS,
  every E2E test sharded, `@admin`, calibration, every artifact built and verified. Never publishes.
  A dispatch fails fast unless `-f run_to_completion=true`; the nightly runs to completion and reports on one issue.
- **`release.yml`** — a pushed `v*` tag only: the full pipeline in the same run, then publish.
- **Nothing runs on a push to master.**

Dispatch the pipeline against a pushed ref, narrowed while iterating:

```bash
gh workflow run pipeline.yml --ref <branch>                                  # full
gh workflow run pipeline.yml --ref <branch> -f stages=unit -f platforms=windows
gh run watch <run-id> --exit-status
gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
```

- **Take the verdict from `run view`, not `run watch`.** `gh run watch` detaches early and its exit
  code lies both ways. If `status` is not `completed`, the run is still going.
- **A failed dispatch concludes `cancelled`, not `failure`**: its first failing job has `fail-fast.yml`
  cancel the run once that job has finished, so the failing job keeps its own `failure`. Name it with `gh run view <id> --json jobs --jq '.jobs[]|select(.conclusion=="failure")|.name'`.
- **Never run `npm run gate` locally.** It is the same stages in one process, and it pins every core
  for the better part of an hour and exhausts the interactive desktop heap.
- **A Windows- or macOS-specific change** gets a `pipeline.yml` dispatch for that platform before
  merge; PR CI cannot see it.
- Hosted runners are administrators with UAC disabled, so the `skipIfElevated()` specs cannot run
  there; `admin-reminder.reporter.ts` prints how many were skipped.

Rules for using it:

- **Fail-fast means stop, fix, re-run.** Fix the failing stage first — **running-tests** to re-run
  only what failed (`-f stages=…`), **throng-testing** when it is an E2E flake rather than a defect
  (`-f stress_spec=… -f stress_rounds=…`).
- **Never narrow away the E2E stage** to make a done-ness run finish sooner.
- **A green run is evidence about a commit's tree.** Quote the run URL and SHA when reporting done;
  re-run if anything changed after it.
- **A rewrite that changes no content needs no new run.** After a rebase, squash or reworded
  message, prove the tree is unchanged — `git diff --stat <green-sha> HEAD` empty — and cite the
  original run. GitHub's required checks still re-run on the new head SHA; this rule only stops you
  dispatching `pipeline.yml` yourself.

## Running tests locally

`td` (test-discipline) drives every layer through `.test-discipline/adapters.json`: one runner per
vitest project (`unit`, `component`, `integration`, `contract`) plus `e2e` (Playwright, `@core` =
critical-path, `@extended` = regression). Use `td run --runner <id> --scope file|method --target …`
for the inner loop; `td audit` and `td rank` read the recorded telemetry.

- **Unit and component tests run locally freely.** They are the inner loop.
- **E2E does not run locally as a batch.** At most the one spec covering the change, at one worker,
  when a lower layer cannot show the failure. Push and dispatch `pipeline.yml` — never run the
  full suite or a tier on the workstation before pushing.
- **Integration and contract** run locally only for the files the change touches.
- **Never run `npm run build` in a worktree while its throng is open.** It replaces the hashed renderer
  chunks the running app still loads, whose next dynamic import fails with "Failed to fetch dynamically
  imported module".
- **`npm run typecheck` is `tsc -b`, which writes into `dist`** — the same hazard. While the worktree's
  throng is open, typecheck each package with `npx tsc --noEmit -p packages/<pkg>` instead.
- **Run a worktree's tests from inside the worktree.** Tests that read repo files through
  `process.cwd()` (`release-*.test.ts`, `docs-currency.test.ts`) read whichever checkout the shell is
  in; `vitest --root <worktree>` from the main checkout does not change that, and they silently pass or
  fail against master's files.

## E2E on CI

**No E2E runs on a pull request.** E2E runs in `pipeline.yml` only — nightly, on dispatch and inside
every release — on all three platforms. Narrow a dispatch with `-f stages=e2e -f e2e_filter=<grep, spec
path or @category>`. `@admin` runs in the pipeline's elevated `admin` job.

- **Every E2E test carries two tags**: a significance tag (`@core` or `@extended`) and a category tag
  (`@boot @terminal @editor @explorer @prefs @window @persistence @failure`).
  `packages/ui/tests/unit/e2e-tags.test.ts` fails the build for a test missing either. Significance
  classifies a test; it selects no PR lane, and `@core` has no cap.
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

## Issue agreement

An issue filed at the maintainer's request is the maintainer's: tick its **Maintainer agreement** box
when filing it, and it needs no agreement comment. This overrides the `github-issues` skill's "leave
maintainer-only sections blank". Anyone else's issue still needs the maintainer's comment
(`CONTRIBUTING.md`).

## Cutting a release

**Load the `throng-release` skill** the moment a release is in play, before touching a file. It
owns the running order, the refusal conditions and the past failures, and supersedes the generic
`github-workflow:release` skill and `release-manager` agent. A release runs unattended (spec 065): no
sign-off, no questions, failures fixed through their own PRs until it publishes or hits one of the
skill's stop conditions. `docs/releasing.md` is the overview.

## Documentation

**Load `throng-docs` before writing, moving or reviewing any doc**, and run its audit before every
`gh pr create` / `gh pr edit` and every release tag. `README.md` is a short entry point; every other
topic has one home under `docs/`, indexed by `docs/README.md`, each page opening with a breadcrumb.
`packages/ui/tests/unit/docs-currency.test.ts` enforces the mechanical half in the gate.
**Load `throng-guide` before writing or reviewing a page under `site/guide/`** (the user guide on throng-ide.com); it
owns the page shape and voice. **Load `throng-guide-upkeep` for every change a user can see** (setting, binding,
command, theme setting, panel or preview type, workflow): it lists the help that must change in the same PR.

## Area skills

Each area has a repo-local skill with its file map, binding constitutional rules and known traps:
core/DI, daemon and persistence, terminals and PTY, renderer, editor, config and preferences,
explorer and file ops, failure presentation, spec governance; E2E harness in `throng-testing`, build
and packaging in `throng-release`. **Load the owning skill in the session doing the work.** A
subagent is a deliberate choice for isolation or parallelism, and its brief names the skill to load.
`.claude/skills/README.md` holds the routing table.
