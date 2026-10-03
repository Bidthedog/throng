/**
 * 050 T050 (FR-013, FR-019, FR-019d, contracts/ui-surfaces §2) — the paste's ONE notice.
 *
 * A paste raises a single card in the window's notice area: nothing before it has run for one second
 * (FR-019 — the threshold lives HERE, in one place, because main pushes progress from the start), then
 * `done of total` and the item in progress with a Cancel icon; a queued run shows `Paste queued` at once
 * with its own cancel (FR-019d); and when the run ends the SAME card either goes away (nothing to
 * report) or turns into the failure report — "one condition, one notice". Because it lives in the window
 * rather than in the explorer pane, it is untouched by a project switch.
 */
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider, useNotify } from '../../src/renderer/common/notification.js';
import { PasteProgressNotice } from '../../src/renderer/explorer/paste-progress-notice.js';
import { fakeTransfer } from './helpers/explorer-harness.js';

let transfer: ReturnType<typeof fakeTransfer>;

beforeEach(() => {
  vi.useFakeTimers();
  transfer = fakeTransfer();
  Reflect.set(window, 'throng', { transfer: transfer.api, notices: { log: vi.fn() } });
});
afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(window, 'throng');
});

const tree = (key = 'a'): ReactElement =>
  createElement(
    NotificationProvider,
    null,
    createElement('div', { 'data-testid': `project-${key}` }),
    createElement(PasteProgressNotice),
  );

const cards = (): HTMLElement[] => [
  ...(screen.queryByTestId('notices')?.querySelectorAll<HTMLElement>('.notice') ?? []),
];

const running = (over: Record<string, unknown> = {}): void =>
  transfer.progress({
    jobId: 'job-1',
    state: 'running',
    done: 2,
    total: 1500,
    current: 'C:/projects/demo/Docs/big.iso',
    targetDir: 'C:/projects/demo/Docs',
    ...over,
  });

describe('progress appears after one second (050 T050, FR-019)', () => {
  it('raises NOTHING before 1 s', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(cards()).toHaveLength(0);
  });

  it('raises ONE paste-progress notice at 1 s with done-of-total (digit-grouped) and the current item', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    expect(cards()).toHaveLength(1);
    const card = screen.getByTestId('paste-progress');
    expect(card.className).toContain('notice--info');
    const text = card.textContent ?? '';
    expect(text).toContain('Pasting into Docs');
    expect(text).toContain('2 of 1,500');
    expect(text).toContain('big.iso');
  });

  it('keeps one card as progress advances, updating it in place', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const card = screen.getByTestId('paste-progress');

    running({ done: 700, current: 'C:/projects/demo/Docs/next.bin' });

    expect(cards()).toHaveLength(1);
    expect(screen.getByTestId('paste-progress')).toBe(card);
    expect(card.textContent).toContain('700 of 1,500');
    expect(card.textContent).toContain('next.bin');
  });

  it('does not wait out the second when the run is already over — and raises nothing for a clean run', () => {
    render(tree());
    running();
    transfer.done({ jobId: 'job-1', placed: ['C:/projects/demo/Docs/big.iso'] });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(cards()).toHaveLength(0);
  });
});

describe('the Cancel control (050 T050, FR-019)', () => {
  it('is an icon button titled `Cancel paste` and calls transfer.cancel with the run', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const cancel = screen.getByTestId('paste-cancel');
    expect(cancel.getAttribute('title')).toBe('Cancel paste');
    // An icon control carries no text label of its own.
    expect((cancel.textContent ?? '').toLowerCase()).not.toContain('cancel');
    fireEvent.click(cancel);

    expect(transfer.api.cancel).toHaveBeenCalledWith('job-1');
  });
});

describe('a queued run (050 T050, FR-019d)', () => {
  it('shows `Paste queued` AT ONCE, naming how many are ahead, with its own cancel', () => {
    render(tree());
    transfer.progress({ jobId: 'job-2', state: 'queued', queuedBehind: 2, total: 3 });

    expect(cards()).toHaveLength(1);
    const card = screen.getByTestId('paste-progress');
    expect(card.textContent).toContain('Paste queued');
    expect(card.textContent).toContain('Waiting for 2 earlier pastes');
    fireEvent.click(within(card).getByTestId('paste-cancel'));
    expect(transfer.api.cancel).toHaveBeenCalledWith('job-2');
  });

  it('gives each queued run its OWN card, though their wording is identical', () => {
    render(tree());
    transfer.progress({ jobId: 'job-2', state: 'queued', queuedBehind: 1 });
    transfer.progress({ jobId: 'job-3', state: 'queued', queuedBehind: 1 });

    expect(cards()).toHaveLength(2);
    fireEvent.click(within(cards()[1]!).getByTestId('paste-cancel'));
    expect(transfer.api.cancel).toHaveBeenCalledWith('job-3');
  });

  it('becomes the running notice in place when it starts', () => {
    render(tree());
    transfer.progress({ jobId: 'job-2', state: 'queued', queuedBehind: 1 });
    const card = screen.getByTestId('paste-progress');

    running({ jobId: 'job-2', done: 0, total: 4, current: 'C:/projects/demo/Docs/a.txt' });

    expect(cards()).toHaveLength(1);
    expect(screen.getByTestId('paste-progress')).toBe(card);
    expect(card.textContent).toContain('Pasting into Docs');
    expect(card.textContent).not.toContain('queued');
  });
});

describe('how the run ends (050 T050, FR-013)', () => {
  it('dismisses the notice when the run ends without failures', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cards()).toHaveLength(1);

    transfer.done({ jobId: 'job-1', placed: ['C:/projects/demo/Docs/big.iso'] });

    expect(cards()).toHaveLength(0);
  });

  it('turns the SAME notice into the failure report, one row per item', () => {
    render(tree());
    running({ total: 3 });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const card = screen.getByTestId('paste-progress');

    transfer.done({
      jobId: 'job-1',
      failures: [
        { name: 'locked.db', message: 'It is open in another program.' },
        { name: 'gone.txt', dir: 'old', message: 'It could not be found.' },
      ],
    });

    expect(cards()).toHaveLength(1);
    expect(screen.getByTestId('paste-progress'), 'a second card was raised').toBe(card);
    expect(card.className).toContain('notice--error');
    const text = card.textContent ?? '';
    expect(text).toContain('2 of 3 items could not be pasted');
    expect(text).toContain('locked.db');
    expect(text).toContain('old — gone.txt');
    // The progress is gone: no cancel on a finished run.
    expect(within(card).queryByTestId('paste-cancel')).toBeNull();
  });

  it('raises the error notice directly when a run fails inside the first second', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(cards()).toHaveLength(0);

    transfer.done({
      jobId: 'job-1',
      failures: [{ name: 'locked.db', message: 'It is open in another program.' }],
    });

    expect(cards()).toHaveLength(1);
    expect(cards()[0]!.className).toContain('notice--error');
    // …and the timer that would have raised progress does not resurrect a card afterwards.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(cards()).toHaveLength(1);
  });

  it('says what a roll back could not restore', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    transfer.done({
      jobId: 'job-1',
      outcome: 'rolled-back',
      rollbackFailures: [{ name: 'half.bin', message: 'It could not be found.' }],
    });

    const text = screen.getByTestId('paste-progress').textContent ?? '';
    expect(text).toContain('Roll back could not restore 1 item');
    expect(text).toContain('half.bin');
  });
});

describe('a live card cannot be dismissed, and a failure is never lost (050 FR-019, FR-013)', () => {
  it('offers no dismiss control while the run is live — Cancel is its only action', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const card = screen.getByTestId('paste-progress');
    expect(within(card).getByTestId('paste-cancel')).toBeTruthy();
    expect(within(card).queryByTestId('paste-progress-dismiss')).toBeNull();
  });

  it('a queued card has no dismiss control either', () => {
    render(tree());
    transfer.progress({ jobId: 'job-2', state: 'queued', queuedBehind: 1 });
    expect(within(screen.getByTestId('paste-progress')).queryByTestId('paste-progress-dismiss')).toBeNull();
  });

  it('gets its dismiss control back when the card becomes the failure report', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    transfer.done({ jobId: 'job-1', failures: [{ name: 'a.txt', message: 'It could not be found.' }] });

    expect(within(screen.getByTestId('paste-progress')).getByTestId('paste-progress-dismiss')).toBeTruthy();
  });

  it('raises the failure as ONE notice when the card is gone before the run is done', () => {
    let clear: ((testId: string) => void) | undefined;
    const Probe = (): null => {
      clear = useNotify().clear;
      return null;
    };
    render(
      createElement(
        NotificationProvider,
        null,
        createElement(Probe),
        createElement(PasteProgressNotice),
      ),
    );
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(cards()).toHaveLength(1);
    // Something removed the live card (a clear by test id) before the run ended.
    act(() => clear!('paste-progress'));
    expect(cards()).toHaveLength(0);

    transfer.done({ jobId: 'job-1', failures: [{ name: 'a.txt', message: 'It could not be found.' }] });

    expect(cards()).toHaveLength(1);
    expect(cards()[0]!.className).toContain('notice--error');
    expect(cards()[0]!.textContent).toContain('a.txt');
  });
});

describe('the notice belongs to the window, not to a project (050 T050, FR-019)', () => {
  it('stays — the same card — when the active project changes', () => {
    const view = render(tree('a'));
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    const card = screen.getByTestId('paste-progress');

    // The project switch remounts everything keyed to the project; the window-level host stays.
    view.rerender(tree('b'));

    expect(screen.getByTestId('project-b')).toBeTruthy();
    expect(cards()).toHaveLength(1);
    expect(screen.getByTestId('paste-progress')).toBe(card);
  });

  it('says `Cancelling paste…` while the keep-or-roll-back question is up', () => {
    render(tree());
    running();
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    transfer.progress({ jobId: 'job-1', state: 'awaiting-cancel-choice', done: 5, total: 10 });

    expect(screen.getByTestId('paste-progress').textContent).toContain('Cancelling paste…');
  });
});
