# Phase 0 Research: Theme Content

## R1 — Perceptual distinctness metric

- **Decision**: CIEDE2000 colour-difference over the CIE L*a*b* space, aggregated as the **minimum** per-token distance across colour tokens present in both themes. Pipeline: hex → sRGB (0–255) → linearised → CIE XYZ (D65) → CIE L*a*b* → CIEDE2000(ΔE00).
- **Rationale**: CIEDE2000 is the current CIE-recommended perceptual metric and models the non-linearities (lightness, chroma, hue rotation) that a naive RGB/CIE76 distance misses. Minimum aggregation is mandated by the clarification: two palettes that differ in only one accent must still be flagged as twins, which a mean would hide. This is exactly the Bash/Matrix case (near-identical across the whole token set).
- **Alternatives considered**: CIE76 Euclidean-in-Lab (simpler but perceptually inaccurate around blues/greens — risky for green Matrix vs multi-hue Bash); whole-palette vector distance (a single differing token could not lift a cloned palette above threshold); RGB Euclidean (no perceptual grounding). All rejected.

## R2 — Distinctness threshold (calibrated constant)

- **Decision**: Calibrate. After recolouring Bash, compute the minimum-token-pair ΔE00 for every bundled pair, take the **closest legitimate pair** distance `C`, and set `DISTINCTNESS_THRESHOLD` to a value strictly below `C` (and strictly above the pre-fix Bash-vs-Matrix distance). Record both numbers in the test and here.
- **Rationale**: The clarification resolves the scope contradiction: a hard gate over all themes must not force redesign of out-of-scope themes. Anchoring the threshold to the real data guarantees exactly that — genuine twins fail, today's legitimate pairs pass.
- **Procedure/audit**: A unit test prints/records `C` and asserts (a) all current legitimate pairs ≥ threshold, (b) a duplicated theme fails, (c) old-Bash-vs-Matrix < threshold. The chosen number and the measured `C` are written into `theme-quality.ts` as a documented constant and echoed in the test name/message. *(The measured values are filled in during implementation and reported back.)*
- **Alternatives considered**: A fixed textbook ΔE00 threshold (e.g. 1.0 or 2.0 "just noticeable") — rejected: our themes are whole palettes, not single swatches, and a fixed number risks either failing legitimate dark themes or passing near-twins.

## R3 — Contrast standard, ratios & pairings

- **Decision**: WCAG 2.1 relative-luminance contrast ratio; **AA** thresholds — **4.5:1** for body text, **3:1** for large text and UI components (accent colours treated as UI components at 3:1). Measured over an **explicit enumerated pairing list**, not all combinations:
  1. `text` on `appBg`
  2. `textMuted` on `appBg`
  3. `terminalFg` on `terminalBg`
  4. `editorFg` on `editorBg`
  5. `editorGutterFg` on `editorGutterBg`
  6. `buttonText` on `buttonBg`
  7. `buttonHoverText` on `buttonHoverBg` (hover variant)
  8. `buttonText` on `surfaceActive` (active variant)
- **Rationale**: WCAG 2.1 AA is the recognised baseline; enumerating pairings keeps the assertion deterministic and lets SUBNET's neons live on accents at the 3:1 UI threshold rather than being forced to 4.5:1. Pairings 1/3/4/5 are body text (4.5:1); 2 (muted) and 6/7/8 (button/UI) are evaluated at their appropriate threshold — muted text is decorative/secondary and UI-level, buttons are UI components (3:1).
- **Scope of enforcement**: Hard build failure for **Bash, SUBNET, Cyberpunk** only. Every other bundled theme is measured and any shortfall is emitted in a known-issues report but does **not** fail the build (FR-018).
- **Alternatives considered**: AAA (7:1) — rejected as stricter than required and incompatible with neon-on-blue accents; "every possible pairing" — rejected as non-deterministic and noisy.

## R4 — Abbreviation / machine-generated detection

- **Decision**: Two-part assertion. (a) A case-insensitive, **word-boundary** regex over a banned-substring blocklist (`bg, fg, bkg, fore, min, max, cfg, config, id, num, btn, sel`) — so "Background"/"Foreground"/"minimum"/"configuration" pass while standalone "bg"/"fg"/"min" fail. (b) Assert no label/description equals the string the mechanical generator (`descriptorForThemeToken`'s humanise-based output) would produce for that token.
- **Rationale**: Directly targets the observed defect ("App bg" / `The "App bg" colour token.`). Word boundaries avoid false positives on full words. Comparing against the generator output catches copy that is technically un-abbreviated but still a mechanical restatement. A dictionary/word-list check was explicitly rejected (breaks on "SUBNET", "Git Bash", "throng").
- **Alternatives considered**: dictionary spell-check (rejected — proper nouns); LLM-judged quality (non-deterministic, not build-appropriate).

## R5 — Editor gutter tokens & defaults

- **Decision**: Add two general theme colour tokens `editorGutterBg` and `editorGutterFg` to `THRONG_THEME.colours` (same family as `editorBg`/`editorFg`). Default `editorGutterBg` = a **subtle luminance offset** from the theme's `editorBg` (lighter on dark themes, darker on light themes) via a small fixed blend toward white/black; default `editorGutterFg` = a muted foreground that satisfies the 3:1 pairing against the gutter background. `makeTheme` computes both from the palette so every bundled theme supplies them without hand-listing.
- **Rationale**: General colour tokens (not editor-panel-private) means they appear in the theme editor and completeness test automatically — zero editor-renderer change. The subtle offset was the human's explicit choice over preserving today's appearance; a small delta reads as intentional design. `editor.css` repoints `.cm-gutters` background/colour to `var(--throng-colour-editorGutterBg/Fg)` and drops the borrowed `editorBg`/`textMuted` there; the border and active-line rules are unchanged so only the gutter surface/text move.
- **Delta choice**: blend the editor background ~10% toward its opposite lightness pole (white for dark themes, black for light). Justified as visible-but-subtle; verified by the contrast pairing (#5) and a "gutter ≠ editor body, but close" assertion. Exact per-theme values recorded in `data-model.md`/tests.
- **Upgrade impact**: (1) every bundled theme's editor gutter shifts slightly — accepted, documented in README/ROADMAP. (2) Pre-token **user** themes inherit the `THRONG_THEME` defaults via the existing fallback (`resolveColour`/`toCssVariables` merge) with **no migration**; covered by a test asserting a gutter-less theme document still loads and yields the default gutter CSS variables.
- **Alternatives considered**: editor-panel-private CSS-only tokens (rejected — would bypass the theming system and the completeness rule); preserving today's borrowed values as defaults (rejected by the human in favour of the subtle offset).

## R6 — Bash multi-hue palette (Git Bash prompt)

- **Decision**: Keep the black base, but distribute the Git Bash prompt hues across the accent/semantic tokens: green (`success`, user@host), magenta (a shell-tag accent), yellow (`unsavedDot`/path), teal + cyan (`accent`/git-branch, selection). Text stays a readable light-on-black. The result is unmistakably multi-hue and far from Matrix's mono-green under ΔE00-min.
- **Rationale**: Echoes a default Git Bash prompt (green user@host, magenta shell tag, yellow path, cyan git branch) per FR-001, while the black terminal/editor base keeps it a "Bash" theme. Distinctness and in-scope contrast are enforced by the guards.
- **Alternatives considered**: recolouring the background too (rejected — a Git Bash prompt is on black; changing it loses identity).

## R7 — SUBNET & Cyberpunk palettes

- **Decision**: Map the given brand/reference palettes onto the token set. SUBNET: Deep Space Blue `#001B40` as `appBg`/base surfaces, Midnight Slate `#303841` as secondary surface where needed, Gunmetal Grey `#4C4C4C` for borders/muted/chrome, Neon Core Green `#39FF14` + Neon Cyan `#00EFFF` as accents/active/cursor only, Burnt Amber `#FF6F32` for callouts (danger/unsaved), Warning Orange/Bright Yellow used sparingly. Cyberpunk: `#000000` base, `#c5003c` crimson + `#880425` maroon for structure/danger, `#f3e600` bright yellow highlights, `#55ead4` pale teal accents; text a readable light tone derived to pass AA on the near-black base.
- **Rationale**: Satisfies FR-003/004/005 and the "neons on accents only / Deep Space Blue as base" constraint; contrast guard enforces legibility (in-scope, build-blocking).
- **Alternatives considered**: literal 5-swatch fill without regard to token roles (rejected — would put neons on large blocks and fail contrast/base-surface rules).
