/**
 * 050 T048 (FR-019, contracts/ui-surfaces §2) — `notify` returns the new notice's id and `update`
 * changes that card in place.
 *
 * A paste's progress and its failure report are ONE notice (FR-019): the card that said "Pasting…"
 * turns into the error report rather than a second card appearing beside it. That is only
 * expressible if a raiser can hold the notice's id and patch it later, so the notification API grows
 * `notify(...): string` and `update(id, patch)`. Every existing caller ignores the return value and
 * must compile and behave unchanged.
 *
 * Arranged like `notice-display-override.test.ts`: over the real config store, with the settings
 * seeded, so the severity-keyed display the update has to re-resolve is a genuine settings document.
 */
import { act, render, screen } from '@testing-library/react';
import { flushUntil } from './helpers/flush-until.js';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationProvider,
  useNotify,
  type NoticeInput,
} from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';

let settingsPayload: Record<string, unknown> = { version: 1 };
let logged: Array<Record<string, unknown>> = [];

beforeEach(() => {
  settingsPayload = { version: 1 };
  logged = [];
  (window as unknown as { throng: unknown }).throng = {
    notices: {
      log: (record: Record<string, unknown>) => {
        logged.push(record);
      },
    },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
  vi.useRealTimers();
});

interface Probe {
  notify?: (input: NoticeInput) => string;
  update?: (id: string, patch: Partial<NoticeInput>) => void;
  dismiss?: (id: string) => void;
  loaded?: boolean;
}

function ProbeView({ into }: { into: Probe }): ReactElement | null {
  const api = useNotify();
  into.notify = api.notify;
  into.update = api.update;
  into.dismiss = api.dismiss;
  into.loaded = useConfigLoaded();
  return null;
}

async function mount(): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(ProbeView, { into: probe, key: 'probe' }) as ReactNode,
      ),
    ),
  );
  await flushUntil(() => probe.loaded === true);
  return probe;
}

const RAISE: NoticeInput = {
  severity: 'info',
  message: 'Pasting into docs',
  subject: { kind: 'folder', name: 'docs' },
  testId: 'paste-progress',
};

describe('notify returns the id of the notice it raised (050 T048)', () => {
  it('returns a non-empty id for a displayed notice, distinct per notice', async () => {
    const probe = await mount();
    let a = '';
    let b = '';
    act(() => {
      a = probe.notify!(RAISE);
      b = probe.notify!({ ...RAISE, message: 'Pasting into other' });
    });
    expect(a).not.toBe('');
    expect(b).not.toBe('');
    expect(a).not.toBe(b);
  });

  it('returns the EXISTING notice’s id when the raise is a duplicate of a live one', async () => {
    const probe = await mount();
    let first = '';
    let second = '';
    act(() => {
      first = probe.notify!(RAISE);
      second = probe.notify!(RAISE);
    });
    expect(second).toBe(first);
    expect(screen.getAllByTestId('paste-progress')).toHaveLength(1);
  });
});

describe('update patches a live notice in place (050 T048)', () => {
  it('changes the message, severity and body on the SAME card — no second card', async () => {
    const probe = await mount();
    let id = '';
    act(() => {
      id = probe.notify!(RAISE);
    });
    const card = screen.getByTestId('paste-progress');

    act(() =>
      probe.update!(id, {
        severity: 'error',
        message: '2 of 5 items could not be pasted',
        body: createElement('p', { 'data-testid': 'report-body' }, 'a.txt: held'),
      }),
    );

    const cards = screen.getAllByTestId('paste-progress');
    expect(cards, 'update raised a second card instead of patching the first').toHaveLength(1);
    expect(cards[0], 'update replaced the DOM node instead of patching it').toBe(card);
    expect(card.textContent).toContain('2 of 5 items could not be pasted');
    expect(card.textContent).not.toContain('Pasting into docs');
    expect(card.className).toContain('notice--error');
    expect(screen.getByTestId('report-body').textContent).toBe('a.txt: held');
  });

  it('files one log record when the severity changes, and none when only the message does', async () => {
    const probe = await mount();
    let id = '';
    act(() => {
      id = probe.notify!(RAISE);
    });
    expect(logged).toHaveLength(1);

    act(() => probe.update!(id, { message: 'Pasting into docs (3 of 5)' }));
    expect(logged, 'a message-only update is not a new event').toHaveLength(1);

    act(() => probe.update!(id, { severity: 'error', message: 'It failed' }));
    expect(logged).toHaveLength(2);
    expect(logged[1]).toMatchObject({ severity: 'error', message: 'It failed' });
  });

  it('is a no-op for a dismissed id — nothing reappears and nothing is logged', async () => {
    const probe = await mount();
    let id = '';
    act(() => {
      id = probe.notify!(RAISE);
    });
    act(() => probe.dismiss!(id));
    expect(screen.queryByTestId('paste-progress')).toBeNull();
    const before = logged.length;

    act(() => probe.update!(id, { severity: 'error', message: 'late' }));

    expect(screen.queryByTestId('paste-progress'), 'update resurrected a dismissed notice').toBeNull();
    expect(logged).toHaveLength(before);
  });

  it('is a no-op for an id that never existed (the empty id a suppressed raise returns)', async () => {
    const probe = await mount();
    act(() => probe.update!('', { message: 'nothing' }));
    act(() => probe.update!('n-never', { message: 'nothing' }));
    expect(screen.queryByTestId('paste-progress')).toBeNull();
    expect(logged).toHaveLength(0);
  });

  it('re-resolves the mode from the new severity: an info that becomes an error whose mode is never goes (068)', async () => {
    // The patch drops the override, so the card answers to the NEW severity's setting.
    settingsPayload = {
      version: 1,
      notifications: { info: { mode: 'toast' }, error: { mode: 'never' } },
    };
    const probe = await mount();
    let id = '';
    act(() => {
      id = probe.notify!({ ...RAISE, display: { toast: true, panel: true } });
    });
    expect(screen.getByTestId('paste-progress')).toBeVisible();
    act(() => probe.update!(id, { severity: 'error', message: 'failed', display: undefined }));
    expect(screen.queryByTestId('paste-progress')).toBeNull();
  });

  it('re-arms the full toast duration from the patch (068 FR-021)', async () => {
    settingsPayload = { version: 1, notifications: { toastDurationMs: 5000, error: { mode: 'panel' } } };
    const probe = await mount();
    vi.useFakeTimers();
    let id = '';
    act(() => {
      id = probe.notify!({ ...RAISE });
    });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    act(() => probe.update!(id, { severity: 'error', message: 'failed', display: undefined }));
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(screen.getByTestId('paste-progress'), 'the patch did not restart the clock').toBeVisible();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(screen.queryByTestId('paste-progress')).toBeNull();
  });

  // DELETED: 'every existing caller shape still compiles and works' (notify, then visible) — zero
  // value; 'changes the message, severity and body on the SAME card' above raises with the same
  // call and reads the card.
});
