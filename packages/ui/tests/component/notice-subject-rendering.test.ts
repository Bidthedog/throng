import { render, waitFor, act } from '@testing-library/react';
import { createElement, type ReactElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NoticeSubject } from '@throng/core';
import {
  NotificationProvider,
  useNotify,
  type NoticeInput,
} from '../../src/renderer/common/notification.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';

/**
 * The subject reaches the SCREEN — heading, not prose (030 US2, FR-019/FR-020/FR-022/FR-023).
 *
 * MIGRATED FROM `packages/ui/tests/e2e/notice-subjects.e2e.ts` (035 T055):
 *   - `:157` a file failure names the file, not "this item"
 *   - `:199` a panel failure names Project — Tab — Panel
 *
 * ══ THE CLAIMS WERE ALREADY PROVEN. THE RENDER WAS NOT. ══
 *
 * Both E2Es assert a composed heading, and both compositions have exact unit tests:
 *
 *   `packages/ui/tests/unit/notice-heading.test.ts:37`  — the renamed file's heading
 *   `packages/ui/tests/unit/notice-heading.test.ts:52`  — `'Alpha — Main — Build'`, the three-part
 *                                                          panel form, character for character
 *   `packages/core/tests/unit/notice/subject.test.ts:65` — `formatSubject` over a full panel
 *
 * So the E2Es were launching an app, creating a project, colliding a real rename against a real
 * filesystem — and in the panel case polling the daemon's own name-claim RPC — to re-assert three
 * pure functions that were already covered.
 *
 * What NOTHING covered is the seam between them and the card: that `noticeHeading`'s output is what
 * lands in `.notice__title`, that the message beside it is left alone, and that FR-058's generic
 * stand-in is absent from the WHOLE notice rather than merely from the heading. That last one is the
 * assertion the E2E made that no unit test can: it reads the rendered card's full text.
 *
 * This is the recurring shape of spec 035 — a true citation, a proven half, and an untested join —
 * and here it is unusually clear-cut, because the two halves have separate, thorough test files and
 * nothing at all in between.
 *
 * ══ WHAT IS NOT HERE ══
 *
 * That a real rename collision, or a real daemon name adjustment, produces a notice carrying these
 * subjects. `notice-subjects.e2e.ts` keeps a test for the first; the second is the daemon's
 * `panelName.claim` round trip, and `panel-name-unique.e2e.ts` is where that lives.
 */

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

async function mount(children?: ReactNode): Promise<Probe> {
  const probe: Probe = {};
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(ProbeView, { into: probe, key: 'probe' }),
        children ?? null,
      ),
    ),
  );
  await waitFor(() => {
    expect(probe.loaded, 'the seeded settings never reached the config store').toBe(true);
  });
  return probe;
}

/** The rendered notice cards. */
const cards = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('.notice')];

const only = (): HTMLElement => {
  const all = cards();
  expect(all, 'expected exactly one notice card').toHaveLength(1);
  return all[0];
};

const titleOf = (card: HTMLElement): string => card.querySelector('.notice__title')?.textContent ?? '';
const messageOf = (card: HTMLElement): string =>
  card.querySelector('.notice__message')?.textContent ?? '';

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-025 — a file failure names the file
 * ────────────────────────────────────────────────────────────────────────── */

const FILE: NoticeSubject = { kind: 'file', name: 'alpha.txt' };
/** The real collision message, verbatim from the E2E: accurate, unclassified, and identifying nothing. */
const COLLISION = 'A file or folder with this name already exists.';

describe('a file failure names the file, not "this item" (FR-025)', () => {
  it('puts the file in the HEADING, above the message', async () => {
    const probe = await mount();
    act(() =>
      probe.notify!({ severity: 'error', action: 'rename', subject: FILE, message: COLLISION }),
    );

    const card = only();
    expect(titleOf(card)).toContain('alpha.txt');
  });

  it('leaves the MESSAGE saying only what went wrong — it does not restate the name (FR-023)', async () => {
    /*
     * The division FR-020/FR-023 draw: the heading says WHICH, the message says WHAT. A message that
     * repeats the name reads as a stutter and, worse, invites call sites to put the name only there
     * — which is how the heading ends up generic again.
     */
    const probe = await mount();
    act(() =>
      probe.notify!({ severity: 'error', action: 'rename', subject: FILE, message: COLLISION }),
    );

    expect(messageOf(only())).toBe(COLLISION);
  });

  it('has no generic stand-in ANYWHERE on the card, not merely in the heading (FR-058)', async () => {
    /*
     * The one assertion here that no unit test can make: it reads the whole rendered card. "An error
     * occurred when you tried to rename this item" is #195 — the single fact the notice exists to
     * carry is the one it withheld — and a fix that only reached the heading would leave the phrase
     * in a subtitle, an aria-label, or a button.
     */
    const probe = await mount();
    act(() =>
      probe.notify!({ severity: 'error', action: 'rename', subject: FILE, message: COLLISION }),
    );

    expect(only().innerHTML).not.toMatch(/this item|the item|this file/i);
  });

  it('still says something useful when there is no subject to name', async () => {
    // `{ kind: 'none' }` is a real answer — a thing that has gone between the failure and the render
    // — and the heading falls back to the ATTEMPT rather than inventing a placeholder (FR-027).
    const probe = await mount();
    act(() =>
      probe.notify!({
        severity: 'error',
        action: 'move these items',
        subject: { kind: 'none' },
        message: COLLISION,
      }),
    );

    expect(titleOf(only())).toBe('An error occurred when you tried to move these items');
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-022 — a panel is Project — Tab — Panel
 * ────────────────────────────────────────────────────────────────────────── */

describe('a panel failure names Project — Tab — Panel (FR-022)', () => {
  const panel: NoticeSubject = { kind: 'panel', name: 'Build (2)', tab: 'Main', project: 'SubjPanel' };

  it('renders all three parts, in that order, joined by the one separator', async () => {
    const probe = await mount();
    act(() =>
      probe.notify!({
        severity: 'warning',
        subject: panel,
        message: 'Another panel is already called Build, so this one was named Build (2).',
      }),
    );

    const heading = titleOf(only());
    expect(heading).toContain('SubjPanel');
    expect(heading).toContain('Build (2)');
    // The separator is `formatSubject`'s and is never re-spelled at a call site (FR-021), so the
    // shape is asserted rather than the literal string.
    expect(heading).toMatch(/SubjPanel\s*.\s*Main\s*.\s*Build \(2\)/);
  });

  it('names the panel WITHOUT an action prefix when nothing was attempted', async () => {
    // A name adjustment is not a failed attempt — it is a warning about something that happened. A
    // heading reading "Couldn't … " over it would describe an action the user never took.
    const probe = await mount();
    act(() => probe.notify!({ severity: 'warning', subject: panel, message: 'adjusted' }));

    expect(titleOf(only())).not.toMatch(/Couldn/);
  });

  it('composes the attempt WITH the panel when there was one', async () => {
    const probe = await mount();
    act(() =>
      probe.notify!({ severity: 'error', action: 'rename', subject: panel, message: 'nope' }),
    );

    expect(titleOf(only())).toMatch(/^Couldn.t rename SubjPanel/);
  });
});
