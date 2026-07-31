# Phase 0 Research: v1.0.0 Defects & Tweaks

Only questions whose answer changes the design are recorded. Each was settled by measurement or by
reading the code, not by assumption — this feature exists because assumption produced four wrong root
causes.

---

## R1 — Does NTFS need a two-step rename for a case-only change?

**Decision: No. `fs.rename` performs a case-only rename directly.**

Issue #194 states: *"on NTFS a direct `fs.rename('job specs', 'Job Specs')` is not reliably honoured —
the usual technique is a two-step rename via a temporary name."* Measured on the target platform
(Windows 11 26200, the repo's Node):

| Operation | Result |
|---|---|
| `renameSync('Job specs', 'Job Specs')` on a folder | succeeds; `readdir` reports `Job Specs` |
| `renameSync('readme.md', 'README.md')` on a file | succeeds; `readdir` reports `README.md` |
| `existsSync('ALPHA')` where only `alpha` exists | **`true`** |

**Rationale**: the two-step technique is folklore from older Win32 APIs. A temp-name dance would open a
window in which the user's file exists under neither name — a crash there loses the file's identity —
so adopting it *without needing it* would add the only data-loss risk in this story.

**Alternatives considered**: two-step via a temp name (rejected: unnecessary, and strictly less safe);
a platform-seam `moveCaseOnly` (rejected: nothing platform-specific is required).

**Consequence for the fix**: #194 is not a rename problem at all. The rename works; the *guard in front
of it* is wrong. The third row above is the entire defect — `exists(dest)` resolves case-insensitively
and finds the item itself.

---

## R2 — How should the collision guard tell a self-rename from a real collision?

**Decision: compare the leaf names case-insensitively; if the destination differs from the source only
by case, it is the same item, so skip the existence probe.**

`renameInBracket` builds `dest = join(dirname(abs), name)`, so source and destination always share a
directory and can differ only in the leaf. A case-insensitive leaf match is therefore exactly "the
destination is this item".

**Rationale**: needs no filesystem call, so it cannot itself race. `realpath` comparison would also
work but costs a syscall and resolves symlinks, which would wrongly treat a link and its target as the
same item.

**Alternatives considered**: `realpath(dest) === realpath(abs)` (rejected: symlink conflation, extra
I/O); dropping the exists check and letting `fs.rename` fail (rejected: `rename` silently *overwrites*
an existing file on POSIX and gives a worse message on Windows — the guard protects FR-003).

---

## R3 — How is a debounce given a ceiling without losing coalescing?

**Decision: keep the existing trailing debounce, and add a maximum wait. Record when the current burst
started; if the next event arrives once `maxWait` has already elapsed since that point, fire
immediately instead of rescheduling.**

This is the standard "debounce with maxWait" (lodash's `maxWait`, and the shape used by editor
autosave). It preserves the property that matters — a quiet burst still produces one report — while
guaranteeing FR-006's 1-second ceiling under unbounded churn.

**Rationale**: measured behaviour of the current code is 0 reports across 180 events in 3s. A pure
leading-edge debounce would fix liveness but fire on the *first* event of every burst and then go
quiet, which is worse for a tree that wants the settled state. Throttling alone loses the settle.

**Alternatives considered**: fixed-interval polling (rejected: burns CPU on idle projects and is the
"worked around with a polling refresh" outcome #186's acceptance criteria explicitly forbid);
leading-edge debounce (rejected: reports the pre-change state).

---

## R4 — Where does the watcher's failure signal go?

**Decision: extend the `IFileWatcher` seam with an optional failure callback; the UI-main watcher
raises a user-facing notice only after retries are exhausted, and writes diagnostics throughout.**

The seam currently carries a changed path and nothing else, so "tell the user" (FR-010a) is not
expressible without a contract change. See `contracts/file-watcher.md`.

**Rationale**: optional callback keeps every existing caller compiling unchanged (there are two), and
keeps the OS detail behind the seam per Constitution Principle II.

**Alternatives considered**: throwing (rejected: the watcher is fire-and-forget, nothing is awaiting
it); a global event bus (rejected: no precedent in this codebase for main-process eventing).

---

## R5 — What triggers auto-recovery of a stranded editor?

**Decision: reuse the existing file-change broadcast. When a change is reported anywhere under a
project root, ask the coordinator to retry every document currently marked unloadable.**

`EditorCoordinator.markRestored()` already performs exactly the required re-read and clean-reset; it is
wired only to throng's own file-undo. The missing piece is a trigger, and a trigger already exists.

**Rationale**: no new watcher, no polling, no focus hooks. It also composes with R3 — bounding the
watcher's delay bounds recovery latency for free.

**Alternatives considered**: a dedicated watch per unloadable document (rejected: more handles for a
rare state); retry on window focus (rejected: a user staring at the panel while the folder is restored
elsewhere would see nothing until they clicked away and back).

---

## R6 — Why does an in-app rename lose expansion while an external one errors?

**Decision (confirmed by reading, and by the failing tests): two different code paths, both needing a
fix.**

`drop` migrates open state by prefix into `pendingOpen` and re-persists the moment it applies (#120
"Finding 5"). `onRename` has no equivalent — it migrates only the *selection* (#122's `pendingSelect`).
So after an in-app rename the folder is no longer open, and #122's re-selection drains through
`onSelect → persist`, which re-snapshots the open state and writes the stale entry *out* before it can
be restored. Nothing errors; the expansion is simply gone.

An external rename re-persists nothing, so the stale path survives to the next restore, where
`fetchChildren` routes its failure to `fail(...)` — a user-facing notice — because it cannot tell a
speculative restore read from a read the user asked for.

**Consequence**: FR-020 is "mirror `drop`'s prefix migration in `onRename`", and FR-021 is "give the
restore read a non-reporting mode". Neither fixes the other.

---

## R7 — Which test layer for each fix?

The repo has four layers and no component-test stack. Layer chosen by where the seam is:

| Fix | Layer | Why |
|---|---|---|
| #194 collision guard | integration (real FS) | the defect only exists because NTFS is case-insensitive; a fake FS would pass while the app stays broken |
| #194 `validateRename` | unit | pure function |
| #186 max wait | integration (real FS) | needs real `fs.watch` timing |
| #186 error recovery | unit (mocked `node:fs`) | the error is an OS-timing artefact that cannot be provoked on demand |
| #186 delete reconcile + rollback | e2e | renderer state, only observable through the tree |
| #161 all | e2e | renderer UI plus main-process coordination |
| #197 all | e2e | persistence across project switch / restart |
| #166 | e2e | rendered DOM |
| #165 defaults | unit + e2e | pure data, plus the chord actually working |

All nine files already exist and are committed; this feature makes the red ones green.
