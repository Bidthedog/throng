/**
 * Markdown text → one HTML string → the injected sanitiser (044, FR-080, FR-081, FR-086,
 * contracts/security-policy.md Layer 1, research R1, R5, R11).
 *
 * ══ REACHED ONLY BY DYNAMIC IMPORT ══
 *
 * `markdown-it` rides in the lazily loaded `preview` chunk (`vite.config.ts`). A static import of this
 * module from anything the app loads at startup folds that chunk into the eager graph and every user
 * pays for a Markdown parser before opening a preview. The panel imports it with `import()`.
 *
 * ══ THE SANITISER IS A PARAMETER, NOT AN IMPORT ══
 *
 * The pipeline never returns markdown-it's HTML: `render` hands it to the sanitiser it was built with and
 * returns whatever that produces. Injecting it is what lets a node unit test prove the call happens
 * exactly once, with markdown-it's output (FR-081 "a test MUST assert the sanitiser is in the path"),
 * and keeps DOMPurify — which needs a DOM — out of this module.
 *
 * What the rules below add to markdown-it's default output, all as attributes the sanitiser's profile
 * names and nothing else:
 *
 * - `data-source-line` on every block element — markdown-it's 0-based `token.map[0]` plus the front
 *   matter's line offset, so it is always the DOCUMENT's line. The scroll anchor and the history view
 *   state find blocks by it (R11).
 * - `data-heading-slug` on every heading, from core's `headingSlug` over the heading's RENDERED text
 *   (`headingText`, T178) with one de-duplicating set per render — NEVER an `id`, so a document has nothing to clobber a DOM global with (R2). The slug for
 *   each heading line is handed to the sanitiser too, with this render's random `data-heading-nonce`
 *   carried on each heading the pipeline emitted, so its heading hook can refuse a slug the pipeline did
 *   not generate — even one raw HTML copied onto a real heading's line (Layer 2, T096, fix round 1).
 * - `data-align` in place of the `style="text-align:…"` markdown-it puts on aligned cells, which the
 *   sanitiser would strip along with the alignment.
 * - fences as `<pre><code data-lang="…">escaped</code></pre>` with no highlight callback: highlighting
 *   happens after sanitising, on the inserted DOM, so no highlighter ever produces an HTML string (R5).
 *   Every code block — a fence, an invalid front matter block, a nested front matter value — is drawn by
 *   the one `renderFence(info, code)`, which is where #392 (Mermaid) will slot in.
 * - a leading `[ ]` / `[x]` in a list item as a DISABLED checkbox (R1 — an in-repo rule, not an
 *   unmaintained plugin in a security-sensitive path).
 *
 * ══ FRONT MATTER (FR-085, R4) ══
 *
 * Core's `splitFrontMatter` decides where the block is; `yaml.parseDocument` decides what it is. A
 * mapping becomes a key/value table — scalars as text, anything nested as its own YAML SOURCE, sliced
 * from the document by the parser's ranges rather than re-serialised, so a value reads exactly as its
 * author wrote it. Anything else — invalid YAML, a sequence, a bare scalar — is a code block of the
 * source. Never a notice: front matter a reader cannot parse is still content they wrote. Every string
 * is escaped here and then sanitised with everything else (FR-081).
 *
 * With the provider's Show front matter setting off (FR-117) the block produces nothing, valid or not, and
 * the body is still offset by its lines.
 *
 * `yaml` rides in the lazy `preview` chunk with markdown-it (`vite.config.ts`), which is why it is
 * imported here and nowhere the app loads eagerly.
 */
import MarkdownIt from 'markdown-it';
import type { Env, MarkdownIt as MarkdownItInstance, StateCore, Token } from 'markdown-it';
import { isMap, isScalar, parseDocument, Scalar, type Node as YamlNode } from 'yaml';
import { headingSlug, splitFrontMatter } from '@throng/core';

/**
 * The document a render is FOR — what the sanitiser's link and image hooks resolve against
 * (contracts/security-policy.md Layer 2). Absent, every relative link is inert and every image blocked:
 * a render that does not know where it is can resolve nothing safely.
 */
export interface RenderEnvironment {
  /** The preview panel, for `throng-preview://asset/<panelId>/…`. */
  readonly panelId: string;
  /** The previewed file: relative references resolve against its folder. */
  readonly docPath: string;
  /** The project root: nothing outside it is linked or loaded (Principle I). */
  readonly projectRoot: string;
  /** The provider's *Load remote images* setting, as it stands now (FR-092). */
  readonly remoteImages: boolean;
  /**
   * The provider's *Show front matter* setting (FR-117). `false`: the block is not shown at all — no table,
   * no code block, never handed to markdown-it — and the body keeps its line offset. Omitted means shown.
   */
  readonly frontMatter?: boolean;
}

/** What the pipeline knows about a render that the sanitiser's hooks need. */
export interface PipelineContext {
  /** The slug the pipeline generated for each heading, by that heading's `data-source-line`. */
  readonly headingSlugs: ReadonlyMap<number, string>;
  /**
   * This render's random token, carried on every heading the PIPELINE emitted as `data-heading-nonce`.
   * Raw HTML in the document cannot know it, so the heading hook keeps a slug only on an element that
   * carries it — and removes the attribute from every element (fix round 1).
   */
  readonly headingNonce: string;
  /** The document this render is for; `undefined` resolves nothing (see {@link RenderEnvironment}). */
  readonly environment?: RenderEnvironment;
}

/**
 * Turns markdown-it's HTML into something safe to show. Called exactly once per render.
 *
 * Generic so a node test can inject a spy. The app does not call `createMarkdownPipeline` directly: it
 * uses `createMarkdownRenderer` (`markdown-renderer.ts`), whose type admits only a `DocumentFragment`.
 */
export type Sanitiser<R> = (html: string, context: PipelineContext) => R;

export interface MarkdownPipeline<R> {
  /** The configured markdown-it instance. Exposed for tests; the app calls `render`. */
  readonly md: MarkdownItInstance;
  /** Render a whole document — front matter included — for `environment` (see {@link RenderEnvironment}). */
  render(text: string, environment?: RenderEnvironment): R;
}

/** Per-render state, kept in markdown-it's `env` so a render never sees the previous one's slugs. */
interface RenderState {
  readonly taken: Set<string>;
  readonly headingSlugs: Map<number, string>;
  readonly lineOffset: number;
  readonly nonce: string;
}

const RENDER_STATE = Symbol('throng.preview.render-state');

/** 64 random bits as hex — no colon, so the sanitiser's URI test on data attributes admits it. */
function newNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function renderState(env: Env, lineOffset = 0): RenderState {
  const existing = env[RENDER_STATE] as RenderState | undefined;
  if (existing) return existing;
  const created: RenderState = { taken: new Set(), headingSlugs: new Map(), lineOffset, nonce: newNonce() };
  env[RENDER_STATE] = created;
  return created;
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * THE code block (the #392 slot): `<code data-lang="…">escaped</code>`, for a caller to wrap in `<pre>`.
 *
 * `data-lang` is the first word of the info string, cut at its first colon. `ts:line-numbers` is `ts`: the
 * sanitiser tests every data attribute against ALLOWED_URI_REGEXP, whose `[^:]*$` would remove a
 * `data-lang` with a colon outright. `languageForFenceInfo` in core resolves the word it is given.
 */
export function renderFence(info: string, code: string): string {
  const lang = (info.trim().split(/\s+/)[0] ?? '').split(':')[0];
  return `<code data-lang="${escapeHtml(lang)}">${escapeHtml(code)}</code>`;
}

/**
 * `source[range]`, with the indentation of the value's first line removed from every later line.
 *
 * Trailing whitespace goes with `trimEnd()`, never `/\s+$/`: that regex is unanchored at its start, so on a
 * value with a long run of spaces NOT at its end it retries from every space in the run — quadratic, and a
 * 100,000-space front matter value held the renderer for ten seconds (adversarial review I1).
 */
function sliceValue(source: string, node: YamlNode): string {
  const range = node.range;
  if (!range) return '';
  const [start, end] = range;
  const column = start - (source.lastIndexOf('\n', start - 1) + 1);
  const indent = new RegExp(`^[ \\t]{0,${column}}`);
  return source
    .slice(start, end)
    .split(/\r\n|\n|\r/)
    .map((line, i) => (i === 0 ? line : line.replace(indent, '')))
    .join('\n')
    .trimEnd();
}

/** A scalar as text — as written when plain, its value when quoted or a block scalar. */
function scalarText(source: string, node: Scalar): string {
  if (node.type === Scalar.PLAIN) return sliceValue(source, node);
  return node.value === null || node.value === undefined ? '' : String(node.value);
}

/** One table cell's content: a scalar as text, anything else as its YAML source in a code block. */
function yamlCell(source: string, node: unknown): string {
  if (node === null || node === undefined) return '';
  if (isScalar(node)) return escapeHtml(scalarText(source, node));
  return `<pre>${renderFence('yaml', sliceValue(source, node as YamlNode))}</pre>`;
}

/**
 * The front matter block as HTML (FR-085): a key/value table for a mapping, a code block for anything
 * else. Anchored at document line 0, which is where the block starts.
 *
 * `raw` is normalised to LF FIRST, because this is the one part of the document markdown-it never sees.
 * Its `normalize` core rule folds `\r\n` and a lone `\r` to `\n` before it parses, so the body has never
 * carried a carriage return into the HTML; the block is sliced out ahead of that by core's
 * `splitFrontMatter`, whose source is a faithful slice of the file (deliberately — `front-matter.test.ts`
 * pins it), and rendered here. Doing the same thing to it costs one pass and buys two:
 *
 * - `yaml.parseDocument` reads `\r\n` as a line break but NOT a lone `\r`, so a document saved with
 *   classic-Mac endings parsed as one long scalar and lost its table to a code block of mangled source.
 * - The HTML string is then the same whatever the author's editor writes, which is what lets a unit test
 *   assert on it and get the same answer on a Windows checkout and a Linux one.
 */
function renderFrontMatter(raw: string): string {
  const source = raw.replace(/\r\n?/g, '\n');
  if (source.trim().length === 0) return '';
  const asCode = `<pre data-source-line="0">${renderFence('yaml', source)}</pre>\n`;
  try {
    const doc = parseDocument(source, { prettyErrors: false });
    const root = doc.contents;
    if (doc.errors.length > 0 || !isMap(root)) return asCode;
    const rows = root.items
      .map((pair) => {
        const key = isScalar(pair.key) ? escapeHtml(scalarText(source, pair.key)) : yamlCell(source, pair.key);
        return `<tr><th>${key}</th><td>${yamlCell(source, pair.value)}</td></tr>`;
      })
      .join('');
    return `<table data-source-line="0"><tbody>${rows}</tbody></table>\n`;
  } catch {
    // A parser that THROWS — pathological nesting, a library defect — is front matter that could not be
    // read, and FR-085 says what that is: its source as code. Never a failure of the whole document.
    return asCode;
  }
}

/** Self-closing block tokens that still render an element worth anchoring. */
const ANCHORED_LEAVES = new Set(['hr', 'fence', 'code_block']);

const TASK_MARKER = /^\[([ xX])\](?:\s|$)/;

const ALIGNMENT = /^text-align:(left|center|right)$/;

/**
 * `- [ ] todo` → a disabled checkbox followed by `todo`.
 *
 * The marker is read from the inline token's RAW source, not from its first text child. This rule runs
 * after `text_join`, which has already folded an escape into plain text — so `- \[x] literal` has a text
 * child reading `[x] literal`, and matching there would turn a marker the author escaped into a checked
 * box. The raw content still reads `\[x]`, which does not match.
 */
function taskLists(state: StateCore): void {
  const { tokens } = state;
  for (let i = 2; i < tokens.length; i += 1) {
    const inline = tokens[i];
    if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') {
      continue;
    }
    const marker = TASK_MARKER.exec(inline.content);
    if (!marker) continue;
    const first = inline.children?.[0];
    if (!first || first.type !== 'text' || !first.content.startsWith(marker[0])) continue;

    first.content = first.content.slice(marker[0].length);
    inline.content = inline.content.slice(marker[0].length);
    const checkbox = new state.Token('throng_task_checkbox', 'input', 0);
    checkbox.meta = { checked: marker[1] !== ' ' };
    inline.children?.unshift(checkbox);
  }
}

/**
 * A heading's RENDERED text — what the reader sees — from its inline token's children (044 T178,
 * FR-090b, FR-090f). `## [Foo](bar.md) baz` is "Foo baz", `## <a name="x"></a>Install` is "Install",
 * `## _Note_` is "Note", and an image contributes nothing, because an image is not text on screen.
 *
 * Only the tokens that PRODUCE text count: `text` (entities and escapes already resolved by `text_join`)
 * and `code_inline` (its content verbatim). Link, emphasis and raw-HTML tokens produce markup, and are
 * skipped — their text arrives as their own `text` children. Line breaks become newlines, and the lines
 * are then trimmed and joined by a space, exactly as core's `markdownInlineText` + `markdownHeadingLine`
 * do for the same heading, so the preview's slug and the editor's caret line agree (FR-090d).
 *
 * An inline token with no children at all (nothing markdown-it produces today) falls back to its source.
 */
function headingText(inline: Token | undefined): string {
  const children = inline?.children ?? null;
  let text: string;
  if (children === null) {
    text = inline?.content ?? '';
  } else {
    let out = '';
    for (const token of children) {
      if (token.type === 'text' || token.type === 'code_inline' || token.type === 'text_special') out += token.content;
      else if (token.type === 'softbreak' || token.type === 'hardbreak') out += '\n';
    }
    text = out;
  }
  return text
    .split('\n')
    .map((line) => line.trim())
    .join(' ');
}

function blockAttributes(state: StateCore): void {
  const render = renderState(state.env);
  const { tokens } = state;
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];

    if (token.type === 'th_open' || token.type === 'td_open') {
      const style = token.attrGet('style');
      if (style !== null) {
        token.attrs = token.attrs?.filter(([name]) => name !== 'style') ?? null;
        const align = ALIGNMENT.exec(String(style));
        if (align) token.attrSet('data-align', align[1]);
      }
    }

    if (!token.block || !token.map || !(token.nesting === 1 || ANCHORED_LEAVES.has(token.type))) continue;
    const line = token.map[0] + render.lineOffset;
    token.attrSet('data-source-line', line);

    if (token.type === 'heading_open') {
      const slug = headingSlug(headingText(tokens[i + 1]), render.taken);
      token.attrSet('data-heading-slug', slug);
      token.attrSet('data-heading-nonce', render.nonce);
      render.headingSlugs.set(line, slug);
    }
  }
}

function createMarkdownIt(): MarkdownItInstance {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });

  md.core.ruler.push('throng_task_lists', taskLists);
  md.core.ruler.push('throng_block_attributes', blockAttributes);

  md.renderer.rules.throng_task_checkbox = (tokens, idx) =>
    tokens[idx].meta?.checked === true ? '<input type="checkbox" checked disabled>' : '<input type="checkbox" disabled>';

  md.renderer.rules.fence = (tokens, idx, _options, _env, renderer) => {
    const token = tokens[idx];
    return `<pre${renderer.renderAttrs(token)}>${renderFence(md.utils.unescapeAll(token.info), token.content)}</pre>\n`;
  };

  return md;
}

export function createMarkdownPipeline<R>(sanitise: Sanitiser<R>): MarkdownPipeline<R> {
  const md = createMarkdownIt();
  return {
    md,
    render(text: string, environment?: RenderEnvironment): R {
      const { source, body, bodyLineOffset } = splitFrontMatter(text);
      const env: Env = {};
      // The body keeps the offset whether or not the block is shown, so its lines stay the document's (FR-117).
      const state = renderState(env, bodyLineOffset);
      const showBlock = source !== null && environment?.frontMatter !== false;
      const html = (showBlock ? renderFrontMatter(source) : '') + md.render(body, env);
      return sanitise(html, {
        headingSlugs: state.headingSlugs,
        headingNonce: state.nonce,
        ...(environment !== undefined ? { environment } : {}),
      });
    },
  };
}
