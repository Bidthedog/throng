/**
 * 067 T067 (FR-037, FR-039 to FR-041, FR-044, FR-108) — the closing overlay's progress and Cancel.
 *
 * The overlay stays a blocking overlay. It gains one block per shutdown task (filled as tasks finish,
 * the current one highlighted), a summary on hover and on focus, an estimated time remaining shown with
 * the grouped-quantity formatter, and a Cancel that stays enabled throughout. After Cancel the overlay
 * closes and "terminating" is undone, so terminals exiting later are the user's again.
 *
 * Main drives the shutdown and pushes a `ShutdownView` on every change; the renderer only draws it.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ShutdownView } from '@throng/core';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { AppClosePrompt } from '../../src/renderer/app-close-prompt.js';
import {
  isAppTerminating,
  markAppTerminating,
  resetAppTerminating,
} from '../../src/renderer/terminal/app-terminating.js';

type Cb<T> = (value: T) => void;

function setup() {
  const cbs: {
    begin?: Cb<void>;
    progress?: Cb<ShutdownView>;
    cancelled?: Cb<void>;
  } = {};
  const appCloseCancel = vi.fn();
  Reflect.set(window, 'throng', {
    onAppCloseBegin: (cb: Cb<void>) => ((cbs.begin = cb), () => {}),
    onAppClosePrompt: () => () => {},
    onAppCloseClosing: () => () => {},
    onAppCloseProgress: (cb: Cb<ShutdownView>) => ((cbs.progress = cb), () => {}),
    onAppCloseCancelled: (cb: Cb<void>) => ((cbs.cancelled = cb), () => {}),
    appCloseCancel,
    appCloseChoice: vi.fn(),
  });
  render(createElement(ConfirmProvider, null, createElement(AppClosePrompt)));
  return {
    appCloseCancel,
    begin: () => act(() => cbs.begin!()),
    push: (view: ShutdownView) => act(() => cbs.progress!(view)),
    cancelled: () => act(() => cbs.cancelled!()),
  };
}

const view = (over: Partial<ShutdownView> = {}): ShutdownView => ({
  tasks: [
    { id: 't1', summary: 'Closing 4 terminals in project X', expectedMs: 3000, state: 'done' },
    { id: 't2', summary: 'Closing the open windows', expectedMs: 2000, state: 'current' },
    { id: 't3', summary: 'Quitting throng', expectedMs: 1000, state: 'pending' },
  ],
  remainingMs: 12_000,
  cancelling: false,
  overrunning: false,
  ...over,
});

const blocks = (): HTMLElement[] => [
  ...document.querySelectorAll<HTMLElement>('[data-testid^="app-closing-block-"]'),
];

beforeEach(() => resetAppTerminating());
afterEach(() => {
  resetAppTerminating();
  Reflect.deleteProperty(window, 'throng');
});

describe('one block per task (FR-040)', () => {
  it('draws each task in order, filled when done, highlighted when current', async () => {
    const t = setup();
    t.begin();
    t.push(view());
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(blocks().map((b) => b.getAttribute('data-state'))).toEqual(['done', 'current', 'pending']);
    expect(blocks()[0]!.querySelector('.app-closing__fill')).not.toBeNull();
    expect(blocks()[0]!.getAttribute('data-filled')).toBe('true');
    expect(blocks()[1]!.getAttribute('aria-current')).toBe('step');
    expect(blocks()[2]!.getAttribute('data-filled')).toBe('false');
    expect(blocks()[2]!.hasAttribute('aria-current')).toBe(false);
  });

  it('follows the view as tasks complete', async () => {
    const t = setup();
    t.begin();
    t.push(view());
    await waitFor(() => expect(blocks()).toHaveLength(3));
    t.push(
      view({
        tasks: view().tasks.map((task, i) => ({ ...task, state: i < 2 ? 'done' : 'current' })),
        remainingMs: 1000,
      }),
    );
    expect(blocks().map((b) => b.getAttribute('data-state'))).toEqual(['done', 'done', 'current']);
  });

  it('names every block for a screen reader: the summary and where it stands', async () => {
    const t = setup();
    t.begin();
    t.push(view());
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(blocks()[0]!).toHaveAccessibleName('Closing 4 terminals in project X, done');
    expect(blocks()[1]!).toHaveAccessibleName('Closing the open windows, in progress');
    expect(blocks()[2]!).toHaveAccessibleName('Quitting throng, waiting');
  });
});

describe('the summary on hover and focus (FR-041)', () => {
  it('shows the task’s summary while the pointer is over its block, and not otherwise', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup();
    t.begin();
    t.push(view());
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(screen.queryByTestId('app-closing-summary')).toBeNull();
    await user.hover(blocks()[0]!);
    expect(screen.getByTestId('app-closing-summary')).toHaveTextContent('Closing 4 terminals in project X');
    await user.unhover(blocks()[0]!);
    expect(screen.queryByTestId('app-closing-summary')).toBeNull();
  });

  it('shows it for the focused block too, and blocks are reachable by keyboard', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup();
    t.begin();
    t.push(view());
    await waitFor(() => expect(blocks()).toHaveLength(3));
    blocks().forEach((b) => expect(b.tabIndex).toBe(0));
    act(() => blocks()[2]!.focus());
    expect(screen.getByTestId('app-closing-summary')).toHaveTextContent('Quitting throng');
    await user.tab();
    await user.tab();
    expect(blocks().concat([screen.getByTestId('app-closing-cancel')])).toContain(document.activeElement);
  });
});

describe('the estimate (FR-042)', () => {
  it('shows the remaining time in whole seconds through the grouped formatter', async () => {
    const t = setup();
    t.begin();
    t.push(view({ remainingMs: 1_234_500 }));
    await waitFor(() => expect(screen.getByTestId('app-closing-remaining')).toHaveTextContent('1,235'));
    expect(screen.getByTestId('app-closing-remaining')).toHaveTextContent(/s remaining/);
  });

  it('updates as the view changes', async () => {
    const t = setup();
    t.begin();
    t.push(view({ remainingMs: 9000 }));
    await waitFor(() => expect(screen.getByTestId('app-closing-remaining')).toHaveTextContent('9 s'));
    t.push(view({ remainingMs: 4000 }));
    expect(screen.getByTestId('app-closing-remaining')).toHaveTextContent('4 s');
  });
});

describe('a task that does not complete (FR-044)', () => {
  it('is identified as the current task and the overlay says it is taking longer than expected', async () => {
    const t = setup();
    t.begin();
    t.push(view({ overrunning: true }));
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(screen.getByTestId('app-closing-overrun')).toHaveTextContent(/longer than expected/i);
    expect(blocks()[1]!.getAttribute('data-overrunning')).toBe('true');
    expect(blocks()[1]!.getAttribute('aria-current')).toBe('step');
    expect(screen.queryByTestId('app-closing-overrun')).not.toBeNull();
  });

  it('says nothing about it while the current task is on time', async () => {
    const t = setup();
    t.begin();
    t.push(view());
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(screen.queryByTestId('app-closing-overrun')).toBeNull();
  });
});

describe('Cancel (FR-037, FR-039)', () => {
  it('is always enabled, reachable by keyboard, and sends appCloseCancel', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup();
    t.begin();
    t.push(view({ overrunning: true }));
    const cancel = await screen.findByTestId('app-closing-cancel');
    expect(cancel).not.toBeDisabled();
    expect(cancel).toHaveAccessibleName(/cancel/i);
    await user.click(cancel);
    expect(t.appCloseCancel).toHaveBeenCalledTimes(1);
  });

  it('stays enabled while cancelling, and says it is', async () => {
    const t = setup();
    t.begin();
    t.push(view({ cancelling: true }));
    const cancel = await screen.findByTestId('app-closing-cancel');
    expect(cancel).not.toBeDisabled();
    expect(screen.getByTestId('app-closing-message')).toHaveTextContent(/cancel/i);
  });

  it('has the keyboard from the start, and Escape cancels too', async () => {
    const user = userEvent.setup({ delay: null });
    const t = setup();
    t.begin();
    t.push(view());
    const cancel = await screen.findByTestId('app-closing-cancel');
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.keyboard('{Escape}');
    expect(t.appCloseCancel).toHaveBeenCalledTimes(1);
  });

  it('closes the overlay and undoes markAppTerminating once main reports the cancel finished', async () => {
    const t = setup();
    t.begin();
    markAppTerminating();
    t.push(view());
    await screen.findByTestId('app-closing-overlay');
    expect(isAppTerminating()).toBe(true);

    t.cancelled();

    await waitFor(() => expect(screen.queryByTestId('app-closing-overlay')).toBeNull());
    expect(isAppTerminating()).toBe(false);
  });

  it('shows no half-closed blocks as open: a cancelled task is drawn as cancelled, not as pending', async () => {
    const t = setup();
    t.begin();
    t.push(
      view({
        cancelling: true,
        tasks: [
          { id: 't1', summary: 'Closing 4 terminals in project X', expectedMs: 3000, state: 'done' },
          { id: 't2', summary: 'Closing the open windows', expectedMs: 2000, state: 'cancelled' },
          { id: 't3', summary: 'Quitting throng', expectedMs: 1000, state: 'cancelled' },
        ],
      }),
    );
    await waitFor(() => expect(blocks()).toHaveLength(3));
    expect(blocks().map((b) => b.getAttribute('data-state'))).toEqual(['done', 'cancelled', 'cancelled']);
    expect(blocks()[1]!).toHaveAccessibleName('Closing the open windows, cancelled');
  });
});

describe('without a progress view', () => {
  it('still draws the busy overlay with its message, as before', async () => {
    const t = setup();
    t.begin();
    expect(await screen.findByTestId('app-closing-overlay')).toBeInTheDocument();
    expect(screen.getByTestId('app-closing-message')).toHaveTextContent('Preparing to close');
    expect(blocks()).toHaveLength(0);
  });
});
