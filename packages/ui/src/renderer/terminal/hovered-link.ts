import { linkHoverText, uriHoverDestination } from '@throng/core';
import type { LinkPosition, LinkResolutionRequest, PreviewProviderRegistry, PreviewSettings } from '@throng/core';
import { linkDestinationByName } from '../links/click-by-name.js';
import { linkFirstReadingByName } from '../links/path-by-name.js';

/**
 * What is under the pointer in a terminal (045 FR-042, FR-043; `data-model.md` §8).
 *
 * ══ WHY THIS IS A RECORD AND NOT A URL STRING ══
 *
 * It was `string | null` — an http(s) url — and four places read it: the guard that keeps a
 * Ctrl+press away from a mouse-reporting program (#198), the hover tooltip, the hover callback that
 * filled it, and the context menu. A file link is not a url, and a file link that RESOLVED is not
 * the same thing as one that did not, so every one of those four needs more than a string.
 *
 * `data-model.md` §8 requires the type change and all four readers in ONE commit, and the reason is
 * worth repeating where the type lives: a reader left on the old shape is #198 reopened. The guard
 * would not recognise a file link, so the same Ctrl+press would be followed by throng AND forwarded
 * to the program underneath — which is how one click opened two browser tabs before.
 *
 * ══ THE PURE HALF LIVES HERE ══
 *
 * These four functions are the whole of what the readers decide, extracted from the mount effect in
 * `use-terminal.ts` so they can be driven without an xterm, a DOM or a shell. The effect keeps the
 * `let hoveredLink` and the DOM work; every judgement it makes is one of these calls.
 */
export type HoveredLink =
  | { readonly kind: 'web'; readonly uri: string }
  | {
      readonly kind: 'file';
      /*
       * 045 round four (data-model §16.17): no resolved `link` any more. A link is valid by grammar
       * (FR-155) and nothing is resolved until it is followed — so the hovered value carries the
       * grammar's request and position only, and main answers at the follow or the menu opening.
       */
      /** What main will be asked at a follow or a menu opening (FR-037). */
      readonly request: LinkResolutionRequest;
      /**
       * FR-004's position, when the span carried one. Absent on an OSC 8 hyperlink, which never does.
       *
       * Carried on the HOVERED value, not only on the follow, because the CONTEXT MENU composes from
       * what the pointer rests on (§5): *Open in Editor* has to land on the line (FR-033) and *Copy
       * Link Address* has to paste the position back in the form it was written (FR-032), and
       * neither is reachable from the resolved path alone.
       */
      readonly position?: LinkPosition;
      /** How that position was written, verbatim — FR-032 copies it back exactly (`:42:7`, `(42,7)`). */
      readonly positionText?: string;
    };

/** What `hoveredLinkTipText` needs beyond the hover and the chord — every one of them by-name (FR-168). */
export interface HoveredLinkTipOptions {
  /** 023 FR-025/FR-026 — `editor.openTarget`, live. Absent means `lastActive`. */
  readonly openTarget?: 'lastActive' | 'new';
  readonly previewRegistry?: PreviewProviderRegistry;
  readonly previewSettings?: PreviewSettings;
}

/**
 * FR-042's gesture wording, worded by FR-168 — delegated to core's `linkHoverText`, which the editor's
 * plain-click hint and the Markdown preview's own hint share, so no surface can word one link
 * differently (FR-104, FR-166).
 *
 * Round five (maintainer): the bespoke floating tooltip this used to feed is gone from the terminal
 * (`use-terminal.ts`) — a hovered link's native `title` shows the plain TARGET now
 * (`link-marks.ts`'s "THE HOVER TITLE"), not this wording. What still calls this function is the ONE
 * plain-click hint (`renderer/links/link-hint-store.ts`), which the maintainer asked to keep.
 *
 * A file link's wording follows where the click will land (FR-110), judged from the text by name
 * (`linkDestinationByName`, FR-155 — nothing is resolved to word a link), against the owning
 * project's root where the terminal has one, and against the panel's own live working directory for
 * a relative path (FR-168a).
 */
export function hoveredLinkTipText(
  hovered: HoveredLink,
  chord: string,
  projectRoot: string | null = null,
  options: HoveredLinkTipOptions = {},
): string {
  // FR-168 / §9.4: an address is worded by its SCHEME — `http(s)` and a loopback host leave for the
  // browser, an allowlisted `mailto:`/`tel:`/`slack:` for its own handler (review round four, M1).
  if (hovered.kind === 'web') return linkHoverText(uriHoverDestination(hovered.uri), chord);
  const destination = linkDestinationByName({
    text: hovered.request.text,
    projectRoot,
    baseDirectory: hovered.request.baseDirectory,
    openTarget: options.openTarget ?? 'lastActive',
    previewRegistry: options.previewRegistry,
    previewSettings: options.previewSettings,
  });
  return linkHoverText(destination, chord);
}

/**
 * 045 FR-167, FR-167a (round four) — the status-bar readout's target: an OSC 8 hyperlink's DECLARED
 * target verbatim (whether a plain web address or a `file:` URI — the target it names, never the
 * text a program drew), and a detected path's FIRST reading by name (`linkFirstReadingByName`).
 *
 * Review round four (I1): the base and the root are two different readings and are passed as two.
 * Collapsing them into one base joined a rooted path onto the working directory, so `/d/git/x.ts`
 * read out as `<cwd>\d\git\x.ts` while the Ctrl+click opened `D:\git\x.ts` — the readout and the
 * follow named different files, on the repo's own everyday path spelling.
 */
export function hoveredLinkReadoutText(
  hovered: HoveredLink,
  baseDirectory: string | null | undefined,
  projectRoot: string | null | undefined,
): string {
  if (hovered.kind === 'web') return hovered.uri;
  if (hovered.request.kind === 'fileHyperlink') return hovered.request.text;
  return linkFirstReadingByName({ text: hovered.request.text, baseDirectory, projectRoot });
}

/**
 * The identity the tooltip rests on. Two hovers naming the same link must not restart the delay, or
 * the tip blinks under a motionless pointer (the #159 follow-up) — and xterm re-evaluates its link
 * providers on every repaint, so that happens constantly.
 */
export function hoveredLinkIdentity(hovered: HoveredLink | null): string | null {
  if (hovered === null) return null;
  return hovered.kind === 'web'
    ? `web ${hovered.uri}`
    : `file ${hovered.request.kind} ${hovered.request.text}${hovered.positionText ?? ''}`;
}

/**
 * #198 / FR-043 — is this press throng's rather than the program's?
 *
 * With mouse reporting on, xterm forwards a press to the pty while its own Linkifier activates the
 * link on release, so a program that opens what it is Ctrl+clicked on (Claude Code) acts on the same
 * gesture throng does. When a link is under the pointer the press stops before the reporting
 * listener sees it. A Ctrl+click anywhere ELSE still reaches the program, which is what keeps the
 * links a program draws itself working.
 *
 * `hovered` covers both kinds now, and that widening IS the file-link half of FR-043.
 */
export function keepsClickFromProgram(args: {
  readonly hovered: HoveredLink | null;
  readonly button: number;
  readonly ctrlKey: boolean;
  readonly metaKey: boolean;
  /** xterm's `term.modes.mouseTrackingMode`. `'none'` means no program is listening. */
  readonly mouseTrackingMode: string;
}): boolean {
  if (args.button !== 0 || !(args.ctrlKey || args.metaKey)) return false;
  if (args.hovered === null) return false;
  return args.mouseTrackingMode !== 'none';
}

/**
 * The string 024's `terminalLinkTarget` classifies when the context menu opens.
 *
 * It is the link's own TEXT — a url for a web link, the `file:` target for a hyperlink — and not a
 * resolved path, because `terminalLinkTarget` judges by scheme: `D:\p\src\foo.ts` would classify as
 * the scheme `d:` and come back inert. The resolved path is main's answer at the menu opening.
 */
export function hoveredLinkMenuText(hovered: HoveredLink | null): string | null {
  if (hovered === null) return null;
  return hovered.kind === 'web' ? hovered.uri : hovered.request.text;
}
