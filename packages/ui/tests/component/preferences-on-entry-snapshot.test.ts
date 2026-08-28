import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyConfigPatch, DEFAULT_APP_SETTINGS, DEFAULT_KEYBINDINGS, THRONG_THEME } from '@throng/core';
import { PreferencesApp } from '../../src/renderer/preferences/preferences-app.js';

/**
 * `preferences-reset.e2e.ts:217` — "reset-all reverts the session to on-entry" (#341).
 *
 * ══ THE DEFECT ══
 *
 * The window's on-entry snapshot is captured on the render where `useConfigLoaded()` FIRST reports
 * true, and `loaded` is set by whichever payload arrives first — `config.get()` at mount, or a
 * watcher broadcast. Neither is ordered against the user, and the window is interactive before
 * either arrives: the settings tab renders from the shipped defaults immediately.
 *
 * So a user who opens Preferences and changes something before the config has loaded gets a
 * snapshot taken AFTER their edit. "Revert every editor to its state when this window opened" then
 * reverts to the edited state, which is to say it does nothing, for ever — and `planRevertAll`
 * emits a change for every revertable leaf rather than diffing, so it is not that the write is
 * skipped; it is that the value written is the one the user was trying to get rid of.
 *
 * That is the E2E's exact symptom: a poll for `false` that returns `true` for its whole 30s budget,
 * in a test that otherwise finishes in a second. The adoption path (`onConfigWritten`) never sets
 * `loaded`, which is what lets the edit land first while the window still believes it has not
 * opened yet.
 *
 * ══ WHY THIS LAYER ══
 *
 * `PreferencesApp` mounts its own providers and needs only `window.throng.config`, so the ordering
 * that is a race in the E2E is a decision here: the bridge below simply does not resolve `get()`
 * until the test says so.
 */
vi.mock('../../src/renderer/editor/standalone-editor.js', async () => {
  const { createElement: h } = await import('react');
  return {
    StandaloneEditor: ({
      value,
      onChange,
      testId,
    }: {
      value: string;
      onChange: (v: string) => void;
      testId?: string;
    }) =>
      h('textarea', {
        'data-testid': testId ?? 'json-editor',
        value,
        onChange: (e: { target: { value: string } }) => onChange(e.target.value),
      }),
  };
});

const CFG = { appearance: { theme: 'throng' } };

afterEach(() => {
  Reflect.deleteProperty(window, 'throng');
});

/** The preferences window over a bridge whose `get()` resolves only when the test releases it. */
function mountWithDeferredLoad(editorOverrides: Record<string, unknown> = {}) {
  const patched: Array<{ id: unknown; changes: unknown }> = [];
  let settings: unknown = {
    ...DEFAULT_APP_SETTINGS,
    ...CFG,
    editor: { ...DEFAULT_APP_SETTINGS.editor, ...editorOverrides },
  };
  const theme = structuredClone(THRONG_THEME);
  let push: ((payload: unknown) => void) | null = null;

  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });

  Reflect.set(window, 'throng', {
    config: {
      // Resolves with whatever the document says AT THE MOMENT IT IS RELEASED — which is what a
      // real read does when it happens to run after the user's first edit has landed.
      get: () => gate.then(() => ({ settings, theme, keybindings: DEFAULT_KEYBINDINGS })),
      onChange: (cb: (payload: unknown) => void) => {
        push = cb;
        return () => {
          push = null;
        };
      },
      write: (id: unknown, json: string) => {
        try {
          // DOCUMENT-ADDRESSED. Revert All writes keybindings and each captured theme through this
          // same call, so parsing every one of them into `settings` would replace the settings
          // document with a Keybindings and make every row read `undefined`.
          const kind = (id as { kind?: string } | undefined)?.kind;
          if (kind === undefined || kind === 'settings') settings = JSON.parse(json);
          push?.({ settings, theme, keybindings: DEFAULT_KEYBINDINGS });
        } catch {
          /* an invalid document should never reach the write path */
        }
        return Promise.resolve({ ok: true });
      },
      writePatch: (id: unknown, changes: unknown) => {
        patched.push({ id, changes });
        const applied = applyConfigPatch(settings as never, changes as never);
        if (applied.ok) {
          settings = applied.value;
          push?.({ settings, theme, keybindings: DEFAULT_KEYBINDINGS });
        }
        return Promise.resolve({ ok: true });
      },
      listThemes: () => Promise.resolve(['throng']),
      listFonts: () => Promise.resolve([]),
      listIconPacks: () => Promise.resolve([]),
    },
  });

  render(createElement(PreferencesApp, { initialTab: 'settings' as const }));
  return {
    patched,
    releaseLoad: release,
    autoSave: () => (settings as { editor: { autoSave: boolean } }).editor.autoSave,
  };
}

describe('the on-entry snapshot when the config loads late (#341, preferences-reset.e2e.ts:217)', () => {
  it('accepts no edit until the configuration has loaded', async () => {
    /*
     * The gate itself. Before this, the tab rendered from the shipped defaults while `config.get()`
     * was still in flight, so the window was interactive while it was still wrong — and an edit
     * made there is unrecoverable, because the window never saw the state it would have to revert
     * to. The toolbar stays mounted; it is the EDITORS that wait.
     */
    mountWithDeferredLoad();
    expect(screen.queryByTestId('settings-tab')).toBeNull();
    expect(screen.queryByTestId('control-editor.autoSave')).toBeNull();
  });

  it('reverts to the value the window opened with, not to one edited after it', async () => {
    const user = userEvent.setup();
    // The user's REAL saved setting — the thing "revert to how this window opened" owes back.
    const { patched, releaseLoad, autoSave } = mountWithDeferredLoad({ autoSave: true });

    releaseLoad();
    await waitFor(() => expect(screen.getByTestId('settings-tab')).toBeInTheDocument());
    expect(autoSave()).toBe(true);

    // Now edit it, the way the E2E does.
    await user.click(screen.getByTestId('control-editor.autoSave'));
    await waitFor(() => expect(autoSave()).toBe(false));

    // "Revert every editor to its state when this window opened."
    await user.click(screen.getByTestId('prefs-revert-all'));
    await user.click(screen.getByTestId('prefs-reset-confirm-yes'));

    await waitFor(() => expect(patched.length).toBeGreaterThan(0));
    await waitFor(() => expect(autoSave()).toBe(true));
  });
});
