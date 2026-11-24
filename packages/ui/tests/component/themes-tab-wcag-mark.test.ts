/**
 * 078 US3 — the Themes tab marks the selected theme when it meets WCAG AA (FR-007–FR-012; contract themes-tab-mark.md).
 *
 * Layer: component — every claim is about the rendered document (option text, an element and its title), driven
 * through the real `ConfigProvider` over a stubbed bridge; no layout or second window is involved.
 *
 * ══ ANTI-VACUITY CONTROL ══
 *
 * Every "absent" assertion below is paired with a "present" one in the same render, so a tab that rendered nothing
 * fails the present half. Make the tab's `activeConforms` false for every theme and (b), (c), (e) and (f) fail.
 */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  ALL_DEFAULT_THEMES,
  DEFAULT_APP_SETTINGS,
  buildShippedDefaults,
  completeTheme,
  type Theme,
} from '@throng/core';
import { ThemesTab } from '../../src/renderer/preferences/themes-tab.js';
import { ConfigProvider } from '../../src/renderer/config/config-store.js';
import { ConfirmProvider } from '../../src/renderer/confirm-dialog.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';

const SHIPPED = buildShippedDefaults();
const MARK = 'theme-wcag-mark';

type Payload = { settings: unknown; theme: unknown };

/** The bridge: a theme library on "disk", the active theme name, and a way to push a watcher broadcast. */
interface Harness {
  push: (payload: Payload) => void;
  payloadFor: (active: string, theme?: Theme) => Payload;
}

function settingsWith(active: string): unknown {
  return { ...DEFAULT_APP_SETTINGS, appearance: { ...DEFAULT_APP_SETTINGS.appearance, theme: active } };
}

function mount(files: Record<string, string>, active: string): Harness {
  let listener: ((p: Payload) => void) | undefined;
  const payloadFor = (name: string, theme?: Theme): Payload => ({
    settings: settingsWith(name),
    theme: theme ?? completeTheme(name, JSON.parse(files[name]!) as Theme, SHIPPED),
  });
  Reflect.set(window, 'throng', {
    config: {
      get: () => Promise.resolve(payloadFor(active)),
      onChange: (cb: (p: Payload) => void) => {
        listener = cb;
        return () => undefined;
      },
      listThemes: () => Promise.resolve(Object.keys(files)),
      listFonts: () => Promise.resolve([]),
      readRaw: (id: { kind: string; name?: string }) => {
        const text = id.name === undefined ? undefined : files[id.name];
        return text === undefined ? Promise.reject(new Error('ENOENT')) : Promise.resolve(text);
      },
      write: () => Promise.resolve({ ok: true }),
      writePatch: () => Promise.resolve({ ok: true }),
    },
  });
  render(
    createElement(
      NotificationProvider,
      null,
      createElement(ConfigProvider, null, createElement(ConfirmProvider, null, createElement(ThemesTab))),
    ),
  );
  return { payloadFor, push: (payload) => act(() => listener?.(payload)) };
}

const json = (theme: Theme): string => JSON.stringify(theme);
const optionTexts = (): string[] =>
  Array.from(screen.getByTestId('theme-select').querySelectorAll('option'), (o) => o.textContent ?? '');

/** A theme that fails one measured pairing: muted text drawn in the app background's own colour. */
function failing(base: Theme, name: string): Theme {
  return { ...structuredClone(base), name, colours: { ...base.colours, textMuted: base.colours.appBg } };
}

beforeEach(() => {
  window.history.replaceState(null, '', '/?foldDefault=open');
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

describe('Themes tab WCAG AA mark (078 US3)', () => {
  it('(a) lists every theme by its bare name, conforming or not (FR-008)', async () => {
    const files = { throng: json(ALL_DEFAULT_THEMES.throng), Dim: json(failing(ALL_DEFAULT_THEMES.throng, 'Dim')) };
    mount(files, 'throng');
    await screen.findByTestId(MARK);
    await waitFor(() => expect(optionTexts()).toEqual(['throng', 'Dim']));
  });

  it('(b) shows the mark, titled, for a conforming selected theme — and nothing for one that is not', async () => {
    const files = { throng: json(ALL_DEFAULT_THEMES.throng), Dim: json(failing(ALL_DEFAULT_THEMES.throng, 'Dim')) };
    const h = mount(files, 'throng');
    const mark = await screen.findByTestId(MARK);
    expect(mark.getAttribute('title')).toBe('Meets WCAG AA contrast');
    expect(mark.querySelector('svg')).not.toBeNull();
    expect(mark.closest('button')).toBeNull();

    h.push(h.payloadFor('Dim'));
    await waitFor(() => expect(screen.queryByTestId(MARK)).toBeNull());
    // Nothing in the mark's place: the picker is the last thing in its field, and no sibling speaks of contrast.
    const select = screen.getByTestId('theme-select');
    expect(select.nextElementSibling).toBeNull();
    const siblings = Array.from(select.parentElement?.children ?? []).filter((el) => el !== select);
    expect(siblings.map((el) => el.textContent ?? '').join(' ')).not.toMatch(/WCAG|contrast/i);
  });

  it('(c) judges a user theme missing tokens by the colours the app would paint it with', async () => {
    const partial = structuredClone(ALL_DEFAULT_THEMES.throng) as Theme;
    partial.name = 'Partial';
    delete (partial.colours as Record<string, string>).accentText; // filled from throng, which passes
    mount({ Partial: json(partial) }, 'Partial');
    await screen.findByTestId(MARK);
  });

  it('(e) follows an edit to the active theme across the threshold, both ways, without remounting', async () => {
    const h = mount({ throng: json(ALL_DEFAULT_THEMES.throng) }, 'throng');
    await screen.findByTestId(MARK);
    const select = screen.getByTestId('theme-select');

    h.push(h.payloadFor('throng', failing(ALL_DEFAULT_THEMES.throng, 'throng')));
    await waitFor(() => expect(screen.queryByTestId(MARK)).toBeNull());

    h.push(h.payloadFor('throng', ALL_DEFAULT_THEMES.throng));
    await screen.findByTestId(MARK);
    expect(screen.getByTestId('theme-select')).toBe(select);
  });

  it('(f) marks each of the fifteen bundled themes when selected, Matrix, VI-VIM and Gothic included (078 SC-004)', async () => {
    const files = Object.fromEntries(Object.values(ALL_DEFAULT_THEMES).map((t) => [t.name, json(t)]));
    expect(Object.keys(files)).toHaveLength(15);
    const h = mount(files, 'throng');
    for (const name of Object.keys(files)) {
      h.push(h.payloadFor(name));
      await waitFor(() => expect(screen.getByTestId('theme-select')).toHaveProperty('value', name));
      expect(screen.queryByTestId(MARK), name).not.toBeNull();
    }
  });
});
