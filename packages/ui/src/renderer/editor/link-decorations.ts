import { Compartment, RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import {
  DEFAULT_BINDING_PLATFORM,
  MAX_LINK_CANDIDATES_PER_LINE,
  detectPathCandidates,
  shippedBindingsFor,
  type LinkCandidate,
  type LinkPosition,
  type LinkResolution,
  type LinkResolutionRequest,
  type OsName,
  type ResolvedLink,
} from '@throng/core';

/**
 * File links in an EDITOR (045 FR-002, FR-022, FR-040 – FR-044, FR-060, FR-071, FR-073).
 *
 * The terminal's half of this feature is an xterm link provider; CodeMirror has no such thing, so
 * the editor's half is a decoration plugin plus three gesture handlers. What they share is
 * everything that matters — the grammar (`detectPathCandidates`), the resolution cache, and the one
 * router that performs a target — so the two surfaces cannot disagree about what a link is or where
 * it opens.
 *
 * ══ THE VISIBLE RANGE IS THE WHOLE COST STORY (FR-073) ══
 *
 * A document is not a stream: every line of a 40,000-line file is there from the moment it opens, so
 * a scan over the document would be a scan over the document, on every keystroke. `view.visibleRanges`
 * is what makes the cost a function of the WINDOW rather than of the file, and that is a
 * requirement rather than an optimisation. It is also why the scan is a `ViewPlugin` over
 * `visibleRanges` and not a `StateField`: a state field would have to rebuild for the whole document
 * because it cannot see the viewport at all.
 *
 * ══ AND THE CACHE IS WHAT MAKES IT SYNCHRONOUS (FR-071) ══
 *
 * A decoration build cannot await. `ask` peeks the resolution cache and answers `undefined` for
 * anything not yet known — which draws NOTHING, and fires the request that makes the next build draw
 * it. So a file whose existence has not been established yet is simply not a link, for a frame, and
 * the typing path never touches a disk.
 */

/** What a link seen in THIS editor is judged against (FR-021, FR-022). */
export interface EditorLinkSite {
  readonly panelId: string;
  /** `Panel.originProjectId` — an id, never a root. Main derives the root from it (I2). */
  readonly originProjectId?: string;
  /** FR-022: the open file's own folder. ABSENT for an untitled buffer, never the project root. */
  readonly baseDirectory?: string;
}

/** A resolved link the pointer or the caret is on, with everything an action needs. */
export interface EditorLinkHit {
  readonly link: ResolvedLink;
  readonly request: LinkResolutionRequest;
  readonly position?: LinkPosition;
  readonly positionText?: string;
  /** Document offsets of the span, for the decoration and for the hit test. */
  readonly from: number;
  readonly to: number;
}

export interface EditorLinkDeps {
  /** Read per scan, never captured: a Save As moves the base directory under a live view. */
  site(): EditorLinkSite;
  /** Peek the cache, and ask if the answer is not here yet. `undefined` means NOT a link. */
  ask(request: LinkResolutionRequest): LinkResolution | undefined;
  /** FR-054 — the surface's default-action route, shared with the menu's Open Link. */
  follow(hit: EditorLinkHit): void;
}

/** As much of an `EditorView` as a scan needs — which is deliberately not a browser. */
export interface LinkScanView {
  readonly state: EditorState;
  readonly visibleRanges: readonly { readonly from: number; readonly to: number }[];
}

/** …plus the two things a pointer gesture needs. */
export interface LinkPointerView extends LinkScanView {
  posAtCoords(coords: { x: number; y: number }): number | null;
  dispatch(spec: { selection: { anchor: number; head: number } }): void;
}

/**
 * FR-060's switch, as compartment CONTENT.
 *
 * The same mechanism `wrapCompartment` and `gutterCompartment` use, and for the same reason: the
 * alternative is recreating the `EditorView`, which takes the undo history, the scroll and the
 * selection with it. `editorLinkExtension(null)` is empty, so turning detection off removes the
 * plugin from a live view rather than leaving it installed and asking it to do nothing.
 */
export const linkCompartment = new Compartment();

/**
 * FR-042 — underlined, with a tooltip naming the gesture.
 *
 * The wording stops at "to open" for the terminal tooltip's reason: a file link ends up in an editor,
 * a preview, the file manager or the OS's own program depending on the link and the *Default link
 * action*, and naming one of them would be wrong for the other three.
 */
const linkMark = Decoration.mark({
  class: 'cm-throng-link',
  attributes: { title: `${linkModifierLabel()}+Click to open` },
});

/**
 * The underline, from theme tokens. No literal colour: `tokens.css` publishes the active theme's
 * accent as a CSS variable, so re-theming repaints this with no rebuild.
 */
const linkTheme = EditorView.theme({
  '.cm-throng-link': {
    textDecoration: 'underline',
    textUnderlineOffset: '2px',
    color: 'var(--throng-colour-accent)',
    cursor: 'pointer',
  },
});

/** FR-022 — the site an editor panel judges its links against. */
export function editorLinkSiteFor(args: {
  readonly panelId: string;
  /** The open document's absolute path, or `null` for an untitled buffer. */
  readonly filePath: string | null | undefined;
  readonly originProjectId?: string;
}): EditorLinkSite {
  const folder = args.filePath ? parentFolder(args.filePath) : undefined;
  return {
    panelId: args.panelId,
    ...(args.originProjectId ? { originProjectId: args.originProjectId } : {}),
    // Absent, not empty: the resolver tries the project root ALONE when there is no base, and an
    // empty string would be a base directory that resolves everything against nothing (R10).
    ...(folder ? { baseDirectory: folder } : {}),
  };
}

/** The folder part of an absolute path, keeping the separator style it was written in. */
function parentFolder(absPath: string): string | undefined {
  const cut = Math.max(absPath.lastIndexOf('\\'), absPath.lastIndexOf('/'));
  if (cut < 0) return undefined;
  // A file at a drive or share root keeps the separator, so `D:\x.txt` yields `D:\` rather than `D:`.
  return cut === 0 ? absPath.slice(0, 1) : absPath.slice(0, cut + 1).replace(/(?<=[^:\\/])[\\/]$/, '');
}

/** FR-020 – FR-022: what main is asked about a span of document text. */
export function editorLinkRequest(text: string, site: EditorLinkSite): LinkResolutionRequest {
  return {
    text,
    kind: 'detectedPath',
    panelId: site.panelId,
    ...(site.originProjectId ? { originProjectId: site.originProjectId } : {}),
    ...(site.baseDirectory ? { baseDirectory: site.baseDirectory } : {}),
  };
}

/**
 * Every RESOLVED link on the lines `from..to` touches.
 *
 * Line by line, because the grammar is a line scanner in both surfaces — a path does not span a line
 * break, and scanning the joined text would let one begin on one line and end on the next.
 */
export function linkHitsBetween(
  state: EditorState,
  from: number,
  to: number,
  deps: EditorLinkDeps,
): EditorLinkHit[] {
  const site = deps.site();
  const hits: EditorLinkHit[] = [];
  const claimed: never[] = [];

  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    const candidates = detectPathCandidates(line.text, claimed).slice(
      0,
      MAX_LINK_CANDIDATES_PER_LINE,
    );
    for (const candidate of candidates) {
      const hit = hitFor(candidate, line.from, site, deps);
      // R7's ambiguity rule, as the terminal's provider applies it: detection emits the positioned
      // reading first, so the first candidate that resolves keeps the span and the second is dropped.
      if (hit && !hits.some((h) => h.from < hit.to && hit.from < h.to)) hits.push(hit);
    }
    if (line.to >= state.doc.length) break;
    pos = line.to + 1;
  }
  return hits;
}

function hitFor(
  candidate: LinkCandidate,
  lineStart: number,
  site: EditorLinkSite,
  deps: EditorLinkDeps,
): EditorLinkHit | null {
  const request = editorLinkRequest(candidate.text, site);
  const resolution = deps.ask(request);
  // FR-006 / FR-071: `undefined` (not yet known) and `{ ok: false }` (nothing there) are the same
  // answer as far as the screen is concerned — no underline, nothing followable.
  if (resolution?.ok !== true) return null;
  return {
    link: resolution.link,
    request,
    ...(candidate.position === undefined ? {} : { position: candidate.position }),
    ...(candidate.positionText === undefined ? {} : { positionText: candidate.positionText }),
    from: lineStart + candidate.start,
    to: lineStart + candidate.end,
  };
}

/** FR-002 / FR-073 — the marks for one build, over the visible ranges and nothing else. */
export function buildLinkDecorations(view: LinkScanView, deps: EditorLinkDeps): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const range of view.visibleRanges) {
    for (const hit of linkHitsBetween(view.state, range.from, range.to, deps)) {
      builder.add(hit.from, hit.to, linkMark);
    }
  }
  return builder.finish();
}

/** The link under a document offset, or null. Shared by the gestures and the context menu. */
export function linkAtPosition(
  state: EditorState,
  pos: number,
  deps: EditorLinkDeps,
): EditorLinkHit | null {
  const line = state.doc.lineAt(pos);
  return (
    linkHitsBetween(state, line.from, line.from, deps).find(
      (hit) => pos >= hit.from && pos <= hit.to,
    ) ?? null
  );
}

/**
 * FR-044 / G8 — the Open Link chord.
 *
 * Returns whether the key was CLAIMED, and that return value is the whole of G9: the window handler
 * calls `preventDefault` only on `true`, so everywhere else the keypress carries on to CodeMirror's
 * `defaultKeymap` and inserts a blank line exactly as it does today. "Unchanged" is not a second
 * behaviour written here — it is what happens when nothing claims the key.
 */
export function followLinkAtCaret(view: LinkScanView, deps: EditorLinkDeps): boolean {
  const selection = view.state.selection;
  // FR-044's three clauses: one caret, empty, inside a link. A selection means the user is acting on
  // the selected text; two carets mean the question has two answers and neither was asked.
  if (selection.ranges.length !== 1 || !selection.main.empty) return false;
  const hit = linkAtPosition(view.state, selection.main.head, deps);
  if (!hit) return false;
  deps.follow(hit);
  return true;
}

/**
 * Which editor panel can answer for its own links (FR-045).
 *
 * The Open Link chord is dispatched at the WINDOW, in capture phase, because CodeMirror's
 * `defaultKeymap` already binds Ctrl+Enter and would claim the key before any in-view handler could
 * decline it. The window has a panel id and nothing else, so each mounted editor leaves its deps
 * here — the same shape `editor-views.ts` uses for the same reason.
 */
const panelLinkDeps = new Map<string, EditorLinkDeps>();

export function registerPanelLinkDeps(panelId: string, deps: EditorLinkDeps): void {
  panelLinkDeps.set(panelId, deps);
}

export function unregisterPanelLinkDeps(panelId: string): void {
  panelLinkDeps.delete(panelId);
}

/**
 * FR-044 — the chord, over a named panel. `false` means the key was NOT claimed, which is G9: the
 * window handler leaves it alone and CodeMirror inserts a blank line exactly as it does today.
 */
export function followLinkInPanel(panelId: string, view: LinkScanView | null | undefined): boolean {
  const deps = panelLinkDeps.get(panelId);
  if (!deps || !view) return false;
  return followLinkAtCaret(view, deps);
}

/* ────────────────────────────────────────────────────────────────────────── *
 * The pointer gestures (FR-040, FR-041) — G1, G3, G4
 * ────────────────────────────────────────────────────────────────────────── */

/** How far the pointer may travel between press and release and still be a click, in pixels. */
const DRAG_SLOP_PX = 3;

/** The modifier named by a binding token — `Ctrl+Enter` → `Ctrl`, `Meta+Enter` → `Meta`. */
export function linkModifierFromChord(token: string): 'Ctrl' | 'Meta' {
  return /^meta\+/i.test(token) ? 'Meta' : 'Ctrl';
}

/**
 * FR-040's "Cmd on macOS" clause, read from ONE place: the Open Link command's own shipped chord.
 *
 * Writing `ctrlKey` into the handler would be a second home for the platform answer, and the two
 * would disagree the day macOS bindings are populated.
 */
export function linkModifierName(platform: OsName = DEFAULT_BINDING_PLATFORM): 'Ctrl' | 'Meta' {
  const token = shippedBindingsFor(platform).bindings['preview.followLink']?.[0];
  return token ? linkModifierFromChord(token) : 'Ctrl';
}

/** The label the tooltip uses. Separate from the name so the wording has one source too. */
function linkModifierLabel(): string {
  return linkModifierName();
}

function modifierHeld(event: { ctrlKey: boolean; metaKey: boolean }): boolean {
  return linkModifierName() === 'Meta' ? event.metaKey : event.ctrlKey;
}

/**
 * The `mousedown`/`mouseup` pair CodeMirror's `domEventHandlers` installs.
 *
 * ══ WHY THE PRESS IS CLAIMED AND THE RELEASE DECIDES ══
 *
 * Ctrl+click in an editor already means "add a cursor" (FR-041), so the press must be claimed the
 * instant it is over a link or CodeMirror will add one underneath the follow. But FR-040 also says a
 * Ctrl+click that DRAGS selects — so following on the press would turn a drag that happens to begin
 * on a link into an open. Claiming the press and letting the release decide satisfies both: a
 * release where the press was is a click, and a release elsewhere is a drag, which selects from one
 * to the other. Performing that selection ourselves is the price of having claimed the press.
 */
export function createLinkPointerHandlers(deps: EditorLinkDeps): {
  mousedown(event: MouseEvent, view: LinkPointerView): boolean;
  mouseup(event: MouseEvent, view: LinkPointerView): boolean;
} {
  let pending: { hit: EditorLinkHit; x: number; y: number; from: number } | null = null;

  return {
    mousedown(event, view) {
      pending = null;
      // 024 FR-019c's editor twin: a plain click, and every button but the primary, keeps its
      // ordinary meaning on this surface.
      if (event.button !== 0 || !modifierHeld(event)) return false;
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;
      const hit = linkAtPosition(view.state, pos, deps);
      // FR-041: not over a link, so CodeMirror's own multi-cursor handler runs — which is G4 by
      // default rather than by imitation.
      if (!hit) return false;
      pending = { hit, x: event.clientX, y: event.clientY, from: pos };
      return true;
    },

    mouseup(event, view) {
      const press = pending;
      pending = null;
      if (!press) return false;

      const moved =
        Math.abs(event.clientX - press.x) > DRAG_SLOP_PX ||
        Math.abs(event.clientY - press.y) > DRAG_SLOP_PX;
      if (!moved) {
        deps.follow(press.hit);
        return true;
      }

      // G3 — a drag selects. The press was claimed, so CodeMirror never started its own selection;
      // this is that selection, from where the button went down to where it came up.
      const to = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (to !== null) view.dispatch({ selection: { anchor: press.from, head: to } });
      return true;
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────── *
 * The extension
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The compartment's content: the decoration plugin and its theme, or NOTHING.
 *
 * `null` is FR-060's off position — `editor.links.detectInEditors` turned off, or an editor with no
 * panel identity to ask about. Returning `[]` rather than a disabled plugin is what makes the switch
 * structural: with the extension absent there is no code path left that could decorate.
 */
export function editorLinkExtension(deps: EditorLinkDeps | null): Extension {
  if (deps === null) return [];
  return [linkDecorationPlugin(deps), linkTheme];
}

function linkDecorationPlugin(deps: EditorLinkDeps): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      /** Dropped on destroy — the cache outlives the view, and a dead view must not repaint. */
      private readonly stop: () => void;

      constructor(private readonly view: EditorView) {
        this.decorations = buildLinkDecorations(view, deps);
        // FR-070: an answer landing, or a watcher invalidating one, has to reach a view that is
        // already drawn — the resolution is asynchronous and the build that asked for it is over.
        this.stop = subscribeToAnswers(() => {
          this.decorations = buildLinkDecorations(this.view, deps);
          // A no-op transaction is the cheapest way to make CodeMirror re-read `decorations`; the
          // plugin cannot repaint itself outside an update.
          this.view.dispatch({});
        });
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
          this.decorations = buildLinkDecorations(update.view, deps);
        }
      }

      destroy(): void {
        this.stop();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * The cache's change notification, injected late.
 *
 * `link-cache.ts` is a renderer module with a `window` dependency, and this one is imported by a node
 * -environment unit test; the indirection keeps the import out of the module graph until the app
 * actually wires it. `use-editor.ts` sets it once.
 */
let answerSubscriber: (listener: () => void) => () => void = () => () => {};

export function setLinkAnswerSubscriber(subscribe: (listener: () => void) => () => void): void {
  answerSubscriber = subscribe;
}

function subscribeToAnswers(listener: () => void): () => void {
  return answerSubscriber(listener);
}
