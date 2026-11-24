# Contract: Themes tab conformance mark

Observable in Preferences → Themes (`data-testid="themes-tab"`).

| Element | Selector | Present when | Content |
|---|---|---|---|
| Theme option | `[data-testid="theme-select"] option[value="<name>"]` | always | `<name>`, conforming or not (round 3). |
| Mark | `[data-testid="theme-wcag-mark"]` | the selected theme conforms | the `wcagConformant` icon from the active icon set; `title="Meets WCAG AA contrast"`; coloured by `--throng-colour-text` (research R6); not focusable, not a button. |
| (absence) | — | the selected theme does not conform | no element, no placeholder, no warning (FR-010). |

Conformance is `meetsWcagAa(activeTheme)`, the active theme as painted (research R5). Listed themes are not measured.
