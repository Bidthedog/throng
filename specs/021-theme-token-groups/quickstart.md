# Quickstart — proving feature 021 (grouping + conventions + consolidation)

## By machine (fast; no build)

```bash
# Grouping, closed set, ordering, section search, naming convention, button map, migration, usage guard:
npm run test:unit -- theme-metadata settings-search theme-copy theme-ops default-themes theme-usage
```

Expect (unit):
- **Grouping/search** (shipped): every token's area ∈ `THEME_AREA_GROUPS`; guard rejects a bad group; General first / Icons last; syntax = `Editor · Syntax`; section-name search matches a whole section.
- **Naming (US5)**: every label is `<Context> <Property>` with `<Property>` ∈ vocabulary; no bare or self-referential copy.
- **Buttons (US7)**: the 18 tokens exist under `General · Buttons · {Confirm,Cancel,Destroy}`; the 4 legacy button tokens and `menuSurface`/`dialogSurface` are gone from `THRONG_THEME` and all 15 bundled themes.
- **Migration (FR-031/032)**: `migrateTheme` is idempotent and lossless; a legacy theme gains the 18 button tokens by derivation and keeps every surviving value.
- **Usage guard (US8)**: every token has ≥1 live consumer + ≥1 test; removed tokens have zero consumers.

```bash
npm run test:unit        # full unit layer
npm run lint && npm run typecheck
```

## By machine (E2E; needs a build)

```bash
npm run build
npx playwright test preferences-themes preferences-settings preferences-window theme-buttons theme-fields colour-picker hover-suppression
```

Proves: area headings + section search; Field Surface on all fields incl. theme dropdown; menu=Active Surface / dialog=Panel Surface / Files&Folders=Side Panel; three button types render from their own tokens; window titles end ` — throng`; Preferences has no minimise; hover doesn't stick when Preferences opens from the cog; colour picker stays on-screen near edges.

## By hand (drive the real app)

1. `npm start`, open **Preferences → Themes**. Controls appear under **area headings** (General first — with a **Buttons** sub-section split into **Confirm / Cancel / Destroy** — … Icons last). Every label reads clearly (e.g. **Editor Font Size**, **Confirm Button Hover Background**, **Side Panel Background**).
2. In Themes search type **`editor`** → all Editor rows incl. `Editor · Syntax`. Type **`button`** → all 18 button rows across the three types.
3. Edit **Confirm Button Background** and **Destroy Button Background**; open a dialog with Save + Delete → the two buttons change independently; Cancel is unaffected; a toolbar **icon** button does **not** change.
4. Open **Preferences → Themes** and check the **theme dropdown** and other fields now use **Field Surface** (change Field Surface → all fields recolour, including the dropdown).
5. Title bars read `Preferences — throng`, `<project> — throng`, `<name> · … — throng` (suffix). The **Preferences** window shows only **Maximise/Restore** and **Close** — no minimise, and Win+↓ / taskbar cannot minimise it. Main + Sub-workspace still minimise.
6. **Hover bug**: hover the Files & Folders root, open the cog menu, click **Themes** → while Preferences is open the root row shows **no** hover tint. Move the mouse over it (main focused) → hover returns.
7. **Colour-picker bug**: open a colour swatch on a row near the **right** edge of the window → the picker flips/clamps fully on-screen (not clipped). Same near the bottom edge.
8. **Migration**: take a theme JSON saved before this change (legacy keys), load it → it renders correctly, buttons themed by derivation, no missing-key errors; re-saving writes the new key set.
