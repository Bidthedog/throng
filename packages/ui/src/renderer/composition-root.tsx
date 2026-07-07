import { createContext, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { createBridge, type ThrongBridge } from './state/bridge.js';
import { ProjectsClient } from './state/projects-client.js';
import { WorkspaceClient } from './state/workspace-client.js';
import { SubWorkspacesClient } from './state/subworkspaces-client.js';
import { SubWorkspaceWorkspaceClient } from './state/subworkspace-window-client.js';
import { ProjectsProvider } from './state/projects-store.js';
import { SubWorkspacesProvider } from './state/subworkspaces-store.js';
import { ConfirmProvider } from './confirm-dialog.js';
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
export function CompositionRoot(): ReactElement {
  const services = useMemo<Services>(() => {
    const bridge = createBridge();
    return {
      bridge,
      projects: new ProjectsClient(bridge),
      workspace: new WorkspaceClient(bridge),
      subWorkspaces: new SubWorkspacesClient(bridge),
    };
  }, []);
  return (
    <ServicesProvider services={services}>
      <ConfigProvider>
        <ConfirmProvider>
          <ContextMenuProvider>
            <ProjectsProvider client={services.projects}>
              <SubWorkspacesProvider client={services.subWorkspaces}>
                <App />
              </SubWorkspacesProvider>
            </ProjectsProvider>
          </ContextMenuProvider>
        </ConfirmProvider>
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
  const services = useMemo<Services>(() => {
    const bridge = createBridge();
    return {
      bridge,
      projects: new ProjectsClient(bridge),
      workspace: new SubWorkspaceWorkspaceClient(bridge, id),
      subWorkspaces: new SubWorkspacesClient(bridge),
    };
  }, [id]);
  return (
    <ServicesProvider services={services}>
      <ConfigProvider>
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
      </ConfigProvider>
    </ServicesProvider>
  );
}
