# Contract: `IDisplayInfo` OS abstraction

**Interface** (`@throng/core/src/abstractions/display-info.ts`) — process-agnostic, no OS imports:

```ts
export interface DisplayBounds { x: number; y: number; width: number; height: number; }
export interface DisplayDescriptor { id: string; bounds: DisplayBounds; }
export interface WindowBounds extends DisplayBounds { displayId?: string; }

export interface IDisplayInfo {
  listDisplays(): DisplayDescriptor[];
  /** True if the window bounds lie (at least partly) within some connected display. */
  isVisible(bounds: WindowBounds): boolean;
  /** Returns bounds repositioned onto a currently-connected display (no-op if already visible). */
  clampToVisible(bounds: WindowBounds): WindowBounds;
}
```

**Implementation**: `ElectronDisplayInfo` in `@throng/ui` **main process** (uses Electron `screen`,
which is only available in the main process — research D8). The core holds the interface only; the
renderer never calls it directly.

**Contract suite** (`@throng/core/src/testing/display-info-contract.ts`, run against every impl):

1. `listDisplays()` returns ≥ 1 display, each with positive `width`/`height`.
2. `isVisible()` is `true` for bounds fully inside a listed display and `false` for bounds entirely
   off all displays (e.g. a disconnected-monitor position).
3. `clampToVisible()` always returns bounds for which `isVisible()` is `true` (FR-019/028) and is a
   no-op for already-visible bounds.

Used by the UI-main `window-manager` when restoring sub-workspace windows (US4) so a saved position
on a now-absent monitor opens on a visible display instead of off-screen.
