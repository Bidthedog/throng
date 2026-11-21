/**
 * 075 FR-082 — a PDF saved from Print Preview is reported in the window that asked for it: one success toast naming
 * the file, with Reveal in File Explorer when its folder is in the open project, or Open when it is not.
 *
 * Layer: component — what one renderer component renders and does with a pushed event; jsdom shows all of it.
 */
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { PrintSavedNotice } from '../../src/renderer/print/print-saved-notice.js';

let push: ((saved: { path: string }) => void) | undefined;
const openSaved = vi.fn(async (_path: string) => ({ ok: true }) as { ok: true } | { ok: false; osReason: string });

beforeEach(() => {
  push = undefined;
  openSaved.mockClear();
  Reflect.set(window, 'throng', {
    notices: { log: () => undefined },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    print: {
      openSaved,
      onSaved: (cb: (saved: { path: string }) => void) => {
        push = cb;
        return () => {
          push = undefined;
        };
      },
    },
  });
});
afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

async function saved(path: string, projectRoot: string | null): Promise<HTMLElement> {
  render(createElement(ConfigProvider, null, createElement(NotificationProvider, null, createElement(PrintSavedNotice, { projectRoot }))));
  await waitFor(() => expect(push).toBeDefined());
  act(() => push!({ path }));
  return screen.findByTestId('print-saved');
}

describe('a PDF saved from Print Preview (FR-082)', () => {
  it('names the file and where it went', async () => {
    const card = await saved('/home/u/out/notes.pdf', null);
    expect(card.textContent).toContain('notes.pdf');
    expect(card.textContent).toContain('/home/u/out');
  });

  it('offers Open when the folder is outside the project, and opens that file', async () => {
    const card = await saved('/home/u/out/notes.pdf', '/proj');
    expect(within(card).queryByTestId('print-saved-reveal')).toBeNull();
    const open = within(card).getByTestId('print-saved-open');
    expect(open.getAttribute('title')).toBe('Open notes.pdf');
    await act(async () => {
      fireEvent.click(open);
    });
    expect(openSaved).toHaveBeenCalledWith('/home/u/out/notes.pdf');
  });

  it('offers Reveal in File Explorer when the folder is in the project, and asks the tree to show it', async () => {
    const revealed: unknown[] = [];
    const listen = (e: Event): void => {
      revealed.push((e as CustomEvent).detail);
    };
    window.addEventListener('throng:reveal-in-tree', listen);
    try {
      const card = await saved('/proj/docs/notes.pdf', '/proj');
      expect(within(card).queryByTestId('print-saved-open')).toBeNull();
      const reveal = within(card).getByTestId('print-saved-reveal');
      expect(reveal.getAttribute('title')).toBe('Reveal in File Explorer');
      fireEvent.click(reveal);
      expect(revealed).toEqual([{ absPath: '/proj/docs/notes.pdf' }]);
    } finally {
      window.removeEventListener('throng:reveal-in-tree', listen);
    }
  });

  it('reports an Open the OS refused as one error naming the file', async () => {
    openSaved.mockResolvedValueOnce({ ok: false, osReason: '/home/u/out/notes.pdf no longer exists' });
    const card = await saved('/home/u/out/notes.pdf', null);
    await act(async () => {
      fireEvent.click(within(card).getByTestId('print-saved-open'));
    });
    const failed = await screen.findByTestId('print-saved-open-failed');
    expect(failed.textContent).toContain('no longer exists');
  });
});
