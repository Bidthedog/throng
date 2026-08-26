---
name: throng-config-preferences
description: Use for anything configurable — app settings, key bindings, themes and theme tokens, icon packs, their metadata registries in @throng/core, the shipped defaults generator, the config store on disk with its hot-reload and atomic writes, and the visual preferences editors. Triggers include adding or renaming a setting, changing a default or a bounds/clamp, adding a keybinding or command, adding or editing a theme token, "the preferences editor does not expose this", a config file that fails to write or reload, and reset/revert behaviour.
---

# throng — configuration, keybindings, themes and the preferences editors

Configuration is a constitutional area, not a convenience. Two rules govern everything here.

## The three rules

1. **Externalised configuration (Principle X).** Nothing a user could reasonably want to change is
   hardcoded.
2. **Configuration-editor completeness (a quality gate).** Every configurable setting, key binding
   and theme token MUST be exposed and editable through the **visual** preference editors. Nothing is
   editable only by hand-editing JSON. This is enforced mechanically by a descriptor registry plus
   completeness tests — a new key without a descriptor fails the build.
3. **Displayed quantities are digit-grouped; grouping is never stored** (constitution 4.5.0, scope
   widened by **5.4.0** from preference editors to every surface). Use `formatGrouped` /
   `parseGrouped` from `@throng/core` — never `toLocaleString` at a call site, and never a hand-rolled
   comma. The parser is the exact inverse of the formatter *for the active locale*: the separator is
   derived from the locale, not assumed to be a comma, because a locale that groups with `.` turns
   `1.024` into a corrupted or rejected number depending which way the bug falls. A separator reaching
   `settings.json`, a theme file or an IPC boundary is the defect this guards.
   - The rule covers **quantities** — amounts the user reads. An **ordinal inside a name**
     (`Panel 1024`), a number **seeded into an editable field** whose parser takes bare digits, and
     anything **machine-read** are excluded; grouping those is a defect. `navigate/goto-line.tsx`
     carries the worked reasoning for the editable-seed case.

So a "one-line setting" is never one line. The minimum change set is: the value in the model, a
descriptor in the matching metadata registry, the shipped default, the editor control, and a test.

## The pieces

**Model and registries — `packages/core/src/config/`**
`settings.ts` + `settings-metadata.ts`, `keybindings.ts` + `keybindings-metadata.ts`, `theme.ts` +
`theme-metadata.ts`, `icon-pack.ts`, `default-themes/`, `shipped-defaults.ts`, `app-settings.ts`,
`metadata.ts`, `overridden.ts`, plus the value helpers (`colour.ts`, `zoom.ts`, `number-format.ts`,
`font-stack.ts`, `font-typeahead.ts`, `chord-capture.ts`, `svg-sanitise.ts`, `theme-ops.ts`,
`theme-copy.ts`, `theme-reset.ts`, `theme-quality.ts`, `theme-editor-model.ts`, `settings-search.ts`,
`starting-folder.ts`, `pipe-endpoint.ts`, `product-version.ts`, `publish-gate.ts`).

**Persistence and reload — `packages/ui/src/main/`**
`config-store.ts`, `config-watcher.ts`, `config-write-ipc.ts`. Writes are atomic and ordered; see
`config-store-atomic.test.ts`, `config-write-durability.test.ts`, `write-config-ordering.test.ts`,
`config-hotreload.e2e.ts`, `config-write-failure.e2e.ts`. `THRONG_CONFIG_ROOT` relocates the whole
config root, `THRONG_HOTRELOAD_DEBOUNCE_MS` tightens the watcher for tests.

**Editors — `packages/ui/src/renderer/preferences/`**
`preferences-app.tsx`, `settings-tab.tsx`, `keybindings-tab.tsx`, `themes-tab.tsx`, `json-tab.tsx`,
`icon-section.tsx`, `form-controls.tsx`, `map-control.tsx`, `pickers.tsx`, `capture-modal.tsx`,
`row-actions.tsx`, `reset-notice.tsx`.

**Generated** — `npm run generate:defaults` runs `scripts/generate-shipped-defaults.mjs`; regenerate
rather than editing the generated output.

## Checklist for a new setting

1. Add the key to the settings model with its type and default.
2. Add a descriptor to `settings-metadata.ts` — label, group, control type, bounds. Bounds in the
   descriptor and any clamp in code must agree; a mismatch between the two is a known past defect
   (issue #227, and the `terminals.linkHoverDelayMs` case).
3. Regenerate shipped defaults.
4. Expose it in the right preferences tab, using existing form controls. A numeric control gets digit
   grouping for free by going through `NumberControl` — anything that renders a number *outside* it
   must call `formatGrouped` itself (rule 3).
5. Cover it: `packages/core/tests/unit/settings-metadata.test.ts` and friends
   (`reset-completeness.test.ts`, `theme-metadata.test.ts`, `keybindings-metadata.test.ts`) are the
   completeness gate; add behaviour tests where the value does something.
6. Document it if it is user-facing (`docs/`), per the documentation-currency rule.

## Checklist for a new keybinding

Same shape, plus the Principle IV keyboard tiers: never take a reserved terminal key
(`Ctrl+C/D/Z/A/E/W/U/K/R/L/Q`) in a scope live in a terminal; take a shadowable key only as a
constitutional exception recorded in the same change; one command, one chord across panel types; do
not widen the cross-flavour parity gap. Scopes live in `COMMAND_SCOPES` (`keybindings.ts`) and
`renderer/keybindings/scope.ts`; the binding tests in `packages/core/tests/unit/` (e.g.
`menu-open-binding`, `editor-toggle-word-wrap-binding`, `keybindings-scope`) show the pattern. A
discrete command also needs its menu item (Principle VI).

## Checklist for a theme token

Token in the theme model + `theme-metadata.ts`, a value in every default theme, exposure in the
themes tab, and no hardcoded colour at the call site — `css-variables-defined`, `theme-usage`,
`surface-token-roles`, `icon-tokens-exist` and `no-inline-artwork` will catch you.

## Testing altitude

Almost nothing here is an E2E. A descriptor, a bound, a clamp, a default, a format and a collision
rule are **unit** tests. A control's rendered form, its two-way binding, what a chord capture accepts
and rejects, and what a reset button does to the DOM are **component** tests. Writing
`settings.json`, `keybindings.json` or a theme file and watching it hot-reload — including the
atomic-write and concurrency semantics — is an **integration** test, and the real ones already live
in `packages/ui/tests/integration/config-*`.

Reach for E2E only where the preferences *window itself* is the subject: it opening as a real second
window, focus returning to the main window, a native dialog. If your assertion would survive with no
window at all, it does not belong at that layer.

## Not yours

Preference *window* focus/layout behaviour → `throng-renderer-ui` (and remember: any spec opening the
preferences window belongs in `parallel-plan.json`). Config file location semantics under an
installed build → `throng-build-release`.
