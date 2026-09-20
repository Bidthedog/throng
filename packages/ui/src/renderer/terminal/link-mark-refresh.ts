import { useEffect } from 'react';
import type { EditorLinkSettings } from '@throng/core';
import { linkScanKey } from '../links/link-scan-options.js';

/**
 * 045 FR-178, FR-159, FR-060 / SC-008 (review round four, terminal I3) — what makes a link-settings
 * change reach a terminal's AT-REST marks.
 *
 * `LinkViewMarks.refresh()` was written for exactly this and nothing called it, so the only trigger
 * left was xterm rendering. Every reader the pass uses is live, so the settings DID land — on the
 * next pass, and at an idle prompt there is no next pass. Clearing `editor.links.detectInTerminals`
 * left every detected path on screen still dashed-underlined while hovering it correctly did nothing:
 * the marks and the hover disagreed until output arrived.
 *
 * Two pieces, because they answer two different questions. {@link linkMarkRefreshKey} says WHEN the
 * next pass would differ — it is the scan's own key (`linkScanKey`, shared with the editor) plus the
 * detection switch, which `linkScanKey` cannot see because it is not a scan option. The hook says
 * WHAT to do about it, and asks for a pass rather than forcing one: `createLinkViewMarks` throttles a
 * refresh exactly like a render, so a settings edit costs no more than a write would.
 */

/** What a terminal's next mark pass depends on, beyond the rows themselves. */
export function linkMarkRefreshKey(read: {
  links(): Pick<EditorLinkSettings, 'protocolAllowlist' | 'knownFileExtensions'>;
  detect(): boolean;
}): string {
  return `${read.detect() ? '1' : '0'}|${linkScanKey(read.links())}`;
}

/** Ask for a pass whenever `key` changes — and once on mount, for the pass the marks start with. */
export function useLinkMarkRefresh(marks: () => { refresh(): void } | null, key: string): void {
  useEffect(() => {
    marks()?.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `marks` is read lazily; the KEY is the trigger
  }, [key]);
}
