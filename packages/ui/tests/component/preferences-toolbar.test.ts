/**
 * The preferences toolbar — which controls exist, what they are called, and what they are made of.
 *
 * MIGRATED FROM `packages/ui/tests/e2e/preferences-reset.e2e.ts` (034 FR-045).
 *
 * Two tests there each launched Electron, seeded a config root on disk and opened the preferences
 * window, in order to read four `title` attributes and count `<svg>` elements. Nothing they asserted
 * depended on a process, a window, a file, or a write — only on what the toolbar renders for a given
 * tab and mode. The blocker was that the markup lived inside `PreferencesShell`, which cannot mount
 * outside Electron; `preferences-toolbar.tsx` was extracted first, verified against the unchanged
 * E2E specs, and only then were these written.
 *
 * It mounts with NO provider. `ConfigContext`'s default state carries the shipped throng theme, so
 * `Icon` resolves a real glyph from the real theme — which is what makes "each renders a themed
 * glyph" a true statement here rather than an assertion about a stub.
 *
 * WHAT STAYS END-TO-END: every test in `preferences-reset.e2e.ts` that presses one of these buttons
 * and then reads the config off disk. That a click reaches a confirm dialog, an IPC call, an atomic
 * write and a reload is the behaviour those tests are for, and none of it is visible from here.
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  PreferencesToolbar,
  type PreferencesTab,
} from '../../src/renderer/preferences/preferences-toolbar.js';

function mount(overrides: Partial<Parameters<typeof PreferencesToolbar>[0]> = {}) {
  const handlers = {
    onSelectTab: vi.fn(),
    onToggleMode: vi.fn(),
    onResetCurrent: vi.fn(),
    onResetPreferences: vi.fn(),
    onRevertAll: vi.fn(),
  };
  render(
    createElement(PreferencesToolbar, {
      tab: 'settings' as PreferencesTab,
      mode: 'ui' as const,
      ...handlers,
      ...overrides,
    }),
  );
  return { ...handlers, user: userEvent.setup() };
}

describe('the per-tab reset (015, FR-011)', () => {
  it('is HIDDEN on the Themes tab', () => {
    // It used to be shown-but-disabled for a custom theme. Feature 014 gives every built-in theme
    // row its own restore-to-shipped affordance, so a per-tab reset here would be a second control
    // performing an identical write — removed rather than disabled.
    mount({ tab: 'themes' });
    expect(screen.queryByTestId('prefs-reset-current')).toBeNull();
  });

  it.each([
    ['settings', 'Settings'],
    ['keybindings', 'Key Bindings'],
  ] as const)('on the %s tab it is present and names that editor', (tab, label) => {
    mount({ tab });
    const button = screen.getByTestId('prefs-reset-current');
    expect(button).toBeVisible();
    expect(button).toHaveAttribute('title', `Reset the ${label} editor to its defaults`);
  });

  it('still offers the two global controls on Themes, where only the per-tab one is withdrawn', () => {
    // The absence above must be ONE control's absence. A toolbar that lost its whole right-hand side
    // on Themes would satisfy the first test and be a different, worse bug.
    mount({ tab: 'themes' });
    expect(screen.getByTestId('prefs-reset-preferences')).toBeVisible();
    expect(screen.getByTestId('prefs-revert-all')).toBeVisible();
    expect(screen.getByTestId('prefs-mode-toggle')).toBeVisible();
  });
});

describe('every toolbar control is a themed icon with a truthful title (015, FR-009b/FR-012a)', () => {
  const CONTROLS = ['prefs-reset-current', 'prefs-reset-preferences', 'prefs-revert-all', 'prefs-mode-toggle'];

  it('names the true scope of each control', () => {
    // "Revert All" was a session undo calling itself a reset-all, and the id `prefs-reset-all` named
    // a scope it did not have.
    mount();
    expect(screen.getByTestId('prefs-reset-current')).toHaveAttribute(
      'title',
      'Reset the Settings editor to its defaults',
    );
    expect(screen.getByTestId('prefs-reset-preferences')).toHaveAttribute('title', 'Reset All Preferences');
    expect(screen.getByTestId('prefs-revert-all')).toHaveAttribute('title', 'Revert All Preferences');
  });

  it('has not brought back the misleading identifier', () => {
    // `prefs-reset-all` used to belong to the SESSION UNDO.
    mount();
    expect(screen.queryByTestId('prefs-reset-all')).toBeNull();
  });

  it('renders no inline <svg> anywhere in the toolbar', () => {
    // Constitution v3.12.0 — these were recorded as known violations at that amendment. Icons come
    // from theme tokens now.
    mount();
    for (const id of CONTROLS) {
      expect(screen.getByTestId(id).querySelector('svg'), `${id} draws an inline <svg>`).toBeNull();
    }
  });

  it('draws a themed glyph inside each one, and names the action only once', () => {
    mount();
    for (const id of CONTROLS) {
      const button = screen.getByTestId(id);
      expect(button.textContent?.trim().length, `${id} rendered no glyph`).toBeGreaterThan(0);
      // The glyph is decorative: the accessible name is the button's, and a screen reader that also
      // announced the character would read the raw glyph aloud.
      expect(button.querySelector('.icon')).toHaveAttribute('aria-hidden', 'true');
      expect(button).toHaveAttribute('aria-label', button.getAttribute('title') as string);
    }
  });
});

describe('the mode toggle (FR-020)', () => {
  it('offers JSON editing while the visual editor is showing', () => {
    mount({ mode: 'ui' });
    expect(screen.getByTestId('prefs-mode-toggle')).toHaveAttribute('title', 'Switch to JSON editing');
  });

  it('names the visual editor as the destination once JSON is showing', () => {
    mount({ mode: 'json' });
    expect(screen.getByTestId('prefs-mode-toggle')).toHaveAttribute(
      'title',
      'Switch to the visual editor',
    );
  });
});

describe('what each control asks the shell to do', () => {
  it('routes every click to its own callback, and to no other', async () => {
    // The extraction's real risk: four buttons wired to five callbacks by hand. A crossed pair would
    // reset all preferences when the user asked to revert the session, which no title would reveal.
    const h = mount();
    for (const [id, fn] of [
      ['prefs-mode-toggle', h.onToggleMode],
      ['prefs-reset-current', h.onResetCurrent],
      ['prefs-reset-preferences', h.onResetPreferences],
      ['prefs-revert-all', h.onRevertAll],
    ] as const) {
      await h.user.click(screen.getByTestId(id));
      expect(fn, `${id} did not call its own handler`).toHaveBeenCalledTimes(1);
    }
    expect(h.onSelectTab).not.toHaveBeenCalled();
  });

  it('asks for the tab that was clicked, rather than switching to it itself', async () => {
    // The shell refuses the switch while the JSON buffer is invalid (FR-018), so the decision is
    // not this component's to make — it reports the request and renders whatever `tab` comes back.
    const h = mount({ tab: 'settings' });
    await h.user.click(screen.getByTestId('prefs-tab-themes'));
    expect(h.onSelectTab).toHaveBeenCalledWith('themes');
    // Still on Settings: the caller has not said yes.
    expect(screen.getByTestId('prefs-tab-settings')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('prefs-reset-current')).toBeVisible();
  });
});
