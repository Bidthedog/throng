import {
  DEFAULT_PROTOCOL_ALLOWLIST,
  flavourReportsDirectory,
  protocolAllowlistSet,
  resourceClass,
  sanitiseLinkTarget,
  type LinkPosition,
  type LinkResolutionRequest,
} from '@throng/core';
import { followLink, openWebLink, type LinkFollowDeps } from '../links/link-actions.js';
import { absolutePathByName } from '../links/path-by-name.js';
import { refusedSchemes } from '../links/refused-schemes-client.js';
import type { HoveredLink } from './hovered-link.js';

/** The shipped allowlist, for a caller that has no settings to read (FR-159's default). */
const SHIPPED_ALLOWLIST: ReadonlySet<string> = protocolAllowlistSet(DEFAULT_PROTOCOL_ALLOWLIST);

/**
 * 045 FR-157, FR-159, FR-163 — what an OSC 8 hyperlink TARGET is, by the one scheme gate
 * (`resourceClass`; plan Corrections after analysis, fourth pass — the earlier three-answer gate,
 * `classifyTerminalLinkTarget`, was retired into it and DELETED in review round four, so there is no
 * second gate left to reach for):
 *
 * - `uri` — web, loopback or an allowlisted, unrefused protocol: opened by `throng:linkUri:openExternal`;
 * - `file` — a `file:` URI: resolved by main as a file link (FR-011);
 * - `null` — anything else: not a link (FR-013, FR-154), and a Ctrl+click still reaches the program.
 *
 * A scheme-less target stays `null`, as it always was: a program declaring an OSC 8 link names a URI.
 */
export function hyperlinkTargetKind(
  uri: string,
  allowlist: ReadonlySet<string> = SHIPPED_ALLOWLIST,
): 'uri' | 'file' | null {
  // FR-156's render-side half (data-model §16.15): a crafted target — control characters, `%00` — is
  // never a link, so it is never drawn clickable, hovered or followed.
  if (!sanitiseLinkTarget(uri).ok) return null;
  switch (resourceClass(uri, allowlist, refusedSchemes())) {
    case 'web':
    case 'loopback':
    case 'protocol':
      return 'uri';
    case 'onDevice':
      return /^file:/i.test(uri.trim()) ? 'file' : null;
    default:
      return null;
  }
}

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
 * while `javascript:`, `data:` and every unknown scheme stay exactly as inert as 024 made them —
 * {@link hyperlinkTargetKind} closes by default, so a scheme nobody thought about is inert rather than
 * open. Round four lifts one more thing, and only on the user's say-so: a scheme on the protocol
 * allowlist (`mailto:` …) leaves by `throng:linkUri:openExternal`, where main applies the same policy
 * again (FR-159, S5).
 *
 * ══ NOTHING IS ASKED UNTIL THE CLICK, AND THE CLICK ASKS ONCE (round four) ══
 *
 * A link is drawn, hovered and worded by grammar and by its target's class alone (FR-155, FR-163);
 * main is asked only when it is followed — one `throng:links:follow` (data-model §16.18), which
 * resolves, reveals where that is the outcome, and answers what is left for the renderer to do.
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
 * Round five — the reported bug: **a prompt whose folder has a space in it lost its last word.**
 *
 *   PS `D:\git\throng_tests\test 1>`   CMD `D:\git\throng_tests\test 1>`
 *   Bash `Spikeh@MUHAMMAD MINGW64 /d/git/throng_tests/test 1 (master)`
 *
 * …all drew `…\test` and dropped the ` 1`, and so did the Claude Code CLI header, which prints the
 * same directory as ordinary text. From the text alone the space rule is RIGHT to stop there
 * (FR-173/FR-179; the 92-case table), and weakening it would underline prose everywhere.
 *
 * What the terminal has that the text does not is the shell's own working directory — the cwd store,
 * gated by {@link terminalLinkBaseDirectory} so only a flavour that genuinely reports it counts. This
 * turns that value into `DetectOptions.namesKnownDirectory`: a pure string comparison, no disk, no ask
 * (FR-155), so ordinary prose — which never matches a cwd — is left exactly as it was.
 *
 * ══ FLAVOUR-NORMALISED, BECAUSE THE TWO SIDES ARE SPELT DIFFERENTLY ══
 *
 * Git Bash PRINTS `/d/git/throng_tests/test 1` but REPORTS `D:\git\throng_tests\test 1` — its
 * integration runs `cygpath -w "$PWD"` (`command-recipe.ts`). So both sides go through
 * `absolutePathByName`, which is the renderer's by-name authority on drive forms (FR-176), and are
 * then folded to one separator, stripped of a trailing one and lower-cased: Windows path comparison
 * is case-insensitive, and a prompt is free to print a different case from the report.
 *
 * ══ AND IT MATCHES AN ANCESTOR, AT A SEPARATOR BOUNDARY ══
 *
 * `D:\git\my project` extends while sitting in `D:\git\my project\src`, because a prompt or a header
 * may well print a parent. The boundary is what keeps `D:\a\test` from extending into `D:\a\tester` —
 * a raw string prefix would, and that is the one way this could have made prose noisier.
 */
export function namesTerminalDirectory(cwd: string | undefined): ((text: string) => boolean) | undefined {
  if (cwd === undefined) return undefined;
  const target = canonicalDirectory(cwd);
  if (target === null) return undefined;
  const cached = memo;
  if (cached !== null && cached.cwd === cwd) return cached.test;
  const test = (text: string): boolean => {
    const candidate = canonicalDirectory(text);
    return candidate !== null && (candidate === target || target.startsWith(`${candidate}/`));
  };
  memo = { cwd, test };
  return test;
}

/**
 * Memoised on the cwd STRING, because this is built on the render path — once per hovered row, and
 * once per line of every view pass — and the cwd changes only when the user `cd`s.
 */
let memo: { readonly cwd: string; readonly test: (text: string) => boolean } | null = null;

/** One spelling for two forms of the same location, or `null` for text that names none. */
function canonicalDirectory(text: string | undefined): string | null {
  if (text === undefined || text.length === 0) return null;
  const absolute = absolutePathByName(text) ?? text;
  const folded = absolute.replace(/[\\/]+/g, '/').replace(/\/+$/, '').toLowerCase();
  return folded.length === 0 ? null : folded;
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
 * What xterm's link `hover` callback means (R5). This is the replacement for the `^https?://` test
 * that used to sit inline in `setHovered` — the third and last copy of that scheme question.
 *
 * 045 FR-163 (T286): the target is judged by its resource class ALONE — there is no `ask`. A
 * well-formed `file:` target is a file link whatever it points at (it is resolved when followed,
 * FR-160); an empty, refused, non-allowlisted or crafted target is nothing, so it gets no hover state,
 * no tooltip, no menu items, and its Ctrl+click still reaches the program (#198's guard sees nothing).
 */
export function hoveredLinkFromUri(
  uri: string | undefined,
  site: TerminalLinkSite,
  /** FR-159: the current allowlist. Absent: the shipped one. */
  allowlist?: ReadonlySet<string>,
): HoveredLink | null {
  if (uri === undefined || uri.length === 0) return null;
  switch (hyperlinkTargetKind(uri, allowlist)) {
    case 'uri':
      return { kind: 'web', uri };
    case 'file':
      return { kind: 'file', request: terminalLinkRequest({ text: uri, kind: 'fileHyperlink', site }) };
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
  /** FR-159: the terminal's current allowlist. Absent: the shipped one. */
  readonly allowlist?: ReadonlySet<string>;
  readonly deps: TerminalLinkDeps;
}): Promise<void> {
  const { event, uri, site, deps, allowlist } = args;
  // 024 FR-019c: a plain click keeps its terminal meaning, on every kind of link.
  if (!(event.ctrlKey || event.metaKey)) return;
  const kind = hyperlinkTargetKind(uri, allowlist);
  if (kind === 'uri') {
    openWebLink(uri, allowlist ?? SHIPPED_ALLOWLIST);
    return;
  }
  if (kind !== 'file') return;
  await followTerminalLink({
    request: terminalLinkRequest({ text: uri, kind: 'fileHyperlink', site }),
    deps,
  });
}

/**
 * 045 FR-165 (round four) — whether a PLAIN click (no Ctrl/Meta) should show the link hint.
 *
 * Additive by construction: it decides nothing about the click itself, only whether the hint shows
 * alongside it. `hovered` is `HoveredLink | null` — the same value the tooltip and the menu already
 * read — so "a link of an enabled kind is under the pointer" (FR-165f) is already the hover
 * pipeline's own answer; this adds nothing new to check for it. FR-165e's other two clauses (never on
 * hover alone, never on a click that drags) are the CALLER's: this only ever runs at a genuine
 * mouseup, drag already ruled out.
 */
export function plainClickShowsHint(
  event: { readonly ctrlKey: boolean; readonly metaKey: boolean },
  hovered: HoveredLink | null,
): boolean {
  return !(event.ctrlKey || event.metaKey) && hovered !== null;
}

/**
 * Follow a link this terminal drew, wherever the gesture came from (FR-040, FR-054).
 *
 * One `throng:links:follow` (data-model §16.18): the request goes to main untouched, so whatever main
 * decides at ACTION time — including that nothing is there — is decided against the text and the
 * panel, never against a path the renderer happens to be holding (FR-037). The link was drawn by
 * grammar (FR-155); there is no earlier answer to lean on, and none is needed.
 */
export async function followTerminalLink(args: {
  readonly request: LinkResolutionRequest;
  /** FR-004's position, when the detected span carried one. A hyperlink never carries one. */
  readonly position?: LinkPosition;
  readonly deps: TerminalLinkDeps;
}): Promise<void> {
  const { request, position, deps } = args;
  await followLink({
    request,
    ...(position === undefined ? {} : { position }),
    deps,
  });
}
