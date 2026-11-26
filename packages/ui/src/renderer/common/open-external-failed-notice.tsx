/**
 * 080 FR-011, constitution XIII — a link or Help that the OS could not open in the browser.
 *
 * Main logs the failure and tells the window that asked (`main/external-url.ts`); this raises the one notice
 * that says so. It names the URL, so the card's own Copy puts the URL on the clipboard and the user can still
 * paste it into a browser. The same URL failing again while the notice shows is the same notice, which flashes
 * rather than stacking a second (one condition, one notice).
 */
import { useEffect } from 'react';
import { useNotify } from './notification.js';

export const OPEN_EXTERNAL_FAILED_TEST_ID = 'open-external-failed-notice';

/** What the notice says. Exported for the component test. */
export function openExternalFailedMessage(url: string): string {
  return `Couldn’t open ${url} in your browser. Copy the address to open it yourself.`;
}

export function OpenExternalFailedNotice(): null {
  const { notify } = useNotify();
  useEffect(() => {
    const subscribe = window.throng?.onOpenExternalFailed;
    if (!subscribe) return undefined;
    return subscribe(({ url, reason }) => {
      notify({
        severity: 'error',
        subject: { kind: 'none' },
        message: openExternalFailedMessage(url),
        // The OS's reason reaches the log and the clipboard, never the rendered text (030 FR-034).
        copyDetail: `${url}\n${reason}`,
        testId: OPEN_EXTERNAL_FAILED_TEST_ID,
      });
    });
  }, [notify]);
  return null;
}
