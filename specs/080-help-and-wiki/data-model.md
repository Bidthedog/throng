# Data model: Online help and the user guide

**Feature**: [spec.md](spec.md) · **Research**: [research.md](research.md)

No persisted user data changes. These are the build-time and compile-time shapes.

## GuideTask (`packages/core/src/help/guide-map.ts`)

One entry per task section in the guide.

| Field | Type | Rule |
|---|---|---|
| `page` | `GuidePageSlug` | One of the page slugs in [page-plan.md](page-plan.md); the file is `guide/<page>.md` (`index` for the start page) |
| `anchor` | `string` | The GitHub-style slug of the task heading in that page; unique within the page |
| `task` | `string` | The heading text, in the user's words; equals the heading in the file |
| `commands` | `readonly ActionId[]` | May be empty |
| `panelTypes` | `readonly string[]` | Panel-type registry kinds |
| `previewTypes` | `readonly string[]` | Ids from `SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS` |
| `settings` | `readonly SettingKey[]` | Keys from settings metadata |

Identity: `(page, anchor)`. Validation (unit tests, [contracts/guide-map.md](contracts/guide-map.md)):
every entry's heading exists; every task heading in `guide/` has an entry; every `ActionId`, panel type
and preview type is in some entry's lists or in `GUIDE_EXCLUSIONS`.

## GuideExclusion

| Field | Type | Rule |
|---|---|---|
| `kind` | `'command' \| 'panelType' \| 'previewType'` | |
| `id` | `string` | Must exist in the app |
| `reason` | `string` | Non-empty; why no user task covers it (developer-only, internal) |

## GuidePage (a file in `guide/`)

| Part | Rule |
|---|---|
| Front matter | `title` (required), `order` (nav position, required), `status: outline` (optional; R12) |
| Task section | `##` heading = a `GuideTask.task`; a "why you'd use this" line; numbered steps (not required while `status: outline`) |
| Images | `guide/images/<page>/<name>.png`, referenced relatively |

State: `outline` → written (the `status` line removed). Never back.

## SettingSection (a section of `docs/preferences.md`)

| Part | Rule |
|---|---|
| Heading | `####` (or the level its group needs), the setting's label |
| Key line | The first line after the heading: the key in a code span. The built page's heading id is this key |
| Lead paragraph | Equals the setting's in-app `description` verbatim (FR-016); at most 100 characters (FR-013) |
| Facts | Default and allowed values |
| Detail | Optional paragraphs: examples, interactions, platform differences |

## HelpTarget (`packages/core/src/help/help-urls.ts`)

A URL built as `base + page path + '#' + anchor`. `base` is `HELP_BASE_URL` unless
`THRONG_HELP_BASE_URL` overrides it. Page paths: `''` (start page), `<page>/`,
`reference/preferences/`, `reference/key-bindings/`.

## Built site (`_site/`)

| Path | Source |
|---|---|
| `/index.html`, `/assets/…`, `/apt/…`, `/rpm/…` | unchanged (064), plus the version stamp and a **Guide** nav link |
| `/guide/index.html` | `guide/index.md` |
| `/guide/<page>/index.html` | `guide/<page>.md` |
| `/guide/reference/preferences/index.html` | `docs/preferences.md` |
| `/guide/reference/key-bindings/index.html` | `docs/key-bindings.md` |
| `/guide/images/…` | `guide/images/…` |
| `/pagefind/…` | Pagefind's index (R2) |

Every built page carries the release version (FR-002b).

## ReferenceSection (iteration 1, FR-026)

One `##` section of a reference file, built into a page of its own.

| Field | Rule |
|---|---|
| reference | `preferences`, `key-bindings` or `theme-settings` |
| heading | the `##` text; for a metadata group it equals the group name |
| slug | `referenceSlug(heading)`; the page is `/guide/reference/<reference>/<slug>/` |
| ids | the keyed and slugged ids its tokens carry, unique across the reference |
