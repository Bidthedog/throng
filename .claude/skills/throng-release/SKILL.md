---
name: throng-release
description: Cut a throng release end to end — settle the version, write the release notes into CHANGELOG.md, bump the root manifest and the six workspaces that follow it, audit the dependencies, bring the docs current, gate it, tag it, watch release.yml build and verify all three artifacts, and publish behind the human QA sign-off. USE THIS EVERY TIME a release is in play, whatever words are used — "do a release", "cut alpha5", "ship 1.0.0-rc.1", "release this", "tag a new version", "publish the build", "get an installer out", "bump the version", "prepare release notes", "what's in the next release", "the release pipeline failed", "the publish job is stuck", "re-run the release", "why was publishing refused" — and reach for it even when only one part is named, because the parts bind to each other through a four-way version match that fails late and loudly. Do NOT guess the version: if the request does not name one unambiguously, ask before touching a file. This skill OWNS releases in this repository and supersedes the generic github-workflow:release skill and release-manager agent, which know nothing about throng's declared artifact set, its CHANGELOG-derived notes, or its five publish gates.
---

# Releasing throng

`docs/releasing.md` explains *why* the pipeline is shaped the way it is and is worth reading once.
This is the running order, the commands, and the things that have actually gone wrong.

## Settle the version first

**One authoritative version: `version` in the root `package.json`.** Everything else derives from it,
and four values must agree at publish time — installer filename, package version, the version the
installed app reports, and the tag. A wrong guess here is not caught until the gated job.

Ask the user unless the request settles it beyond doubt:

- "release alpha5" with `1.0.0-alpha4` current → `1.0.0-alpha5`. Clear enough; say which version you
  read it as, then proceed.
- "do a release", "ship the milestone", "cut a new version", "release the current work" → **ask**.
  Offer the obvious successor, and the alternatives that fit (`1.0.0-rc.1`, `1.0.1`).
- Anything that would leave the prerelease track (`1.0.0` itself) → **ask**, always. A version with
  no prerelease suffix publishes as the repository's *latest* release and the install docs point
  people at it.

Prereleases use a SemVer suffix (`1.0.0-alpha5`, `1.0.0-rc.2`) and publish as GitHub prereleases.
The suffix is part of the version's identity and is compared exactly; it does not affect
upgrade/downgrade ordering, which compares `MAJOR.MINOR.PATCH` only.

## The shape of it

```
preflight → branch → CHANGELOG → version bump → dependency audit → docs
  → local checks → commit → PR → gate.yml → merge → tag → release.yml (full E2E
  → package → reconcile → verify ×3 → render body) → human sign-off → publish
```

Publication is refused unless five things hold — a real version, a reconciled artifact set, a
passed verdict for **every** artifact, notes bound to this exact version, and a recorded human
sign-off. There is no override path. The four cheap ones are evaluated before the human one, so a
doomed release does not first consume an approval.

## 1. Preflight

```sh
git -C D:/git/throng status --porcelain -uall     # must be empty
git -C D:/git/throng fetch origin --tags
git -C D:/git/throng log --oneline origin/master -1
git tag --sort=-creatordate | head -5
gh release list --limit 5
```

- The tree must be clean. Uncommitted work belongs to the user — never stash or discard it to make a
  release tidy; stop and report it.
- `master` must be the release base and must be up to date with `origin/master`.
- The version must not already be tagged or released. A published version is immutable and the
  publish gate refuses to re-publish one.
- Check what is in flight: `gh pr list --state open`. Anything the user expects *in* this release
  must be merged before the changelog is written, not after.

## 2. Branch

Never commit release prep to `master` directly.

```sh
git -C D:/git/throng switch -c release/v<version> origin/master
```

`release/v<version>` is the established name (`release/v1.0.0-alpha4` was alpha4's). Work in the
main checkout rather than a fresh worktree: the dependency sweep in step 5 needs an installed
`node_modules` and runs the non-E2E stages against it, which a bare worktree would have to build
from nothing.

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

Nothing else carries the version. The app reads the root `package.json` in main (deliberately, not
`app.getVersion()`, which returns Electron's version unpackaged), a generated constant in the
daemon, and the preload bridge in the renderer. **Do not confuse it with `BUILD_ID`**, which is a
content hash for retiring a stale daemon.

## 5. Audit the dependencies, and take what fits

A release is the right moment for this and the only one anybody remembers. Do it **on the release
branch, before the gate and long before the tag** — an advisory found after the tag costs the whole
pipeline.

```sh
npm audit                      # 0 vulnerabilities is the bar, not "none critical"
npm outdated                   # current / wanted / latest
```

**Fix every advisory.** `npm audit fix` where it stays in range; a direct upgrade where it does not.
An advisory with no fix available is a decision for the user, not something to carry silently into
a release — name the package, the severity and what reaches it.

**Take the in-range upgrades, leave the majors.**

```sh
npm update --save              # everything `wanted` allows; --save raises the declared floors
npm audit                      # again, on the tree that will ship
```

Two traps, both from the alpha5 run:

- **`npm update --save` rewrites the workspaces' internal `@throng/*` references from `"*"` to a
  concrete range.** That is monorepo wiring rather than a dependency range, and pinning it means
  rewriting six manifests on every version bump. Put them back to `"*"` and re-run `npm install`
  before you commit — `git diff -- packages/*/package.json | grep @throng` is the check.
- **A major upgrade does not belong on a release branch.** ESLint 10, TypeScript 7, Vitest 5,
  Electron 44 and their kind each deserve their own PR and their own gate, because the failure mode
  is discovering at tag time that one of them does not hold. List them in the commit message as
  deliberately deferred, and tell the user.

`better-sqlite3` is **held at 12.x on purpose** (`c4df0731`). Do not let a sweep carry it forward.

**Then prove it, because native code moved.** Electron and `koffi` ship binaries the daemon loads
under the bundled host-Node runtime, so a patch bump is not a no-op. Run everything the gate runs
except E2E, on the upgraded tree, and quote the counts:

```sh
npm run build && npm run typecheck && npm run lint
npm run test:unit && npm run test:component
npm run test:integration && npm run test:contract
```

Capture the output to a scratch file rather than filtering it — the **running-tests** skill owns
how. If anything moved that a user would notice, the changelog entry for it goes in this cycle's
section; a patch sweep that clears no advisory and changes no behaviour usually needs no entry, and
saying so in the commit message is enough.

## 6. Documentation currency — the step that gets skipped

The constitution requires README, CONTRIBUTING and the affected `docs/` guides to be current with
any user-facing, setup, architecture or capability change, and the code-review gate checks it. A
release is the last place that debt can be repaid cheaply.

Work through this, and say in the PR which ones needed nothing:

| Surface | What to check |
|---|---|
| `README.md` | Features listed match what ships. The release badge is dynamic — never hardcode a version. |
| `docs/installation.md` | New artifact, new install route, changed first-run behaviour, changed warning text. |
| `docs/quick-start.md` | A new capability a new user would meet in their first ten minutes. |
| `docs/testing.md` | New tiers, budgets or measured timings quoted in this release's work. |
| `docs/releasing.md` | Only if the *pipeline itself* changed. If it did, update this skill too. |
| `CONTRIBUTING.md` | New scripts, new gates, a changed workflow. |
| New settings | Every configurable option added this cycle is exposed in the preferences editors and named in the changelog entry. |

## 7. Prove it locally before spending a runner

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

## 8. Commit, PR, gate, merge

Author the commit message into a file and use `git commit -F` — never `-m`, which lets the shell eat
backticks and `$(…)` from the message while the commit succeeds. Follow the **git-commit** skill.

Precedent for the subject: `chore(release): <version>, with its changelog section`.

The body says what the reader needs: that the bump touches the same manifests by the same mechanism,
that it must land **before** the tag because the publish gate compares filename == package ==
verdict == tag, and what the release carries over the previous one.

```sh
git push -u origin release/v<version>
gh pr create --title "chore(release): <version>" --body-file <file>
```

Then the gate, dispatched against the branch — CI's lanes run on the push, but `npm run gate` is
what establishes done-ness:

```sh
gh workflow run gate.yml --ref release/v<version>
gh run watch <run-id> --exit-status                              # one blocking watch, ~35 min
gh run view <run-id> --json status,conclusion --jq '"\(.status)/\(.conclusion)"'
```

Take the verdict from `run view`. `gh run watch` detaches early and its exit code lies in both
directions. If `status` is not `completed`, the watch gave up and the run is still going.

Merge once it is green and the PR's own checks pass.

## 9. Tag

The tag is cut on `master`, after the merge, and pushing it is what starts the release.

```sh
git switch master && git pull
git log -1 --oneline                                 # the release-prep commit
git tag -a v<version> -m "throng v<version>"
git push origin v<version>
```

Never force-push a tag, and never move one that has published.

## 10. Watch `release.yml`

```sh
gh run list --workflow release.yml --limit 3
gh run watch <run-id>
```

Four jobs, in order, each gating the next:

1. **E2E (full suite)** — everything except `@core`'s 50; one worker, no shards. This is the only
   place the `@extended` half of the suite runs. ~40–60 min on a runner. A red suite means no
   artifact.
2. **Build the per-user installer** — `npm run package`, then `artifact-set.mjs reconcile`, which
   fails in **both** directions: a declared artifact that was not built, and a built artifact nobody
   declared.
3. **Verify on a clean machine** — every declared artifact, resolved by **role**, each installed,
   launched, version-checked, journey-tested (project → terminal → reopen → reattach), checksummed
   and removed, with a verdict per role. It also renders `release-body-preview.md` — the exact body
   publication will use.
4. **Publish (gated)** — waits at the `release` Environment for required reviewers.

The declared set is three artifacts, and the declaration in
`packages/core/src/config/release-artifacts.ts` is the contract:

| Role | Filename | What it is |
|---|---|---|
| `setup` | `throng-setup-<version>.exe` | Per-user NSIS wizard, no admin rights, into `%LOCALAPPDATA%\Programs\throng`. |
| `portable` | `throng-portable-<version>.exe` | Self-extracting single executable; installs nothing. |
| `archive` | `throng-<version>.zip` | Ordinary archive, extracted and run from anywhere. |

Nothing globs and nothing resolves by extension — `nsis` and `portable` both produce a `.exe`, which
is exactly why `ls dist/installer/*.exe | head -n1` was removed from three places in `release.yml`.

## 11. The human QA sign-off

**Blocking, and it is the user's to give.** Tell them, in one line, what is waiting and where:

- download `release-body-preview.md` from the verify job's artifacts and read the text that will
  ship;
- approve the `release` Environment on the publish job.

No automation, default or timeout can satisfy it. Do not try to approve it yourself.

## 12. After it publishes

```sh
gh release view v<version> --json name,isPrerelease,assets,publishedAt \
  --jq '{name, isPrerelease, assets: [.assets[].name]}'
```

Confirm, and report:

- three assets attached, named for this version;
- `isPrerelease: true` for any version carrying a suffix;
- the body carries this release's notes, one SHA-256 row per artifact against its own filename, and
  the source revision;
- `## Unreleased` is back on `master`, empty, ready for the next cycle.

Then say it plainly: the version, the release URL, the gate run URL, and anything left undone.

## When something breaks

| Symptom | What it means | What to do |
|---|---|---|
| `release-notes` exits 2 | No `## <version>` section | The heading does not match the version exactly — check the suffix and the em-dash form. |
| `release-notes` exits 3 | Section is empty | Write entries, or the single literal "no user-visible changes" line. |
| `reconcile` names an unexpected filename | A target's output changed | Fix `electron-builder.yml`'s `artifactName`. **Never** loosen the declaration. |
| `reconcile` names a missing artifact | A target did not run | Read the packaging log; do not publish a partial set. |
| Publish gate: "verdict missing" | A role verified but its verdict was not uploaded, or a role was skipped | A partial verdict set is a refusal, not a partial pass. Re-run verification. |
| Publish gate: version mismatch | The four-way match failed | Tag, manifest, filename and reported version must agree exactly, suffix included. |
| Publish gate: already published | The version exists | Published bytes are immutable. Cut the next version; never delete and re-push a tag. |
| A single E2E fails in the full lane | Possibly a flake | The **throng-testing** skill owns this. The lane retries once only on an infrastructure fault (0 unexpected, 0 flaky). |
| Verification fails locally but passes on CI | Almost always the harness colliding with your session | The launch probe needs its own `--user-data-dir`; the residue scan attributes processes by path. See `docs/releasing.md` §3. |
| The portable role fails verification | Three known traps | Copy the unpacked tree *before* stopping the launcher, wait for it to settle, and pass **no** `PORTABLE_EXECUTABLE_*` variables. |

**Rehearsing without releasing** — a dispatch with `publish: false` runs the full suite, packages,
reconciles, verifies every artifact and renders the body, releasing nothing:

```sh
gh workflow run release.yml --ref master -f publish=false
```

Use it when the pipeline itself is what is being fixed.

## Never

- **Never publish by hand.** No manual upload, rename or copy of an artifact; no `gh release create`
  outside the pipeline. The checksum is computed as the last step that reads the bytes, and a
  hand-uploaded file breaks that binding.
- **Never delete a published release or move its tag** to retry. Cut the next version.
- **Never write release prose in the workflow or the release body.** It comes from `CHANGELOG.md` or
  it does not exist.
- **Never bypass the full E2E lane** to make a release finish sooner. It is the other half of CI's
  50-test `@core` trade; without it the reduced surface is a hole rather than a reduction.
- **Never run Prettier in this repo.** There is no config, so it rewrites every string delimiter it
  touches. ESLint is the formatter.
- **Never add an attribution footer or a session link** to a commit message, PR body, release body or
  issue comment.

## Keeping this skill true

The pipeline changes, and a stale runbook is worse than none — it reads as verified. When work lands
that touches `release.yml`, `electron-builder.yml`, `release-artifacts.ts`, `artifact-set.mjs`,
`publish-gates.mjs`, `verify-installer.mjs`, `release-notes.mjs`, `CHANGELOG.md`'s format or the
version guards, update this file in the same PR — and `docs/releasing.md` with it.

Open work that will change this: [#118](https://github.com/Bidthedog/throng/issues/118) code
signing, [#119](https://github.com/Bidthedog/throng/issues/119) automatic update,
[#351](https://github.com/Bidthedog/throng/issues/351) MSI and portable formats,
[#361](https://github.com/Bidthedog/throng/issues/361) machine-wide installation. Each adds or
changes a role in the declared set or a step in this runbook.

## Where the detail lives

- `docs/releasing.md` — the reasoning, the measurements, the verification model.
- `.claude/agents/throng-build-release.md` — packaging constraints (`npmRebuild: false`,
  `asar: false`, the bundled host-Node runtime) and the CI shape.
- `specs/020-application-packaging/`, `specs/042-release-notes-and-artifacts/` — the requirements
  behind every refusal above.
- **throng-testing** for a failing or flaky suite; **git-commit** for the commit; **branch-sync**
  for the PR mechanics.
