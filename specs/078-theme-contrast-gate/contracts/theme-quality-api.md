# Contract: `@throng/core` theme-quality API changes

| Export | Change | Behaviour |
|---|---|---|
| `IN_SCOPE_THEMES` | **Removed** | Every theme is gated (FR-001, FR-003). |
| `BY_DESIGN_LOW_CONTRAST_THEMES` | **Removed** (round 2) | No exemption list (FR-003). |
| `assertInScopeContrast(themes)` | Semantics widened | Throws for any theme in `themes` that has a failing pairing; the message names theme, pairing, ratio and threshold (FR-001). |
| `knownContrastIssues(themes)`, `KnownContrastIssue` | **Removed** (round 2) | Nothing is report-only (FR-002). |
| `assertSyntaxBodyContrast`, `assertSyntaxSelectionContrast` | Semantics widened (round 2) | Cover every theme given (FR-001, superseding 019 FR-028). |
| `CONTRAST_PAIRINGS` | Eight members added | `accentText` on `accent` at `WCAG_AA_BODY` (FR-004); the six button text pairs and `dangerText` on `danger` at `WCAG_AA_LARGE_UI` (FR-004a). |
| `meetsWcagAa(theme)` | **New** | `true` iff `contrastFailures(theme)` is empty (FR-007). |
| `SHIPPED_DEFAULTS_VERSION` | 38 → 40 | Gates `V38_MOVED_COLOURS` and `V39_MOVED_COLOURS`. |
| `V39_MOVED_COLOURS` | **New** (round 4) | Frozen record of what this branch's interim 39 builds wrote that 38 did not: Debian's text on the accent, `#ffffff`. |
| `V38_MOVED_COLOURS` | **New** | Frozen record of the values 38 wrote for every token R3a moves. |
| `assertInScopeContrast` error text | Reworded | `theme contrast below WCAG 2.1 AA: …` (no "in-scope"); name kept for churn. |
