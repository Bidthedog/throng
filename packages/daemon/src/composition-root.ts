import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { Container } from 'inversify';
import type {
  IDaemonSettings,
  IPersistenceSettings,
  IPlatformInfo,
  IProjectStore,
  IUserContext,
} from '@throng/core';
import { ProjectService, countPanels } from '@throng/core';
import {
  WindowsPlatformInfo,
  NodeUserContext,
  NodePtyHost,
  WindowsDirectoryLock,
  WindowsElevation,
  WindowsProcessCwd,
  WindowsDeElevatedLauncher,
} from '@throng/platform-windows';
import {
  openDatabase,
  ProjectRepository,
  WorkspaceRepository,
  SubWorkspaceRepository,
  type ThrongDatabase,
} from '@throng/persistence';
import { DAEMON_TYPES } from './tokens.js';
import { IpcServer } from './ipc-server.js';
import { RpcRouter } from './rpc-router.js';
import { HealthService } from './health-service.js';
import { ProjectIpcService } from './project-service.js';
import { WorkspaceIpcService } from './workspace-service.js';
import { SubWorkspaceIpcService } from './subworkspace-service.js';
import { TerminalEvents } from './terminal-events.js';
import { TerminalLockManager } from './terminal-lock-manager.js';
import { TerminalService } from './terminal-service.js';
import { PtyAgentHost } from './pty-agent-host.js';

export { DAEMON_TYPES } from './tokens.js';

/**
 * Composition root #1 (Principle IX / [Gap B]): the daemon process's single
 * IoC container. Configuration is read here only (Principle X / [Gap C]) from
 * documented defaults, overridable via environment. This is the one place that
 * selects OS implementations (Principle II) and assembles the object graph —
 * including registering every JSON-RPC method into the router.
 */
const DEFAULT_PIPE_NAME = '\\\\.\\pipe\\throng.daemon';
const DEFAULT_STARTUP_TIMEOUT_MS = 5000;

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultDatabasePath(env: NodeJS.ProcessEnv): string {
  const base = env.APPDATA ?? join(homedir(), 'AppData', 'Roaming');
  return join(base, 'throng', 'throng.db');
}

function readDaemonSettings(env: NodeJS.ProcessEnv): IDaemonSettings {
  return {
    pipeName: env.THRONG_PIPE_NAME ?? DEFAULT_PIPE_NAME,
    startupTimeoutMs: numberFromEnv(env.THRONG_STARTUP_TIMEOUT_MS, DEFAULT_STARTUP_TIMEOUT_MS),
  };
}

function readPersistenceSettings(env: NodeJS.ProcessEnv): IPersistenceSettings {
  return {
    databasePath: env.THRONG_DATABASE_PATH ?? defaultDatabasePath(env),
  };
}

export function createDaemonContainer(env: NodeJS.ProcessEnv = process.env): Container {
  const container = new Container({ defaultScope: 'Singleton' });

  container.bind<IDaemonSettings>(DAEMON_TYPES.DaemonSettings).toConstantValue(readDaemonSettings(env));
  container
    .bind<IPersistenceSettings>(DAEMON_TYPES.PersistenceSettings)
    .toConstantValue(readPersistenceSettings(env));

  // OS abstractions (Principle II) — the only place that selects implementations.
  container.bind<IPlatformInfo>(DAEMON_TYPES.PlatformInfo).toConstantValue(new WindowsPlatformInfo());
  const userContext = new NodeUserContext();
  container.bind<IUserContext>(DAEMON_TYPES.UserContext).toConstantValue(userContext);

  // Durable store (opened once; migrations run by main on startup).
  const persistenceSettings = container.get<IPersistenceSettings>(DAEMON_TYPES.PersistenceSettings);
  const database = openDatabase(persistenceSettings);
  container.bind<ThrongDatabase>(DAEMON_TYPES.Database).toConstantValue(database);

  // Project domain: repository (port impl) → pure core service.
  const projectStore = new ProjectRepository(database);
  container.bind<IProjectStore>(DAEMON_TYPES.ProjectStore).toConstantValue(projectStore);
  const projectService = new ProjectService({
    store: projectStore,
    userContext,
    newId: () => randomUUID(),
    now: () => new Date().toISOString(),
  });

  // Workspace domain: per-project layout + sub-workspace store (research D4/D5).
  const workspaceStore = new WorkspaceRepository(database);
  const subWorkspaceStore = new SubWorkspaceRepository(database);

  // Per-project tab/panel counts for projects.list — read from each project's
  // saved layout (a never-saved project reports its default 1 tab / 1 panel).
  const countLayout = (projectId: string): { tabCount: number; panelCount: number } => {
    const { layout } = workspaceStore.load(userContext.currentUser().userId, projectId);
    return {
      tabCount: layout.tabs.length,
      panelCount: layout.tabs.reduce((n, tab) => n + countPanels(tab.root), 0),
    };
  };

  // Terminal layer (005 Phase C): node-pty PTYs + a ref-counted project-root lock,
  // streamed to the UI as JSON-RPC notifications over the events socket. node-pty
  // loads here (plain-Node daemon) — never in the UI/Electron process.
  const terminalEvents = new TerminalEvents();
  const lockManager = new TerminalLockManager(new WindowsDirectoryLock());
  // One elevation probe shared by the service (capabilities) and the routing.
  const elevation = new WindowsElevation();
  // Local host: spawns terminals at the daemon's own integrity (elevated when the
  // app was launched elevated). Admin ("run as admin") terminals use this.
  const localPty = new NodePtyHost();
  // De-elevated agent host (FR-025c mixed mode): an unchecked terminal on an
  // elevated daemon runs in a MEDIUM-integrity agent process that owns its own
  // ConPTY. The agent is launched de-elevated (shell-token CreateProcessWithTokenW)
  // when the daemon is elevated, else spawned normally (already medium).
  const agentEntry = fileURLToPath(new URL('./pty-agent-entry.js', import.meta.url));
  const deElevatedLauncher = new WindowsDeElevatedLauncher();
  const agentPipe = `\\\\.\\pipe\\throng.ptyagent.${process.pid}.${randomUUID().slice(0, 8)}`;
  const deElevatedPty = new PtyAgentHost(agentPipe, (pipe) => {
    if (elevation.isElevated() && deElevatedLauncher.isAvailable()) {
      deElevatedLauncher.launch(process.execPath, [agentEntry, pipe]);
    } else {
      spawn(process.execPath, [agentEntry, pipe], { stdio: 'ignore', windowsHide: true }).unref();
    }
  });
  // Test hook: force EVERY terminal through the agent so its plumbing is verifiable
  // at medium integrity (THRONG_FORCE_PTY_AGENT=1).
  const forceAgent = env.THRONG_FORCE_PTY_AGENT === '1';
  // Test seam (008 FR-005): delay a cold-start attach to exercise the "still starting"
  // retry. Zero in production (env unset).
  const attachColdStartDelayMs = numberFromEnv(env.THRONG_ATTACH_DELAY_MS, 0);
  const terminalService = new TerminalService(
    localPty,
    terminalEvents,
    lockManager,
    elevation,
    deElevatedPty,
    forceAgent,
    attachColdStartDelayMs,
    new WindowsProcessCwd(), // 012: poll each terminal's shell cwd for the panel title
  );
  container.bind<TerminalEvents>(DAEMON_TYPES.TerminalEvents).toConstantValue(terminalEvents);
  container.bind<TerminalLockManager>(DAEMON_TYPES.TerminalLockManager).toConstantValue(lockManager);
  container.bind<TerminalService>(DAEMON_TYPES.TerminalService).toConstantValue(terminalService);

  // JSON-RPC router with every method registered (health.ping + projects.* + workspace.* + terminal.*).
  const router = new RpcRouter();
  new HealthService(elevation).register(router);
  new ProjectIpcService(
    projectService,
    countLayout,
    (projectId) => terminalService.hasOpenTerminals(projectId),
    (projectId) => terminalService.killForProject(projectId),
  ).register(router);
  new WorkspaceIpcService({ workspaceStore, projectStore, userContext }).register(router);
  new SubWorkspaceIpcService({ store: subWorkspaceStore, userContext }).register(router);
  terminalService.register(router);
  container.bind<RpcRouter>(DAEMON_TYPES.RpcRouter).toConstantValue(router);

  container.bind<IpcServer>(DAEMON_TYPES.IpcServer).to(IpcServer);
  return container;
}
