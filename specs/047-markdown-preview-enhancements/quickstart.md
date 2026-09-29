# Quickstart: validating 047

How to prove the feature works. Designs live in [research.md](./research.md),
[data-model.md](./data-model.md) and [contracts/](./contracts/); this page only says what to run and
what to see.

## Automated

```bash
npm run lint
npm run typecheck
npx vitest run --project unit      packages/core/tests/unit/{fold-state,document-symbol,table-widths,wiki-links,keybindings-*,preview-settings,settings-*}*.test.ts
npx vitest run --project unit      packages/ui/tests/unit/{scope,markdown-pipeline*,heading-slug-parity,chord-engine,docs-currency}*.test.ts
npx vitest run --project component packages/ui/tests/component/preview-*.test.ts packages/ui/tests/component/{find-bar-*,editor-markdown-fold*,heading-outline*}.test.ts
npm run test:integration -- preview-service
npx vitest run packages/ui/tests/contract/preview-ipc.contract.test.ts
```

Done-ness is `npm run gate` on the hosted runner (repo `CLAUDE.md`), quoted with its run URL and SHA.

## By hand (dev build)

Prerequisites: `npm run build`, then `npm run dev`; a project containing `docs/`, `specs/` and a
folder with `README.md` and `notes/Other.md`.

1. **Find** — open `specs/044-file-previews/spec.md` as a preview, press **Ctrl+F**, type `sanitis`:
   matches highlighted, count "n of m" grouped, F3/Shift+F3 step and wrap; **Ctrl+H** does nothing.
2. **Open in place** — Editor → Previews → Markdown default open action = Preview. Click three `.md`
   files in Files & Folders: one preview panel; Back walks back. Switch tabs and click another: a new
   panel opens in that tab; the first tab's preview is unchanged.
3. **Drop** — drag `README.md` from Files & Folders onto a preview: it shows; Back returns. Drag a
   `.ts` file: refused cursor, nothing changes. Drop three `.md` files from Windows Explorer: first in
   place, two new preview panels.
4. **Folding** — open a spec in an editor with its preview beside it. Click a `−` in the editor gutter:
   the same section collapses in the preview. Click the preview's `▾`: the editor follows.
   **Ctrl+M, A** then expand the H1: its H2s are collapsed. Collapse an H1 with expanded H2s and
   re-expand: H2s still expanded. Right-click inside an H3: "Collapse This H3".
5. **Gutter off** — Editor → Previews → Markdown: Preview gutter off: arrows gone, document no longer
   shifted; Ctrl+M, S still folds.
6. **Go to Heading** — in the preview press **Ctrl+G**: pop-down scrolled to the current section; Down
   lands on it; type `accept`, Enter: smooth scroll there; Back returns.
7. **Wikilinks** — a note with `[[Other]]`, `[[notes/Other|alias]]`, `[[/docs/README]]`,
   `[[../README]]`, `[[Missing]]`: each follows as an ordinary link; `[[Missing]]` is styled broken and
   shows the not-found notice.
8. **Tables** — preview `docs/key-bindings.md` in a half-width panel: no horizontal scrollbar, long
   cells wrap; drag a column border.

## SC-006a corpus check (once, before sign-off)

Run the dev-only harness `scripts/dev/table-fit-survey.mjs` (created by the tables task; not shipped,
not in the gate) against the running dev app: it previews every `.md` under `docs/` and `specs/` at
half the window width and reports `tables fitting / total`. Record the percentage in the PR; it must be
≥ 95%.
