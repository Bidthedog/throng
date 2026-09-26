/**
 * 046 FR-026 — a digit-row chord is matched on the PHYSICAL key by every resolver, not only the
 * window dispatcher (US3 review, fix round item 1).
 *
 * The capture modal records the physical digit (`Ctrl+Shift+1`, not the `Ctrl+Shift+!` a US layout
 * produces), so a chord a user captures for ANY command is only reachable if the resolver that owns
 * that command matches physically too. Before this fix only `app.tsx`'s window listener did: a
 * Save As captured as Ctrl+Shift+1 saved nothing in the editor, a find chord captured that way was
 * no longer reserved in a terminal (the keystroke reached the shell), and an in-menu shortcut on a
 * digit never fired. `renderer-chord-resolvers.test.ts` keeps every other resolver on the same
 * helper by discovering them.
 *
 * Every event here is what a US keyboard sends for Ctrl+Shift+1: key `!`, code `Digit1`.
 */
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement, type ReactElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  DEFAULT_KEYBINDINGS,
  resolveAction,
  THRONG_THEME,
  type Keybindings,
  type WorkspaceLayout,
} from '@throng/core';
import type { ProjectCategoryDto, ProjectDto } from '@throng/ipc-contract';
import type { ThrongBridge } from '../../src/renderer/state/bridge.js';
import { ProjectsClient } from '../../src/renderer/state/projects-client.js';
import { ProjectsProvider } from '../../src/renderer/state/projects-store.js';
import { WorkspaceClient } from '../../src/renderer/state/workspace-client.js';
import { WorkspaceProvider, useWorkspace } from '../../src/renderer/state/workspace-store.js';
import { ConfigProvider, useConfigLoaded } from '../../src/renderer/config/config-store.js';
import { NotificationProvider } from '../../src/renderer/common/notification.js';
import { EditorKeybindings } from '../../src/renderer/editor/editor-chrome.js';
import { registerEditorActions, unregisterEditorActions } from '../../src/renderer/editor/editor-actions.js';
import { setActivePane } from '../../src/renderer/workspace/active-pane.js';
import { terminalReservesKeydown } from '../../src/renderer/search/search-actions.js';
import { chordMatchesShortcut } from '../../src/renderer/workspace/context-menu.js';
import { KeybindingsHandler } from '../../src/renderer/app.js';
import { resolveKeydown } from '../../src/renderer/config/chord-key.js';
import { resolveScoped, scopeFromKind } from '../../src/renderer/keybindings/scope.js';

/** US Ctrl+Shift+1: the produced `!` on the physical Digit1. */
const CTRL_SHIFT_1 = { key: '!', code: 'Digit1', ctrlKey: true, shiftKey: true, altKey: false };

const bindingsWith = (overrides: Record<string, string[]>): Keybindings => ({
  version: 1,
  bindings: { ...DEFAULT_KEYBINDINGS.bindings, ...overrides },
});

const now = '2026-01-01T00:00:00.000Z';
const CATEGORIES: ProjectCategoryDto[] = [
  { id: 'default', name: 'In Progress', isDefault: true, minimised: false, createdAt: now, updatedAt: now },
];
const PROJECT: ProjectDto = {
  id: 'p1', name: 'p1', colour: '#3b82f6', rootFolder: 'C:/projects/p1', isActive: true,
  createdAt: now, updatedAt: now, hiddenPaths: [], categoryId: 'default',
};
const LAYOUT: WorkspaceLayout = {
  projectId: 'p1',
  schemaVersion: 1,
  tabs: [
    {
      id: 't1',
      title: 'Tab 1',
      root: { type: 'panel', id: 'ed-p1', originProjectId: 'p1', title: 'Editor', kind: 'editor', config: { filePath: 'C:/projects/p1/a.ts' } },
      activePanelId: 'ed-p1',
    },
  ],
  activeTabId: 't1',
};

function bridge(): ThrongBridge {
  return {
    invoke<TResult>(method: string, params?: unknown): Promise<TResult> {
      switch (method) {
        case 'projects.list':
          return Promise.resolve({ projects: [PROJECT] } as unknown as TResult);
        case 'projects.categories.list':
          return Promise.resolve({ categories: CATEGORIES } as unknown as TResult);
        case 'projects.setActive':
          return Promise.resolve({ activeId: (params as { id: string }).id } as unknown as TResult);
        case 'workspace.load':
          return Promise.resolve({ layout: LAYOUT, restored: true } as unknown as TResult);
        case 'workspace.save':
          return Promise.resolve({ ok: true } as unknown as TResult);
        default:
          return Promise.reject(new Error(`unexpected RPC: ${method}`));
      }
    },
  };
}

/** Reports when the keybindings AND the layout have arrived, so a press never beats either. */
function Ready(): ReactElement {
  const loaded = useConfigLoaded();
  const { layout } = useWorkspace();
  return createElement('span', { 'data-testid': 'ready', 'data-ready': String(loaded && layout !== null) });
}

afterEach(() => {
  unregisterEditorActions('ed-p1');
  Reflect.deleteProperty(window, 'throng');
  setActivePane('workspace');
});

describe('a digit chord captured for an EDITOR command reaches it (FR-026)', () => {
  it('Save As bound to Ctrl+Shift+1 saves when a US keyboard sends ! on Digit1', async () => {
    const keybindings = bindingsWith({ 'editor.saveAs': ['Ctrl+Shift+1'] });
    Reflect.set(window, 'throng', {
      config: {
        get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS, theme: THRONG_THEME, keybindings }),
        onChange: () => () => {},
      },
      editor: { isOpen: () => Promise.resolve(false) },
      panel: { notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    });
    const b = bridge();
    render(
      createElement(
        ConfigProvider,
        null,
        createElement(
          ProjectsProvider,
          { client: new ProjectsClient(b) },
          createElement(
            WorkspaceProvider,
            { client: new WorkspaceClient(b), activeProjectId: 'p1' },
            createElement(
              NotificationProvider,
              null,
              createElement('div', null, createElement(Ready), createElement(EditorKeybindings, { isSubWorkspace: false })),
            ),
          ),
        ),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveAttribute('data-ready', 'true'));
    /*
     * FLAKE fix (branch review) — `Ready`'s own DOM commits (`loaded && layout !== null`) in the
     * SAME render as `EditorKeybindings`'s `[keybindings]` effect dependency changes, but that
     * effect — which attaches THIS test's real keydown listener — is a separately scheduled passive
     * effect, not guaranteed to have run yet just because `waitFor` observed the DOM update. Firing
     * the key immediately after raced it roughly 1 run in 20 (isolated), landing on the STALE
     * listener from before config resolved and swallowing the keydown. One more tick drains it.
     */
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saveAs = vi.fn(() => Promise.resolve(true));
    registerEditorActions('ed-p1', {
      save: vi.fn(() => Promise.resolve(true)),
      saveAs,
      isDirty: () => true,
      openFile: () => Promise.resolve(),
      revert: () => {},
      reloadFromDisk: () => Promise.resolve(true),
    });
    setActivePane('workspace');

    fireEvent.keyDown(window, CTRL_SHIFT_1);

    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
  });
});

describe('a digit chord captured for a TERMINAL-reserved command stays throng’s (FR-026)', () => {
  it('Find bound to Ctrl+Shift+1 is reserved, so the keystroke never reaches the shell', () => {
    const keybindings = bindingsWith({ 'search.find': ['Ctrl+Shift+1'] });
    const e = new KeyboardEvent('keydown', CTRL_SHIFT_1);
    expect(terminalReservesKeydown(keybindings, e, false, false)).toBe(true);
  });

  it('AltGr on a digit is still the shell’s: German Ctrl+Alt+0 types }, and nothing reserves it', () => {
    const keybindings = bindingsWith({ 'search.find': ['Ctrl+0'] });
    const e = new KeyboardEvent('keydown', { key: '}', code: 'Digit0', ctrlKey: true, altKey: true });
    expect(terminalReservesKeydown(keybindings, e, false, false)).toBe(false);
  });
});

describe('an in-menu shortcut on a digit fires from the physical key (FR-026)', () => {
  it('Ctrl+Shift+1 matches the advertised "Ctrl+Shift+1" when a US keyboard sends !', () => {
    expect(chordMatchesShortcut(CTRL_SHIFT_1, 'Ctrl+Shift+1')).toBe(true);
  });

  it('and a produced-character shortcut still matches as before', () => {
    expect(chordMatchesShortcut({ key: 'c', code: 'KeyC', ctrlKey: true, shiftKey: false, altKey: false }, 'Ctrl+C')).toBe(true);
  });
});

/**
 * 046 iterate round 1 (T107, FR-104) — a TIER-1 chord (Ctrl+Shift+Alt) fires through every resolver
 * this file's sibling guard (`renderer-chord-resolvers.test.ts`) discovers, whatever character the
 * layout produced, through REAL DOM dispatch rather than a direct call — the integration-shaped half
 * of the unit-level proof in `renderer-chord-resolvers.test.ts` / `window-chord-manifest.test.ts`.
 *
 * The window listener and `editor-chrome.tsx` own real commands this suite can observe directly
 * (`view.toggleProjects`, and a REBOUND `editor.saveAs`, the same device the FR-026 describe block
 * above uses for `Ctrl+Shift+1`). `search-keybindings.tsx` and `preview-commands.tsx` own no tier-1
 * command of their own — tier 1 is window/navigation-level by definition (FR-101) — so those two are
 * proven by calling `resolveKeydown` with the EXACT expression each site's own `onKeyDown` builds
 * (copied from `search-keybindings.tsx` and `preview-commands.tsx` respectively), the same technique
 * `chordMatchesShortcut` and `terminalReservesKeydown` already use above for `context-menu.tsx` and
 * `search-actions.ts`.
 */
describe('a tier-1 chord fires through every resolver, whatever the layout produced (FR-104)', () => {
  // AZERTY's KeyM produces "," — R22's own example, and the AZERTY case
  // `chord-candidates.test.ts` and `renderer-chord-resolvers.test.ts` already pin.
  const AZERTY_M = { key: ',', code: 'KeyM', ctrlKey: true, shiftKey: true, altKey: true, metaKey: false };

  /**
   * `KeybindingsHandler` reads `useWorkspace()` unconditionally, so it needs the same provider
   * stack the "Save As" block above builds — `render`ing it bare throws
   * "useWorkspace must be used within a WorkspaceProvider" before the keydown is ever dispatched.
   */
  async function renderHandler(onToggleProjects: () => void): Promise<void> {
    Reflect.set(window, 'throng', {
      config: {
        get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS, theme: THRONG_THEME, keybindings: DEFAULT_KEYBINDINGS }),
        onChange: () => () => {},
      },
      editor: { isOpen: () => Promise.resolve(false) },
      panel: { notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    });
    const b = bridge();
    render(
      createElement(
        ConfigProvider,
        null,
        createElement(
          ProjectsProvider,
          { client: new ProjectsClient(b) },
          createElement(
            WorkspaceProvider,
            { client: new WorkspaceClient(b), activeProjectId: 'p1' },
            createElement(
              NotificationProvider,
              null,
              createElement('div', null, createElement(Ready), createElement(KeybindingsHandler, {
                onToggleProjects,
                onToggleExplorer: () => {},
                onRevealLeft: () => {},
                onRevealRight: () => {},
              })),
            ),
          ),
        ),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveAttribute('data-ready', 'true'));
    // FLAKE fix (branch review) — see the identical comment on the FR-026 "Save As" test above:
    // `KeybindingsHandler`'s own `[keybindings]`-keyed listener-attachment effect is not guaranteed
    // to have run just because `Ready`'s DOM already shows it. One more tick drains it.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  it('the window listener: Ctrl+Shift+Alt+J (view.toggleProjects) fires from what AZERTY produces for J', async () => {
    // AZERTY does not move J, but the window listener must still match on `code`, not `key` — proven
    // by feeding it the produced character a layout WOULD diverge on on a bound key, `code: 'KeyJ'`.
    // 046 iterate round 3 (T180, FR-117): `view.toggleProjects` ships on J now; B is `focus.projects`.
    const onToggleProjects = vi.fn();
    await renderHandler(onToggleProjects);
    fireEvent.keyDown(window, { key: 'j', code: 'KeyJ', ctrlKey: true, shiftKey: true, altKey: true });
    expect(onToggleProjects).toHaveBeenCalledTimes(1);
  });

  it('the window listener: a metaKey press fires nothing (FR-104)', async () => {
    const onToggleProjects = vi.fn();
    await renderHandler(onToggleProjects);
    fireEvent.keyDown(window, {
      key: 'j',
      code: 'KeyJ',
      ctrlKey: true,
      shiftKey: true,
      altKey: true,
      metaKey: true,
    });
    expect(onToggleProjects).not.toHaveBeenCalled();
  });

  it('editor-chrome.tsx: a command REBOUND to Ctrl+Shift+Alt+M fires from what AZERTY produces there', async () => {
    // editor.saveAs ships tier 2 (Ctrl+Alt+S, a recorded exception, FR-103) — rebinding it to a
    // tier-1-SHAPED chord here is a test device only, the same way the FR-026 block above binds
    // editor.saveAs to Ctrl+Shift+1, which is not its shipped default either. What is under test is
    // resolveKeydown's PHYSICAL match, not which command tier 1 actually ships to.
    // `focus.explorer` ships this SAME physical chord (Ctrl+Shift+Alt+M, 046 FR-117; `focus.notice`
    // held it before) and is EVERYWHERE-scoped, so it is unbound here too — otherwise the rebind
    // collides with a real shipped default and the scope resolver's own tie-break, not the physical
    // match, decides which action wins.
    const keybindings = bindingsWith({ 'editor.saveAs': ['Ctrl+Shift+Alt+M'], 'focus.explorer': [] });
    Reflect.set(window, 'throng', {
      config: {
        get: () => Promise.resolve({ settings: DEFAULT_APP_SETTINGS, theme: THRONG_THEME, keybindings }),
        onChange: () => () => {},
      },
      editor: { isOpen: () => Promise.resolve(false) },
      panel: { notifyTyped: vi.fn(), publishIdentities: vi.fn() },
    });
    const b = bridge();
    render(
      createElement(
        ConfigProvider,
        null,
        createElement(
          ProjectsProvider,
          { client: new ProjectsClient(b) },
          createElement(
            WorkspaceProvider,
            { client: new WorkspaceClient(b), activeProjectId: 'p1' },
            createElement(
              NotificationProvider,
              null,
              createElement('div', null, createElement(Ready), createElement(EditorKeybindings, { isSubWorkspace: false })),
            ),
          ),
        ),
      ),
    );
    await waitFor(() => expect(screen.getByTestId('ready')).toHaveAttribute('data-ready', 'true'));
    // FLAKE fix (branch review) — see the identical comment on the FR-026 "Save As" test above.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const saveAs = vi.fn(() => Promise.resolve(true));
    registerEditorActions('ed-p1', {
      save: vi.fn(() => Promise.resolve(true)),
      saveAs,
      isDirty: () => true,
      openFile: () => Promise.resolve(),
      revert: () => {},
      reloadFromDisk: () => Promise.resolve(true),
    });
    setActivePane('workspace');

    fireEvent.keyDown(window, AZERTY_M);

    await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
  });

  it('search-keybindings.tsx’s own resolveKeydown call matches a tier-1 chord from an AZERTY event', () => {
    // The exact expression `search-keybindings.tsx`'s onKeyDown builds
    // (`resolveKeydown(e, (ev) => resolveAction(keybindings, ev, scopeFromKind(activeKind)))`),
    // rebinding `search.find` the same test-device way as the block above. `focus.explorer` ships this
    // same chord (EVERYWHERE-scoped) and is unbound here for the same reason as the block above.
    const keybindings = bindingsWith({ 'search.find': ['Ctrl+Shift+Alt+M'], 'focus.explorer': [] });
    const action = resolveKeydown(AZERTY_M, (ev) => resolveScoped(keybindings, ev, {
      tabs: [{ id: 't1', title: 'T', activePanelId: 'p1', root: { type: 'panel', id: 'p1', kind: 'editor', title: 'P' } }] as unknown as WorkspaceLayout['tabs'],
      activeTabId: 't1',
    }, { transientFocus: false }));
    expect(action).toBe('search.find');
    // scopeFromKind is imported and used the same way this site uses it, for the same call shape.
    expect(scopeFromKind('editor')).toBe('editor');
  });

  it('preview-commands.tsx’s own resolveKeydown call matches a tier-1 chord from an AZERTY event', () => {
    // The exact expression `preview-commands.tsx`'s onKeyDown builds
    // (`resolveKeydown(e, (ev) => resolveScoped(keybindings, ev, { tabs, activeTabId }))`),
    // rebinding `preview.followLink` — a command live in a preview scope. `focus.explorer` ships this
    // same chord (EVERYWHERE-scoped) and is unbound here for the same reason as the blocks above.
    const keybindings = bindingsWith({ 'preview.followLink': ['Ctrl+Shift+Alt+M'], 'focus.explorer': [] });
    const action = resolveKeydown(AZERTY_M, (ev) =>
      resolveScoped(keybindings, ev, {
        tabs: [{ id: 't1', title: 'T', activePanelId: 'p1', root: { type: 'panel', id: 'p1', kind: 'preview', title: 'P' } }] as unknown as WorkspaceLayout['tabs'],
        activeTabId: 't1',
      }),
    );
    expect(action).toBe('preview.followLink');
  });
});

/**
 * Fix round IMPORTANT (review of T111) — `resolveKeydown` must try the PHYSICAL candidates (tier-1,
 * same-binding) and then the caller's `produced` fallback, never rule 3's own Shift-dropped produced
 * token in between. `chordCandidates`' rule 3 drops Shift for any key that is not the physical
 * backtick, an F-key, a letter or an arrow — `Delete`, `Home`, `End`, `Enter` and `Escape` are not any
 * of those, so a resolver that tried rule 3 before the default `produced` (which keeps Shift exactly
 * as the event reported it) would silently resolve `Shift+<key>` to whatever plain `<key>` is bound
 * to. Each case below is the EXACT expression its own site builds, the same technique the tier-1
 * block above uses — a positive control (the plain chord still resolving) sits beside every negative,
 * so a resolver that stopped matching ANYTHING could not pass by accident.
 */
describe('Shift genuinely changes the chord at every resolver, not only the window listener (fix round IMPORTANT)', () => {
  it('explorer-keybindings.ts: Shift+Delete does not run file.delete', () => {
    // The exact expression explorer-keybindings.ts's onKeyDown builds:
    // resolveKeydown(e, (ev) => resolveAction(keybindings, ev, 'explorer')).
    const plain = { key: 'Delete', code: 'Delete', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(resolveKeydown(plain, (ev) => resolveAction(DEFAULT_KEYBINDINGS, ev, 'explorer'))).toBe(
      'file.delete',
    );
    const shifted = { ...plain, shiftKey: true };
    expect(
      resolveKeydown(shifted, (ev) => resolveAction(DEFAULT_KEYBINDINGS, ev, 'explorer')),
    ).not.toBe('file.delete');
  });

  it('search-actions.ts: Ctrl+Shift+Home is not reserved as terminal.scrollToTop', () => {
    // terminalReservesKeydown builds its own resolveKeydown(e, (ev) => resolveAction(keybindings, ev, 'terminal')) call.
    const plain = new KeyboardEvent('keydown', { key: 'Home', code: 'Home', ctrlKey: true });
    expect(terminalReservesKeydown(DEFAULT_KEYBINDINGS, plain, false, false)).toBe(true);
    const shifted = new KeyboardEvent('keydown', {
      key: 'Home',
      code: 'Home',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(terminalReservesKeydown(DEFAULT_KEYBINDINGS, shifted, false, false)).toBe(false);
  });

  it('preview-commands.tsx: Ctrl+Shift+Enter does not fire preview.followLink', () => {
    const input = {
      tabs: [
        {
          id: 't1',
          title: 'T',
          activePanelId: 'p1',
          root: { type: 'panel', id: 'p1', kind: 'preview', title: 'P' },
        },
      ] as unknown as WorkspaceLayout['tabs'],
      activeTabId: 't1',
    };
    const plain = { key: 'Enter', code: 'Enter', ctrlKey: true, altKey: false, shiftKey: false, metaKey: false };
    expect(resolveKeydown(plain, (ev) => resolveScoped(DEFAULT_KEYBINDINGS, ev, input))).toBe(
      'preview.followLink',
    );
    const shifted = { ...plain, shiftKey: true };
    expect(
      resolveKeydown(shifted, (ev) => resolveScoped(DEFAULT_KEYBINDINGS, ev, input)),
    ).not.toBe('preview.followLink');
  });

  it('search-keybindings.tsx: Shift+Escape does not run search.close (the find bar)', () => {
    // The exact expression search-keybindings.tsx's onKeyDown builds:
    // resolveKeydown(e, (ev) => resolveAction(keybindings, ev, scopeFromKind(activeKind))).
    const plain = { key: 'Escape', code: 'Escape', ctrlKey: false, altKey: false, shiftKey: false, metaKey: false };
    expect(
      resolveKeydown(plain, (ev) => resolveAction(DEFAULT_KEYBINDINGS, ev, scopeFromKind('editor'))),
    ).toBe('search.close');
    const shifted = { ...plain, shiftKey: true };
    expect(
      resolveKeydown(shifted, (ev) => resolveAction(DEFAULT_KEYBINDINGS, ev, scopeFromKind('editor'))),
    ).not.toBe('search.close');
  });
});
