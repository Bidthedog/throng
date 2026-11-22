# Contract: maths markup

## Pipeline output

| Source | Emitted (source as escaped text) |
|---|---|
| `$x$` | `<span data-math="inline" data-math-open="$">x</span>` |
| `` $`x`$ `` | `<span data-math="inline" data-math-open="$`">x</span>` |
| `$$x$$` inside a paragraph | `<span data-math="display" data-math-open="$$">x</span>` |
| `$$` block (own lines) | `<div data-math="display" data-math-open="$$" data-source-line="N">x</div>` |
| ` ```math ` fence | `<div data-math="display" data-math-open="fence" data-source-line="N">x</div>` |

With **Typeset math** off the rules do not run: the text is exactly what 044 FR-086 rendered, and a
` ```math ` fence is an ordinary code block.

## Sanitiser

`data-math` (`inline` | `display`) and `data-math-open` (one of the four values) are admitted on `span`/`div`;
any other value removes both. No other change.

## Typesetting (after sanitising)

- For each `[data-math]` not yet typeset: `katex.renderToString(source, { displayMode, trust: false,
  strict: 'ignore', maxExpand: 1000, maxSize: 50, output: 'htmlAndMathml' })`, then that module's own sanitiser,
  then the element's children are replaced with the fragment. The element gains `data-math-typeset` and
  keeps the source in `data-math-source`.
- On a KaTeX error: the element keeps its source text (with delimiters), gains `data-math-error` and a
  `title` naming the error; styled from `syntaxInvalid` (FR-044).
- `math-typeset.ts`'s `MATH_PROFILE`: tags `span math semantics mrow mi mo mn ms mtext mspace msup msub msubsup mfrac
  msqrt mroot mover munder munderover mtable mtr mtd mpadded mphantom menclose mstyle annotation svg path line
  g rect`; attributes `class style aria-hidden encoding xmlns viewBox d width height x y x1 x2 y1 y2
  preserveAspectRatio fill stroke stroke-width mathvariant stretchy fence separator lspace rspace accent
  accentunder columnalign rowspacing columnspacing display`; no URI-bearing attribute; `style` values
  containing `url(` are removed by a hook.
