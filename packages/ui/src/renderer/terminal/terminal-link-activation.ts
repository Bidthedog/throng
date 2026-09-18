import {
  classifyTerminalLinkTarget,
  flavourReportsDirectory,
  type LinkPosition,
  type LinkResolution,
  type LinkResolutionRequest,
  type ResolvedLink,
} from '@throng/core';
import { peekLink, requestLink } from '../links/link-cache.js';
import { followLink, openWebLink, type LinkFollowDeps } from '../links/link-actions.js';
import type { HoveredLink } from './hovered-link.js';

/**
 * Following a link in a TERMINAL (045 FR-011 – FR-013, FR-037, FR-040).
 *
 * ══ ONE ROUTE, THREE GESTURES ══
 *
 * A Ctrl+click on an OSC 8 hyperlink, a Ctrl+click on a detected path, and the menu's Open Link all
 * end in {@link followTerminalLink}. FR-054 requires exactly that: the three must never disagree
 * about where a link opens, and the cheapest way to guarantee it is for there to be one of them.
 *
 * ══ WHY `file:` IS ALLOWED OUT NOW, AND `javascript:` STILL IS NOT ══
 *
 * 024 FR-019 refused every non-`http(s)` scheme, and the reason was the ROUTE rather than the
 * scheme: the only way out of the renderer was the OS url opener, which launches whatever a URI
 * names. A file link does not use it. It sends the link's TEXT and its panel to main over
 * `throng:links:*`, and main re-resolves the text, derives the owning project from the panel and
 * checks the target still exists before doing anything (FR-037). That is why `file:` can be lifted
 * while `javascript:`, `data:`, `mailto:` and every unknown scheme stay exactly as inert as 024 made
 * them — `classifyTerminalLinkTarget` closes by default, so a scheme nobody thought about is inert
 * rather than open.
 *
 * ══ A CLICK NEVER WAITS FOR A RESOLUTION ══
 *
 * FR-071 forbids blocking on an existence check, so this reads the cache and acts on what is there.
 * In practice the hover already filled it — a link is only underlined once it has resolved, and an
 * OSC 8 target is asked about the moment the pointer reaches it. A click that arrives before the
 * answer does asks again and does nothing, and the next one works.
 */

/** Everything a link seen in THIS terminal is judged against. */
export interface TerminalLinkSite {
  readonly panelId: string;
  /**
   * `Panel.originProjectId` (FR-021, I2). An **id**, never a root: main derives the root from it,
   * on the `authoritative()` precedent, so a renderer cannot name the folder it is confined to.
   */
  readonly originProjectId?: string;
  /**
   * FR-023 — the terminal's LIVE working directory (025's seam), where throng knows it. Read at the
   * moment of the hover rather than captured at mount, because a relative path printed by a command
   * almost always means that command's directory, and `cd` moves it.
   */
  readonly baseDirectory?: string;
  /**
   * FR-151 — this terminal's flavour is WSL, so main skips Git's mount table and the platform reading
   * for a leading-`/` path. Can only narrow; absent for every other flavour and for the editor.
   */
  readonly wslFlavour?: true;
}

/**
 * FR-142 – FR-144 (data-model §14.4) — the base directory a terminal's links are judged from.
 *
 * The cwd store's value only when this flavour can actually REPORT its directory as configured:
 * `cmd` is observed moving its real process directory; PowerShell and Git Bash report it through
 * shell integration (OSC 9;9) and nothing else. For a shell that cannot — integration off, or WSL,
 * whose Linux `cd` never moves the Windows-side process — the store holds only the LAUNCH directory,
 * and handing that over would resolve a relative path against the folder the user left. So the answer
 * is `undefined`, and main tries the project root alone (R5).
 *
 * `isWsl` is an input rather than a lookup because `flavourReportsDirectory` answers `true` for any
 * flavour outside the integration maps — a user-defined WSL flavour included — and 025's own callers
 * of it are deliberately left alone. It is consulted for the link base only.
 */
export function terminalLinkBaseDirectory(args: {
  readonly flavourId: string;
  readonly shellIntegration: boolean;
  readonly isWsl: boolean;
  readonly cwd: string | undefined;
}): string | undefined {
  if (args.isWsl) return undefined;
  return flavourReportsDirectory(args.flavourId, args.shellIntegration) ? args.cwd : undefined;
}

/**
 * The performers this surface supplies; the two OS routes come from {@link osLinkActions}.
 *
 * An alias rather than a copy: US3 gave the editor the same three destinations and the same two
 * optional settings inputs, so the shape moved to `links/link-actions.ts` where both surfaces read
 * it. The name stays because the terminal's call sites read better for it.
 */
export type TerminalLinkDeps = LinkFollowDeps;

/** FR-020 – FR-023: what main is asked about a span of terminal text. */
export function terminalLinkRequest(args: {
  readonly text: string;
  readonly kind: LinkResolutionRequest['kind'];
  readonly site: TerminalLinkSite;
}): LinkResolutionRequest {
  const { text, kind, site } = args;
  return {
    text,
    kind,
    panelId: site.panelId,
    ...(site.originProjectId ? { originProjectId: site.originProjectId } : {}),
    ...(site.baseDirectory ? { baseDirectory: site.baseDirectory } : {}),
    ...(site.wslFlavour === true ? { wslFlavour: true as const } : {}),
  };
}

/**
 * Peek, and ask if the answer is not here yet (FR-070, FR-071).
 *
 * `undefined` means **not a link** — not "wait". Nothing is underlined, nothing is followable, and
 * the request that has just been fired fills the cache for the next hover.
 */
export function askTerminalLink(request: LinkResolutionRequest): LinkResolution | undefined {
  const cached = peekLink(request);
  if (cached === undefined) requestLink(request);
  return cached;
}

/**
 * What xterm's link `hover` callback means (R5). This is the replacement for the `^https?://` test
 * that used to sit inline in `setHovered` — the third and last copy of that scheme question.
 *
 * `ask` is injected so the hover path can be driven without a bridge; `askTerminalLink` is what the
 * terminal passes.
 */
export function hoveredLinkFromUri(
  uri: string | undefined,
  site: TerminalLinkSite,
  ask: (request: LinkResolutionRequest) => LinkResolution | undefined,
): HoveredLink | null {
  if (uri === undefined || uri.length === 0) return null;
  switch (classifyTerminalLinkTarget(uri)) {
    case 'web':
      return { kind: 'web', uri };
    case 'file': {
      const request = terminalLinkRequest({ text: uri, kind: 'fileHyperlink', site });
      const resolution = ask(request);
      // FR-006 / FR-013: a `file:` target that names nothing is a NON-link, not a broken link.
      return resolution?.ok === true ? { kind: 'file', link: resolution.link, request } : null;
    }
    default:
      return null;
  }
}

/**
 * A Ctrl+click on an OSC 8 hyperlink (FR-011 – FR-013). `http(s)` keeps 024's route out of the app
 * exactly as it was; a resolving `file:` target follows the file-link route; everything else is
 * inert.
 */
export async function activateTerminalHyperlink(args: {
  readonly event: { readonly ctrlKey: boolean; readonly metaKey: boolean };
  readonly uri: string;
  readonly site: TerminalLinkSite;
  /** The resolved `file:` target the hover showed — see {@link followTerminalLink}'s `drawn`. */
  readonly drawn?: ResolvedLink;
  readonly deps: TerminalLinkDeps;
}): Promise<void> {
  const { event, uri, site, drawn, deps } = args;
  // 024 FR-019c: a plain click keeps its terminal meaning, on every kind of link.
  if (!(event.ctrlKey || event.metaKey)) return;
  const kind = classifyTerminalLinkTarget(uri);
  if (kind === 'web') {
    openWebLink(uri);
    return;
  }
  if (kind !== 'file') return;
  await followTerminalLink({
    request: terminalLinkRequest({ text: uri, kind: 'fileHyperlink', site }),
    ...(drawn === undefined ? {} : { drawn }),
    deps,
  });
}

/**
 * Follow a link this terminal has resolved, wherever the gesture came from (FR-040, FR-054).
 *
 * The request goes on to `performLinkTarget` untouched, so whatever main decides about it at ACTION
 * time — including that the file has gone since the hover — is decided against the text and the
 * panel, never against the path the renderer happens to be holding (FR-037).
 */
export async function followTerminalLink(args: {
  readonly request: LinkResolutionRequest;
  /** FR-004's position, when the detected span carried one. A hyperlink never carries one. */
  readonly position?: LinkPosition;
  /**
   * The answer the gesture was made on — the link the terminal is SHOWING (marked, hovered, the hand
   * up). Used only when the cache has no answer at all.
   *
   * The cache drops an entry on READ once it is older than `LINK_CACHE_TTL_MS`, and nothing re-reads
   * it while the pointer rests. Without this, a Ctrl+click landing after the entry expired asked
   * again, heard FR-071's "not a link" and did nothing, while the link was on screen — the second
   * click worked, because the miss re-asked main. The editor's D3 fix (T216) is the same rule. A
   * fresh answer still wins, `{ ok: false }` included, and main re-resolves the request and re-checks
   * the target before any action (FR-037), so nothing is trusted that main does not confirm.
   */
  readonly drawn?: ResolvedLink;
  readonly deps: TerminalLinkDeps;
}): Promise<void> {
  const { request, position, drawn, deps } = args;
  await followLink({
    request,
    ...(position === undefined ? {} : { position }),
    resolve: (asked) =>
      askTerminalLink(asked) ?? (drawn === undefined ? undefined : { ok: true, link: drawn }),
    deps,
  });
}
