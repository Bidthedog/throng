# Contract: Renderer → Main Configuration Write

**Feature**: 032-settings-write-integrity | **Date**: 2026-08-14 | **Revised**: after analysis

The renderer is sandboxed and has no filesystem access, so every configuration write crosses this
boundary. This contract is what the contract-test layer verifies.

## Scope

The **key-scoped channel** applies to the `settings` document only. A patch addressed to any other
document kind is **rejected**, not quietly accepted — an unsupported write that appears to work is
how scope creep becomes a defect.

The reason is *not* that keybindings and themes have a single writer. Earlier drafts said so and it
is false: `shipped-defaults-service.ts` writes both wholesale from the main process while the
Preferences tabs hold independent renderer copies. The reason is that no defect has been reported
against them and a key-scoped path representation for `keybindings.bindings` — keyed by action ids
containing dots — is real work with no demand behind it.

**Serialisation (§ below) and refuse-on-unreadable are NOT scoped to settings.** They apply to every
configuration document, because they close data-loss paths rather than clobber paths.

## Serialisation — the step that makes the rest true

**Every writer in the main process acquires a per-document lock for the whole read → apply → write
cycle**, and releases it only once the file replace has completed or failed.

Without this the feature relocates the defect instead of removing it. Two read-modify-write paths
reachable over different IPC channels, each with an `await` between reading and writing, interleave
as `read-A → read-B → write-A → write-B`, and B silently drops A's key. Atomicity of the *write*
says nothing about that gap — and the gap is where the original bug lives.

Verified absent today: `config-write-ipc.ts` has no chain, queue, mutex or lock. The only
serialisation in the system is `writeChains` at `write-config.ts:24`, which is module-scoped in a
**renderer**, so it orders one window's writes to one document and nothing else.

- **G11.** Two concurrent main-process writes to one document are applied in some serial order, and
  the later one reads the earlier one's result.
- **G12.** Every main-process writer shares one serialisation point — the patch handler, the
  whole-document handler, and every reset and restore path. A writer that bypasses it is a defect,
  and the test that proves this is a soak, not an inspection.

## Channels

| Channel | Direction | Status |
|---|---|---|
| `throng:config:write` | renderer → main, invoke | **Existing.** Whole-document write. Retained. |
| `throng:config:writePatch` | renderer → main, invoke | **New.** Key-scoped write, `settings` only. |
| `throng:config` | main → renderer, send | **Existing.** The watcher's broadcast payload. Shape unchanged. |

A new channel rather than a changed one, deliberately: the whole-document write has legitimate
remaining callers, and overloading one channel with two semantics is how the two got confused in the
first place.

## `throng:config:writePatch`

**Request**

```ts
(id: ConfigDocId, changes: ConfigChange[]) => Promise<WriteResult>

type ConfigChange = { path: string[]; value: unknown };
```

**`path` is an array of segments, not a dotted string.** A dotted string cannot address a key that
itself contains a dot, and this repository has them: `keybindings.bindings` is a
`Record<string, string[]>` keyed by action ids such as `tabs.openPicker`. Even though keybindings are
out of scope today, a representation that is ambiguous the moment scope widens is the wrong
representation to choose now — and `settings` has map-shaped sections of its own. A segment array is
unambiguous by construction and costs nothing.

**Behaviour, in order.** Each step is a contract test.

0. **Acquire the document's lock**, held until step 7 completes or fails. Steps 4–7 are a
   read-modify-write cycle and are not correct without it.
1. **Confine.** Reject anything resolving outside the config roots — the existing `isConfined`
   check, unchanged, applied before anything is read. → `path-escape`
2. **Reject an unsupported document kind.** Anything other than `settings`. → `unsupported-doc`
3. **Validate the patch.** Reject an empty `changes` array (`empty-patch`). Reject a change whose
   `path` is empty, whose segments are not non-empty strings, or which names `__proto__`,
   `constructor` or `prototype`. → `invalid-path`
4. **Read the current persisted content.** A document that does not exist yet reads as `{}` — that
   is not a failure. A document that exists but **cannot be parsed** is → `read-failed`, and
   **nothing is written**. This is not defensiveness: applying a change on top of an empty base
   would replace every setting the user has with the one key being written, which is a larger
   instance of the exact loss this feature exists to prevent (FR-006a).
5. **Apply the changes in array order**, creating intermediate objects only where a segment is
   missing. Later changes to the same path win.
6. **Validate the result.** The patched document must still be a JSON object, and is passed through
   the same bounds guard the read path uses (031 FR-013a) so a patch cannot install a value a hand
   edit would have been clamped for. A correction is applied and recorded, not rejected.
7. **Write atomically** via the existing temp-file + rename path, including its bounded retry for
   Windows sharing violations.
8. **Return** `{ok: true}`, or `{ok: false, error}` with a stable identifier.

**Guarantees**

- **G1.** A key absent from `changes` has the same value after the write as it had on disk before it,
  even if another window changed it moments earlier. *This is the guarantee the feature exists for.*
- **G2.** Two concurrent patches touching different paths both survive, whichever order they land in.
- **G3.** Two concurrent patches touching the same path resolve to whichever landed second, and every
  window converges on that value. *(Second clause is a cross-window property — verified by E2E, not
  by a main-process test.)*
- **G4.** A rejected patch writes nothing. There is no partial application.
- **G5.** No caller of the patch channel needs the document's current content to issue a correct
  write. *(A property of callers, not of the handler — evidenced by the caller audit, not by a
  contract test on the channel.)*
- **G10.** An unparseable base is refused. A patch never writes a document assembled from `{}` when
  a real document exists on disk but could not be read.

## `throng:config:write` (unchanged)

```ts
(id: ConfigDocId, json: string) => Promise<WriteResult>
```

Semantics unchanged: validate, confine, parse as a JSON object, persist atomically, replace
wholesale.

**Exactly one settings caller remains**, and it is carved out of FR-001 in the requirement itself:
the preferences **JSON tab**, where the user has typed a complete document by hand and replacing the
file is the operation they asked for.

An earlier draft also retained **Revert All Preferences** here, on the reasoning that restoring a
snapshot is inherently whole-document. That was wrong: the snapshot is of the preference *editors*,
while `settings.json` also carries main-window state (`newProject.lastProjectFolder`), so a wholesale
restore discards a folder chosen after Preferences opened. FR-001a converts it.

| Caller | Disposition |
|---|---|
| `preferences/apply-client.ts:31` | → `writePatch` |
| `sidebar/projects-panel.tsx:210` | → `writePatch` |
| `preferences/preferences-app.tsx:189` (Revert All) | → `writePatch`, captured keys only (FR-001a) |
| `main/shipped-defaults-service.ts:133` (`resetSetting`) | → read-modify-write on current content, refuse an unreadable base (FR-001b) |
| `preferences/json-tab.tsx:91` | **retained** — raw hand editing, carved out of FR-001 |
| `preferences/keybindings-tab.tsx:117` | whole-document retained — no reported defect; dotted-key path representation not worth building unasked |
| `preferences/themes-tab.tsx:316`, `:441` | whole-document retained — same reason |
| `main/shipped-defaults-service.ts:122` (`resetBinding`) | → read-modify-write under the lock, refuse an unreadable base (FR-001c) |
| `main/shipped-defaults-service.ts:76`, `:87`, `:107`, `:112` (restore/reset all) | wholesale by definition, but **under the lock** (FR-002a) |

The last two rows are what three drafts of this contract missed. They are main-process writers of
the documents the same drafts called "single-window".

## `throng:config` broadcast (shape unchanged)

Still `{settings, theme, keybindings, iconPacks}`, still one payload so a theme and its icon pack can
never render mismatched.

What changes is **when** it is trustworthy. Today a read that cannot parse the file broadcasts the
guarded fallback — the defaults — and nothing re-reads, so every window is stranded on that payload
until something touches the file again.

- **G6.** A broadcast is never derived from an unreadable read while a retry remains.
- **G7.** After the retries are spent the last parse is broadcast anyway, so a genuinely corrupt file
  surfaces to the user rather than silently suspending updates.

## Test-side writes

Not IPC, but part of this contract because the suite writes the same files, and #253 is what happens
when it is not held to the same standard.

- **G8.** Any test writing into the config root of an **already-running** application writes
  atomically — temp file plus rename, with the bounded retry — through **one** shared helper.

**Withdrawn: G9.** An earlier draft required that a test writing deliberately invalid content deliver
it atomically, on the strength of #253 naming `preferences-settings.e2e.ts:378`. That call site
writes **before** `runApp`, under the comment "Seed a malformed file before launch": no application
is running, no watcher exists, and no race is possible. The only genuine running-app writes are
`preferences-json.e2e.ts:122` and `:151`. **#253 is inaccurate on this point** and is to be corrected
on the issue.

## Error identifiers

| `error` | Meaning | Status |
|---|---|---|
| `path-escape` | Target resolves outside the config roots | existing |
| `invalid-json` | Document text is not parseable (document channel) | existing |
| `not-an-object` | Parsed to something other than a JSON object | existing |
| `unsupported-doc` | Patch addressed to a document kind outside scope | new |
| `invalid-path` | A change's path is empty, malformed, or names a forbidden segment | new |
| `empty-patch` | A patch carried no changes | new |
| `read-failed` | Current content exists but could not be parsed, so the patch had no base | new |

Every value is a stable identifier, not a message. Wording for the user is chosen at the notice
layer, which is what lets one failure read differently in a notice and in the diagnostics log.
