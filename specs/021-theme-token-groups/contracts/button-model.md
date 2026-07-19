# Contract — Three-type button model (US7, FR-027–030)

## Model (`theme.ts`)
- **Removed**: `buttonBg`, `buttonText`, `buttonHoverBg`, `buttonHoverText`.
- **Added — 18** `colours.*`: `{confirm,cancel,destroy}Button{Bg,HoverBg,Border,HoverBorder,Text,HoverText}`.
- Group (`theme-metadata.ts` `areaForToken`): `colours.<type>Button*` → `General · Buttons · {Confirm|Cancel|Destroy}`.

## Types
- **Confirm** — safe primary confirm (Save/OK/Apply/Reassign/Leave-running/submit/browse).
- **Cancel** — safe dismiss (Cancel/Close/Clear/non-primary dialog buttons).
- **Destroy** — destructive confirm (Delete/Reset/Discard/Terminate-all/`--danger`).

## CSS
- Retire `--btn-*`; each button class consumes only its type's six vars for `{background, background-hover, border, border-hover, color, color-hover}`.
- `confirm-dialog` classes map: non-last plain → Cancel; `.modal__confirm` → Confirm; `.modal__confirm--danger` → Destroy. Every other raw dialog/form `<button>` mapped per data-model §5.
- Buttons MUST NOT reference `--accent`, `--danger`, `--throng-colour-accentText/dangerText`, or `--border`.

## Exclusion
- `IconButton` and window-control/toolbar/row icon buttons keep `hoverSurface`; they MUST NOT reference any `*Button*` var.

## Assertions
- Each of the 3 classes' computed styles use only their six tokens (E2E render check per type, rest + hover).
- Grep guard: no button-type var appears on an `IconButton` selector; no retired `--btn-*` or borrowed token remains on a themed text button.
