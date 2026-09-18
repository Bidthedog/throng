import { classifyTerminalLinkTarget } from '../links/classify.js';

/**
 * The link a terminal's context menu should offer, or null (024 US7, #159 / FR-019d). Pure.
 *
 * A link under the pointer yields the file-link run — or, for a web link, 024's "Open Link" /
 * "Copy Link Address" pair — but ONLY when there is no active text selection: an active selection
 * takes priority, and then the menu is the ordinary Copy menu whatever the pointer is over.
 *
 * ══ 045 S1: A `file:` TARGET THAT RESOLVES IS NOW A LINK ══
 *
 * 024 refused every non-`http(s)` scheme because the only route out of the app was the OS URL
 * opener, which would launch whatever a `file:` URI named. That reason is gone for `file:` alone:
 * a file link now takes a path-based route that re-resolves the target, checks it exists and checks
 * project membership, and never touches that opener (FR-037). Every other scheme — `javascript:`,
 * `data:`, `mailto:`, anything unknown — is exactly as unopenable as it was (FR-013).
 *
 * **Whether it resolves is the caller's to know, not this function's.** Resolution touches a disk
 * and happens in the main process; a `file:` URI naming nothing is a non-link rather than a broken
 * one (FR-013), so the caller passes what it already has cached. The parameter defaults to `false`,
 * which is 024's behaviour exactly — a caller that has not been taught about file links yet cannot
 * accidentally offer one.
 *
 * The scheme question goes through `classifyTerminalLinkTarget` rather than a regex written out
 * here, which is the second of the three copies of that test this feature removes.
 */
export function terminalLinkTarget(
  selection: string,
  hoveredLink: string | null,
  fileLinkResolved = false,
): string | null {
  if (selection.length > 0) return null; // selection wins (FR-019d)
  if (hoveredLink === null) return null;
  switch (classifyTerminalLinkTarget(hoveredLink)) {
    case 'web':
      return hoveredLink;
    case 'file':
      return fileLinkResolved ? hoveredLink : null;
    default:
      return null;
  }
}
