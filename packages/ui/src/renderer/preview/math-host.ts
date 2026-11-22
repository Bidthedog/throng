/**
 * The DOM shape of a maths expression in a preview (075, FR-044, FR-049, FR-050, contracts/math-markup.md), for
 * the provider-agnostic surfaces that meet one — find, copy and print — the way `diagram/diagram-host.ts` serves
 * a diagram. Names attributes and builds literals; imports nothing, loads no typesetter.
 */

/** The placeholder's mode: `inline` or `display`. */
export const MATH_ATTRIBUTE = 'data-math';
/** How the expression was opened: `$`, `` $` ``, `$$` or `fence`. */
export const MATH_OPEN_ATTRIBUTE = 'data-math-open';
/** Set once the equation is drawn; find leaves it out (FR-049) and copy substitutes it (FR-050). */
export const MATH_TYPESET_ATTRIBUTE = 'data-math-typeset';
/** The expression's source, kept once its text has been replaced by the drawing. */
export const MATH_SOURCE_ATTRIBUTE = 'data-math-source';
/** Set on an expression waiting for the typesetter: its source is in `data-math-source`, a placeholder in its place (FR-043a). */
export const MATH_PENDING_ATTRIBUTE = 'data-math-pending';
/** Set on an expression the typesetter refused; it shows its literal source, styled as an error (FR-044). */
export const MATH_ERROR_ATTRIBUTE = 'data-math-error';

/** The mark a copied equation's `<math>` carries; the export profile keeps only marked MathML (FR-050). */
export const MATH_COPY_MARK = 'data-throng-math-copied';

/** Every value `data-math-open` may take. */
export const MATH_OPENS: readonly string[] = ['$', '$`', '$$', 'fence'];

/** An expression as its author wrote it, delimiters included — for an error, and for a plain-text copy (FR-050). */
export function mathLiteral(open: string | null, source: string): string {
  switch (open) {
    case '$`':
      return `$\`${source}\`$`;
    case '$$':
      return `$$${source}$$`;
    case 'fence':
      return `\`\`\`math\n${source.endsWith('\n') ? source : `${source}\n`}\`\`\``;
    default:
      return `$${source}$`;
  }
}

/** The literal of a drawn or refused expression element. */
export function mathLiteralOf(el: Element): string {
  if (el.hasAttribute(MATH_ERROR_ATTRIBUTE)) return el.textContent ?? '';
  return mathLiteral(el.getAttribute(MATH_OPEN_ATTRIBUTE), el.getAttribute(MATH_SOURCE_ATTRIBUTE) ?? el.textContent ?? '');
}
