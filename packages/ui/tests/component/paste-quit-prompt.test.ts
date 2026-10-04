/**
 * 050 T058 (FR-019f, contracts/ui-surfaces §4) — quitting throng while a paste is running or queued.
 *
 * Main intercepts the window close and asks; the renderer puts the question: Wait for the pastes, or
 * Cancel them (which then asks Keep finished / Roll back, FR-019a). Dismissing the question abandons
 * the quit and leaves the paste running — the answer that loses nothing.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { PasteQuitPrompt } from '../../src/renderer/explorer/paste-quit-prompt.js';
import { fakeTransfer } from './helpers/explorer-harness.js';

let transfer: ReturnType<typeof fakeTransfer>;

beforeEach(() => {
  transfer = fakeTransfer();
  Reflect.set(window, 'throng', { transfer: transfer.api });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

const host = (): ReactElement => createElement(ConfirmProvider, null, createElement(PasteQuitPrompt));

describe('the quit prompt (050 T058)', () => {
  it('opens `A paste is still running` with Wait / Cancel pastes, saying how many', () => {
    render(host());
    transfer.quitPrompt({ running: 1, queued: 2 });

    const dialog = screen.getByTestId('quit-paste-dialog');
    expect(dialog.textContent).toContain('A paste is still running');
    expect(screen.getByTestId('quit-paste-message').textContent).toContain('1 running');
    expect(screen.getByTestId('quit-paste-message').textContent).toContain('2 queued');
    expect(screen.getByTestId('quit-wait').textContent).toBe('Wait');
    expect(screen.getByTestId('quit-cancel-pastes').textContent).toBe('Cancel pastes');
  });

  it('Wait sends `wait`', async () => {
    render(host());
    transfer.quitPrompt({ running: 1, queued: 0 });

    await userEvent.click(screen.getByTestId('quit-wait'));

    expect(transfer.api.quitChoice).toHaveBeenCalledWith('wait');
  });

  it('Escape sends `dismiss` — the quit is abandoned and the paste keeps running', async () => {
    render(host());
    transfer.quitPrompt({ running: 1, queued: 0 });

    fireEvent.keyDown(screen.getByTestId('quit-paste-dialog'), { key: 'Escape' });

    await waitFor(() => expect(transfer.api.quitChoice).toHaveBeenCalledWith('dismiss'));
  });

  it('Cancel pastes then asks Keep finished / Roll back, and sends the answer', async () => {
    render(host());
    transfer.quitPrompt({ running: 1, queued: 0 });
    await userEvent.click(screen.getByTestId('quit-cancel-pastes'));

    // Nothing is sent yet: the second question has to be answered first.
    expect(transfer.api.quitChoice).not.toHaveBeenCalled();
    const keep = await screen.findByTestId('paste-keep');
    expect(screen.getByTestId('paste-rollback')).toBeTruthy();
    await userEvent.click(keep);

    expect(transfer.api.quitChoice).toHaveBeenCalledWith('keep');
  });

  it('Cancel pastes → Roll back sends `rollback`', async () => {
    render(host());
    transfer.quitPrompt({ running: 1, queued: 0 });
    await userEvent.click(screen.getByTestId('quit-cancel-pastes'));
    await userEvent.click(await screen.findByTestId('paste-rollback'));

    expect(transfer.api.quitChoice).toHaveBeenCalledWith('rollback');
  });

  it('Escape on the second question abandons the quit rather than choosing for the user', async () => {
    render(host());
    transfer.quitPrompt({ running: 1, queued: 0 });
    await userEvent.click(screen.getByTestId('quit-cancel-pastes'));
    await screen.findByTestId('paste-keep');

    fireEvent.keyDown(screen.getByTestId('quit-paste-dialog'), { key: 'Escape' });

    await waitFor(() => expect(transfer.api.quitChoice).toHaveBeenCalledWith('dismiss'));
  });
});
