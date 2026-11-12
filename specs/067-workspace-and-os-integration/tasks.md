# Tasks: Workspace polish and OS integration for v1.0.0

**Input**: `specs/067-workspace-and-os-integration/`: [plan](plan.md), [spec](spec.md), [research](research.md), [data model](data-model.md), [contract](contracts/ipc.md), [quickstart](quickstart.md)

**Tests**: required by Principle V, test-first. Each implementation task follows the failing test that proves it, at the layer named. The repo has unit, component, integration, contract and E2E layers; this feature adds no E2E (plan, Technical Context).

## Format: `[ID] [P?] [Story] Description`

## Phase 1: Setup

No setup: the monorepo, its test layers and its tooling already exist.

## Phase 2: Foundational (blocks every story)

- [x] T001 [P] Failing unit test in `packages/core/tests/unit/settings-067.test.ts`: the four keys in data-model.md *New settings* exist with those types and defaults, `terminals.formHistory.maxEntries` declares "integer 1 to 50" on its descriptor and defaults to 10 (FR-064), and each has a descriptor (FR-105)
- [x] T002 Add the four settings to `packages/core/src/config/app-settings.ts` and `packages/core/src/config/settings-metadata.ts`, and regenerate shipped defaults with `npm run generate:defaults`, making T001 pass
- [x] T003 [P] Failing unit test in `packages/core/tests/unit/icon-tokens-067.test.ts`: icon tokens `save`, `saveAs`, `dragOut` exist in every shipped theme, with Themes editor copy (FR-074)
- [x] T004 Add those tokens to `packages/core/src/config/theme.ts` and `packages/core/src/config/theme-copy.ts`, making T003 pass

**Checkpoint**: settings and tokens exist for every story.

## Phase 3: User Story 1 — Move files between throng and the OS (P1) 🎯 MVP

**Goal**: cut, copy, paste and drag across the OS boundary. **Independent test**: spec US1.

### OS clipboard

- [x] T005 [US1] Shared contract suite `packages/core/src/testing/file-list-codec-contract.ts`, exported from `packages/core/src/testing/index.ts`: an encoded list decodes to the same paths and intent for spaces, non-ASCII and several items; a payload with no file list decodes to `null` (FR-001)
- [x] T006 [P] [US1] Failing unit test `packages/platform-windows/tests/unit/windows-file-list-codec.test.ts` running T005, plus `Preferred DropEffect` is 32-bit little-endian 2 for cut and 5 for copy
- [x] T007 [P] [US1] Implement `packages/platform-windows/src/windows-file-list-codec.ts` and export it from `packages/platform-windows/src/index.ts`, making T006 pass
- [x] T008 [P] [US1] Failing unit test `packages/platform-linux/tests/unit/linux-file-list-codec.test.ts` running T005, plus the `x-special/gnome-copied-files` body (`cut\n<uris>` / `copy\n<uris>`) and `application/x-kde-cutselection`
- [x] T009 [P] [US1] Implement `packages/platform-linux/src/linux-file-list-codec.ts` and export it from `packages/platform-linux/src/index.ts`, selected in `packages/platform/src/index.ts`, making T008 pass
- [x] T010 [US1] Extend `packages/core/src/testing/clipboard-contract.ts` with `writeFileList` / `readFileList` cases, failing against `packages/ui/tests/contract/electron-clipboard.contract.test.ts` and `memory-clipboard.contract.test.ts`
- [x] T011 [US1] Add the members to `packages/core/src/abstractions/clipboard.ts`; implement them in `packages/ui/src/main/electron-clipboard.ts` (over the injected codec) and `packages/ui/src/main/memory-clipboard.ts`, binding the codec in `packages/ui/src/main/composition-root.ts`, making T010 pass
- [x] T012 [P] [US1] Unit guard `packages/ui/tests/unit/no-os-clipboard-formats.test.ts`: `text/uri-list`, `gnome-copied-files`, `x-kde-cutselection` and `Preferred DropEffect` appear in no source outside `packages/platform-windows` and `packages/platform-linux` (FR-013)
- [x] T013 [P] [US1] Failing unit test `packages/core/tests/unit/paste-source.test.ts` for `decidePasteSource(internal, placed, osList)`: unchanged list → `internal`; a different list → `os`; no list with an internal record → `stale`; nothing anywhere → `none` (research D3, FR-006)
- [x] T014 [US1] Implement `packages/core/src/explorer/paste-source.ts` and export it, making T013 pass
- [x] T015 [US1] Failing tests in `packages/ui/tests/unit/file-clipboard.test.ts`: `setFromRelative` writes the OS list and remembers it, with the cut intent; clearing and a finished cut paste forget it (FR-003)
- [x] T016 [US1] Extend `packages/ui/src/main/file-clipboard.ts` to write and remember the list through `IClipboard`, making T015 pass

### Inbound paste and drop

- [x] T017 [US1] Failing integration test `packages/ui/tests/integration/transfer-inbound.test.ts` (real temp folders): an OS-sourced copy and move land in the target, collisions follow the internal rule (FR-008), FR-002's cut intent moves and its copy intent copies, undo and redo reverse and reapply (FR-009), a locked file, a permission failure and a partial copy each yield one failure with its cause (FR-011, FR-107), partial failure keeps what arrived and undo reverses only that, a folder into its own descendant is refused, and an outbound cut is never deleted by throng (FR-010)
- [x] T018 [US1] Add `inbound(windowId, sources, targetDir, mode)` to `packages/ui/src/main/transfer-service.ts`, recording a `paste` undo entry, making T017 pass
- [x] T019 [US1] Failing contract tests in `packages/ui/tests/contract/transfer-ipc.contract.test.ts` for `throng:fileClipboard:osFiles`, `throng:transfer:pasteAuto` and `throng:transfer:dropInbound`: a target outside any project root is refused with one error (FR-007), a malformed call changes nothing, and `pasteAuto` obeys T013's four outcomes
- [x] T020 [US1] Implement them in `packages/ui/src/main/transfer-ipc.ts`, wire them in `packages/ui/src/main/main.ts`, and expose them in `packages/ui/src/preload/preload.cts` and `packages/ui/src/renderer/global.d.ts`, making T019 pass
- [x] T021 [P] [US1] Failing unit test `packages/core/tests/unit/inbound-drag.test.ts` for `resolveInboundDragEffect(modifiers, config)`: none and the copy modifier → `copy`; the move modifier → `move`; a target outside a project → `none` (FR-004, FR-005a)
- [x] T022 [P] [US1] Implement `packages/core/src/explorer/inbound-drag.ts` and export it, making T021 pass
- [x] T023 [US1] Failing component test `packages/ui/tests/component/explorer-os-inbound.test.ts`: a `Files` drag over a folder row sets `dropEffect` from live modifiers and highlights the row, a file row targets its parent, a drop calls `dropInbound` with the extracted paths, a pathless drop raises one notice, a drop refused by `none` shows the not-allowed pointer (FR-005a), a tree drag is untouched, and a sub-workspace window has no inbound tree target to change (FR-014)
- [x] T024 [US1] Add `packages/ui/src/renderer/common/os-drop-paths.ts`, make `packages/ui/src/renderer/editor/drop-target.tsx` use it (FR-014), and add the inbound listeners to `packages/ui/src/renderer/explorer/file-tree.tsx`, making T023 pass
- [x] T025 [US1] Failing component test in `packages/ui/tests/component/explorer-paste.test.ts`: Paste calls `pasteAuto` and is available when `osFiles()` is true with no internal record (edge case: text-only leaves it unavailable)
- [x] T026 [US1] Route Paste through `pasteAuto` and availability through `osFiles` in `packages/ui/src/renderer/explorer/use-explorer-data.ts` and `packages/ui/src/renderer/explorer/context-menu-items.ts`, making T025 pass
- [x] T027 [US1] Failing component test `packages/ui/tests/component/explorer-elevated-drop-notice.test.ts`: an elevated Windows session raises the notice once when the tree mounts, a non-elevated one never does (FR-012, research D5)
- [x] T028 [US1] Raise that notice from `packages/ui/src/renderer/explorer/file-tree.tsx`, making T027 pass

### Outbound drag

- [x] T029 [US1] Failing component test `packages/ui/tests/component/explorer-drag-out-grip.test.ts`: the row's grip carries the `dragOut` icon and a title naming the action, its `dragstart` is prevented and sends the selection's paths when the row is selected, or that row alone, and never reaches react-dnd, with an accessible name (FR-108); the OS draws the pointer once the drag leaves throng (FR-005a)
- [x] T030 [US1] Add the grip to `packages/ui/src/renderer/explorer/tree-node.tsx` with a native `dragstart` listener, making T029 pass
  *T029 and T030 superseded by T119 to T123 (FR-114): the grip is removed.*
- [x] T031 [US1] Failing unit test `packages/ui/tests/unit/os-drag.test.ts`: `throng:files:startOsDrag` resolves relative paths against the active root, refuses paths outside it, and calls `startDrag` with `files` and an icon
- [x] T032 [US1] Implement `packages/ui/src/main/os-drag.ts`, wire it in `packages/ui/src/main/main.ts`, expose it in `packages/ui/src/preload/preload.cts`, making T031 pass
- [x] T033 [US1] **Open, needs the maintainer**: FR-005's move-modifier drag to the OS, and FR-005's drag of the row itself. Electron offers copy and link only, and one gesture cannot be both an HTML5 and a native drag (research D4)
  *Closed 2026-11-09, first as: FR-005 withdrawn by the maintainer (2026-11-09): no drag out to the OS. The grip from T029 and T030 was removed with it. Superseded by T119 to T123 (FR-114).*

## Phase 4: User Story 2 — Open in the registered program (P1)

- [x] T034 [P] [US2] Failing component test `packages/ui/tests/component/explorer-open-in-default.test.ts`: **Open in OS Default Program** is in the Open In submenu's OS section for one selected file, absent on a folder, a multi-selection and with the setting off (FR-015, FR-019, FR-021)
- [x] T035 [US2] Add it to `packages/ui/src/renderer/explorer/context-menu-items.ts`, making T034 pass
- [x] T036 [P] [US2] Failing unit test `packages/ui/tests/unit/panel-header-menu-open-default.test.ts`: the item is in the Navigate section for editor and preview panels on a file on disk, including a new preview provider with no code of its own, and absent with the setting off (FR-016, FR-017, FR-020, FR-021)
- [x] T037 [US2] Add it to `packages/ui/src/renderer/workspace/panel-header-menu.ts`, in the shared preview title menu, making T036 pass
- [x] T038 [US2] Failing contract test in `packages/ui/tests/contract/files-open-default.contract.test.ts`: `throng:files:openInDefaultProgram` resolves within the active root, and a refusal carries the path and the OS's reason (FR-018)
- [x] T039 [US2] Implement it in `packages/ui/src/main/files-ipc.ts` over `IShellIntegration.openWithDefaultProgram`, expose it in the preload, and raise the one notice in `packages/ui/src/renderer/explorer/use-explorer-data.ts`, making T038 pass

## Phase 5: User Story 3 — Open a folder from outside throng (P1)

- [x] T040 [P] [US3] Failing unit test `packages/core/tests/unit/launch-folder.test.ts` for `parseLaunchFolder(argv, cwd, packaged)`: relative resolves against `cwd`, switches are skipped, the development entry is skipped, none → `null`, spaces and non-ASCII survive (FR-022, FR-023, FR-036)
- [x] T041 [P] [US3] Failing unit test `packages/core/tests/unit/open-folder.test.ts` for `decideOpenFolder`: already a project → `select`, inside one → `select` that one, containing one → `refuse-contains` naming it, a file or missing path → `refuse-invalid`, otherwise → `add` (FR-026, FR-027)
- [x] T042 [US3] Implement `packages/core/src/projects/launch-folder.ts` and `packages/core/src/projects/open-folder.ts`; add `folder` to `LaunchMessage` in `packages/core/src/config/instance-identity.ts`, malformed values dropped, making T040 and T041 pass
- [x] T043 [US3] Failing integration test in `packages/ui/tests/integration/instance-guard.test.ts`: a second launch carries its folder to the primary; a refused connection reports `unreachable`; a primary past the point of no return stops answering and the launch becomes primary (FR-024, FR-028, edge case)
- [x] T044 [US3] Pass `folder` through `packages/ui/src/main/instance-guard.ts` and add `stopAnswering()`, making T043 pass
- [x] T045 [US3] Failing unit test `packages/ui/tests/unit/open-folder-queue.test.ts`: requests before `ready` are held and delivered in arrival order; requests after are delivered at once, and a launch's own folder is delivered the same way once the window is ready (FR-025, edge case: several at once)
- [x] T046 [US3] Implement `packages/ui/src/main/open-folder-queue.ts`, read the launch's own folder (a closed throng starts and shows it, FR-025) and second-launch folders in `packages/ui/src/main/main.ts`, tell an elevated-unreachable launch the path could not be opened (FR-028), and expose `window.throng.openFolder` in the preload, making T045 pass
- [x] T047 [US3] Failing component test `packages/ui/tests/component/open-folder-listener.test.ts`: each decision adds, selects or raises one notice; `projects.openFromOutside: 'load'` loads without switching (FR-035); a request during a modal waits for it to close (edge case)
- [x] T048 [US3] Implement `packages/ui/src/renderer/sidebar/open-folder-listener.tsx` over the existing add-project path and mount it in `packages/ui/src/renderer/app.tsx`, making T047 pass
- [x] T049 [US3] Add the port `packages/core/src/abstractions/file-manager-registration.ts` and a fake in `packages/core/src/testing/` (types only; proven by T050, T052 and T055)
- [x] T050 [P] [US3] Failing unit test `packages/platform-windows/tests/unit/windows-file-manager-registration.test.ts` over an injected registry: HKCU on and off write and remove both keys with a quoted `"%V"`; HKLM present reports `machine-wide` and changes nothing (FR-030, FR-034)
- [x] T051 [P] [US3] Implement `packages/platform-windows/src/windows-file-manager-registration.ts`, making T050 pass
- [x] T052 [P] [US3] Failing integration test `packages/platform-linux/tests/integration/linux-file-manager-registration.integration.test.ts` over a temp home: off writes the three per-user overrides with `Active=false` or `Hidden=true`, on removes them, nothing outside the home is touched (FR-034)
- [x] T053 [P] [US3] Implement `packages/platform-linux/src/linux-file-manager-registration.ts`, making T052 pass
- [x] T054 [US3] Bind the port in `packages/platform/src/index.ts` and `packages/ui/src/main/composition-root.ts`, add `throng:fileManagerItem:status` and `:setEnabled` in `packages/ui/src/main/main.ts` and the preload; a portable or archive build reports `unavailable` and registers nothing (FR-036); wiring only, proven by T055
- [x] T055 [US3] Failing component test `packages/ui/tests/component/preferences-file-manager-item.test.ts`: the toggle reflects `status()`, a `machine-wide` registration is disabled and says why, and a failed change is not reported as made (FR-034)
- [x] T056 [US3] Implement the control in `packages/ui/src/renderer/preferences/file-manager-item-control.tsx` and register it in the settings tab, making T055 pass
- [x] T057 [US3] Failing unit test `packages/ui/tests/unit/installer-registration.test.ts` over the script text: NSIS writes both verbs under `SHELL_CONTEXT` only when ticked, adds `PATH` when ticked, removes all three on uninstall at the same scope; both options ticked by default; the MSI declares `THRONG_OPEN_AS_PROJECT` and `THRONG_ADD_TO_PATH` defaulting to `1` (FR-029, FR-031, FR-032)
- [x] T058 [US3] Implement it in `packaging/installer.nsh` and `packaging/msi-project.cjs`, making T057 pass
- [x] T059 [US3] Failing unit test in `packages/ui/tests/unit/linux-package-scripts-067.test.ts`: the package ships the Nemo action, the Dolphin service menu and the `inode/directory` desktop entry, each invoking only `throng %F`-style `throng <path>` (FR-022, FR-033)
- [x] T060 [US3] Add those files under `packaging/linux/` and include them through `electron-builder.yml`, making T059 pass

## Phase 6: User Story 4 — Cancel a shutdown and see progress (P1)

- [x] T061 [P] [US4] Failing unit test `packages/core/tests/unit/shutdown-run.test.ts`: tasks advance in order with one `current`, `cancel` marks the rest cancelled and runs nothing further, the estimate never rises by over 25% between updates unless the current task overran (FR-038, FR-040, FR-042, FR-044)
- [x] T062 [US4] Implement `packages/core/src/workspace/shutdown-run.ts` and export it, making T061 pass
- [x] T063 [P] [US4] Failing integration test in `packages/daemon/tests/integration/terminal-kill-all-project.integration.test.ts`: `terminal.killAll` with `projectId` ends only that project's sessions; without it, every session as before (FR-043)
- [x] T064 [US4] Add the filter in `packages/ipc-contract/src/terminal.ts` and `packages/daemon/src/terminal-service.ts`, making T063 pass
- [x] T065 [US4] Failing unit test `packages/ui/tests/unit/shutdown-driver.test.ts` with fake tasks and timers: Cancel during a task that never settles returns within 5 seconds and runs nothing further; Cancel after the point of no return does nothing; a later close starts afresh; the same work runs as before, for Leave running and for Terminate all (FR-037, FR-038, FR-043, SC-005, edge cases)
- [x] T066 [US4] Implement `packages/ui/src/main/shutdown-driver.ts`, replace the terminate and drain sequence in `packages/ui/src/main/main.ts` with it, expose `onAppCloseProgress`, `onAppCloseCancelled` and `appCloseCancel` in the preload, making T065 pass
- [x] T067 [US4] Failing component test `packages/ui/tests/component/app-close-overlay.test.ts`: one block per task with fill and highlight, a summary on hover and focus, a grouped remaining time, an always-enabled Cancel, focus reachable by keyboard; after Cancel the overlay closes and `markAppTerminating` is undone (FR-037, FR-039, FR-040, FR-041, FR-108)
- [x] T068 [US4] Implement it in `packages/ui/src/renderer/app-close-prompt.tsx` and `packages/ui/src/renderer/terminal/app-terminating.ts`, making T067 pass

## Phase 7: User Story 5 — Properties (P2)

- [x] T069 [US5] Add the ports `packages/core/src/abstractions/file-attributes.ts` and `packages/core/src/abstractions/os-properties-dialog.ts`, the types in `packages/core/src/explorer/properties.ts`, and fakes in `packages/core/src/testing/` (types only; proven by T070 and T072)
- [x] T070 [P] [US5] Failing tests `packages/platform-windows/tests/unit/windows-file-attributes.test.ts` (flag mapping over an injected `GetFileAttributesW`) and `packages/platform-linux/tests/integration/linux-file-attributes.integration.test.ts` (mode bits and dotfiles; OS dialog reports absent with a reason) (FR-046, FR-053)
- [x] T071 [US5] Implement `windows-file-attributes.ts`, `windows-os-properties-dialog.ts`, `linux-file-attributes.ts` and `linux-os-properties-dialog.ts` in their packages, bound in `packages/platform/src/index.ts`, making T070 pass
- [x] T072 [US5] Failing integration test `packages/ui/tests/integration/properties-service.test.ts` (real temp tree): tallies grow, links are not followed, unreadable folders count as skipped, closing aborts the walk, a repeat within 60 seconds reuses the result, a multi-selection combines, a deleted item reports `gone`, and a 100,000-entry tree completes within the SC-007 budget while yielding to the event loop (FR-047 to FR-051, FR-054, SC-007)
- [x] T073 [US5] Implement `packages/ui/src/main/properties-service.ts`, register `throng:properties:*` in `packages/ui/src/main/main.ts`, expose it in the preload, making T072 pass
- [x] T074 [US5] Failing component test `packages/ui/tests/component/properties-dialog.test.ts`: opens with known fields at once, the path is copyable, figures fill in labelled as calculating, one at a time, every control has an accessible name and is reachable by keyboard (FR-108), the reveal action calls the seam, the OS action is disabled with its reason where absent, and nothing offers to edit attributes (FR-045, FR-046, FR-048, FR-052, FR-053, FR-055, SC-006)
- [x] T075 [US5] Implement `packages/ui/src/renderer/explorer/properties-dialog.tsx` and the **Properties** menu item in `packages/ui/src/renderer/explorer/context-menu-items.ts`, making T074 pass

## Phase 8: User Story 6 — Per-project side panes (P2)

- [x] T076 [P] [US6] Failing unit test `packages/core/tests/unit/side-panes.test.ts`: `effectiveSidePanes(layout)` reads absent as both expanded, and a layout round-trips `sidePanes` through validation, in the layout rather than in global settings, so it is deleted with its project (FR-056, FR-057, FR-060, edge case)
- [x] T077 [US6] Add `sidePanes` to `packages/core/src/workspace/model.ts` and its validator, making T076 pass
- [x] T078 [US6] Failing component test `packages/ui/tests/component/workspace-store-side-panes.test.ts`: switching projects restores each one's panes, an auto-collapse by width writes nothing, no project keeps the `localStorage` behaviour (FR-056, FR-058, FR-059)
- [x] T079 [US6] Use it in `packages/ui/src/renderer/app.tsx` and persist through `packages/ui/src/renderer/state/workspace-store.tsx`, making T078 pass

## Phase 9: User Story 7 — Terminal form history (P2)

- [x] T080 [P] [US7] Failing unit test `packages/core/tests/unit/form-history.test.ts`: newest first, distinct, empties ignored, trimmed to N, lowering N trims every list (FR-061, FR-063, FR-065)
- [x] T081 [US7] Implement `packages/core/src/terminal/form-history.ts` and export it, making T080 pass
- [x] T082 [US7] Failing integration test `packages/ui/tests/integration/form-history-service.test.ts` (real file): survives a reload, clears by field, flavour and all, ignores `record` when off and keeps stored values (FR-064a, FR-064b, FR-066, FR-068)
- [x] T083 [US7] Implement `packages/ui/src/main/form-history-service.ts`, register `throng:formHistory:*` in `packages/ui/src/main/main.ts`, expose it in the preload, making T082 pass
- [x] T084 [US7] Failing component test `packages/ui/tests/component/terminal-inputs-history.test.ts`: typing offers the selected flavour's matches, picking fills, the clear button clears only that field and flavour and has an accessible name (FR-108), confirming records, and a value with newlines or great length shows on one truncated line (FR-062, FR-063, FR-067, edge case)
- [x] T085 [US7] Implement it in `packages/ui/src/renderer/panel-type/terminal-inputs.tsx` and the form's confirm path, making T084 pass
- [x] T086 [US7] Failing component test `packages/ui/tests/component/preferences-form-history.test.ts`: clear one flavour, clear all, usable while off, each control with an accessible name and reachable by keyboard (FR-064b, FR-066, FR-108)
- [x] T110 [US7] Implement the controls in `packages/ui/src/renderer/preferences/form-history-control.tsx`, making T086 pass

## Phase 10: User Story 8 — Save icons (P2)

- [x] T087 [US8] Failing component test `packages/ui/tests/component/panel-header-save-icons.test.ts`: editor panels show both, right-aligned, left of the common icons, with a separator; other panels show none; each calls the same action as the chord; live binding in the tooltip; disabled with a reason matching the menu; Save As hides first when narrow (FR-069 to FR-073, FR-069a)
- [x] T088 [US8] Implement it in `packages/ui/src/renderer/workspace/panel-placeholder.tsx`, making T087 pass

## Phase 11: User Story 9 — Rename Tab chord (P2)

- [x] T089 [P] [US9] Failing unit test `packages/core/tests/unit/tabs-rename-binding.test.ts`: `tabs.rename` defaults to `Ctrl+Shift+Alt+F2` at window scope, is rebindable and listed in the metadata (FR-075, FR-078)
- [x] T090 [US9] Add it to `packages/core/src/config/keybindings.ts` and `packages/core/src/config/keybindings-metadata.ts`, making T089 pass
- [x] T091 [US9] Failing component test `packages/ui/tests/component/tab-rename-chord.test.ts`: the chord opens inline rename on the active tab; committing or cancelling returns focus to the panel that had it; no active tab or a rename already open does nothing; the Rename item shows the chord; `F2` still renames the selected file in the File Explorer (FR-075, FR-077, FR-078, FR-079, FR-081)
- [x] T092 [US9] Implement it in `packages/ui/src/renderer/keybindings/window-dispatcher.tsx` and `packages/ui/src/renderer/workspace/tab-group.tsx`, making T091 pass
- [x] T093 [US9] Failing test in `packages/ui/tests/component/terminal-keys-rename.test.ts`: the chord sends no bytes to a running terminal, and `F2` still does (FR-076, FR-079)
- [x] T094 [US9] Make the terminal key handler yield the chord in `packages/ui/src/renderer/terminal/use-terminal.ts`, making T093 pass
- [x] T095 [US9] Amend `.specify/memory/constitution.md` to v6.4.0 (MINOR) with its Sync Impact Report, recording the exception beside `Ctrl+Shift+Alt+F4` in Principle IV (FR-080)

## Phase 12: User Story 10 — Create a sub-workspace (P2)

- [x] T096 [US10] Failing integration test `packages/daemon/tests/integration/subworkspace-create.integration.test.ts`: `subworkspace.create` persists one sub-workspace with exactly one owned untyped panel, seeded with a default name and a palette colour, surviving a restart (FR-083, FR-084, FR-086)
- [x] T097 [US10] Implement it in `packages/ipc-contract/src/subworkspaces.ts` and `packages/daemon/src/subworkspace-service.ts`, relayed through `packages/ui/src/renderer/state/subworkspaces-client.ts`, making T096 pass
- [x] T098 [US10] Failing component test `packages/ui/tests/component/subworkspaces-create.test.ts`: the header shows the themed `add` button in the Projects panel's slot, a click adds an unloaded row and opens no window, the row renames, recolours, reorders and deletes through the existing controls, the empty text no longer mentions detaching, the button has an accessible name and is reachable by keyboard (FR-108), and an unopened one deletes with only the existing confirmation (FR-082, FR-083, FR-085, FR-087, edge case)
- [x] T099 [US10] Implement it in `packages/ui/src/renderer/sidebar/subworkspaces-panel.tsx` and `packages/ui/src/renderer/state/subworkspaces-store.tsx`, making T098 pass

## Phase 13: User Story 11 — Front matter links (P3)

- [x] T100 [US11] Failing component test `packages/ui/tests/component/markdown-front-matter-links.test.ts`: bare URLs, `[text](target)`, `[[Note]]` and `[[Note|alias]]` render as body links would, each sequence item links, a value with no link and every key stay plain, a disallowed scheme stays text, invalid YAML stays an unlinked code block, Show front matter off changes nothing (FR-088 to FR-094)
- [x] T101 [US11] Implement it in `packages/ui/src/renderer/preview/providers/markdown/markdown-body.tsx` and `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts`, making T100 pass

## Phase 14: User Story 12 — Total lines readout (P3)

- [x] T102 [US12] Failing tests `packages/ui/tests/unit/status-strip-fit-lines.test.ts` and `packages/ui/tests/component/status-strip-lines.test.ts`: forms `lines` and `lns`, hide order total words → total characters → total lines → selected characters → column → line, digit-grouped, omitted until metrics settle, `1 line` for an empty document, hidden with the counts setting, the accessible announcement, and read from settled metrics with no new work per keystroke (FR-095 to FR-100, SC-013)
- [x] T103 [US12] Implement it in `packages/ui/src/renderer/editor/status-strip.tsx` and `packages/ui/src/renderer/editor/status-strip-fit.ts`, making T102 pass

## Phase 15: User Story 13 — Linux old-version rule (P3)

- [x] T104 [US13] Characterisation test (FR-104 changes no script, so it passes at once) in `packages/ui/tests/unit/linux-package-scripts-067.test.ts`, driving `packaging/linux/after-install.sh` under `THRONG_PACKAGE_TEST_PREFIX`: a version with a running process stays, and goes on a later install once nothing runs from it, with no script change (FR-103, FR-104)
- [x] T105 [US13] Add the numbered requirement to `specs/063-linux-packaging/spec.md` and cite it from research note D2 in `specs/063-linux-packaging/research.md` (FR-101)
- [x] T106 [US13] Say it in `docs/install-linux.md` (FR-102)

## Phase 16: Polish

- [x] T107 Document every new setting in `docs/preferences.md` and `tabs.rename` in `docs/key-bindings.md`, the file-manager item and `throng <path>` in `docs/installation.md`, `docs/install-windows.md` and `docs/install-linux.md`, and the new features in `docs/quick-start.md`, `README.md` and `docs/linux.md` (FR-105, FR-106)
- [x] T108 Run the `throng-docs` audit and `packages/ui/tests/unit/docs-currency.test.ts`
- [x] T109 Write the manual test plan with `planning-manual-tests`, covering every file manager on X11 and Wayland, what GNOME Files actually shows for the Open With entry, and the criteria proven only by hand: SC-004 and SC-009 (FR-109)

## Dependencies

Phase 2 blocks every story. Stories are independent, except that T026 needs T020 and T085 needs T083. Renderer tasks work against [contracts/ipc.md](contracts/ipc.md), with the bridge faked in their tests.

## Implementation strategy

Deliver in story order. US1 to US4 are the P1 increments; each later story stands alone.

## Phase 17: Convergence

- [x] T111 Report an item deleted while Properties is open: `packages/ui/src/main/properties-service.ts` watches the open items and sends a final tally naming what went, per Edge Case "Item deleted or renamed while Properties is open" (partial)
- [x] T112 Show that report in `packages/ui/src/renderer/explorer/properties-dialog.tsx`: the view states the item is gone and stops updating, per Edge Case "Item deleted or renamed while Properties is open" (partial)

## Phase 18: Iteration of 2026-11-09

Order: T113 before T123; T119, then T120, then T121 to T123. The rest are independent.

Every task is test-first: a failing test, read why it fails, then the code.

- [x] T113 [US1] Restore `throng:files:startOsDrag`, its preload and global type, and `packages/ui/src/main/os-drag.ts` with its unit test, for FR-114
- [x] T114 [US2] Setting `explorer.openUnsupportedInOs` (default on): model, descriptor, `docs/preferences.md`, for FR-116. The Preferences toggle comes from the descriptor. Unit: `settings-resource-monitor.test.ts`
- [x] T115 [US8] Disk glyphs for the `save` and `saveAs` tokens in `packages/core/src/config/theme.ts`, for FR-118. Unit: `icon-tokens-067.test.ts`
- [x] T116 [US5] `IFileAccessInfo` in core, Linux and Windows implementations, bound in main, `ItemProperties.access` filled by `packages/ui/src/main/properties-service.ts`, for FR-121. Unit: `file-mode.test.ts`, `linux-file-access-info.test.ts`; integration: `properties-service.test.ts`
- [x] T117 [US5] Linux reports the OS properties action absent with no reason text, for FR-122. Changes T070's expectation in `linux-file-attributes.integration.test.ts`
- [x] T118 Establish what MT-19 needs on Linux: confirm both windows are parented, and record the finding (Research D24), for 007 FR-013 [derived]
- [x] T119 [US1] `packages/ui/src/renderer/explorer/tree-pointer-backend.ts`: threshold, hit-testing, drop, Esc, edge scroll, live keys, for FR-110, FR-111, FR-113. Unit: the backend, driven by synthetic pointer and key events
- [x] T120 [US1] Wire the backend into `packages/ui/src/renderer/explorer/file-tree.tsx`; remove the web listeners for tree drags, `DragModifierLatch`, the drag-surface image and the label for tree drags, for FR-110, FR-111
- [x] T121 [US1] Replay the drag to targets outside the tree, for FR-110
- [x] T122 [US1] The real pointer through `data-tree-drag`, for FR-112, SC-014. Component: the attribute follows the effect
- [x] T123 [US1] Hand over to `files.startOsDrag` when the pointer leaves the window, for FR-114. Component: leaving the window calls `startOsDrag` once
- [x] T124 [US1] Confirm the label remains for OS-inbound drags only, for FR-115
- [x] T125 [US2] Double-click routing in `packages/ui/src/renderer/explorer/tree-node.tsx` and `use-explorer-data.ts`, for FR-116, FR-117. A no-program result is FR-018's notice carrying the OS's reason [derived]. Component
- [x] T126 [US5] Properties dialog: X, scrim, no Close, no OS reason line, per-value copy, access rows, for FR-119 to FR-122. Copies a raw count without separators. Changes T074's expectations on the disabled action, its reason and Close. Component
- [x] T127 [US11] Relative targets in the front matter linker, for FR-123. Bare-scalar rule as noted under FR-123. Unit
- [x] T128 [US10] Create goes to rename; Enter opens, for FR-124. All of FR-124: default name selected, typing replaces, Enter opens, Esc keeps the default without opening, clicking away commits without opening. Component
- [x] T129 [US12] Status strip punctuation and the column range, for FR-125, FR-126. Full and short forms per FR-125 and FR-096's note; update the fit tests. Component
- [x] T130 [US14] Click closes the resource popup, for FR-127. Keeps the "does not open the monitor" test. Component
- [x] T131 Update the E2Es that drive tree drags for mouse events, re-seeding `packages/ui/tests/e2e/e2e-budget.json` if the count changes, for FR-110
- [x] T132 Docs for what changed: `docs/quick-start.md`, `docs/linux.md`, `docs/architecture.md`


## Phase 19: Iteration of 2026-11-10 (FR-128 to FR-132, SC-015, three defects)

Every task is test-first: a failing test, read why it fails, then the code. Order: T135 before T136; T137 before T138 and T139 (both reuse its route); T138 and T139 share the preview's follow route, so they run in sequence. T133, T134 and T140 are independent.

- [x] T133 [US5] Properties last in the File Explorer context menu, for FR-128. Component: the last item for a file and for a folder is Properties. `packages/ui/src/renderer/explorer/context-menu-items.ts`
- [x] T134 [US7] Down arrow opens the history list, the whole list in an empty field, for FR-129. Component, including Down moving through the list and Esc closing it (regression). `packages/ui/src/renderer/panel-type/history-input.tsx`
- [x] T135 [US7] The clear control in Preferences' Terminal section, for FR-130. Component, including that Preferences search still finds it. `packages/ui/src/renderer/preferences/settings-tab.tsx`
- [x] T136 [US7] Defect: clearing in Preferences reaches a form already open, for FR-064b, FR-066. Failing component test first (an open form still offers a cleared value), then main's `onChanged` event (contracts/ipc.md) and the hook's re-read. `packages/ui/src/main/form-history-service.ts`, `packages/ui/src/renderer/panel-type/use-form-history.ts`, preload, `global.d.ts`
- [x] T137 [US2] Ctrl+click on a link to an in-project binary file opens it in the OS with `explorer.openUnsupportedInOs` on, from the editor and terminal route, for FR-131. Unit/component on `followLink`, with negative tests: preference off, a file outside every project, and a file whose default open action is its preview, each keeping today's behaviour. `packages/ui/src/renderer/links/link-actions.ts`
- [x] T138 [US2] The same from a preview body link, for FR-131. Component, with the same negative tests as T137. Front matter links follow through T137's route once T139 lands, and T139 tests one Ctrl+click to the OS there. `packages/ui/src/renderer/preview/preview-panel.tsx`, `packages/ui/src/renderer/editor/editor-open.tsx`
- [x] T139 [US11] Defect first: `./test.ts:3`, `./test.ts:3:5` and `./research.md:10-20` render a link with no destination and `./test.ts(3,5)` names a file `test.ts(3,5)`, for FR-123, FR-090. Then every whole-value link form of FR-132 through the editor's grammar, followed by the editor's route; a sentence stays text; the body is unchanged. Component, driven by a fixture that copies every front matter value of `link-types.md` (MT-14 checks the real file), for FR-132, SC-015. One test Ctrl+clicks a front matter link to a binary file with the preference on (FR-131). `packages/ui/src/renderer/preview/providers/markdown/pipeline.ts`, the preview's follow handler
- [x] T140 Defect: Preferences and About stay above the main window on native Wayland, for 007 FR-013. Research D25 finds no fix inside throng's main process with separate windows under Electron 44; waiting on the maintainer's choice among D25's options. `packages/ui/src/main/main.ts`
  *Closed 2026-11-12: the maintainer chose D25 option 1, keep separate windows. The limit is documented in `docs/linux.md` and on the `window.nativeWayland` setting.*
- [x] T141 Docs for what changed: `docs/preferences.md` (FR-131 widens `explorer.openUnsupportedInOs`; FR-130 moves the clear control into Terminal), `docs/quick-start.md` where it describes front matter links or the terminal form's history (FR-129, FR-132), and `docs/linux.md` for the native Wayland limit (D25)


## Phase 20: Iteration of 2026-11-12 (FR-133, FR-134)

Every task is test-first: a failing test, read why it fails, then the code. T142 before T143; T144 is independent.

- [x] T142 [US7] `FormHistoryService.removeValue` forgets one value of one field for one terminal type, durably, and announces the change, for FR-133. Integration on the service file, beside the clear tests. Then the IPC message, preload and `global.d.ts` (contracts/ipc.md). `packages/ui/src/main/form-history-service.ts`, `packages/ui/src/main/main.ts`, `packages/ui/src/preload/preload.cts`, `packages/ui/src/renderer/global.d.ts`
- [x] T143 [US7] Delete on a highlighted remembered value removes it from the open list, keeps the field's text, moves the highlight to the next value (the previous after the last), closes the list when empty, and leaves Delete with nothing highlighted to the text, for FR-133. Component on `HistoryInput` and `use-form-history.ts`, including a second open form dropping the value when main announces the removal. `packages/ui/src/renderer/panel-type/history-input.tsx`, `packages/ui/src/renderer/panel-type/use-form-history.ts`, `packages/ui/src/renderer/panel-type/terminal-inputs.tsx`
- [x] T144 [US12] The column readout and the selected readout end in a full stop, the short form reads `2 sel.`, and a line with its column hidden ends in a full stop, for FR-134. Unit on `readoutText` / `statusReadouts`, updating the FR-125 and FR-126 expectations they refine. `packages/ui/src/renderer/editor/status-strip.tsx`
- [x] T145 Docs for what changed: `docs/quick-start.md` where it describes the terminal form's remembered values (FR-133)

## Phase 21: Second round of 2026-11-12 (FR-135, FR-136)

Test-first. Independent of each other.

- [x] T146 [US7] Focusing or clicking a remembered-values field shows its whole list, whatever it holds; typing narrows it; picking replaces the text; Esc closes until the next focus or click, for FR-135. Component, replacing the T134 expectation that focusing shows nothing. `packages/ui/src/renderer/panel-type/history-input.tsx`
- [x] T147 [US12] A selection across lines reads `Ln 3-5, Col 4.` from either direction, a selection ending at a line's start does not count that line, and it is spoken `lines 3 to 5`, for FR-136. Component on `statusReadouts` and through a mounted editor. `packages/ui/src/renderer/editor/use-editor.ts`, `packages/ui/src/renderer/editor/caret-store.ts`, `packages/ui/src/renderer/editor/status-strip.tsx`
- [x] T148 Docs: `docs/quick-start.md`'s form-history line (FR-135)
