/**
 * 041 US4 (#314) — REACHING A NOTICE FROM THE KEYBOARD, AND GETTING BACK.
 *
 * 030 FR-060a stated this gap and deferred it here by name. The affected-panel list is ALREADY a tab
 * stop; what is missing is a route to it and a way back. So a keyboard user who is told "eleven
 * panels could not be opened" reaches the list by tabbing forward through the entire application
 * until focus happens to land there — an unbounded number of presses to read something that exists
 * to be read.
 *
 * ══ WHAT IS ASSERTED HERE, AND WHAT CANNOT BE ══
 *
 * Focus movement WITHIN one surface is exactly what Constitution V puts at the component layer, and
 * `document.activeElement` is real in jsdom. What is not real here is the stylesheet: jsdom applies
 * none and lays nothing out, so FR-025's "visible affordance" is asserted as MARKUP (FR-025a) —
 * an attribute a test can see — and its appearance is a stylesheet decision like every other.
 *
 * The one thing no cheaper layer can observe is that a REAL SHELL never receives the chord. That is
 * one E2E, in `window-chord-resolution.e2e.ts`, beside the family it belongs to.
 */
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NotificationProvider,
  useNotify,
  focusMostRecentNotice,
  type NoticeInput,
} from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';

let settingsPayload: Record<string, unknown> = { version: 1 };

beforeEach(() => {
  settingsPayload = { version: 1 };
  (window as unknown as { throng: unknown }).throng = {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: settingsPayload }) },
  };
});

afterEach(() => {
  delete (window as unknown as { throng?: unknown }).throng;
  vi.useRealTimers();
});

interface Probe {
  notify?: (input: NoticeInput) => void;
  loaded?: boolean;
}

function ProbeView({ into }: { into: Probe }): ReactElement {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  // A real element outside the notice stack, so "focus went back where it came from" has somewhere
  // truthful to go back TO. Asserting against `document.body` would pass for a lost focus.
  return createElement('button', { 'data-testid': 'origin' }, 'origin');
}

async function mount(): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(ProbeView, { into: probe, key: 'probe' }),
      ),
    ),
  );
  await waitFor(() => {
    expect(probe.loaded, 'the seeded settings never reached the config store').toBe(true);
  });
  return probe;
}

function raise(id: string, subject: string): NoticeInput {
  return {
    severity: 'error',
    message: 'That file is too large to open in an editor.',
    subject: { kind: 'project', name: subject },
    testId: id,
    groupKey: `op:${id}::p1`,
    affected: [{ subject: `${subject}.bin`, reason: 'too-large', displayPath: `${subject}.bin` }],
  };
}

/** The focusable list inside a notice — the thing FR-021 says must be reachable. */
function listOf(testId: string): HTMLElement {
  return screen.getByTestId(testId).querySelector('[data-testid="notice-affected"]') as HTMLElement;
}

describe('focus.notice reaches the most recent notice (FR-020)', () => {
  it('moves focus into the newest notice', async () => {
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));

    screen.getByTestId('origin').focus();
    act(() => focusMostRecentNotice());

    expect(document.activeElement).toBe(listOf('n-a'));
  });

  it('is IDEMPOTENT — a second press stays on the same notice, it does not walk (FR-020d)', async () => {
    // Several notices can be live at once (FR-003a, FR-006). Traversing them is Tab's job under
    // FR-023, so the binding only has to get the user INTO the stack — which is all SC-005 claims.
    // Cycling here would also contradict FR-020c's reasoning about the ring.
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));
    act(() => probe.notify!(raise('n-b', 'Bravo')));
    act(() => probe.notify!(raise('n-c', 'Charlie')));

    act(() => focusMostRecentNotice());
    const first = document.activeElement;
    act(() => focusMostRecentNotice());
    act(() => focusMostRecentNotice());

    expect(document.activeElement, 'the binding walked the stack instead of staying put').toBe(first);
  });

  it('does not move focus when a further notice arrives (FR-020e)', async () => {
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));
    act(() => focusMostRecentNotice());
    const before = document.activeElement;

    act(() => probe.notify!(raise('n-b', 'Bravo')));

    expect(document.activeElement, 'an arriving notice stole focus from a reader').toBe(before);
  });

  it('does nothing at all when there is no notice, and raises none to say so (FR-024)', async () => {
    await mount();
    screen.getByTestId('origin').focus();
    const before = document.activeElement;

    act(() => focusMostRecentNotice());

    expect(document.activeElement).toBe(before);
    expect(
      screen.queryAllByTestId('notices')[0]?.children.length ?? 0,
      'a notice about the absence of notices',
    ).toBe(0);
  });
});

describe('Escape returns focus where it came from (FR-022)', () => {
  it('lands on the element focused BEFORE the binding was pressed', async () => {
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));
    const origin = screen.getByTestId('origin');
    origin.focus();

    act(() => focusMostRecentNotice());
    expect(document.activeElement).not.toBe(origin);

    act(() => {
      listOf('n-a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.activeElement).toBe(origin);
  });

  it('still lands there after the user has tabbed on to another notice (FR-022a)', async () => {
    // The origin is captured when the binding is pressed and is NOT re-captured by Tab. Otherwise
    // Escape returns to the previous NOTICE, and the user is still stuck in the stack.
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));
    act(() => probe.notify!(raise('n-b', 'Bravo')));
    const origin = screen.getByTestId('origin');
    origin.focus();

    act(() => focusMostRecentNotice());
    act(() => listOf('n-a').focus()); // as Tab would

    act(() => {
      listOf('n-a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(document.activeElement).toBe(origin);
  });

  it('falls back to a real surface when the origin is gone (FR-022b)', async () => {
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));

    // The origin is created and removed by the TEST, not by React. Ripping a React-managed node out
    // of the tree makes React throw on its next cleanup ("The node to be removed is not a child of
    // this node"), which fails the test for a reason that has nothing to do with the behaviour.
    const origin = document.createElement('button');
    document.body.appendChild(origin);
    origin.focus();
    act(() => focusMostRecentNotice());

    origin.remove(); // its panel closed while the user was reading

    act(() => {
      listOf('n-a').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(
      document.activeElement,
      'focus was dropped to the document body, which is nowhere: no keybinding scope resolves there, so the next chord silently does nothing',
    ).not.toBe(document.body);
  });
});

describe('the list is reachable and never traps (FR-021, FR-023)', () => {
  it('is a tab stop, so it can be scrolled from the keyboard', async () => {
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));

    expect(listOf('n-a').getAttribute('tabindex')).toBe('0');
  });

  it('does not trap: nothing inside it takes focus of its own', async () => {
    // What makes Tab leave. A row that were focusable would hold the user inside a list they cannot
    // act on — 030 FR-032b is explicit that rows are READ, not operated.
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));

    const focusable = listOf('n-a').querySelectorAll('[tabindex], a, button, input, select, textarea');
    expect(focusable).toHaveLength(0);
  });
});

describe('the list says it is focusable BEFORE focus arrives (FR-025, FR-025a)', () => {
  it('carries the affordance in the markup', async () => {
    // Markup, not a stylesheet rule: jsdom applies no CSS, so a style-only cue could be proven
    // nowhere below an Electron launch — and Constitution V reserves E2E for what no cheaper layer
    // can observe. The cue's APPEARANCE is still CSS, and still unasserted.
    const probe = await mount();
    act(() => probe.notify!(raise('n-a', 'Alpha')));

    expect(listOf('n-a').getAttribute('data-focusable')).toBe('true');
  });

  it('a notice with no list carries no affordance', async () => {
    const probe = await mount();
    act(() =>
      probe.notify!({
        severity: 'error',
        message: 'Something happened.',
        subject: { kind: 'none' },
        testId: 'n-plain',
      }),
    );

    expect(screen.getByTestId('n-plain').querySelector('[data-focusable]')).toBeNull();
  });
});
