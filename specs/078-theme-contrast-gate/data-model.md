# Data model: Theme contrast gate

No persisted data is added. Two derived values and one changed constant.

| Entity | Shape | Rule |
|---|---|---|
| Contrast pairing (new member) | `{ fg: 'accentText', bg: 'accent', min: 4.5, label: 'accent text on accent fill' }` | Appended to `CONTRAST_PAIRINGS`; measured on every theme (FR-004). |
| Gate scope | every theme passed to a gate | No exemption list (round 2, FR-001–FR-003): `IN_SCOPE_THEMES` and `BY_DESIGN_LOW_CONTRAST_THEMES` are both removed. |
| Conformance | `meetsWcagAa(theme: Theme): boolean` | `contrastFailures(theme).length === 0`. Never stored (FR-007). |
| Contrast pairings (FR-004a) | `confirmButtonText/confirmButtonBg`, `confirmButtonHoverText/confirmButtonHoverBg`, `cancelButtonText/cancelButtonBg`, `cancelButtonHoverText/cancelButtonHoverBg`, `destroyButtonText/destroyButtonBg`, `destroyButtonHoverText/destroyButtonHoverBg`, `dangerText/danger` | Each `min: 3.0` (`WCAG_AA_LARGE_UI`). |
| Palette fields | `onAccent?: string`, `onDanger?: string` on the `makeTheme` palette | Text-on-accent family from `onAccent ?? bg`; text-on-danger family from `onDanger ?? '#ffffff'` (R3a). |
| Theme value upgrade | `V38_MOVED_COLOURS: { VSCode, 'English Garden', Debian: { accentText, confirmButtonText, confirmButtonHoverText, cancelButtonHoverText }, SUBNET: { dangerText, destroyButtonText, destroyButtonHoverText }, Gothic, 'VI-VIM': { the four text-on-accent tokens, editorSelection, editorSelectionInactive }, Matrix: { editorSelection, editorSelectionInactive } }`, Debian also carrying its accent and the seventeen colours derived from it (round 4), each the value 38 wrote | Moves a token only where the file still holds exactly that value (R2). |
| Shipped-defaults version | 38 → 39 → 40 (round 4: `V39_MOVED_COLOURS`, Debian's text on the accent at `#ffffff`) | Gates the upgrade above. |
| Icon key | `wcagConformant` | One SVG in the default set, with a description, in the icon-keys registry. |
