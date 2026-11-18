# Implementation Plan: Markdown preview extensions — callouts, maths and printing

**Branch**: `feature/S075-I672-markdown-preview-extensions` | **Date**: 2026-11-18 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/075-markdown-preview-extensions/spec.md`

## Summary

Three independent strands over the Markdown preview. **Callouts** (#672): `markdown-it-obsidian-callouts`
parses, a throng core rule rewrites its tokens into throng's own markup, a core registry resolves each type
to a canonical id, icon key and colour role, seven new theme tokens colour the roles, and the body folds
them as view state. **Maths** (#393): an in-repo markdown-it rule implements GitHub's delimiter rules and
emits placeholders that pass the document sanitiser; after insertion a lazily loaded KaTeX module typesets
each one, with `trust: false` and expansion and size limits, through a second sanitiser profile.
**Printing** (#484): providers declare a print capability, the preview chrome turns its body into a
printable document (a cleaned clone of what is on screen, every fold open), and main shows it in a single
modal Print Preview window whose pages are a PDF of that document laid out by Chromium's own print engine,
then prints it silently to the printer chosen there. The print palette is a private fixed stylesheet; the
settings persist in a state file. Decisions are in [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript 7 (native), Node 24, Electron 45, React 19

**Primary Dependencies**: markdown-it 15 (existing); **new**: `markdown-it-obsidian-callouts` 0.3.5
(Apache-2.0, pinned, root `overrides` forces its markdown-it peer to ^15), `katex` ^0.18.10 (MIT, already in
the tree through mermaid; now a direct dependency); DOMPurify (existing) for the maths profile

**Storage**: `userData/print-settings.json` (main, atomic write) for the print settings; theme files gain
seven tokens through the additive upgrade (`SHIPPED_DEFAULTS_VERSION` 35 → 36); `settings.json` gains
`editor.previews.providers.markdown.typesetMath`; temporary print files under `userData/print-jobs/`, removed
when the window closes

**Testing**: Vitest unit (registry, parser pin, delimiter rule, print settings, option mapping, palette
contrast), component (callout DOM, fold, find, menus, Print Preview app), integration (print controller
over the engine test double, settings store on disk), contract (fake provider that prints pages). E2E only
where a real window is the subject: the Print Preview window opening modal, single, and saving settings
across a restart

**Target Platform**: Windows, Linux and macOS together (Principle II); printing is Electron's, behind the
`IPrintEngine` seam

**Project Type**: desktop app (Electron main, renderer, daemon)

**Performance Goals**: a document without maths loads no KaTeX (SC-006); 500 expressions typeset in
batches that yield between frames; print preview re-paginates a 20-page document within 2 s of a settings
change (SC-008), debounced, off the renderer thread (printToPDF runs in a hidden print host)

**Constraints**: nothing reaches a printer before Print Preview has shown (SC-012); printing fetches nothing
new (FR-079; one recorded exception, Complexity Tracking); the print host runs with JavaScript disabled

**Scale/Scope**: 6 stories, FR-001 – FR-092, SC-001 – SC-013

## Constitution Check

| Principle | How this holds |
|---|---|
| I Project-first | print jobs carry only the preview's own document; images resolve through the existing confined `throng-preview://asset/<panelId>/` route |
| II Platform abstraction | printing goes through the `IPrintEngine` port (core) with an Electron adapter in `ui/main` and a recording double in `core/testing`; nothing OS-specific is added, so Windows, Linux and macOS ship together |
| III Terminals | untouched |
| IV Keyboard tiers | one new chord, `Ctrl+P`, scoped to `preview` only; it is in neither reserved tier and is never live in a terminal |
| V Testing | every task is test-first at the lowest layer; E2E only for the window-level outcomes named above |
| VI UX | Print… has a menu item in every preview menu; callout fold controls use the existing fold icon keys with hovers; disabled-with-reason for providers that cannot print |
| VII Change review | printing is an explicit two-step action: Print… shows the preview, Print sends the job |
| VIII SOLID, DRY, YAGNI | one registry for callout types, one print path for every provider, one palette module; no user-defined callout types or editable print palette (out of scope) |
| IX DI | the print controller takes its engine, settings store, window factory and folder by constructor; main builds them once at its wiring point, beside the Preferences window's deps (deviation recorded below) |
| X Configuration | `typesetMath` is a provider-declared setting (descriptor generated); seven theme tokens with descriptors and an additive upgrade; thirteen icon keys with descriptions; `preview.print` keybinding. Print settings are application state, not configuration (FR-070), like window geometry and the terminal form history |
| XI Workspace | callout fold state is the body's view state of the same render, not document state; nothing persists it (FR-008) |
| XII Responsive | KaTeX loads lazily and typesets in yielding batches; pagination runs in the print host process; the controls never wait on it |
| XIII Failure trace | a failed print raises one notice and logs; a corrupt settings file logs and falls back; a failed typeset is an inline error with its message in the hover and a log line at debug level |
| Quality gates | configuration-editor completeness (descriptors for every new key), themeable icon controls (Print Preview's controls), docs currency (key-bindings, preferences, previews), lint and typecheck clean |

**Post-design re-check**: passes. The one deviation is recorded below.

## Project Structure

### Documentation

```text
specs/075-markdown-preview-extensions/
├── plan.md  research.md  data-model.md  quickstart.md
├── contracts/  callout-markup.md  math-markup.md  print.md
└── tasks.md
```

### Source Code

```text
packages/core/src/
├── preview/callouts.ts (new)          registry, alias resolution, title rule, role list
├── preview/math-delimiters.ts (new)   GitHub's opening/closing rules as pure scanners
├── preview/print.ts (new)             PrintSettings, PrintableOutput, parse/clamp, option mapping, page sizes
├── preview/print-palette.ts (new)     the private fixed print palette
├── preview/provider.ts                `print` capability on the descriptor
├── preview/providers/markdown.ts      `typesetMath` setting; `print: 'document'`
├── preview/providers/mermaid.ts       `print: 'document'`
├── abstractions/print-engine.ts (new) IPrintEngine port
├── testing/recording-print-engine.ts (new)
├── config/theme.ts, theme-metadata.ts, default-themes/, shipped-defaults.ts   seven callout role tokens, area
├── config/keybindings.ts              `preview.print`, PREVIEW_ONLY scope, Ctrl+P
└── icons/icon-keys.ts, default-set/*.svg, SOURCES.json, icon-sets-README.txt   thirteen callout icons
packages/ui/src/main/
├── print-preview-window.ts (new)      the single modal window, its PDF view
├── print-controller.ts (new)          jobs, temp files, preview/print through the engine
├── electron-print-engine.ts (new)     hidden print host, printToPDF, silent print, printer list
├── print-settings-store.ts (new)      userData/print-settings.json
├── print-ipc.ts (new), main.ts
packages/ui/src/preload/preload.cts    `throng.print.*`
packages/ui/src/renderer/
├── preview/providers/markdown/callouts.ts (new)      markdown-it rule + renderer rules (registered from pipeline.ts)
├── preview/providers/markdown/math.ts (new)          markdown-it delimiter rule (registered from pipeline.ts)
├── preview/providers/markdown/callout-dom.ts (new)   icons, fold, keyboard, reveal over the inserted DOM
├── preview/providers/markdown/math-typeset.ts (new)  lazy KaTeX + its own sanitiser profile (own chunk)
├── preview/math-host.ts, preview/node-reveal.ts (new)  provider-agnostic maths attributes; a body's fold reveal
├── preview/providers/markdown/sanitise.ts            admit callout and maths placeholder attributes
├── preview/providers/markdown/markdown-body.tsx, markdown.css, copy.ts, preview-search.ts
├── preview/print/printable.ts (new)  clone, strip furniture, expand, serialise with styles
├── preview/print/print-stylesheet.ts (new)
├── preview/preview-commands.tsx, content-menu.ts, preview-panel.tsx, provider-view.ts, providers/*/view.ts
├── print-preview/ (new)               Print Preview app (controls, page area, progress, notice)
└── main.tsx                           `?printPreview=<job>` route
```

**Structure Decision**: the existing monorepo; no new package. Shared-file changes with spec 074 (`pipeline.ts`,
`sanitise.ts`) are kept to registration lines and allowlist entries; the rules live in their own modules.

## Delivery order

1. **Spec, plan, tasks** (this change).
2. **Callouts** — core registry, parser pin, pipeline rule, sanitiser, DOM pass (icons, fold, keyboard,
   reveal, find, copy), theme tokens and upgrade, icons, Themes-editor area.
3. **Maths** — delimiter rule, setting, lazy typesetter and profile, find and copy, styles.
4. **Print contract and command** — descriptor capability, view `printable`, command, binding, menus,
   disabled state.
5. **Print Preview** — core print model, engine port and double, controller, settings store, window, app,
   Electron engine, print stylesheet and palette.
6. **Docs, manual test plan.**

## Complexity Tracking

| Deviation | Why needed | Simpler alternative rejected because |
|---|---|---|
| **FR-079: a remote image the preview already showed is requested again by the print host** (normally answered from the HTTP cache). Nothing else is requested. | A remote image cannot be copied out of the preview without CORS (a canvas holding it is tainted), so the printable document can only name its URL. | Printing such images as alternative text would break FR-079's own "a remote image prints only if the preview already loaded it". The print host admits exactly the URLs the preview had loaded and nothing else (research R9). |
| **Print preview pages are shown by Chromium's built-in PDF viewer** in a view inside the window, not drawn by throng. | The pages are a PDF from the same print engine that prints, which is the only way to show pagination "exactly as it will print" (FR-068) without writing a paginator. | A throng paginator would be a second layout engine that drifts from the printer's; pdf.js would add a large dependency for one window (research R8). |
| **The print controller is built in `main.ts`, not bound in the composition-root container.** | Its engine needs the preview protocol handler, the user-data path and the window chrome, which `main.ts` holds at the point it builds the Preferences window's deps; the controller still takes every collaborator by constructor, so its integration test injects a recording engine and a fake window. | Binding it in the container would mean binding the preview protocol handler and the window factory there first, for one consumer; a follow-up can move all three when another consumer appears. |
