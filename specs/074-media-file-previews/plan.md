# Implementation Plan: Media File Previews — Images, SVG, PDF and HTML

**Branch**: `feature/S074-I441-media-file-previews` | **Date**: 2026-11-18 | **Spec**: [spec.md](./spec.md)

**Input**: `specs/074-media-file-previews/spec.md` — 6 user stories, one clarification session (Q1 – Q5
plus the view-controls requirement). Refs #441, #631, #388, #508.

## Summary

- **Open … in, for every preview type** (FR-016 – FR-019): the existing `defaultOpenAction` key widened
  to `editor | preview | os`, generated for text and binary providers alike, relabelled "Open <files>
  in"; `os` hands the file to the OS default program through the existing open-in-OS route (R1,
  contract `open-in-preference.md`). **First implementation increment**, one commit
  `feat(074): Open-in preference for every preview type`, which spec 073 cherry-picks.
- **One drawing frame** for Mermaid, images and SVG: each picture becomes a block renderer returning a
  one-`<image>` SVG wrapper, so the 054 `DiagramFrame` supplies every control (R2).
- **SVG** drawn in Chromium's image mode from a `blob:` URL — no script, no load (R3); the same
  renderer draws ```` ```svg ```` fences in Markdown (R7).
- **Image** through the source route, size-capped per provider; Copy Image from bytes read by a new
  `preview.readSource` IPC that reuses the protocol handler (R4).
- **PDF** with PDF.js (Apache-2.0), lazy, canvas only, our own link overlay, bytes by IPC (R5).
- **HTML** in a `sandbox="allow-popups"` `srcdoc` frame of a DOMPurify-sanitised, URL-rewritten copy
  with an injected CSP; Ctrl+click reaches main's window-open handler through a `follow` route that
  answers 204 (R6).
- **Framed local images** in Markdown (FR-055) from a new module beside the block claimer (R7).

## Technical Context

**Language/Version**: TypeScript (repo toolchain, ES2022), Node 24, Electron 45.

**Primary Dependencies**: React 18, DOMPurify ^3, markdown-it ^15 (untouched), mermaid (untouched).
**New runtime dependency: `pdfjs-dist` 6.x (Apache-2.0)** in `packages/ui`, lazy-loaded (R5, FR-102).

**Storage**: Settings only — `editor.previews.providers.{image,svg,pdf,html}.*` and the widened
`defaultOpenAction` / `openTarget` on every provider. No layout or schema change. View state never
stored beyond 044 FR-066.

**Testing**: unit (core and ui), component (jsdom, fake pdf.js, fake image loader), integration
(protocol and preview service over a temp tree), two E2E specs (R10).

**Target Platform**: Windows, Linux, macOS desktop (Electron).

**Project Type**: Desktop application, npm-workspaces monorepo.

**Performance Goals**: SC-003 (image/SVG < 1 s), SC-004 (500-page PDF first page < 2 s, no frame
> 100 ms), SC-005 (size notice < 200 ms, no read).

**Constraints**: Untrusted content in all four types; four independent security layers per provider
(FR-091); no network; `pipeline.ts` and `sanitise.ts` unchanged (075 boundary).

**Scale/Scope**: `packages/core` (descriptors, settings, request policy) and `packages/ui` (renderer
providers, diagram frame, main protocol / service / window-open guard / IPC, preload).

## Constitution Check

*GATE: evaluated before Phase 0 and re-evaluated after Phase 1.* Constitution v7.0.0. No amendment.

| Principle | Assessment |
|---|---|
| **I. Project-First Context Isolation** | **Engaged, satisfied.** Every byte read goes through the protocol handler's two-pass confinement (`readSource` calls the same handler). HTML assets confined by the asset route; follow links resolved by the chrome's existing project-confined link path. |
| **II. Platform-Abstracted Core** | **Engaged, satisfied.** Descriptors, settings, `defaultOpenActionFor`, `maxFileBytesFor` and the request decision are pure core. The OS open is the existing shell-integration seam. No per-OS code. |
| **III. Detached Terminals** | Not engaged. |
| **IV. Native Terminal Support** | Not engaged — no new key binding. |
| **V. Test-First (NON-NEGOTIABLE)** | **Engaged.** Every task test-first at the lowest layer (R10). Tests changing by supersession: those asserting a binary provider has no default-open-action row (044 FR-051), the label "Default open action" (044 FR-050) and option labels "Editor"/"Preview" — `settings-descriptors-054.test.ts`, `preview-settings-054.test.ts` and kin. |
| **VI. Simple, Modern, Discoverable UX** | **Engaged; see the rules table.** |
| **VII. Change Review & Approval** | Not engaged — previews are read-only. |
| **VIII. SOLID, DRY & YAGNI** | **Engaged.** DRY: one frame for every picture; one confinement path (`readSource` reuses the handler); one OS-open route. YAGNI: no image library, no PDF text layer, no script opt-in. |
| **IX. DI & Composition Root** | **Engaged.** `readSource` and the follow route are wired in `main.ts` from the existing protocol handler and window-open guard. |
| **X. Externalised Configuration** | **Engaged.** Each new setting has a generated descriptor. `MAX_IMAGE_PIXELS`, `SVG_DRAW_TIMEOUT_MS` and the PDF render margin are limits, recorded below. |
| **XI. Dockable Workspace** | **Engaged.** Four panel types on the one `preview` kind (054 R2); no layout change; Focus Mode as every panel. |
| **XII. Responsive UI (NON-NEGOTIABLE)** | **Engaged.** Image decode async and pixel-bounded; SVG draw time-bounded; PDF in a worker, pages on demand; HTML sanitised once per update. |
| **XIII. Every Failure Leaves a Trace** | **Engaged.** Each failure is one inline notice (size, decode, malformed, encrypted); caught errors go through `logCaught` / `logExpected`. |

### Principle VI — its named rules

| Rule | Assessment |
|---|---|
| **Every panel action has a menu item** | Frame controls mirror the body menu (Copy Image, Focus Mode) as Mermaid's do; Copy Path on every body menu. |
| **Disabled when unavailable, absent when meaningless** | Select All / Go to Heading / Outlining absent on picture and PDF types; Synchronise Scrolling absent for SVG and HTML; Find disabled on HTML (FR-086). |
| **Themeable icon controls (NON-NEGOTIABLE)** | No new controls: the frame's existing tokens. |
| **One condition, one notice** | Each failure one inline notice; FR-081 once per preview. |
| **Displayed quantities digit-grouped** | Engaged: size notices, image dimensions and size, PDF page numbers through `formatGrouped`. |

### Development Workflow & Quality Gates

| Gate | Assessment |
|---|---|
| **Incremental delivery** | Engaged: the deferrals in Complexity Tracking, each with a follow-up issue to file. |
| **Documentation currency** | Engaged: `docs/preferences.md`, `docs/README.md`, `README.md`, 044's security-policy and seam contracts. |
| **Configuration-editor completeness** | Engaged: generated descriptors cover every leaf; the completeness tests run over the shipped registry. |
| **Particular-scrutiny review** | Engaged: a new renderer CSP grant and a new IPC that returns file bytes. |

**Result: PASS.**

### Re-evaluation after Phase 1

Verdict unchanged. The design added one provider-neutral seam field per need (`filesNoun`,
`previewOptionLabel`, `maxFileBytesSetting`, `assetMimeTypes`, `revealsMatches`, the view's `searchable`, and the
body props `onStatusReadout` and `readSource`), so
SC-006 holds: no surface names a provider.

## Project Structure

### Documentation (this feature)

```text
specs/074-media-file-previews/
├── spec.md
├── plan.md
├── research.md          # R1–R10
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── open-in-preference.md
│   └── media-providers.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
packages/core/src/
├── preview/provider.ts                 # descriptor fields
├── preview/settings-types.ts           # DefaultOpenAction + 'os'
├── preview/wire-types.ts               # too-large size/limit
├── preview/request-policy.ts           # fromSubFrame
├── preview/providers/{image,svg,pdf,html}.ts, index.ts
└── config/preview-settings.ts          # Open … in rows, maxFileBytesFor

packages/ui/src/
├── main/preview-protocol.ts            # per-provider cap, assetMimeTypes, follow 204
├── main/preview-service.ts             # too-large before read
├── main/window-open-guard.ts           # follow → preview:frameLink
├── main/renderer-request-filter.ts     # sub-frame rule
├── main/preview-ipc.ts (+ preload)     # readSource
├── renderer/index.html                 # frame-src throng-preview://follow
├── renderer/editor/open-router.ts, editor-open.tsx
├── renderer/find-in-files/find-in-files-chrome.tsx
├── renderer/preview/blocks/{svg-block,image-block}.ts
├── renderer/preview/diagram/{diagram-frame.tsx,rasterise.ts,diagram.css}
├── renderer/preview/providers/{image,svg,pdf,html}/
├── renderer/preview/providers/markdown/framed-images.ts
└── renderer/preview/providers/index.ts
```

**Structure Decision**: providers live beside `markdown/` and `mermaid/` in both packages, per the seam.
Provider-specific changes outside a provider folder are limited to the security-policy rows above.

## Complexity Tracking

| Item | Why | Simpler alternative rejected because |
|---|---|---|
| New dependency `pdfjs-dist` (Apache-2.0) | FR-069 | Chromium's viewer cannot be held to FR-066/FR-091 (R5) |
| CSP grant `frame-src throng-preview://follow` | a plain click in the HTML frame must not navigate or blank it | stripping `href` loses Ctrl+click (R6) |
| Limits: `MAX_IMAGE_PIXELS` 100,000,000; `SVG_DRAW_TIMEOUT_MS` 5,000; PDF render margin one viewport | Principle XII bounds, not preferences | settings would invite raising a safety bound |
| **Deferred: web fonts in an HTML Preview** (FR-072 fonts) | a cross-origin font needs CORS, which the preview scheme does not grant (R4/R6) | granting CORS on preview bytes widens every route; follow-up issue to file |
| **Deferred: HTML Preview keeps its scroll across live updates** (FR-071's 044 FR-024 clause) | the opaque frame's scroll is unreadable from outside | `allow-same-origin` breaks FR-074; follow-up issue to file |
| **Deferred: HTML body right-click menu and find bar** (FR-085, FR-086) | same opacity | Find is shown disabled per FR-086; follow-up issue to file |
| **Deferred: PDF images in JPX/JBIG2** | PDF.js decodes them with WASM, which needs `wasm-unsafe-eval` | widening `script-src` for every document; those images are absent |

## Amendment 2026-11-20 — maintainer feedback after sign-off

Scope: FR-071b, FR-072a, FR-074a, FR-085a, FR-086b, FR-086c, FR-086d, FR-093a; defects FR-012 (parented buffer),
FR-055 (wiki images), SC-003 / SC-004 measured. Decisions in research R6a – R6e, R7a, R8a.

### Technical context (delta)

- The HTML frame becomes **same-origin, still script-less**: `sandbox="allow-same-origin allow-popups"` (R6a). The
  renderer reaches `iframe.contentDocument` directly; the main-process frame input relay (FR-083a) is replaced by
  listeners on that document and deleted.
- New core module `packages/core/src/preview/safe-sources.ts` (normalise, match). New global setting
  `editor.previews.providers.html.safeSources`; new per-project list `htmlSafeSources` through core → persistence
  (migration) → ipc-contract → daemon → renderer store → Project Settings dialog, following 060's
  `searchExcludeGlobs`.
- Main: the renderer request filter learns per-frame safe sources (R6c); the preview service caps a parented buffer
  (R7a). No new dependency.

### Constitution Check (delta)

- Principle on security layering (044 FR-091): script is still refused by three independent layers (sanitiser,
  sandbox, content policy); remote loads by two (frame CSP, request filter) plus the renderer CSP for every other
  scheme. The opaque-origin containment layer is given up by the maintainer's decision (FR-074a) — Complexity
  Tracking.
- One condition, one notice (CLAUDE.md): blocked remote resources raise one notice (FR-093a).
- Every panel action has a menu item: the HTML body menu (FR-085a) uses the shared preview content menu.

### Complexity Tracking (delta)

| Item | Why | Simpler alternative rejected because |
|---|---|---|
| HTML frame shares the renderer origin (FR-074a) | in-place update, scroll, Find, menu need the document | opaque frame: scroll unreadable, Find window-wide only (maintainer chose this, 2026-11-20) |
| Renderer CSP grants `style-src https:` and `font-src 'self' https: throng-preview:` | a same-origin `srcdoc` frame inherits the renderer's policy, and the safe list is user-editable | a static per-origin grant cannot follow a user list; the frame's own CSP and the request filter narrow it to the list |
| Request filter keeps a per-frame source map (frame `name` → origins) | the per-project list differs between panels | a union of every project's list would let one project's trust reach another |

FR-092a records the renderer grant. Supersedes the three **Deferred** rows above (and the opaque-frame lines of the Summary and Technical Context) for HTML scroll, menu/find and web fonts (remote: FR-072a; local
fonts: same-origin frame + `font-src` grant).
