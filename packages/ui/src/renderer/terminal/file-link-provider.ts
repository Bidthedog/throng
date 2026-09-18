import {
  MAX_LINK_CANDIDATES_PER_LINE,
  detectPathCandidates,
  type LinkCandidate,
  type LinkPosition,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
  type Span,
} from '@throng/core';
import { TERMINAL_URL_REGEX } from './terminal-url.js';
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
 * ══ IT NEVER WAITS ══
 *
 * `ask` is synchronous and answers `undefined` for anything not already resolved (FR-071). A row of
 * fresh output therefore draws nothing on its first pass, fills the cache, and draws on the next —
 * which is a frame later for the row under the pointer, and invisible. Awaiting here would block the
 * pointer on a network share, which is the one thing FR-071 forbids outright.
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

/** A global copy of the addon's own pattern — the source of truth for where a url ends (FR-009). */
const URL_SCANNER = new RegExp(TERMINAL_URL_REGEX.source, 'g');

export function createFileLinkProvider(deps: FileLinkProviderDeps): FileLinkProvider {
  return {
    provideLinks(bufferLineNumber, callback) {
      // xterm counts buffer lines from 1; the buffer API indexes from 0.
      const row = deps.terminal.buffer.active.getLine(bufferLineNumber - 1)?.translateToString(true);
      if (row === undefined || row.length === 0) {
        callback(undefined);
        return;
      }

      const candidates = detectPathCandidates(row, claimedByWebLinks(row)).slice(
        0,
        MAX_LINK_CANDIDATES_PER_LINE,
      );
      if (candidates.length === 0) {
        callback(undefined);
        return;
      }

      const site = deps.site();
      const links: ProvidedLink[] = [];
      const taken: Span[] = [];
      for (const candidate of candidates) {
        if (overlapsAny(candidate, taken)) continue; // R7: one reading of a span wins
        const request = terminalLinkRequest({ text: candidate.text, kind: 'detectedPath', site });
        const resolution = deps.ask(request);
        if (resolution?.ok !== true) continue; // FR-006 / FR-071: not a link (yet)
        taken.push({ start: candidate.start, end: candidate.end });
        links.push(linkFor(candidate, bufferLineNumber, request, resolution.link, deps));
      }

      callback(links.length > 0 ? links : undefined);
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
  const hovered: HoveredLink = { kind: 'file', link, request };
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

/** Every range the web-link pattern matches in this row (FR-009). */
function claimedByWebLinks(row: string): Span[] {
  const claimed: Span[] = [];
  URL_SCANNER.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = URL_SCANNER.exec(row)) !== null) {
    claimed.push({ start: match.index, end: match.index + match[0].length });
    // A zero-length match would spin here; the pattern cannot produce one, but the guard is cheap.
    if (match[0].length === 0) URL_SCANNER.lastIndex += 1;
  }
  return claimed;
}

function overlapsAny(span: Span, ranges: readonly Span[]): boolean {
  return ranges.some((r) => span.start < r.end && r.start < span.end);
}
