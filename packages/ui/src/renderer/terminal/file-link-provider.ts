import {
  MAX_LINK_CANDIDATES_PER_LINE,
  scanLinkLine,
  type LinkCandidate,
  type LinkPosition,
  type LinkResolutionRequest,
  type ScanOptions,
  type Span,
} from '@throng/core';
import {
  namesTerminalDirectory,
  terminalLinkRequest,
  type TerminalLinkSite,
} from './terminal-link-activation.js';
import type { HoveredLink } from './hovered-link.js';
import { cellAt, logicalLineAt, rangeOf } from './logical-line.js';

/**
 * Detected paths AND web urls in terminal output, as an xterm link provider (045 FR-001,
 * FR-003 – FR-009, FR-130 – FR-133).
 *
 * This is the repository's FIRST `registerLinkProvider`, and the choice of mechanism is the whole of
 * FR-072: xterm calls `provideLinks` for the row it is about to decorate and for the row under the
 * pointer — never for output as it arrives. `terminal-file-link-provider.test.ts` asserts it has no
 * subscription on the data path, with a fake terminal that records every one made on it.
 *
 * ══ VALIDITY IS SYNTACTIC, SO THE ANSWER IS SYNCHRONOUS (round four, FR-155, SC-021) ══
 *
 * A link is a link when the grammar says so — whether anything exists at it is decided when it is
 * FOLLOWED (FR-160), by one `throng:links:follow`. So `provideLinks` answers xterm at once, from
 * `scanLinkLine`, asking main nothing: no existence check, no held reply, no deadline, no superseding.
 * (It used to hold its reply for the existence-check timeout, because xterm keeps the first reply per
 * line and an unanswered path would otherwise never become a link; with nothing to wait for, that
 * machinery is gone, and a path on an offline share is drawn as promptly as any other.)
 *
 * ══ IT READS THE LOGICAL LINE, NOT THE ROW (FR-130 – FR-133, #326) ══
 *
 * A path or url the terminal soft-wrapped is ONE link. The row xterm asks about is widened to the
 * logical line it belongs to — up through every row marked `isWrapped`, down through every row after
 * it that is — scanned once, and each span is mapped back to cells, so a link's range may start and
 * end on different rows and `provideLinks` for ANY of its rows returns the same link. A row broken by
 * a real newline is not `isWrapped`, so it is never joined (FR-132).
 *
 * ══ AND IT SERVES THE WEB SPANS TOO ══
 *
 * The web and allowlisted-protocol spans come from the same `scanLinkLine` that claims them away from
 * the path grammar (FR-009), so there is one scanner for every kind.
 *
 * ══ AND `detectInTerminals` NOW GOVERNS ALL OF THEM (round five, FR-060) ══
 *
 * It used to gate GUESSED paths only, leaving web urls, allowlisted protocol links and a program's
 * own OSC 8 hyperlinks working with it off. The maintainer's rule is simpler and is what the setting
 * reads like: on, every kind of link is shown; off, this terminal has no links at all. So the gate is
 * the first line of `linksOnLine` rather than a clause around the path half, and use-terminal applies
 * the same answer to the OSC 8 seams this provider never sees.
 *
 * ══ WHAT IT REFUSES ══
 *
 * - **Path candidates inside a web span** (FR-009) — claimed by `scanLinkLine`.
 * - **The second reading of an ambiguous span** (R7). `foo.ts:42` is emitted twice by detection —
 *   positioned first, then whole. With nothing resolved there is nothing to choose between them, so
 *   the first reading of a span keeps it, exactly as the view pass marks it (`link-view-marks.ts`).
 * - **Everything past the per-line cap** — a bound on WORK, counted over the candidates on the row
 *   asked about, so a long wrapped line cannot starve the row under the pointer.
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
   * Round five: it covers EVERY kind of link in this terminal, not the guessed paths alone — see the
   * header. A reader rather than a value because the provider is registered once against a live
   * shell; SC-008 requires the change to land on the next hover.
   */
  readonly detect: () => boolean;
  /**
   * Re-read per row AND at the click, so a `cd` between the drawing and the Ctrl+click changes what a
   * relative path means (FR-023, FR-144) — and, round five, so the space rule is told the directory
   * the terminal is in as it is NOW (`namesTerminalDirectory`).
   */
  readonly site: () => TerminalLinkSite;
  /** The hovered link, and the range it occupies — the marks put every row of it in hover (FR-131). */
  readonly onHover: (
    hovered: HoveredLink | null,
    event?: MouseEvent,
    range?: ProvidedLink['range'],
  ) => void;
  /** A Ctrl+click on a path: one `throng:links:follow`, through the caller (`followTerminalLink`). */
  readonly follow: (args: { readonly request: LinkResolutionRequest; readonly position?: LinkPosition }) => void;
  /**
   * A Ctrl+click on a web span — 024's route out of the app, gated on the modifier by the caller
   * exactly as the OSC 8 route is. Absent: a web span is drawn and hovered but opens nothing.
   */
  readonly openWeb?: (event: MouseEvent, uri: string) => void;
  /**
   * FR-159, FR-178 — the user's known extensions and allowlist as `scanLinkLine` options, read PER
   * ROW; the terminal's view pass scans with the same (`terminalViewScan`). Absent: the shipped sets.
   */
  readonly scanOptions?: () => ScanOptions;
}

export interface FileLinkProvider {
  provideLinks(bufferLineNumber: number, callback: (links: ProvidedLink[] | undefined) => void): void;
  /** The links on a row right now — what `provideLinks` answers, as a value. */
  linksOnLine(bufferLineNumber: number): ProvidedLink[];
}

export function createFileLinkProvider(deps: FileLinkProviderDeps): FileLinkProvider {
  const linksOnLine = (bufferLineNumber: number): ProvidedLink[] => {
    // FR-060 (round five): the switch is the whole terminal's now, not the guessed half's. Off means
    // this row has no links of any kind — nothing to underline, hover, put in a menu or Ctrl+click.
    if (!deps.detect()) return [];
    const line = logicalLineAt(deps.terminal.buffer.active, bufferLineNumber);
    if (line === null) return [];
    const site = deps.site();
    // Round five: the space rule may be told the directory this terminal is sitting in, so a prompt
    // naming a folder with a space in it is one link. `site.baseDirectory` is already the GATED cwd
    // (`terminalLinkBaseDirectory`), so a flavour that cannot report its directory supplies nothing
    // and the grammar is untouched.
    const namesKnownDirectory = namesTerminalDirectory(site.baseDirectory);
    const scanned = scanLinkLine(line.text, {
      ...(deps.scanOptions?.() ?? {}),
      ...(namesKnownDirectory === undefined ? {} : { namesKnownDirectory }),
    });
    const onRow = (span: Span): boolean => {
      const first = cellAt(line, span.start).y;
      const last = cellAt(line, span.end - 1).y;
      return first <= bufferLineNumber && bufferLineNumber <= last;
    };
    // FR-159 / FR-060a: an allowlisted protocol link (`mailto:` …) is served as a web url is — a
    // declared address, untouched by the detection switch, opened by the same URI route (`openWeb`).
    // L2: the per-line cap bounds DECLARED addresses too, not only guessed paths. `limits.ts`'s
    // rationale — "without a cap each one becomes a mark, a decoration and a hit-test entry inside
    // that callback" — does not care which scanner produced the span, and `detectProtocolSpans` has
    // no cap of its own.
    const web = [...scanned.web, ...scanned.protocol].filter(onRow).slice(0, MAX_LINK_CANDIDATES_PER_LINE);
    const links: ProvidedLink[] = web.map((span) => webLinkFor(span.uri, rangeOf(line, span), deps));
    const taken: Span[] = [];
    for (const candidate of scanned.paths.filter(onRow).slice(0, MAX_LINK_CANDIDATES_PER_LINE)) {
      if (overlapsAny(candidate, taken)) continue; // R7: the first reading of a span keeps it
      taken.push({ start: candidate.start, end: candidate.end });
      links.push(fileLinkFor(candidate, rangeOf(line, candidate), deps));
    }
    return links.sort((a, b) => a.range.start.y - b.range.start.y || a.range.start.x - b.range.start.x);
  };

  return {
    linksOnLine,
    provideLinks(bufferLineNumber, callback) {
      const links = linksOnLine(bufferLineNumber);
      callback(links.length > 0 ? links : undefined);
    },
  };
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

function fileLinkFor(candidate: LinkCandidate, range: ProvidedLink['range'], deps: FileLinkProviderDeps): ProvidedLink {
  const position = candidate.position;
  /** The request main will be asked — built from the site as it is NOW (FR-023). */
  const requestNow = (): LinkResolutionRequest =>
    terminalLinkRequest({ text: candidate.text, kind: 'detectedPath', site: deps.site() });
  return {
    kind: 'file',
    range,
    text: candidate.text,
    decorations: { ...NO_XTERM_DECORATIONS },
    activate: (event) => {
      // FR-040: Ctrl/Cmd, or the press belongs to the terminal exactly as it does today.
      if (!(event.ctrlKey || event.metaKey)) return;
      deps.follow({ request: requestNow(), ...(position === undefined ? {} : { position }) });
    },
    // The position travels on the HOVERED value as well as on the follow: the context menu composes
    // from what the pointer rests on, and Open in Editor and Copy Link to Clipboard both need it (FR-032,
    // FR-033).
    hover: (event) =>
      deps.onHover(
        {
          kind: 'file',
          request: requestNow(),
          ...(position === undefined ? {} : { position }),
          ...(candidate.positionText === undefined ? {} : { positionText: candidate.positionText }),
        },
        event,
        range,
      ),
    leave: () => deps.onHover(null),
  };
}

function overlapsAny(span: Span, ranges: readonly Span[]): boolean {
  return ranges.some((r) => span.start < r.end && r.start < span.end);
}
