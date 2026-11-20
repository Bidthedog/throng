# Contract: callout markup

What the pipeline emits for a callout, what the sanitiser admits, and what the body adds after sanitising.

## Pipeline output (before sanitising)

```html
<div data-callout="warning" data-callout-role="warning" data-callout-fold="closed" data-heading-nonce="<nonce>" data-source-line="12">
  <div data-callout-title>
    <span data-callout-icon></span>
    <span data-callout-title-text>Title <em>inline</em></span>
  </div>
  <div data-callout-body>
    …the body's blocks, rendered as anywhere else…
  </div>
</div>
```

- `data-callout`: the **canonical** id from the registry, never the written alias (FR-018).
- `data-callout-role`: that id's colour role from the registry, so styles select seven roles, never a list of types (FR-019a).
- `data-callout-fold`: `open` (`+`), `closed` (`-`), absent (no sign: not foldable).
- `data-callout-body` is omitted for a title-only callout (FR-003).
- `data-source-line`: the blockquote's first line, offset like every other block (FR-012).
- The nonce is this render's, as on headings; the sanitiser removes it.

## Sanitiser (render profile additions)

Attributes added to `ALLOWED_ATTR`: `data-callout`, `data-callout-role`, `data-callout-fold`, `data-callout-title`,
`data-callout-title-text`, `data-callout-icon`, `data-callout-body`. Hook rules:

1. `data-callout` survives only on a `div` carrying this render's nonce **and** with a value that is a
   registry id, and `data-callout-role` survives only as that id's registry role. Otherwise both, and the fold
   sign, are removed from the element.
2. `data-callout-fold` survives only with `data-callout`, and only as `open` or `closed`.
3. The presence attributes survive only on `div`/`span` inside a surviving callout.
4. Nothing else changes: `class`, `style`, `aria-*`, `on*` stay forbidden.

## Body DOM pass (after sanitising)

- Draws the role's icon into `[data-callout-icon]` with the resolver (`callout<Id>`), so user icon sets apply.
- For a foldable callout: `data-callout-title` gets `tabindex=0`, `role=button`, `aria-expanded`, a `title`
  hover ("Expand callout" / "Collapse callout"), and a fold control `span.preview-callout__fold` holding the
  `foldPreviewExpanded` / `foldPreviewCollapsed` icon. A collapsed callout carries `data-callout-collapsed`,
  which hides `[data-callout-body]` by CSS.
- The fold control and icon are furniture: excluded from find, copy and print (`TOGGLE_CLASS`-style exclusion).

## Styles

`markdown.css` styles `[data-callout]` by attribute only, one rule per role selected by
`[data-callout-role='<role>']` (bare `[data-callout]` is neutral). Role colour = `var(--throng-colour-callout<Role>)`
on the border and title; background `color-mix(in srgb, var(--throng-colour-callout<Role>) 12%,
var(--throng-colour-editorBg))`, the mix core's `calloutTint` computes for the contrast guard.
