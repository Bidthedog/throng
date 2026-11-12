# Implementation Plan: Workspace polish and OS integration for v1.0.0

**Branch**: `feature/S067-workspace-and-os-integration` | **Date**: 2026-11-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/067-workspace-and-os-integration/spec.md`

## Summary

Fourteen stories across the File Explorer, panels, shutdown and packaging. File lists cross the OS clipboard through Electron's own formats behind a per-OS codec, and inbound work runs through the existing transfer engine. A launch can carry a folder through the existing instance guard. Shutdown becomes a cancellable, reported run over the same tasks. The rest are additions to existing surfaces. Decisions are in [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 7, Node 24, Electron 44, React 19

**Primary Dependencies**: existing only (koffi on Windows for `GetFileAttributesW` and `ShellExecuteExW`)

**Storage**: the layout blob in SQLite for side panes; a JSON file in user data for form history; settings in `settings.json`

**Testing**: Vitest unit, component, integration and contract. No new E2E: every outcome is observable lower, and real file managers are the hand-test plan's job (FR-109)

**Target Platform**: Windows and Linux, together (Principle II)

**Project Type**: desktop app (Electron main, renderer, detached daemon)

**Performance Goals**: Properties opens within 200 ms; 100,000 entries sized within 15 seconds with no input waiting over 100 ms; the total-lines readout adds nothing to the typing path

**Constraints**: Cancel returns within 6 seconds in every run; no OS format name outside the platform layer (FR-013); internal drags unchanged (FR-014)

**Scale/Scope**: 14 stories, FR-001 to FR-134 (as of 2026-11-12)

## Constitution Check

| Principle | How this holds |
|---|---|
| I Project-first | inbound targets must lie in a project root; `throng <path>` uses the existing add-project validation, and a folder containing a project is refused |
| II Platform abstraction | clipboard codecs, file-manager registration, attributes and the OS properties dialog are ports with both OS implementations; see Complexity Tracking for the outbound move |
| III Terminals | Cancel never ends a terminal that was not already being closed; a running terminal receives no bytes for the new chord |
| IV Keyboard tiers | `Ctrl+Shift+Alt+F2` is recorded as an exception in v6.4.0, in the `Ctrl+Shift+Alt+F4` form |
| V Testing | failing test first at the lowest layer that shows it; a repro test for each behaviour change |
| VI UX | icons are themed tokens; every action has a menu item; quantities go through `formatGrouped` |
| VII Change review | no change to what the user approves before it applies |
| VIII SOLID, DRY, YAGNI | one transfer engine, one path extractor; ports exist because both OSes differ |
| IX DI | each port is bound in the composition root |
| X Configuration | five settings, each with a descriptor, a default, an editor and a reader |
| XI Workspace | a created sub-workspace owns exactly one untyped panel |
| XII Responsive | the size walk and history I/O are asynchronous, in main |
| XIII Failure trace | each failure logs and raises one notice |

## Project Structure

### Documentation

```text
specs/067-workspace-and-os-integration/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/ipc.md
└── tasks.md
```

### Source Code

```text
packages/core/src/
├── abstractions/   clipboard.ts, file-manager-registration.ts, file-attributes.ts, os-properties-dialog.ts
├── explorer/       inbound-drag.ts, paste-source.ts, properties.ts
├── projects/       launch-folder.ts, open-folder.ts
├── workspace/      shutdown-run.ts, model.ts
├── terminal/       form-history.ts
└── config/         settings, keybindings, theme and icon tokens
packages/platform-windows/src/  windows-file-list-codec.ts, windows-file-manager-registration.ts, windows-file-attributes.ts, windows-os-properties-dialog.ts
packages/platform-linux/src/    linux-file-list-codec.ts, linux-file-manager-registration.ts, linux-file-attributes.ts, linux-os-properties-dialog.ts
packages/platform/src/          index.ts (selects each OS's implementation)
packages/ui/src/main/           electron-clipboard.ts, memory-clipboard.ts, file-clipboard.ts, transfer-ipc.ts, transfer-service.ts,
                                files-ipc.ts, os-drag.ts, instance-guard.ts, open-folder-queue.ts, shutdown-driver.ts, properties-service.ts, form-history-service.ts
packages/ui/src/preload/        preload.cts
packages/ui/src/renderer/       common/os-drop-paths.ts, explorer/, app-close-prompt.tsx, panel-type/terminal-inputs.tsx, workspace/, sidebar/subworkspaces-panel.tsx,
                                preview/providers/markdown/, editor/status-strip*, preferences/
packages/daemon/src/            subworkspace-service.ts, terminal-service.ts
packaging/                      installer.nsh, msi-project.cjs, linux/
```

**Structure Decision**: The existing monorepo. Nothing new at package level.

## Delivery order

1. Core rules, ports and config (pure, unit-tested).
2. Platform implementations and main-process services.
3. Renderer surfaces, against [contracts/ipc.md](contracts/ipc.md).
4. Packaging, documentation and the spec 063 amendment. The constitution amendment (T095) ships with US9, the story it records.

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| **FR-005, and FR-001 for that gesture: a move-modifier drag to the OS delivers a copy, and an outbound drag starts from a grip on the row rather than from the row itself.** The FR-005 move stays open as task T033, and is reported to the maintainer. | Electron's `startDrag` offers copy and link only, and it replaces the HTML5 drag that every internal target relies on (research D4). | `SHDoDragDrop` covers Windows only and cannot be run here. A pointer-driven tree drag rewrites every internal drag target, against FR-014. |
| **FR-012: a blocked drag cannot be observed, so the notice appears once per elevated session instead of at the moment of the drag.** | Windows withholds every drag event from an elevated window (research D5). | None: there is no event to react to. |

## Iteration of 2026-11-09 (FR-110 to FR-127, SC-014)

Counts above are as of 2026-11-08. Now 14 stories, 127 numbered requirements, five settings (Principle X holds: `explorer.openUnsupportedInOs` has a descriptor and a toggle). New files: `packages/ui/src/renderer/explorer/tree-pointer-backend.ts`, `packages/core/src/abstractions/file-access-info.ts`, its Linux and Windows implementations. Existing E2Es are updated; none is added.

**Complexity row 1 above is superseded.** The grip is gone and T033 is closed by FR-114. The remaining deviation: the OS hand-over is copy-only (Electron) and unproven until MT-02 step 11 (D23).

Same stack and constitution check as above. Nothing here adds a package, a process or a dependency.

- **Mouse-driven tree drags (FR-110 to FR-114)**: a react-dnd backend of throng's own, passed to react-arborist through its `dndBackend` prop, so the tree's sources, targets, cursor and preview stay as they are. Research D21.
- **Targets outside the tree**: the six existing `onDragOver` / `onDrop` handlers are kept. While the pointer is outside the tree the backend dispatches constructed `dragenter`, `dragover`, `dragleave` and `drop` events at the element under it, and reads the claimed effect with `takeTreeDropEffect`. Research D22.
- **The real pointer (FR-112)**: `data-tree-drag` on the root element, with CSS forcing `copy`, `move` or `not-allowed` on everything for the drag's length. No OS drag is running, so CSS decides it.
- **Hand-over (FR-114)**: the pointer leaving the window ends the internal drag and calls the restored `files.startOsDrag`, while the button is still held. Unproven until MT-02 step 11: Research D23.
- **Replaced by the above**: the web `dragstart` / `dragover` / `dragend` listeners for tree drags, `DragModifierLatch`, the label's drag-surface image, and the label for tree drags. The label stays for OS-inbound drags (FR-115).
- **Double-click to the OS (FR-116, FR-117)**: setting `explorer.openUnsupportedInOs`. A double-click on a file checks with the editor's existing load refusal and routes a `binary` refusal to the existing Open in OS Default Program path.
- **Disk icons (FR-118)**: the `save` and `saveAs` tokens' glyphs, in the base theme.
- **Properties (FR-119 to FR-122)**: `ItemProperties.access` from a new per-OS abstraction `IFileAccessInfo`. The dialog drops Close and the OS reason line, gains the X, the scrim and per-value copy.
- **Front matter (FR-123)**: the scalar linker in the Markdown pipeline resolves relative targets as a body link does.
- **Sub-workspace (FR-124)**: `create` returns the new id and the panel enters its existing inline rename.
- **Status strip (FR-125, FR-126)**: the segment texts, widths re-measured by the existing fit.
- **Popup (FR-127)**: `status-popover.tsx` closes on click.
- **007 FR-013 on Linux**: both windows are already parented. Whether native Wayland honours that cannot be read programmatically, so MT-19 is run under XWayland and native Wayland before any change. Research D24.

## Iteration of 2026-11-10 (FR-128 to FR-132, SC-015)

Same stack and constitution check. Nothing here adds a package, a process, a dependency or a setting.

- **Properties last (FR-128)**: the Properties entry moves to the end of `buildContextMenuItems` in `packages/ui/src/renderer/explorer/context-menu-items.ts`, after every other section.
- **Down arrow (FR-129)**: `history-input.tsx` opens its list on Down whatever the field holds; an empty field lists the whole history.
- **Clear control placement (FR-130)**: `settings-tab.tsx` renders `FormHistoryControl` inside the Terminal group, after the two `terminals.formHistory.*` rows, and drops its own section. Search still finds it.
- **Clearing reaches open forms (defect, FR-064b, FR-066)**: main announces a change to the stored history; `use-form-history.ts` re-reads on it. One new main-to-renderer event beside `formHistory.get`.
- **Ctrl+click to the OS (FR-131)**: `followLink` in `links/link-actions.ts` (the editor and terminal route) and the preview's `openedInEditor` route both ask, for an in-project file the click rule sends to the editor, whether the editor refuses it as binary (`openDecisionFor`), and with `explorer.openUnsupportedInOs` on send it to the OS default program instead. A file whose default open action is its preview is unaffected, as in FR-116.
- **Front matter link forms (FR-132, SC-015, and the FR-123 defect)**: `linkedInline` in `preview/providers/markdown/pipeline.ts` first asks the editor's grammar (`scanLinkLine` from `@throng/core`, with the protocol allowlist) whether the WHOLE value is one link span. If it is, the cell renders a link whose follow goes through the editor's route (`followLink`), so positions, `~/`, absolute paths, `file:` URIs and allowlisted protocols resolve exactly as in the editor. A whole-value `#anchor` renders as the body's heading link. Otherwise the existing body-pipeline linking applies unchanged. The body preview does not change. The whitespace rule is FR-132's note.
- **007 FR-013 on native Wayland (defect)**: per research D25.

## Iteration of 2026-11-12 (FR-133, FR-134)

Constitution Check: unchanged. Both additions refine existing surfaces; no new setting, binding, theme token or package.

- **Delete one remembered value (FR-133)**: `HistoryInput` takes an `onRemove` callback; Delete on the highlighted option calls it, keeps the highlight at the same index (the next value), clamps it to the new end, and closes the list when it empties. `use-form-history.ts` removes the value from its own lists at once and asks main to forget it. `FormHistoryService.removeValue(flavourId, field, value)` writes the file and announces the change, so every open form re-reads through T136's event. One new renderer-to-main message, `formHistory.removeValue` (contracts/ipc.md). The Delete key is the combobox's own list key, like Down, Up, Enter and Esc in the same component, not a rebindable command.
- **Full stops after the column and the selected count (FR-134)**: `readoutText` in `editor/status-strip.tsx` ends the column readout and the selected readout in a full stop, and the line readout in one when it stands alone. `READOUT_LABELS.selected` keeps `selected` / `sel`; the stop is added with the figure, as the line's comma is. The fit measures the drawn text, so the widths follow.

### Second round of 2026-11-12 (FR-135, FR-136)

- **List on focus (FR-135)**: `HistoryInput` opens its list on focus and on a click, unfiltered, and tracks whether the user has typed since it opened; only then does it filter by the text. Picking still replaces the text. Esc closes until the next focus or click.
- **Multi-line position (FR-136)**: `publishCaret` in `use-editor.ts` publishes, for a selection across lines, the first and last line (the last stepping back when the selection ends at a line's start) and the selection's start column. The caret store carries the line range; `statusReadouts` draws `Ln 3-5,` and `Col 4.` from it.
