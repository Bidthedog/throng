import {
  MAX_LINK_CANDIDATES_PER_LINE,
  scanLinkLine,
  type EditorLinkSettings,
  type LinkCandidate,
  type LinkPosition,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
  type Span,
} from '@throng/core';
import { subscribeLinkCache } from '../links/link-cache.js';
import { terminalLinkRequest, type TerminalLinkSite } from './terminal-link-activation.js';
import type { HoveredLink } from './hovered-link.js';

/**
 * Detected paths AND web urls in terminal output, as an xterm link provider (045 FR-001,
 * FR-003 – FR-009, FR-130 – FR-133).
 *
 * This is the repository's FIRST `registerLinkProvider`, and the choice of mechanism is the whole of
 * FR-071 and FR-072. xterm calls `provideLinks` for the row it is about to decorate and for the row
 * under the pointer — never for output as it arrives. So the terminal's data path carries no
 * existence check by CONSTRUCTION rather than by care, and a change that put one there would have to
 * add a subscription this module conspicuously does not have. `terminal-file-link-provider.test.ts`
 * asserts exactly that, with a fake terminal that records every subscription made on it.
 *
 * ══ IT READS THE LOGICAL LINE, NOT THE ROW (FR-130 – FR-133, #326) ══
 *
 * A path or url the terminal soft-wrapped is ONE link. The row xterm asks about is widened to the
 * logical line it belongs to — up through every row marked `isWrapped`, down through every row after
 * it that is — scanned once, and each span is mapped back to cells, so a link's range may start and
 * end on different rows and `provideLinks` for ANY of its rows returns the same link. A row broken by
 * a real newline is not `isWrapped`, so it is never joined (FR-132). The joining happens only when a
 * row is asked about, never as output arrives (FR-133).
 *
 * ══ AND IT SERVES THE WEB SPANS TOO ══
 *
 * `WebLinksAddon` is no longer loaded (plan.md Complexity Tracking, second round). The web spans come
 * from the same `scanLinkLine` that claims them away from the path grammar (FR-009), so there is one
 * scanner for both kinds and they cannot disagree about where a url ends. A web span is not resolved
 * by main (contract §6.1) and is never gated by `detectInTerminals`, which is about GUESSED paths only
 * (FR-060).
 *
 * ══ IT DOES NOT BLOCK, BUT IT DOES HOLD ITS REPLY ══
 *
 * `ask` is synchronous and answers `undefined` for anything not already resolved (FR-071), so
 * nothing here ever waits on a disk or a network share. What it does do is hold the REPLY TO XTERM
 * until its answers are in, and that is not the same thing — no output, no keystroke, no pointer
 * movement and no repaint is behind it; only one callback xterm is perfectly happy to receive late.
 *
 * It has to, because **xterm asks once per line and keeps the answer**. `Linkifier._askForLink`
 * stores each provider's reply in `_activeProviderReplies`; every subsequent hover on that same line
 * takes its `useLineCache` branch, which reads the stored reply and does not call the provider again
 * (its own TODO says as much). A reply is therefore final for that line, not a first draft.
 *
 * FR-123 / O7 (research.md R19): the hold lasts as long as the EXISTENCE-CHECK TIMEOUT — read from
 * the setting on every ask — because main answers every check within that timeout, `unreachable`
 * included. A separate, shorter constant would let a slow-but-healthy share answer after the reply
 * had gone out empty, and that answer would be filed nowhere. Only a caller that offers no settings
 * falls back to {@link LINK_ANSWER_DEADLINE_MS}. A reply superseded by a newer `provideLinks` call is
 * DROPPED rather than delivered late: xterm replaces its reply map when the pointer changes line, so
 * a stale answer would be filed against the line the pointer has moved to.
 *
 * ══ WHAT IT REFUSES ══
 *
 * - **Path candidates inside a web span** (FR-009) — claimed by `scanLinkLine`.
 * - **The second reading of an ambiguous span** (R7). `foo.ts:42` is emitted twice by detection —
 *   positioned first, then whole — and whichever resolves decides. Both resolving would put two
 *   overlapping links on one span, so the first to resolve keeps it.
 * - **Everything past the per-line cap** (FR-071), before any of it is resolved — counted over the
 *   candidates on the row asked about, so a long wrapped line cannot starve the row under the pointer.
 */

/** The slice of an xterm buffer line this reads. */
export interface LinkProviderLine {
  translateToString(trimRight?: boolean): string;
  /** True on a row that CONTINUES the one above it — a soft wrap, never a real newline (FR-132). */
  readonly isWrapped?: boolean;
}

/** The slice of xterm's `Terminal` this reads. Nothing is subscribed to — see the header. */
export interface LinkProviderTerminal {
  readonly buffer: {
    readonly active: {
      getLine(index: number): LinkProviderLine | undefined;
    };
  };
}

/** xterm's `ILink`, as much of it as this produces. */
export interface ProvidedLink {
  readonly range: {
    readonly start: { readonly x: number; readonly y: number };
    readonly end: { readonly x: number; readonly y: number };
  };
  readonly text: string;
  /** Which of the two this is — the terminal's marks and menus read it; xterm ignores it. */
  readonly kind: 'file' | 'web';
  /**
   * xterm's own hover underline and pointer are OFF for every link this serves: throng draws the one
   * affordance itself, as decorations, in the theme's link colours (FR-135, FR-139; `link-marks.ts`).
   */
  readonly decorations: { readonly underline: boolean; readonly pointerCursor: boolean };
  activate(event: MouseEvent, text: string): void;
  hover(event: MouseEvent, text: string): void;
  leave(): void;
}

export interface FileLinkProviderDeps {
  readonly terminal: LinkProviderTerminal;
  /**
   * FR-060 — `editor.links.detectInTerminals`, read PER ROW.
   *
   * The switch covers GUESSED paths only: this module is where throng guesses that a run of
   * characters is a path, and that guess is the only thing the setting is about. A web url and a
   * program's own OSC 8 target are declarations rather than guesses, so they go on working.
   *
   * A reader rather than a value because the provider is registered once against a live shell and
   * cannot be re-registered without one; SC-008 requires the change to land on the next hover.
   */
  readonly detect: () => boolean;
  /** Re-read per row, so a `cd` between two hovers changes what a relative path means (FR-023). */
  readonly site: () => TerminalLinkSite;
  /** `askTerminalLink` — peek, and fire a request when the answer is not here yet. */
  readonly ask: (request: LinkResolutionRequest) => LinkResolution | undefined;
  /** The hovered link, and the range it occupies — the marks put every row of it in hover (FR-131). */
  readonly onHover: (
    hovered: HoveredLink | null,
    event?: MouseEvent,
    range?: ProvidedLink['range'],
  ) => void;
  readonly follow: (args: {
    readonly request: LinkResolutionRequest;
    readonly position?: LinkPosition;
  }) => void;
  /**
   * A Ctrl+click on a web span — 024's route out of the app, gated on the modifier by the caller
   * exactly as the OSC 8 route is. Absent: a web span is drawn and hovered but opens nothing.
   */
  readonly openWeb?: (event: MouseEvent, uri: string) => void;
  /**
   * FR-120 / FR-123 — the link settings, read PER ASK, on the resolver's `readLinkSettings` shape.
   * The held reply waits `existenceCheckTimeoutMs`. Absent: {@link LINK_ANSWER_DEADLINE_MS}.
   */
  readonly readLinkSettings?: () => EditorLinkSettings;
}

export interface FileLinkProvider {
  provideLinks(bufferLineNumber: number, callback: (links: ProvidedLink[] | undefined) => void): void;
  /**
   * The links on a row RIGHT NOW, asking about any that are not answered yet but never holding —
   * the idle scan's reading (FR-137). It takes no part in the superseding of held replies, so a scan
   * over many rows cannot drop the reply xterm is waiting for.
   */
  linksOnLine(bufferLineNumber: number): ProvidedLink[];
}

/**
 * How long a held reply waits for its outstanding resolutions when the caller offers no settings.
 *
 * The terminal itself always offers them (FR-123): the wait is then the existence-check timeout,
 * because main answers every check within it. This remains for a caller with no settings to read —
 * the backstop for an answer that never arrives at all: a rejected invoke, a missing bridge.
 */
export const LINK_ANSWER_DEADLINE_MS = 1_000;

/**
 * How far the logical line is followed from the row asked about, each way.
 *
 * A bound, because a single logical line can be enormous — a minified bundle printed in one write
 * wraps into thousands of rows — and a hover must not scan all of it. Two hundred rows is several
 * screens of one line and far past any path or url a person would follow.
 */
const MAX_WRAPPED_ROWS = 200;

/** One logical line: its text, and where each of its rows starts in that text. */
interface LogicalLine {
  readonly text: string;
  /** 1-based buffer line of the first row. */
  readonly firstY: number;
  /** Offset into `text` at which each row starts. */
  readonly rowStarts: readonly number[];
}

export function createFileLinkProvider(deps: FileLinkProviderDeps): FileLinkProvider {
  /*
   * Which `provideLinks` call is current. xterm throws its reply map away and asks every provider
   * again the moment the pointer changes line, so a held reply from the previous line must be
   * dropped — delivered, it would be filed against the line the pointer is on now.
   */
  let generation = 0;

  /**
   * One pass over a row's candidates. Re-run from scratch whenever an answer lands, rather than
   * patched: a span whose POSITIONED reading was still pending must be able to take the span back
   * from the whole-token reading that resolved first (R7), and rebuilding is the only way that
   * ordering survives an answer arriving out of order.
   */
  const reading = (bufferLineNumber: number): (() => { links: ProvidedLink[]; pending: number }) | null => {
    const line = logicalLineAt(deps.terminal, bufferLineNumber);
    if (line === null) return null;
    const scanned = scanLinkLine(line.text);
    const onRow = (span: Span): boolean => {
      const first = cellAt(line, span.start).y;
      const last = cellAt(line, span.end - 1).y;
      return first <= bufferLineNumber && bufferLineNumber <= last;
    };
    const web = scanned.web.filter(onRow);
    // FR-060, before anything is asked: with detection off there is no guessed path to draw, hover
    // or put in the menu — the whole surface goes, rather than an underline being withheld from
    // something a click could still follow.
    const candidates = deps.detect()
      ? scanned.paths.filter(onRow).slice(0, MAX_LINK_CANDIDATES_PER_LINE)
      : [];
    if (web.length === 0 && candidates.length === 0) return null;

    const site = deps.site();
    const webLinks = web.map((span) => webLinkFor(span.uri, rangeOf(line, span), deps));
    return () => {
      const links: ProvidedLink[] = [...webLinks];
      const taken: Span[] = [];
      let pending = 0;
      for (const candidate of candidates) {
        if (overlapsAny(candidate, taken)) continue; // R7: one reading of a span wins
        const request = terminalLinkRequest({ text: candidate.text, kind: 'detectedPath', site });
        const resolution = deps.ask(request);
        if (resolution === undefined) {
          pending += 1; // asked, not yet answered — the span is not claimed either way
          continue;
        }
        if (!resolution.ok) continue; // FR-006: a candidate that names nothing is not a link
        taken.push({ start: candidate.start, end: candidate.end });
        links.push(fileLinkFor(candidate, rangeOf(line, candidate), request, resolution.link, deps));
      }
      links.sort((a, b) => a.range.start.y - b.range.start.y || a.range.start.x - b.range.start.x);
      return { links, pending };
    };
  };

  return {
    linksOnLine(bufferLineNumber) {
      return reading(bufferLineNumber)?.().links ?? [];
    },

    provideLinks(bufferLineNumber, callback) {
      const mine = (generation += 1);
      const sweep = reading(bufferLineNumber);
      if (sweep === null) {
        callback(undefined);
        return;
      }

      const first = sweep();
      if (first.pending === 0) {
        callback(first.links.length > 0 ? first.links : undefined);
        return;
      }

      // Held. See the header: replying `undefined` here is the answer xterm would keep for the whole
      // line, so the first hover on a path would never become a link.
      let answered = false;
      // Declared before the two it tears down, and called by neither of them before both exist:
      // the timer fires on a later turn and the subscription on a resolution, which is a microtask
      // away at the very soonest.
      const answer = (links: ProvidedLink[]): void => {
        if (answered) return; // exactly one reply per ask, whichever route gets here first
        answered = true;
        unsubscribe();
        clearTimeout(deadline);
        if (mine !== generation) return; // superseded: xterm has moved to another line
        callback(links.length > 0 ? links : undefined);
      };
      // FR-123 — as long as main can take to answer, read now so a changed setting applies.
      const waitMs = deps.readLinkSettings?.().existenceCheckTimeoutMs ?? LINK_ANSWER_DEADLINE_MS;
      const deadline = setTimeout(() => answer(sweep().links), waitMs);
      const unsubscribe = subscribeLinkCache(() => {
        const next = sweep();
        if (next.pending > 0) return; // still waiting on another candidate in the same row
        answer(next.links);
      });
    },
  };
}

/**
 * The logical line holding 1-based buffer line `y`, or `null` for a row the buffer does not hold or
 * one with nothing on it.
 *
 * Every row but the last is read UNTRIMMED: a wrapped row is full-width by definition, and trimming a
 * trailing space off it would shift every offset after it by one. The last is trimmed, as a single
 * row always was.
 */
function logicalLineAt(terminal: LinkProviderTerminal, y: number): LogicalLine | null {
  const buffer = terminal.buffer.active;
  const index = y - 1; // xterm counts buffer lines from 1; the buffer API indexes from 0
  const asked = buffer.getLine(index);
  if (asked === undefined) return null;

  let first = index;
  while (first > 0 && index - first < MAX_WRAPPED_ROWS && buffer.getLine(first)?.isWrapped === true) {
    first -= 1;
  }
  let last = index;
  while (last - index < MAX_WRAPPED_ROWS && buffer.getLine(last + 1)?.isWrapped === true) last += 1;

  const rowStarts: number[] = [];
  let text = '';
  for (let row = first; row <= last; row += 1) {
    rowStarts.push(text.length);
    text += buffer.getLine(row)?.translateToString(row === last) ?? '';
  }
  if (text.trim().length === 0) return null;
  return { text, firstY: first + 1, rowStarts };
}

/** xterm's 1-based cell for a 0-based offset into a logical line. */
function cellAt(line: LogicalLine, offset: number): { x: number; y: number } {
  let row = 0;
  while (row + 1 < line.rowStarts.length && (line.rowStarts[row + 1] as number) <= offset) row += 1;
  return { x: offset - (line.rowStarts[row] as number) + 1, y: line.firstY + row };
}

/** xterm's range is 1-based and INCLUSIVE at both ends; a span is 0-based and half-open. */
function rangeOf(line: LogicalLine, span: Span): ProvidedLink['range'] {
  return { start: cellAt(line, span.start), end: cellAt(line, span.end - 1) };
}

const NO_XTERM_DECORATIONS = { underline: false, pointerCursor: false } as const;

function webLinkFor(uri: string, range: ProvidedLink['range'], deps: FileLinkProviderDeps): ProvidedLink {
  const hovered: HoveredLink = { kind: 'web', uri };
  return {
    kind: 'web',
    range,
    text: uri,
    decorations: { ...NO_XTERM_DECORATIONS },
    activate: (event) => deps.openWeb?.(event, uri),
    hover: (event) => deps.onHover(hovered, event, range),
    leave: () => deps.onHover(null),
  };
}

function fileLinkFor(
  candidate: LinkCandidate,
  range: ProvidedLink['range'],
  request: LinkResolutionRequest,
  link: ResolvedLink,
  deps: FileLinkProviderDeps,
): ProvidedLink {
  const position = candidate.position;
  // The position travels on the HOVERED value as well as on the follow: the context menu composes
  // from what the pointer rests on, and Open in Editor and Copy Link Address both need it (FR-032,
  // FR-033).
  const hovered: HoveredLink = {
    kind: 'file',
    link,
    request,
    ...(position === undefined ? {} : { position }),
    ...(candidate.positionText === undefined ? {} : { positionText: candidate.positionText }),
  };
  return {
    kind: 'file',
    range,
    text: candidate.text,
    decorations: { ...NO_XTERM_DECORATIONS },
    activate: (event) => {
      // FR-040: Ctrl/Cmd, or the press belongs to the terminal exactly as it does today.
      if (!(event.ctrlKey || event.metaKey)) return;
      deps.follow({ request, ...(position === undefined ? {} : { position }) });
    },
    hover: (event) => deps.onHover(hovered, event, range),
    leave: () => deps.onHover(null),
  };
}

function overlapsAny(span: Span, ranges: readonly Span[]): boolean {
  return ranges.some((r) => span.start < r.end && r.start < span.end);
}
