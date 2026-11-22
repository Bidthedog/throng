/**
 * Callouts in the Markdown pipeline (075, FR-001 – FR-006, FR-012, FR-013, FR-016, research R1,
 * contracts/callout-markup.md).
 *
 * ══ THE PACKAGE IS A PARSER, NOTHING MORE ══
 *
 * `markdown-it-obsidian-callouts` decides WHICH blockquotes are callouts and splits the marker into a type, a
 * fold sign and a title, leaving them as attributes on the `callout_open` token it retypes. The rule below
 * then rewrites every such token into throng's own tokens, resolving the type through core's registry, and
 * throng's renderer rules draw them. None of the package's markup, classes, icons, type list or
 * `data-callout` value (an alias as written) reaches the HTML.
 *
 * ══ ADMONITION FENCES STAY CODE (FR-016) ══
 *
 * The package also turns ` ```ad-<type> ` fences into callouts, inside the same core rule. A rule BEFORE it
 * retypes those fences so it does not see them, and the rule after it types them back, so they render through
 * the ordinary fence rule exactly as before this feature.
 *
 * ══ THE TITLE IS REAL INLINE CONTENT ══
 *
 * The title travels as an `inline` token, so markdown-it's own inline pass parses it with this render's `env`:
 * a wikilink in a title is registered in document order like any other, and its text is the DOM's to find.
 */
import calloutsPlugin from 'markdown-it-obsidian-callouts';
import type { Env, MarkdownIt as MarkdownItInstance, StateCore, Token } from 'markdown-it';
import { calloutTitle, calloutTypeEntry, resolveCalloutType } from '@throng/core';
import {
  CALLOUT_ATTRIBUTE,
  CALLOUT_BODY_ATTRIBUTE,
  CALLOUT_FOLD_ATTRIBUTE,
  CALLOUT_ICON_ATTRIBUTE,
  CALLOUT_ROLE_ATTRIBUTE,
  CALLOUT_TITLE_ATTRIBUTE,
  CALLOUT_TITLE_TEXT_ATTRIBUTE,
} from './callout-markup.js';

export interface CalloutRuleOptions {
  /** This render's nonce (the pipeline's), carried on every callout it emits so the sanitiser can tell them from raw HTML. */
  readonly nonceOf: (env: Env) => string;
}

const HELD_FENCE = 'throng_fence_hold';
const ADMONITION_INFO = /^ad-/;

function holdAdmonitionFences(state: StateCore): void {
  for (const token of state.tokens) {
    if (token.type === 'fence' && ADMONITION_INFO.test(token.info.trim())) token.type = HELD_FENCE;
  }
}

/** A first paragraph emptied by the marker's removal — `[!warning]` alone, or a marker and title only (FR-003). */
function dropEmptyLeadParagraph(tokens: Token[], openIdx: number): void {
  const [p, inline, close] = [tokens[openIdx + 1], tokens[openIdx + 2], tokens[openIdx + 3]];
  if (p?.type === 'paragraph_open' && inline?.type === 'inline' && close?.type === 'paragraph_close' && inline.content.trim() === '') {
    tokens.splice(openIdx + 1, 3);
  }
}

/** The index of the `callout_close` matching the `callout_open` at `openIdx`. */
function matchingClose(tokens: Token[], openIdx: number): number {
  let depth = 0;
  for (let i = openIdx; i < tokens.length; i += 1) {
    const type = tokens[i].type;
    if (type === 'callout_open' || type === 'blockquote_open' || type === 'throng_callout_open') depth += 1;
    else if (type === 'callout_close' || type === 'blockquote_close' || type === 'throng_callout_close') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return tokens.length - 1;
}

function rewriteCallouts(state: StateCore, options: CalloutRuleOptions): void {
  const { tokens } = state;
  for (const token of tokens) if (token.type === HELD_FENCE) token.type = 'fence';

  for (let i = 0; i < tokens.length; i += 1) {
    const open = tokens[i];
    if (open.type !== 'callout_open') continue;
    const written = String(open.attrGet('data-callout') ?? '');
    const sign = String(open.attrGet('data-callout-fold') ?? '');
    const title = open.attrGet('data-callout-title');

    dropEmptyLeadParagraph(tokens, i);
    const closeIdx = matchingClose(tokens, i);
    const close = tokens[closeIdx];
    const hasBody = closeIdx > i + 1;

    open.type = 'throng_callout_open';
    open.tag = 'div';
    const id = resolveCalloutType(written).id;
    open.attrs = [[CALLOUT_ATTRIBUTE, id], [CALLOUT_ROLE_ATTRIBUTE, calloutTypeEntry(id)?.role ?? 'neutral']];
    if (sign === '+') open.attrSet(CALLOUT_FOLD_ATTRIBUTE, 'open');
    else if (sign === '-') open.attrSet(CALLOUT_FOLD_ATTRIBUTE, 'closed');
    open.attrSet('data-heading-nonce', options.nonceOf(state.env));
    close.type = 'throng_callout_close';
    close.tag = 'div';
    close.attrs = null;

    const titleOpen = new state.Token('throng_callout_title_open', 'div', 1);
    const titleInline = new state.Token('inline', '', 0);
    titleInline.content = calloutTitle(written, title === null ? undefined : String(title));
    titleInline.children = [];
    titleInline.map = open.map;
    const titleClose = new state.Token('throng_callout_title_close', 'div', -1);
    const inserted: Token[] = [titleOpen, titleInline, titleClose];
    if (hasBody) inserted.push(new state.Token('throng_callout_body_open', 'div', 1));
    tokens.splice(i + 1, 0, ...inserted);
    // The close moved by what was inserted before it.
    if (hasBody) tokens.splice(closeIdx + inserted.length, 0, new state.Token('throng_callout_body_close', 'div', -1));
  }
}

export function installCallouts(md: MarkdownItInstance, options: CalloutRuleOptions): void {
  md.use(calloutsPlugin);
  md.core.ruler.before('obsidian-callouts', 'throng_callout_fence_hold', holdAdmonitionFences);
  md.core.ruler.after('obsidian-callouts', 'throng_callouts', (state) => rewriteCallouts(state, options));

  md.renderer.rules.throng_callout_open = (tokens, idx, _options, _env, renderer) => `<div${renderer.renderAttrs(tokens[idx])}>\n`;
  md.renderer.rules.throng_callout_close = () => '</div>\n';
  md.renderer.rules.throng_callout_title_open = () =>
    `<div ${CALLOUT_TITLE_ATTRIBUTE}><span ${CALLOUT_ICON_ATTRIBUTE}></span><span ${CALLOUT_TITLE_TEXT_ATTRIBUTE}>`;
  md.renderer.rules.throng_callout_title_close = () => '</span></div>\n';
  md.renderer.rules.throng_callout_body_open = () => `<div ${CALLOUT_BODY_ATTRIBUTE}>\n`;
  md.renderer.rules.throng_callout_body_close = () => '</div>\n';
  // The package's own renderer rules are never reached (every token they draw is retyped above); removing
  // them makes that a guarantee rather than an observation.
  delete md.renderer.rules.callout_open;
  delete md.renderer.rules.callout_close;
  delete md.renderer.rules.admonition_block;
}
