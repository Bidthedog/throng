---
name: new-icon-key-order
description: Adding an icon key needs its SVG and `npm run generate:icons` before `tsc -b packages/core` will build
metadata:
  type: project
---

`default-icon-set.generated.ts` is typed `Record<IconKey, string>`, so adding a key to `ICON_KEYS` breaks
`tsc -b packages/core` until the generated module holds that key. `scripts/vendor-lucide-icons.mjs` imports
`packages/core/dist`, so it cannot run first either, and it also rewrites every key's SVG and needs the throng
drafts under `specs/069-lucide-icon-set/review/drafts/`.

**Why:** hit in spec 081 (US5) adding `openInDefaultProgram` and `findInFileExplorer`.

**How to apply:** put the new `<key>.svg` in `default-set/` (raw Lucide is fine for a moment), run
`node scripts/generate-default-icon-set.mjs`, build core, then sanitise the SVG with core's `sanitiseSvg` the way
the vendor script does (strip `class`), and regenerate. Also add the key to `SOURCES.json`, its
`icon-sets-README.txt` line, and the count in `packages/core/tests/unit/icon-keys.test.ts`. Lucide art comes from
`npm pack lucide-static@<SOURCES.json lucideVersion>` into a scratch directory. Related: [[renderer-tsc-reads-core-dist]].
