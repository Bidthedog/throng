/**
 * Focus Mode's indicator (054 FR-078; moved by the manual test change request of 2026-10-12): the MAXIMISED
 * panel's own status strip is painted in its border colour and names the mode, centred, with the way out.
 * The window status bar shows nothing for it.
 *
 * Layer: component — what the real strips draw from the real workspace store and maximise store.
 */
import { act, screen, waitFor } from '@testing-library/react';
import { createElement, useEffect } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type WorkspaceLayout } from '@throng/core';
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
