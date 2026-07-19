import { useEffect, useState, type ReactElement } from 'react';
import { countPanels } from '@throng/core';
import { WorkspaceProvider, useWorkspace } from './state/workspace-store.js';
import { useServices } from './composition-root.js';
import { TabGroup } from './workspace/tab-group.js';
import { ThemeProvider } from './theme/theme-provider.js';
import { useActiveTheme } from './config/config-store.js';
import { SubWorkspaceWorkspaceClient } from './state/subworkspace-window-client.js';
import { PanelRenameSync } from './workspace/panel-rename-sync.js';
import { PanelDestroySync } from './workspace/panel-destroy-sync.js';
import { PanelStateSync } from './workspace/panel-state-sync.js';
import { EditorChrome } from './editor/editor-chrome.js';
import { SearchKeybindings } from './search/search-keybindings.js';
import { TitleBar } from './title-bar/title-bar.js';
import { windowTitle } from './common/window-title.js';
import { HoverSuppression } from './common/use-hover-suppression.js';
import {
  SubWorkspaceWindowContext,
  type SubWorkspaceWindowIdentity,
} from './workspace/subworkspace-window-context.js';

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The Workspace Pane for a detached sub-workspace window (US7 / T075). It reuses
 * the project workspace's `TabGroup` unchanged — a sub-workspace is just a tab
 * group whose Panels MAY span projects (INV-5) — so docking, rename, destroy and
 * the active-panel highlight all work identically here.
 */
function SubWorkspacePane(): ReactElement {
  const { layout } = useWorkspace();
  if (!layout || layout.tabs.length === 0) {
    return (
      <main className="pane pane--workspace" data-testid="subworkspace-pane">
        <div className="workspace-empty" data-testid="subworkspace-loading">
          <p>Loading sub-workspace…</p>
        </div>
      </main>
    );
  }
  return (
    <main
      className="pane pane--workspace"
      data-testid="subworkspace-pane"
      data-project={layout.projectId}
    >
      <TabGroup />
    </main>
  );
}

/** Keep the window title a live summary: "<name> · N tabs · N panels" (FR-040). */
function SubWorkspaceTitle({ name }: { name: string }): null {
  const { layout } = useWorkspace();
  useEffect(() => {
    const tabs = layout?.tabs.length ?? 0;
    const panels = layout?.tabs.reduce((n, t) => n + countPanels(t.root), 0) ?? 0;
    window.throng?.setTitle?.(
      windowTitle(`${name} · ${plural(tabs, 'tab')} · ${plural(panels, 'panel')}`),
    );
  }, [layout, name]);
  return null;
}

/**
 * Root component of a detached sub-workspace window. Themed like the main window
 * (hot-reload included) and backed by a {@link SubWorkspaceWorkspaceClient} so its
 * edits persist back to the sub-workspace record (US7). Its dominant colour drives
 * the active-context accent, exactly like the active project's colour does in the
 * main window.
 */
export function SubWorkspaceApp({ subWorkspaceId }: { subWorkspaceId: string }): ReactElement {
  const { workspace, subWorkspaces } = useServices();
  const activeTheme = useActiveTheme();
  const [identity, setIdentity] = useState<SubWorkspaceWindowIdentity | null>(null);
  // Bumped when another window edits THIS sub-workspace (e.g. "Sync to" adds a
  // Tab/Panel) — remounts the workspace so it re-reads the updated content.
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(
    () =>
      window.throng?.subWorkspace?.onChanged((id) => {
        if (id === subWorkspaceId) {
          setReloadKey((k) => k + 1);
          // Identity (name/colour) may have changed too.
          void subWorkspaces.list().then((all) => {
            const meta = all.find((s) => s.id === subWorkspaceId);
            if (meta) setIdentity({ id: meta.id, name: meta.name, colour: meta.colour });
          });
        }
      }),
    [subWorkspaceId, subWorkspaces],
  );

  // Load this window's sub-workspace name + colour for the dominant accent + title.
  useEffect(() => {
    let cancelled = false;
    void subWorkspaces.list().then((all) => {
      const meta = all.find((s) => s.id === subWorkspaceId);
      if (!cancelled && meta) setIdentity({ id: meta.id, name: meta.name, colour: meta.colour });
    });
    return () => {
      cancelled = true;
    };
  }, [subWorkspaces, subWorkspaceId]);

  // Apply the sub-workspace's dominant colour as the active-context accent (the
  // sub-workspace analogue of the active project's colour, FR-004) so active
  // tabs/panels show the sub-workspace colour instead of the default blue.
  useEffect(() => {
    if (identity?.colour) {
      document.documentElement.style.setProperty('--accent', identity.colour);
    }
  }, [identity]);

  return (
    <ThemeProvider theme={activeTheme}>
      <SubWorkspaceWindowContext.Provider value={identity}>
        <WorkspaceProvider
          key={reloadKey}
          client={workspace}
          activeProjectId={SubWorkspaceWorkspaceClient.layoutProjectId(subWorkspaceId)}
        >
          {identity ? <SubWorkspaceTitle name={identity.name} /> : null}
          <HoverSuppression />
          <PanelRenameSync />
          <PanelDestroySync />
          <PanelStateSync />
          <EditorChrome isSubWorkspace />
          <SearchKeybindings />
          {/* Editor keybindings + save/discard/notice dialogs — so a sub-workspace-
              owned editor can be saved and destroyed here too (FR-077). */}
          <div className="throng-root">
            {/* Sub-workspace custom title bar (007, FR-007): identity + window
                controls, NO cog (the preferences entry point is main-window only). */}
            <TitleBar
              identity={windowTitle(identity?.name ?? 'Sub-workspace')}
              colour={identity?.colour}
              showCog={false}
            />
            <div
              className="throng-shell throng-shell--subworkspace"
              data-testid="subworkspace-window"
              data-subworkspace={subWorkspaceId}
            >
              <SubWorkspacePane />
            </div>
          </div>
        </WorkspaceProvider>
      </SubWorkspaceWindowContext.Provider>
    </ThemeProvider>
  );
}
