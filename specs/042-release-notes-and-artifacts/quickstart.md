# Quickstart: proving spec 042

**Feature**: 042 | **Plan**: [plan.md](./plan.md)

Work down the tiers. Each is cheaper than the one below it, and each is a real gate — not a
rehearsal for the next. The tiers exist because `release.yml`'s publish path only runs on a version
tag, so the usual "just run it" is unavailable for most of this feature; see *Provability* in the
plan.

---

## Tier 1 — the pure logic (seconds, local)

Everything that decides anything lives in `@throng/core` and is a pure function.

```bash
npm run test:unit
```

**Expect**: the release-artifacts, release-notes, publish-gate and verification-verdict suites green.
These cover artifact declaration and resolution by role, set reconciliation including the
*unexpected artifact* case, changelog parsing and its four refusal causes, body composition with the
invariant footer, the size cap, and the extended gate.

**If a pure test fails, stop here.** Nothing below can tell you anything a failing unit test has not
already told you, and everything below costs minutes or hours.

## Tier 2 — the CLIs (seconds, local)

The three `scripts/*.mjs` entry points, driven against temp directories.

```bash
npm run test:unit -- release-cli
```

**Expect**: for each of `artifact-set.mjs`, `release-notes.mjs` and the extended `publish-gates.mjs`
— the success path, and every documented non-zero exit with its message. The exit codes are in
[contracts/artifact-set.md](./contracts/artifact-set.md) and
[contracts/release-notes.md](./contracts/release-notes.md).

**The check that matters most here**: `artifact-set.mjs resolve portable` and
`... resolve setup` must return different files when both `.exe`s are present. That single assertion
is the feature's reason for existing.

## Tier 3 — a real package (minutes, local)

```bash
npm run package
node scripts/artifact-set.mjs reconcile
node scripts/artifact-set.mjs list
```

**Expect**: `reconcile` exits 0, and `list` shows three artifacts whose filenames all carry the
version. If `reconcile` exits 4, read the `missing`/`unexpected` lists — a target that built under a
name the declaration does not predict is exactly what it is there to catch, and the fix is usually an
`artifactName` in `electron-builder.yml`, not the declaration.

```bash
node scripts/release-notes.mjs render --version $(node -p "require('./package.json').version") --artifacts "$(node scripts/artifact-set.mjs list --json)"
```

**Expect**: a body with the notes on top and the invariant footer beneath — warning, verification
guidance, a checksum table with **three rows**, and the source commit. Read it. This is the artifact
a user sees, and it is the last point at which reading it is cheap.

## Tier 4 — each artifact, by hand (slow, local)

One per format. These are the expensive ones and they are why the tiers above exist.

```bash
node scripts/verify-installer.mjs "$(node scripts/artifact-set.mjs resolve setup)"    --role setup    --verdict-out verdict-setup.json
node scripts/verify-installer.mjs "$(node scripts/artifact-set.mjs resolve portable)" --role portable --verdict-out verdict-portable.json
node scripts/verify-installer.mjs "$(node scripts/artifact-set.mjs resolve archive)"  --role archive  --verdict-out verdict-archive.json
```

**Expect** for each: every applicable step passed, and every inapplicable step recorded
`not-applicable` rather than passed. Check that literally — open the verdict and look at the
`archive` role's `install` and `uninstall` entries. A verdict claiming those *passed* for an archive
is the failure mode [contracts/verification-verdict.md](./contracts/verification-verdict.md) is
written to prevent, and it will look green.

**The one to distrust is `portable`.** A self-extracting build unpacks itself somewhere other than
the folder you delete, so its `residue-scan` can pass while a full copy of throng remains on disk.
Before believing a green portable verdict, confirm the scan actually fails when residue is left:
deliberately leave the unpack directory in place and re-run. If it still passes, the scan is pointed
at the wrong location and the green is meaningless.

## Tier 5 — a rehearsal on CI, without releasing (~30 min)

```bash
gh workflow run release.yml -f publish=false
gh run watch <run-id> --exit-status
```

**Expect**: build → package → reconcile → verify all three artifacts → the rendered release body
uploaded as a run artifact. Download it and read it; this is FR-006 doing its second job.

**What this does not prove**: the `gh release create` call, the Environment approval, the prerelease
flag, and how the body renders on GitHub. Those are only reachable at a real release, and that is
stated rather than worked around.

## Tier 6 — done-ness

```bash
npm run gate
```

**This is the only thing that establishes the work is done.** Eight stages, fail-fast, in CI's order.
The E2E stage costs ~18 minutes and should be entirely unaffected by this feature — no E2E is added,
and nothing here is reachable from the UI. If an E2E fails, that is information: something in this
change reached further than the plan says it does.

Quote the stage summary when reporting done, and re-run if anything is edited afterwards.

---

## Cleaning up

Tier 3 and Tier 4 leave packaged output, installed copies and extracted folders behind.

```bash
node scripts/residue-scan.mjs
```

Use the **throng-testing** skill if anything is still running, a folder will not delete, or a
subsequent run behaves differently for no visible reason — an interrupted verification leaves a
daemon holding the bundled runtime, and that is the usual cause.
