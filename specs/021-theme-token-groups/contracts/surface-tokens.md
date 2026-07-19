# Contract — Surface token consolidation (US6, FR-023–026)

## Model changes (`theme.ts`)
- **Removed** from `THRONG_THEME.colours`, `TOKEN_PARENT`, `OPTIONAL_THEME_COLOUR_TOKENS` (where present), copy, metadata: `menuSurface`, `dialogSurface`.
- **Kept**: `surface` (Panel Surface), `surfaceActive` (Active Surface), `inputSurface` (Field Surface), `hoverSurface`, `menuItemHoverSurface` (Menu Highlight). `TOKEN_PARENT` retains `inputSurface→surface`, `hoverSurface→surface`.

## CSS repoint (renderer)
| Concept | Before | After |
|---|---|---|
| Menu/dropdown/context/lang-menu card | `--throng-colour-menuSurface` | `--throng-colour-surfaceActive` |
| Modal/notice/dialog/find-bar/terminal-retry card | `--throng-colour-dialogSurface` | `--throng-colour-surface` |
| Files & Folders pane `.pane--explorer` | `--throng-colour-surface` | `--throng-colour-sidebarBg` |
| Every `.ctl` field (input/select/textarea, theme dropdown, colour hex) | `--bg` (`appBg`) | `--throng-colour-inputSurface` |

## Assertions
- No `menuSurface`/`dialogSurface` token or CSS var remains anywhere (grep = 0).
- Menu cards resolve to `surfaceActive`; dialog cards to `surface`.
- `.pane--explorer` and `.pane--sidebar` resolve to the **same** background token (`sidebarBg`).
- 100% of `.ctl` field surfaces resolve to `inputSurface` (E2E: theme dropdown + a settings field computed-style check).
