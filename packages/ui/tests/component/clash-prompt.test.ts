/**
 * 050 T052 (FR-017, FR-018 – FR-018f, contracts/ui-surfaces §1) — the question asked when a pasted or
 * dragged item's name is already taken.
 *
 * Nothing happens to either item until the user answers (SC-006), so the prompt is a real modal on the
 * one confirmation model (`useChoose`): the focus trap, Escape and the text-labelled decision buttons
 * come with it. This file proves what is specific to the question — what it names, what it compares,
 * which answer Enter and Escape give, that the "apply to all" box is reachable and its state travels
 * with the answer, and that the permanent-replace wording is honest about it.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ClashQuestion } from '@throng/core';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ClashPrompt } from '../../src/renderer/explorer/clash-prompt.js';
import { fakeTransfer } from './helpers/explorer-harness.js';

let transfer: ReturnType<typeof fakeTransfer>;

beforeEach(() => {
  transfer = fakeTransfer();
  Reflect.set(window, 'throng', { transfer: transfer.api });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

const host = (): ReactElement =>
  createElement(ConfirmProvider, null, createElement(ClashPrompt));

const FILE_QUESTION: ClashQuestion = {
  jobId: 'job-1',
  requestId: 'req-1',
  name: 'config.json',
  targetDir: 'C:/projects/demo/Docs',
  existing: { kind: 'file', size: 1_234_567, modifiedMs: Date.UTC(2026, 0, 2, 3, 4, 5), newer: false },
  incoming: { kind: 'file', size: 2048, modifiedMs: Date.UTC(2026, 5, 6, 7, 8, 9), newer: true },
  permanentReplace: false,
};

const ask = (q: ClashQuestion = FILE_QUESTION): void => transfer.clash(q);

describe('what the question says (050 T052, FR-018)', () => {
  it('names the clashing item and the target folder', () => {
    render(host());
    ask();

    const dialog = screen.getByTestId('clash-dialog');
    expect(dialog.textContent).toContain('Name already exists');
    const message = screen.getByTestId('clash-message');
    expect(message.textContent).toContain('"config.json" already exists in Docs.');
    // The name is emphasised inside its own sentence.
    expect(within(message).getByText('config.json').tagName).toBe('STRONG');
  });

  it('shows both sides — size (digit-grouped) and modified time — and marks the newer one', () => {
    render(host());
    ask();

    const details = screen.getByTestId('clash-details');
    const text = details.textContent ?? '';
    expect(text).toContain('Existing');
    expect(text).toContain('Incoming');
    expect(text).toContain('1,234,567');
    expect(text).toContain('2,048');
    // Exactly one side carries the "Newer" mark, and it is the incoming one.
    const marks = within(details).getAllByText('Newer');
    expect(marks).toHaveLength(1);
    expect(screen.getByTestId('clash-incoming').textContent).toContain('Newer');
    expect(screen.getByTestId('clash-existing').textContent).not.toContain('Newer');
  });

  it('shows an item COUNT for a folder instead of a size', () => {
    render(host());
    ask({
      ...FILE_QUESTION,
      existing: { kind: 'folder', itemCount: 12, newer: false },
      incoming: { kind: 'folder', itemCount: 1500, newer: false },
    });

    const text = screen.getByTestId('clash-details').textContent ?? '';
    expect(text).toContain('12');
    expect(text).toContain('1,500');
    expect(text).not.toContain('bytes');
    expect(screen.queryByText('Newer')).toBeNull();
  });

  it('offers Cancel, Skip, Keep both, Replace — in that order', () => {
    render(host());
    ask();

    const labels = within(screen.getByTestId('clash-dialog'))
      .getAllByRole('button')
      .map((b) => b.textContent);
    expect(labels).toEqual(['Cancel', 'Skip', 'Keep both', 'Replace']);
  });
});

describe('the answer (050 T052, FR-018)', () => {
  it('Enter answers Replace — it is the default choice and holds focus', async () => {
    render(host());
    ask();

    expect(document.activeElement).toBe(screen.getByTestId('clash-replace'));
    await userEvent.keyboard('{Enter}');

    expect(transfer.api.resolveClash).toHaveBeenCalledWith('req-1', {
      choice: 'replace',
      applyToAll: false,
    });
  });

  it('Escape answers Cancel', async () => {
    render(host());
    ask();

    fireEvent.keyDown(screen.getByTestId('clash-dialog'), { key: 'Escape' });

    await waitFor(() =>
      expect(transfer.api.resolveClash).toHaveBeenCalledWith('req-1', { choice: 'cancel' }),
    );
  });

  it.each([
    ['clash-skip', 'skip'],
    ['clash-keep-both', 'keep-both'],
    ['clash-cancel', 'cancel'],
  ] as const)('%s answers %s', async (testId, choice) => {
    render(host());
    ask();

    await userEvent.click(screen.getByTestId(testId));

    const answer = transfer.api.resolveClash.mock.calls[0]![1] as { choice: string };
    expect(answer.choice).toBe(choice);
    expect(transfer.api.resolveClash.mock.calls[0]![0]).toBe('req-1');
  });

  it('reaches the apply-to-all checkbox with Tab, and its state travels with the choice', async () => {
    render(host());
    ask();
    const box = screen.getByTestId('clash-apply-all') as HTMLInputElement;

    /*
     * Reachable by Tab: a native, enabled checkbox with a tab stop, INSIDE the dialog the focus trap
     * wraps. jsdom cannot press Tab through the trap itself — the trap's `offsetParent` visibility
     * test is always false there — so what is provable at this layer is that nothing takes it out of
     * the ring: it is not disabled, not `tabindex=-1`, and it is in the modal's own subtree.
     */
    expect(box.type).toBe('checkbox');
    expect(box.disabled).toBe(false);
    expect(box.tabIndex).toBe(0);
    expect(screen.getByTestId('clash-dialog').contains(box)).toBe(true);

    box.focus();
    await userEvent.keyboard(' ');
    expect(box.checked).toBe(true);
    await userEvent.click(screen.getByTestId('clash-skip'));

    expect(transfer.api.resolveClash).toHaveBeenCalledWith('req-1', {
      choice: 'skip',
      applyToAll: true,
    });
  });

  it('does not carry a ticked box over to the NEXT question', async () => {
    render(host());
    ask();
    await userEvent.click(screen.getByTestId('clash-apply-all'));
    await userEvent.click(screen.getByTestId('clash-skip'));

    act(() => ask({ ...FILE_QUESTION, requestId: 'req-2' }));
    await userEvent.click(screen.getByTestId('clash-keep-both'));

    expect(transfer.api.resolveClash).toHaveBeenLastCalledWith('req-2', {
      choice: 'keep-both',
      applyToAll: false,
    });
  });
});

describe('Replace under a permanent replace mode (050 T052, FR-018f)', () => {
  it('says it cannot be undone', () => {
    render(host());
    ask({ ...FILE_QUESTION, permanentReplace: true });

    const replace = screen.getByTestId('clash-replace');
    expect(replace.textContent).toBe('Replace (cannot be undone)');
    expect(replace.className).toContain('danger');
  });

  it('is plain `Replace` when the old item goes to the Recycle Bin', () => {
    render(host());
    ask();

    const replace = screen.getByTestId('clash-replace');
    expect(replace.textContent).toBe('Replace');
    expect(replace.className).not.toContain('danger');
  });
});
