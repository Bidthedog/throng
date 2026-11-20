/**
 * Per-panel ownership of the document-wide CSS Custom Highlight registry (049 R2).
 *
 * `CSS.highlights` is ONE map per document, keyed by name. Two preview panels painting
 * `throng-preview-match` with `registry.set(name, …)` overwrite each other, so a panel that remounts (or
 * a second preview in the same window) wipes the other's paint. Every painter goes through here instead:
 * each panel's ranges are kept per (name, panel) and the registry holds ONE `Highlight` per name containing
 * the union. Like `preview-search.ts`, this never names `CSS.highlights` or `Highlight` at compile time, so
 * jsdom (which has neither) makes every call a no-op.
 *
 * ══ A SAME-ORIGIN FRAME HAS A REGISTRY OF ITS OWN (074 FR-086b, R6d) ══
 *
 * A range inside an HTML Preview's frame is painted only by THAT document's `CSS.highlights`, with a `Highlight`
 * from that document's window, and only under `::highlight()` rules that document carries. So the union is
 * published per document — each range to the document its start is in — and a frame document is given the same
 * `::highlight()` rules `search/find-bar.css` gives the renderer, their colours read from the renderer's theme
 * tokens (a frame inherits no custom property). A range with no owner document (a unit test's stand-in) is the
 * renderer's.
 */

interface HighlightRegistry {
  set(name: string, value: unknown): void;
  delete(name: string): boolean;
}
interface HighlightCtor {
  new (...ranges: Range[]): unknown;
}
interface Runtime {
  registry: HighlightRegistry;
  Ctor: HighlightCtor;
}

/** The window-like globals a registry lives on: the renderer's `globalThis`, or a frame's `defaultView`. */
type HighlightGlobals = { CSS?: { highlights?: HighlightRegistry }; Highlight?: HighlightCtor };

function runtimeOf(scope: HighlightGlobals | null | undefined): Runtime | null {
  const registry = scope?.CSS?.highlights;
  const Ctor = scope?.Highlight;
  return registry && Ctor ? { registry, Ctor } : null;
}

/** `null` is the renderer's own document. */
type DocKey = Document | null;

function docOf(range: Range): DocKey {
  const doc = (range as Partial<Range>).startContainer?.ownerDocument ?? null;
  return doc === null || doc === (globalThis as { document?: Document }).document ? null : doc;
}

function runtimeFor(doc: DocKey): Runtime | null {
  if (doc === null) return runtimeOf(globalThis as HighlightGlobals);
  const runtime = runtimeOf(doc.defaultView as HighlightGlobals | null);
  if (runtime !== null) ensureHighlightRules(doc);
  return runtime;
}

/** The `::highlight()` rules `search/find-bar.css` holds, by name, and the theme token each paints with. */
const HIGHLIGHT_RULES: ReadonlyArray<readonly [name: string, token: string]> = [
  ['throng-preview-match', 'searchMatch'],
  ['throng-preview-match-current', 'searchMatchCurrent'],
  ['throng-preview-occurrence', 'searchMatchOccurrence'],
  ['throng-preview-occurrence-inactive', 'searchMatchOccurrenceInactive'],
  ['throng-preview-selection-inactive', 'editorSelectionInactive'],
];

/**
 * The rules as concrete colours, read from the renderer's tokens now (so a theme change repaints the next paint). The
 * theme provider sets every token; one it has not set yet leaves its rule out rather than paint a colour of its own.
 */
function highlightRulesText(): string {
  const root = (globalThis as { document?: Document }).document?.documentElement;
  const style = root ? getComputedStyle(root) : null;
  return HIGHLIGHT_RULES.flatMap(([name, token]) => {
    const value = style?.getPropertyValue(`--throng-colour-${token}`).trim() ?? '';
    return value === '' ? [] : [`::highlight(${name}) { background-color: ${value}; }`];
  }).join('\n');
}

/** Each frame document's constructed sheet of highlight rules, and the text it holds. */
const frameSheets = new WeakMap<Document, { sheet: CSSStyleSheet; text: string }>();

/**
 * Give `doc` the highlight rules, through a constructed sheet: it is the panel's, not the page's — no element is
 * added to the page's DOM (its text model, its copy), and a page's content policy has no say over it.
 */
function ensureHighlightRules(doc: Document): void {
  const view = doc.defaultView as (Window & { CSSStyleSheet?: typeof CSSStyleSheet }) | null;
  if (view?.CSSStyleSheet === undefined || !('adoptedStyleSheets' in doc)) return;
  const text = highlightRulesText();
  const held = frameSheets.get(doc);
  if (held !== undefined) {
    if (held.text !== text) {
      held.sheet.replaceSync(text);
      held.text = text;
    }
    if (!doc.adoptedStyleSheets.includes(held.sheet)) doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, held.sheet];
    return;
  }
  const sheet = new view.CSSStyleSheet();
  sheet.replaceSync(text);
  frameSheets.set(doc, { sheet, text });
  doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
}

/** name → panelId → that panel's ranges. */
const owned = new Map<string, Map<string, Range[]>>();
/** name → the documents a highlight of that name is registered in, so the last range leaving one deletes it. */
const publishedIn = new Map<string, Set<DocKey>>();

function publish(name: string): void {
  const byDoc = new Map<DocKey, Range[]>();
  owned.get(name)?.forEach((ranges) => {
    for (const range of ranges) {
      const doc = docOf(range);
      const list = byDoc.get(doc);
      if (list === undefined) byDoc.set(doc, [range]);
      else list.push(range);
    }
  });
  const before = publishedIn.get(name) ?? new Set<DocKey>();
  for (const doc of before) {
    if (byDoc.has(doc)) continue;
    // A frame document since replaced (a reload) has no window left: nothing is painted there to delete.
    runtimeFor(doc)?.registry.delete(name);
  }
  byDoc.forEach((ranges, doc) => {
    const rt = runtimeFor(doc);
    rt?.registry.set(name, new rt.Ctor(...ranges));
  });
  if (byDoc.size === 0) {
    publishedIn.delete(name);
    // The renderer's registry is cleared even when nothing was recorded there (049 R2's "deletes a name").
    runtimeFor(null)?.registry.delete(name);
  } else publishedIn.set(name, new Set(byDoc.keys()));
}

/** Replace `panelId`'s ranges under `name` (an empty list removes them). */
export function setPanelRanges(name: string, panelId: string, ranges: readonly Range[]): void {
  let perPanel = owned.get(name);
  if (ranges.length === 0) {
    perPanel?.delete(panelId);
    if (perPanel?.size === 0) owned.delete(name);
  } else {
    if (!perPanel) owned.set(name, (perPanel = new Map()));
    perPanel.set(panelId, [...ranges]);
  }
  publish(name);
}

/** Remove every range `panelId` holds, under every name; other panels' ranges stay painted. */
export function clearPanel(panelId: string): void {
  for (const name of [...owned.keys()]) {
    const perPanel = owned.get(name);
    if (!perPanel?.delete(panelId)) continue;
    if (perPanel.size === 0) owned.delete(name);
    publish(name);
  }
}
