# Contract: Panel Type Registry & Assignment (core — Phase A)

Pure `@throng/core/panel-type/`. No OS/DOM. Drives the type-selection form and the assign/revert lifecycle
(type fixed while content is live; re-typeable once it ends).

## Registry

```ts
register(descriptor: PanelTypeDescriptor): void   // idempotent by id
list(): PanelTypeDescriptor[]                      // dropdown source (stable order)
get(id: PanelKind): PanelTypeDescriptor | undefined
```

**Obligations**
- `list()` returns every registered descriptor; order stable across calls.
- Registering a duplicate `id` replaces (or throws) deterministically — pick one and test it.
- A future descriptor is added with **no edit** to the form/confirm/clear/lock flow (SC-006).

## Descriptor

```ts
defaults(ctx): V            // initial values (terminal: first flavour + its default params)
validate(values, ctx): { ok: true } | { ok: false; errors: Record<string,string> }
buildConfig(values, ctx): PanelConfig
inputs: PanelTypeInputSpec[] // declarative; renderer renders generically
```

**Obligations**
- `validate` returns `ok:false` when a required input is empty/invalid (gates **Confirm**, FR-005).
- For Terminal: invalid when no flavour selected, or `projectRoot` is null (FR-010 edge / no-project edge).
- `buildConfig` only runs when `validate.ok` — produces the persisted `TerminalPanelConfig`.

## Assignment & revert (FR-006 / FR-020)

Core ops in `panel-type/assignment.ts` (via `operations.ts`):
`setPanelType(layout, panelId, kind, config)` and `clearPanelType(layout, panelId)`.

**Obligations**
- `setPanelType` assigns `kind`+`config` **iff** the panel is currently **untyped** (`kind === undefined`).
- While a panel is typed, `setPanelType` is a **no-op or throws** (deterministic) — the type cannot change
  *while content is live* (FR-006). The type is **not** permanently immutable.
- `clearPanelType` resets a typed panel back to **untyped** (`kind`/`config` undefined) — called when a
  Terminal Panel's content ends (FR-020) so the form returns and the panel is **re-typeable**.
- Both return a new layout (immutably); changes auto-persist via the existing layout-blob save. A reverted
  panel persists as **untyped** (FR-007).
- The form's **Clear** button is a **renderer-only** reset of an *untyped* form (no core mutation); only
  **Confirm** calls `setPanelType`.

## Contract tests (unit)
register/list ordering; duplicate handling; validate gating (valid/invalid/no-project); buildConfig output;
`setPanelType` assigns from untyped; assignment refused while typed; **`clearPanelType` reverts to untyped
and a subsequent `setPanelType` succeeds** (re-type); untyped layouts round-trip unchanged.
