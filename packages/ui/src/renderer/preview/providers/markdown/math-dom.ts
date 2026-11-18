/**
 * What the Markdown body needs to know about maths placeholders without loading the typesetter (075, FR-046).
 * `math-typeset.ts`, which imports KaTeX and its stylesheet, is reached only by `import()` once {@link hasMath}
 * says a draw needs it. The attribute names live in the provider-agnostic `math-host.ts`.
 */
import { MATH_ATTRIBUTE, MATH_ERROR_ATTRIBUTE, MATH_TYPESET_ATTRIBUTE } from '../../math-host.js';

export { MATH_ERROR_ATTRIBUTE, MATH_SOURCE_ATTRIBUTE, MATH_TYPESET_ATTRIBUTE, mathLiteral, mathLiteralOf } from '../../math-host.js';

/** Whether `root` holds any maths placeholder not yet typeset or refused. */
export function hasMath(root: ParentNode): boolean {
  return root.querySelector(`[${MATH_ATTRIBUTE}]:not([${MATH_TYPESET_ATTRIBUTE}]):not([${MATH_ERROR_ATTRIBUTE}])`) !== null;
}
