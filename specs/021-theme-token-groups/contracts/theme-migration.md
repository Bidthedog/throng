# Contract — Theme migration (FR-031/032)

## Export (`@throng/core`)
- `migrateTheme(raw: unknown): Theme` (or `migrateThemeColours(colours)`), pure, **idempotent**, **lossless** for surviving tokens.

## Behaviour
Snapshot the original `colours` first (`src`), then in order:
1. **Seed** the 18 button tokens only when absent, deriving **from `src`** (data-model §6): Confirm ← `accent`/`accentText`; Destroy ← `danger`/`dangerText`; Cancel ← legacy `buttonBg`/`buttonHoverBg`/`buttonText`/`buttonHoverText` (fallbacks: bg `surface`, hover-bg `surfaceActive`, text `text`, border `border`); borders per the §6 table.
2. **Drop** `colours.{menuSurface, dialogSurface, buttonBg, buttonText, buttonHoverBg, buttonHoverText}` — **after** deriving, so Cancel captures the legacy values, not fallbacks.
3. All other tokens **unchanged**.

## Integration
- Applied on **load** of any user theme (theme-ops load path / `theme-reset` restore).
- The 15 bundled themes updated at source via the same derivation; `THRONG_THEME` gains the 18 tokens explicitly.

## Assertions
- `migrateTheme(migrateTheme(x)) === migrateTheme(x)` (idempotent).
- For a legacy theme, every surviving token keeps its exact value; the 18 button tokens equal the derivation (lossless, SC-004'). **Cancel tokens equal the legacy `button*` values (not the fallbacks) when those keys are present** — proving derive-before-drop ordering.
- After migration, none of the 6 removed keys remain.
- All 15 bundled themes populate every current token incl. the 18 buttons (existing `default-themes.test.ts` stays green, extended).
