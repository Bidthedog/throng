import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { createBridge, type ThrongBridge } from './state/bridge.js';
import { ProjectsClient } from './state/projects-client.js';
import { WorkspaceClient } from './state/workspace-client.js';
import { SubWorkspacesClient } from './state/subworkspaces-client.js';
import { SubWorkspaceWorkspaceClient } from './state/subworkspace-window-client.js';
import { DocumentClient } from './state/document-client.js';
import { FileOpUndoClient } from './state/fileop-undo-client.js';
import { PanelNameClient } from './state/panel-name-client.js';
import { ProjectsProvider } from './state/projects-store.js';
import { SubWorkspacesProvider } from './state/subworkspaces-store.js';
import { ConfirmProvider } from './confirm-dialog.js';
import { LinkPromptHost } from './link-prompt/link-prompt-host.js';
import { ReplaceAllPrompt } from './search/replace-all-prompt.js';
import { TerminalTitleContextFeeder } from './terminal/title-context.js';
import { NotificationProvider } from './common/notification.js';
import { PrintSavedNotice } from './print/print-saved-notice.js';
import { ContextMenuProvider } from './context-menu-provider.js';
import { ConfigProvider } from './config/config-store.js';
import { LinkHint } from './links/link-hint.js';
import { AttentionToasts } from './attention/attention-toasts.js';
import { BadgeAnswerer } from './attention/badge-answerer.js';
import { App } from './app.js';
import { SubWorkspaceApp } from './subworkspace-app.js';
import { useNoDropNavigation } from './common/no-drop-navigation.js';

/**
 * Renderer composition root (#3 of the system — Principle IX / research D9). The
 * Electron renderer is a separate process realm that cannot share the UI-main
 * container, so it gets exactly one root. Services are constructed here and
 * provided via React context; components receive them through `useServices`,
 * never by importing singletons. Tests inject fakes via `ServicesProvider`.
 */
export interface Services {
  bridge: ThrongBridge;
  projects: ProjectsClient;
  workspace: WorkspaceClient;
  subWorkspaces: SubWorkspacesClient;
  /** Per-document state — the language override (016, FR-028e). */
  documents: DocumentClient;
  /** 024 US3 (#85): the per-project file-operation undo/redo stack. */
  fileOpUndo: FileOpUndoClient;
  /** 024 follow-up: globally unique panel names. */
  panelNames: PanelNameClient;
}

const ServicesContext = createContext<Services | null>(null);

export function ServicesProvider({
  services,
  children,
}: {
  services: Services;
  children: ReactNode;
}): ReactElement {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export function useServices(): Services {
  const services = useServicesOptional();
  if (!services) {
    throw new Error('useServices must be used within a ServicesProvider');
  }
  return services;
}

/**
 * `useServices()`, without the throw — `null` outside a `ServicesProvider` (044 US4 fix round 1, item
 * 2). For a component mounted in BOTH a fully-wired window and a component test that stubs only what
 * that test needs — `WorkspaceProvider` and `PreviewProviderSync` are the two: a sub-workspace's own
 * destroy route needs `services.subWorkspaces`, but dozens of existing tests mount either without a
 * `ServicesProvider` at all, and must keep working exactly as before.
 */
export function useServicesOptional(): Services | null {
  return useContext(ServicesContext);
}

export { useNoDropNavigation };

/** Compose the real renderer services and mount the main app. */
export function CompositionRoot(): ReactElement {
  useNoDropNavigation();
  const services = useMemo<Services>(() => {
    const bridge = createBridge();
    return {
      bridge,
      projects: new ProjectsClient(bridge),
      workspace: new WorkspaceClient(bridge),
      subWorkspaces: new SubWorkspacesClient(bridge),
      documents: new DocumentClient(bridge),
      fileOpUndo: new FileOpUndoClient(bridge),
      panelNames: new PanelNameClient(bridge),
    };
  }, []);
  return (
    <ServicesProvider services={services}>
      <ConfigProvider>
        {/* 018 / FR-054 — the two notice models, in every window. */}
        <NotificationProvider>
          {/* 057 R12 — the toast for a panel that needs the user; every window mounts its own. The MAIN
              window also reconciles the panel's attention entries against the mark set (068 FR-025). */}
          <AttentionToasts reconcile />
          <BadgeAnswerer />
          <ConfirmProvider>
            <ContextMenuProvider>
              <ProjectsProvider client={services.projects}>
                <SubWorkspacesProvider client={services.subWorkspaces}>
                  <ReplaceAllPrompt />
                  {/* 075 FR-082 — where a PDF this window asked for was saved; every window mounts its own. */}
                  <PrintSavedNotice />
                  {/* 053 — the template, limits and names a terminal panel's title is rendered from. */}
                  <TerminalTitleContextFeeder />
                  <App />
                  {/* 045 FR-166 — one link hint per WINDOW (each renderer is its own process). */}
                  <LinkHint />
                </SubWorkspacesProvider>
              </ProjectsProvider>
            </ContextMenuProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </ConfigProvider>
    </ServicesProvider>
  );
}

/**
 * Renderer composition root for a detached **sub-workspace** window (US7). It
 * mounts the same provider stack as the main window but swaps in a
 * {@link SubWorkspaceWorkspaceClient} bound to this window's sub-workspace id, and
 * renders the lightweight {@link SubWorkspaceApp} shell (no project sidebar/panes).
 */
export function SubWorkspaceCompositionRoot({ id }: { id: string }): ReactElement {
  // A sub-workspace window is a SEPARATE renderer realm with its own root, so it needs the guard too —
  // and it is the window where a stray drop costs most, because a drop is the only file-open affordance
  // it has (it mounts no explorer), so it is the window the user will actually drag files at.
  useNoDropNavigation();
  const services = useMemo<Services>(() => {
    const bridge = createBridge();
    return {
      bridge,
      projects: new ProjectsClient(bridge),
      workspace: new SubWorkspaceWorkspaceClient(bridge, id),
      subWorkspaces: new SubWorkspacesClient(bridge),
      // A sub-workspace window MAY hold editor panels (INV-5), and the editor reaches
      // per-document state (the language override, 016) through `services.documents`.
      // Omitting it left `useServices().documents` undefined in this realm — a crash the
      // first time an editor here touched it. The main root has always provided it.
      documents: new DocumentClient(bridge),
      fileOpUndo: new FileOpUndoClient(bridge),
      panelNames: new PanelNameClient(bridge),
    };
  }, [id]);
  return (
    <ServicesProvider services={services}>
      <ConfigProvider>
        <NotificationProvider>
          <AttentionToasts />
          <BadgeAnswerer />
          <ConfirmProvider>
            <ContextMenuProvider>
              {/* A sub-workspace MAY hold Panels from several projects (INV-5), and
                  the Panel header colours itself by its origin project — so the
                  projects list is needed here too. */}
              <ProjectsProvider client={services.projects}>
                <ReplaceAllPrompt />
                <PrintSavedNotice />
                <SubWorkspaceApp subWorkspaceId={id} />
                <LinkHint />
                {/* 080 FR-070 — a link followed in this window asks here. */}
                <LinkPromptHost />
              </ProjectsProvider>
            </ContextMenuProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </ConfigProvider>
    </ServicesProvider>
  );
}
