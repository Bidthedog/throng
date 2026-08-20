# The wiring-channel derivation (T060, FR-014 / FR-014a)

**The answer is one channel, and the interesting part is why it is not twelve.**

FR-014a requires the derivation be written down so a later reader can see why each channel is in or
out. This is that record. It reaches a conclusion the phase did not expect, so the evidence matters
more than usual.

## What the phase was for

Phase 4 exists because of the census's largest keep-at-E2E bucket: **"the wiring is live"**. Spec 035
rejected that as a justification on the grounds that wiring decomposes into spans that already have
homes — and `census-corrections.md` records that two careful readers, given the finished vocabulary
and no argument about it, split on exactly this seam. `@reserve:runtime` was written where
`MOVABLE:integration` was meant, or the reverse, in nearly every disagreement between them.

So the phase's premise was: **some E2E tests are irreducible only because the channel underneath them
is untested.** Cover the channel with a contract test and the E2E comes down.

## The candidate set

Every E2E declaration carrying `@reserve:runtime` — the least-settled tag in the vocabulary, and by
`census-corrections.md`'s own conclusion the best candidate for a second look rather than the worst.

**46 declarations across 24 files.** Each was traced to the channel or service its claim traverses,
and each channel was then checked for coverage anywhere below E2E.

## The result, by cluster

| Cluster | Channels | Already covered below E2E | Verdict |
|---|---|---|---|
| Config write / patch | `config:write`, `config:writePatch` | `contract/config-write-patch.contract.test.ts` — 15 tests including both concurrency guarantees (G2, G3) and the whole-document interleave (G12) | **OUT** |
| Resets | `config:resetBinding`, `resetSetting`, `resetSettings`, `resetKeybindings`, `resetPreferences` | `integration/reset-ipc.test.ts` (11), `reset-setting-integrity.test.ts` (3), `shipped-defaults-reset.test.ts` (5), `shipped-defaults-per-editor.test.ts` (5) | **OUT** |
| Write serialisation | the write lock | `integration/config-write-serialisation.test.ts` (5), `unit/config-write-lock.test.ts` | **OUT** |
| Bounds write-back | the guarded read path | `integration/settings-bounds-writeback.test.ts` (11) | **OUT** |
| Config hot-reload | the config watcher | `integration/config-broadcast-latency.test.ts`, `config-watcher-partial-read.test.ts`, `config-watcher-retry.test.ts`, `prefs-external-change.test.ts` | **OUT** |
| Themes | `config:restoreTheme`, `restoreAllThemes`, `deleteTheme`, `listThemes` | `contract/themes-ipc.contract.test.ts`, `integration/restore-theme.test.ts`, `shipped-defaults-restore.test.ts` | **OUT** |
| Icon packs | `config:listIconPacks` | `unit/icon-pack-service.test.ts`, `icon-pack-seeding.test.ts`, `component/icon.test.ts` | **OUT** |
| Explorer watching | the explorer watcher | `integration/explorer-watcher.test.ts`, `file-watcher-liveness.integration.test.ts`, `contract/node-file-watcher.contract.test.ts` | **OUT** |
| Notice logging | the notice log | `unit/notice-log.test.ts`, `component/notice-log-emission.test.ts`, `integration/notice-log-file.integration.test.ts` | **OUT** |
| Notice suppression | — (pure) | `unit/notice-suppression.test.ts` — 22 tests, including dismissal re-arming the cause | **OUT** |
| File index | `fileIndex:subscribe/unsubscribe/update` | `contract/file-index-ipc.contract.test.ts` | **OUT** |
| Daemon supervision | the supervisor | `integration/daemon-supervisor.integration.test.ts` | **OUT** |
| **Daemon transport failure** | **`DaemonClient.call` ↔ `isTransportFailure`** | **nothing** | **IN** |

## The one that was in, and why it is a real hole rather than a technicality

`isTransportFailure` decides whether a raw failure string is the transport failing rather than a real
error about a real thing. Both directions are costly: classify too little and the user is shown
`ENOENT` for a named pipe — the same code a missing FILE produces, so they go hunting for a file that
was never involved. Classify too much and every failure raised while the daemon happens to be down is
relabelled *"throng's daemon has stopped"*, including `FilesService` messages that need no daemon at
all (FR-011b).

`unit/failure-cause-message.test.ts` tests that function thoroughly, in both directions, against
**strings the test itself writes down**. Its first case is `'ENOENT'`, annotated *"a bare errno, which
is what a dead pipe produces"*.

**That annotation is an assumption about a real dependency, stated as fact and never measured.**
Nothing anywhere asserted that a real `DaemonClient`, against a real absent pipe, rejects with a
string the classifier recognises. The two halves could drift apart in silence:

- Node changes what `connect()` reports for a missing pipe, or reports it on a different property,
  and `error.code` arrives `undefined`;
- somebody improves the rejection to a friendly sentence — **the kindest-looking change available in
  that file**, and the one that makes the classifier return `false` and put raw text in front of a
  user.

The unit test passes in both cases, because it never asks the client anything. `contract/
daemon-transport-failure.contract.test.ts` (T061) asks: a real `connect()` against a real absent
pipe, a real pipe server answering with garbage, and a real pipe server answering with nothing.
Red-proven against five mutations, each caught by the test that should catch it — including
`friendly-message`, which the entire rest of the suite passes.

## What this means for the phase's premise

**The premise was largely false as of this branch's state, and that is a finding rather than a
disappointment.** Twelve of thirteen clusters were already covered below E2E — most of them
thoroughly, and most of that coverage predates spec 035.

So the E2E tests carrying `@reserve:runtime` are, with one exception, **not held up by a missing
channel test**. Their channels are proven. What holds them up is the half the channel test cannot
reach, and it splits two ways:

- **A genuinely irreducible remainder.** `daemon-death-notice.e2e.ts` needs a real daemon process to
  actually die. That is `@reserve:process`, not wiring, and T063 retags it — the tag was the claim,
  and the claim was wrong.
- **A rendering claim, which is a component test.** Most of the preferences cluster is here: the
  write is proven, the reset is proven, and what the E2E adds is that the editor shows it. That was
  irreducible while `PreferencesApp` was thought unmountable, and this branch measured that it mounts
  with no providers at all.

**The wiring bucket did decompose — it had just decomposed already, and nobody had gone back to
re-read the tags.** That is the more useful version of the phase's thesis: the cost of a stale
justification is not that the test is expensive, it is that the tag stops anyone asking.
