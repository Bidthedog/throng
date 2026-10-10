# Data Model: 054

## Persisted

### `Tab.previewRecency?: string[]` (layout) — FR-001, FR-002

Most-recent-first preview panel ids in the tab. Optional; absent in layouts saved before 054.

- Written by `setPreviewRecency(tabId, ids)` whenever `recordLastActivePreview` changes the order.
- Seeded into `last-active-preview.ts` by the workspace load effect.
- Fallback when absent: `[tab.activePanelId]` if that panel is a preview, else the tab's preview panels
  in layout order.
- Ids of panels no longer in the tab are pruned on read (existing `candidateFor` behaviour) and on the
  next write.

### `PreviewPanelConfig.providerId?: string` (layout) — FR-005, FR-009

The preview panel type. Written at place and on any change of file whose provider differs. Absent →
derived from `previewPathOf(config)` via `registry.forPath`. Never contradicts the file (a cross-type
link opens elsewhere, FR-008).

### Settings — `editor.previews` (FR-041, FR-050 – FR-055)

| Leaf | Type | Default | Notes |
|---|---|---|---|
| `updateDelayMs`, `maxWaitMs`, `syncScroll`, `copyFormat` | unchanged | unchanged | shared, subgroup Previews |
| ~~`openTarget`~~ | retired | — | migrated to each provider's `openTarget`, then dropped on next write |
| `providers.<id>.enabled` | boolean | `true` | per provider |
| `providers.<id>.defaultOpenAction` | `editor \| preview` | `editor` | text providers |
| `providers.<id>.openTarget` | `lastActive \| new` | migrated value, else `lastActive` | **new**, every text provider |
| `providers.markdown.renderMermaid` | boolean | `true` | **new** Markdown own setting |
| `providers.markdown.{loadRemoteImages, showFrontMatter, gutter, headingJumpMs}` | unchanged | unchanged | subsection Markdown |
| `providers.mermaid.*` | — | — | **new provider**: enabled, defaultOpenAction, openTarget |
| `editor.markdownSectionsOpen` | unchanged | unchanged | key unchanged; placed in Previews → Markdown |

Migration rule (parse, idempotent): `provider.openTarget = valid(raw.providers[id].openTarget) ??
valid(raw.openTarget) ?? 'lastActive'`.

### `FieldDescriptor.subsection?: string` (metadata) — FR-050

Third preferences level under `subgroup`. Invalid without `subgroup` (`auditRegistry` rejects).

### Theme icon tokens — `SHIPPED_DEFAULTS_VERSION` 21

`panelMaximise`, `panelRestore`, `diagramFit`, `diagramFullSize`, `diagramFullPane`.

### Keybindings

| Action | Default | Scope |
|---|---|---|
| `markdown.collapseAllInside` | unbound | MARKDOWN_SURFACES |
| `markdown.expandAllInside` | unbound | MARKDOWN_SURFACES |
| `panel.toggleMaximise` | `Alt+Shift+Enter` | PANELS (window-handled) |

## Transient (never persisted)

### Maximise stack — `renderer/workspace/maximise-store.ts` (FR-070 – FR-076)

```text
MaximiseTarget = { kind: 'panel', panelId } | { kind: 'section', panelId, sectionId }
state: Map<tabId, MaximiseTarget[]>      // bottom → top; depth ≤ 1 panel + its sections
```

Transitions:

| Event | Effect |
|---|---|
| maximise panel P in tab T | stack := [panel P] (any previous target restored) |
| Full Pane section S of panel P | if top is `panel P` or empty or a section of P: push section; else stack := [section] |
| Esc / Restore / command | pop one |
| panel P closed / type change | close: drop every entry for P; type change: keep `panel P`, drop its sections |
| section S unmounts | drop S |
| open lands in a hidden panel | clear the stack first |
| tab torn off / project unload / restart | state discarded (module store, per window) |

### Diagram view state — `DiagramFrame` (FR-046a – FR-046g)

`{ mode: 'fit' | 'zoom' | 'fullSize', scale, x, y }`; kept across live re-renders by diagram ordinal;
reset on preview reopen.

### Diagram block state — `DiagramBlock` (FR-044)

`{ lastGoodSvg?: string, error?: string, source }` per diagram ordinal.

### Task toggle request — FR-022 – FR-027

See [contracts/preview-ipc-054.md](./contracts/preview-ipc-054.md).

### Pending reveal — FR-030, FR-031

`Map<panelId, {from, to, text}>` in `preview-panel-handles.ts`; consumed on the next draw.
