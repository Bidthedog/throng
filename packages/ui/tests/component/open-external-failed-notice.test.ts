/**
 * 080 FR-011, constitution XIII — a URL the OS could not open in the browser raises one notice naming it, and the
 * same URL failing again while it shows does not raise a second.
 *
 * Layer: component — what one renderer component renders when main pushes the failure; jsdom shows all of it.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import {
  OPEN_EXTERNAL_FAILED_TEST_ID,
  OpenExternalFailedNotice,
} from '../../src/renderer/common/open-external-failed-notice.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';

type Failure = { url: string; reason: string };
let push: ((f: Failure) => void) | undefined;

beforeEach(() => {
  push = undefined;
  Reflect.set(window, 'throng', {
    notices: { log: () => undefined },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    onOpenExternalFailed: (cb: (f: Failure) => void) => {
      push = cb;
      return () => {
        push = undefined;
      };
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

async function mount(): Promise<void> {
  render(
    createElement(ConfigProvider, null, createElement(NotificationProvider, null, createElement(OpenExternalFailedNotice))),
  );
  await waitFor(() => expect(push).toBeDefined());
}

describe('OpenExternalFailedNotice (080 FR-011)', () => {
  it('names the URL it could not open, and not the OS reason', async () => {
    await mount();
    act(() => push!({ url: 'https://example.test/guide/', reason: 'xdg-open: no handler' }));
    const notice = await screen.findByTestId(OPEN_EXTERNAL_FAILED_TEST_ID);
    expect(notice.textContent).toContain('https://example.test/guide/');
    expect(notice.textContent).not.toContain('xdg-open');
  });

  it('is one notice when the same URL fails again while it shows', async () => {
    await mount();
    act(() => push!({ url: 'https://example.test/guide/', reason: 'r' }));
    await screen.findByTestId(OPEN_EXTERNAL_FAILED_TEST_ID);
    act(() => push!({ url: 'https://example.test/guide/', reason: 'r' }));
    expect(screen.getAllByTestId(OPEN_EXTERNAL_FAILED_TEST_ID)).toHaveLength(1);
  });
});
