---
name: throng-release
description: Cut a throng release end to end, UNATTENDED — settle the version (the one named, or the next on the current prerelease track), sweep the dependencies (npm audit, patch and minor updates) as the release branch's first commit, write the release notes into CHANGELOG.md, bump the root manifest and the six workspaces that follow it, bring the docs current, run the full gate, tag it, watch release.yml build, verify and publish every artifact with no human gate, and fix whatever breaks through its own PR and go again until a release is published. USE THIS EVERY TIME a release is in play, whatever words are used — "do a release", "cut alpha5", "ship 1.0.0-rc.1", "release this", "tag a new version", "publish the build", "get an installer out", "bump the version", "prepare release notes", "what's in the next release", "the release pipeline failed", "the publish job is stuck", "re-run the release", "why was publishing refused" — and reach for it even when only one part is named, because the parts bind to each other through a four-way version match that fails late and loudly. A release request is the whole authorisation: never stop to ask for the version, a sign-off, a merge or a re-run — the only stops are the ones in "When to stop". This skill OWNS releases in this repository and supersedes the generic github-workflow:release skill and release-manager agent, which know nothing about throng's declared artifact set, its CHANGELOG-derived notes, or its five publish gates. It also carries the build pipeline's area knowledge — tsc project references, the Vite renderer build, electron-builder and the NSIS installer, the bundled host-Node runtime, native module ABI errors, "the packaged app cannot find X", and GitHub Actions workflow edits.
---

# Releasing throng

This is the running order, the commands, and the things that have actually gone wrong. *Why* the
pipeline is shaped the way it is lives in [`references/`](references/) — see
[Where the detail lives](#where-the-detail-lives); `docs/releasing.md` is the maintainer-facing
overview.

## A release runs unattended

**The maintainer asks once, and the next thing they hear is a published release or a stop report.**
Nobody signs off, approves a merge, or answers a question on the way (spec 065). The request is the
authorisation for every run this skill dispatches — `gate.yml`, `release.yml`, re-runs — and every PR
it opens and merges, the dependency PR and fix PRs included.

So: never end a turn mid-release to report progress or ask. A one-line progress note, then the next
step. The waits are long (the gate ~1 h, `release.yml` ~1.5 h): one blocking watch each, and a
`PushNotification` only for the final result or a stop.

### When to stop

Only these end a release before it publishes. Each ends with a report: what failed, what was tried,
what decision is needed.

- **A fix needs the maintainer's decision**: a major upgrade (other than one clearing an advisory —
  [step 5](#5-sweep-the-dependencies--the-release-branchs-first-commit)), an advisory
  reaching what ships that its upgrade cannot clear, a requirement that has to change (a
  supersession), a test that would have to be weakened or benched.
- **The same failure survives three fix attempts.** Three different fixes for one symptom means the
  diagnosis is wrong; stop rather than thrash.
- **Something outside the repo is down**: GitHub Actions, npm, the Pages deployment, after a re-run.
- **The tree has uncommitted work that isn't yours** (preflight). It is the user's; never stash it.
- **A guard refuses a change the release needs**: applying the `release` Environment's setting, or
  the force-push after a rebase. Report exactly what was refused; never route around it.

## Settle the version first

**One authoritative version: `version` in the root `package.json`.** Everything else derives from it,
and four values must agree at publish time — installer filename, package version, the version the
installed app reports, and the tag.

Never ask. The rule (065 FR-006):

| Request | Version |
|---|---|
| Names one — "release alpha15", "ship 1.0.0-rc.1", "release 1.0.0" | Exactly that, suffix included. |
| Names none — "do a release", "the next alpha", "release the current work" | The next on the current track: `1.0.0-alpha14` → `1.0.0-alpha15`. |
| "The next beta" / "the next rc" | `beta1` / `rc.1` if that track has not started, otherwise its successor. |

The current version is the highest published tag (`gh release list`), not the manifest — a failed
release can leave the manifest ahead. A version with no prerelease suffix is released **only when
named**: it publishes as the repository's *latest* release and the install docs point people at it.
State the version in the first progress line.

How prerelease suffixes are compared and published: [references/versioning.md](references/versioning.md#prereleases).

## The shape of it

```
preflight → branch → dependency sweep (own commit) → CHANGELOG → version bump → docs
  → test-suite audit → local checks → commit → PR → gate.yml (full) → merge → tag
  → release.yml (full E2E → package → reconcile → verify ×9 combinations → coexistence
  → render body → sign → publish → repositories) → target milestone's description
any failure → fix (own PR, merged) → back to the earliest step the fix invalidates
```

Publication is refused unless all five conditions in
[`docs/releasing.md` → What fails a release](../../../docs/releasing.md#what-fails-a-release) hold.
There is no override path; how they are evaluated is
[references/publishing.md](references/publishing.md).

## 1. Preflight

```sh
git status --porcelain -uall     # must be empty
git fetch origin --tags
git log --oneline origin/master -1
git tag --sort=-creatordate | head -5
gh release list --limit 5
node scripts/release-preflight.mjs   # exit 0, or a line for each thing to fix
```

- **Every line `release-preflight` prints is yours to fix, before the version is settled. Do not ask.**
  (065 FR-013.) Exit 2 means it could not read the facts: an outside fault, retried once.
  - `[master]` is a red `release.yml`, a red full gate, a green only on a re-run, or an open nightly
    issue. Treat it as a [failure to fix](#12-fix-and-go-again); a flake gets a real fix, with the
    issue closed by its PR. Then `gh workflow run gate.yml --ref master`, wait for that gate and the
    fix's own `release.yml` run on master, and run the preflight again.
  - `[environment]` means the `release` Environment drifted from 065 FR-005. Apply it yourself: `PUT`
    `repos/{owner}/{repo}/environments/release` with no reviewers and `custom_branch_policies: true`,
    then `POST` `v*` (type `tag`) to its `deployment-branch-policies`. A guard refusing that is a
    [stop](#when-to-stop). Never approve a waiting deployment.
- The tree must be clean. Uncommitted work belongs to the user — never stash or discard it to make a
  release tidy; stop and report it.
- `master` must be the release base and must be up to date with `origin/master`.
- The version must not already be released. A published version is immutable and the publish gate
  refuses to re-publish one. A tag whose release never published is a failed attempt, not a release:
  see [Re-cutting an unpublished tag](#re-cutting-an-unpublished-tag).
- A release ships what is on `master`. Open PRs are not waited for, and the release says nothing to
  them.

## 2. Branch

Never commit release prep to `master` directly.

```sh
git switch -c release/v<version> origin/master
```

`release/v<version>` is the established name (`release/v1.0.0-alpha4` was alpha4's). Its first commit
is the dependency sweep (step 5), and the release commit goes on top of it. Work
in the main checkout rather than a fresh worktree: the local checks need an installed `node_modules`,
which a bare worktree would have to build from nothing.

## 3. The release notes are `CHANGELOG.md`, and they are written before the tag

The pipeline reads the section for the version being published and puts it above a fixed footer. It
**never writes prose and never falls back** to another version's notes, so the diff on this file is
the review that matters.

1. **Sweep for what is missing.** The `## Unreleased` section accumulates as work merges, but it is
   routinely incomplete — alpha4's was missing an entire feature. Reconcile it against what actually
   landed:

   ```sh
   git log --oneline v<previous>..origin/master
   gh pr list --state merged --limit 30 --json number,title,mergedAt
   gh issue list --state closed --limit 50 --search "closed:>=<date-of-previous-tag>"
   ```

   Anything a user would notice and cannot find in `## Unreleased` gets an entry.

2. **Rename the heading and put a fresh one back, in the same edit.**

   ```
   ## Unreleased          →     ## Unreleased
                                 
                                ## <version> — <YYYY-MM-DD>
   ```

   The empty `## Unreleased` above it is load-bearing:
   `packages/ui/tests/unit/release-notes-cli.test.ts:97` asserts the file carries one. alpha4 shipped
   the rename on its own and needed a follow-up commit (`cf559f42`) to put the heading back — do both
   at once.

3. **Write entries the way the parser and the reader both need.** `### Added` / `### Fixed` /
   `### Changed` / `### Removed` / `### Known issues`; `-` list items, one line each, in user terms
   rather than commit terms, each linking the issue it closes. A release with genuinely nothing
   user-visible carries exactly one line — `- No user-visible changes in this release.` Anything else
   empty is a refusal, so an unwritten changelog cannot pass as an uneventful release.

4. **The date is the date it will publish**, in `YYYY-MM-DD`. Get it from `date "+%Y-%m-%d"`, not
   from memory.

## 4. The version bump — one decision, eight files

The root manifest is the decision; every workspace and the lockfile follow it, and
`packages/core/tests/contract/product-version.contract.test.ts` fails the build if any disagrees.

```sh
npm version <version> --workspaces --include-workspace-root --no-git-tag-version
```

That rewrites the root and all six workspace manifests. Confirm the lockfile moved with them —
`git diff --stat` must show `package-lock.json` alongside the seven manifests; if it did not, run
`npm install --package-lock-only` and check again.

Nothing else carries the version, and it is **not** `BUILD_ID` — how each process reads it, and
why the two differ: [references/versioning.md](references/versioning.md).

## 5. Sweep the dependencies — the release branch's first commit

**Run this straight after cutting the release branch** — it is numbered 5 for history, not order.
Every release sweeps (065 FR-007): an advisory found after the tag costs the whole pipeline.

The sweep is a **commit of its own** on `release/v<version>`, before the release commit, and reaches
master in the release PR — never a PR of its own, so a release waits on one PR, not several (065
FR-007, amended 2026-11-12). Keeping it a separate commit is what stops a dependency failure reading as
a release failure: the release PR rebase-merges, so the sweep lands on master as its own commit.

On the release branch:

```sh
npm audit                      # 0 vulnerabilities is the bar, not "none critical"
npm outdated                   # current / wanted / latest
```

**Fix every advisory.** `npm audit fix` where it stays in range; a minor or patch upgrade where it does
not.

**An advisory whose only fix is a major: attempt the major, and prove it** (065 FR-007a). For a
transitive package, a version-scoped `overrides` entry lifts only the affected line —
`"minimatch@>=7.0.0 <11.0.1": "^11.0.5"` was alpha15's (PR #595). Read the major's changelog for
removed APIs and grep the consumers for them, run the local checks, and compare before and after
whatever the package governs: for a packaging tool, build the Linux unpacked tree under each version
and diff the file lists (`stage:runtime` needs an official Node — the installed throng's
`resources/runtime/node` will do). If it holds, it ships in this sweep.

**If it fails, or the advisory has no fix** (065 FR-007b), ask what reaches it:
`npm ls <package> --omit=dev`.

- **Empty — development tooling only**: roll the attempt back, accept the advisory, carry on, and
  name it in the final report with what was tried, why it failed and a corrective action (wait for
  the consumer's release that takes the fix, file an upstream issue, replace the tool). Not a stop.
- **Anything listed — it ships**: a [stop](#when-to-stop). Name the package, the severity and what
  reaches it.

A major taken here that fails later — the gate, `release.yml`'s packaging or verification — is removed
from the sweep commit (amend it, then rebase and force-push the release branch as in
[fix and go again](#12-fix-and-go-again) step 4), and the advisory is then accepted or stops the
release by the same test.

**Take every patch and minor update, leave the majors.** `npm update --save` takes what each declared
range already allows; `npm-check-updates --target minor` raises ranges that stop short of the latest
minor (`~`, exact pins):

```sh
npm update --save
npx --yes npm-check-updates --target minor --upgrade --workspaces --root
npm install
npm audit                      # again, on the tree that will ship
```

**Then commit it on the release branch.** Run the local checks below and commit with **git-commit**
(`chore(deps): Take patch and minor updates before <version>`). The release PR's checks and the full
gate (step 9) prove it with everything else. A local check that fails is a
[failure to fix](#12-fix-and-go-again): a defect the update exposes is fixed through its own PR as
usual, while a package that will not hold is pinned back by an `overrides` entry inside the sweep
commit and named in the release PR. A sweep with nothing to take (no advisory, nothing outdated within
range) makes no commit.

Two traps, both from the alpha5 run:

- **`npm update --save` rewrites the workspaces' internal `@throng/*` references from `"*"` to a
  concrete range.** That is monorepo wiring rather than a dependency range, and pinning it means
  rewriting six manifests on every version bump. Put them back to `"*"` and re-run `npm install`
  before you commit — `git diff -- packages/*/package.json | grep @throng` is the check.
- **A major upgrade does not belong on a release branch** (except one clearing an advisory, above).
  ESLint 10, TypeScript 7, Vitest 5, Electron 44 and their kind each deserve their own PR and their
  own gate, because the failure mode is discovering at tag time that one of them does not hold. List
  them in the release PR as deliberately deferred, and in the final report.

`better-sqlite3` 13 carries one N-API prebuild per platform inside the package, with no install step
(#520). `electron-builder.yml` excludes the platforms throng does not ship. A new platform or
architecture means deleting its exclude there, or the packaged daemon cannot open its database.

**Prove it locally before committing, because native code moved.** Electron and `koffi` ship binaries the
daemon loads under the bundled host-Node runtime, so a patch bump is not a no-op. The OS-heavy layers
are proved by the release's full gate (step 9), which runs on the tree this sweep leaves:

```sh
npm run build && npm run typecheck && npm run lint
npm run test:unit && npm run test:component
```

Capture the output to a scratch file rather than filtering it — the **running-tests** skill owns
how. If anything moved that a user would notice, it gets an entry in this release's changelog section; a
patch sweep that clears no advisory and changes no behaviour needs no entry, and saying so in the
commit message is enough.

## 6. Documentation currency — the step that gets skipped

The constitution requires the docs to be current with any user-facing, setup, architecture or
capability change, and a release is the last place that debt can be repaid cheaply. Do it on the
release branch, **before the gate and the tag**.

**Load the `throng-docs` skill and run its audit** — it owns what each doc must hold and how to check
it. Say in the PR which files needed nothing.

Two things the audit does not cover, because they belong to this skill:

- If the *pipeline itself* changed this cycle, this skill and its `references/` move in the same
  change (see [Keeping this skill true](#keeping-this-skill-true)).
- Every configurable option added this cycle is named in the changelog entry.
- `README.md`'s badges match what this release ships. A platform, architecture or package channel
  added or dropped this cycle gets its badge added or removed. The latest-release badge is never
  hand-edited: shields reads it from the release, and step 13 checks it moved. `docs-currency.test.ts`
  guards its query and the per-platform badges.

## 7. Test-suite audit — keep the runs from growing out of hand

Every release audits the test suite, so its cost is looked at once a cycle rather than when CI has
already become slow. Do it on the release branch, alongside the docs audit, **before the gate**.

1. **Measure.** `td` (test-discipline) runs every layer through `.test-discipline/adapters.json`.
   Record a fresh smoke-tier run per vitest runner — `td run --runner <unit|component|integration|contract> --tier smoke --no-bail` —
   and read the E2E stage and per-job durations from the last green `gate.yml` run. Never run the E2E
   suite locally for this.
2. **Audit.** Dispatch the `test-discipline:test-auditor` agent, per the `writing-tests` skill's
   `references/suite-audit.md` (*Dispatching the audit*). For a large suite, segment it into disjoint
   file sets (by layer, and the E2E specs by category tag) and run one auditor per segment in parallel.
3. **Report, don't apply.** Put the findings in the release PR description under **Test-suite audit**:
   the per-layer counts and wall-clock against the last release's, each tier against its `td` budget,
   and the proposed actions (delete, move down a layer, share setup, re-tier) with predicted savings.
   Applying them is ordinary work on its own branch after the release, never part of the release
   commit — the release ships the tree the gate tested.
4. **Carry the proposals into the final report**, not a question mid-release. A suite that grew since
   the last release, or a tier newly over budget, is listed first. Nothing waits on them.

## 8. Prove it locally before spending a runner

```sh
npm run build                                                   # release-notes.mjs imports @throng/core
node scripts/release-notes.mjs render --version <version>       # exit 0, and READ what it prints
npx vitest run --project contract product-version
npx vitest run --project unit release-notes-cli
npm run lint
```

`render` exits 2 when there is no section for that version, 3 when the section is empty. Either means
the publish job would refuse — find out here, not after a tag.

Read the rendered body rather than only its exit code. It is what ships.

## 9. Commit, PR, gate, merge

Author the commit message into a file and use `git commit -F` — never `-m`, which lets the shell eat
backticks and `$(…)` from the message while the commit succeeds. Follow the **git-commit** skill.

Precedent for the subject: `chore(release): <version>, with its changelog section`.

The body says what the reader needs: that the bump touches the same manifests by the same mechanism,
that it must land **before** the tag because the publish gate compares filename == package ==
verdict == tag, and what the release carries over the previous one.

```sh
git push -u origin release/v<version>
gh pr create --title "chore(release): <version>" --body-file <file>      # not a draft: CI must run
```

Then **the full gate — every release, no exceptions** (065 FR-008). CI's lanes run on the PR, but
`gate.yml` is what establishes done-ness:

```sh
gh workflow run gate.yml --ref release/v<version>
gh run watch <run-id> --exit-status                              # one blocking watch
gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
```

Take the verdict from `run view`. `gh run watch` detaches early and its exit code lies in both
directions. If `status` is not `completed`, the watch gave up and the run is still going.

Merge once the gate is green and the PR's required checks pass on the head commit:
`gh pr merge <n> --rebase` (merge commits are disabled). Any red is a [failure to fix](#fix-and-go-again).
A change to the release branch after a green gate needs the gate again, unless the tree is unchanged
(`git diff --stat <green-sha> HEAD` empty).

## 10. Tag

The tag is cut on `master`, after the merge, and pushing it is what starts the release.

```sh
git switch master && git pull
git log -1 --oneline                                 # the release-prep commit
git tag -a v<version> -m "throng v<version>"
git push origin v<version>
```

Never force-push a tag, and never move one that has published. The tagged commit must be on `master`:
`sign-index` and `publish` refuse any other (065 FR-003).

### Re-cutting an unpublished tag

A tag whose `release.yml` run failed **before `publish` created the release** was never released, so
the version is still free (065 FR-011). Once the fix has merged and the release branch is rebased and
re-gated:

```sh
gh release view v<version> >/dev/null 2>&1 && echo "PUBLISHED: cut the next version instead"
git push origin --delete v<version> && git tag -d v<version>
# then step 10 again, on the new master commit
```

If `publish` created the release, the version is spent: the fix goes into the next version. A failure
in `deploy-repositories` alone never needs a re-cut — re-run that job.

## 11. Watch `release.yml`

```sh
gh run list --workflow release.yml --limit 3
gh run watch <run-id> --exit-status                              # one blocking watch, ~1.5 h
gh run view <run-id> --json status,conclusion,jobs --jq '{status,conclusion,failed:[.jobs[]|select(.conclusion=="failure")|.name]}'
```

**Two runs start, not one.** `release.yml` triggers on a push to `master` and on a `v*` tag, so the
merge and the tag each fire one. They do not cancel each other — the concurrency group is keyed to
the ref. The `master` run does everything except publish and is pure duplication; it is free on a
public repo, so leave it unless runner minutes are being watched. **Take every verdict from the tag
run**, which is the one carrying the publish job.

The jobs, each gating the next (`needs` in brackets):

1. **E2E (full suite)** `e2e-full` — everything except `@core`'s 50; one worker, no shards. A red
   suite means no artifact. **`e2e-reuse` omits it** when a full gate was green at its first attempt
   on this exact tree (065 FR-014), the normal case once step 9's gate has passed and the release PR
   has rebase-merged onto an unmoved master. The job summary names the gate it took the verdict from.
2. **Work out the verification matrix** `combinations` (ubuntu, beside the E2E) — emits
   `artifact-set.mjs list --combinations --json`.
3. **Build the release artifacts** `build-installer` [e2e-full] — `npm run package`, then
   `artifact-set.mjs reconcile`, which fails in **both** directions: a declared artifact that was not
   built, and a built artifact nobody declared. Four uploads (`throng-setup`, `throng-msi`,
   `throng-portable`, `throng-archive`); a guard step fails if the declared roles and the uploads
   differ. ~5 min.
4a. **Build the Linux packages** `build-linux` [e2e-full] and **Verify `deb`/`rpm`/`tarball`** `verify-linux` ×3 —
   on `ubuntu-22.04` and `ubuntu-24.04`, the `.rpm` in a Fedora container. `render-body` and `publish` need both.
   Detail: [references/verification.md](references/verification.md#linux).
4. **Verify `<combination>`** `verify-installer` ×6 [build-installer, combinations] — one fresh runner
   per combination, `fail-fast: false`, 40-minute timeout. Each installs (or extracts, or unpacks),
   launches, version-checks, journey-tests (project → terminal → reopen → reattach), checksums and
   removes, plus the scope steps in [references/verification.md](references/verification.md#scopes-add-steps).
   Uploads `verdict-<id>`.
5. **Verify coexistence** `coexistence` [build-installer, verify-installer] — only when the whole
   matrix is green. Uploads `verdict-coexistence`.
6. **Render the release body** `render-body` [all of the above, `!cancelled()`] — runs the gate
   (any refusal fails it), writes `unproven` steps to the job summary, and uploads `release-body`
   (`release-body-preview.md` + `verification-gaps.json`).
7. **Sign the repository indexes** `sign-index` — tag runs only. Refuses a tag not on `master`, then
   builds, signs and uploads the `repo-index-bundle` run artifact. No approval.
8. **Publish** [… , sign-index] — tag runs only, the same on-`master` check, then ~3 min to
   compute the checksums, compose the body and create the release with the signed
   `throng-repo-index-<version>.tar.gz` attached. It has to go in at creation: the repository has immutable releases
   on, so nothing can be added afterwards (#571, which is why v1.0.0-alpha13 never reached the repositories).
9. **Update the package repositories** `deploy-repositories` [publish] — dispatches `pages.yml` on `master`. If it
   failed, the release is out and the repositories are on the previous version: re-run the failed job.

**Verify the repository** `verify-repositories` ×2 [build-linux] is one more gate on `publish`: the apt and dnf routes on
clean machines, with a throwaway key. What it proves: [`docs/releasing.md`](../../../docs/releasing.md#the-package-repositories).

**What a passing verdict looks like**, so a skipped check is not mistaken for a clean one. The
vocabulary is 19 steps. Applicable counts: `setup-user` **15**, `msi-user` **15**, `setup-machine`
**18**, `msi-machine` **17**, `portable`, `archive` and `tarball` **8** (11 `not-applicable`), `deb` and `rpm` **13** (6 `not-applicable`). The coexistence
verdict has **5** copies and **7** steps, all `passed`. `second-account` and `not-elevated-launch` are expected to read
`unproven` on hosted runners — the GUI half is never attempted there, and the runner's desktop is high integrity; the daemon half carries the
proof, and both gaps are listed in the body. Any other shape deserves a look: a `not-applicable` on an
installer combination, `unproven` on any other step, or fewer results than the counts above is a
check that did not run.

```sh
gh run download <tag-run-id> --pattern 'verdict-*' --dir <scratch>
gh run download <tag-run-id> --name release-body --dir <scratch>
```

Those carry the ten verdicts and `release-body-preview.md`. Read them when a job fails, and summarise
them in the final report.

The declared roles are listed in
[`docs/releasing.md` → The artifact set](../../../docs/releasing.md#the-artifact-set); why nothing
globs or resolves by extension is [references/artifact-set.md](references/artifact-set.md). What
each verification step proves, and the four-outcome verdict model, is
[references/verification.md](references/verification.md).

## 12. Fix and go again

**Any failure — a local check, a required check, the gate, a `release.yml` job — is diagnosed, fixed
through its own PR, and the release resumes** (065 FR-009). Nothing is handed back unless a
[stop condition](#when-to-stop) holds.

1. **Read the failure from its log**, not its summary: `gh run view <id> --log-failed`, captured to a
   scratch file (**running-tests**). Name the job, the step and the line.
2. **Classify it.** A flake gets the **throng-testing** skill's treatment — a test that fails then
   passes is a defect, fixed, never re-run into green. A product, test or pipeline defect gets a fix.
   An infrastructure fault (runner lost, network, GitHub outage) gets **one** re-run of that job:
   `gh run rerun <id> --failed`.
3. **Fix it on its own branch** from `origin/master` (**branch-naming**; a bug gets **replicating-bugs**'
   failing test first, without waiting for confirmation — the release request is the go-ahead), PR it
   as a non-draft, wait on its required checks, and `gh pr merge --squash` once green. Never fix it on
   the release branch: the release commit carries only the release.
4. **Resume from the earliest step the fix invalidates.** The release branch is always rebased on
   `origin/master`, never merged with it: rebase it, re-run step 8's local checks, push with
   `git push --force-with-lease origin release/v<version>` as a command of its own (nothing chained,
   never a bare `--force`), and re-run the full gate (step 9). If a tag was already pushed,
   [re-cut it](#re-cutting-an-unpublished-tag).
5. **Count attempts per failure.** The third fix for the same symptom that still fails is a stop.

Every fix PR and its link goes in the final report.

## 13. After it publishes

```sh
gh release view v<version> --json name,isPrerelease,assets,publishedAt \
  --jq '{name, isPrerelease, assets: [.assets[].name]}'
```

Confirm, and report:

- seven assets attached (setup, MSI, portable, archive, `.deb`, `.rpm`, `.tar.gz`), named for this version, plus the
  `throng-repo-index-<version>.tar.gz` bundle, which is not part of the declared set;
- `isPrerelease: true` for any version carrying a suffix;
- `https://throng-ide.com/apt/dists/<channel>/InRelease` names this version's channel, and its `Packages` this version;
- at the first full release, `docs/install-linux.md`'s commands change from `prerelease` to `stable`;
- the body carries this release's notes, one SHA-256 row per artifact against its own filename, and
  the source revision;
- `## Unreleased` is back on `master`, empty, ready for the next cycle;
- `README.md`'s latest-release badge reads `v<version>`. Render the badge URL from `README.md` and read
  the SVG's `<title>`. Shields caches the answer, so allow it up to an hour. Still the previous version
  after that means the badge's query is wrong, not the cache (`sort=semver` once pinned it to alpha9:
  semver compares `alpha16` and `alpha9` as text). Fix it through its own PR.

**Then bring the target milestone's description up to date.** The target is the milestone the version
releases toward: the version without its prerelease suffix (`1.0.0-alpha16` → `v1.0.0`). Load
**milestone-planning** and run its *Sync the description* step on that milestone. That skill owns the
format and when a box is ticked, which keeps the description to headline goals with the detail left in
the milestone's issue list. Unattended rules apply here too: settle each unlisted issue by that
format, never by asking, and move no issue. Put any move it suggests in the final report. A full release
that closes its milestone also runs that skill's *a milestone is about to be closed* sync first, as this
skill stands in for `release-manager` in its table.

Then say it plainly, in one report: the version, the release URL, the gate run URL, the release run URL,
the milestone's changed lines and any suggested issue moves,
the fix PRs (links), what the sweep took and held back, majors deliberately deferred, majors taken to clear an
advisory, any dev-only advisory accepted (with its failed attempt and a suggested corrective action),
the test-suite audit proposals,
and anything left undone. Send a `PushNotification` with the version and release URL.

## When something breaks

| Symptom | What it means | What to do |
|---|---|---|
| `release-notes` exits 2 | No `## <version>` section | The heading does not match the version exactly — check the suffix and the em-dash form. |
| `release-notes` exits 3 | Section is empty | Write entries, or the single literal "no user-visible changes" line. |
| `reconcile` names an unexpected filename | A target's output changed | Fix `electron-builder.yml`'s `artifactName`. **Never** loosen the declaration. |
| `reconcile` names a missing artifact | A target did not run | Read the packaging log; do not publish a partial set. |
| Publish gate: "verdict missing" | A role verified but its verdict was not uploaded, or a role was skipped | A partial verdict set is a refusal, not a partial pass. Re-run verification. |
| A tag run is green, but `sign-index`, `publish` and `deploy-repositories` show **skipped** | A publishing job lost its status function, so GitHub's implicit `success()` skipped it behind the skipped `e2e-full` (the E2E verdict was reused). alpha16's first tag did exactly this | Nothing was released, so [re-cut the tag](#re-cutting-an-unpublished-tag) after the fix. A green tag run proves nothing until `gh release view v<version>` finds the release. |
| `sign-index` or `publish`: "is not on master" | The tag was pushed on a commit outside `master` | Merge the release PR, then [re-cut the tag](#re-cutting-an-unpublished-tag) on the merged commit. |
| Publish gate: version mismatch | The four-way match failed | Tag, manifest, filename and reported version must agree exactly, suffix included. |
| Publish gate: already published | The version exists | Published bytes are immutable. Cut the next version; never delete and re-push a published tag. |
| A single E2E fails in the full lane | Possibly a flake | The **throng-testing** skill owns this. The lane retries once only on an infrastructure fault (0 unexpected, 0 flaky). |
| Verification fails locally but passes on CI | Almost always the harness colliding with your session | The launch probe needs its own `--user-data-dir`; the residue scan attributes processes by path. See [references/verification.md](references/verification.md#running-it-on-a-developer-machine). |
| Publish gate or render-body: `<combination>: no verification verdict` | That matrix leg failed before writing, or was cancelled | Read that leg's log; a partial set is a refusal. |
| `coexistence: no verification verdict` | The coexistence job exited 2: the runner had a `%APPDATA%\throng` | Never on a clean runner; locally pass `--allow-dirty-profile`. |
| `nsis-vendored-templates.test.ts` fails after a dependency bump | electron-builder moved | Re-diff `packaging/nsis/*` against the new upstream templates, then update `UPSTREAM.md`'s pins. Never just re-pin. |
| MSI packaging: "anchor not found" from `msi-project.ts` | electron-builder's MSI template changed | Re-capture `msi-template-output.wxs` and repair the transform; never drop it. |
| `setup-machine: silent-elevation-refused` fails | `/S /allusers` did not exit `740`, or installed something | The silent no-elevation branch in `packaging/nsis/multiUserUi.nsh`. |
| `*-machine: in-use-upgrade` fails | No `3010`, a process was terminated, or no pending renames | The installers' in-use path (`packaging/in-use.mjs`, `installSection.nsh`, the MSI's `MSIRESTARTMANAGERCONTROL`). |
| `*-machine: not-elevated-launch` fails | The run-after-finish app ran elevated — or another throng was already running on the runner | Setup: `ExecShellAsUser`; MSI: the `explorer.exe` launch. |
| The portable role fails verification | Three known traps | Copy the unpacked tree *before* stopping the launcher, wait for it to settle, and pass **no** `PORTABLE_EXECUTABLE_*` variables. Why: [references/verification.md](references/verification.md#the-portable-role). |

**Rehearsing without releasing** — every dispatch is a rehearsal: it runs the full suite, packages,
reconciles, verifies every artifact and renders the body, releasing nothing:

```sh
gh workflow run release.yml --ref master
```

Use it when the pipeline itself is what is being fixed.

When only the installers or the verification harness are being fixed, add `-f skip_e2e=true`: it
leaves out the full E2E suite and the build and verification jobs still run. `gate.yml`
already runs that suite on the same tree. The publish job refuses to run when `skip_e2e` is set, so a
release can never follow a skipped suite:

```sh
gh workflow run release.yml --ref <branch> -f skip_e2e=true
```

## Never

- **Never publish by hand.** No manual upload, rename or copy of an artifact; no `gh release create`
  outside the pipeline. The checksum is computed as the last step that reads the bytes, and a
  hand-uploaded file breaks that binding.
- **Never delete a published release or move its tag** to retry. Cut the next version. An unpublished
  tag may be re-cut ([how](#re-cutting-an-unpublished-tag)).
- **Never ask mid-release.** Not for the version, a sign-off, a merge or a re-run. Only a
  [stop condition](#when-to-stop) ends a release before it publishes.
- **Never skip the full gate** on a release commit, and never merge or tag on a red or stale one.
- **Never write release prose in the workflow or the release body.** It comes from `CHANGELOG.md` or
  it does not exist.
- **Never publish without the full E2E suite having passed on the released tree**, in `e2e-full` or
  in the full gate `e2e-reuse` found. It is the other half of CI's 50-test `@core` trade; without it
  the reduced surface is a hole rather than a reduction.
- **Never run Prettier in this repo.** There is no config, so it rewrites every string delimiter it
  touches. ESLint is the formatter.
- **Never add an attribution footer or a session link** to a commit message, PR body, release body or
  issue comment.

## Keeping this skill true

The pipeline changes, and a stale runbook is worse than none — it reads as verified. When work lands
that touches `release.yml`, `electron-builder.yml`, `release-artifacts.ts`, `artifact-set.mjs`,
`publish-gates.mjs`, `verify-installer.mjs`, `release-notes.mjs`, `CHANGELOG.md`'s format or the
version guards, update this file and the affected `references/` file in the same PR — and
`docs/releasing.md` too if the overview it gives is no longer true.

Open work that will change this: [#118](https://github.com/Bidthedog/throng/issues/118) code
signing, [#119](https://github.com/Bidthedog/throng/issues/119) automatic update (which must respect
install scope and side-by-side copies), and the package managers — winget
[#509](https://github.com/Bidthedog/throng/issues/509), Scoop
[#510](https://github.com/Bidthedog/throng/issues/510), Chocolatey
[#511](https://github.com/Bidthedog/throng/issues/511). Each adds or changes a role in the declared
set or a step in this runbook.

## Where the detail lives

- `docs/releasing.md` — the maintainer-facing overview: versions, the artifact set, notes, gates,
  publish. The home of the role table and the five refusal conditions.
- `references/` — the reasoning and measurements behind each stage, loaded when that stage is the
  question:
  - [versioning.md](references/versioning.md) — the single version, `BUILD_ID`, prereleases.
  - [artifact-set.md](references/artifact-set.md) — the declaration, `artifact-set.mjs`,
    `reconcile`, what ships inside an artifact, downgrade refusal.
  - [verification.md](references/verification.md) — what is proved, the four-outcome verdict,
    start-up costs, developer-machine caveats, the portable rules, `--keep-residue`.
  - [release-notes.md](references/release-notes.md) — how the body is composed and why it never
    falls back.
  - [publishing.md](references/publishing.md) — how the gates are evaluated, what publication
    does, what runs where, what only a real release proves, adding a reviewer.
  - [signing-and-reproducibility.md](references/signing-and-reproducibility.md) — why a checksum
    and not a signature; the SC-008 claim.
- [build-and-packaging.md](references/build-and-packaging.md) — packaging constraints (`npmRebuild: false`,
  `asar: false`, the bundled host-Node runtime) and the CI shape.
- `specs/020-application-packaging/`, `specs/042-release-notes-and-artifacts/` — the requirements
  behind every refusal above.
- **throng-testing** for a failing or flaky suite; **git-commit** for the commit; **branch-sync**
  for the PR mechanics; **milestone-planning** for the target milestone's description.
