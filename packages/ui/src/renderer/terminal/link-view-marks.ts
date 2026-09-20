import {
  LINK_MARK_THROTTLE_MS,
  MAX_LINK_CANDIDATES_PER_LINE,
  scanLinkLine,
  type EditorLinkSettings,
  type ScannedLine,
} from '@throng/core';
import { linkScanOptions } from '../links/link-scan-options.js';
import { namesTerminalDirectory } from './terminal-link-activation.js';
import type { MarkedLink } from './link-marks.js';
import { rangeOf, type CellRange, type LogicalLine } from './logical-line.js';

/**
 * The terminal's marks AT REST, as a pure function of the rows in view — 045 FR-136, FR-155, FR-172
 * (data-model §16.5, §16.9; D5).
 *
 * ══ WHAT IT REPLACES, AND WHY ══
 *
 * The idle scan (§14.2, deleted by T264) marked the view only once the output had been QUIET for a
 * while, because it asked main whether each path existed and FR-071 forbade asking while output
 * streamed. Claude Code's full-screen UI never goes quiet — its spinner repaints every 50 ms — so no
 * link on its screen was ever marked (D5). Round four made a link's validity syntactic (FR-155): there
 * is nothing left to ask, so there is nothing to wait for.
 *
 * So a pass is cheap and pure: read the logical lines in view, run the grammar over each
 * (`scanLinkLine` with the user's options — `scan`), take xterm's OSC 8 ranges for the same rows
 * (`oscLinksInView`), and hand the lot to `draw`. No ask, no cache.
 *
 * ══ WHEN A PASS RUNS ══
 *
 *   | xterm rendered rows (a write, a scroll, a resize) | a pass, at most one per `LINK_MARK_THROTTLE_MS`,  |
 *   |                                                   | with a GUARANTEED trailing pass after the last   |
 *   | the active buffer switched (`?1049h` / `?1049l`)  | `clear`, then a pass at once — no mark drawn in  |
 *   |                                                   | the other buffer survives the switch             |
 *   | mounted, or `refresh()` (a setting changed)        | a pass (throttled like a render)                 |
 *
 * A stream that never stops is therefore marked within one interval of any row changing, which is
 * FR-172's bound. The trailing pass is what makes "the last write" safe: a render inside an interval
 * is never dropped, only folded into the pass that ends it.
 */
export interface LinkViewMarksDeps {
  /** xterm's `onRender` — rows were drawn. Returns the unsubscribe. */
  readonly onRender: (listener: () => void) => () => void;
  /** xterm's `buffer.onBufferChange`. Returns the unsubscribe. */
  readonly onBufferChange: (listener: () => void) => () => void;
  /** Every logical line with a row in view, read from the ACTIVE buffer (`logicalLinesBetween`). */
  readonly logicalLinesInView: () => readonly LogicalLine[];
  /**
   * One logical line's links: `scanLinkLine` with the user's CURRENT options, read per call so a
   * settings edit lands on the next pass (FR-159, FR-178). The caller returns nothing at all while
   * detection in terminals is off (FR-060, round five).
   */
  readonly scan: (text: string) => Pick<ScannedLine, 'web' | 'protocol' | 'paths'>;
  /**
   * xterm's OSC 8 ranges for the rows in view (§16.9), already judged by the caller: only a target
   * that may be a link is returned — and, round five, none at all while detection is off, since the
   * setting governs a declared hyperlink exactly as it governs a guessed path.
   */
  readonly oscLinksInView: () => readonly { readonly range: CellRange; readonly uri: string }[];
  /** Mark exactly these links — `link-marks.ts` through the caller. */
  readonly draw: (links: readonly MarkedLink[]) => void;
  /** Drop every mark (a buffer switch). */
  readonly clear: () => void;
  readonly now?: () => number;
  readonly schedule?: (fn: () => void, ms: number) => () => void;
}

export interface LinkViewMarks {
  /** Ask for a pass — throttled exactly like a render. For a change the rows cannot show (a setting). */
  refresh(): void;
  dispose(): void;
}

/**
 * The terminal's `scan` — 045 FR-060, FR-159, FR-178, FR-178a (T249, terminal half).
 *
 * `scanLinkLine` with the user's known-extension edits and allowlist (`linkScanOptions`, the one place
 * the renderer turns the stored edits into sets, shared with the editor). Every reader is called PER
 * LINE, never captured, so an edit lands on the next pass with nothing remounted.
 *
 * Two round-five changes, both matching the provider so the mark at rest and the hover cannot
 * disagree about a span:
 *
 *  - `detect` off now yields NOTHING — not "paths dropped, urls kept". The setting is the whole
 *    terminal's (FR-060, and `file-link-provider.ts`'s header for why).
 *  - `cwd` is the gated working directory, turned into the space rule's one permitted input
 *    (`namesTerminalDirectory`), so a prompt naming a folder with a space in it is marked whole.
 */
export function terminalViewScan(read: {
  readonly links: () => Pick<EditorLinkSettings, 'protocolAllowlist' | 'knownFileExtensions'>;
  readonly detect: () => boolean;
  /** FR-023's gated cwd (`terminalLinkBaseDirectory`), as a reader. Absent: the grammar alone. */
  readonly cwd?: () => string | undefined;
}): LinkViewMarksDeps['scan'] {
  return (text) => {
    if (!read.detect()) return NOTHING_SCANNED;
    const namesKnownDirectory = namesTerminalDirectory(read.cwd?.());
    return scanLinkLine(text, {
      ...linkScanOptions(read.links()),
      ...(namesKnownDirectory === undefined ? {} : { namesKnownDirectory }),
    });
  };
}

const NOTHING_SCANNED: Pick<ScannedLine, 'web' | 'protocol' | 'paths'> = {
  web: [],
  protocol: [],
  paths: [],
};

export function createLinkViewMarks(deps: LinkViewMarksDeps): LinkViewMarks {
  const now = deps.now ?? (() => Date.now());
  const schedule =
    deps.schedule ??
    ((fn: () => void, ms: number) => {
      const timer = setTimeout(fn, ms);
      return () => clearTimeout(timer);
    });

  let disposed = false;
  let lastPass = Number.NEGATIVE_INFINITY;
  /** The trailing pass, while one is scheduled. */
  let cancelTrailing: (() => void) | null = null;

  const collect = (): MarkedLink[] => {
    const links: MarkedLink[] = [];
    for (const line of deps.logicalLinesInView()) {
      const scanned = deps.scan(line.text);
      // FR-159 / FR-060a: an allowlisted protocol link is marked as a web url is — a declared address.
      // L2: capped like the paths below — the bound is on WORK, and a mark costs the same whichever
      // scanner produced the span.
      for (const span of [...scanned.web, ...scanned.protocol].slice(0, MAX_LINK_CANDIDATES_PER_LINE)) {
        links.push({ kind: 'web', text: span.uri, range: rangeOf(line, span) });
      }
      // The per-line cap (FR-071's bound on work, kept): a line of ten thousand dotted words is still
      // one line's worth of marks.
      // R7: `foo.ts:42` comes back twice, positioned first, then whole. With nothing resolved there
      // is nothing to choose between them, so the first reading of a span keeps it — one mark per span.
      const taken: { start: number; end: number }[] = [];
      for (const candidate of scanned.paths.slice(0, MAX_LINK_CANDIDATES_PER_LINE)) {
        if (taken.some((t) => candidate.start < t.end && t.start < candidate.end)) continue;
        taken.push(candidate);
        links.push({ kind: 'file', text: candidate.text, range: rangeOf(line, candidate) });
      }
    }
    for (const osc of deps.oscLinksInView()) {
      links.push({ kind: 'osc8', text: osc.uri, uri: osc.uri, range: osc.range });
    }
    return links;
  };

  const pass = (): void => {
    cancelTrailing = null;
    if (disposed) return;
    lastPass = now();
    deps.draw(collect());
  };

  const request = (): void => {
    if (disposed || cancelTrailing !== null) return; // the scheduled pass will read these rows too
    const wait = lastPass + LINK_MARK_THROTTLE_MS - now();
    if (wait <= 0) pass();
    else cancelTrailing = schedule(pass, wait);
  };

  const offRender = deps.onRender(request);
  const offBuffer = deps.onBufferChange(() => {
    if (disposed) return;
    cancelTrailing?.();
    cancelTrailing = null;
    deps.clear();
    pass();
  });

  request();

  return {
    refresh: request,
    dispose() {
      disposed = true;
      cancelTrailing?.();
      cancelTrailing = null;
      offRender();
      offBuffer();
    },
  };
}
