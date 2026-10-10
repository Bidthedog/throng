# Research: 054 Markdown Previews

Each entry: **Decision**, **Rationale**, **Alternatives considered**. Code references are to the tree at
the branch point (`207369a0`).

## R1 — Restored previews and per-type Last Active (FR-001 – FR-004, FR-007)

**Decision.** Recency stays in `renderer/preview/last-active-preview.ts` (`Map<tabId, panelId[]>`), but
it is **seeded from and written back to the layout**: `Tab` gains an optional
`previewRecency?: string[]` (most recent first). `recordLastActivePreview` updates the store and calls a
new workspace-store op `setPreviewRecency(tabId, ids)`, which is a normal debounced layout save. The
load effect in `workspace-store.tsx` (the single restore path) seeds the store from every tab. A tab
with no `previewRecency` (a layout saved before this feature) seeds from `tab.activePanelId` when that
is a preview, else the tab's previews in layout order (`collectPanels`).

`candidateFor(tabId, isLive)` gains a third parameter, the **provider id** of the file being opened;
a candidate counts only when its current file's provider (`registry.forPath(previewPathOf(config))`)
matches (FR-007). `openPreview` passes it; the Explorer's "Last Preview Panel" row passes the clicked
file's provider.

FR-004 already holds: `PreviewService.open` returns `focused` for a path with a run, and
`focusLocalPanel` switches tabs (`open-preview.ts:151`). A test pins it for every route this feature
touches (Find in Files, FR-030).

**Rationale.** The hypothesis in #474 is confirmed by reading: restored panels never record. Persisting
the order is what the maintainer chose (clarification Q1). Keeping it an optional `Tab` field means no
`LAYOUT_SCHEMA_VERSION` bump: `workspace-repository.ts` serialises the whole layout and an absent field
is the fallback case.

**Alternatives.** Record restored previews at mount (no persistence) — rejected: the order of mounts
is layout order, not the user's last use. A separate persisted store — rejected: a second file for
one tab property, outside the layout's own lifecycle (tab close, Send to Tab).

## R2 — One preview panel type per provider (FR-005 – FR-009)

**Decision.** Keep the single persisted kind `PREVIEW_KIND = 'preview'`; make the **provider the panel
type's identity**. `PreviewPanelConfig` gains `providerId?: string`, written when a preview is placed
or navigates to a file of another provider (never, by FR-008, in place). Everything that names a panel
type — the title fallback (`panel-title.ts`), the header type label, the type icon — reads
`previewPanelTypeLabel(provider)` = `"<displayName> Preview"`. A restored config without `providerId`
derives it from its file (FR-009); idempotent because derivation never writes a different value.

FR-008: `PreviewService.navigate` (link follow) checks the target's provider against the run's; a
different provider is handled as an **open** of that file (FR-007 reuse, FR-004 focus) instead of an
in-place navigate.

**Rationale.** The behaviour the maintainer asked for — same rules, same access points, reuse only
within a type — is a property of the provider registry, which every preview surface already reads
(044 US5). Splitting the persisted kind into `preview:markdown` would touch every `kind ===` site
(`KINDS_THAT_ZOOM`, scope resolution, panel body dispatch, restore filters) and the persistence format,
for no behaviour a user can see that the provider identity does not already give.

**Alternatives.** Per-provider kinds (`markdownPreview`, `mermaidPreview`) — rejected as above; noted
so a later spec can revisit if a provider ever needs a different panel chrome.

## R3 — Outlining submenu and "All Inside" (FR-010 – FR-014)

**Decision.** Two pure core operations in `outline/fold-state.ts`:
`collapseWithin(state, tree, slug)` and `expandWithin(state, tree, slug)`, setting the slug and every
descendant slug individually (the 047 FR-037a rule, scoped). Two new commands
`markdown.collapseAllInside` / `markdown.expandAllInside`, `MARKDOWN_SURFACES`, **unbound**.
`previewContentMenu` and `editorContentMenu` move their fold rows into one
`{label: 'Outlining', section: 'viewState', submenu: [...]}` built by a **shared** builder
`outliningSubmenu(args)` in `renderer/common/outlining-menu.ts`, so the two menus cannot drift.

**Rationale.** The submenu mechanism exists (`MenuAction.submenu`, Split precedent). One builder keeps
047's "identical menus" property structural.

**Alternatives.** Hand-duplicating the rows in both menu builders — rejected (DRY; it is how the two
menus would drift).

## R4 — Toggling task-list checkboxes (FR-020 – FR-029)

**Decision.**

1. **Pipeline.** The `throng_task_lists` core rule records the list item's source line
   (`token.map[0] + frontMatterLineOffset`) on the checkbox token; the renderer emits
   `<input type="checkbox" data-task-line="N" [checked]>`. The sanitiser keeps forcing every non-checkbox
   `input` out and allows `data-task-line` (numeric only) — it **stops** forcing `disabled`.
2. **Locating the edit** is a pure core function `locateTaskToggle(text, line, expectChecked, itemText)`
   in `core/src/preview/task-toggle.ts` → `{from, to, insert}` or a refusal reason
   (`not-found | ambiguous | changed`). It checks the marker on `line`; if the source moved since the
   render it searches for the **one** task item with the same item text and expected state, else refuses
   (FR-027). Marker grammar: list item prefixes `-`, `*`, `+`, `N.`/`N)`, inside any depth of block quote
   `>`, `[ ]` / `[x]` / `[X]`.
3. **Applying** is a new main service `TaskToggleService` (`main/task-toggle-service.ts`), on a new IPC
   `throng:preview:toggleTask`:
   - document open in `EditorCoordinator` → a new `applyExternalEdit(absPath, change)` built like
     `bulkReplace` (one undo entry, relayed, `notifyAfterMutation`); if the document **was clean**, save
     it (FR-025);
   - not open → the `writeDirect` path of `ReplaceCommitService` extracted into a shared
     `textFileRewrite(fs, absPath, edit)` helper (confinement, binary/encoding refusals, `decode` →
     edit → `encode` preserving encoding/BOM/line endings — FR-029), errors mapped by the existing
     `reasonFor` (`readOnly`, `locked`, `missing`, `io`).
4. **Feedback.** Success → the normal content relay re-renders the preview; scroll is kept by the
   existing scroll anchor (FR-026). Refusal → one app notification from the preview, worded through
   the existing failure wording (`failureWording`), checkbox reverted (FR-028).
5. **Input.** Click and Space on a focused checkbox call the handler and `preventDefault` the native
   toggle; the checkbox shows its new state only from the re-render. Every other preview input stays
   inert (044 FR-020 otherwise intact; `preview-read-only.test.ts` keeps its assertions).

**Rationale.** One document authority (Principle XI) and the 043 replace path already solve "edit a file
with or without an open editor, preserving fidelity" — the toggle is a one-edit special case.

**Alternatives.** A direct file write from the renderer — rejected (bypasses the shared document,
overwrites unsaved edits). Re-using `throng:fileSearch:commit` — rejected (term-shaped; a toggle is
positional).

## R5 — Mermaid rendering (FR-040 – FR-049a)

**Decision.**

- **Library:** `mermaid` **12.1.0** (MIT), a `packages/ui` runtime dependency, imported only by
  `renderer/preview/diagram/mermaid-renderer.ts` through a dynamic `import()`, routed by `vite.config.ts`
  into its own lazy `diagram` chunk (the `fail-on-eager-preview` guard extended to it) — FR-047, SC-006.
- **Configuration:** `initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base',
  themeVariables: <from theme tokens>, htmlLabels: false, flowchart: { htmlLabels: false } })`.
  `strict` disables `click` callbacks and HTML labels; `htmlLabels:false` avoids `foreignObject`.
- **Sanitising:** the SVG string from `mermaid.render` passes through a **second DOMPurify profile**,
  `DIAGRAM_SVG_PROFILE` (`USE_PROFILES: {svg: true, svgFilters: true}`, `FORBID_TAGS: foreignObject,
  script, a`, no event attributes, no `href`/`xlink:href` other than local `#` fragments), and is
  inserted as DOM **after** the document sanitiser, as highlighting is (`markdown-body.tsx:763`). The
  document profile's `ADD_FORBID_CONTENTS: 'svg'` stays: diagrams never come from document markup.
- **The seam (FR-043):** a registry of **block renderers** keyed by fence language,
  `renderer/preview/blocks/block-renderers.ts` — `{ lang, load(): Promise<BlockRenderer> }`. The
  Markdown body runs one post-insert pass over `pre > code[data-lang]` whose language has a registered
  block renderer, replacing each with a `DiagramBlock` mount. Mermaid is the only entry.
- **Standalone provider:** core `providers/mermaid.ts` (`id: 'mermaid'`, `displayName: 'Mermaid'`,
  `extensions: ['.mmd', '.mermaid']`, `kind: 'text'`), renderer `providers/mermaid/view.ts` whose body
  renders the whole file through the same `DiagramBlock`.
- **Failure (FR-044):** `DiagramBlock` keeps the last good SVG per block; on a parse error it shows one
  inline `diagram-notice` above the dimmed last good render, or alone. Blocks are matched across
  re-renders by **ordinal among diagram blocks**, so edits elsewhere keep each diagram's state.
- **Bound (FR-048):** `DIAGRAM_RENDER_TIMEOUT_MS = 5000` — a safety limit, not a tunable (044's 1 KiB
  view-state precedent); recorded in Complexity Tracking.
- **Theming (FR-046):** theme variables derived from the active theme's tokens (`background`,
  `foreground`, `border`, `accent`, `editorSelection`, font); re-render on theme change.
- **Copy (FR-049a):** `captureSelection` replaces each diagram in the cloned fragment with a
  placeholder carrying its ordinal; plain text substitutes a fenced `mermaid` block of the source; rich
  text rasterises the live SVG to PNG (canvas, natural size) and substitutes `<img src="data:image/png;
  base64,...">` after `createHtmlExporter`, whose profile admits only that data-URI shape.

**Rationale.** The maintainer asked for an existing library; mermaid is the reference implementation
and its strict mode does the bulk of the hardening, with the sanitiser making it structural (044
FR-081's "a test asserts the sanitiser is in the path").

**Alternatives.** Rendering in a sandboxed iframe — rejected: theming, copy, find exclusion and
pan/zoom across a frame boundary each become a protocol. A server-side renderer — rejected (no network).

## R6 — Diagram view controls (FR-046a – FR-046h)

**Decision.** `DiagramFrame` (`renderer/preview/diagram/diagram-frame.tsx`) wraps every diagram, in
Markdown and standalone. It owns `{mode: 'fit' | 'zoom' | 'fullSize', scale, x, y}` and draws the SVG
inside a viewport with a CSS `transform`. A toolbar pinned to the frame's **top-left**, outside the
transformed layer, holds Fit, Full Size, Zoom In, Zoom Out and Full Pane as `IconButton`s with new
theme icon tokens. Fit: `scale = clamp(width / naturalWidth, MIN_READABLE_SCALE = 0.5, 1)`, scrolling
sideways below the floor (FR-046a). Zoom steps ×1.25 within [0.1, 8]. Middle-button pointer drag pans
(`pointerdown` with `button === 1` → `preventDefault` to suppress Chromium autoscroll, pointer capture).
**Full Size** lifts the frame to `position: absolute; inset: 0` over the preview panel's body (its
nearest positioned ancestor). **Full Pane** hands the frame to the maximise mechanism (R7) as a
section target. View state lives in the frame and is never persisted (FR-046g).

**Rationale.** A dependency-free transform is ~150 lines and keeps the controls fixed by construction
(they are not inside the transformed layer).

**Alternatives.** `@panzoom/panzoom` — rejected: wheel/pinch semantics and DOM ownership conflict with
the preview's own scroll and zoom; we need four operations, not a gesture library.

## R7 — Maximise mechanism (FR-070 – FR-077, FR-046f)

**Decision.**

- **State** lives in a renderer module store `renderer/workspace/maximise-store.ts`, keyed by tab id, a
  **stack**: `[{kind: 'panel', panelId}, {kind: 'section', panelId, sectionId}]`. Never in `Tab` or
  the layout, so it is not persisted (FR-076) and never crosses windows.
- **Panel targets** are maximised **in place**: no re-parenting (re-parenting remounts CodeMirror and
  xterm, `split-tree.tsx` #228). While a tab has a panel target, `.tab-body` gets
  `data-maximised="<panelId>"`; CSS makes split containers/cells `position: static`, gives the target's
  `.panel-box` `position: absolute; inset: 0; z-index` against `.tab-body` (already `position:
  relative`), and every other cell `visibility: hidden` plus `inert`. Side-pane resizes resize
  `.tab-body`, so the target follows; split `sizes` are untouched (FR-073).
- **Section targets** render through a React portal into a `.maximise-layer` element inside `.tab-body`
  (or over the maximised panel when nested — FR-074 nesting); the section component keeps its own
  state because the state lives above the portal.
- **Modal rules (FR-074)** are one hook, `useTabMaximise(tabId)`, read by: the header "+" and Split
  submenus (disabled), `splitPanelById` and the split chords (no-op), drag start and the edge/outer
  drop zones (off), OS/tree file drops into the tab's layout (refused as disabled), Open In target
  builders (`describeOpenInTargets`, `linkOpenInEditors`: hidden panels omitted), and the open paths
  (`openFileInTab`, `openPreview`): an open that would land in a hidden panel calls `restore(tabId)`
  first.
- **Commands:** `panel.toggleMaximise`, default **`Alt+Shift+Enter`**, scope `PANELS`, added to
  `WINDOW_HANDLED_ACTIONS` and `isPanelScoped` (so it is captured ahead of xterm and CodeMirror).
  **Esc** restores one level through a capture listener owned by the maximise layer, skipped when the
  focus is inside `.xterm` or `.cm-editor`, a find bar is open, or a transient overlay is open.
- **Controls:** a header `IconButton` (`maximise` / `restore` tokens) in `.panel-box__actions`, a
  "Maximise Panel" / "Restore Panel" title-menu row (`viewState` section), and a Restore control drawn
  on every maximised target.

**Rationale.** In-place CSS is the only approach that keeps terminals and editors mounted; a module store
is the established pattern for per-tab transient state (`split-mode.ts`, `last-active-editor.ts`).

**Alternatives.** Re-rendering the target in an overlay — rejected (remount). A layout field — rejected
(persisted, which FR-076 forbids).

**Terminal key (FR-071a).** Alt+Shift+Enter today reaches xterm and is encoded by `encodeEnterKey`
(`\x1b[13;4u` under kitty, LF otherwise). As a window-handled action it is taken in the capture phase
and never reaches the encoder — the documented change. Shift+Enter (`\x1b[13;2u`) and Ctrl+Enter
(`\x1b[13;5u`) are untouched; a component test asserts the window dispatcher does not consume them, and
the existing `terminal-modified-enter.e2e.ts` continues to assert Shift+Enter's bytes.

## R8 — Find in Files routing (FR-030 – FR-034)

**Decision.** `find-in-files-chrome.tsx`'s registered opener consults `defaultOpenActionFor(registry,
settings.editor.previews, absPath)`. `editor` → today's `openResultRow`. `preview` → `openPreview` with
the file's provider's Open previews in, plus a `reveal: {from, to}` carried to the preview panel through
the existing `focus`/`navigated`/placed paths (a `pendingReveal` keyed by panel id in
`preview-panel-handles.ts`). On draw, the preview maps `from` to a source line, finds the block
(`blockLineFor`), runs the preview find model over that block for the matched text, expands folds
(`revealBeforeScroll`), scrolls it into view and paints it with the find highlight. **No match in the
rendered text** (front matter hidden, inside a diagram, raw HTML) → `openResultRow` at the same range
(FR-032). The Open In menu (044 FR-055) is unchanged. The descriptor text at `preview-settings.ts:216`
and `docs/preferences.md` change (FR-034); `editor-open-router.test.ts:235-257` changes by supersession.

## R9 — Settings audit and a third Preferences level (FR-050 – FR-055)

**Decision.**

- `FieldDescriptor` gains optional **`subsection?: string`**, valid only with `subgroup`.
  `groupDescriptors` nests it as a third bucket; `Subsection` renders a nested subsection with an `h5`
  (same component, a `level` prop). This extends 040's one convention rather than adding a second
  (#319's concern); the 040 tests (`metadata-subgroup.test.ts`, `settings-tab-subgroups.test.ts`,
  `settings-metadata-040.test.ts`) are extended, not bypassed.
- Placement per FR-051: shared preview leaves have `subgroup: 'Previews'` and no subsection; every
  provider leaf gets `subsection: provider.displayName`; `editor.markdownSectionsOpen` gets
  `subgroup: 'Previews', subsection: 'Markdown'` with its key unchanged (FR-054).
- **Open previews in** becomes a provider leaf `editor.previews.providers.<id>.openTarget`, label
  `"<displayName>: Open previews in"`. Migration in `parsePreviewSettings`: a provider's `openTarget`
  falls back to the retired top-level `openTarget` when absent, else the shipped `lastActive` — the
  `defaultParams` → `defaultShellArguments` precedent (new key wins, so re-running is a no-op). The
  top-level leaf is no longer parsed, so the next write drops it; this is a migration of a live value,
  distinct from 019 FR-023's drop of a key that never had effect.
- Readers of `previews.openTarget` (`openPreview`, Explorer, quick open, links) read the provider's.

## R10 — Test layers (Principle V)

| Behaviour | Lowest layer |
|---|---|
| fold-within ops, task locate, settings parse/migration, keybinding collisions, recency fallback | unit (core) |
| pipeline task-line attribute, sanitiser profiles, block-renderer seam, menus | unit (ui) |
| preview checkbox click/Space, diagram frame controls, notices, copy, maximise modal rules, Find in Files routing, settings form nesting | component (jsdom, fake mermaid module) |
| task toggle open/closed document, save-if-clean, fidelity, read-only | integration (`preview-harness`, `replace-commit` pattern) |
| `throng:preview:toggleTask` wire shape | contract |
| real Mermaid render + theme in Electron; maximise of a real terminal with Shift+Enter still reaching the shell | **E2E, two specs, `@extended`** — jsdom cannot lay out SVG (`getBBox`), and xterm focus/capture is window-real |

E2E budget (`e2e-budget.json`) is re-seeded in the same commit as the two specs.
