# Publishing — the gates, what publication does, and what runs where

The five conditions publication is refused on are listed in
[`docs/releasing.md`](../../../../docs/releasing.md#what-fails-a-release) — that is their home. This
file holds how they are evaluated, what a publish does once they hold, and which step runs where.

## How the gates are evaluated

`scripts/publish-gates.mjs` is the CLI `release.yml` calls before it publishes, and
`npm run publish:check` runs it as a local dry-run. It exits 0 when publishing is allowed and
non-zero, naming the unmet condition, when refused. There is **no override path**.

Publishing runs only from the reviewed default branch. The four cheap, deterministic conditions are
evaluated **before** the human one, so a release that was never going to publish does not first
consume an approval. The human QA sign-off is a **GitHub Environment (`release`) with required
reviewers**; it cannot be satisfied by automation, a default, or the passage of time.

`THRONG_VERDICT_FILES` is derived in the workflow from `artifact-set.mjs list --combinations` (the
verdict-file column) plus the coexistence file — never written out by hand, so a new combination
cannot be left unread. `THRONG_GAPS_OUT` makes the gate write the allowed `unproven` steps for
`release-notes.mjs render --gaps`.

The gate takes its inputs from the environment so CI can supply them — the `THRONG_*` publish-gate
variables are documented in [`docs/environment.md`](../../../../docs/environment.md).

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
| Write the release notes | A human, in `CHANGELOG.md`, **before the tag** — reviewed as a diff. |
| Bump version, build, package | Locally or in CI (`npm run build`, `npm run package`). |
| Reconcile the artifact set | Wherever packaging ran, immediately after it. |
| Artifact verification (clean machine) | **CI** — one fresh `windows-2022` runner per combination (matrix), then the coexistence job. Runs locally too, with the caveats in [verification.md](verification.md#running-it-on-a-developer-machine). Never install on the workstation by hand. |
| Render the release body | CI, the `render-body` job, after every verdict exists; uploaded with `verification-gaps.json` for the approver to read. It runs the gate without the sign-off and accepts exactly one refusal — the missing sign-off — so any other refusal fails it before anyone is asked. |
| QA sign-off | A human, via the GitHub `release` Environment. |
| Publish the GitHub Release | **CI only**, gated as above. |

## One thing only a real release can prove

The publish job runs on a version tag (or an explicit dispatch), so the `gh release create` call
itself, the Environment approval and the prerelease flag are not reachable from an ordinary push.
Everything upstream of them is — a `workflow_dispatch` with `publish: false` builds, reconciles,
verifies every artifact and renders the body. Use that as the rehearsal (the command is in
[`SKILL.md`](../SKILL.md#when-something-breaks)); see
[spec 042's plan](../../../../specs/042-release-notes-and-artifacts/plan.md) for the full breakdown
of what each tier can and cannot establish.

## Requirements behind it

020 FR-028 / FR-031 / FR-034 in
[`specs/020-application-packaging/spec.md`](../../../../specs/020-application-packaging/spec.md);
[`specs/042-release-notes-and-artifacts/`](../../../../specs/042-release-notes-and-artifacts/).
