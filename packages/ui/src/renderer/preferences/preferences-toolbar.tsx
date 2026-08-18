/**
 * The preferences window's tab bar and its always-visible toolbar controls.
 *
 * ══ WHY IT IS ITS OWN COMPONENT (034 FR-045) ══
 *
 * Extracted from `PreferencesShell`, which reaches the config store, the confirm dialog, the reset
 * notice, the JSON edit gate and IPC — so the only way to ask "is the per-tab reset hidden on the
 * Themes tab?" was to launch Electron, open a second window and look. That question, and the ones
 * beside it (does every control carry a truthful title, does any of them still draw an inline SVG
 * element, is the misleading `prefs-reset-all` identifier still gone) are about MARKUP, and markup is
 * answerable one layer down. See `packages/ui/tests/component/preferences-toolbar.test.ts`.
 *
 * That wording is deliberate. `preferences-icons.test.ts` greps every `.tsx` in this directory for
 * the opening tag as raw TEXT, comments included, and an earlier draft of this paragraph failed it by
 * naming the thing it promises not to do.
 *
 * The split is drawn where the dependencies are, not where the visual boundary is: everything here
 * takes props and calls callbacks. It renders with NO provider mounted, because `ConfigContext`'s
 * default state carries the shipped theme, so `Icon` resolves a real glyph from the real theme
 * rather than a stub.
 *
 * ══ WHAT IT DERIVES RATHER THAN RECEIVES ══
 *
 * `showResetCurrent` and the editor's label are computed HERE from the selected tab. They were
 * `const`s in the shell, and passing them in would have moved FR-011's rule — "no per-tab reset on
 * Themes" — into whatever mounts this, which in a test is the test itself. A rule proved against a
 * value the test supplied is not proved at all.
 */
import { type ReactElement } from 'react';
import { IconButton } from '../common/icon-button.js';

export type PreferencesTab = 'settings' | 'keybindings' | 'themes';

export const TABS: readonly { id: PreferencesTab; label: string }[] = [
  { id: 'settings', label: 'Settings' },
  { id: 'keybindings', label: 'Key Bindings' },
  { id: 'themes', label: 'Themes' },
];

export function isPreferencesTab(value: string | null): value is PreferencesTab {
  return value === 'settings' || value === 'keybindings' || value === 'themes';
}

/** The name the per-tab reset uses for the editor it applies to — the tab's own label. */
export function editorLabel(tab: PreferencesTab): string {
  return TABS.find((t) => t.id === tab)?.label ?? '';
}

/**
 * Whether the per-tab reset is offered at all (015, FR-011).
 *
 * It used to be shown-but-disabled for a custom theme. Feature 014 gives every built-in theme row
 * its own restore-to-shipped affordance, so a per-tab reset on Themes would be a second control
 * performing an identical write — it is removed rather than disabled.
 */
export function showsResetCurrent(tab: PreferencesTab): boolean {
  return tab !== 'themes';
}

export interface PreferencesToolbarProps {
  tab: PreferencesTab;
  mode: 'ui' | 'json';
  /**
   * Select a tab. Returns nothing: the CALLER decides whether the switch is allowed, because
   * FR-018 blocks it while the JSON buffer is invalid and only the shell can ask the edit gate.
   */
  onSelectTab: (tab: PreferencesTab) => void;
  onToggleMode: () => void;
  onResetCurrent: () => void;
  onResetPreferences: () => void;
  onRevertAll: () => void;
}

export function PreferencesToolbar({
  tab,
  mode,
  onSelectTab,
  onToggleMode,
  onResetCurrent,
  onResetPreferences,
  onRevertAll,
}: PreferencesToolbarProps): ReactElement {
  return (
    <div className="prefs-tabbar" role="tablist" aria-label="Preferences sections">
      {TABS.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={tab === t.id}
          className={`prefs-tab${tab === t.id ? ' prefs-tab--active' : ''}`}
          data-testid={`prefs-tab-${t.id}`}
          onClick={() => {
            onSelectTab(t.id);
          }}
        >
          {t.label}
        </button>
      ))}
      <div className="prefs-tabbar__spacer" />
      {/* Always-visible toolbar affordances (FR-019/008 — survive min size), every one a
          themeable icon with a hover title (constitution v3.12.0). Their names state exactly
          what they touch: nothing is called "configuration", because projects, window layout
          and workspace state are never reset (015, FR-012a). */}
      <IconButton
        token={mode === 'ui' ? 'editJson' : 'editVisual'}
        className="prefs-toolbtn prefs-toolbtn--icon"
        testId="prefs-mode-toggle"
        title={mode === 'ui' ? 'Switch to JSON editing' : 'Switch to the visual editor'}
        onClick={onToggleMode}
      />
      {showsResetCurrent(tab) ? (
        <IconButton
          token="retry"
          className="prefs-toolbtn prefs-toolbtn--icon"
          testId="prefs-reset-current"
          title={`Reset the ${editorLabel(tab)} editor to its defaults`}
          onClick={onResetCurrent}
        />
      ) : null}
      <IconButton
        token="restoreAll"
        className="prefs-toolbtn prefs-toolbtn--icon"
        testId="prefs-reset-preferences"
        title="Reset All Preferences"
        onClick={onResetPreferences}
      />
      <IconButton
        token="retry"
        className="prefs-toolbtn prefs-toolbtn--icon prefs-toolbtn--revert"
        testId="prefs-revert-all"
        title="Revert All Preferences"
        onClick={onRevertAll}
      />
    </div>
  );
}
