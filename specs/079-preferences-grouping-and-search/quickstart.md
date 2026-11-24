# Quickstart: validating 079

## Automated

```bash
td run --runner unit --scope file --target packages/core/tests/unit/settings-search.test.ts
td run --runner unit --scope file --target packages/core/tests/unit/theme-metadata.test.ts
td run --runner component --scope file --target packages/ui/tests/component/themes-tab-subgroups.test.ts
td run --runner component --scope file --target packages/ui/tests/component/preferences-settings-search.test.ts
```

What they prove: the #270 worked examples and acceptance criteria (spec US1), the AND subset property
(SC-003), unchanged empty-query order (SC-004), unchanged theme row order (SC-005), and no `·` in a
theme section (SC-006).

## By hand (Preferences window)

1. **Key Bindings**: type `go to line`. **Go To Line** is the first row.
2. **Key Bindings**: type `Go to`. **Go Away** is not listed.
3. **Themes**: clear the search. Editor shows a **Syntax** subgroup, and General shows **Buttons**
   with **Confirm**, **Cancel** and **Destroy** inside it.
4. **Themes**: type `syntax`. The Syntax subgroup is returned whole.
5. **Settings**: clear the search. The order is the same as on master.
