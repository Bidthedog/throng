# Contract: the preview provider seam

**Feature**: 044 | **Requirements**: FR-070 – FR-074, SC-003, User Story 5

What "adding a provider is writing the provider and registering it" means, precisely, and the test
that holds the codebase to it. Types are in [data-model.md](../data-model.md) §1–§3 and §13.

---

## 1. What a provider is

Two halves, because Principle II keeps the DOM out of `packages/core` — the split the language
registry already makes (`core/src/editor/languages.ts` declares WHAT a language is;
`ui/src/renderer/editor/language-loaders.ts` declares HOW it is highlighted).

| Half | File | Contains |
|---|---|---|
| **Descriptor** | `packages/core/src/preview/providers/<id>.ts` | `PreviewProviderDescriptor`: id, name, extensions, kind, own settings, optional `remoteImagesSetting`, `sourceMimeTypes` for binary |
| **View** | `packages/ui/src/renderer/preview/providers/<id>/` | `PreviewProviderView`: `load()` returning the body component, `textSelection`, optional `exportHtml(selection)` (the provider's rich-copy export profile) |

## 2. What registering is

Exactly two lines:

```ts
// packages/core/src/preview/providers/index.ts
export const SHIPPED_PREVIEW_PROVIDER_DESCRIPTORS = [markdownProvider /*, pdfProvider */] as const;

// packages/ui/src/renderer/preview/providers/index.ts
export const PREVIEW_PROVIDER_VIEWS = { markdown: markdownView /*, pdf: pdfView */ };
```

`provider-views.test.ts` fails when the two key sets differ — a descriptor with no view degrades
silently otherwise, which is the failure `language-loaders.test.ts:26-29` records.

## 3. What every surface derives, and must never name

| Surface | Derives from | Files that MUST NOT import a provider module |
|---|---|---|
| Preview panel chrome, body host, notices | `PreviewProviderView` by `providerId` | `preview/preview-panel.tsx` |
| Header menu (preview and editor items) | `previewAffordance(...)` | `workspace/panel-header-menu.ts` |
| Editor status bar button | `previewAffordance({ surface: 'editor' })` | `editor/status-strip.tsx` |
| Editor body menu item | same | `editor/content-menu.ts` |
| Files & Folders Open In → Preview | `previewAffordance({ surface: 'explorer' })` | `explorer/context-menu-items.ts`, `explorer/file-tree.tsx` |
| Default open action routing | `defaultOpenActionFor(...)` | `editor/open-router.ts` |
| Preferences → Editor → Previews | `previewSettingsDescriptors(registry)` | `preferences/settings-tab.tsx` |
| Settings defaults and parsing | `previewSettingsDefaults` / `parsePreviewSettings` | `config/app-settings.ts` |
| Layout restore (FR-067) | `enabledProviderFor(...)` | `state/workspace-store.tsx`, `state/subworkspace-window-client.ts`, `workspace/*` |
| Provider-disable close and purge (FR-063) | `providersTurnedOff(...)`, `enabledProviderFor(...)` | `preview/preview-provider-sync.tsx`, `ui/src/main/preview-purge.ts` |
| Opening and commands (FR-005, FR-010) | `previewAffordance(...)`, the preview IPC | `preview/open-preview.ts`, `preview/preview-commands.tsx`, `editor/editor-panel.tsx`, `editor/use-editor.ts` |
| The authority for open previews (main) | the injected registry | `ui/src/main/preview-service.ts` |
| Remote image permission (main) | `remoteImagesPermitted(...)` | `ui/src/main/renderer-request-filter.ts` |
| Source route MIME allowlist (binary) | `descriptor.sourceMimeTypes` | `ui/src/main/preview-protocol.ts` |

Rather than trusting this column to stay complete, the guard's scope is **directories plus the named
main files**: every file under `ui/src/renderer/preview/`, `ui/src/renderer/state/`,
`ui/src/renderer/workspace/`, `ui/src/renderer/editor/`, `ui/src/renderer/explorer/` and
`ui/src/renderer/preferences/`, plus the four `ui/src/main/` files above and `core/src/config/app-settings.ts`
— excluding only the two registration indexes and the provider folders themselves
(`preview/providers/**` in core and renderer). A new surface file added under those directories is
covered without editing the guard.

Every surface receives the registry **by injection** — a constructor argument in main, a React
context in the renderer whose default is the shipped registry — so a test can substitute one.

## 4. The kind axis

| | `text` (Markdown) | `binary` (#388, PDF) |
|---|---|---|
| Can be parented | yes — derived from the editor registry (FR-013) | **never** (FR-073) |
| Content delivered as | `{ kind: 'text', text }` snapshots | `{ kind: 'resource', url: 'throng-preview://source/<id>?rev=N' }` |
| Editor status bar / editor menu affordance | yes (FR-001, FR-002) | **none** (FR-073) |
| Open in Editor / Go to Editor | yes (FR-015) | **none** (FR-015e); status bar not shown |
| `defaultOpenAction` setting | yes, ships Editor (FR-050) | **absent**; always Preview (FR-051) |
| Follows | document when parented, disk when standalone | disk (FR-023) |
| Size limit and binary sniff | the editor's (Assumptions) | the provider's `sourceMimeTypes` and `editor.maxOpenFileBytes` |

## 5. What a provider can reach

Nothing but its props (data-model §13). It is handed content by `PreviewService`, never a path to
read; its images and its binary source are URLs whose resolution happens in main against the
preview's project (FR-074). It cannot mount outside its body element (FR-074), and its link and
notice requests go through `onFollow` / `onNotice`, which the chrome enforces.

## 6. The SC-003 test

`packages/ui/tests/component/preview-provider-seam.test.ts` registers, **inside the test only**, a
text provider `testText` for `.prvtxt` with one own toggle, and a binary provider `testBinary` for
`.prvbin`, then asserts through the real builders and components:

| # | Assertion | FR |
|---|---|---|
| S1 | `buildContextMenuItems` for `a.prvtxt` offers Open In → Preview; for `a.prvbin` too; for `a.txt` not | FR-003, FR-070 |
| S2 | The editor status strip for `a.prvtxt` shows the preview button; no editor exists for `.prvbin` | FR-001, FR-073 |
| S3 | `panelHeaderMenu` for a preview of each has the contracted shape; the binary one has no Open in Editor | FR-033, FR-015e |
| S4 | The settings tab, given `previewSettingsDescriptors(testRegistry)`, renders `testText`'s enabled, default open action and own toggle under Editor → Previews, and `testBinary`'s enabled only | FR-061, FR-071, FR-051 |
| S5 | `leavesOfDeclared(previewSettingsDefaults(testRegistry), previewSettingsDescriptors(testRegistry))` has zero missing and zero unknown | configuration-editor completeness |
| S6 | A layout holding a preview of `a.prvtxt` survives `restore` with the provider enabled, and is dropped with it disabled | FR-066, FR-067 |
| S6a | With `testText` **disabled**: Open In → Preview and the status-bar button for `a.prvtxt` are drawn **disabled**, and `testText`'s default open action and own toggle render **disabled**, not hidden | FR-001, FR-003, FR-061, FR-062 |
| S7 | A preview of `a.prvbin` mounts its body with `content.kind === 'resource'` and is never parented, even with an editor document registered for that path | FR-073 |

And a **unit guard**, `preview-surfaces-name-no-provider.test.ts`, reads every file in §3's guard
scope (the directories and named files below its table) and fails on any import from
`preview/providers/` other than the two registration indexes, or on an exact string literal `'markdown'` or `'.md'` (either quote style) outside comments (the
existing surfaces contain `.md` only inside comments naming spec files, which the guard ignores) — so "no surface needed editing" is enforced, not asserted in prose. The guard first asserts
its scope is non-empty and includes `state/workspace-store.tsx` and `main/preview-service.ts`, so a
moved directory cannot turn it vacuous.

*(Amended 2026-09-15 (US5 review).)* The guard discovers its scope by walking `packages/ui/src` and
`packages/core/src`, and it inspects string **and regular-expression** literals (the pattern body, so
`/\.md$/` is caught). Its allowlist names each exception with a reason; the one surface literal it
admits is the **editor language id** `'markdown'` in `reveal-range.ts` (FR-090d's heading reveal
compares `detectLanguage`, not a provider). Markdown-only code — the body stylesheet and
`markdownHeadingLine` — lives under the Markdown provider's own folders, not in the shared chrome or
shared `preview/links.ts`.

## 7. Registration conflicts

`createPreviewProviderRegistry` throws at startup (FR-072):

```text
Preview providers "markdown" and "notes" both claim ".md"
```

The shipped registry is built at module load in core, so the throw happens on the first import in
every process — a unit test (`preview-registry.test.ts`) pins the message.
