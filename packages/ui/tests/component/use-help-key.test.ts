/**
 * 080 FR-010 (US2 AC3) — F1 opens the guide from the windows that do not mount the window dispatcher
 * (preferences, Resource Monitor, About), through `useHelpKey`.
 *
 * Layer: component — the REAL `ConfigProvider` (so the chord is the user's live binding) around a probe
 * that mounts the hook; the opener's only door is `window.throng.openHelp` (080 FR-048).
 */
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HELP_APP_BASE_URL, DEFAULT_KEYBINDINGS, startPageUrl } from '@throng/core';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { useHelpKey } from '../../src/renderer/help/use-help-key.js';

const openHelp = vi.fn();
let keybindings: unknown;

function Probe(): null {
  useHelpKey();
  return null;
}
function Loaded(): null {
  const loaded = useConfigLoaded();
  if (loaded) document.body.dataset.loaded = 'yes';
  return null;
}

beforeEach(() => {
  openHelp.mockClear();
  keybindings = undefined;
  delete document.body.dataset.loaded;
  Reflect.set(window, 'throng', {
    openHelp,
    config: {
      get: () => Promise.resolve({ settings: { version: 1 }, keybindings }),
      onChange: () => () => undefined,
    },
  });
});

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, 'throng');
});

async function mount(): Promise<void> {
  render(createElement(ConfigProvider, null, createElement(Probe), createElement(Loaded)));
  await waitFor(() => expect(document.body.dataset.loaded).toBe('yes'));
}

/** False when the key was consumed (default prevented). */
const press = (init: KeyboardEventInit): boolean => fireEvent.keyDown(document.body, init);

describe('useHelpKey (FR-010)', () => {
  it('opens the start page once when the live help.open chord (F1) is pressed', async () => {
    await mount();
    expect(press({ key: 'F1', code: 'F1' })).toBe(false);
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(startPageUrl(HELP_APP_BASE_URL));
  });

  it('honours a rebound chord, and F1 no longer does it', async () => {
    keybindings = { version: 1, bindings: { ...DEFAULT_KEYBINDINGS.bindings, 'help.open': ['Ctrl+Alt+H'] } };
    await mount();
    press({ key: 'F1', code: 'F1' });
    expect(openHelp).not.toHaveBeenCalled();
    press({ key: 'h', code: 'KeyH', ctrlKey: true, altKey: true });
    expect(openHelp).toHaveBeenCalledExactlyOnceWith(startPageUrl(HELP_APP_BASE_URL));
  });

  it('leaves F1 alone while the chord-capture box (a capture-phase consumer) has the keyboard', async () => {
    await mount();
    const capture = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', capture, true);
    try {
      press({ key: 'F1', code: 'F1' });
    } finally {
      window.removeEventListener('keydown', capture, true);
    }
    expect(openHelp).not.toHaveBeenCalled();
  });

  it('does nothing for a key the binding does not match, and leaves it unconsumed', async () => {
    await mount();
    expect(press({ key: 'F2', code: 'F2' })).toBe(true);
    expect(press({ key: 'a', code: 'KeyA' })).toBe(true);
    expect(openHelp).not.toHaveBeenCalled();
  });
});
