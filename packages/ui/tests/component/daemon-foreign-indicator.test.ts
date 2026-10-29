/**
 * #533 — a dev build running on ANOTHER checkout's daemon says so, once, and the status bar's daemon
 * indicator is the control that replaces it with this build's (the 029 pattern: the notice reports,
 * the status bar acts).
 *
 * Layer: component — what the indicator draws, the one notice it raises and the call its click makes are
 * all renderer behaviour. Whether main reports the condition and retires the daemon is
 * `integration/daemon-foreign-instance.test.ts`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { DaemonIndicator } from '../../src/renderer/statusbar/daemon-indicator.js';

const CHECKOUT = 'D:\\git\\throng\\.claude\\worktrees\\S055-I5-I133-resource-monitor';

type Foreign = { checkout: string } | null;

function stubDaemon(foreign: Foreign): { replaceForeign: ReturnType<typeof vi.fn>; push: (f: Foreign) => void } {
  let listener: ((f: Foreign) => void) | null = null;
  const replaceForeign = vi.fn(async () => ({ ok: true }));
  (window as unknown as { throng: unknown }).throng = {
    daemon: {
      state: async () => ({ status: 'running', since: 0 }),
      onState: () => () => undefined,
      restart: async () => ({ ok: true }),
      foreign: async () => foreign,
      onForeign: (cb: (f: Foreign) => void) => {
        listener = cb;
        return () => {
          listener = null;
        };
      },
      replaceForeign,
    },
  };
  return { replaceForeign, push: (f) => listener?.(f) };
}

function mount(): void {
  render(createElement(NotificationProvider, null, createElement(DaemonIndicator)));
}

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
});

describe('another checkout\u2019s daemon (#533)', () => {
  it('draws the indicator naming the checkout, and raises one notice that names it too', async () => {
    stubDaemon({ checkout: CHECKOUT });
    mount();

    const indicator = await screen.findByTestId('status-daemon');
    expect(indicator).toHaveAttribute('data-status', 'foreign');
    expect(indicator.getAttribute('title')).toContain(CHECKOUT);

    const notices = await screen.findAllByTestId('daemon-foreign');
    expect(notices).toHaveLength(1);
    expect(notices[0]).toHaveTextContent('S055-I5-I133-resource-monitor');
  });

  it('replaces it with this build\u2019s daemon when the indicator is clicked', async () => {
    const { replaceForeign } = stubDaemon({ checkout: CHECKOUT });
    mount();

    fireEvent.click(await screen.findByTestId('status-daemon'));

    await waitFor(() => expect(replaceForeign).toHaveBeenCalledTimes(1));
  });

  it('draws nothing once the daemon is this build\u2019s again', async () => {
    const { push } = stubDaemon({ checkout: CHECKOUT });
    mount();
    await screen.findByTestId('status-daemon');

    push(null);

    await waitFor(() => expect(screen.queryByTestId('status-daemon')).toBeNull());
  });

  it('draws nothing for this build\u2019s own daemon', async () => {
    stubDaemon(null);
    mount();
    // Give the state and foreign reads their turn before asserting absence.
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('status-daemon')).toBeNull();
    expect(screen.queryByTestId('daemon-foreign')).toBeNull();
  });
});
