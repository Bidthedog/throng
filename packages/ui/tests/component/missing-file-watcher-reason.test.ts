// Layer: component — the reason has to come from the real `use-editor` mount publishing its load answer; the scan only reads it.
import { waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountEditor } from './helpers/mount-editor.js';

/**
 * 081 US2, FR-010 / FR-011 — the tab-open scan reports the reason the load returned (#728).
 *
 * #728 candidate cause: "some call an existing folder missing". A restore whose load answered `folder`
 * published the panel as unloadable, and the scan reported every unloadable panel with the `missing`
 * wording and the `path-missing` cause. The user read "may have been moved, renamed or deleted" about a
 * folder sitting where they left it, and the `path-missing` cause let the notice supersede the File
 * Explorer's report as an absent folder would.
 *
 * The real `use-editor` mount publishes the state: `restoreByLoad` makes `getContent` answer null, so the
 * mount loads the path, and the load below answers `folder`. Only the reporter is captured, so the test
 * reads the scan's report itself (message, detail, cause kind).
 */

interface Reported {
  panelId: string;
  message: string;
  detail?: string;
  causeKind?: string;
}

const reported = vi.hoisted(() => ({ calls: [] as Reported[] }));

vi.mock('../../src/renderer/workspace/panel-failure-notice.js', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  useReportPanelFailure: () => (entry: Reported) => void reported.calls.push(entry),
}));

/** Past the scan's own 300 ms delay, so it has sampled. */
const PAST_THE_SCAN_MS = 400;
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
  reported.calls = [];
  Reflect.deleteProperty(window, 'throng');
});

describe('a restore onto a path the load refused names the refusal (081 FR-010, FR-011; #728 "an existing folder called missing")', () => {
  it('a folder is reported as a folder, without the path-missing cause', async () => {
    const h = mountEditor({
      doc: { text: '', version: 1, absPath: 'C:/proj/src' },
      restoreByLoad: true,
      withMissingFileWatcher: true,
    });
    h.calls.load.mockImplementation(() => Promise.resolve({ ok: false, reason: 'folder' }));

    await waitFor(() => expect(h.calls.load).toHaveBeenCalled());
    // The authority's verification answers too, as `verifyPath` does: a verdict that carries no reason.
    h.pushSync({ unloadable: true });
    await sleep(PAST_THE_SCAN_MS);

    await waitFor(() => expect(reported.calls.length).toBeGreaterThan(0));
    expect(reported.calls).toHaveLength(1);
    const [entry] = reported.calls;
    expect(entry.message, 'the notice calls an existing folder missing').toBe('That is a folder, not a file.');
    expect(entry.detail).toContain('(folder)');
    expect(entry.causeKind, 'a folder is not an absent path (030 FR-034a)').toBeUndefined();
  });

  it('a path that is not there keeps the missing wording and the path-missing cause', async () => {
    const h = mountEditor({
      doc: { text: '', version: 1, absPath: 'C:/proj/gone.txt' },
      restoreByLoad: true,
      withMissingFileWatcher: true,
    });
    h.calls.load.mockImplementation(() => Promise.resolve({ ok: false, reason: 'not-found' }));

    await waitFor(() => expect(h.calls.load).toHaveBeenCalled());
    await sleep(PAST_THE_SCAN_MS);

    await waitFor(() => expect(reported.calls.length).toBeGreaterThan(0));
    expect(reported.calls[0].message).toContain('moved, renamed or deleted');
    expect(reported.calls[0].causeKind).toBe('path-missing');
  });
});
