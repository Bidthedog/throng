/**
 * 050 T054 (FR-019a, contracts/ui-surfaces §3) — cancelling a paste asks what to do with what is done.
 *
 * Main aborts the item in progress and waits; the renderer asks `Keep finished` or `Roll back`, and
 * main acts on the answer. Escape is Keep finished — the one answer that undoes nothing — so a stray
 * key cannot delete a user's pasted items.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

const host = (): ReactElement => createElement(ConfirmProvider, null, createElement(ClashPrompt));

describe('the cancel choice (050 T054)', () => {
  it('opens `Cancel paste?` with Keep finished / Roll back', () => {
    render(host());
    transfer.cancelChoice({ jobId: 'job-1' });

    const dialog = screen.getByTestId('paste-cancel-dialog');
    expect(dialog.textContent).toContain('Cancel paste?');
    expect(screen.getByTestId('paste-cancel-message').textContent).toBe(
      'Keep the items already pasted, or roll the whole paste back?',
    );
    expect(screen.getByTestId('paste-keep').textContent).toBe('Keep finished');
    expect(screen.getByTestId('paste-rollback').textContent).toBe('Roll back');
  });

  it('Keep finished sends finishCancel(jobId, keep)', async () => {
    render(host());
    transfer.cancelChoice({ jobId: 'job-7' });

    await userEvent.click(screen.getByTestId('paste-keep'));

    expect(transfer.api.finishCancel).toHaveBeenCalledWith('job-7', 'keep');
  });

  it('Roll back sends finishCancel(jobId, rollback)', async () => {
    render(host());
    transfer.cancelChoice({ jobId: 'job-7' });

    await userEvent.click(screen.getByTestId('paste-rollback'));

    expect(transfer.api.finishCancel).toHaveBeenCalledWith('job-7', 'rollback');
  });

  it('Escape sends keep — the answer that undoes nothing', async () => {
    render(host());
    transfer.cancelChoice({ jobId: 'job-7' });

    fireEvent.keyDown(screen.getByTestId('paste-cancel-dialog'), { key: 'Escape' });

    await waitFor(() => expect(transfer.api.finishCancel).toHaveBeenCalledWith('job-7', 'keep'));
  });

  it('Enter does not roll back: focus starts on Keep finished', () => {
    render(host());
    transfer.cancelChoice({ jobId: 'job-7' });

    expect(document.activeElement).toBe(screen.getByTestId('paste-keep'));
    expect(transfer.api.finishCancel).not.toHaveBeenCalled();
  });

  it('is asked of the right run when two cancels follow each other', async () => {
    render(host());
    transfer.cancelChoice({ jobId: 'job-1' });
    await userEvent.click(screen.getByTestId('paste-keep'));

    act(() => transfer.cancelChoice({ jobId: 'job-2' }));
    await userEvent.click(screen.getByTestId('paste-rollback'));

    expect(transfer.api.finishCancel).toHaveBeenNthCalledWith(1, 'job-1', 'keep');
    expect(transfer.api.finishCancel).toHaveBeenNthCalledWith(2, 'job-2', 'rollback');
  });
});
