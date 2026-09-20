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
  scanLinkLine,
  shippedBindingsFor,
  uriHoverDestination,
  type LinkCandidate,
  type LinkHoverDestination,
  type LinkPosition,
  type LinkResolutionRequest,
  type OsName,
  type PreviewProviderRegistry,
  type PreviewSettings,
  type ScanOptions,
} from '@throng/core';
import { linkDestinationByName } from '../links/click-by-name.js';
import { linkHintAnchor } from '../links/link-hint-anchor.js';
import { showLinkHint } from '../links/link-hint-store.js';
import { linkFirstReadingByName } from '../links/path-by-name.js';

/**
 * File and web links in an EDITOR (045 FR-002, FR-022, FR-040 – FR-044, FR-060, FR-071, FR-073,
 * FR-100 – FR-105).
 *
 * The terminal's half of this feature is an xterm link provider; CodeMirror has no such thing, so
 * the editor's half is a decoration plugin plus three gesture handlers. What they share is
 * everything that matters — the line scan (`scanLinkLine`) and the one follow (`followLink`, one
 * `throng:links:follow`) — so the two surfaces cannot disagree about what a link is or where it opens.
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
 * ══ AND VALIDITY IS SYNTACTIC, SO NOTHING IS ASKED (round four, FR-155, SC-021) ══
 *
 * A decoration build cannot await, and since round four it has nothing to await: a path is marked
 * because the grammar says it is one, whether or not anything exists there. Main is asked only when a
 * link is followed (one `throng:links:follow`) or a Link menu opens (one `throng:links:resolve`). The
 * typing path never touches a disk.
 */

/** What a link seen in THIS editor is judged against (FR-021, FR-022). */
export interface EditorLinkSite {
  readonly panelId: string;
  /** `Panel.originProjectId` — an id, never a root. Main derives the root from it (I2). */
  readonly originProjectId?: string;
  /** FR-022: the open file's own folder. ABSENT for an untitled buffer, never the project root. */
  readonly baseDirectory?: string;
}

/**
 * A FILE link the pointer or the caret is on, with everything an action needs. Round four: no resolved
 * answer — the grammar's request and position only; main resolves it at the follow (data-model §16.17).
 */
export interface EditorLinkHit {
  readonly kind: 'file';
  readonly request: LinkResolutionRequest;
  readonly position?: LinkPosition;
  readonly positionText?: string;
  /** Document offsets of the span, for the decoration and for the hit test. */
  readonly from: number;
  readonly to: number;
}

/**
 * A WEB link in the document (045 FR-100 – FR-103) — or, since round four, any address the OS opens by
 * its scheme: loopback, and an allowlisted protocol link such as `mailto:` (FR-157, FR-159). Never
 * resolved by main (contract §6.1): the address is the whole of what an action needs, and it leaves by
 * `throng:linkUri:openExternal`.
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
   * Round five (maintainer correction over the FR-101 reading above): enabled shows EVERY link kind in
   * an editor — web, allowlisted protocol and detected paths alike — and disabled draws none of them.
   * This widens the gate past guessed paths alone; a terminal keeps its own, narrower switch (the guess
   * only), because a program's OSC 8 hyperlink was never a guess to begin with
   * (`terminal/file-link-provider.ts`, a different surface).
   */
  detect?(): boolean;
  /**
   * FR-159, FR-178 — the user's known extensions and protocol allowlist, as `scanLinkLine` options
   * (`renderer/links/link-scan-options.ts`). Read PER SCAN, so an edit reaches the next decoration
   * pass with nothing remounted. Absent means the shipped defaults.
   */
  scanOptions?(): ScanOptions;
  /** Read per scan, never captured: a Save As moves the base directory under a live view. */
  site(): EditorLinkSite;
  /**
   * The owning project's root, which a link's title AND hint are both worded against BY NAME (FR-155:
   * nothing is resolved to word a link). Absent, or `null`, for an editor with no project.
   */
  projectRoot?(): string | null;
  /**
   * 045 FR-168 — 023's `editor.openTarget`, live, so the plain-click hint names which editor (round
   * five: the native `title` no longer takes this — it names the target alone). Absent means
   * `lastActive`.
   */
  openTarget?(): 'lastActive' | 'new';
  /**
   * FR-051, FR-168 — the live preview registry and settings, for the hint's "…to open in throng
   * preview" wording. Either absent means the hint never claims preview.
   */
  previewRegistry?(): PreviewProviderRegistry | undefined;
  previewSettings?(): PreviewSettings | undefined;
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
  /**
   * 045 FR-165b (maintainer correction) — the plain-click hint's anchor needs the link's own END
   * position measured, not just the click. `side: -1` biases to the character BEFORE `pos`, which is
   * what keeps a link ending exactly at a wrapped line's break anchored to that line rather than the
   * one below it.
   */
  coordsAtPos(pos: number, side?: -1 | 1): { left: number; top: number; right: number; bottom: number } | null;
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
 * FR-042 / FR-105 — the mark, with a native `title` naming the link's own TARGET.
 *
 * Round five (maintainer): "hovering … should simply show the link text, in full, in the HTML title
 * popup. Any other popup / hover / title text should be removed." So the bespoke gesture wording
 * (`linkHoverText`) no longer feeds this `title` — it still words the plain-click hint alone
 * (`showHintForPlainClick`, below), which is a separate, click-triggered surface the maintainer asked
 * to keep. This `title` is the link's target exactly as the editor's own status-strip readout shows it
 * (`linkFirstReadingByName`, FR-167a — a drive form as the drive it names, any other rooted path
 * against the project root, a relative one against the document's folder, the text as written where
 * there is nothing to read it against) — a web link's address stands for both readings at once, same
 * as the readout. One mark per distinct title, reused across builds, and every one carries the same
 * class: a file link and a web link wear the SAME mark (FR-136); the kind is data on it, not a look.
 */
const marks = new Map<string, Decoration>();

function markFor(at: EditorLinkAt, projectRoot: string | null): Decoration {
  const title =
    at.kind === 'web'
      ? at.uri
      : linkFirstReadingByName({
          text: at.request.text,
          baseDirectory: at.request.baseDirectory,
          projectRoot,
        });
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

/**
 * FR-135 – FR-138 — the ONE link affordance, the terminal's (`terminal.css`, `link-marks.ts`) drawn
 * in CodeMirror's terms: a DASHED underline in `linkUnderline` at rest, SOLID in `linkUnderlineHover`
 * under the pointer, and the text's own colour left alone — an editor's syntax colours win (FR-008).
 *
 * The hand pointer IS part of the mark (FR-164, superseding FR-135's modifier-only hand): a valid
 * link shows it whenever it is hovered, with or without Ctrl/Cmd. A Ctrl+click is still the only click
 * that follows (FR-040); a plain click says so through the link hint (FR-165).
 *
 * Round five (maintainer): "the underline … more subtle. Maybe slightly transparent until hovered
 * over" — the terminal's own correction (`terminal.css`), in CodeMirror's terms: the RESTING underline
 * is `linkUnderline` at reduced opacity via `color-mix()` (the same treatment already used elsewhere in
 * this codebase for a translucent border/background — no new theme token needed), full and solid in
 * `linkUnderlineHover` on hover.
 */
const linkTheme = EditorView.theme({
  '.cm-throng-link': {
    textDecorationLine: 'underline',
    textDecorationStyle: 'dashed',
    textDecorationColor: 'color-mix(in srgb, var(--throng-colour-linkUnderline) 45%, transparent)',
    textDecorationThickness: '1px',
    textUnderlineOffset: '2px',
    cursor: 'pointer',
  },
  '.cm-throng-link:hover': {
    textDecorationStyle: 'solid',
    textDecorationColor: 'var(--throng-colour-linkUnderlineHover)',
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
  /*
   * FR-060 (round five, maintainer correction over the FR-101 reading this superseded): the switch
   * gates EVERY link kind in an editor. Enabled marks web, allowlisted protocol and detected-path
   * links alike; disabled leaves nothing to mark, follow or offer in the menu — full stop, for all
   * three. A terminal's OWN switch stays the narrower, guessed-paths-only gate (a program's OSC 8
   * hyperlink is never a guess), so this is not a second copy of that rule, only a different one for a
   * different surface.
   */
  if (deps.detect?.() === false) return [];
  const site = deps.site();
  const options = deps.scanOptions?.() ?? {};
  const hits: EditorLinkAt[] = [];

  let pos = from;
  while (pos <= to) {
    const line = state.doc.lineAt(pos);
    const scanned = scanLinkLine(line.text, options);
    // L2: the cap covers declared addresses as well as guessed paths. A terminal line is bounded by
    // the column count; an EDITOR line is not, so a one-line minified or generated file dense in
    // `mailto:`/`tel:` tokens is the reachable case — and `detectProtocolSpans` has no cap of its own.
    const onLine: EditorLinkAt[] = [...scanned.web, ...scanned.protocol]
      .slice(0, MAX_LINK_CANDIDATES_PER_LINE)
      .map((span) => ({
        kind: 'web' as const,
        uri: span.uri,
        from: line.from + span.start,
        to: line.from + span.end,
      }));
    onLine.sort((a, b) => a.from - b.from);
    const taken: EditorLinkAt[] = [];
    for (const candidate of scanned.paths.slice(0, MAX_LINK_CANDIDATES_PER_LINE)) {
      const hit = hitFor(candidate, line.from, site);
      // R7's ambiguity rule, as the terminal's provider applies it: detection emits the positioned
      // reading first, so the first reading of a span keeps it and the second is dropped.
      if (!taken.some((h) => h.from < hit.to && hit.from < h.to)) taken.push(hit);
    }
    onLine.push(...taken);
    onLine.sort((a, b) => a.from - b.from);
    hits.push(...onLine);
    if (line.to >= state.doc.length) break;
    pos = line.to + 1;
  }
  return hits;
}

/*
 * D3 (T215, T216) lived here: the last answer each set of deps DREW, so a Ctrl+click after the cache
 * had dropped that answer still followed the link on screen. Round four marks by grammar (FR-155) and
 * follows with one `throng:links:follow`, so there is no answer to fall back to and nothing to lose.
 */

/** A path candidate, as a link: by grammar alone — nothing is asked (FR-155). */
function hitFor(candidate: LinkCandidate, lineStart: number, site: EditorLinkSite): EditorLinkHit {
  const request = editorLinkRequest(candidate.text, site);
  return {
    kind: 'file',
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
  const projectRoot = deps.projectRoot?.() ?? null;
  for (const range of view.visibleRanges) {
    for (const hit of linkHitsBetween(view.state, range.from, range.to, deps)) {
      builder.add(hit.from, hit.to, markFor(hit, projectRoot));
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
  /**
   * 045 FR-165 (round four) — tracked separately from `pending`: a PLAIN press never claims the
   * event (G2 is unchanged — CodeMirror places the caret exactly as it always has), but the hint
   * still needs a start point to tell a click from a drag (FR-165e) before it can show.
   */
  let plainPress: { x: number; y: number } | null = null;

  return {
    mousedown(event, view) {
      pending = null;
      plainPress = event.button === 0 && !modifierHeld(event) ? { x: event.clientX, y: event.clientY } : null;
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
      const plain = plainPress;
      plainPress = null;
      if (!press) {
        // 045 FR-165 — ADDITIVE: never claimed, never prevented. A plain click that did not drag,
        // landing on a link, shows the hint alongside whatever the click already does.
        if (plain) showHintForPlainClick(event, plain, view, deps);
        return false;
      }

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

/**
 * 045 FR-165, FR-168 (round four) — the plain-click hint's own destination and wording, shared with
 * the tooltip's (`markFor`, above) so the two can never disagree about the same link.
 *
 * The anchor is the LINK'S OWN end (`view.coordsAtPos(hit.to, -1)`), collapsed to its bottom-right
 * corner by the shared `linkHintAnchor` — the maintainer's correction over round four's release-point
 * anchor, which could land the hint mid-link or off a wrapped line's end. `-1` biases to the character
 * BEFORE `hit.to`, so a link ending at a wrapped line's break stays anchored to that line rather than
 * jumping to the one below. Falls back to the release point only when the position cannot be measured
 * at all (`coordsAtPos` returned `null`).
 */
function showHintForPlainClick(
  event: MouseEvent,
  start: { x: number; y: number },
  view: LinkPointerView,
  deps: EditorLinkDeps,
): void {
  const moved = Math.abs(event.clientX - start.x) > DRAG_SLOP_PX || Math.abs(event.clientY - start.y) > DRAG_SLOP_PX;
  if (moved) return; // FR-165e — a drag, never a click
  const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (pos === null) return;
  const hit = linkAtPosition(view.state, pos, deps);
  if (!hit) return;
  const projectRoot = deps.projectRoot?.() ?? null;
  const destination: LinkHoverDestination =
    hit.kind === 'web'
      ? uriHoverDestination(hit.uri)
      : linkDestinationByName({
          text: hit.request.text,
          projectRoot,
          baseDirectory: hit.request.baseDirectory,
          openTarget: deps.openTarget?.() ?? 'lastActive',
          previewRegistry: deps.previewRegistry?.(),
          previewSettings: deps.previewSettings?.(),
          hasPosition: hit.position !== undefined,
        });
  const rect = view.coordsAtPos(hit.to, -1);
  const anchor = rect
    ? linkHintAnchor(rect)
    : { left: event.clientX, top: event.clientY, right: event.clientX, bottom: event.clientY };
  showLinkHint({
    text: linkHoverText(destination, linkModifierLabel()),
    anchor,
    // FR-165d (review round four, I4): this panel's, so its destroy takes the hint with it.
    owner: deps.site().panelId,
  });
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

      constructor(view: EditorView) {
        // FR-155: the marks are a pure function of the text in view — there is no answer to wait for,
        // so nothing outside an update can change them.
        this.decorations = buildLinkDecorations(view, deps);
      }

      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.transactions.length > 0) {
          this.decorations = buildLinkDecorations(update.view, deps);
        }
      }
    },
    { decorations: (plugin) => plugin.decorations },
  );
}
