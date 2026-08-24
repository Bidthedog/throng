import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement, type ReactElement } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { AffectedPanel } from '@throng/core';
import {
  NotificationProvider,
  useNotify,
  type NoticeInput,
} from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';

/**
 * #313 — A NOTICE IS AN INTERACTIVE SURFACE, AND A CLICK ON IT HITS THE NOTICE.
 *
 * `.notices` set `pointer-events: none` and `.notice` never took it back, so every part of the card
 * except the two icon buttons was transparent to the pointer: a click on a notice activated whatever
 * was drawn beneath it, and the affected-panel list's scrollbar was painted but inert.
 *
 * That was deliberate — 030 FR-032b, and the comment above `.notice__affected` in theme.css keeps
 * the measurement behind it: a notice listing two panels sat over the panel-type form's Confirm
 * button and swallowed 60 retried clicks. The supersession recorded in 030's spec.md is that
 * click-through does not remove that collision, it makes it INVISIBLE — the user activates a control
 * they cannot see, with no feedback, because the notice is drawn over the result.
 *
 * ══ THIS FILE ASSERTS CSS AT THE COMPONENT TIER, AND ANOTHER ONE REFUSES TO. READ THIS FIRST. ══
 *
 * `packages/ui/tests/component/preferences-capture-modal.test.ts:15-19` leaves its `user-select`
 * assertions at E2E and says why: *"jsdom does not apply a real cascade, so a component test
 * asserting it would be asserting about jsdom rather than about throng — which is the trap 034
 * FR-049 names."* That is correct, and it is correct about the layer AS CONFIGURED: nothing in
 * `tests/component/setup.ts` loads the application's stylesheet, so `getComputedStyle` returns
 * user-agent defaults, and a test reading one learns nothing about throng.
 *
 * This file does not overrule that. It removes its premise, and only for what it can prove it
 * removed:
 *
 *   1. It LOADS `src/renderer/theme.css` into the document, so the cascade under test is throng's.
 *   2. The first `describe` is an anti-vacuity control that fails if the sheet did not parse — so
 *      "the stylesheet was never there" cannot masquerade as a pass.
 *   3. It asserts only what jsdom resolves faithfully: `pointer-events` is a keyword declared on
 *      plain class selectors. jsdom does NOT substitute `var()` — `.notice__affected`'s
 *      `max-height` comes back as the literal `var(...)` string — so nothing here asserts a
 *      length, a colour, or anything computed through one.
 *
 * And 034 FR-049's reserve is *compositing, hardware rendering and operating-system focus*. A
 * cascade is none of the three. The HIT TEST is — no test below E2E can prove the browser delivered
 * a click to one element rather than another — which is why this file is only half the coverage:
 * `packages/ui/tests/e2e/notice-overlay.e2e.ts` clicks a real notice over a real control and
 * asserts the control did not fire. This one proves the input to that hit test; that one proves the
 * hit test. Neither substitutes for the other, and a fix that satisfied only this file could be
 * `pointer-events: auto` on an element nothing ever draws.
 *
 * ══ WHAT IS PRESERVED, NOT REPLACED ══
 *
 * FR-032b's other half is still right and is guarded here: the list stays a tab stop and nothing
 * inside it takes focus, so a user who tabs in can tab out. Mouse support is being ADDED to the
 * keyboard route, not substituted for it.
 */

/*
 * Resolved from the runner's root rather than from `import.meta.url`: under the jsdom environment
 * the module URL is an `http://localhost/` one, and `fileURLToPath` rejects it outright. Vitest runs
 * every project with the repository root as its working directory, and the `existsSync` guard below
 * turns a future move of either file into a named failure rather than an empty stylesheet.
 */
const THEME_CSS = resolve(process.cwd(), 'packages/ui/src/renderer/theme.css');

let sheet: HTMLStyleElement;

beforeAll(() => {
  expect(existsSync(THEME_CSS), `theme.css was not found at ${THEME_CSS}`).toBe(true);
  sheet = document.createElement('style');
  sheet.textContent = readFileSync(THEME_CSS, 'utf8');
  document.head.appendChild(sheet);
});

afterAll(() => {
  sheet.remove();
});

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
});

interface Probe {
  notify?: (input: NoticeInput) => void;
  loaded?: boolean;
}

function ProbeView({ into }: { into: Probe }): ReactElement | null {
  into.notify = useNotify().notify;
  into.loaded = useConfigLoaded();
  return null;
}

async function mount(): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(NotificationProvider, null, createElement(ProbeView, { into: probe })),
    ),
  );
  await waitFor(() => {
    expect(probe.loaded, 'the seeded settings never reached the config store').toBe(true);
  });
  return probe;
}

/** Two defeated panels in one tab — the shape that produces a scrollable affected list. */
const AFFECTED: readonly AffectedPanel[] = [
  { panelId: 'p1', panelName: 'Build', tabId: 't1', tabName: 'Main', tabOrder: 0, panelOrder: 0 },
  { panelId: 'p2', panelName: 'Notes', tabId: 't1', tabName: 'Main', tabOrder: 0, panelOrder: 1 },
];

/** Raise the consolidated notice #313 was found on: a subject, a message, and the panel list. */
async function raiseConsolidated(): Promise<void> {
  const probe = await mount();
  act(() =>
    probe.notify!({
      severity: 'error',
      action: 'open',
      subject: { kind: 'project', name: 'Alpha' },
      message: 'The folder for this project could not be found.',
      affected: AFFECTED,
    }),
  );
  await waitFor(() => expect(document.querySelector('.notice')).not.toBeNull());
}

const el = (selector: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(selector);
  expect(found, `expected ${selector} to be rendered`).not.toBeNull();
  return found!;
};

/** What the browser's hit test consults, and the only thing it consults, at this layer. */
const pointerEventsOf = (selector: string): string =>
  window.getComputedStyle(el(selector)).pointerEvents;

/*
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Every assertion in this file is `getComputedStyle` over an injected stylesheet, so the one way it
 * could all pass while proving nothing is the sheet failing to parse — every value would fall back
 * to a user-agent default, and `pointer-events` defaults to `auto`, which is what the fixed code is
 * expected to produce. This test states a value theme.css sets TODAY and the fix does not touch, so
 * a sheet that did not land fails here first and names the reason.
 */
describe('the stylesheet under test is really loaded', () => {
  it('cascades a rule theme.css declares today', async () => {
    await raiseConsolidated();
    expect(
      pointerEventsOf('.notice__dismiss'),
      'theme.css did not parse or did not cascade — every other assertion here is vacuous',
      // `.notice__dismiss` re-enables pointer events explicitly at `theme.css:2535`.
    ).toBe('auto');
    expect(window.getComputedStyle(el('.notices')).position).toBe('fixed');
  });
});

describe('#313 — a click on a notice hits the notice', () => {
  it('does not pass the click through the card to whatever is beneath it', async () => {
    await raiseConsolidated();
    expect(
      pointerEventsOf('.notice'),
      'the card is transparent to the pointer, so the hit test walks past it to the control ' +
        'underneath and activates something the user cannot see',
    ).not.toBe('none');
  });

  it('leaves the column itself transparent, so only the cards are solid', async () => {
    await raiseConsolidated();
    // The other half of the same rule, and the reason `.notices` keeps `none`: the column is a
    // fixed 520px-wide strip up the whole right-hand side of the window, and the empty space
    // between and above the cards must never intercept anything.
    expect(pointerEventsOf('.notices')).toBe('none');
  });
});

describe('#313 — the affected-panel list scrolls by mouse as well as keyboard', () => {
  it('lets the wheel reach the scroll region', async () => {
    await raiseConsolidated();
    expect(
      pointerEventsOf('.notice__affected'),
      'the list cannot receive a wheel event, so its scrollbar is drawn but inert',
    ).not.toBe('none');
    expect(window.getComputedStyle(el('.notice__affected')).overflowY).toBe('auto');
  });

  it('keeps the keyboard route, and does not trap focus in it (FR-032b, preserved)', async () => {
    await raiseConsolidated();
    const list = el('.notice__affected');
    expect(list.tabIndex, 'the list must remain a tab stop').toBe(0);
    expect(
      list.querySelectorAll('a,button,input,select,textarea,[tabindex]').length,
      'nothing inside the list may take focus, or Tab could not leave it',
    ).toBe(0);
  });
});

describe('#313 — dismissal is the remedy when a notice covers something', () => {
  it('is dismissable, which is what the supersession rests on', async () => {
    await raiseConsolidated();
    // The panel-type form's Confirm button sits bottom-right of its panel and the notice column
    // bottom-right of the window: they really do collide, and dismissal is the sanctioned way out.
    await userEvent.click(el('.notice__dismiss'));
    await waitFor(() => expect(document.querySelector('.notice')).toBeNull());
  });
});
