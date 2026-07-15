import { createContext, useContext, useEffect, useMemo, type ReactElement, type ReactNode } from 'react';
import { createBridge, type ThrongBridge } from './state/bridge.js';
import { ProjectsClient } from './state/projects-client.js';
import { WorkspaceClient } from './state/workspace-client.js';
import { SubWorkspacesClient } from './state/subworkspaces-client.js';
import { SubWorkspaceWorkspaceClient } from './state/subworkspace-window-client.js';
import { DocumentClient } from './state/document-client.js';
import { ProjectsProvider } from './state/projects-store.js';
import { SubWorkspacesProvider } from './state/subworkspaces-store.js';
import { ConfirmProvider } from './confirm-dialog.js';
import { NotificationProvider } from './common/notification.js';
import { ContextMenuProvider } from './context-menu-provider.js';
import { ConfigProvider } from './config/config-store.js';
import { App } from './app.js';
import { SubWorkspaceApp } from './subworkspace-app.js';

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
  const services = useContext(ServicesContext);
  if (!services) {
    throw new Error('useServices must be used within a ServicesProvider');
  }
  return services;
}

/** Compose the real renderer services and mount the main app. */
/**
 * Stop a stray file drop from destroying the running application (018 / US9, FR-061a).
 *
 * THIS IS THE ONE THAT WOULD HAVE BEEN CATASTROPHIC. Drop a file anywhere that is not a drop target —
 * the title bar, the sidebar, the status bar, the gap between panels — and the browser engine's DEFAULT
 * behaviour is to NAVIGATE TO IT: the renderer replaces the entire running workspace with a view of the
 * dropped file. Every terminal, every unsaved buffer, the whole layout — gone, with no way back. Nothing
 * in the application prevented this before US9, because before US9 nothing invited the user to drag a
 * file at Throng in the first place.
 *
 * It is a RENDERER `preventDefault`, deliberately, and not a main-process `will-navigate` handler: this
 * stops the default BEFORE it becomes a navigation, rather than catching a navigation that has already
 * begun. Mounted at the composition root so it covers the main window AND every sub-workspace window.
 */
export function useNoDropNavigation(): void {
  useEffect(() => {
    const swallow = (e: globalThis.DragEvent): void => {
      // A drop target that wants the file has already called preventDefault and stopped propagation, so
      // by the time an event reaches here it landed on nothing. Refuse the navigation, silently — the
      // user aimed at nothing in particular and expects nothing in particular to happen.
      e.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);
}

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
    };
  }, []);
  return (
    <ServicesProvider services={services}>
      <ConfigProvider>
        {/* 018 / FR-054 — the two notice models, in every window. */}
        <NotificationProvider>
          <ConfirmProvider>
            <ContextMenuProvider>
              <ProjectsProvider client={services.projects}>
                <SubWorkspacesProvider client={services.subWorkspaces}>
                  <App />
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
    };
  }, [id]);
  return (
    <ServicesProvider services={services}>
      <ConfigProvider>
        <NotificationProvider>
          <ConfirmProvider>
            <ContextMenuProvider>
              {/* A sub-workspace MAY hold Panels from several projects (INV-5), and
                  the Panel header colours itself by its origin project — so the
                  projects list is needed here too. */}
              <ProjectsProvider client={services.projects}>
                <SubWorkspaceApp subWorkspaceId={id} />
              </ProjectsProvider>
            </ContextMenuProvider>
          </ConfirmProvider>
        </NotificationProvider>
      </ConfigProvider>
    </ServicesProvider>
  );
}
