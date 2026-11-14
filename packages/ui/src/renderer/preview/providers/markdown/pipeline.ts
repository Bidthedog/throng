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
 * - a leading `[ ]` / `[x]` in a list item as a checkbox (R1 — an in-repo rule, not an unmaintained
 *   plugin in a security-sensitive path) carrying `data-task-line`, the item's document line, and this
 *   render's nonce, so the preview can toggle it (054 R4, FR-020).
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
import { isMap, isScalar, isSeq, parseDocument, Scalar, type Node as YamlNode } from 'yaml';
import { headingSlug, scanLinkLine, splitFrontMatter, splitTrailingImageSize, type HeadingRecord, type ScanOptions } from '@throng/core';
import {
  FRONT_MATTER_LINK_ATTRIBUTE,
  encodeFrontMatterLink,
  type EditorPreviewLink,
  type PreviewLinkWording,
} from '../../link-dom.js';
import { decodeWikiHref, installWikilinks, WIKI_HREF_ATTRIBUTE, WIKI_INDEX_ATTRIBUTE } from './wikilinks.js';
import { installEmbeds } from './embeds.js';
import { DIAGRAM_HEIGHT_ATTRIBUTE, parseDiagramHeight } from '../../diagram/diagram-host.js';
import { logExpected } from '@throng/core';

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
  /**
   * 045 FR-168 (review round four, editor M2) — how a link's title words its destination, for the
   * sanitiser's `a` hook. The title is baked during the render pass, so the wording has to arrive
   * with the render; the plain-click hint words itself at the click. Absent: every in-project file
   * link reads as "open in throng preview".
   */
  readonly linkWording?: PreviewLinkWording;
  /**
   * 067 FR-132 — the editor's link-scan options (the protocol allowlist and known extensions), for the
   * FRONT MATTER table only: a scalar that is wholly a link in the editor's grammar is drawn as a link and
   * followed as the editor follows it. The body never reads it. Absent: the shipped defaults.
   */
  readonly linkScan?: ScanOptions;
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

/** One wikilink `render()` collected (047 T061/T063, R12) — enough for `main`'s `resolveWikiTargets`. */
export interface WikiHrefTarget {
  readonly path: string;
  readonly rooted: boolean;
}

/** What `render()` returns (047 T004/T005, T063): the sanitised content, this render's heading list, and its wikilinks. */
export interface MarkdownRenderResult<R> {
  readonly fragment: R;
  readonly headings: readonly HeadingRecord[];
  /** In document order, one per wikilink — index `i` is the `<a>` carrying `data-throng-wiki-index="i"` (`wikilinks.ts`). */
  readonly wikiTargets: readonly WikiHrefTarget[];
}

export interface MarkdownPipeline<R> {
  /** The configured markdown-it instance. Exposed for tests; the app calls `render`. */
  readonly md: MarkdownItInstance;
  /** Render a whole document — front matter included — for `environment` (see {@link RenderEnvironment}). */
  render(text: string, environment?: RenderEnvironment): MarkdownRenderResult<R>;
}

/** Per-render state, kept in markdown-it's `env` so a render never sees the previous one's slugs. */
interface RenderState {
  readonly taken: Set<string>;
  readonly headingSlugs: Map<number, string>;
  readonly headings: HeadingRecord[];
  readonly wikiTargets: WikiHrefTarget[];
  readonly lineOffset: number;
  readonly nonce: string;
  /** 067 FR-132 — the editor's link-scan options for the front matter table (see {@link RenderEnvironment.linkScan}). */
  readonly scan: ScanOptions | undefined;
}

const RENDER_STATE = Symbol('throng.preview.render-state');

/** 64 random bits as hex — no colon, so the sanitiser's URI test on data attributes admits it. */
function newNonce(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function renderState(env: Env, lineOffset = 0, scan?: ScanOptions): RenderState {
  const existing = env[RENDER_STATE] as RenderState | undefined;
  if (existing) return existing;
  const created: RenderState = {
    taken: new Set(),
    headingSlugs: new Map(),
    headings: [],
    wikiTargets: [],
    lineOffset,
    nonce: newNonce(),
    scan,
  };
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
  const [first, ...rest] = info.trim().split(/\s+/);
  const lang = (first ?? '').split(':')[0];
  // 054 FR-046m — `height=300` after the language sets a diagram's box height; only a valid one is carried.
  const height = parseDiagramHeight(rest.map((word) => /^height=(.*)$/.exec(word)?.[1]).find((v) => v !== undefined));
  const heightAttr = height === null ? '' : ` ${DIAGRAM_HEIGHT_ATTRIBUTE}="${height}"`;
  return `<code data-lang="${escapeHtml(lang)}"${heightAttr}>${escapeHtml(code)}</code>`;
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

/**
 * The inline HTML of `text` when it holds a link, or `null` when it holds none (067 FR-088, FR-090).
 *
 * Rendered by the BODY'S OWN markdown-it instance and `env`, so the links are the body's: the same rules
 * (linkify, Markdown links, wikilinks), the same scheme validation, and — because the whole render then
 * goes through the same sanitiser — the same markup, hover title and destination handling. The wikilinks
 * are registered with this render's list by the `throng_block_attributes` core rule, which `parseInline`
 * runs, so their indexes continue into the body in document order.
 *
 * `null` for a value with no link is what keeps it exactly as it was (FR-092): text, never run through
 * the inline rules, so `*emphasis*` in a plain title stays asterisks.
 */
function linkedInline(md: MarkdownItInstance, env: Env, text: string): string | null {
  if (text.length === 0) return null;
  /*
   * 067 FR-132 — a scalar that is WHOLLY one link in the editor's grammar. The sanitiser turns the marked
   * anchor into the preview's `editor` link, which is followed through the editor's own route, so a
   * position, a home, rooted or absolute path, a `file:` URI and an allowlisted protocol resolve as they
   * do in the editor. What the table already linked correctly (web, mailto, plain relative paths,
   * wikilinks) falls through to the rules below and is unchanged.
   */
  const render = renderState(env);
  const editorLink = editorLinkOf(text, render.scan);
  if (editorLink !== null) {
    return `<a ${FRONT_MATTER_LINK_ATTRIBUTE}="${encodeFrontMatterLink(editorLink, render.nonce)}">${escapeHtml(text)}</a>`;
  }
  if (isHeadingAnchor(text)) {
    const asLink = md.parseInline(`[${escapeInlineLabel(text)}](<${text.replace(/%/g, '%25')}>)`, env)[0]?.children;
    if (asLink?.some((token) => token.type === 'link_open')) return md.renderer.renderInline(asLink, md.options, env);
  }
  const children = md.parseInline(text, env)[0]?.children;
  const found = children?.some((token) => token.type === 'link_open') === true;
  /*
   * 067 FR-123 — a bare scalar that is a relative path to a file links like `[path](path)` in the body.
   * Decided on the text alone: the disk is never consulted, so a path to nothing links all the same.
   *
   * The linkifier gets the first word on anything it already claims (`example.com/docs` is a web link),
   * except a bare name whose extension is also a country domain (`overview.md`, `build.sh`): there the
   * author wrote a file.
   */
  if (relativePathOf(text) !== null && (!found || (!text.includes('/') && FILE_EXTENSIONS.has(extensionOf(text))))) {
    const asLink = md.parseInline(`[${escapeInlineLabel(text)}](<${text.replace(/%/g, '%25')}>)`, env)[0]?.children;
    if (asLink?.some((token) => token.type === 'link_open')) return md.renderer.renderInline(asLink, md.options, env);
  }
  if (!found || !children) return null;
  return md.renderer.renderInline(children, md.options, env);
}

/**
 * A same-document `#anchor` as the WHOLE value (067 FR-132). `#123` is left alone: that is the shorthand
 * for an issue reference, which the body does not resolve either and FR-090 keeps unlinked.
 */
const isHeadingAnchor = (text: string): boolean => /^#[^\s#]\S*$/.test(text) && !/^#\d+$/.test(text);

/**
 * A value with whitespace is a path only when it starts like one (`./`, `../`, `/`, `~/` or a drive
 * letter) and ends in a dotted extension, optionally followed by a position (067 FR-132's note). A
 * sentence with a path inside it stays text.
 */
const SPACED_PATH =
  /^(?:\.{1,2}\/|\/|~\/|[A-Za-z]:[\\/]).*\.[A-Za-z][A-Za-z0-9]*(?::\d+(?::\d+)?(?:-\d+)?|\(\d+,\d+\)|#L\d+(?:-L\d+)?)?$/;

/**
 * The editor link `text` is, when the WHOLE value is one span of the editor's grammar (`scanLinkLine`, the
 * scan the editor and the terminal read) that the table does not already link correctly — or `null`.
 *
 * Web links and mailto addresses are left to the rules that already draw them. A path with no position that
 * reads as a plain relative path is left to them too (067 FR-123), so those links stay exactly as they were.
 */
function editorLinkOf(text: string, scan: ScanOptions | undefined): EditorPreviewLink | null {
  if (text !== text.trim()) return null;
  if (/\s/.test(text) && !SPACED_PATH.test(text)) return null;
  const scanned = scanLinkLine(text, scan ?? {});
  const whole = (span: { start: number; end: number }): boolean => span.start === 0 && span.end === text.length;
  if (scanned.web.some(whole)) return null;
  const protocol = scanned.protocol.find(whole);
  if (protocol !== undefined) {
    return /^mailto:/i.test(protocol.uri) || !/^[A-Za-z][A-Za-z0-9+.-]*:/.test(text)
      ? null
      : { kind: 'editor', text: protocol.uri, protocol: true };
  }
  // The scan lists the positioned reading of a span first, as the editor takes it.
  const path = scanned.paths.find(whole);
  if (path === undefined) return null;
  if (path.position === undefined && relativePathOf(text) !== null) return null;
  return {
    kind: 'editor',
    text: path.text,
    ...(path.position === undefined
      ? {}
      : { position: { line: path.position.line, ...(path.position.column === undefined ? {} : { column: path.position.column }) } }),
  };
}

/** Extensions that name a file even where they are also a domain suffix. */
const FILE_EXTENSIONS: ReadonlySet<string> = new Set(
  'md markdown txt json yaml yml toml html htm css js mjs cjs ts tsx jsx py sh rs go java c h cpp cs rb php pdf png jpg jpeg gif svg csv xml log ini cfg conf zip'.split(' '),
);

const extensionOf = (text: string): string => /\.([A-Za-z][A-Za-z0-9]*)$/.exec(text)?.[1]?.toLowerCase() ?? '';

/**
 * The path in `text` when the WHOLE value reads as a relative path to a file: no whitespace, not a URL,
 * not absolute, and either holding a `/` or ending in a dotted extension that starts with a letter. A
 * markdown link's own punctuation disqualifies it (it would be read as one).
 */
function relativePathOf(text: string): string | null {
  if (/[\s<>[\]\\]/.test(text) || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) || /^[/~#]/.test(text)) return null;
  return text.includes('/') || extensionOf(text) !== '' ? text : null;
}

/** Punctuation that markdown would read inside a link's label, written literally. */
const escapeInlineLabel = (text: string): string => text.replace(/[\\`*_{}#+!|~&]/g, '\\$&');

/** One table cell's content: a scalar as text, anything else as its YAML source in a code block. */
function yamlCell(source: string, node: unknown, md: MarkdownItInstance, env: Env): string {
  if (node === null || node === undefined) return '';
  if (isScalar(node)) {
    const text = scalarText(source, node);
    return linkedInline(md, env, text) ?? escapeHtml(text);
  }
  /*
   * FR-089 — a sequence holding a link is a list, one item each, so every item links on its own. A
   * sequence with no link anywhere keeps the YAML source it has always been shown as (FR-092).
   */
  if (isSeq(node)) {
    const items = node.items.map((item) =>
      isScalar(item) ? { linked: linkedInline(md, env, scalarText(source, item)), item } : { linked: null, item },
    );
    if (items.some((i) => i.linked !== null)) {
      const lis = items
        .map(({ linked, item }) => {
          if (linked !== null) return `<li>${linked}</li>`;
          if (isScalar(item)) return `<li>${escapeHtml(scalarText(source, item))}</li>`;
          return `<li><pre>${renderFence('yaml', sliceValue(source, item as YamlNode))}</pre></li>`;
        })
        .join('');
      return `<ul>${lis}</ul>`;
    }
  }
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
function renderFrontMatter(raw: string, md: MarkdownItInstance, env: Env): string {
  const source = raw.replace(/\r\n?/g, '\n');
  if (source.trim().length === 0) return '';
  const asCode = `<pre data-source-line="0">${renderFence('yaml', source)}</pre>\n`;
  try {
    const doc = parseDocument(source, { prettyErrors: false });
    const root = doc.contents;
    if (doc.errors.length > 0 || !isMap(root)) return asCode;
    const rows = root.items
      .map((pair) => {
        // Keys stay plain text (FR-092): only a value is ever run through the link rules.
        const key = isScalar(pair.key) ? escapeHtml(scalarText(source, pair.key)) : yamlCell(source, pair.key, md, env);
        return `<tr><th>${key}</th><td>${yamlCell(source, pair.value, md, env)}</td></tr>`;
      })
      .join('');
    return `<table data-source-line="0"><tbody>${rows}</tbody></table>\n`;
  } catch (error) {
    logExpected('pipeline: parse front matter', 'the document\'s front matter may be pathological enough to throw the YAML parser; it is shown as code', error);
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
    const render = renderState(state.env);
    // 054 R4: the ITEM's line (its `list_item_open`), so a nested item names its own line, offset to
    // the document's like every `data-source-line`.
    const itemLine = tokens[i - 2].map?.[0];
    checkbox.meta = {
      checked: marker[1] !== ' ',
      line: itemLine === undefined ? null : itemLine + render.lineOffset,
      nonce: render.nonce,
    };
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

/**
 * 068 FR-066 — a standard image takes an image embed's size forms: a last `|W` / `|WxH` segment of its destination
 * (`![alt](path.png|200)`) or, failing that, of its alt text (`![alt|200](path.png)`) is removed from it and drawn
 * as `width`/`height`. The mark is this render's nonce: the sanitiser keeps a size only on an image carrying it
 * (a document's own `<img width>` carries none), and removes the nonce.
 */
function sizeStandardImage(state: StateCore, image: Token, nonce: string): void {
  let source = String(image.attrGet('src') ?? '');
  try {
    source = decodeURI(source); // markdown-it percent-encodes the destination; the segment is read as written
  } catch (error) {
    logExpected('pipeline: decode an image destination', 'the document may carry a malformed percent-escape; the destination is used as written', error);
    return;
  }
  let size = splitTrailingImageSize(source);
  if (size !== null) {
    image.attrSet('src', state.md.normalizeLink(size.rest));
  } else {
    const last = image.children?.at(-1);
    size = last?.type === 'text' ? splitTrailingImageSize(last.content) : null;
    if (size === null || last === undefined) return;
    last.content = size.rest;
    image.content = image.children?.map((c) => c.content).join('') ?? size.rest;
  }
  if (size.width !== null) image.attrSet('width', String(size.width));
  if (size.height !== null) image.attrSet('height', String(size.height));
  image.attrSet('data-heading-nonce', nonce);
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

    // 047 T061/T063 — every wikilink in this block's inline content, in document order. Decoded from
    // the attribute `wikilinks.ts` already built, never re-derived from the source: the pipeline's OWN
    // `throng_wikilinks` rule is the only thing that sets `WIKI_HREF_ATTRIBUTE` — an ORDINARY link
    // token carries none, so `attrGet` returning `null` (not an empty body) is what tells them apart.
    if (token.type === 'inline' && token.children) {
      for (const child of token.children) {
        if (child.type === 'image' && child.attrGet(WIKI_HREF_ATTRIBUTE) === null) sizeStandardImage(state, child, render.nonce);
        // 068 FR-011 — an image embed (`![[pic.png]]`, `embeds.ts`) is resolved through the same batch.
        if (child.type !== 'link_open' && child.type !== 'image') continue;
        const body = child.attrGet(WIKI_HREF_ATTRIBUTE);
        if (body === null) continue;
        const decoded = decodeWikiHref(String(body));
        if (decoded === null) continue;
        child.attrSet(WIKI_INDEX_ATTRIBUTE, String(render.wikiTargets.length));
        render.wikiTargets.push(decoded);
      }
    }

    if (!token.block || !token.map || !(token.nesting === 1 || ANCHORED_LEAVES.has(token.type))) continue;
    const line = token.map[0] + render.lineOffset;
    token.attrSet('data-source-line', line);

    if (token.type === 'heading_open') {
      const text = headingText(tokens[i + 1]);
      const slug = headingSlug(text, render.taken);
      token.attrSet('data-heading-slug', slug);
      token.attrSet('data-heading-nonce', render.nonce);
      render.headingSlugs.set(line, slug);
      // `token.tag` is 'h1'..'h6' for both ATX and setext headings — markdown-it never produces another.
      const level = Number(token.tag.slice(1)) as HeadingRecord['level'];
      render.headings.push({ level, text, slug, line });
    }
  }
}

function createMarkdownIt(): MarkdownItInstance {
  const md = new MarkdownIt({ html: true, linkify: true, typographer: false, breaks: false });

  installWikilinks(md);
  // 054 — `![[x.mmd]]` / `![alt](x.mmd)` Mermaid embeds (embeds.ts).
  installEmbeds(md);
  md.core.ruler.push('throng_task_lists', taskLists);
  md.core.ruler.push('throng_block_attributes', blockAttributes);

  // 054 FR-020 (supersedes 044 FR-080's disabled box): enabled, carrying the item's source line and this
  // render's nonce — the sanitiser keeps the line only on a box carrying the nonce, and removes the nonce.
  md.renderer.rules.throng_task_checkbox = (tokens, idx) => {
    const meta = tokens[idx].meta as { checked: boolean; line: number | null; nonce: string } | undefined;
    const line = meta?.line === null || meta?.line === undefined ? '' : ` data-task-line="${meta.line}" data-task-nonce="${meta.nonce}"`;
    return `<input type="checkbox"${line}${meta?.checked === true ? ' checked' : ''}>`;
  };

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
    render(text: string, environment?: RenderEnvironment): MarkdownRenderResult<R> {
      const { source, body, bodyLineOffset } = splitFrontMatter(text);
      const env: Env = {};
      // The body keeps the offset whether or not the block is shown, so its lines stay the document's (FR-117).
      const state = renderState(env, bodyLineOffset, environment?.linkScan);
      const showBlock = source !== null && environment?.frontMatter !== false;
      const html = (showBlock ? renderFrontMatter(source, md, env) : '') + md.render(body, env);
      const fragment = sanitise(html, {
        headingSlugs: state.headingSlugs,
        headingNonce: state.nonce,
        ...(environment !== undefined ? { environment } : {}),
      });
      return { fragment, headings: state.headings, wikiTargets: state.wikiTargets };
    },
  };
}
