# Tasks: 074 Media File Previews — Images, SVG, PDF and HTML

**Input**: `specs/074-media-file-previews/` — spec.md, plan.md, research.md (R1–R10), data-model.md,
contracts/.

**Tests**: required — Principle V (test-first, NON-NEGOTIABLE). Every behaviour task is preceded by a
failing test at the layer research R10 names. Paths are `packages/<pkg>/tests/{unit,component,integration,contract,e2e}`.

## Phase 1: Setup

- [x] T001 Add `pdfjs-dist` 6.x (Apache-2.0, FR-102) to `packages/ui/package.json` and install; keep it out of the eager bundle (lazy chunk; extend the eager-preview guard in `packages/ui/vite.config.ts` if it lists libraries)

## Phase 2: Foundational — Open … in for every preview type (US6, FR-016 – FR-019)

**One commit**, subject `feat(074): Open-in preference for every preview type` (contract
`open-in-preference.md`; spec 073 cherry-picks it). **Independent test**: every shipped provider's
Preferences row reads "Open <files> in"; `os` opens the OS program from the tree and Quick Open.

- [x] T002 [P] [US6] Test: descriptors — every provider (text and binary) gets `Open <filesNoun> in` with `editor`/`preview`/`os` (text) or `preview`/`os` (binary), option labels Throng Editor / Throng Preview (or `previewOptionLabel`) / Default OS Program, `enabledWhen` its toggle; `openTarget` for binary too; parse keeps an offered value and maps an unoffered one (binary `editor`) to the shipped value; `defaultOpenActionFor` returns `os` — in `packages/core/tests/unit/preview-open-in-074.test.ts`, and update the superseded assertions in `settings-descriptors-054.test.ts`, `preview-settings-054.test.ts`, `settings-metadata-040.test.ts` (044 FR-050/FR-051)
- [x] T003 [US6] Implement `'os'` in `DefaultOpenAction` (`packages/core/src/preview/settings-types.ts`), `filesNoun` / `previewOptionLabel` on the descriptor (`provider.ts`), `offeredOpenActions` and the generator/parse/`defaultOpenActionFor` changes in `packages/core/src/config/preview-settings.ts`; Markdown and Mermaid descriptors keep their shipped values
- [x] T004 [P] [US6] Test: `openFromTree` / `openFromQuickOpen` with `os` call `route.openInOs(absPath)` and open no editor or preview; Find in Files with `os` opens the editor at the match (FR-019); a preview link to an `os` file goes to the OS — in `packages/ui/tests/component/editor-open-router.test.ts` and the Find in Files chrome test
- [x] T005 [US6] Implement `openInOs` on `OpenRoute` (helper `links/use-open-in-os.ts`; main's link follow returns an `os` target to the renderer router) in `packages/ui/src/renderer/editor/open-router.ts`, supplied from `editor-open.tsx` (tree and link paths) and `navigate/quick-open.tsx` via `osLinkActions().openInOsDefaultProgram` with the one failure notice; `find-in-files-chrome.tsx` treats `os` as editor; preview link wording (`preview-panel.tsx`) words `os` as the OS program
- [x] T006 [US6] Bring `docs/preferences.md` current for the renamed rows (FR-017) in the same commit

## Phase 3: Seam extensions (provider-neutral)

- [x] T007 [P] Test: `maxFileBytesFor` (declared leaf, else `editor.maxOpenFileBytes`); `decideRendererRequest` refuses every `https:` request `fromSubFrame` whatever `remoteImages` says (FR-093) — in `packages/core/tests/unit/preview-seam-074.test.ts`
- [x] T008 Implement `maxFileBytesSetting`, `assetMimeTypes`, `revealsMatches` (replacing the planned `syncScroll`: HTML takes `flowingDocument: false`) on the descriptor, `maxFileBytesFor` in `preview-settings.ts`, `fromSubFrame` in `packages/core/src/preview/request-policy.ts`, `too-large` `size`/`limit` in `wire-types.ts`; wire `details.frame?.parent` in `packages/ui/src/main/renderer-request-filter.ts`
- [x] T009 [P] Integration test: the protocol caps a source by the provider's `maxFileBytes` (413), serves `assetMimeTypes` only for that provider's runs, answers `follow` with 204; `PreviewService` reports `too-large` with size and limit before reading — in `packages/ui/tests/integration/preview-protocol-074.integration.test.ts`
- [x] T010 Implement in `packages/ui/src/main/preview-protocol.ts` and `preview-service.ts`; the `too-large` notice wording names size and limit, digit-grouped (`packages/ui/src/renderer/preview/preview-notice.tsx`)
- [x] T011 [P] Test then implement `preview.readSource(panelId)` (IPC through the protocol handler, preload, `global.d.ts`) — contract test in `packages/ui/tests/contract/preview-ipc.contract.test.ts`
- [x] T012 [P] Test then implement the body prop `onStatusReadout` shown in the status bar's readout slot (`provider-view.ts`, `preview-panel.tsx`, `preview-status-bar.tsx`)
- [x] T013 [P] Test then implement frame extensions: `initialMode` (`fit`/`actual`), `data-diagram-magnified` while scale > 1 with `image-rendering: pixelated` on `<image>` (FR-034), the block entry `noun`, and the rasteriser drawing a single-`<image>` wrapper from its source — `packages/ui/src/renderer/preview/diagram/*`, tests in `packages/ui/tests/component/diagram-frame-074.test.ts`

## Phase 4: User Story 2 — SVG Preview (P1) and US3 — SVG in Markdown (P2)

- [x] T014 [P] [US2] Test: the `svg` block renderer returns a one-`<image>` wrapper sized from width/height, else viewBox, else 300×150; its `href` is a `blob:` of type `image/svg+xml`; the SVG is never in the DOM (no `script`, no `foreignObject` element exists in the document after drawing the hostile fixture); a `parsererror` and a decode timeout reject with a message — in `packages/ui/tests/unit/svg-block.test.ts`
- [x] T015 [US2] Implement `packages/ui/src/renderer/preview/blocks/svg-block.ts` and register it in `block-renderers.ts`
- [x] T016 [P] [US2] Test: SVG descriptor (text, `.svg`, ships Preview, `maxFileBytes` 10 MB, `flowingDocument: false`) and view registration; the SVG body draws through `DiagramBlock` filling the panel; no Synchronise Scrolling or Select All — in `packages/core/tests/unit/preview-registry.test.ts`, `packages/ui/tests/unit/provider-views.test.ts`, `packages/ui/tests/component/svg-preview.test.ts`
- [x] T017 [US2] Implement `packages/core/src/preview/providers/svg.ts` and `packages/ui/src/renderer/preview/providers/svg/{view.ts,svg-body.tsx}`; register both
- [x] T018 [P] [US3] Component test: a ```` ```svg ```` fence in a Markdown preview becomes a diagram host drawn as an image; raw `<svg>` is still removed (FR-053); a relative `![x](a.svg)` renders as an image through the asset route (FR-050) and, alone in its paragraph, is framed (FR-055); an inline badge is not — in `packages/ui/tests/component/markdown-svg-074.test.ts`
- [x] T019 [US3] Implement `packages/ui/src/renderer/preview/blocks/image-block.ts` (`image-url`) and `providers/markdown/framed-images.ts`, called from `markdown-body.tsx` beside `claimRenderedBlocks`

## Phase 5: User Story 1 — Image Preview (P1)

- [x] T020 [P] [US1] Test: Image descriptor (binary, extensions, MIME list, ships Preview, `maxFileBytes` 50 MB, `defaultFit`); the `image-url` renderer rejects over `MAX_IMAGE_PIXELS` and an undecodable image with one message; the Image body reports dimensions and size via `onStatusReadout`; Default fit Actual size starts at 100%; Copy Image reads `readSource` — in `packages/ui/tests/component/image-preview.test.ts` and core registry test
- [x] T021 [US1] Implement `packages/core/src/preview/providers/image.ts` and `packages/ui/src/renderer/preview/providers/image/{view.ts,image-body.tsx}`; the themed checkerboard backdrop token-driven in `diagram.css` (FR-027); reduced motion first frame (FR-026)

## Phase 6: User Story 4 — PDF Preview (P2)

- [x] T022 [P] [US4] Test with a fake pdf.js: pages laid out as placeholders, rendered when observed; zoom re-renders at the new scale; `Page n of m` readout; internal link scrolls; external link follows only by Ctrl+click via `onFollow`; encrypted / malformed → one notice; view state `{page, offset}` captured and restored — in `packages/ui/tests/component/pdf-preview.test.ts`
- [x] T023 [US4] Implement `packages/core/src/preview/providers/pdf.ts` and `packages/ui/src/renderer/preview/providers/pdf/{view.ts,pdf-body.tsx,pdf-renderer.ts}` (worker, `isEvalSupported: false`, bytes from `readSource`)

## Phase 7: User Story 5 — HTML Preview (P2)

- [x] T024 [P] [US5] Test: the HTML sanitiser over `hostile.html` removes every script, handler, `javascript:` URL, iframe/object/embed, base, meta, non-stylesheet link, form action, target, autofocus; rewrites relative resources (src, srcset, stylesheet href, style `url()`, `@import`) to the asset route and drops absolute ones; rewrites links to the follow route with a title; keeps `#fragment` links; injects the frame CSP first in `<head>`; reports that script was present — in `packages/ui/tests/unit/html-sanitise.test.ts`
- [x] T025 [US5] Implement `packages/ui/src/renderer/preview/providers/html/html-sanitise.ts`
- [x] T026 [P] [US5] Component test: the HTML body renders `<iframe sandbox="allow-popups" srcdoc>` (no other token), shows "Scripts in this page do not run in the preview" once and dismissibly, updates `srcdoc` on new content; the panel handles `preview:frameLink` by following the resolved link — in `packages/ui/tests/component/html-preview.test.ts`
- [x] T027 [US5] Implement `packages/core/src/preview/providers/html.ts` (`syncScroll: false`, `assetMimeTypes`), `packages/ui/src/renderer/preview/providers/html/{view.ts,html-body.tsx}`, the `frame-src throng-preview://follow` CSP grant in `packages/ui/src/renderer/index.html` with `renderer-csp.test.ts` pinned, the window-open guard's follow routing (unit test in `packages/ui/tests/unit/window-open-guard.test.ts`) and the renderer `frameLink` listener; Synchronise Scrolling honours `syncScroll: false`; Find shown disabled on an HTML Preview (FR-086); a Find in Files result in an HTML file opens the editor (FR-084)

## Phase 8: Security end to end, docs, polish

- [x] T028 [P] Fixtures under `packages/ui/tests/fixtures/preview/` (data-model §7)
- [x] T029 E2E `packages/ui/tests/e2e/preview-media.e2e.ts` (`@core @editor`) and `preview-media-hostile.e2e.ts` (`@extended @failure`); re-seed `e2e-budget.json` in the same commit; not run locally
- [x] T030 Amend 044 `contracts/security-policy.md` and `contracts/preview-provider-seam.md` with the four rows and the grants (FR-091, FR-092)
- [x] T031 Docs (`throng-docs`): `docs/preferences.md` (every new setting), `README.md` and `docs/README.md` (new preview types) (`CHANGELOG.md` is written by the release, `throng-release`)
- [x] T032 Review the branch diff against spec, plan, contracts and the constitution; fix findings
- [x] T033 Manual test plan (`test-discipline:planning-manual-tests`)

## Phase 9: Maintainer feedback after sign-off (2026-11-20)

Renderer HTML frame (R6a, R6b, R6e):
- [x] T034 Test: the HTML frame carries `sandbox="allow-same-origin allow-popups"` and `name="throng-html-<panelId>"`; a second content update keeps the same frame element, keeps `scrollTop`/`scrollLeft` (clamped when the page shrinks) and never sets a new `srcdoc`; a safe-source change reloads — update every test pinning `allow-popups` alone (`html-preview.test.ts`) — in `packages/ui/tests/component/html-preview.test.ts`
- [x] T035 Implement in-place update and scroll keeping in `packages/ui/src/renderer/preview/providers/html/html-body.tsx` (new `html-frame-update.ts` beside it)
- [x] T036 Test then implement: keydown, Ctrl+wheel, Ctrl+middle-click and focusin on the frame document reach the panel as the relay did (FR-083a) — `throng:frame:key` → keydown, `throng:frame:wheelZoom` → Ctrl+wheel, `throng:frame:middleClick` → Ctrl+middle mousedown, the blur shim → focusin; delete `packages/ui/src/main/frame-input-relay.ts`, `packages/ui/src/renderer/workspace/frame-input-relay.ts`, their preload hooks, typings, channels and tests, moving the assertions to the frame-document listeners
- [x] T037 Test then implement the HTML body menu (FR-085a): right-click in the page opens Find…, Copy, Copy as Rich Text, Copy as Plain Text, Select All, Split; rich copy writes HTML + text — `packages/ui/src/renderer/preview/content-menu.ts`, html `view.ts` `exportHtml`

Find (R6d):
- [x] T038 Test then implement Find in an HTML Preview through the shared controller (count, highlight, next/previous, scroll in frame); drop `searchable: false`; update tests asserting Find disabled on HTML — `packages/ui/src/renderer/preview/preview-search*.ts`, `highlight-registry.ts`, html `view.ts`
- [x] T039 Test then implement PDF Find across unpainted pages (FR-086c) — `packages/ui/src/renderer/preview/providers/pdf/pdf-body.tsx`

Safe sources (R6c):
- [x] T040 Unit test then implement `packages/core/src/preview/safe-sources.ts` and the global setting `editor.previews.providers.html.safeSources` (metadata, app-settings, shipped defaults)
- [x] T041 Per-project `htmlSafeSources` in core: `project.ts` field/default/setter, `project-service.ts` `setHtmlSafeSources`, exports — unit tests as 060's `searchExcludeGlobs`
- [x] T052 Persistence: migration, schema guard, repository row/map/select/insert/update — integration test
- [x] T053 ipc-contract method + DTO, daemon handler with validation — contract test
- [x] T054 Renderer projects client/store `setHtmlSafeSources`, Project Settings dialog section naming the global preference — component test
- [x] T042 Unit test then implement the sanitiser's safe-source keep / `blocked` record and the frame CSP origins — `html-sanitise.ts`, `packages/ui/tests/unit/html-sanitise.test.ts`
- [x] T043 Unit test then implement the request filter's per-frame sources (`decideRendererRequest`, `renderer-request-filter.ts`, `preview:setFrameSources` IPC + preload); renderer CSP grant in `index.html` with `renderer-csp.test.ts` re-pinned
- [x] T044 Component test then implement the blocked-resources notice (FR-093a): one notice, grouped by source, Allow this source → project list + reload, http/script rows without the action, Open Preferences action; `securitypolicyviolation` joins the list

Defects:
- [x] T045 Failing integration test then fix FR-012 on a parented buffer — `packages/ui/src/main/preview-service.ts`, `packages/ui/tests/integration/preview-service-*.integration.test.ts`
- [x] T046 Failing component test then fix FR-055: `![[x.png]]` and `![[x.svg|200]]` alone on a line framed by `claimFramedImages` like `![alt](x.png)` — `packages/ui/src/renderer/preview/providers/markdown/framed-images.ts`, `markdown-body.tsx`
- [x] T047 `packages/ui/tests/e2e/preview-media-performance.e2e.ts` (SC-003, SC-004) via `expectWithinSla`, serial TIMING tier in `parallel-plan.json`, budget re-seeded; run locally once at one worker

Close-out:
- [x] T048 E2E: extend `preview-media.e2e.ts` for in-place update with scroll kept, HTML Find, the body menu and a safe-source image; re-seed `e2e-budget.json`; not run as a batch locally
- [x] T051 Extend `preview-media-hostile.e2e.ts` and its fixtures for the same-origin frame (FR-090, scenario 11): a script from a safe source does not run, `@import`/`url()` to an unlisted origin and a font from one are refused; a relative `@font-face` applies (FR-072); re-seed `e2e-budget.json`
- [x] T049 Contracts (`contracts/media-providers.md`, 044 `security-policy.md`) and docs (`throng-docs`: `docs/preferences.md`, `docs/architecture.md`, quick-start) for the frame, the safe sources and the project list
- [x] T050 Review the phase's diff; manual test plan Paths widened for MT-04, MT-06, MT-08 – MT-12

Preview type icons and titles (FR-103, FR-104; maintainer, 2026-11-20):
- [x] T055 Test then implement `<name> - <Type> Preview` from the provider's display name (FR-104) in `packages/core/src/workspace/panel-title.ts` and its callers; update every test asserting the old " - Preview" suffix (`git grep -n -- "- Preview" -- packages/*/tests`), E2E heading matchers included
- [x] T056 Test then implement per-provider preview icons (FR-103): descriptor field, six new icon keys with descriptions in every shipped icon set (regenerated), drawn in the preview header, tab, tab picker, the editor's status-bar preview button and Open In → Preview rows; generic `preview` when a provider declares none
- [x] T057 Docs (`throng-docs`) and the manual test plan group for FR-103 / FR-104

## Review findings left open (T032)

*(2026-11-20: FR-012, FR-055, FR-071/072/085/086 and SC-003/004 below are closed by Phase 9, T034 – T054.)*

Each is a gap against the spec, recorded rather than silently dropped; the first four need a follow-up issue,
which this branch may not file.

- **FR-012, parented buffer**: the provider size cap is applied to a file read from disk (and to a document's
  unloadable read), not to a parented SVG or HTML preview's live, unsaved buffer.
- **FR-055, `![[x.png]]`**: a wiki image embed is resolved after the draw, so it is not framed; `![alt](x.png)`
  standing alone is.
- **FR-071 / FR-072 / FR-085 / FR-086** (deferred in the plan): HTML scroll kept across updates, web fonts, a body
  menu inside the page, and the find bar over the page (shown disabled).
- **Link wording for Default OS Program**: a preview link to a file set to Default OS Program follows to the OS
  program, but its tooltip still words it as an editor open.
- **SC-003 / SC-004 timings** are not measured by any test; the E2E proves the paths, not the budgets.
- **No service-level test** of the `too-large` notice with size and limit (the protocol cap and the wording are
  tested separately).

## Dependencies

T002–T006 first (one commit). T007–T013 before every provider. T014–T015 before T019 (framed images
reuse the `image-url` renderer from T019 and the frame extensions of T013). Phases 4–7 are independent
of each other once Phase 3 lands; T029–T033 last.

Phase 9: T034 before T035–T038 and T044 (same-origin frame first); T036 before T037. T040 before T041–T043 and
T052–T054; T041 → T052 → T053 → T054; T042, T043 and T054 before T044. T045–T047 independent. T048, T051, T049, T050
last.

## Phase 10: Convergence

- [x] T058 Refuse an entry that is not a safe source in the Preferences editor for `editor.previews.providers.html.safeSources`, saying why, as the Project Settings editor does, instead of saving it and dropping it on read, per FR-072c (partial)
- [x] T059 Find what throng adds to a 5 MB SVG's open beyond Chromium's own decode (read, transfer, blob, a second decode of the drawn `<image>`) and remove it, re-measuring `preview-media-performance.e2e.ts` at one worker, per SC-003 (partial) — measured 2026-11-20: click→bytes in renderer ~180 ms, Chromium decode of the 110,000-shape fixture ~876 ms, placed ~200 ms; the whole-document parse (~600 ms) was removed (a74c677d). The decode alone nearly fills the budget: maintainer decision on the fixture or the budget.

## Phase 11: Convergence

- [x] T060 CRITICAL: Report a PDF link's right-click to the panel through `onLinkMenu`, classified, so the shared link menu (Open Link, Copy Link to Clipboard) opens over a link in a PDF, per Constitution 5.5.0 (one gesture follows a link) and FR-066 (missing)
- [x] T061 CRITICAL: Make an HTML page's `#fragment` links follow only on Ctrl+click / Ctrl+Enter, scrolling the frame to their target, never on a plain click, with the target-and-gesture hover text, per FR-079 and Constitution 5.5.0 (contradicts)
- [ ] T062 Add **Copy Path** to the Image Preview's and the PDF Preview's body menus, per FR-028 and FR-068a (missing)
- [ ] T063 Offer **Select All** in a PDF Preview's body menu and keep Ctrl+A to the PDF's text layers rather than the whole window, per FR-068a (partial)
- [ ] T064 Make Refresh and an update re-read an HTML page's relative stylesheets and fonts, so a change to one on disk is shown, per FR-072 (partial)
- [x] T065 Amend FR-085a additively: an HTML Preview's plain **Copy** runs `editor.previews.copyFormat` like every preview, per Constitution 5.5.0 (a preference picks the default; the menu offers every variant), which the code already follows, per FR-085a (contradicts)
- [ ] T066 Reject an image over the pixel limit from its dimensions before decoding the bitmap, per FR-025 and the "huge dimensions, small file" edge case (partial)
- [x] T067 Build a PDF link's and an HTML link's hover text with `previewLinkHoverText` and the platform's modifier, naming the target and what following it does, per FR-066, FR-079 and 044 FR-094 (partial)
- [ ] T068 Measure a parented SVG preview showing an edit within the update delay + 250 ms, beside the parented HTML reading in `preview-media-performance.e2e.ts`, per SC-003 (partial)
- [ ] T069 Word an Image or SVG Preview's Fit tooltip and the toolbar's and viewport's accessible names for a picture, not a diagram, per FR-033 (partial)
- [ ] T070 Show the resting zoom indicator at full opacity while its panel is in Focus Mode, per FR-031g (partial)
- [ ] T071 Restore a PDF's position within the page after a reload, not only the page, per FR-064 and US4/AC3 (partial)
- [ ] T072 Resolve an HTML page's legacy `background` attribute as an image resource, so a relative one loads and a remote one is refused and listed, per FR-072 and FR-093a (partial)
- [ ] T073 Update the code comments that still describe the superseded opaque-origin HTML frame, per FR-074a, FR-085a and FR-072a (partial)
- [x] T074 Amend the spec text that FR-104, FR-020a and 068 FR-056 superseded: US1/AC1's panel title, the SVG viewBox edge case, and FR-035's `|300` for an image, per FR-104, FR-020a and FR-035 (contradicts)
