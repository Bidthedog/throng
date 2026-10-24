# Contract: main ↔ renderer, OS ports, command

## IPC channels (preload `attention` namespace)

| Channel | Direction | Payload | Purpose |
|---|---|---|---|
| `throng:attention:changed` | main → all windows | `{ marks: AttentionMark[] }` | full set, on every change |
| `throng:attention:focus` | renderer → main | `FocusReport` | coalesced per frame |
| `throng:attention:toast` | main → one window | `{ op: 'raise' \| 'update' \| 'dismiss', panelId, kind?, title?, projectName?, reason? }` | one toast per mark (FR-035) |
| `throng:attention:focusPanel` | main → one window | `{ panelId, projectId }` | navigate and focus (FR-034, FR-080a) |
| `throng:attention:goTo` | renderer → main | `{ panelId }` | a toast link or Go to Next asks main to route |
| `throng:attention:badgeImage` | main ↔ main window | request `{ count, kind }` → reply `{ dataUrl }` | badge drawn with theme colours (R13) |
| `throng:attention:flag` *(round 12)* | renderer → main | `{ panelId, projectId, panelTitle, tabTitle, projectName }` | the panel menu's Flag (FR-125); main raises a user mark and persists it |

*(round 12)* The preload adds `attention.flag`. A toast's card body sends `throng:attention:goTo`
(FR-124); the card has no go-to control, so the `goToPanel` icon row below is retired unless something
else draws it (R18). Holder state gains `count` (FR-131).

The preload exposes `attention.onChanged`, `attention.reportFocus`, `attention.onToast`,
`attention.onFocusPanel`, `attention.goTo` and `attention.onBadgeRequest`. The renderer never sees the
daemon.

## OS ports (`packages/core/src/abstractions/`)

```ts
interface ISystemNotifier {
  show(n: { id: string; title: string; body: string; kind: 'attention' | 'failed' }): void;
  close(id: string): void;            // no-op if not shown
  onClick(handler: (id: string) => void): void;
}

interface ITaskbarBadge {
  set(image: string /* PNG data URL */, description: string): void;   // every window with a taskbar button
  clear(): void;
}
```

- **No-op implementations** in core (`NoSystemNotifier`, `NoTaskbarBadge`), the `NoForegroundHandoff`
  pattern.
- **Electron implementations** in `packages/ui/src/main/electron-system-notifier.ts` and
  `electron-taskbar-badge.ts`.
- **Recording fakes** under E2E (`THRONG_E2E_ATTENTION_OS=record`). They write their calls to the
  harness log for assertion.
- **Contract tests** in `packages/ui/tests/contract/`, run against the fake and the no-op.

## Command

| Id | Scope | Default (Windows) | Window-handled | Menu |
|---|---|---|---|---|
| `focus.nextMarkedPanel` | EVERYWHERE | `Ctrl+Shift+Alt+G` | yes | cog menu, disabled when nothing is marked |

Key Bindings editor: group "Navigate", label "Go to Next Marked Panel", description "Switch to the
next panel marked as needing you, across projects and tabs, and focus it."

## Theme

| Token | Kind | Used by |
|---|---|---|
| `attentionMark` | colour | Attention mark icon and badge |
| `attentionFailedMark` | colour | Failed mark icon and badge |
| `attention` | icon | Attention mark, the cog-menu row |
| `attentionFailed` | icon | Failed mark |
| `goToPanel` | icon | the toast's link control |
