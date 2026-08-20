import { render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, DEFAULT_KEYBINDINGS, THRONG_THEME } from '@throng/core';
import {
  ConfigProvider,
  useAppSettings,
  useKeybindings,
} from '../../src/renderer/config/config-store.js';
import { writeConfig } from '../../src/renderer/config/write-config.js';

/**
 * Issue #50, the CONSUMER half — migrated from `preferences-rapid-edit.e2e.ts` (035 T062).
 *
 * ══ WHY THIS FILE EXISTS, WHICH IS THE WHOLE POINT ══
 *
 * The #50 fix has two halves. `write-config.ts` ANNOUNCES a document the moment it is successfully
 * written, and `config-store.tsx` ADOPTS what it is told, so a second edit is computed from the
 * first rather than from a copy that has not yet round-tripped through the watcher.
 *
 * The announcing half was thoroughly covered — `unit/write-config-ordering.test.ts` has a test named
 * *"publishes a successful write so the next edit can build on it"*. **The adopting half was covered
 * by nothing below E2E**, and that was measured rather than assumed: deleting the store's use of the
 * announcement (`if (id !== undefined) return;` at the top of its `onConfigWritten` listener) left
 * all 37 tests across the two ordering files and the settings-search component file GREEN.
 *
 * So a regression at the consumer end reverted the user's edit exactly as #50 did, and the only
 * thing in the repository that would have noticed was an E2E launching Electron and a real
 * preferences window. That is precisely the shape 035 exists to remove — and the shape that made
 * deleting the E2E on the strength of "the mechanism is tested" the wrong call.
 *
 * ══ WHAT IT ASSERTS, AND WHY NO WATCHER APPEARS IN IT ══
 *
 * The bridge below has an `onChange` and **never calls it**. That absence is the test: adoption is
 * only load-bearing in the window before the watcher speaks, so a fixture that pushes the change
 * back would pass whether the store adopted anything or not.
 */

/** What the store's `get` resolves with, and what a write is applied on top of. */
function bridge(): { writes: string[] } {
  const writes: string[] = [];
  Reflect.set(window, 'throng', {
    config: {
      get: () =>
        Promise.resolve({
          settings: DEFAULT_APP_SETTINGS,
          theme: THRONG_THEME,
          keybindings: DEFAULT_KEYBINDINGS,
        }),
      // Registered, and DELIBERATELY never fired — see the header.
      onChange: () => () => undefined,
      write: (_id: unknown, json: string) => {
        writes.push(json);
        return Promise.resolve({ ok: true });
      },
      writePatch: () => Promise.resolve({ ok: true }),
      listThemes: () => Promise.resolve(['throng']),
      listFonts: () => Promise.resolve([]),
      listIconPacks: () => Promise.resolve([]),
    },
  });
  return { writes };
}

/** Renders the two values under test as text, so a stale copy is visible rather than inferred. */
function Probe(): ReactElement {
  const settings = useAppSettings();
  const keybindings = useKeybindings();
  return createElement(
    'div',
    null,
    createElement('span', { 'data-testid': 'autosave' }, String(settings.editor.autoSave)),
    createElement(
      'span',
      { 'data-testid': 'tabsize' },
      String(settings.editor.indentSize ?? '(absent)'),
    ),
    createElement(
      'span',
      { 'data-testid': 'zoomin' },
      String((keybindings.bindings['zoom.in'] ?? []).length),
    ),
  );
}

function mount(): { writes: string[] } {
  const { writes } = bridge();
  render(createElement(ConfigProvider, null, createElement(Probe)));
  return { writes };
}

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

describe('a written settings document is adopted before the watcher says anything', () => {
  it('shows the written value with NO onChange broadcast at all', async () => {
    mount();
    await waitFor(() => expect(screen.getByTestId('autosave')).toHaveTextContent('false'));

    await writeConfig(
      { kind: 'settings' },
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS,
        editor: { ...DEFAULT_APP_SETTINGS.editor, autoSave: true },
      }),
    );

    await waitFor(() => expect(screen.getByTestId('autosave')).toHaveTextContent('true'));
  });

  it('so a SECOND edit composes from the first, which is the #50 defect itself', async () => {
    /*
     * The defect in one test. Two edits to different keys, back-to-back, with nothing round-tripping
     * between them. Without adoption the second write is computed from the pre-first copy and
     * carries `autoSave: false` — the user's first change, silently reverted, with nothing on screen
     * to say so.
     *
     * Asserted on the WRITTEN DOCUMENT rather than on the rendered value, because that is where the
     * loss actually happens: the second write is what reaches the file, and it is what the store
     * would then adopt.
     */
    const { writes } = mount();
    await waitFor(() => expect(screen.getByTestId('autosave')).toHaveTextContent('false'));

    const first = {
      ...DEFAULT_APP_SETTINGS,
      editor: { ...DEFAULT_APP_SETTINGS.editor, autoSave: true },
    };
    await writeConfig({ kind: 'settings' }, JSON.stringify(first));
    await waitFor(() => expect(screen.getByTestId('autosave')).toHaveTextContent('true'));

    // The second edit is composed from what the STORE now holds — exactly as a preferences control
    // composes it — so a stale store produces a stale document here.
    const live = JSON.parse(writes[writes.length - 1]) as typeof DEFAULT_APP_SETTINGS;
    await writeConfig(
      { kind: 'settings' },
      JSON.stringify({ ...live, editor: { ...live.editor, indentSize: 7 } }),
    );

    const second = JSON.parse(writes[writes.length - 1]) as typeof DEFAULT_APP_SETTINGS;
    expect(second.editor.indentSize).toBe(7);
    // The half that #50 loses.
    expect(second.editor.autoSave).toBe(true);
  });

  it('adopts a keybindings document too — the other editor the E2E drove', async () => {
    mount();
    const before = (DEFAULT_KEYBINDINGS.bindings['zoom.in'] ?? []).length;
    await waitFor(() =>
      expect(screen.getByTestId('zoomin')).toHaveTextContent(String(before)),
    );

    await writeConfig(
      { kind: 'keybindings' },
      JSON.stringify({
        ...DEFAULT_KEYBINDINGS,
        bindings: {
          ...DEFAULT_KEYBINDINGS.bindings,
          'zoom.in': (DEFAULT_KEYBINDINGS.bindings['zoom.in'] ?? []).slice(1),
        },
      }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('zoomin')).toHaveTextContent(String(before - 1)),
    );
  });

  it('adopts NOTHING from a write that failed — a document that never landed is not the truth', async () => {
    /*
     * The anti-vacuity control, and a real failure mode rather than a formality: adopting on
     * announcement alone would make the UI show a value the file does not contain, and the watcher
     * would later contradict it. `write-config.ts` announces only on success; this asserts the
     * store's behaviour if it ever announced otherwise.
     */
    const writes: string[] = [];
    Reflect.set(window, 'throng', {
      config: {
        get: () =>
          Promise.resolve({
            settings: DEFAULT_APP_SETTINGS,
            theme: THRONG_THEME,
            keybindings: DEFAULT_KEYBINDINGS,
          }),
        onChange: () => () => undefined,
        write: (_id: unknown, json: string) => {
          writes.push(json);
          return Promise.resolve({ ok: false, error: 'the disk said no' });
        },
        writePatch: () => Promise.resolve({ ok: true }),
        listThemes: () => Promise.resolve(['throng']),
        listFonts: () => Promise.resolve([]),
        listIconPacks: () => Promise.resolve([]),
      },
    });
    render(createElement(ConfigProvider, null, createElement(Probe)));
    await waitFor(() => expect(screen.getByTestId('autosave')).toHaveTextContent('false'));

    await writeConfig(
      { kind: 'settings' },
      JSON.stringify({
        ...DEFAULT_APP_SETTINGS,
        editor: { ...DEFAULT_APP_SETTINGS.editor, autoSave: true },
      }),
    );

    expect(writes).toHaveLength(1);
    expect(screen.getByTestId('autosave')).toHaveTextContent('false');
  });
});
