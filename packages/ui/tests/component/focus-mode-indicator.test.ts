/**
 * Focus Mode's indicator (054 FR-078; moved by the manual test change request of 2026-10-12): the MAXIMISED
 * panel's own status strip is painted in its border colour and names the mode, centred, with the way out.
 * The window status bar shows nothing for it.
 *
 * Layer: component — what the real strips draw from the real workspace store and maximise store.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createDefaultLayout,
  type Panel,
  type WorkspaceLayout,
} from '@throng/core';
import { TerminalPanel } from '../../src/renderer/terminal/terminal-panel.js';
import { ContextMenuProvider } from '../../src/renderer/context-menu-provider.js';
import { TerminalStatusBar } from '../../src/renderer/terminal/terminal-status-bar.js';
import { FOCUS_MODE_STRIP_CLASS } from '../../src/renderer/workspace/focus-mode-badge.js';
import { StatusBar } from '../../src/renderer/statusbar/status-bar.js';
import { PreviewStatusBar } from '../../src/renderer/preview/preview-status-bar.js';
import { __resetMaximise, maximisePanel, maximiseSection, restoreAll } from '../../src/renderer/workspace/maximise-store.js';
import { MaximiseLayer } from '../../src/renderer/workspace/maximise-layer.js';
import { mountWorkspace, type MountedWorkspace } from './helpers/mount-workspace.js';
import { useProjects } from '../../src/renderer/state/projects-store.js';

/** Opens the layout's project, as the projects pane does, so it is the active one whose colour panels take. */
function OpenProject({ id }: { id: string }): null {
  const { switchProject } = useProjects();
  useEffect(() => {
    void switchProject(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount
  }, []);
  return null;
}

let m: MountedWorkspace | undefined;

function twoPanels(): WorkspaceLayout {
  const l = createDefaultLayout('proj-focus', { tab: 't1', panel: 'p1' });
  l.tabs[0]!.root = {
    type: 'split',
    orientation: 'row',
    sizes: [0.5, 0.5],
    children: [
      { type: 'panel', id: 'p1', originProjectId: 'proj-focus', title: 'p1' },
      { type: 'panel', id: 'p2', originProjectId: 'proj-focus', title: 'p2' },
    ],
  };
  return l;
}

const strip = (panelId: string) =>
  createElement(PreviewStatusBar, {
    key: panelId,
    panelId,
    providerKind: 'text',
    parented: false,
    onEditorRoute: () => {},
    syncScroll: false,
    onToggleSyncScroll: () => {},
    readout: null,
  } as Parameters<typeof PreviewStatusBar>[0]);

afterEach(() => {
  m?.unmount();
  m = undefined;
  __resetMaximise();
});

async function mount(): Promise<void> {
  m = await mountWorkspace(twoPanels(), { extras: [createElement(StatusBar, { key: 'bar' }), createElement(MaximiseLayer, { key: 'layer', tabId: 't1' }), strip('p1'), strip('p2')] });
  await screen.findByTestId('preview-status-bar-p1');
}

describe('the Focus Mode indicator', () => {
  it('is absent with nothing maximised', async () => {
    await mount();
    expect(screen.queryByTestId('focus-mode-badge-p1')).toBeNull();
    expect(screen.getByTestId('preview-status-bar-p1')).not.toHaveClass('editor-status-strip--focus-mode');
  });

  it('paints the maximised panel’s strip and names the way out, on that panel only, until restored', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    expect(screen.getByTestId('preview-status-bar-p1')).toHaveClass('editor-status-strip--focus-mode');
    expect(screen.getByTestId('focus-mode-badge-p1')).toHaveTextContent('Focus Mode · Esc or Shift+Alt+Enter to exit');
    expect(screen.queryByTestId('focus-mode-badge-p2')).toBeNull();
    act(() => restoreAll('t1'));
    expect(screen.queryByTestId('focus-mode-badge-p1')).toBeNull();
  });

  it('a maximised diagram shows Focus Mode on the layer’s own strip, not the covered panel’s', async () => {
    await mount();
    act(() => maximiseSection('t1', 'p1', 'diagram-0', () => null));
    expect(screen.queryByTestId('focus-mode-badge-p1')).toBeNull();
    expect(screen.getByTestId('maximise-layer-status-p1')).toHaveClass('editor-status-strip--focus-mode');
    expect(screen.getByTestId('focus-mode-badge-p1-diagram-0')).toHaveTextContent('Focus Mode');
  });

  // MT-04 retest (2026-10-13): a diagram in Focus Mode was ringed in the theme's default active-panel colour, not
  // the project's — the layer handed the project colour to its strip only, and the diagram it holds is outside the
  // panel that carries it.
  it('a maximised diagram is ringed in the project’s colour, as its panel would be', async () => {
    m = await mountWorkspace(twoPanels(), {
      projectColour: '#c0392b',
      extras: [
        createElement(OpenProject, { key: 'open', id: 'proj-focus' }),
        createElement(MaximiseLayer, { key: 'layer', tabId: 't1' }),
      ],
    });
    act(() => maximiseSection('t1', 'p1', 'diagram-0', () => createElement('div', { 'data-testid': 'held-diagram' })));
    const held = await screen.findByTestId('held-diagram');
    // The layer knows the colour — its own strip paints with it.
    await waitFor(() =>
      expect(screen.getByTestId('maximise-layer-status-p1').style.getPropertyValue('--panel-border-colour')).toBe('#c0392b'),
    );
    const carrier = held.closest<HTMLElement>('[style*="--panel-border-colour"]');
    expect(carrier, 'nothing around the maximised diagram carries the project colour').not.toBeNull();
    expect(carrier!.style.getPropertyValue('--panel-border-colour')).toBe('#c0392b');
  });

  it('the window status bar draws no Focus Mode pill', async () => {
    await mount();
    act(() => maximisePanel('t1', 'p1'));
    expect(screen.getByTestId('status-bar')).not.toHaveTextContent('Focus Mode');
  });
});

/*
 * 081 US10 (#727, FR-090 – FR-092) — a terminal's status bar takes the same Focus Mode strip as an editor's: the one
 * shared class and badge, nothing of its own. With `terminals.showStatusBar` off there is no bar, so nothing new.
 */
vi.mock('../../src/renderer/terminal/use-terminal.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminal: () => {},
}));
vi.mock('../../src/renderer/terminal/use-terminal-reconnect.js', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useTerminalReconnect: () => {},
}));

const terminalPanel = {
  type: 'panel',
  id: 'p1',
  originProjectId: 'proj-focus',
  title: 'Terminal',
  kind: 'terminal',
  config: { flavourId: 'cmd', flavourLabel: 'Command Prompt' },
} as unknown as Panel;

const settingsBridge = (settings: Record<string, unknown>) => ({
  config: { get: () => Promise.resolve({ settings }), onChange: () => () => {} },
  terminal: {},
});

const readCss = (path: string): string => readFileSync(resolve(__dirname, path), 'utf8');

const terminalPanelEl = () =>
  createElement(ContextMenuProvider, {
    key: 'term',
    children: createElement(TerminalPanel, { panel: terminalPanel, tabId: 't1', projectRoot: 'C:/proj' }),
  });

describe('081 US10 — the terminal status bar in Focus Mode', () => {
  const termBar = (): HTMLElement => screen.getByTestId('terminal-status-bar-p1');

  it('carries the shared strip class and the badge while its panel is maximised, and drops both on exit (FR-090)', async () => {
    m = await mountWorkspace(twoPanels(), {
      extras: [createElement(TerminalStatusBar, { key: 'term', panelId: 'p1', flavourLabel: 'Command Prompt' })],
    });
    await screen.findByTestId('terminal-status-bar-p1');
    expect(termBar()).not.toHaveClass(FOCUS_MODE_STRIP_CLASS);
    expect(screen.queryByTestId('focus-mode-badge-p1')).toBeNull();
    act(() => maximisePanel('t1', 'p1'));
    expect(termBar()).toHaveClass(FOCUS_MODE_STRIP_CLASS);
    const badge = screen.getByTestId('focus-mode-badge-p1');
    expect(termBar()).toContainElement(badge);
    expect(badge).toHaveTextContent('Focus Mode · Esc or Shift+Alt+Enter to exit');
    expect(termBar()).toHaveTextContent('Command Prompt');
    act(() => restoreAll('t1'));
    expect(termBar()).not.toHaveClass(FOCUS_MODE_STRIP_CLASS);
    expect(screen.queryByTestId('focus-mode-badge-p1')).toBeNull();
  });

  it('the real terminal panel shows the badge in its bar in Focus Mode', async () => {
    m = await mountWorkspace(twoPanels(), {
      throng: settingsBridge({}),
      extras: [terminalPanelEl()],
    });
    await screen.findByTestId('terminal-status-bar-p1');
    act(() => maximisePanel('t1', 'p1'));
    expect(termBar()).toContainElement(screen.getByTestId('focus-mode-badge-p1'));
  });

  it('with terminals.showStatusBar off, Focus Mode draws no bar and no badge (FR-092)', async () => {
    m = await mountWorkspace(twoPanels(), {
      throng: settingsBridge({ terminals: { showStatusBar: false } }),
      extras: [terminalPanelEl()],
    });
    await screen.findByTestId('terminal-p1');
    // The setting lands after the first draw; wait until the bar it removes has gone.
    await waitFor(() => expect(screen.queryByTestId('terminal-status-bar-p1')).toBeNull());
    act(() => maximisePanel('t1', 'p1'));
    expect(screen.queryByTestId('terminal-status-bar-p1')).toBeNull();
    expect(screen.queryByTestId('focus-mode-badge-p1')).toBeNull();
  });

  // jsdom applies no stylesheet, so the one-styling rule (constitution Principle VIII) is read where it is made.
  it('paints the highlight from one rule keyed on the modifier class alone, never a terminal copy of it (FR-090)', () => {
    const editorCss = readCss('../../src/renderer/editor/editor.css');
    const terminalCss = readCss('../../src/renderer/terminal/terminal.css');
    const highlight = new RegExp(`(^|\\n)\\.${FOCUS_MODE_STRIP_CLASS}\\.${FOCUS_MODE_STRIP_CLASS} \\{[^}]*background:`);
    expect(editorCss).toMatch(highlight);
    expect(editorCss).not.toContain(`.editor-status-strip.${FOCUS_MODE_STRIP_CLASS} {`);
    // The setting toggles take the strip's accent text on the highlight, the preview bar's and the terminal's alike.
    expect(editorCss).toMatch(new RegExp(`\\.${FOCUS_MODE_STRIP_CLASS} \\.setting-toggle\\[aria-pressed\\] \\.icon`));
    expect(terminalCss).not.toContain(FOCUS_MODE_STRIP_CLASS);
    // The centred badge is placed against the bar itself.
    expect(terminalCss).toMatch(/\.terminal-status-bar \{[^}]*position: relative;/);
  });

  // FR-091 holds the terminal's strip to the editor strip's legibility by drawing both from one rule (above). Whether
  // accent text on the highlight clears body-text contrast in every bundled theme is a pre-existing gap for every
  // panel type (Gothic 2.84:1, VSCode 4.07:1), tracked on its own issue rather than gated here.
});
