# Quickstart: validating 078

## Automated

```bash
td run --runner unit --scope file --target packages/core/tests/unit/theme-quality.test.ts
td run --runner unit --scope file --target packages/core/tests/unit/default-themes.test.ts
td run --runner component --scope file --target packages/ui/tests/component/preferences-themes-tab.test.ts
```

Expected: every gated theme passes every pairing, including accent text on accent; a deliberately lowered colour in a
theme — Matrix, VI-VIM and Gothic included — fails naming theme, pairing and ratio (FR-001, FR-002); the
upgrade plan moves `accentText` for VSCode, English Garden and Debian only where the file holds the version-38 value.

## By hand

1. Open Preferences → Themes and open the theme list: every theme shows its name alone.
2. Select VSCode: the shield mark sits beside the picker; hovering shows "Meets WCAG AA contrast".
3. Select a clone whose Text equals its App Background: no mark, nothing in its place.
4. On a cloned theme, set Text to the App Background colour: the mark disappears; Revert restores it.
5. With a pending notification on VSCode, English Garden and Debian, the count pill reads clearly.
