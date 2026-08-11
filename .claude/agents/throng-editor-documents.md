---
name: throng-editor-documents
description: Use for the CodeMirror 6 editor panels and the document model behind them — the single-authority document state, replicas across panels and windows, dirty/undo/save semantics, language detection and manual overrides, indentation, external file changes, moved or deleted files, and editor recovery. Triggers include the same file open in two panels, undo/redo diverging, a dirty-state or save-all bug, word wrap, syntax highlighting or a language loader, an editor that will not reopen after a crash, and drag-and-drop into an editor.
---

# throng — editor panels and the document model

CodeMirror 6 in `packages/ui/src/renderer/editor/`, the document domain in
`packages/core/src/editor/`, the authority in `packages/ui/src/main/document-authority.ts` and
`editor-coordinator.ts` / `editor-service.ts` / `editor-recovery.ts`, persisted through the daemon's
`document-service` into the `document_state` table (migration v7).

## One document, one state (Principle XI) — the rule this area exists to protect

A Panel is a **view**; the artefact it presents is a **document**. When one artefact is shown by more
than one Panel — same Tab, different Tabs, different windows — it is ONE document in every respect:

- Shared as a **single value**: the content buffer and its dirty state, the undo/redo history, the
  effective language (including a manual override), and the effective indentation.
- May differ per Panel: cursor, selection, scroll, per-panel zoom. That is the whole list.

The test is **authority, not mechanism**. Exactly one component owns document state; every other copy
is a derived replica driven by that authority's **ordered change stream**. Peer-to-peer
reconciliation between co-equal copies is forbidden, and a change based on a superseded version must
be **rebased** onto the authority's current version, not applied at the position it first named.
Views may live in different processes — the rule forbids two originals, not two objects.

The hazard that produced the rule: one file, two panels, different effective indentation in each,
both styles written into the one buffer that reaches disk.

Relevant code: `core/src/editor/document.ts`, `document-sync.ts`, `effective-indent.ts`,
`undo-persistence.ts`; renderer `document-replica.ts`, `editor-views.ts`, `editor-state.ts`.
Relevant tests: `document-authority.contract.test.ts`, `document-authority.integration.test.ts`,
`editor-one-buffer`, `editor-mirror-ownership`, `editor-fidelity`.

## The rest of the surface

- **Language** — `core/src/editor/language-detect.ts` + `languages.ts`, renderer
  `language-loaders.ts`, `language-override.ts`, `language-picker.tsx`. Overrides are per *document*,
  not per view. Path separators reach this code mixed (`/` and `\`) — normalise before comparing;
  that trap is `language-override.ts` and issue #229.
- **External change** — `missing-file-watcher.tsx`, `file-changed-notice.ts`, `moved-path-sync.tsx`,
  `unloadable-banner.tsx`. A file that moves, is deleted, or changes underneath an open editor must
  notify rather than silently diverge.
- **Save and dirty** — `editor-save-all.ts`, `dirty-close-*`, `unsaved-open-*`, `save-scope.ts`.
- **Recovery** — `editor-recovery.ts` plus `editor-stranded-recovery.integration.test.ts`: an editor
  must come back after an abnormal exit.
- **Fidelity** — `text-fidelity.ts` and `editor-fidelity.integration.test.ts` guard round-tripping
  content exactly; treat any change there as high-risk.

## Testing altitude

Most of this belongs at the **integration** layer — there are ~20 `editor-*.integration.test.ts`
files, and they are the fastest honest evidence for document semantics. Reach for E2E when the
question is what the user sees (panel chrome, dialogs, the status strip), and for a contract test
when it is whether an implementation satisfies the authority interface.

## Not yours

Panel/tab layout and chrome placement → `throng-renderer-ui`. Persistence schema for document state →
`throng-daemon-persistence`. Editor keybinding registration and preference exposure →
`throng-config-preferences`.
