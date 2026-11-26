# Contract: the guide map and its checks

**Module**: `packages/core/src/help/guide-map.ts` · FR-004a, FR-015, FR-018, FR-019 · shapes in
[data-model.md](../data-model.md)

```ts
export type GuidePageSlug = 'index' | 'quick-start' | 'projects' | /* … every page in page-plan.md */;
export interface GuideTask { page; anchor; task; commands; panelTypes; previewTypes; settings }
export interface GuideExclusion { kind; id; reason }
export const GUIDE_PAGES: readonly { slug: GuidePageSlug; title: string }[];
export const GUIDE_MAP: readonly GuideTask[];
export const GUIDE_EXCLUSIONS: readonly GuideExclusion[];
```

## Checks (all unit tests, PR CI)

| Check | Fails when | Names |
|---|---|---|
| Map ↔ pages | a map entry's heading is missing from `guide/<page>.md`, or a `##` task heading in `guide/` has no entry | the page and heading |
| Command coverage | an `ActionId` is in no entry's `commands` and not excluded | the id |
| Panel type coverage | a registered panel type is in no entry and not excluded | the kind |
| Preview type coverage | a shipped preview provider is in no entry and not excluded | the id |
| Setting coverage | a setting key has no section in `docs/preferences.md` | the key |
| Lead line | a setting section's lead paragraph differs from the metadata `description` | the key |
| Length | a description exceeds 100 characters and is not on the ratchet list; or a ratchet key no longer does | the key |
| Built anchors | the built site lacks a page or id that a map entry, a `settingHelpUrl`, or an internal link targets | the link |
| Nav | a page in `GUIDE_PAGES` is missing from the built navigation | the page |

## PR marker (CI step, `scripts/guide-pr-check.mjs`)

- Marker: a PR body line matching `^No user-facing change: \S` (case-sensitive at the start).
- Fails when the PR changes a non-test file under `packages/*/src` and touches none of `guide/`,
  `docs/preferences.md`, `docs/key-bindings.md`, and the body has no marker. Prints the changed source
  files and the marker line to add.
- Documented in `.github/PULL_REQUEST_TEMPLATE.md`.

## Release check (`packages/core/src/config/release-notes.ts`)

- In the CHANGELOG section being released, each entry under `### Added` or `### Changed` must contain a
  link `https://throng-ide.com/guide/<page>/#<anchor>` (or `…/guide/#<anchor>` for the start page) whose
  `(page, anchor)` is in `GUIDE_MAP`.
- Refusal message names the entry's first 60 characters and the missing or unknown link.
- A bare link to the start page (`https://throng-ide.com/guide/` with no anchor) is prose: it neither satisfies the
  rule nor breaks it. [derived]
- A standing unit test holds `## Unreleased` to the rule, so a missing link is caught in the PR, not at the tag. [derived]
- `### Fixed`, `### Removed`, `### Known issues` and the literal no-change line are exempt.
