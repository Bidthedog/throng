import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkResolutionRequest } from '@throng/core';
import { followLink } from '../../src/renderer/links/link-actions.js';

/**
 * 045 T259 / FR-160 — following an in-project link with NOTHING behind it raises exactly ONE notice.
 * The report's wording and the other failure shapes are pure functions and live in
 * `unit/link-failure-notice.test.ts`; this case stays at the component layer because `followLink`
 * asks main through `window.throng.links.follow`.
 */
const request: LinkResolutionRequest = {
  text: 'src/foo.ts',
  kind: 'detectedPath',
  panelId: 'panel-1',
  originProjectId: 'project-1',
};

describe('T259 / FR-160 — following an in-project link with nothing behind it', () => {
  const missing = 'D:\\project\\src\\missing.ts';

  afterEach(() => {
    Reflect.deleteProperty(window, 'throng');
  });

  it('raises exactly ONE notice naming the path, and opens no editor or preview', async () => {
    const follow = vi.fn(async () => ({ kind: 'notFound' as const, path: missing }));
    (window as unknown as { throng: unknown }).throng = { links: { follow } };
    const openInEditor = vi.fn();
    const openInPreview = vi.fn();
    const reportFailure = vi.fn();

    await followLink({
      request: { ...request, text: 'src/missing.ts' },
      position: { line: 3 },
      deps: { openInEditor, openInPreview, reportFailure, previewIsDefault: () => true },
    });

    expect(follow, 'one request to main').toHaveBeenCalledTimes(1);
    expect(reportFailure, 'one notice').toHaveBeenCalledTimes(1);
    expect(reportFailure.mock.calls[0]![0]).toMatchObject({ ok: false, path: missing });
    expect(openInEditor).not.toHaveBeenCalled();
    expect(openInPreview).not.toHaveBeenCalled();
  });
});
