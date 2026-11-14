/**
 * 068 T109–T111 (FR-082 to FR-086) — a Notifications panel entry's four-line layout, its in-place expansion, and where an
 * ellipsis may appear; and a collapsed side pane's strip and show control sharing one hover.
 *
 * Layer: component. jsdom lays nothing out, so the line-1 shedding and the one-line cut are asserted as the stylesheet rules
 * that make them (the look is MT-05); the order of the parts, the expansion, the arming and the text are real DOM.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatPlace, SUBJECT_NAME_MAX, type NotificationEntry } from '@throng/core';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { NotificationsPanel } from '../../src/renderer/notifications/notifications-panel.js';
import type { NotificationsSnapshot } from '../../src/renderer/global.js';
import { flushUntil } from './helpers/flush-until.js';

vi.mock('../../src/renderer/state/projects-store.js', () => ({ useProjectsOptional: () => ({ projects: [] }) }));

let snapshot: NotificationsSnapshot;

const entry = (id: string, over: Partial<NotificationEntry> = {}): NotificationEntry => ({
  id,
  key: id,
  severity: 'error',
  title: `Title ${id}`,
  message: `Message ${id}`,
  details: [],
  copyText: 'x',
  affected: [],
  actions: [],
  raisedAt: 1,
  repeatCount: 1,
  ...over,
});
const snap = (entries: NotificationEntry[]): NotificationsSnapshot => ({
  entries,
  order: 'oldest',
  pendingCount: entries.length,
  pendingSeverity: entries[0]?.severity ?? null,
  limit: 100,
});
const PLACE = { project: 'Alpha', tab: 'Build', panel: 'Shell' };
const placed = (id: string, over: Partial<NotificationEntry> = {}): NotificationEntry =>
  entry(id, { origin: { panelId: 'p1', projectId: 'pr1' }, place: PLACE, repeatCount: 3, details: ['one.md'], ...over });

beforeEach(() => {
  snapshot = snap([]);
  Reflect.set(window, 'throng', {
    notices: { log: () => {} },
    config: { get: () => Promise.resolve({ settings: { version: 1 } }) },
    notifications: {
      list: () => Promise.resolve(snapshot),
      dismiss: () => Promise.resolve(snapshot),
      dismissAll: () => Promise.resolve(snapshot),
      setOrder: () => Promise.resolve(snapshot),
      dismissLimitWarning: () => {},
      onChanged: () => () => {},
      onRepeat: () => () => {},
      onLimitReached: () => () => {},
    },
    attention: { goTo: vi.fn(), goToPanel: vi.fn(), panelsExist: () => Promise.resolve(['p1']), onToast: () => () => {}, onChanged: () => () => {} },
  });
});

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

let loaded = false;
function Loaded(): null {
  loaded = useConfigLoaded();
  return null;
}
async function mount(): Promise<void> {
  loaded = false;
  render(
    createElement(
      ConfigProvider,
      null,
      createElement(
        NotificationProvider,
        null,
        createElement(
          ConfirmProvider,
          null,
          createElement(
            ContextMenuProvider,
            null,
            createElement(Loaded, { key: 'l' }),
            createElement(NotificationsPanel, { minimised: false, onToggleMinimise: () => {}, targetExists: () => true, runAction: () => {} }),
          ),
        ),
      ),
    ),
  );
  await flushUntil(() => loaded);
  await act(async () => {
    await Promise.resolve();
  });
}

const read = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8').replace(/\r\n/g, '\n');
const css = read('packages/ui/src/renderer/notifications/notifications.css');
const rule = (selector: string, source = css): string => {
  const at = source.indexOf(`${selector} {`);
  expect(at, `${selector} must have a rule`).toBeGreaterThanOrEqual(0);
  return source.slice(at, source.indexOf('}', at));
};
const moved = { movementX: 3, movementY: 1 };
const still = { movementX: 0, movementY: 0 };
const cards = (): HTMLElement[] => screen.getAllByTestId('notification-entry');

describe('the entry is four lines (FR-083)', () => {
  it('puts the icon, the date and time, the repeat count and the actions on line 1, then title, place and message in order', async () => {
    snapshot = snap([placed('a', { actions: [{ kind: 'openFile', label: 'Open', path: 'x' } as never] })]);
    await mount();
    const card = cards()[0]!;
    const rows = [...card.children].map((c) => c.className.split(' ')[0]);
    expect(rows).toEqual([
      'notification-entry__line1',
      'notification-entry__title',
      'notification-entry__place',
      'notification-entry__message',
      'notification-entry__details',
    ]);
    const line1 = card.querySelector('.notification-entry__line1')!;
    const inLine1 = [...line1.querySelectorAll('.notification-entry__icon, time, .notification-entry__count, .notification-entry__controls')].map((e) => e.className);
    expect(inLine1).toEqual(['notification-entry__icon', 'notification-entry__time', 'notification-entry__count', 'notification-entry__controls']);
    expect(line1.querySelector('.notification-entry__controls button')).not.toBeNull();
    expect(line1.textContent).toContain('×3');
  });

  it('draws no title or place line for an entry without them', async () => {
    snapshot = snap([entry('a', { title: '' })]);
    await mount();
    const card = cards()[0]!;
    expect(card.querySelector('.notification-entry__title')).toBeNull();
    expect(card.querySelector('.notification-entry__place')).toBeNull();
    expect(card.querySelector('.notification-entry__message')).not.toBeNull();
  });
});

describe('at rest: one line each, shed from the right on line 1, never the actions (FR-084)', () => {
  it('cuts each line after line 1 to one line with an ellipsis', () => {
    // One grouped rule over the three lines, found by its last selector.
    const r = rule(`.notification-entry:not([data-expanded='true']) .notification-entry__message`);
    expect(r).toMatch(/white-space:\s*nowrap/);
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(r).toMatch(/text-overflow:\s*ellipsis/);
    for (const sel of ['title', 'place']) expect(css).toContain(`.notification-entry:not([data-expanded='true']) .notification-entry__${sel},`);
  });

  it('keeps the details and affected lists out of the four lines', () => {
    expect(rule(".notification-entry:not([data-expanded='true']) :is(.notification-entry__details, .notification-entry__affected)")).toMatch(/display:\s*none/);
  });

  it('wraps the icon, date and count so what does not fit drops out whole, repeat count first, icon last, actions never', async () => {
    const lead = rule('.notification-entry__lead');
    expect(lead).toMatch(/flex-wrap:\s*wrap/);
    expect(lead).toMatch(/overflow:\s*hidden/);
    expect(lead).toMatch(/min-width:\s*0/);
    expect(rule('.notification-entry__controls')).toMatch(/flex:\s*0 0 auto/);
    snapshot = snap([placed('a')]);
    await mount();
    const lead1 = cards()[0]!.querySelector('.notification-entry__lead')!;
    expect([...lead1.children].map((c) => c.className.split(' ')[0] || c.tagName)).toEqual(['notification-entry__icon', 'notification-entry__time', 'notification-entry__count']);
    expect(lead1.contains(cards()[0]!.querySelector('.notification-entry__controls'))).toBe(false);
  });
});

describe('pointing at an entry expands it in place (FR-085)', () => {
  it('expands on a pointer that moves over it, and collapses when the pointer leaves', async () => {
    snapshot = snap([placed('a'), placed('b')]);
    await mount();
    const [a, b] = cards();
    expect(a!.getAttribute('data-expanded')).toBeNull();
    fireEvent.pointerMove(a!, moved);
    expect(a!.getAttribute('data-expanded')).toBe('true');
    expect(b!.getAttribute('data-expanded')).toBeNull();
    fireEvent.pointerLeave(a!);
    expect(a!.getAttribute('data-expanded')).toBeNull();
  });

  it('does not expand on entering without movement: a layout that moved under a still pointer is not pointing', async () => {
    snapshot = snap([placed('a'), placed('b')]);
    await mount();
    const [a, b] = cards();
    fireEvent.pointerMove(a!, moved);
    // `a` grew and `b` slid under the still pointer: the browser reports an enter and a move with no movement.
    fireEvent.pointerLeave(a!);
    fireEvent.pointerEnter(b!);
    fireEvent.pointerMove(b!, still);
    expect(b!.getAttribute('data-expanded')).toBeNull();
    fireEvent.pointerMove(b!, moved);
    expect(b!.getAttribute('data-expanded')).toBe('true');
  });

  it('never has two entries expanded by the pointer, so moving between entries does not oscillate', async () => {
    snapshot = snap([placed('a'), placed('b')]);
    await mount();
    const [a, b] = cards();
    fireEvent.pointerMove(a!, moved);
    fireEvent.pointerLeave(a!);
    fireEvent.pointerMove(b!, moved);
    expect(cards().map((c) => c.getAttribute('data-expanded'))).toEqual([null, 'true']);
  });

  it('expands on keyboard focus too, and collapses on blur', async () => {
    snapshot = snap([placed('a')]);
    await mount();
    const card = cards()[0]!;
    fireEvent.focus(card);
    expect(card.getAttribute('data-expanded')).toBe('true');
    fireEvent.blur(card);
    expect(card.getAttribute('data-expanded')).toBeNull();
  });

  it('wraps every line and shows the lists when expanded, with no popover', async () => {
    const wrapped = rule(".notification-entry[data-expanded='true'] :is(.notification-entry__title, .notification-entry__place, .notification-entry__message)");
    expect(wrapped).toMatch(/white-space:\s*normal/);
    expect(wrapped).toMatch(/overflow-wrap:\s*anywhere/);
    snapshot = snap([placed('a', { affected: [{ label: 'f.ts' } as never] })]);
    await mount();
    fireEvent.pointerMove(cards()[0]!, moved);
    expect(screen.queryByTestId('notification-place-popover')).toBeNull();
  });

  it('lets line 1 show everything while expanded', () => {
    expect(rule(".notification-entry[data-expanded='true'] .notification-entry__lead")).toMatch(/height:\s*auto/);
  });
});

describe('an ellipsis only where text is cut (FR-086)', () => {
  it('formats a place path whole: a long name is not cut and carries no ellipsis of its own', () => {
    const long = 'x'.repeat(SUBJECT_NAME_MAX + 30);
    const text = formatPlace({ project: 'Alpha', tab: 'Build', panel: long });
    expect(text).toBe(`Alpha › Build › ${long}`);
    expect(text).not.toContain('…');
  });

  it('shows an expanded entry\'s path whole', async () => {
    const long = 'y'.repeat(SUBJECT_NAME_MAX + 30);
    snapshot = snap([placed('a', { place: { project: 'Alpha', panel: long } })]);
    await mount();
    expect(screen.getByTestId('notification-place').textContent).toBe(`Alpha › ${long}`);
  });

  it('is CSS that cuts a line at rest, never characters', () => {
    expect(rule(".notification-entry:not([data-expanded='true']) .notification-entry__message")).toMatch(/text-overflow:\s*ellipsis/);
    expect(css).toContain(".notification-entry:not([data-expanded='true']) .notification-entry__place,");
  });
});

describe('a collapsed pane\'s strip and its show control share one hover (FR-082)', () => {
  const panes = read('packages/ui/src/renderer/theme.css');
  const app = read('packages/ui/src/renderer/app.tsx');

  it('has the hover on the pane itself, so the strip and the control are one target', () => {
    expect(app).toMatch(/useCollapsedHover\(!leftShown\)/);
    expect(app).toMatch(/useCollapsedHover\(!rightShown\)/);
    expect(app).toMatch(/\{\.\.\.leftHover\}/);
    expect(app).toMatch(/\{\.\.\.rightHover\}/);
  });

  it('paints the strip and the show control in the highlight and the control\'s icon in the paired text colour', () => {
    const at = panes.indexOf(".pane.collapsed-hover[data-hover-armed='true']:hover .pane-rail");
    expect(at).toBeGreaterThanOrEqual(0);
    const strip = panes.slice(at, panes.indexOf('}', at));
    expect(strip).toMatch(/background:\s*var\(--throng-colour-accent\)/);
    const ctl = panes.indexOf(".pane.collapsed-hover[data-hover-armed='true']:hover .pane-collapse");
    expect(ctl).toBeGreaterThanOrEqual(0);
    const control = panes.slice(ctl, panes.indexOf('}', ctl));
    expect(control).toMatch(/background:\s*var\(--throng-colour-accent\)/);
    expect(control).toMatch(/color:\s*var\(--throng-colour-accentText\)/);
    expect(control).toMatch(/border-color:\s*var\(--throng-colour-accentText\)/);
    expect(panes).toMatch(/\.pane\.collapsed-hover\[data-hover-armed='true'\]:hover \.pane-collapse :is\(\.icon[^)]*\)/);
  });

  it('is still armed only by a pointer that moves, so collapsing under a still pointer does not flash it', () => {
    expect(panes).not.toMatch(/\.pane\.collapsed-hover:hover/);
  });
});

describe('an entry stays expanded while its context menu is open (FR-087)', () => {
  it('keeps the entry expanded through pointer leave and blur until the menu closes, then follows FR-085 again', async () => {
    snapshot = snap([placed('a'), placed('b')]);
    await mount();
    const a = cards()[0]!;
    fireEvent.pointerMove(a, moved);
    fireEvent.contextMenu(a, { clientX: 10, clientY: 10 });
    expect(screen.getByRole('menu')).toBeTruthy();
    // The pointer travels into the menu, which sits outside the entry; focus may move with it.
    fireEvent.pointerLeave(a);
    fireEvent.blur(a);
    expect(a.getAttribute('data-expanded')).toBe('true');
    // A press outside the menu closes it without handing focus back. The menu starts listening for one a macrotask after
    // it opens, so the press that opened it cannot close it.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(a.getAttribute('data-expanded')).toBeNull();
  });

  it('does not expand another entry, and does not hold an entry whose menu was replaced', async () => {
    snapshot = snap([placed('a'), placed('b')]);
    await mount();
    const [a, b] = cards();
    fireEvent.contextMenu(a!, { clientX: 10, clientY: 10 });
    fireEvent.contextMenu(b!, { clientX: 10, clientY: 40 });
    fireEvent.pointerLeave(b!);
    expect(cards().map((c) => c.getAttribute('data-expanded'))).toEqual([null, 'true']);
  });
});

describe('expanding never changes the spacing (FR-088)', () => {
  it('gives every row of line 1 one fixed height and no row gap, so a one-row line 1 is the same height at rest and expanded', () => {
    const lead = rule('.notification-entry__lead');
    expect(lead).toMatch(/row-gap:\s*0/);
    expect(lead).toMatch(/align-content:\s*flex-start/);
    const part = rule('.notification-entry__lead > *');
    expect(part).toMatch(/height:\s*1\.6em/);
    expect(part).toMatch(/line-height:\s*1\.6em/);
  });

  it('changes nothing but wrapping and the lists when expanded: no spacing, size or line-height rule depends on the state', () => {
    const expandedRules = [...css.matchAll(/([^{}]*data-expanded='true'[^{}]*)\{([^}]*)\}/g)].map((m) => m[2]!);
    for (const body of expandedRules) {
      expect(body).not.toMatch(/\b(margin|padding|gap|line-height|font-size|border)[\w-]*\s*:/);
    }
  });
});

describe('the border is one weight in every state (FR-089)', () => {
  it('sets the width once, and no hover, focus, expanded or project rule changes it', () => {
    expect(rule('.notification-entry')).toMatch(/border:\s*2px solid/);
    const others = [...css.matchAll(/([^{}]*\.notification-entry[^{}]*)\{([^}]*)\}/g)].filter((m) => m[1]!.trim() !== '.notification-entry');
    for (const [, selector, body] of others) {
      expect(body, selector).not.toMatch(/border(-(top|right|bottom|left))?(-width)?\s*:\s*[^;]*\d+px/);
      expect(body, selector).not.toMatch(/\bborder\s*:/);
    }
  });

  it('draws the rest border in the project colour at full strength, and the highlight as that colour mixed toward the text', () => {
    expect(rule(".notification-entry[data-project='true']")).toMatch(/border-color:\s*var\(--entry-project\)\s*;/);
    const highlight = rule('.notification-entry--activatable:hover,\n.notification-entry--activatable:focus-visible');
    expect(highlight).toMatch(/border-color:\s*color-mix\(in srgb, var\(--entry-project, var\(--throng-colour-accent\)\) \d+%, var\(--throng-colour-text\)\)/);
  });
});
