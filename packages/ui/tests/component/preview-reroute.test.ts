/**
 * 054 T048 (renderer half) — a link, or a drop, onto a file of ANOTHER provider never navigates the preview
 * in place (FR-008): main answers `reroute`, and the panel opens that file as an ordinary preview open —
 * Last Active of that file's own type, or the preview already showing it (FR-007, FR-004).
 *
 * Layer: component — the panel's handling of main's answer is what is under test; `navigate` and `open` are
 * main's mocks. Main's decision itself is `preview-service-open-target.integration.test.ts`'s.
 */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COLD, PROJECT, ROOT, mountMarkdownPreview, type MountedPreviewWindow } from './helpers/mount-preview-panel.js';

let pv: MountedPreviewWindow | undefined;
afterEach(() => {
  pv?.unmount();
  pv = undefined;
  document.body.replaceChildren();
});

describe('a link to another provider\'s file (FR-008)', () => {
  it('main answers reroute: the file is opened as a preview of its own type, and this panel stays', async () => {
    pv = await mountMarkdownPreview('See [the flow](flow.mmd).\n');
    await screen.findByText('the flow', {}, COLD);
    pv.preview.navigate.mockResolvedValue({ kind: 'reroute' });
    pv.preview.open.mockResolvedValue({ kind: 'placedElsewhere' });

    fireEvent.click(screen.getByText('the flow'), { ctrlKey: true });

    await waitFor(() => expect(pv!.preview.open).toHaveBeenCalledTimes(1));
    const request = pv.preview.open.mock.calls[0]![0] as { absPath: string; projectId: string };
    expect(request.absPath).toBe(`${ROOT}/flow.mmd`);
    expect(request.projectId).toBe(PROJECT);
    await act(() => Promise.resolve());
    expect(screen.getByText('the flow')).toBeInTheDocument();
    expect(screen.queryByTestId(`preview-link-notice-${pv.id}`)).toBeNull();
  });
});
