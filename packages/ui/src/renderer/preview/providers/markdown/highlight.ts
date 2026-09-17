/**
 * Syntax highlighting for fenced code in a rendered preview (044, FR-080, FR-083, FR-086,
 * contracts/security-policy.md Layer 1, research R5).
 *
 * ══ AFTER INSERTION, AS DOM ══
 *
 * The pipeline emits every fence as escaped text in `<pre><code data-lang>`, the sanitiser passes it,
 * and only then — on the inserted element — does this run. It parses the element's `textContent` with the
 * EDITOR's grammar for that language (`languageForFenceInfo` → `loadLanguage`, the same registry and
 * loaders an editor uses) and rebuilds the element's children from text nodes and `<span>`s made with
 * `createElement` / `textContent`. No highlighter output is ever a string of markup, so there is no
 * second parse of text the document controls (Layer 1's last line).
 *
 * ══ THE EDITOR'S STYLE, SO A THEME CHANGE NEEDS NOTHING ══
 *
 * Spans carry `throngHighlightStyle`'s classes, whose rules name only `var(--throng-colour-syntax*)`.
 * A theme change rewrites the variables and the code repaints — no re-render, no re-highlight (FR-083).
 * The style's module is mounted on the document here, because a preview can be the only thing on screen
 * that uses it.
 *
 * ══ WHAT STAYS PLAIN ══
 *
 * A fence the registry does not know — `mermaid` included, which is exactly what FR-086 asks for — and
 * any single line longer than the editor's `LONG_LINE_THRESHOLD`, which the editor also leaves plain
 * (016 FR-008a): the rest of that block still highlights.
 *
 * Reached only from the Markdown body, which is itself loaded by dynamic import.
 */
import { highlightCode } from '@lezer/highlight';
import { StyleModule } from 'style-mod';
import { languageForFenceInfo } from '@throng/core';
import { LONG_LINE_THRESHOLD, throngHighlightStyle } from '../../../editor/highlight-style.js';
import { loadLanguage } from '../../../editor/language-loaders.js';

/** Set on a code element once it has been highlighted, so a second pass leaves it alone. */
const DONE = 'data-highlighted';

/**
 * The most fenced-code characters highlighted in one DOCUMENT. Blocks are highlighted in document order
 * until their running total would pass it; that block and every later one stay plain. A single block over
 * it stays plain on its own.
 *
 * The editor bounds highlighting by its VIEWPORT: it only ever paints what is visible, however large the
 * file. A preview has no viewport to lean on — it highlights every block, on every live update of a
 * parented preview — so it needs a bound of its own, and this is it. 100k characters is several thousand
 * lines of ordinary code, far beyond the fences anyone reads in a README, and small enough that a pasted
 * bundle or log costs nothing on each keystroke.
 *
 * Per document, not per block (adversarial review M2): a per-block bound let ninety fences of 99k
 * characters each be highlighted in full on every render.
 *
 * FIXED, like the editor's `LONG_LINE_THRESHOLD`, for the same reason: a descriptor, a preferences row
 * and completeness coverage for a knob with no user value. Recorded as a Principle X deviation in the
 * plan's Complexity Tracking.
 */
export const HIGHLIGHT_BUDGET_CHARS = 100_000;

const mounted = new WeakSet<Document>();

/**
 * One `LanguageSupport` per language id for the life of the window. Without it every render re-imported
 * the grammar per block and rebuilt a StreamLanguage mode each time, so a parented preview flashed plain
 * code on each live update while the grammar came back. A failed load is forgotten, so it is retried.
 */
const supports = new Map<string, Promise<Awaited<ReturnType<typeof loadLanguage>>>>();

function supportFor(languageId: string): Promise<Awaited<ReturnType<typeof loadLanguage>>> {
  let support = supports.get(languageId);
  if (!support) {
    support = loadLanguage(languageId).catch((error: unknown) => {
      supports.delete(languageId);
      throw error;
    });
    supports.set(languageId, support);
  }
  return support;
}

function mountStyle(doc: Document): void {
  if (mounted.has(doc) || !throngHighlightStyle.module) return;
  StyleModule.mount(doc, throngHighlightStyle.module);
  mounted.add(doc);
}

/** Append `text` to `into`, in a span with `classes` when there are any. */
function put(into: DocumentFragment, doc: Document, text: string, classes: string): void {
  if (text.length === 0) return;
  if (classes.length === 0) {
    into.append(doc.createTextNode(text));
    return;
  }
  const span = doc.createElement('span');
  span.className = classes;
  span.textContent = text;
  into.append(span);
}

/**
 * Highlight one `<code data-lang>` element in place. Resolves `true` when it was highlighted, `false`
 * when it stays plain (unknown language, a grammar that failed to load, already done).
 */
export async function highlightCodeElement(code: HTMLElement): Promise<boolean> {
  if (code.hasAttribute(DONE)) return false;
  // Over budget: plain, and no grammar is even fetched for it.
  if ((code.textContent ?? '').length > HIGHLIGHT_BUDGET_CHARS) return false;
  const languageId = languageForFenceInfo(code.getAttribute('data-lang') ?? '');
  let support: Awaited<ReturnType<typeof loadLanguage>>;
  try {
    support = await supportFor(languageId);
  } catch {
    // A grammar chunk that did not arrive leaves the code readable, as plain text.
    return false;
  }
  if (support === null || !code.isConnected || code.hasAttribute(DONE)) return false;

  const text = code.textContent ?? '';
  const doc = code.ownerDocument;
  const tree = support.language.parser.parse(text);
  const out = doc.createDocumentFragment();

  /*
   * ONE `highlightCode` pass per run of ordinary lines. Lezer's range highlighter walks the tree from the
   * top for every call, so a call per line cost lines × siblings on every render; a long line splits the
   * block into ranges only where one actually is. A line over `LONG_LINE_THRESHOLD` is put as plain text
   * between them (016 FR-008a).
   */
  const lines = text.split('\n');
  let offset = 0;
  let rangeStart = -1;
  const flush = (end: number): void => {
    if (rangeStart < 0) return;
    highlightCode(
      text,
      tree,
      throngHighlightStyle,
      (piece, classes) => put(out, doc, piece, classes),
      () => out.append(doc.createTextNode('\n')),
      rangeStart,
      end,
    );
    rangeStart = -1;
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const lineEnd = offset + line.length;
    if (line.length > LONG_LINE_THRESHOLD) {
      // The break before this line belongs to the range above it, which ends at this line's start.
      flush(offset);
      put(out, doc, line, '');
      if (lineEnd < text.length) out.append(doc.createTextNode('\n'));
    } else if (rangeStart < 0) {
      rangeStart = offset;
    }
    offset = lineEnd + 1;
  }
  flush(text.length);

  mountStyle(doc);
  code.replaceChildren(out);
  code.setAttribute(DONE, 'true');
  return true;
}

/**
 * Highlight the fenced blocks under `root`, in document order, while their running total of characters
 * stays within {@link HIGHLIGHT_BUDGET_CHARS}; the rest stay plain. Resolves once each has been highlighted
 * or left plain.
 */
export async function highlightCodeBlocks(root: ParentNode): Promise<void> {
  const within: HTMLElement[] = [];
  let total = 0;
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[data-lang]')) {
    total += (code.textContent ?? '').length;
    if (total > HIGHLIGHT_BUDGET_CHARS) break;
    within.push(code);
  }
  await Promise.all(within.map((code) => highlightCodeElement(code)));
}
