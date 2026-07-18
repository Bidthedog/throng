# Contract: The derived syntax-contrast guard

**Feature**: 019 | Governs FR-025…FR-029 (C3, C4, C5) | **Tested by**: `packages/core/tests/unit/theme-syntax-body-contrast.test.ts`

`#83`'s premise is **false** — the bundled light themes are not illegible. All ten syntax tokens
against `editorBg` across all fifteen themes: **150 pairs, zero failures**, every pair ≥6.01:1
(`Light`'s worst is 6.12). The cause is `default-themes/index.ts:186-192`, where `makeTheme` pushes
every seed through `legibleOn(c, [editorBg], editorFg, 6)` before it becomes a token. The **guard gap**
is entirely real: nothing measures these pairs, and `THRONG_THEME` — hand-authored, bypassing
`makeTheme` — passes **by luck**.

This is a **guard** contract. No theme is recoloured.

---

## 1. `packages/core/src/config/theme-quality.ts`

```ts
/** DERIVED from the canonical registry (was a hand-list, :292-303). */
export const SYNTAX_TOKENS: readonly string[] =
  Object.keys(THRONG_THEME.colours).filter((t) => t.startsWith('syntax')).sort();

/** WCAG AA body (4.5) is the FLOOR. 6.0 is throng's house standard for code on the editor body (C3). */
export const SYNTAX_BODY_MIN = 6.0;

/** Deliberately low-contrast by design — ungated, never defective (#61's policy, FR-028). */
export const BY_DESIGN_LOW_CONTRAST_THEMES: readonly string[] = ['Matrix', 'VI-VIM', 'Gothic'];

/** DERIVED, so a token that does not exist yet is measured anyway (FR-026). */
const SYNTAX_ON_BODY: readonly ContrastPairing[] = SYNTAX_TOKENS.map((fg) => ({
  fg, bg: 'editorBg', min: SYNTAX_BODY_MIN, label: `${fg} on the editor background`,
}));

export const CONTRAST_PAIRINGS: readonly ContrastPairing[] = [ …existing…, ...SYNTAX_ON_MATCH, ...SYNTAX_ON_BODY ];

/** Hard gate for the NEW pairings across every bundled theme bar the carve-out (C4, FR-027). */
export function assertSyntaxBodyContrast(themes: readonly Theme[]): void;   // throws, naming theme+token+ratio
```

**MUST**
- derive `SYNTAX_TOKENS` from `THRONG_THEME.colours` — the always-complete theme every other theme
  falls back to, and the one theme that bypasses `makeTheme`'s lift. `SYNTAX_TOKENS` is **itself a
  hand-list today**, which is the same bug one level down: the RED test refuses to trust it and derives
  its own set to compare against (`:45-48`, `:106-108`)
- derive the pairings from that set (**FR-026**) — a `syntaxDecorator` added later is measured **without
  anyone editing a list** (SC-013; the RED test's *"covers a syntax token that does not exist yet"*,
  `:80-104`)
- measure the **shipped** token value `theme.colours[t]`, never a seed (**FR-029**). The authored seeds
  are not what ships
- record `SYNTAX_BODY_MIN`'s reasoning **in the source**, not only in a spec: `makeTheme` lifts to 6:1
  because the search-match tint can only be as strong as the weakest syntax hue permits, so a 4.5 gate
  would be **weaker than the derivation it exists to protect** — it would admit a comment authored at
  exactly 4.5 that collapses the search highlight to invisibility (C3)
- keep `WCAG_AA_BODY` (4.5) unchanged and still governing every other body pairing

**MUST NOT**
- touch `IN_SCOPE_THEMES` (`:278`). It governs the **existing** pairings; widening *that* is #61
  (milestoned vNext) and is risky because those themes may fail today. Separating the pairing **sets**
  is what dissolves #83's apparent contradiction and makes it **not blocked by #61** (C4)
- add `editorSelection` pairings — **C5**: a different pairing set, unmeasured, not named by #83.
  Raised as a follow-up issue rather than silently widened
- lower the 6:1 lift in `makeTheme`. It is load-bearing for the search-match tint whatever the gate says

## 2. Gating scope (C4)

| Theme set | Old pairings (`IN_SCOPE_THEMES`) | New syntax/`editorBg` pairings |
|---|---|---|
| Bash, SUBNET, Cyberpunk | hard-gated (`assertInScopeContrast`, `:372-383`) — unchanged | hard-gated |
| the other 12 bundled themes | reported only (`knownContrastIssues`, `:396-405`) — unchanged | **hard-gated** |
| Matrix, VI-VIM, Gothic | reported only | **ungated by design** — though all three pass anyway, so the carve-out costs nothing today and exists so a future recolour is not reported as a defect |

Gating the new pairings everywhere **cannot fail the build**: they pass on all fifteen themes right now,
measured.

## 3. Where the build fails (FR-027)

`assertSyntaxBodyContrast(ALL_DEFAULT_THEMES)` is called from the **existing** theme-quality guard suite,
beside `assertDistinct` / `assertInScopeContrast` — the same mechanism, not a new one. A theme that fails
**fails the build**, never a report nobody reads (which is what routing a failure to
`knownContrastIssues()` would be, and is exactly what #83 objects to).

## 4. The one test amendment in this feature

`theme-syntax-body-contrast.test.ts:65` asserts `pairing.min` **`toBe(WCAG_AA_BODY)`** — 4.5 — while C3
settles the gate at 6.0. The test predates the clarification session; its stated intent is *"at the
body-text threshold, **not a relaxed UI one**"* — it defends against `WCAG_AA_LARGE_UI` (3.0), and 6.0
satisfies that intent more strictly.

**Amend that single assertion:**

```ts
expect(pairing?.min, `${token} on editorBg is gated below body text`).toBe(SYNTAX_BODY_MIN);
expect(SYNTAX_BODY_MIN).toBeGreaterThanOrEqual(WCAG_AA_BODY);   // the "not relaxed" property, still asserted
```

Nothing else in the file changes. The 16 green assertions stay exactly as written — they gate the 4.5
**floor** and pass at 6.01+. Reasoned in [research.md §6 / Concerns with settled decisions](../research.md).

## 5. Observable contract

| Assertion | Expectation | Test |
|---|---|---|
| every registry syntax token has an `editorBg` pairing | `unmeasured === []` | RED (`:51-59`) |
| each is gated at the body threshold | `pairing.min === SYNTAX_BODY_MIN` (amended) | RED (`:61-67`) |
| `measureContrast(Light)` reports an `editorBg` result per token | `missing === []` | RED (`:69-76`) |
| an invented `syntaxDecorator` at `#0d1017` on throng's `#0c0f16` | measured, and `pass === false` | RED (`:80-104`) |
| `SYNTAX_TOKENS` agrees with the registry | equal | green — **structurally true** once derived (`:106-108`) |
| each of 15 themes: every syntax token ≥ `WCAG_AA_BODY` on its `editorBg` | no failures | green ×15 — the measured 150, locked in (`:111-125`) |
