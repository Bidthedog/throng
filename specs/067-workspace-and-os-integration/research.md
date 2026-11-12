# Research: Workspace polish and OS integration

## D1. File lists on the OS clipboard (#8, FR-002, FR-003, FR-006, FR-013)

**Decision**: Use Electron 44's `clipboard.write` / `clipboard.read`. A file list is written as `text/uri-list`, which Chromium turns into `CF_HDROP` on Windows and `text/uri-list` on Linux, with the cut intent in a raw format beside it: `electron application/osclipboard;format="Preferred DropEffect"` (a 32-bit little-endian value, 2 = move, 5 = copy) on Windows, and `x-special/gnome-copied-files` plus `application/x-kde-cutselection` on Linux. Every format name lives in one codec per OS (`platform-windows`, `platform-linux`). `IClipboard` gains `writeFileList` and `readFileList`.

**Rationale**: Electron's own documentation names `text/uri-list` as what places real file references on the OS clipboard, and raw formats round-trip through the same string. No FFI is needed, so both OSes share one implementation over two codecs. GNOME Files and Nemo read `x-special/gnome-copied-files`; Dolphin reads the KDE marker.

**Alternatives rejected**: `OpenClipboard` / `SetClipboardData` through koffi (a Windows-only FFI path with no Linux counterpart, and it cannot be exercised on the Linux workstation); a raw format named `CF_HDROP` (Chromium registers a new format of that name, not the predefined one).

## D2. Inbound paste and drop run through the transfer engine (#8, FR-007 to FR-011)

**Decision**: Inbound work uses `TransferService` as a job whose sources lie outside any project, recorded as a `paste` undo entry. The target is resolved by main and refused when outside a project root (FR-007). Collisions, partial failure, undo and progress are the engine's own.

**Rationale**: One engine gives FR-008, FR-009 and FR-011 for free and keeps the quit gate honest.

## D3. Which clipboard a Paste uses (FR-006, FR-014)

**Decision**: `FileClipboardService` remembers the file list it last placed on the OS clipboard. At Paste, main reads the OS list: unchanged means the internal clipboard pastes as today; a different list means an inbound paste from the OS, and any internal cut record is dropped; no file list means an internal record is stale and is cleared, leaving Paste unavailable.

**Rationale**: This is 016 FR-015c's check, widened to file lists, with the OS clipboard as the authority on what was last copied anywhere.

## D4. Outbound drag (#8, FR-005)

**Finding**: Electron's only route to a file drag is `webContents.startDrag`, called from `dragstart` in place of the HTML5 drag. Its source (`shell/browser/ui/drag_util_views.cc`, v44.10.2) offers `DRAG_COPY | DRAG_LINK` and nothing else, so **a drag started through Electron can never be a move**. It also replaces the HTML5 drag for that gesture, and the tree's internal move, the drop on a terminal and the drop on a panel are all HTML5 drags (react-dnd, native `dragover` / `drop`), so **one gesture cannot be both**.

**Decision**: Outbound drag starts from a dedicated grip on the row and is delivered as a copy on both OSes. A drag of the row itself stays internal (FR-014). The move case stays open: see Complexity Tracking in [plan.md](plan.md).

**Alternatives rejected**:

- `SHDoDragDrop` through koffi: it offers a move on Windows only, needs a COM call to set the preferred effect, and cannot be run on the Linux workstation. A wrong signature crashes the app on drag.
- Replacing the HTML5 tree drag with a pointer-driven backend, so the gesture can hand over at the window edge: rewrites every internal drag target and every E2E that drives them, against FR-014.
- `DownloadURL`: one file only, Windows only, and it downloads rather than transfers.
- `text/uri-list` from `dragstart`: Chromium keeps one URL, and Windows turns it into an Internet shortcut.

## D5. Inbound drop on the tree (FR-004, FR-005a, FR-012, FR-014)

**Decision**: Window-level `dragover` / `drop` listeners, beside the existing ones in `file-tree.tsx`, handle `Files` drags. A row under the pointer gives the folder target (a file row gives its parent). A pure rule, `resolveInboundDragEffect`, maps live modifiers to `copy` or `move`, defaulting to copy, and `dropEffect` shows it. The path extraction from `drop-target.tsx` moves to a shared helper that both callers use.

**Elevated Windows**: the OS blocks the drag before throng receives any event, so a blocked drag cannot be observed. When throng runs elevated, the tree raises one notice per session, the first time it mounts, saying dragging in is blocked and Paste still works.

## D6. `throng <path>` (FR-022 to FR-028, FR-036)

**Decision**: `LaunchMessage` gains an optional absolute `folder`, resolved against the launching process's working directory before it is sent. A pure parser takes the first positional argument, skipping switches and, in a development run, the app entry. Main keeps a queue of folder requests, drained into the main window once it has loaded. The renderer classifies each with a pure rule against the project list (`already`, `inside`, `contains`, `add`), and holds requests while a modal is open. A primary past the point of no return stops answering so a late launch becomes the new primary.

## D7. File-manager registration (FR-029 to FR-034)

**Windows**: `Software\Classes\Directory\shell\throng.OpenProject` and `Directory\Background\shell\throng.OpenProject`, under `HKCU` or `HKLM` by install scope, with `"<exe>" "%V"` (the classic verb, FR-030). NSIS gets a custom page with two ticked boxes; the MSI gets properties `THRONG_OPEN_AS_PROJECT` and `THRONG_ADD_TO_PATH`, both defaulting to `1`, through `msi-project.cjs`. The MSI has no options dialog, so its properties are the option.

**Linux**: the package installs a Nemo action (`/usr/share/nemo/actions/`), a Dolphin service menu (`/usr/share/kio/servicemenus/`) and a `MimeType=inode/directory` desktop entry, which is how GNOME Files offers an application for a folder without a Python extension. The preference writes a same-named override under `~/.local/share/` marked `Active=false` (Nemo) or `Hidden=true` (the other two), which each file manager honours per user with no prompt (FR-034).

**GNOME Files is weaker than the other two**: a package can add an application to its Open With list, named "Open as throng project", but a context-menu item of its own needs a `nautilus-python` extension, which is a Python file and cannot be kept in this repository. The hand-test plan checks what GNOME Files actually shows.

**Port**: `IFileManagerRegistration` (`status`, `setEnabled`) with an implementation per OS. A machine-wide Windows registration reports `machine-wide` and is not changed.

## D8. Closing overlay (FR-037 to FR-044)

**Decision**: A pure `ShutdownRun` in core holds the task list, the current index, cancellation and the time estimate. Main drives it. The tasks are those that already run: one block per project with terminals to end (`terminal.killAll` gains an optional project filter, so the work is the same and can be reported in parts), the window drain, and the quit. Cancel waits up to 5 seconds for the current task, then abandons it and runs nothing further. `allowClose` is the point of no return. `markAppTerminating` becomes reversible for Cancel.

## D9. Properties (FR-045 to FR-055)

**Decision**: A `properties-service` in UI main does an asynchronous walk with `fs.opendir`, batching progress every 100 ms, cancelled through `AbortSignal`, cached for 60 seconds by normalised path. A new port `IFileAttributes` reads OS attributes (`GetFileAttributesW` through the existing koffi seam on Windows; the mode bits and a leading dot on Linux). `IOsPropertiesDialog` is `ShellExecuteExW` with the `properties` verb on Windows and reports absent on Linux.

## D10. Per-project side panes (FR-056 to FR-060)

**Decision**: `WorkspaceLayout` gains optional `sidePanes: { projects: boolean; files: boolean }`, stored in the existing layout blob, so it is deleted with the project and needs no migration. Absent reads as both expanded (FR-057). With no active project, the existing `localStorage` flags stand (FR-059). The width-derived `autoLeft` / `autoRight` flags are untouched and never written (FR-058).

## D11. Terminal form history (FR-061 to FR-068)

**Decision**: A JSON file in the user data folder, owned by a `form-history-service` in main, written atomically, keyed by flavour id and field. Pure list rules live in core. Two settings: `terminals.formHistory.enabled` and `terminals.formHistory.maxEntries`.

**Rationale**: It is a small bounded list, needs no query and no migration, and must be reachable from the Preferences window as well as the workspace.

## D12. Smaller items

- **Save icons (FR-069 to FR-074)**: two icon tokens in the header, driven by the same `getEditorActions` as the chords. The header's existing narrow-width handling hides Save As first, then Save.
- **`tabs.rename` (FR-075 to FR-081)**: window scope, dispatched as `panel.destroy` is, so a terminal receives nothing. Constitution v6.4.0 records the exception (MINOR: additive).
- **Create sub-workspace (FR-082 to FR-087)**: a new daemon method `subworkspace.create`, seeded through the same naming and palette helpers.
- **Front matter links (FR-088 to FR-094)**: scalars and sequence items that contain a link are rendered through the body's own inline pipeline and sanitiser, so behaviour cannot drift. Others stay text nodes.
- **Total lines (FR-095 to FR-100)**: one more segment in `status-strip`, reading `document-metrics`.
- **Linux old-version rule (FR-101 to FR-104)**: 063 gains its requirement, D2 cites it, the docs say it, and a test drives `after-install.sh` under `THRONG_PACKAGE_TEST_PREFIX`.

## D21. Mouse-driven tree drags (FR-110)

**Decision**: a custom react-dnd backend (`packages/ui/src/renderer/explorer/tree-pointer-backend.ts`), about the size of its job: drag start past a 4 px threshold, hit-testing registered targets with `elementsFromPoint`, drop, cancel.

**Rationale**: react-arborist 3.16 takes `dndBackend`, so its sources, drop computation, cursor and preview are kept. Owning the backend puts the key handling, Esc, edge scroll and window-leave in one place.

**Alternatives rejected**: `react-dnd-touch-backend` with mouse events adds a dependency and still needs all four of those added around it.

## D22. Targets outside the tree

**Decision**: replay the drag to them as constructed `DragEvent`s.

**Rationale**: every one reads `getTreeDrag()` and answers through `setTreeDropEffect`, none reads the OS drag, so their code and tests stay. Replacing them would touch six components for no change in behaviour.

## D23. Handing over at the window edge (FR-114)

**Finding**: `webContents.startDrag` is documented for use from `dragstart`. Starting it from a pointer event mid-press is unproven, most of all on native Wayland, where a drag needs the serial of the press.

**Decision**: build it, and take MT-02 step 11 as the proof. It is one call: if it does not work, FR-114 is reported as not delivered and everything else stands.

## D24. Preferences and About on Linux (007 FR-013)

**Finding**: both windows pass `parent`, and `floating-window-layering` scopes `setAlwaysOnTop`. Stacking under a Wayland compositor is not readable from the app, so the report could not be reproduced here.

**Decision**: no speculative change. MT-19 is run in both display modes to separate a throng defect from a native Wayland limit.

**D24 finding, 2026-11-09**: `preferences-window.ts` and `about-window.ts` both pass `parent`. Published Electron and Wayland material documents the `parent` contract and lists Wayland API gaps, but nothing found states whether native Wayland honours it. MT-19 step 3 separates the two display modes.

## D25. Preferences and About on native Wayland (007 FR-013, MT-19)

**MT-19 result, 2026-11-10**: on GNOME native Wayland both windows go behind the main window when it is clicked. Under XWayland they stay above it.

**Finding** (Electron v44.11.0, Chromium 152.0.7977.169, read at source):

- Electron applies `parent` on Linux through X11 alone. In `shell/browser/native_window_views.cc`, `params.parent = parent->GetNativeWindow();` is inside `#if BUILDFLAG(IS_WIN)`, and `SetParentWindow` sets `WM_TRANSIENT_FOR` only `if (x11_util::IsX11())`. There is no Wayland branch, on the release tag or on main.
- Chromium's Ozone Wayland never calls `xdg_toplevel_set_parent` for a top-level window. `wayland_window_factory.cc` uses `parent_widget` only for popups, bubbles, menus and tooltips, and `XdgToplevel::SetSystemModal` is an empty stub with a TODO for xdg-dialog-v1 (crbug.com/378465003).
- `modal: true` and `type: 'dialog'` are applied only on X11. `alwaysOnTop` is documented as not supported on Wayland. Electron PR 54427, backported to 44-x-y as PR 54447, stops a modal's parent taking input on Wayland, but does not restack anything.
- Related upstream reports, both closed without a fix: electron#52349 (file dialogs behind their parent on GNOME Wayland) and electron#50403 (setAlwaysOnTop on Wayland).

**Conclusion**: with separate top-level windows, Electron 44 cannot keep Preferences and About above the main window on native Wayland. The compositor is never told they belong to it. This is a platform limit, not a throng defect that code in throng's main process can fix.

**Options**, a product decision for the maintainer:

1. Keep separate windows. Document the limit in `docs/linux.md`, and point to the XWayland display mode, where they behave.
2. Draw Preferences and About inside the main window, as an overlay or a child view, on native Wayland only or everywhere. This is a larger change to 007 and 021.
3. Wait for upstream: Chromium must send `xdg_toplevel.set_parent` (or implement xdg-dialog-v1), and Electron must pass the parent on Linux.

T140 stays open until one is chosen.

**Decision, 2026-11-12**: option 1. The maintainer keeps separate windows; the limit is documented in `docs/linux.md` and in the `window.nativeWayland` description, beside native Wayland's one gain (dragging files out to GNOME Files, which under XWayland delivers nothing).
