# Contract: renderer ↔ UI main — resources (055)

Exposed on `window.throng.resources` by `packages/ui/src/preload/preload.cts`, typed in
`renderer/global.d.ts`, handled in `packages/ui/src/main/resources-ipc.ts`. Covered by
`ipc-bridge-parity.test.ts`.

| Preload member | Channel | Kind | Payload → result |
|---|---|---|---|
| `summary()` | `throng:resources:summary:get` | invoke | → `ResourceSummary \| null` (latest cached; FR-002) |
| `onSummary(cb)` | `throng:resources:summary` | push, main window only | `ResourceSummary` each tick |
| `detailDemand()` / `onDetailDemand(cb)` | `throng:resources:detail-demand:get` / `throng:resources:detail-demand` | invoke / push, every window | → `boolean`: some window has the monitor open; every window reports its panels while true |
| `subscribeDetail()` | `throng:resources:detail:subscribe` | invoke | → `{ subscriptionId }`; turns detail on |
| `unsubscribeDetail(id)` | `throng:resources:detail:unsubscribe` | invoke | turns detail off with the last subscriber |
| `onDetail(cb)` | `throng:resources:detail` | push, subscribing window only | `{ tick, hierarchy, held }` |
| `reportPanels(ctx, estimates)` | `throng:resources:panels` | send | `WorkspaceContext` (on change), `PanelEstimate[]` (each tick while detail is in demand); main stamps a `renderer` estimate with the sender's OS pid |
| `kill(req)` | `throng:resources:kill` | invoke | `{ mode, nodeId, targets }` → `killResult` |
| `routeAction(req)` | `throng:resources:action:route` | invoke | `{ action: 'destroyTab' \| 'destroyPanel', id }` → `boolean`: sent to the window holding it mounted (R12) |
| `onAction(cb)` | `throng:resources:action` | push, the holding window | that window runs its own Destroy Tab / Destroy Panel |
| `open()` | `throng:resources:open` | send | from any window: open the monitor window, or focus it if open (R14, FR-086) |
| `onOpenRequest(cb)` | `throng:resources:open-request` | push, main window | *Retired with the modal (R14).* |
| `minimise(opts)` | `throng:resources:minimise` | send, monitor window | `{ reducedMotion: boolean }`: shrink the monitor window into the status-bar figures and close it, or just close it (FR-085) |
| — | `throng:resources:status-rect` | invoke main → main window renderer | → the status-bar figures' `{ x, y, width, height }` in CSS px, or `null` when not shown (FR-085) |
| `viewState()` / `saveViewState(v)` | `throng:resources:view:get` / `throng:resources:view:set` | invoke / send, monitor window | the monitor's FR-057 view, an opaque JSON value held by UI main until restart (FR-087) |
| `routeAction(req)` (extended) | `throng:resources:action:route` | invoke | adds `{ action: 'unloadProject', id, variant: UnloadVariant }`, always sent to the main window (FR-086) |

- Every invoke resolves; none rejects to the renderer — failures come back as causes from the
  failure-cause model (FR-064).
- A detail subscription is released automatically when its window closes.
- `summary()` returns `null` before the first tick: the status-bar item renders its loading state
  (FR-051).

Contract test: `packages/ui/tests/contract/resources-ipc.contract.test.ts`.
