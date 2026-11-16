# Quickstart: validating spec 069

Run everything from the worktree root. The data shapes are in [data-model.md](data-model.md) and the IPC
in [contracts/icon-sets-ipc.md](contracts/icon-sets-ipc.md).

## Before any art: the review page (FR-031)

```bash
npm pack lucide-static@1.66.0 --pack-destination "$TMP"    # unpack it somewhere outside the repo
node scripts/icon-review-page.mjs --lucide "$TMP/package" --out "$TMP/icon-review.html"
```

Expect one row per key, each showing its description, render sites, art at 12, 16 and 24 px on light and
dark backgrounds, its origin, and the keys sharing it, with the FR-009 pairs flagged. The maintainer
signs it off. Then:

```bash
node scripts/vendor-lucide-icons.mjs "$TMP/package"         # writes packages/core/src/icons/default-set/*.svg + LICENSE
node scripts/generate-default-icon-set.mjs                 # writes default-icon-set.generated.ts
```

## Automated

```bash
npx vitest run --project unit packages/core/tests/unit/icon-keys.test.ts packages/core/tests/unit/default-icon-set.test.ts
npx vitest run --project unit packages/core/tests/unit/icon-set-upgrade.test.ts packages/core/tests/unit/icon-sets-readme.test.ts
npx vitest run --project integration packages/ui/tests/integration/icon-set-service.test.ts packages/ui/tests/integration/icon-set-upgrade.test.ts
npx vitest run --project component packages/ui/tests/component/icon-section.test.ts packages/ui/tests/component/icon-set-backup-notice.test.ts
```

E2E runs on CI (`icon-sets.e2e.ts`, `@extended @prefs`).

## By hand (the manual test plan's groups follow these)

1. A fresh config root: every icon is line art on Windows and Linux, in a light and a dark theme
   (US1).
2. Preferences → Themes → Icons: each row shows the icon, key, `<key>.svg` and description. The default
   set offers Copy only (US2, US4 scenario 1).
3. Copy → name `mine` → Override this icon on `save` → Open folder → replace `save.svg` → Reload this
   set: the editor title bar's Save icon changes (US4).
4. Override this icon on `save` again: throng asks before replacing it, and Cancel keeps the file (FR-033).
5. An alpha16 config root holding a user pack and an edited `throng-svg`: after starting, both are
   `.bak` folders, they are hidden in throng, and one notice offers Open folder at every start until
   they are gone (US3).
