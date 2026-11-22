/**
 * The print stylesheet (075 FR-072, FR-073, FR-075, FR-076, Q1 = B).
 *
 * Applied last in the printable document, over the preview's own styles and the fixed print palette. It never
 * names a colour: every colour is the palette's, through the same custom properties the theme sets. It lays the
 * document out for paper: one column at the page's width, code that wraps rather than overflows, and page breaks
 * that keep a heading with what follows and never split a code block, a table row, a callout, a diagram, an
 * image or a display equation.
 *
 * A string, not a `.css` file: it is not applied to throng's own window, only written into the printable
 * document (`printable.ts`).
 */
export const PRINT_STYLESHEET = `
html,
body {
  margin: 0;
  padding: 0;
  background: var(--throng-colour-editorBg);
  color: var(--throng-colour-text);
  /* FR-073 — the app's stylesheet holds its window to the viewport and clips the rest; a printed document is as
     long as its content, or every print stops at page one. */
  height: auto;
  overflow: visible;
}

/* FR-072 — paper is white in every theme: a dark theme's \`color-scheme: dark\` paints the page's margins. On
   \`:root\`, where theme.css declares it, so this one — later — wins. */
:root {
  color-scheme: light;
}

/* The body's own root, whatever its provider drew it as. */
.throng-print > * {
  max-width: none;
  margin: 0;
  padding: 0;
  overflow: visible;
  height: auto;
  /* The panel's scroller on screen is contained and layered (075 SC-006): sized by the panel, not its content. */
  contain: none;
  will-change: auto;
}

/* FR-073 — keep a heading with what follows it. */
.throng-print h1,
.throng-print h2,
.throng-print h3,
.throng-print h4,
.throng-print h5,
.throng-print h6 {
  break-after: avoid;
  page-break-after: avoid;
}

/* FR-073 — never split these across a page. */
.throng-print pre,
.throng-print tr,
.throng-print img,
.throng-print [data-callout],
.throng-print div[data-math],
.throng-print .throng-print__diagram {
  break-inside: avoid;
  page-break-inside: avoid;
}

/* FR-076 — code wraps at the page edge instead of being cut off. */
.throng-print pre,
.throng-print pre code {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  overflow: visible;
}

/* FR-076 — a table and an image fit the text column. */
.throng-print table {
  width: 100%;
  table-layout: auto;
}

/* FR-073 — and no taller than a page, or it would split across two. */
.throng-print img {
  max-width: 100%;
  max-height: 95vh;
  height: auto;
}

/* A display equation never scrolls on paper. */
.throng-print div[data-math] {
  overflow: visible;
}

/* FR-075 — an embedded diagram takes the text column's width; a standalone one fills the page. Either is held to
   one page's height (FR-073; edge case: a diagram taller than a page scales to fit one). */
.throng-print__diagram svg {
  display: block;
  width: 100%;
  height: auto;
  max-width: 100%;
  max-height: 95vh;
}

.throng-print--fit-page .throng-print__diagram svg {
  max-height: 95vh;
}
`;
