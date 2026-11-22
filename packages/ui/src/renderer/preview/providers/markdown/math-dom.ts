/**
 * What the Markdown body needs to know about maths placeholders without loading the typesetter (075, FR-046).
 * `math-typeset.ts`, which imports KaTeX and its stylesheet, is reached only by `import()` once {@link hasMath}
 * says a draw needs it. The attribute names live in the provider-agnostic `math-host.ts`.
 */
import { MATH_ATTRIBUTE, MATH_ERROR_ATTRIBUTE, MATH_PENDING_ATTRIBUTE, MATH_SOURCE_ATTRIBUTE, MATH_TYPESET_ATTRIBUTE } from '../../math-host.js';
import { loadingPlaceholder } from '../../loading-placeholder.js';

export { MATH_ERROR_ATTRIBUTE, MATH_PENDING_ATTRIBUTE, MATH_SOURCE_ATTRIBUTE, MATH_TYPESET_ATTRIBUTE, mathLiteral, mathLiteralOf } from '../../math-host.js';

const UNDRAWN = `[${MATH_ATTRIBUTE}]:not([${MATH_TYPESET_ATTRIBUTE}]):not([${MATH_ERROR_ATTRIBUTE}])`;

/** Whether `root` holds any maths placeholder not yet typeset or refused. */
export function hasMath(root: ParentNode): boolean {
  return root.querySelector(UNDRAWN) !== null;
}

/**
 * 075 FR-043a — put the shared loading placeholder in the place of every expression the typesetter has yet to draw,
 * keeping its source in `data-math-source`: inline for an inline expression, a block for a displayed one.
 */
export function showMathPending(root: ParentNode, busyIcon: string): void {
  let inline: HTMLElement | null = null;
  let block: HTMLElement | null = null;
  for (const el of root.querySelectorAll<HTMLElement>(`${UNDRAWN}:not([${MATH_PENDING_ATTRIBUTE}])`)) {
    const display = el.getAttribute(MATH_ATTRIBUTE) === 'display';
    const template = display
      ? (block ??= loadingPlaceholder(el.ownerDocument, { label: 'Typesetting equation', busyIcon, block: true }))
      : (inline ??= loadingPlaceholder(el.ownerDocument, { label: 'Typesetting equation', busyIcon, block: false }));
    el.setAttribute(MATH_SOURCE_ATTRIBUTE, el.textContent ?? '');
    el.setAttribute(MATH_PENDING_ATTRIBUTE, '');
    el.replaceChildren(template.cloneNode(true));
  }
}
