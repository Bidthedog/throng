import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AffectedPanel } from '@throng/core';
import { NotificationProvider, useNotify, type NoticeInput } from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { flushUntil } from './helpers/flush-until.js';

/**
 * 030 FR-049 — WHAT A CONSOLIDATED NOTICE RENDERS IS WHAT ITS COPY CONTROL COPIES, IN THE SAME ORDER.
 *
 * Layer: component — the guard compares the card's DOM with the string handed to the clipboard seam,
 * and neither needs a window; only the final paste into a real editor does (that stays in
 * `failure-copy.e2e.ts`). Moved down from that E2E's DOM-versus-clipboard comparison, which paid for
 * four failing terminals and a two-minute launch to compare two strings.
 *
 * The comparison is by leaf element (jsdom has no `innerText`), each leaf's text found in a copied
 * line at or after the previous leaf's line. The monotonic index is what makes it an ORDER check.
 */

const AFFECTED: readonly AffectedPanel[] = [
  { panelId: 'p1', panelName: 'Build', tabId: 't1', tabName: 'Main', tabOrder: 0, panelOrder: 0, detail: 'ENOENT: no such file' },
  { panelId: 'p2', panelName: 'Notes', tabId: 't1', tabName: 'Main', tabOrder: 0, panelOrder: 1 },
  { panelId: 'p3', panelName: 'Shell', tabId: 't2', tabName: 'Second', tabOrder: 1, panelOrder: 0 },
];

const write = vi.fn(async (_entry: { text: string; mode: string }) => {});

beforeEach(() => {
  write.mockClear();
  (window as unknown as { throng: unknown }).throng = {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    clipboard: { write },
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
});

interface Probe {
  notify?: (input: NoticeInput) => void;
  loaded?: boolean;
}

function ProbeView({ into }: { into: Probe }): null {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  return null;
}

/** The text of every leaf element, in document order. */
function leafTexts(root: Element): string[] {
  const out: string[] = [];
  const visit = (el: Element): void => {
    if (el.children.length === 0) {
      const text = (el.textContent ?? '').trim();
      if (text) out.push(text);
      return;
    }
    for (const child of Array.from(el.children)) visit(child);
  };
  visit(root);
  return out;
}

describe('a copied notice carries everything it renders, in order (030 FR-049)', () => {
  it('copies the heading, message, body, affected list and details it draws, and the hidden system error besides', async () => {
    const probe: Probe = {};
    render(
      createElement(
        ConfigProvider,
        null,
        createElement(NotificationProvider, null, createElement(ProbeView, { into: probe })),
      ),
    );
    await flushUntil(() => probe.loaded === true);
    act(() =>
      probe.notify!({
        severity: 'error',
        testId: 'panel-failure-notice',
        action: 'open',
        subject: { kind: 'project', name: 'Ghost' },
        message: 'The folder for this project could not be found.',
        body: createElement('p', null, 'Rename it back, or choose a new folder.'),
        affected: AFFECTED,
        details: ['A detail line the card draws'],
        copyDetail: 'ENOENT: no such file or directory, lstat throng-e2e-missing',
      }),
    );
    await waitFor(() => expect(document.querySelector('[data-testid="notice-body"]')).not.toBeNull());

    const body = document.querySelector('[data-testid="notice-body"]')!;
    const rendered = leafTexts(body);
    expect(rendered.length, 'the notice rendered nothing to compare against').toBeGreaterThan(5);

    fireEvent.click(document.querySelector('[data-testid="panel-failure-notice-copy"]')!);
    await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
    const copied = write.mock.calls[0]![0].text.split('\n').map((l) => l.trim()).filter(Boolean);

    let from = 0;
    for (const text of rendered) {
      const at = copied.findIndex((c, i) => i >= from && c.includes(text));
      expect(
        at,
        `the notice renders "${text}" and the copied text does not carry it (in order) — copied:\n${copied.join('\n')}`,
      ).toBeGreaterThanOrEqual(0);
      from = at;
    }

    // The part that is copied and NEVER rendered: the system error nobody could retype (FR-034).
    expect(document.body.textContent ?? '', 'the notice renders the raw system error').not.toContain('ENOENT');
    expect(copied.join('\n'), 'the copy dropped the system error').toContain('throng-e2e-missing');
    expect(copied.join('\n'), 'the copy dropped the row detail').toContain('Build — ENOENT: no such file');
  });
});
