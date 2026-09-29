/**
 * Section folding for a Markdown editor (047 US3, research R3/R4/R5).
 *
 * ══ WHERE THE STATE LIVES ══
 *
 * Folding is a property of the DOCUMENT (Principle XI), not the view: `fold-state-store.ts` is the
 * per-window cache, and main's `EditorCoordinator` fold map (beside word wrap) is the one authority.
 * Nothing here writes CodeMirror's `foldState` field directly from a click — a click calls
 * `setDocumentFoldState`, the store tells the authority, the authority relays the change to every
 * OTHER view on the key, and `use-editor.ts` re-applies the resulting `FoldState` to the live view
 * exactly the same way whether it arrived from this view's own click or from across a sync message.
 * That is what makes "collapsing an H1 and re-expanding restores H2 folds" true without a special
 * case: `flipped` keeps every slug's own entry, and re-deriving CodeMirror's fold RANGES from the
 * whole `FoldState` every time is what applies them all again.
 *
 * ══ SECTIONS, FOLD RANGES, AND WHY THE HEADING LINE STAYS VISIBLE ══
 *
 * A `Section` runs from its heading to just before the next heading of the same or a lower level
 * (data-model.md); {@link markdownSections} derives that from the flat `HeadingRecord[]`
 * `markdown-headings.ts` (T007) extracts. The CodeMirror fold RANGE for a section is everything
 * AFTER its heading's own line through the end of its content — the heading itself is never inside
 * the folded range, so it keeps reading as a heading (with the gutter marker showing `+`) rather than
 * disappearing into the placeholder. A section with no content between it and the next heading folds
 * nothing (there is nothing to hide), but its `FoldState` entry and its marker are unaffected.
 *
 * ══ THE GUTTER IS HEADING-ONLY, DELIBERATELY NOT `foldGutter()` ══
 *
 * `@codemirror/language`'s stock `foldGutter()` draws a marker on every node lang-markdown's own
 * `foldNodeProp` calls foldable — code blocks, block quotes and tables included (research R4). This
 * is a hand-rolled `gutter()` instead: a marker only where {@link markdownSections} says a section
 * starts, computed from the SAME producer as folding itself, so the two can never disagree about
 * what counts as a heading.
 */
import { codeFolding, ensureSyntaxTree, foldEffect, foldedRanges, language, syntaxTree, unfoldEffect } from '@codemirror/language';
import { gutter, GutterMarker, ViewPlugin, type Command, type EditorView, type ViewUpdate } from '@codemirror/view';
import { Compartment, type EditorState, type Extension, type Text } from '@codemirror/state';
import {
  collapseAll,
  expandAll,
  isCollapsed,
  setSection,
  toggleAll,
  toggleSection,
  type FoldState,
  type HeadingRecord,
  type IconAsset,
} from '@throng/core';
import { markdownHeadingRecords } from './markdown-headings.js';
import { documentFoldState, setDocumentFoldState } from './fold-state-store.js';

/**
 * Holds the fold mechanism — `codeFolding()` and the heading gutter — reconfigured to nothing for
 * any language but Markdown (R4), the same way `languageCompartment` and
 * `functionHighlightCompartment` are per-document extensions.
 */
export const foldCompartment = new Compartment();

/** A document section, derived from its headings (data-model.md "Section", editor form). */
export interface EditorFoldSection {
  readonly slug: string;
  readonly level: HeadingRecord['level'];
  /** 0-based: the heading's own line. */
  readonly startLine: number;
  /** 0-based, inclusive: the section's last content line — equal to `startLine` when it has none. */
  readonly endLine: number;
}

/**
 * Every section in `headings`' document order — one per heading, running to just before the next
 * heading of the same or a lower level, or to `lastLine0` (the document's last 0-based line).
 */
export function markdownSections(
  headings: readonly HeadingRecord[],
  lastLine0: number,
): EditorFoldSection[] {
  return headings.map((heading, index) => {
    const next = headings.slice(index + 1).find((candidate) => candidate.level <= heading.level);
    const endLine = next ? Math.max(heading.line, next.line - 1) : lastLine0;
    return { slug: heading.slug, level: heading.level, startLine: heading.line, endLine };
  });
}

/** The innermost section containing 0-based `line0` — the nearest heading at or before it, any level. */
export function sectionAtLine(
  sections: readonly EditorFoldSection[],
  line0: number,
): EditorFoldSection | null {
  let best: EditorFoldSection | null = null;
  for (const section of sections) {
    if (section.startLine <= line0 && (best === null || section.startLine > best.startLine)) best = section;
  }
  return best;
}

/** The CodeMirror range a section's CONTENT occupies — `null` when it has none to fold. */
export function foldRangeFor(section: EditorFoldSection, doc: Text): { from: number; to: number } | null {
  const headingLine = doc.line(Math.min(section.startLine + 1, doc.lines));
  const endLine = doc.line(Math.min(section.endLine + 1, doc.lines));
  const from = headingLine.to;
  const to = endLine.to;
  return from < to ? { from, to } : null;
}

/**
 * Make the view's CodeMirror fold ranges equal the derivation from `sections` + `foldState` (R4):
 * every section `isCollapsed` folds its content range, everything else unfolds. A transaction
 * carrying only fold/unfold EFFECTS — no `changes`, no `selection` — so this never marks the
 * document dirty, changes its text, adds a history entry, or moves the caret (FR-035).
 */
export function syncFoldRanges(
  view: EditorView,
  sections: readonly EditorFoldSection[],
  foldState: FoldState,
): void {
  const doc = view.state.doc;
  const rangeKey = (r: { from: number; to: number }): string => `${r.from}:${r.to}`;

  const wanted = new Map<string, { from: number; to: number }>();
  for (const section of sections) {
    if (!isCollapsed(foldState, section.slug)) continue;
    const range = foldRangeFor(section, doc);
    if (range) wanted.set(rangeKey(range), range);
  }

  const existing = new Map<string, { from: number; to: number }>();
  foldedRanges(view.state).between(0, doc.length, (from, to) => {
    existing.set(rangeKey({ from, to }), { from, to });
  });

  const effects = [
    ...[...wanted].filter(([key]) => !existing.has(key)).map(([, range]) => foldEffect.of(range)),
    ...[...existing].filter(([key]) => !wanted.has(key)).map(([, range]) => unfoldEffect.of(range)),
  ];
  if (effects.length > 0) view.dispatch({ effects });
}

/** Sections per editor state: the gutter asks on every visible line, and each ask must not re-scan. */
const sectionsByState = new WeakMap<EditorState, EditorFoldSection[]>();

/** Every heading's section, derived from `view`'s CURRENT document and syntax tree — once per state. */
export function liveSections(view: EditorView): EditorFoldSection[] {
  const state = view.state;
  const cached = sectionsByState.get(state);
  if (cached) return cached;
  ensureSyntaxTree(state, state.doc.length, 5000);
  const sections = markdownSections(markdownHeadingRecords(state), state.doc.lines - 1);
  sectionsByState.set(state, sections);
  return sections;
}

const ICON_EXPANDED = 'foldSectionExpanded';
const ICON_COLLAPSED = 'foldSectionCollapsed';

/** Resolves an icon token to what it renders as, bound to the active theme and packs by the caller. */
export type IconResolver = (token: string) => IconAsset;

export interface MarkdownFoldDeps {
  readonly getFoldState: () => FoldState;
  readonly iconFor: IconResolver;
  /** A marker was clicked for `slug` — the caller publishes the toggled `FoldState` (Principle XI). */
  readonly onToggle: (slug: string) => void;
  /** `editor.showGutter` (contracts "Editor gutter") — the markers live in the gutter and go with it. */
  readonly showGutter: boolean;
}

/** The `<span class="icon">` a marker carries, built exactly as the shared `Icon` component would. */
function renderIconInto(host: HTMLElement, asset: IconAsset): void {
  const span = host.ownerDocument.createElement('span');
  span.className = 'icon';
  span.setAttribute('aria-hidden', 'true');
  if (asset.kind === 'svg') span.innerHTML = asset.markup; // sanitised in main at pack-load time (017/#54)
  else if (asset.kind === 'glyph') span.textContent = asset.glyph;
  host.append(span);
}

class HeadingFoldMarker extends GutterMarker {
  constructor(
    /** The section this marker acts on — carried onto the DOM (`data-slug`) so a click, or a test,
     *  can identify which heading a marker belongs to without inferring it from DOM position. */
    private readonly slug: string,
    private readonly collapsed: boolean,
    private readonly asset: IconAsset,
  ) {
    super();
  }

  eq(other: HeadingFoldMarker): boolean {
    return other.slug === this.slug && other.collapsed === this.collapsed;
  }

  toDOM(): HTMLElement {
    const el = document.createElement('span');
    el.className = 'cm-throng-fold-marker';
    el.dataset.slug = this.slug;
    el.title = this.collapsed ? 'Expand section' : 'Collapse section';
    renderIconInto(el, this.asset);
    return el;
  }
}

/**
 * A CodeMirror `gutter()`, marking heading lines only (R4) — never `foldGutter()`, whose markers
 * would also land on code blocks, block quotes and tables. Clicking a marker toggles that heading's
 * OWN section, matching `markdown.toggleSection`.
 */
function markdownHeadingGutter(deps: MarkdownFoldDeps): Extension {
  const sectionAt = (view: EditorView, linePos: number): EditorFoldSection | null => {
    const line0 = view.state.doc.lineAt(linePos).number - 1;
    return liveSections(view).find((section) => section.startLine === line0) ?? null;
  };

  return gutter({
    class: 'cm-throng-fold-gutter',
    lineMarker: (view, line) => {
      const section = sectionAt(view, line.from);
      if (!section) return null;
      const collapsed = isCollapsed(deps.getFoldState(), section.slug);
      return new HeadingFoldMarker(
        section.slug,
        collapsed,
        deps.iconFor(collapsed ? ICON_COLLAPSED : ICON_EXPANDED),
      );
    },
    // `ensureSyntaxTree` inside `sectionAt` cannot force a synchronous parse from WITHIN a gutter's
    // own render pass (CodeMirror will not do that reentrantly) — it can only see whatever has
    // already been parsed. Callers force the parse ahead of time (`use-editor.ts`'s reconfigure
    // effect, before dispatching); this tells the gutter to recompute markers whenever the syntax
    // tree advances further, on a later edit, rather than only on the next viewport/doc change.
    lineMarkerChange: (update) => syntaxTree(update.startState) !== syntaxTree(update.state),
    domEventHandlers: {
      mousedown: (view, line) => {
        const section = sectionAt(view, line.from);
        if (!section) return false;
        deps.onToggle(section.slug);
        return true;
      },
    },
  });
}

/** True when `update` replaced the whole document — a load, a reset, a file opened in place. */
function replacedWholeDocument(update: ViewUpdate): boolean {
  if (!update.docChanged) return false;
  const before = update.startState.doc.length;
  let whole = false;
  update.changes.iterChangedRanges((fromA, toA) => {
    if (fromA === 0 && toA === before) whole = true;
  });
  return whole;
}

/**
 * MT-04 (review, 2026-09-28) — make the folded ranges equal the document's state whenever the SECTIONS
 * the state applies to first become known: when this extension is installed (a view rebuilt by a
 * re-parenting layout change), when the text arrives (a load or reset replaces the whole document), and
 * when the Markdown grammar lands (the sections exist only once it parses). The caller's own sync runs
 * only when the STATE changes, so a state that was already collapsed before any of these — a preview
 * collapsed first, `markdownSectionsOpen: collapsed` — marked its headings `+` and folded nothing.
 *
 * Ordinary typing is deliberately not a trigger: a heading typed into a collapsed-by-default document
 * must not fold the text the user is writing under it.
 *
 * Deferred a microtask because a view cannot dispatch from inside its own update.
 */
function foldRangeSync(deps: MarkdownFoldDeps): Extension {
  return ViewPlugin.define((view) => {
    let live = true;
    const schedule = (): void => {
      queueMicrotask(() => {
        if (live) syncFoldRanges(view, liveSections(view), deps.getFoldState());
      });
    };
    schedule();
    return {
      update(update: ViewUpdate): void {
        if (replacedWholeDocument(update) || update.startState.facet(language) !== update.state.facet(language)) schedule();
      },
      destroy(): void {
        live = false;
      },
    };
  });
}

/** `codeFolding()` plus the heading gutter (while `showGutter` is on) — the whole of `foldCompartment`'s Markdown content. */
export function markdownFoldExtension(deps: MarkdownFoldDeps): Extension {
  return [codeFolding(), foldRangeSync(deps), ...(deps.showGutter ? [markdownHeadingGutter(deps)] : [])];
}

/** The six `markdown.*` commands (R5): what each one does to a document's `FoldState`. */
export type FoldOp =
  | 'toggleSection'
  | 'collapseSection'
  | 'expandSection'
  | 'collapseAll'
  | 'expandAll'
  | 'toggleAll';

export interface FoldCommandDeps {
  readonly docKey: () => string;
  readonly panelId: string;
  /** The seed a never-before-seen document starts from — `editor.markdownSectionsOpen` (FR-039). */
  readonly seedDefault: () => FoldState;
}

/**
 * Build the `Command` for one fold action — `commandsFor()`'s handler map joins these exactly as it
 * joins `editor.toggleWordWrap` (R5: "handlers join `commandsFor()`"). The six fold actions (four bound to `Ctrl+M` chords) reach
 * this only in a Markdown editor: `foldCompartment` is empty everywhere else, but the ACTION is
 * withheld here too — no-op with nothing to fold — so a rebind can never surface it elsewhere.
 *
 * *This Section* (`toggleSection`/`collapseSection`/`expandSection`) is the innermost section
 * containing the CURSOR; a no-op before the first heading. *All* (`collapseAll`/`expandAll`/
 * `toggleAll`) acts on the whole document; a no-op with none.
 */
export function markdownFoldCommand(op: FoldOp, deps: FoldCommandDeps): Command {
  return (view) => {
    const sections = liveSections(view);
    if (sections.length === 0) return false;
    const key = deps.docKey();
    const current = documentFoldState(key, deps.seedDefault());

    let next: FoldState;
    if (op === 'collapseAll') next = collapseAll(current);
    else if (op === 'expandAll') next = expandAll(current);
    else if (op === 'toggleAll') next = toggleAll(current, sections.map((s) => s.slug));
    else {
      const cursorLine0 = view.state.doc.lineAt(view.state.selection.main.head).number - 1;
      const target = sectionAtLine(sections, cursorLine0);
      if (!target) return false;
      next =
        op === 'toggleSection'
          ? toggleSection(current, target.slug)
          : setSection(current, target.slug, op === 'collapseSection');
    }

    setDocumentFoldState(key, next, deps.panelId);
    syncFoldRanges(view, sections, next);
    return true;
  };
}
