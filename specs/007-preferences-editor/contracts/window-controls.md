# Contract: `window.*` controls + `openPreferences` (renderer ↔ UI main)

**Preload**: `packages/ui/src/preload/preload.cts`. **Main**: `packages/ui/src/main/window-controls-ipc.ts`
+ `preferences-window.ts`. Drives the custom title bar (FR-002/004) and the cog (FR-005/008/009). No daemon.

## Window controls

```ts
window.minimize(): void;      // throng:window:minimize   → BrowserWindow.fromWebContents(sender).minimize()
window.maximize(): void;      // throng:window:maximize   → toggle maximize/unmaximize (FR-002/004)
window.close(): void;         // throng:window:close      → close (sub-workspace close = retain, existing rule)
window.isMaximized(): Promise<boolean>;
window.onMaximizeChange(cb: (maximized: boolean) => void): () => void; // for the max/restore glyph
```

- Each handler targets the **sender's** `BrowserWindow`, so the main window and each sub-workspace window
  control themselves independently (US8 acceptance 2; independent minimise per Principle XI).
- The bar's empty region is the drag handle via CSS `-webkit-app-region: drag`; controls, the cog, and
  interactive identity elements set `-webkit-app-region: no-drag`. Double-click on the drag region toggles
  maximise (FR-004) — handled in the renderer via `window.maximize()`.

## Cog → preferences

```ts
openPreferences(tab: 'settings' | 'keybindings' | 'themes'): void; // throng:preferences:open
```

- **Main window only** renders the cog (FR-005) and the cog menu with exactly **Settings / Key Bindings /
  Themes** in that order (FR-008), dismissible without a selection.
- Selecting an item calls `openPreferences(tab)` → UI main **creates or focuses** the single shared
  preferences window on the matching tab (FR-009/010/011), makes the main + all sub-workspace windows
  non-interactive (`setEnabled(false)`, FR-013), and captures the on-entry snapshot (reset-all). On close,
  interactivity is restored.
- **Sub-workspace windows MUST NOT expose the cog or `openPreferences`** (FR-007) — their bar is identity +
  controls only.
