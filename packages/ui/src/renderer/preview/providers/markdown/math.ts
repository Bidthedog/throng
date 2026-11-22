/**
 * Maths in the Markdown pipeline (075, FR-040 – FR-042, FR-045, research R5, contracts/math-markup.md).
 *
 * Recognition only. The rules emit placeholders holding each expression's source as escaped text; the body
 * typesets them after sanitising (`preview/math/typeset.ts`), so no typesetter output is ever an HTML string
 * the document sanitiser has not seen, and a document with no maths never loads the typesetter (FR-046).
 *
 * WHERE maths starts and ends is core's `matchInlineMath` / `matchDisplayBlock`, GitHub's rules. The inline
 * rule runs before markdown-it's `escape`, so it is the first to see a `$`; a `\$` reaches `escape` first,
 * because the rule only starts at a `$`. Code spans and code blocks are tokenised before any of this and are
 * never offered to it.
 *
 * With **Typeset math** off (`enabled` false for the render) the rules match nothing and the `math` fence is an
 * ordinary code block: the output is exactly what 044 FR-086 rendered.
 */
import type { Env, MarkdownIt as MarkdownItInstance, StateBlock, StateInline, Token } from 'markdown-it';
import { matchDisplayBlock, matchInlineMath } from '@throng/core';
import { MATH_ATTRIBUTE, MATH_OPEN_ATTRIBUTE, MATH_OPENS } from '../../math-host.js';
import { escapeHtml } from '@throng/core';

export { MATH_ATTRIBUTE, MATH_OPEN_ATTRIBUTE, MATH_OPENS };

export interface MathRuleOptions {
  /** Whether this render typesets maths — the provider's Typeset math setting, carried with the render. */
  readonly enabled: (env: Env) => boolean;
}


function inlineRule(options: MathRuleOptions) {
  return (state: StateInline, silent: boolean): boolean => {
    if (state.src.charCodeAt(state.pos) !== 0x24 /* $ */ || !options.enabled(state.env)) return false;
    const match = matchInlineMath(state.src.slice(0, state.posMax), state.pos);
    if (match === null) return false;
    if (!silent) {
      const token = state.push('throng_math_inline', 'span', 0);
      token.content = match.source;
      token.markup = match.open;
    }
    state.pos = match.end;
    return true;
  };
}

function blockRule(options: MathRuleOptions) {
  return (state: StateBlock, startLine: number, endLine: number, silent: boolean): boolean => {
    if (!options.enabled(state.env)) return false;
    // Indented four or more: an indented code block, never maths.
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const lineAt = (line: number): string => state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]);
    if (!lineAt(startLine).startsWith('$$')) return false;
    const lines: string[] = [];
    for (let line = startLine; line < endLine; line += 1) lines.push(lineAt(line));
    const block = matchDisplayBlock(lines, 0);
    if (block === null) return false;
    if (silent) return true;
    const token = state.push('throng_math_block', 'div', 0);
    token.block = true;
    token.content = block.source;
    token.markup = '$$';
    token.map = [startLine, startLine + block.endLine + 1];
    state.line = startLine + block.endLine + 1;
    return true;
  };
}

/** A ```math fence as display maths, or `null` when this render does not typeset (it is then ordinary code). */
export function mathFenceHtml(token: Token, env: Env, options: MathRuleOptions, attrs: string): string | null {
  const lang = token.info.trim().split(/\s+/)[0] ?? '';
  if (lang !== 'math' || !options.enabled(env)) return null;
  return `<div ${MATH_ATTRIBUTE}="display" ${MATH_OPEN_ATTRIBUTE}="fence"${attrs}>${escapeHtml(token.content)}</div>\n`;
}

const MATH_MODES = new Set(['inline', 'display']);

/**
 * The render sanitiser's maths rule (contracts/math-markup.md §Sanitiser): `data-math` and `data-math-open`
 * stay only on a `span`/`div`, with values from their closed sets; anything else loses both. The expression
 * itself is the element's TEXT, which the sanitiser already passed as text.
 */
export function sanitiseMathAttributes(node: Element): void {
  const mode = node.getAttribute(MATH_ATTRIBUTE);
  const open = node.getAttribute(MATH_OPEN_ATTRIBUTE);
  if (mode === null && open === null) return;
  const tag = node.tagName.toUpperCase();
  if ((tag !== 'SPAN' && tag !== 'DIV') || mode === null || !MATH_MODES.has(mode) || open === null || !MATH_OPENS.includes(open)) {
    node.removeAttribute(MATH_ATTRIBUTE);
    node.removeAttribute(MATH_OPEN_ATTRIBUTE);
  }
}

export function installMath(md: MarkdownItInstance, options: MathRuleOptions): void {
  md.inline.ruler.before('escape', 'throng_math_inline', inlineRule(options));
  md.block.ruler.before('fence', 'throng_math_block', blockRule(options), { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.throng_math_inline = (tokens, idx) => {
    const token = tokens[idx];
    const mode = token.markup === '$$' ? 'display' : 'inline';
    return `<span ${MATH_ATTRIBUTE}="${mode}" ${MATH_OPEN_ATTRIBUTE}="${escapeHtml(token.markup)}">${escapeHtml(token.content)}</span>`;
  };
  md.renderer.rules.throng_math_block = (tokens, idx, _options, _env, renderer) => {
    const token = tokens[idx];
    return `<div ${MATH_ATTRIBUTE}="display" ${MATH_OPEN_ATTRIBUTE}="$$"${renderer.renderAttrs(token)}>${escapeHtml(token.content)}</div>\n`;
  };
}
