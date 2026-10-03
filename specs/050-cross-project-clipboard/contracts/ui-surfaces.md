# Contract: UI surfaces

## §1 Clash prompt (FR-017, FR-018 – FR-018f)

Through `useChoose` (`confirm-dialog.tsx`) — one dialog slot, existing focus trap.

| Part | Content |
|---|---|
| title | `Name already exists` |
| message | `"<name>" already exists in <target folder>.` — the name emphasised |
| details | two columns, *Existing* / *Incoming*: size and modified time for a file (sizes digit-grouped), item count for a folder; the newer side labelled **Newer** · checkbox **Apply to all remaining clashes** |
| choices (in order) | `Cancel` (`clash-cancel`) · `Skip` (`clash-skip`) · `Keep both` (`clash-keep-both`) · `Replace` (`clash-replace`, primary; label `Replace (cannot be undone)` and `danger` when `explorer.replaceMode` is `permanent`) |
| keys | Enter → Replace (`initialFocusValue: 'replace'`); Escape → Cancel; Tab reaches the checkbox |
| test ids | overlay `clash-overlay`, dialog `clash-dialog`, message `clash-message`, checkbox `clash-apply-all` |

Cancel resolves exactly as cancelling the run (§3).

## §2 Paste progress notice (FR-019, FR-019d, FR-013)

One notice per run, `testId: 'paste-progress'`, in the window that started it.

| State | Severity | Message | Body |
|---|---|---|---|
| queued | info | `Paste queued` | `Waiting for N earlier paste(s)` + cancel icon |
| running (≥ 1 s) | info | `Pasting into <folder>` | `done of total` (digit-grouped), current item name, cancel icon (`paste-cancel`, hover title `Cancel paste`) |
| cancelling | info | `Cancelling paste…` | — (the choice dialog is up) |
| done, no failures | — | dismissed | — |
| done, failures | error | `<K> of <N> items could not be pasted` | one row per item: subject via `formatSubject`, cause via `causeMessage` |
| rolled back, some not restored | error | `Roll back could not restore <K> items` | one row per item |

Display: persistent while running or queued (`display` override); the failure state uses the user's error setting.
The cancel control is a themed icon (existing `close`/`stop` icon token) — the *Action controls* gate.

Notification API widening (`common/notification.tsx`): `notify(input): string` (the id) and
`update(id, patch: Partial<NoticeInput>)`. `update` on a dismissed id is a no-op; a severity change files one log
record. No existing caller changes.

## §3 Cancel choice (FR-019a)

`useChoose`: title `Cancel paste?`, message `Keep the items already pasted, or roll the whole paste back?`, choices
`Keep finished` (`paste-keep`) · `Roll back` (`paste-rollback`, primary). Escape = Keep finished — the answer that
undoes nothing.

## §4 Quit prompt (FR-019f)

`useChoose`: title `A paste is still running`, choices `Cancel pastes` (`quit-cancel-pastes`) · `Wait` (`quit-wait`,
primary). Escape dismisses → the quit is abandoned and the paste keeps running. *Cancel pastes* then shows §3.

## §5 Context menu Paste label (FR-025, FR-025a)

| Clipboard | Label |
|---|---|
| empty | `Paste` (disabled) |
| one item, same project | `Paste "config.json"` |
| several, same project | `Paste 3 items` (count digit-grouped) |
| from another project | the above + ` from <project name>` |

Shortcut, icon and section unchanged. No other indicator anywhere (FR-025a); the toolbar has no Paste control.

## §6 Preferences (FR-018f)

`explorer.replaceMode` — label `When Paste replaces an item`, options `Move it to the Recycle Bin` (default) /
`Delete it permanently`, placed directly after `explorer.deleteMode`; row in `docs/preferences.md`.
