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
  linkHoverText,
  resolveDefaultLinkAction,
  scanLinkLine,
  shippedBindingsFor,
  type LinkCandidate,
  type LinkPosition,
  type LinkResolution,
  type LinkResolutionRequest,
  type OsName,
  type ResolvedLink,
} from '@throng/core';

/**
 * File and web links in an EDITOR (045 FR-002, FR-022, FR-040 – FR-044, FR-060, FR-071, FR-073,
 * FR-100 – FR-105).
 *
 * The terminal's half of this feature is an xterm link provider; CodeMirror has no such thing, so
 * the editor's half is a decoration plugin plus three gesture handlers. What they share is
 * everything that matters — the line scan (`scanLinkLine`), the resolution cache, and the one
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

/** A resolved FILE link the pointer or the caret is on, with everything an action needs. */
export interface EditorLinkHit {
  readonly kind: 'file';
  readonly link: ResolvedLink;
  readonly request: LinkResolutionRequest;
  readonly position?: LinkPosition;
  readonly positionText?: string;
  /** Document offsets of the span, for the decoration and for the hit test. */
  readonly from: number;
  readonly to: number;
}

/**
 * A WEB link in the document (045 FR-100 – FR-103). Never resolved by main (contract §6.1): the
 * address is the whole of what an action needs, and it opens in the system browser.
 */
export interface EditorWebLinkHit {
  readonly kind: 'web';
  /** The address exactly as written. */
  readonly uri: string;
  readonly from: number;
  readonly to: number;
}

/**
 * Whatever link is at a place in the document — data-model §13.2's `EditorLinkAt`. The decoration,
 * the `mousedown` handler, the chord and the menu all read the kind from here, so none of them has
 * to tell a web span from a file link for itself.
 */
export type EditorLinkAt = EditorLinkHit | EditorWebLinkHit;

export interface EditorLinkDeps {
  /**
   * FR-060 — `editor.links.detectInEditors`, read PER SCAN. Absent means on.
   *
   * The pointer gestures and the Open Link chord are installed on the view itself, not in the
   * compartment, so without a gate here a Ctrl+click would keep following a link that no longer
   * underlines. It sits on the scan because everything — the marks, both gestures and the menu —
   * asks {@link linkHitsBetween} what is there, so one gate closes all four at once.
   *
   * It gates GUESSED PATHS only. A web url is a declaration, not a guess, and FR-101 keeps web links
   * working with the switch off — in an editor exactly as in a terminal.
   */
  detect?(): boolean;
  /** Read per scan, never captured: a Save As moves the base directory under a live view. */
  site(): EditorLinkSite;
  /** Peek the cache, and ask if the answer is not here yet. `undefined` means NOT a link. */
  ask(request: LinkResolutionRequest): LinkResolution | undefined;
  /**
   * FR-054 / FR-103 — the surface's route, shared with the menu's Open Link: a file link through the
   * click rule, a web link to the system browser. The hit is the one the decoration drew.
   */
  follow(hit: EditorLinkAt): void;
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
 * The link extension, as compartment CONTENT.
 *
 * The same mechanism `wrapCompartment` and `gutterCompartment` use, and for the same reason: the
 * alternative is recreating the `EditorView`, which takes the undo history, the scroll and the
 * selection with it. `editorLinkExtension(null)` is empty. FR-060's switch reconfigures it too, so
 * the marks are rebuilt the moment the switch moves; the switch itself is read inside the scan.
 */
export const linkCompartment = new Compartment();

/**
 * FR-042 / FR-105 — the mark, with a tooltip naming the gesture AND where it goes.
 *
 * The wording is core's `linkHoverText`, the function the terminal's tooltip delegates to, fed the
 * same inputs the terminal feeds it — the click rule's answer for a file link, `null` for a web link
 * — so one link reads identically in both panel types (FR-104). One mark per wording, reused across
 * builds, and every one carries the same class: a file link and a web link wear the SAME mark
 * (FR-136); the kind is data on it, not a look.
 */
const marks = new Map<string, Decoration>();

function markFor(at: EditorLinkAt): Decoration {
  const title =
    at.kind === 'web'
      ? linkHoverText('web', null, linkModifierLabel())
      : linkHoverText(
          'file',
          resolveDefaultLinkAction({
            link: at.link,
            hasPosition: at.position !== undefined,
            previewIsDefault: false,
          }),
          linkModifierLabel(),
        );
  const key = `${at.kind}|${title}`;
  let mark = marks.get(key);
  if (mark === undefined) {
    mark = Decoration.mark({
      class: 'cm-throng-link',
      attributes: { title, 'data-link-kind': at.kind },
    });
    marks.set(key, mark);
  }
  return mark;
}

/** On the editor root while Ctrl/Cmd is held — the only time a click on a link follows it. */
const MODIFIER_HELD_CLASS = 'cm-throng-linkHeld';

/**
 * FR-135 – FR-138 — the ONE link affordance, the terminal's (`terminal.css`, `link-marks.ts`) drawn
 * in CodeMirror's terms: a DASHED underline in `linkUnderline` at rest, SOLID in `linkUnderlineHover`
 * under the pointer, and the text's own colour left alone — an editor's syntax colours win (FR-008).
 *
 * The hand pointer is not part of the mark. It appears only while the modifier is held, because only
 * then does a click follow (FR-040); a hand at rest would promise a follow a plain click never makes.
 * The selector names `.cm-content` so the rule is qualified by the held state and nothing looser.
 */
const linkTheme = EditorView.theme({
  '.cm-throng-link': {
    textDecoration: 'underline dashed var(--throng-colour-linkUnderline)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '2px',
  },
  '.cm-throng-link:hover': {
    textDecorationStyle: 'solid',
    textDecorationColor: 'var(--throng-colour-linkUnderlineHover)',
  },
  [`&.${MODIFIER_HELD_CLASS} .cm-content .cm-throng-link`]: {
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
 * Every link on the lines `from..to` touches: web spans, and path candidates that RESOLVED.
 *
 * Line by line, because the grammar is a line scanner in both surfaces — a path does not span a line
 * break, and scanning the joined text would let one begin on one line and end on the next. Each line
 * is read by core's `scanLinkLine`, the same scan the terminal's provider reads (FR-104): the web
 * spans are found first and claimed, so no path candidate overlaps one (FR-009), and the spans come
 * back in line order, as the terminal's do.
 */
export function linkHitsBetween(
  state: EditorState,
  from: number,
  to: number,
  deps: EditorLinkDeps,
): EditorLinkAt[] {
  // FR-060 gates GUESSED paths only (FR-101): with it off there is no path mark, no path hit for a
  // gesture to claim and no path run for the menu — while a web link keeps all three.
  const detectPaths = deps.detect?.() !== false;
  const site = detectPaths ? deps.site() : null;
  const hits: EditorLinkAt[] = [];

  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    const scanned = scanLinkLine(line.text);
    const onLine: EditorLinkAt[] = scanned.web.map((span) => ({
      kind: 'web' as const,
      uri: span.uri,
      from: line.from + span.start,
      to: line.from + span.end,
    }));
    if (site !== null) {
      const taken: EditorLinkAt[] = [];
      for (const candidate of scanned.paths.slice(0, MAX_LINK_CANDIDATES_PER_LINE)) {
        const hit = hitFor(candidate, line.from, site, deps);
        // R7's ambiguity rule, as the terminal's provider applies it: detection emits the positioned
        // reading first, so the first candidate that resolves keeps the span and the second is dropped.
        if (hit && !taken.some((h) => h.from < hit.to && hit.from < h.to)) taken.push(hit);
      }
      onLine.push(...taken);
      onLine.sort((a, b) => a.from - b.from);
    }
    hits.push(...onLine);
    if (line.to >= state.doc.length) break;
    pos = line.to + 1;
  }
  return hits;
}

/**
 * D3 (T215, T216) — the last answer each set of deps DREW, per request.
 *
 * The cache drops an answer once it is older than `LINK_CACHE_TTL_MS`, and it drops it on READ. A view
 * nobody has touched is not rebuilt in that time, so it keeps showing the link it drew — and the next
 * thing to read the cache is the Ctrl+click on that link, which then heard "not known" (FR-071's
 * `undefined`), was not claimed, and let CodeMirror add a caret where the user could see an underline.
 * The same miss re-asked main, so the second click on the same link worked, which is why the probe
 * saw a first-character click fail and a mid-link one succeed.
 *
 * So "not known YET" falls back to what was last drawn for the same request, and only that: an answer
 * of `{ ok: false }` replaces it at once, and a request never answered `ok` draws nothing, as FR-071
 * requires. The hit-test therefore reads the span set the decoration drew. Nothing is followed on the
 * strength of this alone — main re-resolves and re-checks every target at action time (FR-037).
 */
const drawnAnswers = new WeakMap<EditorLinkDeps, Map<string, ResolvedLink>>();
/** A bound, not a budget: one entry per distinct span an editor has drawn, dropped oldest-first. */
const MAX_DRAWN_ANSWERS = 512;

function drawnKey(request: LinkResolutionRequest): string {
  return JSON.stringify([
    request.kind,
    request.text,
    request.baseDirectory ?? '',
    request.panelId,
    request.originProjectId ?? '',
  ]);
}

function answerFor(request: LinkResolutionRequest, deps: EditorLinkDeps): ResolvedLink | null {
  let drawn = drawnAnswers.get(deps);
  if (drawn === undefined) {
    drawn = new Map();
    drawnAnswers.set(deps, drawn);
  }
  const key = drawnKey(request);
  const resolution = deps.ask(request);
  if (resolution === undefined) return drawn.get(key) ?? null;
  if (!resolution.ok) {
    drawn.delete(key);
    return null;
  }
  drawn.delete(key); // re-inserted, so the order is least-recently-drawn first
  drawn.set(key, resolution.link);
  if (drawn.size > MAX_DRAWN_ANSWERS) drawn.delete(drawn.keys().next().value as string);
  return resolution.link;
}

function hitFor(
  candidate: LinkCandidate,
  lineStart: number,
  site: EditorLinkSite,
  deps: EditorLinkDeps,
): EditorLinkHit | null {
  const request = editorLinkRequest(candidate.text, site);
  // FR-006 / FR-071: not yet known (and never drawn) and `{ ok: false }` (nothing there) are the same
  // answer as far as the screen is concerned — no underline, nothing followable.
  const link = answerFor(request, deps);
  if (link === null) return null;
  return {
    kind: 'file',
    link,
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
      builder.add(hit.from, hit.to, markFor(hit));
    }
  }
  return builder.finish();
}

/** The link under a document offset, or null. Shared by the gestures and the context menu. */
export function linkAtPosition(
  state: EditorState,
  pos: number,
  deps: EditorLinkDeps,
): EditorLinkAt | null {
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

/**
 * The label the tooltip uses — `Ctrl`, or `Cmd` where the modifier is Meta, which is how the
 * terminal's tooltip names it (FR-105). Separate from the name so the wording has one source too.
 */
function linkModifierLabel(): string {
  return linkModifierName() === 'Meta' ? 'Cmd' : 'Ctrl';
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
  let pending: { hit: EditorLinkAt; x: number; y: number; from: number } | null = null;

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
 * `null` is an editor with no panel identity to ask about. Returning `[]` rather than a disabled
 * plugin makes that structural: with the extension absent there is no code path left that could
 * decorate. FR-060's switch is NOT this any more — it gates guessed paths inside the scan, because
 * FR-101 keeps web links marked and followable with it off.
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
      /** FR-135's pointer state: the listeners that track whether Ctrl/Cmd is held, removed on destroy. */
      private readonly stopModifier: () => void;

      constructor(private readonly view: EditorView) {
        this.stopModifier = trackModifier(view.dom);
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
        this.stopModifier();
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}

/**
 * FR-135 — keep {@link MODIFIER_HELD_CLASS} on `root` exactly while the link modifier is held.
 *
 * The key events come from the WINDOW, because the modifier is often pressed while focus is
 * elsewhere and the pointer is already over the editor; a pointer move reads the modifier off the
 * event itself, which also corrects a missed key-up (focus changed with the key down). A window blur
 * clears it, since no key-up follows a key held while the window loses focus.
 */
function trackModifier(root: HTMLElement): () => void {
  const view = root.ownerDocument.defaultView;
  const set = (held: boolean): void => {
    root.classList.toggle(MODIFIER_HELD_CLASS, held);
  };
  const onKey = (event: KeyboardEvent): void => set(modifierHeld(event));
  const onMove = (event: MouseEvent): void => set(modifierHeld(event));
  const onBlur = (): void => set(false);
  view?.addEventListener('keydown', onKey, true);
  view?.addEventListener('keyup', onKey, true);
  view?.addEventListener('blur', onBlur);
  root.addEventListener('mousemove', onMove);
  return () => {
    view?.removeEventListener('keydown', onKey, true);
    view?.removeEventListener('keyup', onKey, true);
    view?.removeEventListener('blur', onBlur);
    root.removeEventListener('mousemove', onMove);
    set(false);
  };
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
