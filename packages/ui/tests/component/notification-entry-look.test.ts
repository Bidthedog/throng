/**
 * 068 T103–T105 (FR-071 to FR-075) — what a Notifications panel entry looks like: a pastel tint for its type, a border in
 * its project's colour that turns to the project's highlight while a link entry is hovered or focused, its type's icon at
 * the top left, and the full `Project › Tab › Panel` path in a popover.
 *
 * Layer: component. jsdom paints no colour, so the colours are asserted as the stylesheet rules and the custom property the
 * component sets (the look itself is MT-05); the icon, the project resolution and the popover are real DOM.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ENTRY_BASE_SURFACE_TOKEN,
  ENTRY_SEVERITIES,
  ENTRY_TINT_PERCENT,
  ENTRY_TYPE_COLOUR_TOKEN,
  ENTRY_TYPE_ICON_TOKEN,
  ENTRY_TYPE_LABEL,
  THRONG_THEME,
  type NotificationEntry,
} from '@throng/core';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { NotificationsPanel } from '../../src/renderer/notifications/notifications-panel.js';
import type { NotificationsSnapshot } from '../../src/renderer/global.js';
import { flushUntil } from './helpers/flush-until.js';

const projectsHolder: { projects: { id: string; colour: string; name: string }[] } = { projects: [] };
vi.mock('../../src/renderer/state/projects-store.js', () => ({ useProjectsOptional: () => ({ projects: projectsHolder.projects }) }));

let snapshot: NotificationsSnapshot;
let changed: ((s: NotificationsSnapshot) => void)[] = [];

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

beforeEach(() => {
  projectsHolder.projects = [{ id: 'pr1', colour: '#ff8800', name: 'Alpha' }];
  changed = [];
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
      onChanged: (cb: (s: NotificationsSnapshot) => void) => {
        changed.push(cb);
        return () => {};
      },
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
            createElement(NotificationsPanel, {
              minimised: false,
              onToggleMinimise: () => {},
              targetExists: () => true,
              runAction: () => {},
            }),
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

const css = readFileSync(resolve(process.cwd(), 'packages/ui/src/renderer/notifications/notifications.css'), 'utf8');
const rule = (selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} must have a rule`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('the type icon, top left, before the title (FR-074)', () => {
  it.each(ENTRY_SEVERITIES)('a %s entry draws its own type icon first, before its title', async (severity) => {
    snapshot = snap([entry('a', { severity })]);
    await mount();
    const card = screen.getByTestId('notification-entry');
    const icon = card.querySelector('.notification-entry__icon')!;
    expect(icon).not.toBeNull();
    // Line 1's first part (FR-083, over FR-074's placement before the title).
    expect(card.querySelector('.notification-entry__line1')!.querySelector('.notification-entry__lead')!.firstElementChild).toBe(icon);
    expect(icon.getAttribute('title')).toBe(ENTRY_TYPE_LABEL[severity]);
    expect(icon.textContent).toBe(THRONG_THEME.icons[ENTRY_TYPE_ICON_TOKEN[severity]]);
    const title = card.querySelector('.notification-entry__title')!;
    expect(icon.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('gives the five types five different icons', async () => {
    snapshot = snap(ENTRY_SEVERITIES.map((s, i) => entry(`e${i}`, { severity: s })));
    await mount();
    const glyphs = screen.getAllByTestId('notification-entry').map((c) => c.querySelector('.notification-entry__icon')!.textContent);
    expect(new Set(glyphs).size).toBe(5);
  });
});

describe('the background is a pastel tint of the type (FR-071)', () => {
  it.each(ENTRY_SEVERITIES)('%s: a small share of the type colour mixed into the surface', (severity) => {
    const body = rule(`.notification-entry--${severity}`);
    const token = ENTRY_TYPE_COLOUR_TOKEN[severity];
    expect(body).toContain(`color-mix(in srgb, var(--throng-colour-${token}) ${ENTRY_TINT_PERCENT}%, var(--throng-colour-${ENTRY_BASE_SURFACE_TOKEN}))`);
  });

  it('retires the coloured type strip: no per-type left edge, no error text colour override', () => {
    expect(css).not.toMatch(/\.notification-entry--\w+\s*\{[^}]*border-left-color/);
    expect(rule('.notification-entry')).not.toMatch(/border-left:\s*3px/);
    expect(rule('.notification-entry--error')).not.toMatch(/errorText|errorSurface/);
  });
});

describe('the border is the project\'s colour (FR-072)', () => {
  it('names the project\'s colour on an entry whose origin project is loaded', async () => {
    snapshot = snap([entry('a', { origin: { panelId: 'p1', projectId: 'pr1' } })]);
    await mount();
    const card = screen.getByTestId('notification-entry');
    expect(card.getAttribute('data-project')).toBe('true');
    expect(card.style.getPropertyValue('--entry-project')).toBe('#ff8800');
  });

  it('keeps the ordinary border for an entry about no project, and for one whose project is no longer loaded', async () => {
    snapshot = snap([entry('a'), entry('b', { origin: { panelId: 'p1', projectId: 'gone' } })]);
    await mount();
    for (const card of screen.getAllByTestId('notification-entry')) {
      expect(card.getAttribute('data-project')).toBeNull();
      expect(card.style.getPropertyValue('--entry-project')).toBe('');
    }
  });

  it('follows a recoloured project live', async () => {
    snapshot = snap([entry('a', { origin: { panelId: 'p1', projectId: 'pr1' } })]);
    await mount();
    projectsHolder.projects = [{ id: 'pr1', colour: '#3366ff', name: 'Alpha' }];
    act(() => changed.forEach((cb) => cb(snap([entry('a', { origin: { panelId: 'p1', projectId: 'pr1' } })]))));
    await waitFor(() => expect(screen.getByTestId('notification-entry').style.getPropertyValue('--entry-project')).toBe('#3366ff'));
  });

  it('is the project colour in the stylesheet, falling back to the theme border', () => {
    expect(rule(".notification-entry[data-project='true']")).toMatch(/border-color:[^;]*var\(--entry-project\)/);
  });
});

describe('a link entry\'s border takes the project\'s highlight on hover and focus (FR-073)', () => {
  it('only a link entry is marked as one; a plain entry is not', async () => {
    snapshot = snap([entry('a', { origin: { panelId: 'p1', projectId: 'pr1' } }), entry('b')]);
    await mount();
    const [link, plain] = screen.getAllByTestId('notification-entry');
    expect(link!.className).toContain('notification-entry--activatable');
    expect(plain!.className).not.toContain('notification-entry--activatable');
  });

  it('the stylesheet changes the border on hover and keyboard focus of a link entry, and of nothing else', () => {
    expect(css).toContain('.notification-entry--activatable:hover,');
    const hover = rule('.notification-entry--activatable:focus-visible');
    // FR-089 supersedes FR-073's full-strength highlight: the project colour mixed toward the text, at the same weight.
    expect(hover).toMatch(/border-color:\s*color-mix\(in srgb, var\(--entry-project,\s*var\(--throng-colour-accent\)\) \d+%, var\(--throng-colour-text\)\)/);
    expect(css).not.toMatch(/\.notification-entry:hover\s*\{/);
    expect(css).not.toMatch(/\.notification-entry:focus-visible\s*\{[^}]*border-color/);
  });
});

// FR-075's popover in the panel is replaced by the in-place expansion (FR-085): see notification-entry-layout.test.ts.
