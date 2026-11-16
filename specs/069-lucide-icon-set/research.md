# Research: One default icon set, drawn from Lucide

**Feature**: 069 · **Date**: 2026-11-15 · **Spec**: [spec.md](spec.md)

Paths are repository-relative. Facts were read from the code at `75671492` (master after spec 068).

## R1. Lucide: version, licence, coverage

- **Decision**: Lucide's static SVG package, `lucide-static` **1.66.0** (published 2026-10-31, the newest
  release at least two weeks old on 2026-11-15). Its art is copied into the repository by a vendoring
  script. It is not a dependency of the application.
- **Licence**: ISC ("Copyright (c) 2026 Lucide Icons and Contributors"), with an appended MIT notice
  (Copyright (c) 2013-present Cole Bemis) covering the icons derived from Feather. Both permit
  redistribution and modification in an AGPL-3.0 application, provided the copyright and permission
  notices travel with the copies. The full `LICENSE` text is vendored beside the art (FR-022).
- **Coverage**: 2292 icons. A first pass over 90 candidate names for throng's keys found all 90. The
  gaps FR-002 anticipates are typographic tokens, such as `diagramZoomReset` (`1:1`); throng draws them
  in Lucide's grid (24×24 viewBox, `stroke-width="2"`, round caps and joins, no fill).
- **Why not a runtime dependency**: `electron-builder.yml` sets `asar: false` and ships `node_modules/**`
  as loose files, so a dependency would install about 1,600 editable SVGs. That contradicts FR-021.
- **Alternatives**: Tabler (MIT) and Phosphor (MIT) were both viable. Lucide is the maintainer's choice,
  and its stroke style is the one `svgForToken` already imitates.

## R2. How the default set is compiled in (FR-021)

- **Decision**: The vendored SVGs live at `packages/core/src/icons/default-set/<key>.svg`, one file per
  key, named exactly as a user set names its overrides. `scripts/generate-default-icon-set.mjs` turns
  them into `packages/core/src/icons/default-icon-set.generated.ts`, which exports
  `DEFAULT_ICON_SET: Readonly<Record<IconKey, string>>` holding sanitised markup. A unit test regenerates
  the module in memory and fails when it differs from the checked-in file, the same pattern as
  `nsis-vendored-templates.test.ts`.
- **Rationale**: Main, preload and core are compiled by `tsc -b` with no bundler, and only the renderer
  goes through Vite. A TypeScript module is the one form every consumer can import: main (README, set
  creation, Override this icon), the renderer, and vitest. `tsc` copies no `.svg` into `dist`, so no
  loose icon file ships. The art sits inside a compiled JavaScript string, which is not an editable
  icon file.
- **Size**: 110 icons at 0.3 to 0.6 kB each is about 50 kB. It lands in Vite's `core` chunk (about
  288 kB today), well under `CHUNK_LIMIT_KB = 500`. If that ever stops being true, a `chunkFor` rule
  gives it an `icons` chunk.
- **Rejected**: `?raw` imports and `import.meta.glob`, which work only in the renderer; and
  `extraResources`, which ships loose files.

## R3. The icon keys and their descriptions (FR-010 to FR-012)

- **Today**: `THRONG_THEME.icons` defines **110** keys (`packages/core/src/config/theme.ts:393-692`), not
  the 101 the spec first counted. The descriptions already exist as the theme copy for each `icons.*`
  key (`packages/core/src/config/theme-copy.ts:499-1005`).
- **Decision**: A new core registry, `packages/core/src/icons/icon-keys.ts`, exports `ICON_KEYS` (an
  ordered `as const` tuple), the `IconKey` type, and `ICON_KEY_DESCRIPTIONS`, moved from theme-copy. It
  replaces every use of `Object.keys(THRONG_THEME.icons)`.
- **Dead key**: `notifications` has no render site; only `core/tests/unit/icon-tokens-068.test.ts` uses
  it. It is retired (FR-011).
- **Icons drawn outside the key system** (FR-010). These are brought in:

  | Site | Today | Key |
  |---|---|---|
  | `projects-panel.tsx` grip, `subworkspaces-panel.tsx` grip | `⠿` | new `dragHandle` |
  | `projects-panel.tsx` edit | `✎` | `rename` |
  | `projects-panel.tsx` remove, `subworkspaces-panel.tsx` delete | `✕` | `destroy` |
  | `subworkspaces-panel.tsx` open | `⧉` | `detach` |
  | `panel-placeholder.tsx` panel close | `✕` | `windowClose` |
  | `✓` checked state in menu labels (`content-menu.ts`, `category-menu.ts:76`, `notifications-menu.ts:22`) | glyph in the label | new `menuChecked`, drawn in the menu's icon slot |

- **Not icons, left as text**: the `×N` repeat count, the `⏎` hint in history input, the whitespace
  marks (`·`, `→`), the CSS `•` notice bullet, the `…` truncation and the `›` breadcrumb separator. They
  are typography inside text, not controls or images. The brand mark (`title-bar/throng-mark.tsx`)
  stays inline, as `no-inline-artwork.test.ts` already allows.
- **New keys for this feature's own controls** (FR-030): `overrideIcon`. Creating a set reuses `copy`,
  Reload the icon sets from disk reuses `refresh`, and opening the folder reuses `folderOpen`. Each is the same action
  those keys already mean, so FR-008 allows the sharing.

## R4. The token-to-art mapping and the review page (FR-031)

- **Decision**: `packages/core/src/icons/default-set/SOURCES.json` maps every key to
  `{ "lucide": "<name>" }` or `{ "throng": "<why Lucide has nothing that fits>" }`, plus the Lucide version and `sameAction`, the groups of keys allowed to share art because they are the same action in different places (FR-008).
  `scripts/vendor-lucide-icons.mjs <path-to-unpacked-lucide-static>` copies the mapped files into
  `default-set/`. It reads the package from a path the maintainer supplies (`npm pack lucide-static@1.66.0`
  and unpack it), so nothing is added to `package.json`.
- **Review page**: `scripts/icon-review-page.mjs` writes one self-contained HTML file. For every key it
  shows the description, the proposed art at 12, 16 and 24 px on a light and a dark theme background, the origin, and the keys
  sharing that art. It also flags the FR-009 pairs. The page is published as a private Artifact for
  sign-off.
- **Order**: The mapping and the review page come first. Nothing writes `default-set/*.svg` or the
  generated module before the review page exists; the maintainer signs it off before merge (moved from
  before implementation on 2026-11-15, see the spec's Clarifications).

## R5. Resolution and loading (FR-013 to FR-016, FR-026 to FR-029)

- **Today**: `resolveIconValue` (`icon-pack.ts:101`) tries override, then pack, then `theme.icons`, then
  `THRONG_THEME.icons`. `resolveIconAsset` (`:135`) turns that into glyph or svg markup. Packs arrive in
  the renderer inside the config payload (`config-watcher.ts:38,180`), and `config-watcher` re-reads
  every pack on any change under the config root (`:257`), which is a folder watch.
- **Decision**:
  - `resolveIcon(theme, sets, key)` → the theme's selected user set's markup for `key` when present,
    otherwise `DEFAULT_ICON_SET[key]`. `IconValue` and its glyph arm are removed.
  - `IconSetService` (replacing `IconPackService`, `packages/ui/src/main/`) loads a user set by listing
    its folder. A `<key>.svg` whose key is in `ICON_KEYS` is an override, read and sanitised with
    `sanitiseSvg` (`core/src/config/svg-sanitise.ts:163`). A failure becomes a per-key reason. Any other
    file is unrecognised. Folders ending `.bak` or `.bak.<n>` are skipped. A missing or unreadable
    folder is an unavailable set with a reason.
  - Sets load at startup and stay in memory (017 FR-006a). `reload(set)` re-reads one set, and selecting
    a set reloads it. A config re-read no longer re-reads set folders: the watcher's callback serves the
    cached sets, so editing a set's files changes nothing until Reload the icon sets from disk or a restart. That is
    FR-029's "MUST NOT watch".
- **Editor and preview fold markers**: `editor/markdown-fold.ts:170` and
  `preview/providers/markdown/fold-gutter.ts:64` call `resolveIconAsset` outside `<Icon>`; they move to
  `resolveIcon`.

## R6. The upgrade (FR-017 to FR-020, FR-036)

- **Mechanism**: shipped-defaults version `33` → **`34`** (`packages/core/src/config/shipped-defaults.ts:366`).
  `ShippedDefaultsService.upgrade()` (`packages/ui/src/main/shipped-defaults-service.ts:393-453`) composes
  the steps and writes every theme plus the marker in one `writeFilesAtomic` call. It runs whenever the
  applied version `!==` the shipped one (`main.ts:1084-1100`), so it is not told where it came from.
- **Theme step** (pure, core): `planThemeIconSetUpgrade(theme)` deletes `icons`, `iconOverrides` and
  `iconPack` from every theme (built-in and user), so every theme falls to the default set. It is
  idempotent because a second pass finds nothing to delete. `migrateTheme` (`theme-ops.ts:171`) also
  drops the two retired keys on read, so a hand-written theme carrying them is ignored rather than
  refused. The shipped `Theme` type loses `icons`, so the additive fill (`fillMissing`) cannot put the
  map back.
- **Folder step** (main, `IconSetUpgrade`): it runs only while
  `<configRoot>/icon-sets-upgrade.json` does not record `done`. On its first attempt it records the folder
  names it will act on (`pending`) and from then on acts only on those. A user set created after the
  upgrade is therefore never touched, even if an earlier attempt failed part-way (FR-020). For each
  pending folder:
  - `throng` or `throng-svg`, matched against the seeded history (below): delete if uncustomised,
    otherwise rename it to a backup.
  - Anything else: rename it to `<name>.bak`, or `<name>.bak.<n>` for the first free `n` (FR-019).
  - `README.md`: delete.
  - Each failure (for example, a file held open on Windows) is logged with `logCaught` and retried at
    the next start. Nothing is deleted on a failed check. `done` is written only once every pending item
    has succeeded.
- **The ordering trap**: `IconPackService.ensureBundledPacks()` (`icon-pack-service.ts:173`) re-creates
  `throng/` and `throng-svg/` at every start when their `pack.json` is missing. It is deleted, or the
  folder step's deletions come straight back.
- **Seeded history (FR-036)**: `scripts/generate-seeded-icon-history.mjs` reads, at every release tag
  (`v1.0.0-alpha1` to `alpha16`, 16 tags), the inputs the seeder used: the icon map in `theme.ts`, and
  `SVG_SHAPES`, `GENERIC_SHAPE` and `svgForToken` in `icon-pack-service.ts`. It runs that tag's seeding
  code against a temporary directory and records the SHA-256 of every file it wrote under each folder
  name. Output: `packages/core/src/icons/seeded-icon-history.generated.ts`, frozen once generated
  because seeding ends with this feature. At runtime the check is one directory listing, then hashing
  the files of the two seeded folders: about 112 small files, once. A tag whose seeder cannot be
  reproduced contributes nothing, so a folder from that version reads as customised and gets backed up.
  That direction is the safe one.
- **Alternatives**: comparing against alpha16's seed only (rejected: an old untouched folder would look
  customised, and nag); names and sizes only (rejected: it misses same-size edits and then deletes the
  user's work); file timestamps (rejected: copies and installers reset them). The maintainer confirmed
  this choice on 2026-11-15.

## R7. The backup notice (FR-038)

- **Pattern**: the installed-version notice. Main holds a pending payload until the window reports it is
  listening (`main.ts:826-849`); a renderer component mounted once (`common/installed-version-notice.tsx`,
  `app.tsx:626`) raises it through `useNotify().notify({..., sticky: true, body: <IconButton>})`. The
  wording lives in core.
- **Decision**: at startup main lists the icon sets directory for `.bak` and `.bak.<n>` folders. When it
  finds any, it sends `throng:iconSets:backupsPresent` with their count. `IconSetBackupNotice` raises one
  sticky notice with `groupKey: 'icon-set-backups'` and an Open folder `IconButton` (`folderOpen`). For
  the Notifications panel to keep the action, a new serialisable action kind `openIconSetsFolder` is added
  at the four places 068's closed set lives: the core parser (`notice/notification-entries.ts:29-33,321`),
  `notifications-ipc.ts:56`, `use-notification-actions.ts:62,80` and `notifications-menu.ts:89`.
  When no backup remains, main removes the persisted entry for that group, so the panel does not keep a
  stale notice (FR-038's "MUST NOT be raised").

## R8. Opening folders (FR-028)

- `IShellIntegration.openFolder` (`core/src/abstractions/shell-integration.ts`), implemented by
  `ElectronShellIntegration` (`main/electron-shell-integration.ts:115`), is de-elevation aware on both
  platforms. A new `throng:iconSets:openFolder(setName?)` handler resolves the path in main, either the
  sets directory or a listed user set's folder, and never takes a path from the renderer. It is shaped
  like `open-logs.ts` so it can be unit-tested. The E2E harness already stubs and records `shell`.

## R9. Preferences (FR-024, FR-025, FR-027, FR-028, FR-029, FR-032, FR-033)

- **Today**: `IconSection` (`preferences/icon-section.tsx`) has a pack `<select>` with a "(default
  glyphs)" option, a colour field, and a grid of 24 px specimens with a free-text override box per key.
  Image overrides never rendered. Handlers live in `themes-tab.tsx:418-431`.
- **Decision**: rewrite `IconSection`. Beside the picker: Copy (new set), Open folder and Reload this
  set, the last two for user sets only, plus the one-line hint. The grid becomes read-only rows showing
  the icon, the key, `<key>.svg`, the description, an Overridden or Default state, any error reason, and
  Override this icon on user sets. Unrecognised files are listed beneath the grid.
  - The name prompt reuses `NameDialog`, generalised to take a validator: `validateIconSetName` in core,
    covering uniqueness ignoring case, `throng`, `.bak`, and folder-name safety on Windows and Linux.
  - The replace prompt reuses `useConfirm` with text buttons.
  - Main-side IPC: `throng:iconSets:create(name, from)`, `:override(set, key, replace)`, which returns
    `exists` when the file is there and `replace` is false, `:reload(set)` and `:openFolder(set?)`. Set
    names are checked against the listed sets in main.
- **Colour**: the icon colour field and 018 FR-027 to FR-031 are unchanged.

## R10. README.txt (FR-023, FR-035)

- **Today**: `ensureReadme()` (`icon-pack-service.ts:221`) writes `README.md` once from a template and
  never overwrites it.
- **Decision**: the README is hand-written plain text at `packages/core/src/icons/icon-sets-README.txt`,
  embedded by the same generator into `default-icon-set.generated.ts` as `ICON_SETS_README`. Main writes
  `icon-packs/README.txt` at startup whenever its content differs. The README carries a fenced key list
  (`<key>.svg - <description>`, one per line).
  - FR-035's test parses that list and fails unless it matches `ICON_KEYS` and
    `ICON_KEY_DESCRIPTIONS` exactly. Any change to the keys therefore forces an edit to the README by
    hand, which is the "kept up to date" the maintainer asked for.
  - Encoding: UTF-8, no BOM, CRLF on Windows and LF on Linux, so Notepad and gedit both show it
    correctly.

## R11. Licence display (FR-022)

- `scripts/generate-licenses.mjs` lists npm packages only, as links. It gains a hand-declared
  `VENDORED` list (Lucide 1.66.0, ISC, project URL, and the licence text read from
  `packages/core/src/icons/default-set/LICENSE`). Entries gain an optional `licenseText`, which the About
  window shows in an expandable block. The 064 NSIS precedent (`packaging/nsis/UPSTREAM.md`) records
  vendored upstreams; `default-set/SOURCES.json` plays that role here.

## R12. Release notes (FR-039)

- `CHANGELOG.md` `## Unreleased`, `### Changed` and `### Removed`, as one-line items in user terms with
  the issue linked. `throng-release` turns it into the GitHub Release body.

## R13. Test layers

| What | Layer |
|---|---|
| Key registry, default-set completeness (FR-004), no `<text>` and no fill colour in default art (FR-005, FR-006), resolution, set-name validation, theme upgrade planner, seeded-history check, README key list (FR-035), generated-module sync | core unit |
| `IconSetService` on real temp dirs: list, `.bak` skipped, unrecognised files, bad SVG, create from default and from a user set, override with and without `exists`, reload; the folder upgrade (backup naming, delete uncustomised, pending list, retry, `done`); README write | ui integration |
| `IconSection` rows, states, buttons per set type, hint, prompts; `IconSetBackupNotice` | ui component |
| One E2E spec through a real window: create a set, Override, replace the file on disk, Reload, and see the icon change in the explorer (US4); replaces `icon-packs.e2e.ts` | e2e `@extended @prefs`, in `parallel-plan.json` |
| Existing tests asserting glyphs, packs and overrides (the list in the plan) | updated in the task that retires the behaviour |
