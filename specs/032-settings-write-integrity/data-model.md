# Data Model: Settings Write Integrity

**Feature**: 032-settings-write-integrity | **Date**: 2026-08-14 | **Revised**: after analysis

No persisted schema changes. The on-disk configuration documents keep their current shape and remain
readable by an older build — this feature changes how a write is *expressed and applied*, not what a
document contains. The entities below are in-memory and on-the-wire.

## ConfigChange

One key-scoped change to the settings document. The unit the renderer sends instead of a document.

| Field | Type | Rules |
|---|---|---|
| `path` | `string[]` | Segments from the document root, e.g. `['notifications','error','mode']`. Non-empty; every segment a non-empty string; `__proto__`, `constructor` and `prototype` rejected. |
| `value` | `unknown` | The new value. JSON-serialisable. `undefined` is not permitted. |

**Why a segment array rather than a dotted string.** A dotted string cannot address a key that itself
contains a dot, and this repository has them — `keybindings.bindings` is a `Record<string, string[]>`
keyed by action ids like `tabs.openPicker`. Keybindings are out of scope today, but choosing a
representation that becomes ambiguous the moment scope widens is a decision to redo the work later.

**No `remove` variant.** An earlier draft carried one. No functional requirement asks for a key to be
deleted — per-setting reset is already served by the existing `throng:config:resetSetting` channel,
which resolves the shipped default in main rather than deleting anything. Speculative generality,
cut under Principle VIII.

**Validation happens in the main process, not the renderer.** A renderer is the untrusted side of the
bridge; a path that escapes its document is the same class of problem as a theme name escaping its
directory, which `isSafeThemeName` already guards.

## ConfigWriteResult

Unchanged in shape (`{ok: true} | {ok: false, error: string}`), extended in vocabulary. The full
table of identifiers lives in [contracts/config-write.md](./contracts/config-write.md#error-identifiers)
so there is one place to change when one is added.

## CorrectionOutcome — extended, not replaced

An earlier draft invented a `ParseOutcome` type. The shipped type already exists:

```ts
// packages/core/src/config/bounds-guard.ts:33
export interface CorrectionOutcome<T> {
  value: T;            // the corrected document, always usable
  corrected: boolean;  // at least one correction was recorded; drives write-back
  corrections: Correction[];
}
```

This feature **adds one field** to it:

| Field | Type | Meaning |
|---|---|---|
| `unreadable` | `boolean` | **New.** The text could not be parsed at all, so `value` is a fallback and not evidence of anything. |

The distinction is the whole of R4 and the reason FR-008 is unmet today: `corrected` and `unreadable`
are currently the same observable state. A document that parsed but held an out-of-range value, and a
document that did not parse at all, both come back as "here are your settings, some corrected".

Only `unreadable` triggers the watcher's bounded re-read. `corrected` must not: a genuinely
out-of-range hand edit is corrected once and written back, and retrying it would loop.

## ConfigWatchPolicy

The re-read behaviour. **Deliberately NOT part of `AppSettings`.**

| Field | Type | Default | Rationale |
|---|---|---|---|
| `unreadableRetries` | `number` | `3` | A partial write is visible for one filesystem tick; three attempts clears it with margin without masking a genuinely corrupt file. |
| `unreadableRetryDelayMs` | `number` | `50` | Comfortably longer than the temp-file + rename window, comfortably shorter than a user noticing. |

**Why not an `AppSettings` key.** Not because the completeness gate forbids it — `SETTINGS_INTERNAL_KEYS`
is an established escape hatch, and `newProject.lastProjectFolder` uses it. It is available.

It is the wrong shape regardless. These two numbers are not configuration: no user and no machine
needs to vary them, they have no sensible per-installation value, and the internal-keys list exists
for state the app persists **about itself** — a remembered folder — not for tuning constants. So this
is an **injected constant** bound at the main composition root (Principle IX) and overridable in
tests by injection. Principle X governs values a user or a machine needs to vary; this is neither,
and this document does not claim otherwise. See `plan.md` for the full argument.

## Retained whole-document writers

Recorded here because "which callers are *not* converted" is design, not omission.

| Caller | Why whole-document is correct |
|---|---|
| `preferences/json-tab.tsx:91` | The user is editing the raw document by hand. Last-write-wins is exactly what they mean, and FR-001 carves it out explicitly. |
| `preferences/keybindings-tab.tsx:117` | Writes `keybindings.json`, which has no second writing window. Out of scope. |
| `preferences/themes-tab.tsx:316`, `:441` | Write theme documents, which have no second writing window. Out of scope. |

**Two writers were on this list and have been removed from it**, because "retained by design" was
doing work that the design had not actually done:

- `preferences/preferences-app.tsx:189` — Revert All. Converted by FR-001a; its snapshot covers the
  preference editors, not the main-window state that shares the file.
- `main/shipped-defaults-service.ts:133` — `resetSetting`. Never on the list at all: two successive
  audits looked only at renderer call sites and missed a main-process writer with the same
  read-modify-write shape and a defaults fallback that is strictly worse. Converted by FR-001b.

## Relationships

```text
ConfigChange[] ──crosses IPC──► main
                                 │
                     read current persisted content
                                 │
                    ┌────────────┴────────────┐
              parses OK                  unparseable
                    │                          │
        apply changes in order          read-failed, write NOTHING (G10)
                    │
           bounds guard (031)
                    │
             atomic write
                    │
              file change ──► watcher ──► CorrectionOutcome
                                             │        │
                                     unreadable       ok
                                             │        │
                                   bounded re-read    │
                                             └────────┴──► broadcast to every window
```

The loop that matters: a window's copy is refreshed only by that final broadcast, which is why a
write built from a copy is a write built from something that may already be out of date — and why
the fix is for the write not to contain a copy at all.
