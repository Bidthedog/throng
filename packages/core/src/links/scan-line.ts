import { detectPathCandidates, type DetectOptions } from './detect.js';
import {
  DEFAULT_PROTOCOL_ALLOWLIST,
  bareEmailsAreLinks,
  detectBareEmailSpans,
  detectProtocolSpans,
  protocolAllowlistSet,
  type ProtocolLinkSpan,
} from './protocol-uri.js';
import { CORE_REFUSED_URI_SCHEMES } from './refused-schemes.js';
import { sanitiseLinkTarget } from './sanitise.js';
import type { LinkCandidate, Span } from './types.js';
import { detectWebLinks, type WebLinkSpan } from './web-url.js';

/**
 * 045 FR-009, FR-104, FR-159, FR-178 — one line's links, web, protocol and path together
 * (`data-model.md` §13.2, §16.11).
 *
 * Both panel types take a line's links from here and from nothing else, which is FR-104's parity by
 * construction. Web spans are found first and CLAIMED; allowlisted protocol spans next, outside every
 * web span, and claimed too; path candidates last, never overlapping either (FR-009):
 * `https://host/src/foo.ts:42` is a web link and not also a path.
 *
 * Pure and total, like `detectPathCandidates` (D8). The per-line candidate cap
 * (`MAX_LINK_CANDIDATES_PER_LINE`) stays with the caller that asks about each candidate.
 */
export interface ScannedLine {
  readonly web: readonly WebLinkSpan[];
  /** FR-159: allowlisted, unrefused protocol links. Never overlapping a web span. */
  readonly protocol: readonly ProtocolLinkSpan[];
  /** Never overlapping a web or a protocol span (FR-009). */
  readonly paths: readonly LinkCandidate[];
}

/**
 * What the user's settings contribute to a scan (data-model §16.11). Every field is optional, and an
 * absent one takes the shipped default — so a caller with no options scans as a fresh install does.
 */
export interface ScanOptions {
  /** FR-178: the resolved known-extension set. Default: `KNOWN_FILE_EXTENSIONS`. */
  readonly knownExtensions?: ReadonlySet<string>;
  /** FR-159: lower-case scheme names (`protocolAllowlistSet`). Default: `DEFAULT_PROTOCOL_ALLOWLIST`. */
  readonly allowlist?: ReadonlySet<string>;
  /** FR-159: schemes never drawn as links. Default: core's OS-neutral half. */
  readonly refused?: ReadonlySet<string>;
  /**
   * Round five — `DetectOptions.namesKnownDirectory`, passed straight through: the one thing the
   * space rule may be TOLD, so a prompt naming a folder with a space in it is one link
   * (`detect.ts`'s header). Only a terminal whose flavour reports its directory supplies it; an
   * editor never does, and without it a scan is exactly what the case table says.
   */
  readonly namesKnownDirectory?: (text: string) => boolean;
}

const DEFAULT_ALLOWLIST = protocolAllowlistSet(DEFAULT_PROTOCOL_ALLOWLIST);

export function scanLinkLine(line: string, options: ScanOptions = {}): ScannedLine {
  const allowlist = options.allowlist ?? DEFAULT_ALLOWLIST;
  const refused = lowerCased(options.refused ?? CORE_REFUSED_URI_SCHEMES);
  const web = detectWebLinks(line);
  const written = detectProtocolSpans(line, allowlist, refused).filter(
    (p) => !web.some((w) => p.start < w.end && w.start < p.end),
  );
  /*
   * A bare email address is CLAIMED whether or not it is a link (round five, reported 2026-09-20).
   *
   * Claiming and publishing are two different questions, and for an address they get two different
   * answers. `mailto` on the allowlist makes `someone@example.com` a mail link; `mailto` off it makes
   * the address plain text — but NOT a file, which is what it became before this existed, because the
   * path grammar reads it as `name.ext` and offers the terminal's own directory plus the address. So
   * the range is taken off the path grammar either way, and only the allowed ones are published.
   */
  const emails = detectBareEmailSpans(line, [...web, ...written]);
  const protocol = [
    ...written,
    ...(bareEmailsAreLinks(allowlist, refused) ? emails : []),
  ].sort((a, b) => a.start - b.start);
  // Web and protocol spans CLAIM their range whether or not they survive FR-156, so a refused URI is
  // never re-read as a path.
  const claimed: Span[] = [...web, ...written, ...emails].sort((a, b) => a.start - b.start);
  const detectOptions: DetectOptions = {
    ...(options.knownExtensions === undefined ? {} : { knownExtensions: options.knownExtensions }),
    ...(options.namesKnownDirectory === undefined
      ? {}
      : { namesKnownDirectory: options.namesKnownDirectory }),
  };
  const paths = detectPathCandidates(line, claimed, detectOptions);
  // FR-156: nothing is clickable until it validates. Main sanitises again before any OS call.
  return {
    web: web.filter((w) => clean(w.uri)),
    protocol: protocol.filter((p) => clean(p.uri)),
    paths: paths.filter((c) => clean(c.text)),
  };
}

function clean(target: string): boolean {
  return sanitiseLinkTarget(target).ok;
}

function lowerCased(set: ReadonlySet<string>): ReadonlySet<string> {
  for (const s of set) if (s !== s.toLowerCase()) return new Set([...set].map((e) => e.toLowerCase()));
  return set;
}
