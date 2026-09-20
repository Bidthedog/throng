/**
 * 045 FR-168 (round four; `contracts/menus-and-gestures.md` §9.4, §9.7) — the words for a link's
 * GESTURE ("Ctrl+Click to open in…"), shared by every surface that still needs them so they cannot
 * disagree (FR-104, FR-166).
 *
 * Round five (maintainer): "hovering … should simply show the link text, in full, in the HTML title
 * popup. Any other popup / hover / title text should be removed." So this function no longer feeds any
 * hover title — a terminal's, an editor's and the Markdown preview's native `title` now show the
 * link's plain TARGET (by-name in the terminal and the editor; the preview's own render already words
 * its title as the target). What still calls this is the ONE click-triggered hint
 * (`renderer/links/link-hint.tsx`, unrelated to a hover) that shows after a plain click on a link,
 * plus the preview's own hint half — the maintainer asked for that surface to stay.
 *
 * The caller derives the DESTINATION — never this file: editors and terminals derive it by name from
 * FR-157 / FR-160 (`linkDestinationByName`, `renderer/links/click-by-name.ts`), and the Markdown
 * preview derives it from 044's own follow (`renderer/preview/link-dom.ts`, S6). This file is left
 * with nothing to decide but the words.
 *
 * ══ SUPERSEDES THE THREE-WORDING VERSION ══
 *
 * FR-105's original three wordings ("to open", "to open in system browser", "to show in OS Explorer")
 * are folded into this table, refined by FR-168's split of "to open" into "…active editor" / "…new
 * editor" / "…preview" now that the retired default-link-action setting (FR-112) makes a click's
 * destination knowable ahead of time.
 */
export type LinkHoverDestination =
  /** FR-168 / 023 FR-025 – FR-026: which editor the open-target preference sends it to. */
  | { readonly kind: 'editor'; readonly openTarget: 'lastActive' | 'new' }
  /** An in-project file whose click opens a preview (FR-051, FR-110 clause 3). */
  | { readonly kind: 'preview' }
  /** Everything a click reveals rather than opens — a folder, or anything out of project (FR-168b). */
  | { readonly kind: 'osExplorer' }
  /** web, loopback (024, unchanged). */
  | { readonly kind: 'systemBrowser' }
  /** An allowlisted protocol link, worded with its own scheme. */
  | { readonly kind: 'protocol'; readonly scheme: string }
  /** The preview's own in-document heading link (044 FR-090f). */
  | { readonly kind: 'heading' }
  /** The preview's FR-090e link, which stays on the current file with a notice. */
  | { readonly kind: 'stays' };

export function linkHoverText(destination: LinkHoverDestination, chord: string): string {
  switch (destination.kind) {
    case 'editor':
      return `${chord}+Click to open in throng ${destination.openTarget === 'new' ? 'new' : 'active'} editor`;
    case 'preview':
      return `${chord}+Click to open in throng preview`;
    case 'osExplorer':
      return `${chord}+Click to show in OS Explorer`;
    case 'systemBrowser':
      return `${chord}+Click to open in system browser`;
    case 'protocol':
      return `${chord}+Click to open with the ${destination.scheme} handler`;
    case 'heading':
      return `${chord}+Click to go to the heading`;
    case 'stays':
      return `${chord}+Click to follow`;
  }
}

/**
 * FR-168 / §9.4 — an ADDRESS's destination, from its scheme alone.
 *
 * `http`, `https` and a scheme-less web span (`www.example.com`, a loopback host) leave for the
 * browser; anything else allowlisted — `mailto:`, `tel:`, `slack:` — leaves for that scheme's own
 * handler and must say so.
 *
 * Added in review round four (editor M1). The editor and the terminal both folded `scanned.protocol`
 * into a `kind: 'web'` hit and threw the scheme away, so both said "open in system browser" for a
 * `mailto:` link while the Markdown preview said "open with the mailto handler" — three surfaces, one
 * link, two wordings, which is what FR-166 and SC-025 forbid. All three now ask here.
 */
export function uriHoverDestination(uri: string): LinkHoverDestination {
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*):/.exec(uri)?.[1]?.toLowerCase();
  if (scheme === undefined || scheme === 'http' || scheme === 'https') return { kind: 'systemBrowser' };
  return { kind: 'protocol', scheme };
}
