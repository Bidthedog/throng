# Implementation Plan: Native Encodings and Line-Ending Conversion

**Branch**: `feature/S059-I517-native-encodings-line-endings` | **Date**: 2026-10-24 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/059-native-encodings-line-endings/spec.md`

## Summary

The editor and every project-text reader learn four encodings beyond UTF-8 through one core
detection function, decode losslessly or refuse, and write back in the file's own encoding. A
character the encoding cannot hold blocks the save with one inline notice offering Save as UTF-8.
The status bar gains encoding and line-ending indicators. Reopen/Save with Encoding and Convert to
LF/CRLF arrive as commands with menu items.

From [research.md](./research.md):
- Core: `detectTextFormat` (R1, R2), fatal platform decoders (R3), hand-written encoders with a 1252
  table derived from the decoder (R4), `findUnrepresentable` (R5).
- Main: the document authority owns the line format and records a conversion as an undo entry (R6).
  The save path stops trusting the renderer's line ending and keeps a mixed file's per-line record.
  The coordinator owns the encoding and an `encodingChosen` flag (R7).
- Renderer: two status-strip indicators in the hide order (R11), four commands with content-menu
  items and an encoding picker (R12), and an inline save-refusal banner (R9).

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Node 24

**Primary Dependencies**: Electron 44, CodeMirror 6 (`Text`, `ChangeSet`). WHATWG `TextDecoder`
(`utf-8`, `utf-16le`, `utf-16be`, `windows-1252`), verified present in this repo's Node. **No new npm
dependency** (R3, R4).

**Storage**: none new. The panel layout config (existing blob) and the editor recovery snapshot gain
optional fields (R7). No SQL migration.

**Testing**: Vitest `unit`, `component`, `integration`, plus one Playwright E2E (`@extended @editor`)
per R14.

**Target Platform**: Windows 11 (Electron). All detection and codecs are pure core.

**Project Type**: desktop app, npm workspaces: `packages/core`, `ui` (main / preload / renderer).
`daemon`, `persistence` and `ipc-contract` are untouched.

**Performance Goals**: SC-005. A 5 MB open in any encoding takes no more than 1.5× the UTF-8 time.
Detection reads at most 8,000 leading bytes for its patterns, plus one fatal decode pass, which
replaces today's non-fatal one.

**Constraints**:
- Principle XI: one owner for encoding (the coordinator) and line format (the authority). Renderers
  hold display copies only (R6, R7).
- FR-020: `encode` cannot emit a substitute. It throws on an unrepresentable character (R5).
- 040 FR-024's guarantee for language label and wrap toggle stands. FR-032 extends the hide order
  only through the two new indicators.
- Principle XII: no new layout read on an input path. The indicators are measured with the existing
  strip measurement pass.

**Scale/Scope**: files up to `editor.maxOpenFileBytes`. Four new commands, two indicators, one
banner, no settings.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle / gate | Verdict | Note |
|---|---|---|
| I Project-first | ✅ | Per-document state only. Nothing crosses projects |
| II Platform-abstracted core | ✅ | Detection, codecs, labels and the refusal table are pure core over `Uint8Array`/`string` (006 FR-027). Windows-1252 is the fallback on every OS, never locale-dependent (spec Assumptions) |
| III Persistent terminals | ✅ | Not touched |
| IV Native terminal support | ✅ | Not touched. The four commands are rebindable and listed in Key Bindings |
| V Test-first | ✅ | Every FR has a failing test first at the layer R14 names. One E2E only, for the cross-process path |
| VI Simple, discoverable UX | ✅ | Every action has a content-menu item (the canonical route). The status-bar indicators are accelerators over it. Items show their chord once bound and mark the current state |
| VII Change review | ✅ | Draft PR. Heavy gate after manual sign-off |
| VIII SOLID/DRY/YAGNI | ✅ | One detection function replaces three ad-hoc checks. The 1252 encoder is derived from the decoder rather than a second table. No default-encoding setting (not asked for) |
| IX DI & composition root | ✅ | No new service. `EditorService`, the coordinator and the authority are extended in place |
| X Externalised configuration | ✅ | No new setting. The detection thresholds are internal constants with their reason (R2). The four chords are in the keybindings registry |
| XI One document, one state | ✅ | Line format moves INTO the authority. The renderer-sourced `lineEnding` on save is removed (R6). Encoding is coordinator-owned and relayed |
| XII Responsive UI | ✅ | No new input-path layout reads. 5 MB decode measured (SC-005) |
| Gate: lint/typecheck zero errors | ✅ | Short gates before ready |
| Gate: configuration-editor completeness | ✅ | Four `keybindings-metadata.ts` descriptors. The completeness test fails without them |
| Gate: themeable icon controls | ✅ | The indicators are text buttons using the language label's existing status tokens. No new icon |
| Gate: documentation currency | ✅ | R15. The docs-currency test covers the four bindings |
| Gate: one condition, one notice | ✅ | The save refusal is one document-owned banner that flashes on repeat (R9). The modal `reportSaveError` is not used for it |
| Gate: find the governing requirement first | ✅ | Done in the spec (*Requirements this spec builds on*). Two supersessions: 040 FR-013 and FR-024 |

**Defect fixed in passing (HARDENING)**: the editor's save path drops a mixed file's per-line endings
and rewrites them to the dominant one, against 016 FR-023b. R6 point 4 fixes it, because FR-011
requires it.

Post-design re-check: unchanged. The design adds three IPC invocations, one relay field set, four
commands, one `SaveReason`, one `FailedCommit` reason, and optional layout/recovery fields. Each is
covered above.

## Project Structure

### Documentation (this feature)

```text
specs/059-native-encodings-line-endings/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── editor-encoding.md
├── checklists/requirements.md
└── tasks.md            # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── editor/text-fidelity.ts        # detectTextFormat, decode/encode for 5 formats, findUnrepresentable,
│                                  # UnrepresentableTextError, encodingLabel, lineEndingLabel, refusalMessage
├── editor/index.ts, index.ts      # re-exports
├── workspace/model.ts             # EncodingId widened; EditorPanelConfig.encodingChosen
└── config/keybindings.ts, keybindings-metadata.ts   # four ActionIds, EDITOR_ONLY, unbound

packages/ui/src/main/
├── editor-service.ts              # load(forcedEncoding?), keeps mixedLineEndings, SaveReason 'unrepresentable'
├── document-authority.ts          # line format, savedLineFormat, convertLineEndings, format-aware dirty/undo
├── undo-service.ts                # UndoEntry.format
├── editor-coordinator.ts          # encodingChosen, save from authority format, reopen/saveWithEncoding
├── editor-ipc.ts                  # toMeta widened; two new channels
├── editor-recovery.ts             # snapshot format fields
├── text-file-rewrite.ts, file-search-service.ts, replace-commit-service.ts   # detection + own-encoding writes
└── (preload) editor bridge        # two new calls

packages/core/src/editor/undo-persistence.ts   # serialise UndoEntry.format

packages/ui/src/renderer/
├── editor/status-strip.tsx, status-strip-fit.ts   # indicators + hide order
├── editor/encoding-picker.tsx                     # modelled on language-picker
├── editor/encoding-save-banner.tsx                # FR-022 banner via panel-failure-banner
├── editor/content-menu.ts, use-editor.ts, commands.ts   # four commands, menu items, display copy
├── editor/editor-missing-notice.ts, preview/preview-notice.tsx, find-in-files/commit-replace.ts,
│   preview/task-toggle.ts                          # refusal wording from core's table
└── global.d.ts                                     # EditorLoadResult.encoding widened, new bridge calls

docs/key-bindings.md, docs/preferences.md, docs/architecture.md
```

**Structure Decision**: existing packages only. Core owns formats; main owns state; the renderer
displays and dispatches.

## Complexity Tracking

No constitution violations.

## Iteration 2026-10-25 — FR-054

Hand-testing MT-02 found refused opens with different errors merged into one notice under the first
error's sentence. FR-054 adds the error to the consolidation key (research R16). Touch-points:

- `packages/core/src/notice/grouping.ts` — `groupKey` takes the failure's `message`; inside the
  operation branch the key gains the cause key when there is a cause, else the message.
- `packages/ui/src/renderer/workspace/operation.ts` — `operationGroupKey(projectId, error)` passes it on.
- `packages/ui/src/renderer/workspace/panel-failure-notice.ts` — both raise sites pass their cause and
  message.

No main-process, IPC or E2E change. Constitution check unchanged: no violations.

## Iteration 2026-10-25, round 2 — FR-055 to FR-061

Research R17 holds the design. Touch-points:

- **Core** — `editor/document-sync.ts`: `mapLineEndings(format, oldDoc, changes, insertedEnding)`, the pure
  per-break record mapping (FR-061), and `DocEncoding {encoding, hasBom}`. `editor/undo-persistence.ts`:
  serialised entries carry `encoding?: {before, after}`. `config/keybindings.ts` + `keybindings-metadata.ts`:
  `editor.saveWithEncoding` → `editor.changeEncoding`; add `editor.convertLineEndingsToCr`,
  `editor.insertLineBreakLf` / `Cr` / `Crlf`, `editor.toggleWhitespace`. `config/settings-metadata.ts` and the
  settings schema: `editor.defaultShowWhitespace` (boolean, default false). `workspace/model.ts`:
  `EditorPanelConfig.showWhitespace?`.
- **Main** — `document-authority.ts`: the authority owns the encoding beside the line format (dirty,
  undo, redo, reset, save); `dispatch` maps the record through every change; `changeEncoding`,
  `insertLineBreak`, `convertLineEndings('cr')`. `undo-service.ts`: `UndoEntry.encoding?`.
  `editor-coordinator.ts`: reads encoding from the authority; `changeEncoding`, `insertLineBreak`;
  `saveWithEncoding` removed once the renderer stops calling it. `editor-ipc.ts`, `preload.cts`,
  `global.d.ts`: `throng:editor:changeEncoding`, `throng:editor:insertLineBreak`; convert accepts `cr`;
  `saveWithEncoding` removed.
- **Renderer** — the encoding indicator's menu and the content menu's **Encoding** list call Change
  Encoding; **Line Endings** lists LF / CR / CRLF / Mixed plus the three insert items; View Whitespace:
  a status-strip toggle beside wrap, a content-menu item, a per-panel config flag defaulting from the
  preference, and a CodeMirror extension drawing the symbols.
- **Docs** — key-bindings, preferences, architecture, quick-start.
