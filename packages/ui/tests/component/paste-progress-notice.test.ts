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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { THRONG_THEME } from '@throng/core';
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
    filesDone: 2,
    filesTotal: 1500,
    current: 'C:/projects/demo/Docs/big.iso',
    targetDir: 'C:/projects/demo/Docs',
    // Main has decided the run is worth a card (FR-031); the tests that say otherwise override it.
    display: true,
    ...over,
  });

describe('progress appears when main says so (050 T079, FR-031, FR-019)', () => {
  it('raises NOTHING for a running event that does not carry display: true — however long it takes', () => {
    render(tree());
    running({ display: false });
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(cards()).toHaveLength(0);
  });

  it('raises a card on the first event carrying display: true, with no renderer timer', () => {
    render(tree());
    running({ display: false });
    expect(cards()).toHaveLength(0);
    running({ display: true, done: 1 });
    expect(cards()).toHaveLength(1);
  });

  it('keeps raising nothing for a small paste whose clash prompt is open (no display event arrives)', () => {
    render(tree());
    running({ display: false });
    transfer.progress({ jobId: 'job-1', state: 'awaiting-cancel-choice', display: false });
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(cards()).toHaveLength(0);
  });

  it('raises ONE paste-progress notice with done-of-total (digit-grouped) and the current item', () => {
    render(tree());
    running();

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

    running({ done: 700, filesDone: 700, current: 'C:/projects/demo/Docs/next.bin' });

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
    transfer.progress({ jobId: 'job-2', state: 'queued', queuedBehind: 2, total: 3, display: true });

    expect(cards()).toHaveLength(1);
    const card = screen.getByTestId('paste-progress');
    expect(card.textContent).toContain('Paste queued');
    expect(card.textContent).toContain('Waiting for 2 earlier pastes');
    fireEvent.click(within(card).getByTestId('paste-cancel'));
    expect(transfer.api.cancel).toHaveBeenCalledWith('job-2');
  });

  it('gives each queued run its OWN card, though their wording is identical', () => {
    render(tree());
    transfer.progress({ jobId: 'job-2', state: 'queued', queuedBehind: 1, display: true });
    transfer.progress({ jobId: 'job-3', state: 'queued', queuedBehind: 1, display: true });

    expect(cards()).toHaveLength(2);
    fireEvent.click(within(cards()[1]!).getByTestId('paste-cancel'));
    expect(transfer.api.cancel).toHaveBeenCalledWith('job-3');
  });

  it('becomes the running notice in place when it starts', () => {
    render(tree());
    transfer.progress({ jobId: 'job-2', state: 'queued', queuedBehind: 1, display: true });
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
    running({ display: false });
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
    transfer.progress({ jobId: 'job-2', state: 'queued', queuedBehind: 1, display: true });
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

/*
 * 050 T116 (FR-039, R24, SC-014) — the card shows HOW FAR the paste is: a bar filled by the bytes
 * copied of the total, "N of M files" with the sizes beside it, and a Cancel that is its own themed
 * icon (not the dismiss glyph), set apart on the right.
 */
const MB = 1024 * 1024;
const themeCss = (): string =>
  readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/theme.css'), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ' ',
  );
const rulesFor = (css: string, needle: string): string =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((m) => m[1]!.includes(needle))
    .map((m) => m[2]!)
    .join('\n');

describe('the progress bar (050 T116, FR-039)', () => {
  it('is a determinate progressbar filled by bytesDone of bytesTotal', () => {
    render(tree());
    running({ done: 3, total: 10, bytesDone: 5 * MB, bytesTotal: 20 * MB });

    const bar = within(screen.getByTestId('paste-progress')).getByRole('progressbar');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(bar.getAttribute('aria-valuenow')).toBe('25');
    expect(bar.className).not.toContain('indeterminate');
    const fill = bar.querySelector<HTMLElement>('.paste-progress__fill');
    expect(fill?.style.width).toBe('25%');
  });

  it('advances in place as bytes arrive', () => {
    render(tree());
    running({ bytesDone: 5 * MB, bytesTotal: 20 * MB });
    running({ bytesDone: 10 * MB, bytesTotal: 20 * MB });
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('50');
  });

  it('animates WITHOUT a fill while the total is not known', () => {
    render(tree());
    running({ bytesDone: 0, bytesTotal: null });

    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBeNull();
    expect(bar.className).toContain('paste-progress__bar--indeterminate');
    expect(bar.querySelector('.paste-progress__fill')).toBeNull();
  });

  it('says "N of M files" with the size done of the total beside it', () => {
    render(tree());
    running({ filesDone: 3, filesTotal: 1500, bytesDone: 5 * MB, bytesTotal: 20 * MB });
    const text = screen.getByTestId('paste-progress').textContent ?? '';
    expect(text).toContain('3 of 1,500 files');
    expect(text).toContain('5 MB of 20 MB');
  });

  it('counts FILES (filesDone of filesTotal), not top-level items', () => {
    render(tree());
    // One top-level item (a folder) holding 1,500 files, 40 copied so far.
    running({ done: 0, total: 1, filesDone: 40, filesTotal: 1500, bytesDone: MB, bytesTotal: 20 * MB });
    const text = screen.getByTestId('paste-progress').textContent ?? '';
    expect(text).toContain('40 of 1,500 files');
    expect(text).not.toContain('of 1 files');
  });

  it('shows the current item and the size only while the file total is unknown', () => {
    render(tree());
    running({ filesDone: 0, filesTotal: null, bytesDone: 2 * MB, bytesTotal: null });
    const text = screen.getByTestId('paste-progress').textContent ?? '';
    expect(text).toContain('big.iso');
    expect(text).toContain('2 MB');
    expect(text).not.toContain(' files');
    expect(text).not.toContain(' of ');
  });

  it('draws only from theme tokens and stops animating under reduced motion', () => {
    const css = themeCss();
    const block = rulesFor(css, '.paste-progress');
    expect(block, 'no .paste-progress rules in theme.css').not.toBe('');
    expect(block).toContain('var(--throng-colour-accent)');
    expect(block).toContain('var(--throng-colour-border)');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/);
    const reduced = [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)]
      .map((m) => m[1]!)
      .join('\n');
    expect(reduced).toMatch(/\.paste-progress__bar--indeterminate[^{]*\{[^}]*animation:\s*none/);
  });
});

describe('the Cancel icon (050 T116, FR-039)', () => {
  it('is its own icon token, not the dismiss glyph, titled "Cancel paste"', () => {
    render(tree());
    running({ bytesDone: MB, bytesTotal: 20 * MB });

    const cancel = screen.getByTestId('paste-cancel');
    expect(cancel.getAttribute('title')).toBe('Cancel paste');
    const glyph = THRONG_THEME.icons['cancel'];
    expect(glyph, 'THRONG_THEME has no `cancel` icon token').toBeTruthy();
    expect(glyph).not.toBe(THRONG_THEME.icons['dismiss']);
    expect(glyph).not.toBe(THRONG_THEME.icons['destroy']);
    expect(cancel.textContent).toBe(glyph);
  });

  it('sits in its own slot, after the text, apart from it', () => {
    render(tree());
    running({ bytesDone: MB, bytesTotal: 20 * MB });

    const body = screen.getByTestId('paste-progress').querySelector('.paste-progress__body')!;
    const slot = within(body as HTMLElement).getByTestId('paste-cancel').closest('.paste-progress__cancel');
    expect(slot, 'cancel is not in a .paste-progress__cancel slot').not.toBeNull();
    expect(body.lastElementChild).toBe(slot);
    expect(slot!.querySelector('.paste-progress__text')).toBeNull();
    expect(rulesFor(themeCss(), '.paste-progress__cancel')).toMatch(/margin-left:\s*auto/);
  });
});
