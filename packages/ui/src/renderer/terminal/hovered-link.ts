import type { LinkPosition, LinkResolutionRequest, ResolvedLink } from '@throng/core';

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
      /** FR-006: a file link exists only once it has RESOLVED, so this is never speculative. */
      readonly link: ResolvedLink;
      /** What main was asked, kept so a follow can re-ask it rather than trust the answer (FR-037). */
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

/**
 * FR-042's tooltip. It must NAME THE GESTURE; the destination wording differs by kind.
 *
 * The web wording is 024's, unchanged. The file wording deliberately stops at "to open": a file link
 * can end up in an editor, a preview, the file manager or the OS's own program for the type
 * depending on the link and the *Default link action* setting, and a tooltip that named one of them
 * would be wrong for the other three. Saying `Ctrl+Click to open in system browser` over
 * `src/foo.ts` — which is what matching the web wording verbatim would do — is the specific
 * falsehood the spec's Assumptions amendment of 2026-09-18 was written to prevent.
 */
export function hoveredLinkTipText(hovered: HoveredLink, chord: string): string {
  return hovered.kind === 'web'
    ? `${chord}+Click to open in system browser`
    : `${chord}+Click to open`;
}

/**
 * The identity the tooltip rests on. Two hovers naming the same link must not restart the delay, or
 * the tip blinks under a motionless pointer (the #159 follow-up) — and xterm re-evaluates its link
 * providers on every repaint, so that happens constantly.
 */
export function hoveredLinkIdentity(hovered: HoveredLink | null): string | null {
  if (hovered === null) return null;
  return hovered.kind === 'web' ? `web ${hovered.uri}` : `file ${hovered.link.path}`;
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
 * It is the link's own TEXT — a url for a web link, the `file:` target for a hyperlink — and not the
 * resolved path, because `terminalLinkTarget` judges by scheme: `D:\p\src\foo.ts` would classify as
 * the scheme `d:` and come back inert. The resolved path is reached through `hovered.link` instead,
 * which is exactly why the hovered value is a record.
 */
export function hoveredLinkMenuText(hovered: HoveredLink | null): string | null {
  if (hovered === null) return null;
  return hovered.kind === 'web' ? hovered.uri : hovered.request.text;
}
