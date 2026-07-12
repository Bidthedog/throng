# Contract: Search & Scrollback Keybindings (`@throng/core/config`)

New rebindable commands (FR-017). Each is a stable `ActionId` added to `keybindings.ts`
(`ActionId` union + `DEFAULT_KEYBINDINGS.bindings`) **and** a matching `chord(...)` descriptor in
`keybindings-metadata.ts` so it appears in the visual Key Bindings editor. The completeness test
(FR-047) fails if any new action lacks a descriptor.

Commands are **scoped by active panel type** (FR-020), the same active-pane gating that already scopes
`editor.*` and `file.*`: editor-only actions resolve only when an editor panel is active; terminal-only
actions only when a terminal panel is active; the shared find actions resolve for whichever panel is active.

## New action-ids, default chords, groups

| ActionId | Default chord(s) | Group | Scope | Requirement |
|----------|------------------|-------|-------|-------------|
| `search.find` | `Ctrl+F` | Search | active editor or terminal | FR-001/002, US1/US2 |
| `search.findNext` | `F3`, `Enter` (in bar) | Search | active session | FR-006/011, FR-015 |
| `search.findPrevious` | `Shift+F3`, `Shift+Enter` (in bar) | Search | active session | FR-006/011, FR-015 |
| `search.close` | `Escape` | Search | find bar open | FR-004 |
| `search.replace` | `Ctrl+H` | Search | active editor | FR-008, US4 |
| `search.replaceCurrent` | `Alt+Enter` (in bar) | Search | active editor, bar open | FR-008 AC1 |
| `search.replaceAll` | `Ctrl+Alt+Enter` | Search | active editor, bar open | FR-008 AC2 |
| `terminal.scrollLineUp` | `Ctrl+Shift+Up` | Terminal | active terminal | FR-014 |
| `terminal.scrollLineDown` | `Ctrl+Shift+Down` | Terminal | active terminal | FR-014 |
| `terminal.scrollPageUp` | `Shift+PageUp` | Terminal | active terminal | FR-014 |
| `terminal.scrollPageDown` | `Shift+PageDown` | Terminal | active terminal | FR-014 |
| `terminal.scrollToTop` | `Ctrl+Home` | Terminal | active terminal | FR-014 |
| `terminal.scrollToBottom` | `Ctrl+End` | Terminal | active terminal | FR-014, FR-012a resume |

Notes:
- **Next/previous match** while find is active (FR-015) reuses `search.findNext`/`search.findPrevious`
  — they act on the active session, terminal or editor. No separate `nextMatch` id (DRY/YAGNI).
- In-bar chords (`Enter`, `Shift+Enter`, `Alt+Enter`) are handled by the find bar when it has focus; the
  listed global chords are the rebindable defaults surfaced in the editor.
- Chords are **defaults only** and fully rebindable (low lock-in, spec Assumptions). Terminal chords use the
  conventional `Shift+PageUp/Down` scrollback keys; because the shell may otherwise see some chords, the
  active-terminal scoping ensures nav/find keys are consumed by throng and **never forwarded to the pty**
  (FR-014, SC-002).

## Descriptor additions (keybindings-metadata.ts)

Add two groups following the existing `chord(key, group, label, description)` pattern:

```ts
// Search (find/replace; resolved for the active editor or terminal panel)
chord('search.find', 'Search', 'Find', 'Open find on the active panel.'),
chord('search.findNext', 'Search', 'Find next', 'Go to the next match.'),
chord('search.findPrevious', 'Search', 'Find previous', 'Go to the previous match.'),
chord('search.close', 'Search', 'Close find', 'Close the find bar and clear highlights.'),
chord('search.replace', 'Search', 'Replace', 'Open find with replace on the active editor.'),
chord('search.replaceCurrent', 'Search', 'Replace match', 'Replace the current match.'),
chord('search.replaceAll', 'Search', 'Replace all', 'Replace every match in one undoable step.'),
// Terminal scrollback navigation (resolved while a terminal panel is active)
chord('terminal.scrollLineUp', 'Terminal', 'Scroll line up', 'Scroll the terminal up one line.'),
chord('terminal.scrollLineDown', 'Terminal', 'Scroll line down', 'Scroll the terminal down one line.'),
chord('terminal.scrollPageUp', 'Terminal', 'Scroll page up', 'Scroll the terminal up one page.'),
chord('terminal.scrollPageDown', 'Terminal', 'Scroll page down', 'Scroll the terminal down one page.'),
chord('terminal.scrollToTop', 'Terminal', 'Scroll to top', 'Jump to the start of the scrollback.'),
chord('terminal.scrollToBottom', 'Terminal', 'Scroll to bottom', 'Jump to the live bottom.'),
```

## Contract tests

- Completeness (existing FR-047 test) — every new `ActionId` has exactly one descriptor.
- `parseKeybindings` merges the new defaults when absent from user config (existing merge behaviour).
- No default chord duplicates an existing binding within the same active scope (new unit assertion).
