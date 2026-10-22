# Verification — proving every artifact before any of them ships

What verification proves, the verdict model, what each artifact costs to start, and how to run it on
a developer machine without mistaking the harness for the product. What a *passing* verdict looks
like on a real release run is in [`SKILL.md`](../SKILL.md) step 10.

## What is proved

**Every** declared artifact is verified before any of them is published, each on a fresh CI runner
so no developer state can leak a false pass. What is proved is the same for all of them — only how
the app gets on and off disk differs:

1. it gets onto disk: the setup installer runs silently (`/S`), the archive is extracted, the
   portable build unpacks itself;
2. it **launches** and reports the **expected version**;
3. its daemon runs under the **bundled runtime**, and a **core journey** works — create a project,
   spawn a terminal, then close and reopen with a live terminal and confirm it **reattaches**
   (Principle III surviving packaging);
4. its **checksum matches** its own bytes;
5. it comes off disk — uninstalled, or its folder deleted — and **nothing is left behind**.

```bash
node scripts/verify-installer.mjs "$(node scripts/artifact-set.mjs resolve archive)" --role archive
```

### Scopes add steps

Every combination runs on **its own** fresh runner (a matrix job), so a machine-wide install's
residue can never become the next combination's starting state. On top of the format's own steps:

| Step | Combinations | Proves |
|---|---|---|
| `install-labels` | setup and MSI, both scopes | the *Installed apps* entry and shortcut carry the scope and installer |
| `standard-account-install` | `*-user` | a silent per-user install **run as a real standard account** succeeds — nobody could approve a prompt, so this proves no elevation is needed |
| `second-account` | `*-machine` | a standard account launches the shared install: shortcut present, its own daemon (by process owner, medium integrity, own pipe), a terminal works, isolation both ways |
| `in-use-upgrade` | `*-machine` | with that account's daemon running, a same-version reinstall exits `3010`, terminates nothing, and registers pending renames under the install root |
| `not-elevated-launch` | `*-machine` | the app the elevated installer starts runs at medium integrity |
| `silent-elevation-refused` | `setup-machine` | `/S /allusers` as the standard account exits `740` and installs nothing |

The standard account is created per run with a random password (`scripts/second-account.mjs`,
`Start-Process -Credential`) and deleted in a `finally`. Failing to create it is `failed`, never
`unproven` — an administrator can always create one.

A seventh job, **coexistence** (`verify-installer.mjs --coexistence`), installs the setup and the
MSI in both scopes plus the archive on one runner and proves: all install, each launches its own
version, a second launch is refused, every copy logs the same data folder, a terminal started from
one copy reattaches from another, and reinstalling then uninstalling one copy leaves the others. It
runs only after the whole matrix is green, and exits `2` with **no verdict** on a machine that already
has `%APPDATA%\throng` (pass `--allow-dirty-profile` to override, locally only).

## A step has four outcomes, not two

`passed`, `failed`, **`not-applicable`**, and **`unproven`**. `unproven` is allowed for exactly two
steps. `second-account`'s GUI half — the hosted runner cannot be assumed to give a second account an
interactive desktop, so that half is never attempted and its daemon half carries the proof. `not-elevated-launch`, only while the runner's desktop (explorer.exe) is above medium integrity, as a hosted runner's is with UAC disabled. Any other
step reporting `unproven` is treated as `failed`. An `unproven` passes the gate but is named in the job
summary and in the release body, every run.

On `not-applicable`: An archive has no install step and no uninstaller, and
both of the two-state answers are wrong: running the installer's step list against it would fail a
perfectly good release, and marking those steps *passed* would make the verdict assert an uninstall
that never ran. Spec 020's FR-027 already refuses to conflate absence with success for a missing
verdict; this says the same thing about a step, in the verdict, where a human reading it can see
which checks were actually run.

The rule has teeth in both directions. A verdict marking a step `not-applicable` for a role that
**does** declare it applicable is **invalid**, not merely failing — that is a skipped check wearing
an exemption's clothes. An applicable step with no result at all is a failure, not a skip.

## One verdict per combination

The result is a **verdict per combination** (`verification-verdict-<id>.json`, field `combination`),
bound to that artifact's exact bytes, plus `verification-verdict-coexistence.json`. A **missing
verdict is treated as a failure**, never as a pass — and a set covering only *some* combinations is a
refusal, not a partial pass. A failure **names the combination and the step**:
`msi-machine: in-use-upgrade`, or `coexistence: same-data-folder`.

## What each artifact costs to start

Measured 2026-09-03 on a developer workstation, from launch to a window on screen:

| Artifact | First run | Every run after |
|---|---|---|
| Setup installer | install, then ~2 s | ~2 s |
| **Portable** | **23.1 s** | **23.3 s** |
| **Archive** | 58.1 s to extract | **1.6 s** |

**The portable build pays its cost on every launch, not once.** throng is deliberately not
asar-packed (020 FR-009), so a self-extracting build unpacks a ~135 MB tree each time it starts —
and the warm figure being no better than the cold one is that fact measured rather than assumed. The
archive front-loads the same work: one 58-second extraction, then launches as fast as an installed
copy.

Both are comfortably inside SC-005's three-minute download-to-terminal bar, so this is a trade to
tell users about (`docs/installation.md` does), not a reason to drop either. The measurement was
042's T047.

## Running it on a developer machine

Verification is a **clean-machine** activity and CI is where it counts, but it does run locally,
with two caveats worth knowing because both once looked like product bugs:

- **The launch probe uses its own Electron profile** (`--user-data-dir`). Electron keys its
  single-instance lock to `userData`, and a *packaged* throng does not isolate that — so with throng
  already open, a verification launch acquires no lock, quits immediately, and the probe reports "no
  window". That is the harness colliding with your session, not a broken package.
- **The residue scan attributes processes by path.** A throng running from somewhere else is a
  different installation, not this run's residue.

Neither caveat affects CI, where nothing else is ever running — which is precisely why both went
unnoticed until someone reproduced a CI verdict locally.

## The portable role

**Verifying the portable build is the awkward one**, and its three rules are worth knowing because
each was learned from a failure that looked like a broken package and was not:

- Its launcher unpacks to a directory it **deletes when it exits**, so the harness copies the tree
  before stopping the launcher and probes the copy.
- It copies only once the tree has **settled**. `throng.exe` appears early and the remaining ~135 MB
  lands behind it, so copying on first sight takes a torn read — which starts, attaches a debugger,
  and then hangs forever waiting for a file that was never copied.
- It passes **no** `PORTABLE_EXECUTABLE_*` variables. Supplying them — which looks obviously correct,
  since the launcher sets them — makes the app exit 1 the instant Playwright attaches. The archive
  is the same binary driven the same way without them, and passes.

## Proving the residue scan can fail

That is the only thing that makes its green worth anything:

```bash
node scripts/verify-installer.mjs "$(node scripts/artifact-set.mjs resolve portable)" \
  --role portable --keep-residue
```

The unpacked tree is left in place and `residue-scan` **must** come back `failed`. If it passes, the
scan is looking somewhere the app never was.

## The manual test plan on runners (`hand_tests`)

A dispatch with `-f hand_tests=true` also runs the branch's manual test plan (MT-01..MT-08,
`.claude/.manual-test-plans/`) on one fresh runner per group, so sign-off rests on evidence rather than
a person at a VM:

```sh
gh workflow run release.yml --ref <branch> -f publish=false -f skip_e2e=true -f hand_tests=true
```

`scripts/verify-hand-tests.mjs` drives the real installers' dialogs through Windows UI Automation
(`scripts/ui-automation.ps1`), as the account each step names, and writes `hand-test-MT-0N.json` plus a
screenshot at each dialog (artifact `hand-test-MT-0N`). `--list` prints every step it will claim.

- Each step is `passed`, `failed`, or `runner-gap`. A gap is only for what a hosted runner physically
  cannot do (a restart, a UAC prompt with UAC off, a desktop that is not medium integrity) and always
  names the stand-in done instead — read those before signing a group off.
- It is never a gate: `publish` refuses to run when `hand_tests` is set. MT-06 links the coexistence
  job's verdict rather than repeating it; MT-08 builds a second setup at version 0.9.0 on the
  runner's copy only.
