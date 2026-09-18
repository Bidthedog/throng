import {
  MAX_LINK_CANDIDATES_PER_LINE,
  scanLinkLine,
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
 * Detected paths in terminal output, as an xterm link provider (045 FR-001, FR-003 – FR-009).
 *
 * This is the repository's FIRST `registerLinkProvider`, and the choice of mechanism is the whole of
 * FR-071 and FR-072. xterm calls `provideLinks` for the row it is about to decorate and for the row
 * under the pointer — never for output as it arrives. So the terminal's data path carries no
 * existence check by CONSTRUCTION rather than by care, and a change that put one there would have to
 * add a subscription this module conspicuously does not have. `terminal-file-link-provider.test.ts`
 * asserts exactly that, with a fake terminal that records every subscription made on it.
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
 * This module used to answer `undefined` the instant the cache missed — which is every FIRST hover
 * on a path, since that hover is what fires the request. The resolution landed milliseconds later
 * and nothing asked again, so the user rested the pointer on a real path and got no underline, no
 * tooltip and a dead Ctrl+click until they moved off the line and back. The comment that used to
 * sit here called that "a frame later"; there was no later.
 *
 * A held reply is bounded by {@link LINK_ANSWER_DEADLINE_MS} and delivered exactly once. A reply
 * superseded by a newer `provideLinks` call is DROPPED rather than delivered late: xterm replaces
 * its reply map when the pointer changes line, so a stale answer would be filed against the line the
 * pointer has moved to.
 *
 * ══ WHAT IT REFUSES ══
 *
 * - **Spans the web-link scanner owns** (FR-009). A url's own path segment (`…/src/foo.ts`) is
 *   path-shaped, so without the claim the same characters would be underlined twice and the file
 *   link would sometimes win the click. The claimed ranges come from the SAME pattern the
 *   `WebLinksAddon` is loaded with, so the two cannot disagree about where a url ends.
 * - **The second reading of an ambiguous span** (R7). `foo.ts:42` is emitted twice by detection —
 *   positioned first, then whole — and whichever resolves decides. Both resolving would put two
 *   overlapping links on one span, so the first to resolve keeps it.
 * - **Everything past the per-line cap** (FR-071), before any of it is resolved.
 */

/** The slice of xterm's `Terminal` this reads. Nothing is subscribed to — see the header. */
export interface LinkProviderTerminal {
  readonly buffer: {
    readonly active: {
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
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
  activate(event: MouseEvent, text: string): void;
  hover(event: MouseEvent, text: string): void;
  leave(): void;
}

export interface FileLinkProviderDeps {
  readonly terminal: LinkProviderTerminal;
  /**
   * FR-060 — `editor.links.detectInTerminals`, read PER ROW.
   *
   * The whole switch, and the only place it belongs: this module is where throng GUESSES that a run
   * of characters is a path, and that guess is the only thing the setting is about. A program's own
   * OSC 8 target and a web url are declarations rather than guesses, so they go on working — and
   * they go on working by construction, because nothing about them passes through here.
   *
   * A reader rather than a value because the provider is registered once against a live shell and
   * cannot be re-registered without one; SC-008 requires the change to land on the next hover.
   */
  readonly detect: () => boolean;
  /** Re-read per row, so a `cd` between two hovers changes what a relative path means (FR-023). */
  readonly site: () => TerminalLinkSite;
  /** `askTerminalLink` — peek, and fire a request when the answer is not here yet. */
  readonly ask: (request: LinkResolutionRequest) => LinkResolution | undefined;
  readonly onHover: (hovered: HoveredLink | null, event?: MouseEvent) => void;
  readonly follow: (args: {
    readonly request: LinkResolutionRequest;
    readonly position?: LinkPosition;
  }) => void;
}

export interface FileLinkProvider {
  provideLinks(bufferLineNumber: number, callback: (links: ProvidedLink[] | undefined) => void): void;
}

/**
 * How long a held reply waits for its outstanding resolutions before answering with what it has.
 *
 * Not a performance budget — a resolution is a `stat` in the main process and answers in under a
 * millisecond. It is the backstop for an answer that never arrives at all: a rejected invoke, a
 * missing bridge, a path on a share that has gone away. Without it xterm would hold an empty slot
 * for that line and `_removeIntersectingLinks` would never run on it.
 *
 * A second is far past anything healthy and still inside FR-071's own tolerance, which says a
 * location that takes too long to answer is treated as not a link until it does.
 */
export const LINK_ANSWER_DEADLINE_MS = 1_000;

export function createFileLinkProvider(deps: FileLinkProviderDeps): FileLinkProvider {
  /*
   * Which `provideLinks` call is current. xterm throws its reply map away and asks every provider
   * again the moment the pointer changes line, so a held reply from the previous line must be
   * dropped — delivered, it would be filed against the line the pointer is on now.
   */
  let generation = 0;

  return {
    provideLinks(bufferLineNumber, callback) {
      const mine = (generation += 1);
      // FR-060, before the row is even read: with detection off there is no link to draw, no hover
      // to report and therefore no file-link items in the menu either — the whole surface goes,
      // rather than an underline being withheld from something a click could still follow.
      if (!deps.detect()) {
        callback(undefined);
        return;
      }
      // xterm counts buffer lines from 1; the buffer API indexes from 0.
      const row = deps.terminal.buffer.active.getLine(bufferLineNumber - 1)?.translateToString(true);
      if (row === undefined || row.length === 0) {
        callback(undefined);
        return;
      }

      // FR-009 / D9: the web spans are claimed inside `scanLinkLine`, the one line scan both panel
      // types share (FR-104), so no path candidate overlaps a url.
      const candidates = scanLinkLine(row).paths.slice(
        0,
        MAX_LINK_CANDIDATES_PER_LINE,
      );
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }

      const site = deps.site();
      /*
       * One pass over the row's candidates. Re-run from scratch whenever an answer lands, rather
       * than patched: a span whose POSITIONED reading was still pending must be able to take the
       * span back from the whole-token reading that resolved first (R7), and rebuilding is the only
       * way that ordering survives an answer arriving out of order.
       */
      const sweep = (): { links: ProvidedLink[]; pending: number } => {
        const links: ProvidedLink[] = [];
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
          links.push(linkFor(candidate, bufferLineNumber, request, resolution.link, deps));
        }
        return { links, pending };
      };

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
      const deadline = setTimeout(() => answer(sweep().links), LINK_ANSWER_DEADLINE_MS);
      const unsubscribe = subscribeLinkCache(() => {
        const next = sweep();
        if (next.pending > 0) return; // still waiting on another candidate in the same row
        answer(next.links);
      });
    },
  };
}

function linkFor(
  candidate: LinkCandidate,
  y: number,
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
    // xterm's range is 1-based and INCLUSIVE at both ends; the candidate's is 0-based and half-open.
    range: { start: { x: candidate.start + 1, y }, end: { x: candidate.end, y } },
    text: candidate.text,
    activate: (event) => {
      // FR-040: Ctrl/Cmd, or the press belongs to the terminal exactly as it does today.
      if (!(event.ctrlKey || event.metaKey)) return;
      deps.follow({ request, ...(position === undefined ? {} : { position }) });
    },
    hover: (event) => deps.onHover(hovered, event),
    leave: () => deps.onHover(null),
  };
}

function overlapsAny(span: Span, ranges: readonly Span[]): boolean {
  return ranges.some((r) => span.start < r.end && r.start < span.end);
}
