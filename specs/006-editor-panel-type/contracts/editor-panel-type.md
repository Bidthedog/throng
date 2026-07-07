# Contract: Editor Panel Type (core — Phase A)

Pure `@throng/core/editor/panel-type.ts`, registered in `core/src/panel-type/default-registry.ts`. No
OS/DOM. Plugs into the existing 005 panel-type registry with **no change** to the shared select/confirm/
clear flow (SC-016).

## Descriptor

```ts
editorPanelType: PanelTypeDescriptor<Record<string, never>> = {
  id: 'editor',
  label: 'Editor Panel',
  inputs: [],                                   // no configuration inputs
  defaults: () => ({}),
  validate: (_v, ctx) => (ctx.projectRoot !== null || ctx.rootless) ? { ok: true } : { ok: false, errors: {} },
  buildConfig: () => ({}),                      // → EditorPanelConfig for a new, empty, unpathed document
}
```

**Obligations**
- Registered in `defaultPanelTypeRegistry` **alongside** `terminalPanelType`; `list()` returns both in a
  stable order (Terminal, Editor). Adding it requires **no edit** to `panel-type-form.tsx`'s shared flow
  beyond one `'editor'` inputs branch and one `panel-body.tsx` render branch (SC-016).
- `validate` is `ok` whenever the Panel has a context to own the document — a project root **or** a
  sub-workspace (`rootless`) context. It never blocks on inputs (there are none).
- `buildConfig` returns an **empty** `EditorPanelConfig` (`{}`): confirming creates a **new, empty,
  in-memory document** with **no** `filePath` (FR-002). The document is not written to disk until saved.
- **No revert**: `clearPanelType` is **not** wired for the editor kind — an Editor Panel never returns to
  the type-selection form (FR-006 / research D4). It is removed only by destroying its Panel.

## Assignment

- `setPanelType(layout, panelId, 'editor', {})` assigns from the **untyped** state (existing op). The
  renderer's `PanelTypeForm` Confirm calls it for `'editor'` exactly as for `'terminal'`.

## Contract tests (unit)
Registry lists Editor + Terminal in stable order; `editorPanelType.validate` ok with a project root and
with `rootless`, and the Editor descriptor requires no inputs; `buildConfig` returns `{}`; a confirmed
Editor Panel round-trips through the layout blob as `kind:'editor'`; `clearPanelType` is never invoked for
editors (an Editor Panel stays typed until removed).
