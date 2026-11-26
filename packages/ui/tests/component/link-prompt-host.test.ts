/**
 * 080 FR-063, FR-070 — the prompt an external link shows, inline in the window the link was followed in: the
 * common confirm dialog with the whole address, Cancel focused, Esc as Cancel, Open, and Change in Preferences.
 *
 * Layer: component — what the host renders when main asks, and what it sends back. Main's gate is
 * `external-link-prompt.test.ts`; the window it asks is the Help window E2E.
 */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkPromptHost } from '../../src/renderer/link-prompt/link-prompt-host.js';

const URL = 'https://github.com/Bidthedog/throng/issues';
let answer: ReturnType<typeof vi.fn>;
let ask: ((request: { id: number; url: string }) => void) | undefined;

beforeEach(() => {
  answer = vi.fn();
  ask = undefined;
  Reflect.set(window, 'throng', {
    linkPrompt: {
      onAsk: (cb: (request: { id: number; url: string }) => void) => {
        ask = cb;
        return () => (ask = undefined);
      },
      answer,
    },
  });
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

async function asked(id = 7): Promise<void> {
  render(createElement(LinkPromptHost));
  expect(screen.queryByTestId('link-prompt')).toBeNull();
  await waitFor(() => expect(ask).toBeDefined());
  act(() => ask!({ id, url: URL }));
  await waitFor(() => expect(screen.getByTestId('link-prompt-url')).toHaveTextContent(URL));
}

describe('the external-link prompt, inline (080 FR-063, FR-070)', () => {
  it('shows the whole address in the common dialog, with Cancel focused', async () => {
    await asked();
    expect(screen.getByTestId('link-prompt')).toHaveClass('modal');
    await waitFor(() => expect(screen.getByTestId('link-prompt-cancel')).toHaveFocus());
  });

  it.each([
    ['link-prompt-open', 'open'],
    ['link-prompt-cancel', 'cancel'],
    ['link-prompt-preferences', 'preferences'],
  ])('answers the request it was asked with %s', async (testId, reply) => {
    await asked(9);
    fireEvent.click(screen.getByTestId(testId));
    await waitFor(() => expect(answer).toHaveBeenCalledExactlyOnceWith(9, reply));
    expect(screen.queryByTestId('link-prompt')).toBeNull();
  });

  it('answers cancel on Esc', async () => {
    await asked(3);
    fireEvent.keyDown(screen.getByTestId('link-prompt'), { key: 'Escape' });
    await waitFor(() => expect(answer).toHaveBeenCalledExactlyOnceWith(3, 'cancel'));
  });
});
