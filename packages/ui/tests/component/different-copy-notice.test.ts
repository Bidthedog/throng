/**
 * 058 FR-018 / research D5a — the different-copy notice (contracts/instance-lock.md).
 *
 * Starting a different copy of throng while one is running opens nothing: the running instance comes
 * forward and says, in its own window, which copy is running and that it must be closed first. This
 * file proves what the notice renders, that a repeat is ONE notice made louder (the repo's "one
 * condition, one notice" rule), and that it is dismissed through the themed control every other
 * notice uses.
 *
 * Layer: component — what one renderer component renders and how it reacts to a pushed event; jsdom
 * shows all of it, and no window or process is needed.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { DifferentCopyNotice as Payload } from '@throng/core';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { DifferentCopyNotice } from '../../src/renderer/common/different-copy-notice.js';

let push: ((n: Payload) => void) | undefined;
let readyCalls = 0;

beforeEach(() => {
  push = undefined;
  readyCalls = 0;
  Reflect.set(window, 'throng', {
    notices: { log: () => undefined },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    instance: {
      onDifferentCopy: (cb: (n: Payload) => void) => {
        push = cb;
        return () => {
          push = undefined;
        };
      },
      differentCopyReady: () => {
        readyCalls += 1;
      },
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

const RUNNING = { runningRoot: 'C:\\Program Files\\throng', runningVersion: '1.4.0' };

function mount(): void {
  render(
    createElement(ConfigProvider, null, createElement(NotificationProvider, null, createElement(DifferentCopyNotice))),
  );
}

async function raise(launchedRoot: string): Promise<void> {
  await waitFor(() => expect(push).toBeDefined());
  act(() => push!({ ...RUNNING, launchedRoot }));
}

describe('the different-copy notice (058 FR-018)', () => {
  it('tells main it is listening, so a launch that arrived before the window loaded is not lost', async () => {
    mount();
    await waitFor(() => expect(readyCalls).toBe(1));
  });

  it('renders the contract text, in the window', async () => {
    mount();
    await raise('D:\\portable\\throng');

    const notice = await screen.findByTestId('different-copy-notice');
    expect(notice.textContent).toContain(
      'throng is already running from C:\\Program Files\\throng (version 1.4.0). ' +
        'To open the copy at D:\\portable\\throng, close this one first.',
    );
  });

  it('a second launch while it is showing re-flashes the one notice and updates the launched copy', async () => {
    mount();
    await raise('D:\\portable\\throng');
    await screen.findByTestId('different-copy-notice');

    await raise('E:\\archive\\throng');

    const notices = screen.getAllByTestId('different-copy-notice');
    expect(notices).toHaveLength(1);
    expect(notices[0].textContent).toContain('To open the copy at E:\\archive\\throng, close this one first.');
    expect(notices[0].textContent).not.toContain('D:\\portable\\throng');
    expect(notices[0].getAttribute('data-pulsing')).toBe('true');
  });

  it('is dismissed through the themed dismiss control, and a later launch raises it again', async () => {
    mount();
    await raise('D:\\portable\\throng');
    await screen.findByTestId('different-copy-notice');

    const dismiss = screen.getByTestId('different-copy-notice-dismiss');
    // The shared icon control (`IconButton`): a themed icon with a hover title, not a text label.
    expect(dismiss.getAttribute('title')).toBe('Dismiss');
    expect(dismiss.querySelector('.icon[aria-hidden="true"]')).not.toBeNull();
    fireEvent.click(dismiss);
    await waitFor(() => expect(screen.queryByTestId('different-copy-notice')).toBeNull());

    await raise('D:\\portable\\throng');
    expect(await screen.findAllByTestId('different-copy-notice')).toHaveLength(1);
  });
});
