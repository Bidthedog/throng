# Publishing — the gates, what publication does, and what runs where

The five conditions publication is refused on are listed in
[`docs/releasing.md`](../../../../docs/releasing.md#what-fails-a-release) — that is their home. This
file holds how they are evaluated, what a publish does once they hold, and which step runs where.

## How the gates are evaluated

`scripts/publish-gates.mjs` is the CLI `release.yml` calls before it publishes, and
`npm run publish:check` runs it as a local dry-run. It exits 0 when publishing is allowed and
non-zero, naming the unmet condition, when refused. There is **no override path**.

Publishing runs only for a `v*` tag, and nobody approves it (spec 065). `render-body` asks the gate
every condition but "already published" and fails on any refusal, so `sign-index` and `publish` never
start on a release that would be refused. Each of those two jobs then refuses a tag whose commit is not
on `master` (`git merge-base --is-ancestor`) before reading a secret. That check stands in for the
human review: a commit on `master` came through a PR and its required checks. The `release`
Environment keeps `REPO_SIGNING_KEY`, has no required reviewers, and accepts only `v*` tags.

`THRONG_VERDICT_FILES` is derived in the workflow from `artifact-set.mjs list --combinations` (the
verdict-file column) plus the coexistence file — never written out by hand, so a new combination
cannot be left unread. `THRONG_GAPS_OUT` makes the gate write the allowed `unproven` steps for
`release-notes.mjs render --gaps`.

The gate takes its inputs from the environment so CI can supply them — the `THRONG_*` publish-gate
variables are documented in [`docs/environment.md`](../../../../docs/environment.md).

## Adding a reviewer to the `release` Environment

Releases have no reviewer on purpose (065 FR-001, FR-005). Adding one is a change of that decision, so
it takes three things together, or the next release stops at preflight:

1. **Supersede the requirement.** Amend 065 FR-001 and FR-005, recording why.
2. **Change what the preflight expects.** `scripts/release-preflight.mjs` refuses any required
   reviewer, and `SKILL.md`'s preflight re-applies 065 FR-005 when it finds one: change both, with
   `release-preflight.test.ts`, and drop *Never ask mid-release* for this wait. A release then ends
   its turn at the approval and resumes after it.
3. **Apply the setting.** The maintainer runs this; `PUT` replaces the whole configuration, so the tag
   policy's flags are sent again:

   ```sh
   id=$(gh api users/<login> --jq .id)
   printf '{"wait_timer":0,"reviewers":[{"type":"User","id":%s}],"deployment_branch_policy":{"protected_branches":false,"custom_branch_policies":true}}' "$id" \
     | gh api -X PUT 'repos/{owner}/{repo}/environments/release' --input -
   gh api 'repos/{owner}/{repo}/environments/release/deployment-branch-policies' --jq '.branch_policies'   # still v*
   ```

To remove the reviewer again, send the same body with `"reviewers":[]` and undo steps 1 and 2.

What to expect from one:

- **Two approvals per release.** `sign-index` and `publish` each name the Environment and each wait.
  alpha15's tag run took one for each.
- **Leave `prevent_self_review` off** while there is one maintainer: they push the tag, so it would
  leave nobody able to approve.
- **Every `v*` tag is held, prerelease or full.** An Environment cannot tell them apart. To hold only
  full releases, create a second Environment (`release-stable`) with the reviewer, the `v*` tag policy
  and its own copy of `REPO_SIGNING_KEY`, and have both jobs choose by the tag — a prerelease tag
  carries a `-`:

  ```yaml
  environment: ${{ contains(github.ref_name, '-') && 'release' || 'release-stable' }}
  ```

  Swap the two names to hold only prereleases. The preflight then checks both Environments.

## What publication does

When all five hold, publication:

- computes **each artifact's SHA-256 as the last step that reads its bytes**, so a checksum and its
  artifact can never disagree;
- creates a **GitHub Release** for the version carrying **every** artifact and the composed notes,
  records the **exact source revision** it was built from, and **refuses to re-publish** a version
  that already exists (a published artifact is immutable);
- requires **no manual copying, renaming, or uploading** of anything.

## What runs where

| Step | Where it runs |
|---|---|
| Write the release notes | The `throng-release` runbook, in `CHANGELOG.md`, **before the tag** — committed in the release PR. |
| Bump version, build, package | Locally or in CI (`npm run build`, `npm run package`). |
| Reconcile the artifact set | Wherever packaging ran, immediately after it. |
| Artifact verification (clean machine) | **CI** — one fresh `windows-2022` runner per combination (matrix), then the coexistence job. Runs locally too, with the caveats in [verification.md](verification.md#running-it-on-a-developer-machine). Never install on the workstation by hand. |
| Render the release body | CI, the `render-body` job, after every verdict exists; uploaded with `verification-gaps.json`. It runs the gate and fails on any refusal, before anything is signed. |
| Publish the GitHub Release | **CI only**, a `v*` tag on `master`, unattended. |
| Sign the repository indexes | **CI only**, `sign-index`, on the same condition. The only job that can read `REPO_SIGNING_KEY`. |
| Update the package repositories | **CI only**, `deploy-repositories`, after the release is out. It uses no key, and dispatches `pages.yml` on `master`. |

## One thing only a real release can prove

The publish job runs only on a version tag, so the `gh release create` call itself, the on-`master`
check and the prerelease flag are not reachable from an ordinary push. Everything upstream of them is
— a `workflow_dispatch` builds, reconciles, verifies every artifact and renders the body, and never
publishes. Use that as the rehearsal (the command is in
[`SKILL.md`](../SKILL.md#when-something-breaks)); see
[spec 042's plan](../../../../specs/042-release-notes-and-artifacts/plan.md) for the full breakdown
of what each tier can and cannot establish.

## Requirements behind it

020 FR-028 / FR-031 / FR-034 in
[`specs/020-application-packaging/spec.md`](../../../../specs/020-application-packaging/spec.md);
[`specs/042-release-notes-and-artifacts/`](../../../../specs/042-release-notes-and-artifacts/).
