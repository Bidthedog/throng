# Quickstart: validating callouts, maths and printing

Prerequisites: a worktree build (`npm run build`, with no throng running from it), then `npm start`.
Fixtures live under `packages/ui/tests/fixtures/preview/075/`.

## Callouts

1. Open `callouts-all.md` as a preview. Every type and alias renders as its canonical type (SC-001):
   compare against the registry table in spec FR-019.
2. Tab through `callouts-nested.md`: each foldable title takes focus; Enter and Space toggle (SC-003).
3. Preferences → Themes → **Markdown preview · Callouts**: change **Warning**; every warning, caution and
   attention callout recolours in the open preview.

## Maths

1. Open `math-github.md`: inline, display, fenced and `` $`…`$ `` forms typeset; the prose-dollar lines stay
   text (SC-005). A malformed line shows its source in the error colour with the error in its hover.
2. Turn off **Editor → Previews → Markdown: Typeset math**: every expression shows as source at once.
3. Open `plain.md` (no maths) with DevTools' network panel: no `katex` chunk or font is requested (SC-006).

## Printing

1. In a focused Markdown preview press **Ctrl+P**: the Print Preview window opens over the main window,
   which takes no input until it closes. Press Ctrl+P in a sub-workspace preview: the open window is focused.
2. Change page size, orientation, margins and scale: the pages update within two seconds (SC-008).
3. Print to the OS's PDF printer; open the PDF: light page, every collapsed section and callout open,
   diagrams vector, no heading last on a page (SC-009).
4. Restart throng and press Ctrl+P again: the same printer and settings are selected (SC-013).

Automated: `td run --runner unit --scope file --target packages/core/tests/unit/callouts.test.ts` (and the other
075 files); E2E `print-preview.e2e.ts` runs in `pipeline.yml`.
