/**
 * The in-app attention toast (057 US3, FR-033, FR-035, FR-036, FR-037; research R12; contracts/
 * app-attention.md `throng:attention:toast`).
 *
 * Layer: component — the REAL `NotificationProvider` and `AttentionToasts`, with the bridge's
 * `onToast` standing in for main. What a card says, which severity it wears, whether its link is in the
 * tab order and that an update patches the SAME card are all DOM facts; that main picks ONE window is
 * main's rule and is tested in `attention-service.test.ts`.
 *
 * ANTI-VACUITY CONTROL: raise with no `instanceKey` and the two-panels test fails (041's identical-
 * content rule folds them into one card); raise `update` as a second `notify` and the same-card test
 * fails; leave the link out of the tab order and the keyboard test fails.
 */
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { AttentionToasts } from '../../src/renderer/attention/attention-toasts.js';
import type { AttentionToastEvent } from '../../src/renderer/global.js';

let push: (e: AttentionToastEvent) => void;
let goTo: ReturnType<typeof vi.fn<(panelId: string) => void>>;

beforeEach(() => {
  goTo = vi.fn<(panelId: string) => void>();
  Reflect.set(window, 'throng', {
    attention: {
      onToast: (cb: (e: AttentionToastEvent) => void) => {
        push = cb;
        return () => {};
      },
      goTo,
    },
  });
  render(createElement(NotificationProvider, null, createElement(AttentionToasts)));
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

const raise = (panelId: string, over: Partial<AttentionToastEvent> = {}): void =>
  act(() => push({ op: 'raise', panelId, kind: 'attention', title: `Panel ${panelId}`, projectName: 'Alpha', reason: 'Bell', ...over }));

const card = (panelId: string): HTMLElement => screen.getByTestId(`attention-toast-${panelId}`);

describe('raise', () => {
  it('heads the card with the project, the tab and the panel, over the reason (FR-120)', () => {
    raise('p1', { title: 'Build', tabTitle: 'Agents', reason: 'Wants your attention' });
    const text = card('p1').textContent ?? '';
    expect(text).toContain('Alpha — Agents — Build');
    expect(text).toContain('Wants your attention');
  });

  it('is an info notice for Attention and an error notice for Failed (FR-037)', () => {
    raise('p1');
    raise('p2', { kind: 'failed', reason: "Exited with code 1" });
    expect(card('p1').className).toContain('notice--info');
    expect(card('p2').className).toContain('notice--error');
  });

  it('two panels give two toasts, not one folded card', () => {
    raise('p1');
    raise('p2'); // same kind, same reason, same project: identical but for the panel
    expect(screen.getAllByTestId(/^attention-toast-p\d$/)).toHaveLength(2);
  });

  it('offers a go-to-panel control that is an icon with a title, in the tab order (030 FR-032b)', async () => {
    raise('p1');
    const go = within(card('p1')).getByTestId('attention-toast-goto-p1');
    expect(go).toHaveAttribute('title', expect.stringMatching(/go to/i));
    expect(go.tabIndex).toBeGreaterThanOrEqual(0);
    const user = userEvent.setup();
    await user.tab();
    // Reachable by keyboard: tabbing from the document start lands on a control inside the notices.
    expect(document.activeElement).not.toBe(document.body);
    go.focus();
    await user.keyboard('{Enter}');
    expect(goTo).toHaveBeenCalledWith('p1');
  });

  // FR-122 — the go-to control is one of the card's own controls, beside Copy and Dismiss and drawn as
  // they are, not a button in the card's body.
  it('puts go-to-panel beside Copy and Dismiss, styled as they are (FR-122)', () => {
    raise('p1');
    const go = within(card('p1')).getByTestId('attention-toast-goto-p1');
    const copy = within(card('p1')).getByTestId('attention-toast-p1-copy');
    const dismiss = within(card('p1')).getByTestId('attention-toast-p1-dismiss');
    expect(go.parentElement).toBe(copy.parentElement);
    expect(within(card('p1')).getByTestId('notice-body')).not.toContainElement(go);
    expect([...card('p1').children]).toEqual(expect.arrayContaining([go, copy, dismiss]));
    expect(go.nextElementSibling).toBe(copy);
    expect(copy.nextElementSibling).toBe(dismiss);
    expect(go.className).toContain('notice__control');
  });

  it('keeps Dismiss (030 FR-060)', () => {
    raise('p1');
    expect(within(card('p1')).getByTestId('attention-toast-p1-dismiss')).toHaveAttribute('title', 'Dismiss');
  });
});

describe('update and dismiss', () => {
  it('update patches the SAME card in place', () => {
    raise('p1');
    const before = card('p1');
    act(() => push({ op: 'update', panelId: 'p1', kind: 'failed', title: 'Build', projectName: 'Alpha', reason: 'Exited with code 2' }));
    expect(card('p1')).toBe(before);
    expect(before.textContent).toContain('Exited with code 2');
    expect(before.className).toContain('notice--error');
    expect(screen.getAllByTestId('attention-toast-p1')).toHaveLength(1);
  });

  it('an update for a toast that is not showing raises nothing: the mark was already announced (FR-112)', () => {
    act(() => push({ op: 'update', panelId: 'p9', kind: 'attention', title: 'Late', projectName: 'Alpha', reason: 'Bell' }));
    expect(screen.queryByTestId('attention-toast-p9')).toBeNull();
  });

  it('dismiss removes the card', () => {
    raise('p1');
    raise('p2');
    act(() => push({ op: 'dismiss', panelId: 'p1' }));
    expect(screen.queryByTestId('attention-toast-p1')).toBeNull();
    expect(card('p2')).toBeInTheDocument();
  });

  it('dismiss for a toast that is not showing does nothing', () => {
    expect(() => act(() => push({ op: 'dismiss', panelId: 'nobody' }))).not.toThrow();
  });

  it('after a dismiss the same panel can raise a fresh card', () => {
    raise('p1');
    act(() => push({ op: 'dismiss', panelId: 'p1' }));
    raise('p1');
    expect(card('p1')).toBeInTheDocument();
  });
});
