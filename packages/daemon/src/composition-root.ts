import 'reflect-metadata';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { Container } from 'inversify';
import type {
  Anonymiser,
  IDaemonSettings,
  IPersistenceSettings,
  IPlatformInfo,
  IProjectCategoryStore,
  IProjectStore,
  IUserContext,
  LogLevel,
} from '@throng/core';
import {
  DEFAULT_APP_SETTINGS,
  TERMINAL_END_TIMEOUT_MS,
  ProjectCategoryService,
  ProjectService,
  collectPanels,
  countPanels,
  defaultPipeName,
  logCaught,
  logExpected,
  panelDisplayTitle,
  parseSettingsGuarded,
  type Tab,
} from '@throng/core';
import { NodeUserContext, startPlatform } from '@throng/platform';
import { STDERR_TAIL_CHARS, watchChild } from '@throng/platform-node';
import {
  openDatabase,
  ProjectRepository,
  ProjectCategoryRepository,
  WorkspaceRepository,
  SubWorkspaceRepository,
  DocumentStateRepository,
  FileOpUndoRepository,
  AttentionFlagRepository,
  type ThrongDatabase,
} from '@throng/persistence';
import { DAEMON_TYPES } from './tokens.js';
import { IpcServer } from './ipc-server.js';
import { RpcRouter } from './rpc-router.js';
import { ResourceRosterService } from './resource-roster-service.js';
import { HealthService } from './health-service.js';
import { ProjectIpcService } from './project-service.js';
import { WorkspaceIpcService } from './workspace-service.js';
import { SubWorkspaceIpcService } from './subworkspace-service.js';
import { DocumentIpcService } from './document-service.js';
import { FileOpUndoIpcService } from './fileop-undo-service.js';
import { AttentionFlagIpcService } from './attention-flag-service.js';
import { livePanelIds } from './live-panels.js';
import { PanelNameIpcService } from './panel-name-service.js';
import { TerminalEvents } from './terminal-events.js';
import { TerminalLockManager } from './terminal-lock-manager.js';
import { TerminalService } from './terminal-service.js';
import { ClaudeSessionResolver, claudeConfigDir } from './claude-session-resolver.js';
import { DEFAULT_AGENT_BUDGETS, PtyAgentHost, logToConsole } from './pty-agent-host.js';
import { encodeAgentLogDir } from './pty-agent-log.js';

export { DAEMON_TYPES } from './tokens.js';

/**
 * Composition root #1 (Principle IX / [Gap B]): the daemon process's single
 * IoC container. Configuration is read here only (Principle X / [Gap C]) from
 * documented defaults, overridable via environment. This is the one place that
 * selects OS implementations (Principle II) and assembles the object graph —
 * including registering every JSON-RPC method into the router.
 */
/**
 * Last-resort pipe name when neither `THRONG_PIPE_NAME` nor a per-user default is supplied
 * (020 FR-013). Production passes a per-user derived default (`defaultPipeName`); this only
 * guards a direct `readDaemonSettings` call that omits the fallback.
 */
const DEFAULT_PIPE_NAME = '\\\\.\\pipe\\throng.daemon';

function numberFromEnv(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** The installed location: a daemon started by hand, with no UI to name a data folder (FR-013). */
function defaultDatabasePath(dataDir: string): string {
  return join(dataDir, 'throng.db');
}

function readDaemonSettings(
  env: NodeJS.ProcessEnv,
  fallbackPipeName: string = DEFAULT_PIPE_NAME,
): IDaemonSettings {
  return {
    pipeName: env.THRONG_PIPE_NAME ?? fallbackPipeName,
    agentConnectTimeoutMs: numberFromEnv(
      env.THRONG_AGENT_CONNECT_TIMEOUT_MS,
      DEFAULT_AGENT_BUDGETS.connectMs,
    ),
    agentReadyTimeoutMs: numberFromEnv(env.THRONG_AGENT_READY_TIMEOUT_MS, DEFAULT_AGENT_BUDGETS.readyMs),
  };
}

function readPersistenceSettings(env: NodeJS.ProcessEnv, dataDir: string): IPersistenceSettings {
  return {
    databasePath: env.THRONG_DATABASE_PATH ?? defaultDatabasePath(dataDir),
  };
}

/**
 * 025 FR-019c — how often the shared command observation runs.
 *
 * Read from the user's `settings.json` at daemon startup and injected, rather than hardcoded:
 * a setting nothing reads is an inert setting, which the constitution forbids (Principle X).
 * The daemon has no config-store binding, so this reads the one value it needs directly and
 * falls back to the shipped default on any problem — a malformed settings file must never stop
 * terminals from working.
 *
 * 031 T035 (#227, FR-013b) — it CORRECTS but never WRITES, and that asymmetry is deliberate.
 * Correction has to happen in every process, or the daemon would poll at whatever a hand-edited
 * file said while the UI used the corrected value. Write-back happens in UI-main ALONE: two
 * processes writing one config file is how a config file gets truncated, and the daemon has no
 * business editing a document the user owns. Exported so that is a testable claim rather than
 * a comment.
 */
export function readCommandPollMs(env: NodeJS.ProcessEnv, installedConfigRoot?: string): number {
  // The config root is `%USERPROFILE%\.throng[-dev]`, NOT `%APPDATA%	hrong` — that is the
  // userData/database directory and has never held a settings.json. UI-main passes the resolved
  // root as THRONG_CONFIG_ROOT precisely because the daemon cannot work out dev-vs-prod itself.
  // The homedir fallback keeps a daemon started without the UI reading the packaged location
  // rather than nothing at all.
  const root = env.THRONG_CONFIG_ROOT ?? installedConfigRoot ?? join(homedir(), '.throng');
  const settingsPath = join(root, 'settings.json');
  try {
    const raw: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
    return parseSettingsGuarded(raw).value.terminals.commandPollMs;
  } catch (error) {
    logExpected(
      'composition-root: read terminals.commandPollMs',
      'settings.json may not exist yet or may be hand-edited into invalid JSON; the default poll interval applies and UI main reports the file',
      error,
    );
    return DEFAULT_APP_SETTINGS.terminals.commandPollMs;
  }
}

/** 068: the bound on reading Claude Code's session record, so an observation is never held up by it. */
const CLAUDE_SESSION_READ_LIMIT_MS = 750;

/** Where the daemon's own failures are recorded — its file log when it has one (066 FR-005). */
export type DaemonLog = (level: LogLevel, message: string) => void;

/** 068 FR-034a: the daemon's anonymiser and the salt that keys it, passed on to the PTY agent. */
export interface DaemonAnonymity {
  readonly anonymiser: Anonymiser;
  readonly salt: string;
}

export function createDaemonContainer(
  env: NodeJS.ProcessEnv = process.env,
  log?: DaemonLog,
  anonymity?: DaemonAnonymity,
): Container {
  const container = new Container({ defaultScope: 'Singleton' });
  const platform = startPlatform();
  const directories = platform.userDirectories();

  // OS abstractions (Principle II) — the only place that selects implementations. The user
  // context is resolved first so the per-user pipe default (below) can derive from its token.
  container.bind<IPlatformInfo>(DAEMON_TYPES.PlatformInfo).toConstantValue(platform.platformInfo());
  const userContext = new NodeUserContext();
  container.bind<IUserContext>(DAEMON_TYPES.UserContext).toConstantValue(userContext);

  // Per-user default pipe (020 FR-013): derived from the injected user token so the daemon and
  // UI rendezvous on a per-user endpoint with no machine-wide collision. THRONG_PIPE_NAME overrides.
  const daemonDefaultPipe = defaultPipeName(userContext.currentUser().userId);
  container
    .bind<IDaemonSettings>(DAEMON_TYPES.DaemonSettings)
    .toConstantValue(readDaemonSettings(env, daemonDefaultPipe));
  container
    .bind<IPersistenceSettings>(DAEMON_TYPES.PersistenceSettings)
    .toConstantValue(readPersistenceSettings(env, directories.dataDir(false)));

  // Durable store (opened once; migrations run by main on startup).
  const persistenceSettings = container.get<IPersistenceSettings>(DAEMON_TYPES.PersistenceSettings);
  const database = openDatabase(persistenceSettings);
  container.bind<ThrongDatabase>(DAEMON_TYPES.Database).toConstantValue(database);

  // Project domain: repository (port impl) → pure core service.
  const projectStore = new ProjectRepository(database);
  container.bind<IProjectStore>(DAEMON_TYPES.ProjectStore).toConstantValue(projectStore);
  // Project categories (046): the store is shared, so a new project lands in the default category
  // the category service lists.
  const categoryStore = new ProjectCategoryRepository(database);
  container
    .bind<IProjectCategoryStore>(DAEMON_TYPES.ProjectCategoryStore)
    .toConstantValue(categoryStore);
  const newId = (): string => randomUUID();
  const now = (): string => new Date().toISOString();
  const projectService = new ProjectService({
    store: projectStore,
    categories: categoryStore,
    userContext,
    newId,
    now,
    // 068 FR-034a: the log names a project by its internal id, so each root and name read is taught.
    onProjectsKnown: anonymity
      ? (known) => {
          for (const p of known) {
            anonymity.anonymiser.register('projectRoot', p.rootFolder, p.id);
            if (p.name) anonymity.anonymiser.register('projectName', p.name, p.id);
          }
        }
      : undefined,
  });
  const categoryService = new ProjectCategoryService({
    store: categoryStore,
    projectStore,
    userContext,
    newId,
    now,
  });
  container
    .bind<ProjectCategoryService>(DAEMON_TYPES.ProjectCategoryService)
    .toConstantValue(categoryService);

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
  const lockManager = new TerminalLockManager(
    platform.directoryLock(),
    (projectId) => projectStore.getById(userContext.currentUser().userId, projectId)?.rootFolder ?? null,
  );
  // One elevation probe shared by the service (capabilities) and the routing.
  const elevation = platform.elevation();
  // Probed NOW, while composing, rather than on the first terminal start: the probe is a synchronous
  // `whoami`, allowed only before the service serves (051 FR-017), and the answer is cached after.
  elevation.isElevated();
  // Local host: spawns terminals at the daemon's own integrity (elevated when the
  // app was launched elevated). Admin ("run as admin") terminals use this.
  const localPty = platform.ptyHost();
  // De-elevated agent host (FR-025c mixed mode): an unchecked terminal on an
  // elevated daemon runs in a MEDIUM-integrity agent process that owns its own
  // ConPTY. The agent is launched de-elevated (shell-token CreateProcessWithTokenW)
  // when the daemon is elevated, else spawned normally (already medium).
  const agentEntry = fileURLToPath(new URL('./pty-agent-entry.js', import.meta.url));
  const deElevatedLauncher = platform.deElevatedLauncher();
  const agentPipe = `\\\\.\\pipe\\throng.ptyagent.${process.pid}.${randomUUID().slice(0, 8)}`;
  // `report` arrives as a PARAMETER of this callback rather than closing over
  // `deElevatedPty`: the host's constructor invokes `launch` synchronously, before the
  // const is assigned — a closure reference would be a temporal dead zone.
  const daemonSettings = container.get<IDaemonSettings>(DAEMON_TYPES.DaemonSettings);
  // 066 FR-017: the agent's log folder travels as its second argument, because the de-elevated launch
  // drops the environment `THRONG_LOG_DIR` would arrive in. A folder under `%APPDATA%` goes relative to
  // it, so an agent running as another user writes to that user's throng folder (contract *PTY agent*).
  // 068: the anonymiser's salt follows as a third argument for the same reason (research D10).
  const agentSalt = anonymity?.salt ?? env.THRONG_LOG_SALT;
  const agentLogArgs = env.THRONG_LOG_DIR
    ? [encodeAgentLogDir(env.THRONG_LOG_DIR, env.APPDATA), ...(agentSalt ? [agentSalt] : [])]
    : [];
  const agentLog: DaemonLog = log ?? logToConsole;
  const deElevatedPty: PtyAgentHost = new PtyAgentHost(
    agentPipe,
    (pipe, report) => {
      const agentArgs = [agentEntry, pipe, ...agentLogArgs];
      if (elevation.isElevated() && deElevatedLauncher.isAvailable()) {
        deElevatedLauncher.launch(process.execPath, agentArgs, report);
      } else {
        // Already medium: a plain spawn. Its stderr is piped for the same reason the
        // de-elevated shim's is — a launch that fails must be able to say why (FR-015).
        const child = spawn(process.execPath, agentArgs, {
          stdio: ['ignore', 'ignore', 'pipe'],
          windowsHide: true,
        });
        // 066 FR-005: the agent is long-lived — any exit the daemon did not ask for is recorded with its
        // stderr tail. Read at exit time, so `deElevatedPty` is assigned by then.
        watchChild(child, {
          name: 'pty-agent',
          log: agentLog,
          longLived: true,
          expectedExit: () => (deElevatedPty.disposed ? 'the daemon closed the agent on shutdown' : undefined),
        });
        let stderr = '';
        // Observe the failure without holding the daemon's loop open: the agent outlives
        // this call by design. (Piped stderr is a net.Socket; the type is the narrower Readable.)
        (child.stderr as unknown as { unref?(): void } | null)?.unref?.();
        child.stderr?.setEncoding('utf8');
        child.stderr?.on('data', (chunk: string) => {
          stderr = (stderr + chunk).slice(-STDERR_TAIL_CHARS); // FR-014: a tail, never the whole stream
        });
        // watchChild above has recorded each of these; the reason goes to the host for the panel only.
        child.on('error', (error: Error) => report(error.message, true));
        child.on('exit', (code) => {
          if (code !== 0) report(stderr.trim() || `exit ${code}`, true);
        });
        child.unref();
      }
    },
    { connectMs: daemonSettings.agentConnectTimeoutMs, readyMs: daemonSettings.agentReadyTimeoutMs },
    agentLog,
  );
  // Test hook: force EVERY terminal through the agent so its plumbing is verifiable
  // at medium integrity (THRONG_FORCE_PTY_AGENT=1).
  const forceAgent = env.THRONG_FORCE_PTY_AGENT === '1';
  // Test seam (008 FR-005): delay a cold-start attach to exercise the "still starting"
  // retry. Zero in production (env unset).
  const attachColdStartDelayMs = numberFromEnv(env.THRONG_ATTACH_DELAY_MS, 0);
  // #541 — every panel a saved layout or sub-workspace holds, so a mark stranded by a destroy is not
  // restored when main reads the stored flags and the ledger back. Null (prune nothing) when unknown.
  const livePanels = (): ReadonlySet<string> | null => {
    try {
      const owner = userContext.currentUser().userId;
      return livePanelIds({
        projectIds: () => projectStore.list(owner).map((p) => p.id),
        layout: (projectId) => workspaceStore.load(owner, projectId),
        subWorkspaces: (onCorrupt) => workspaceStore.loadSubWorkspaces(owner, onCorrupt),
      });
    } catch (error) {
      logCaught('composition-root: list live panels', error); // unknown: prune nothing, restore everything
      return null;
    }
  };
  const terminalService = new TerminalService(
    localPty,
    terminalEvents,
    lockManager,
    elevation,
    deElevatedPty,
    forceAgent,
    attachColdStartDelayMs,
    platform.processCwd(), // 012: poll each terminal's shell cwd for the panel title
    readCommandPollMs(env, directories.configRoot(false)), // 025 FR-019c: the shared command-observation interval
    TERMINAL_END_TIMEOUT_MS, // 051 FR-013a: the one limit every end and the shutdown wait read
    {
      livePanels,
      // 057 FR-015/FR-033: the daemon holds every layout and project, so it names the panel and project.
      resolveNames: (panelId, projectId, liveTitle) => {
        const owner = userContext.currentUser().userId;
        const projectName = projectStore.getById(owner, projectId)?.name ?? '';
        // FR-100: the tab holding the panel is named with it — in the project's layout, else (loaded only on
        // a miss, as before) a sub-workspace's.
        const find = (tabs: readonly Tab[]) => {
          for (const tab of tabs) {
            const panel = collectPanels(tab.root).find((candidate) => candidate.id === panelId);
            // FR-116: the live window title is one of the header's sources, so the name matches the header.
            if (panel) {
              const panelTitle = panelDisplayTitle(panel, liveTitle === null ? {} : { terminalTitle: liveTitle });
              return { panelTitle, projectName, tabTitle: tab.title };
            }
          }
          return null;
        };
        return (
          find(workspaceStore.load(owner, projectId).layout.tabs) ??
          find(workspaceStore.loadSubWorkspaces(owner).flatMap((sub) => sub.tabs)) ?? { panelTitle: 'Terminal', projectName, tabTitle: '' }
        );
      },
    },
    // 068 FR-043: Claude Code's session record for the foreground process; read-only, time-bounded.
    new ClaudeSessionResolver({
      configDir: claudeConfigDir(env),
      os: platform.platformInfo().osName() === 'windows' ? 'windows' : 'linux',
      identity: platform.processIdentity(),
      timeoutMs: CLAUDE_SESSION_READ_LIMIT_MS,
    }),
  );
  container.bind<TerminalEvents>(DAEMON_TYPES.TerminalEvents).toConstantValue(terminalEvents);
  container.bind<TerminalLockManager>(DAEMON_TYPES.TerminalLockManager).toConstantValue(lockManager);
  container.bind<TerminalService>(DAEMON_TYPES.TerminalService).toConstantValue(terminalService);

  // JSON-RPC router with every method registered (health.ping + projects.* + workspace.* + terminal.*).
  const router = new RpcRouter();
  const attentionFlags = new AttentionFlagRepository(database);
  new HealthService(elevation).register(router);
  new ProjectIpcService(
    projectService,
    countLayout,
    (projectId) => terminalService.hasOpenTerminals(projectId),
    (projectId) => terminalService.killForProject(projectId),
    categoryService,
    (projectId) => attentionFlags.clearProject(projectId),
  ).register(router);
  // attention.flag* (057 round 12, FR-125 / FR-128) — the user's manual flags, which outlive the app.
  new AttentionFlagIpcService(attentionFlags, livePanels).register(router);
  new WorkspaceIpcService({ workspaceStore, projectStore, userContext }).register(router);
  new SubWorkspaceIpcService({ store: subWorkspaceStore, workspaceStore, userContext }).register(router);
  // document.* (016) — the per-document language override. Keyed by the FILE, so a panel opening
  // it later adopts the user's choice rather than re-detecting.
  new DocumentIpcService(
    new DocumentStateRepository(database),
    userContext,
    (ownerUser, projectId) => projectStore.getById(ownerUser, projectId)?.rootFolder ?? null,
  ).register(router);
  // fileopUndo.* (024 US3, #85) — the per-project file-operation undo/redo stack, so an undo
  // survives a restart rather than being one session's private memory.
  new FileOpUndoIpcService(new FileOpUndoRepository(database), userContext).register(router);
  // panelName.* (024 follow-up) — the only component that can see every panel in every project and
  // sub-workspace, and therefore the only one that can keep their names unique.
  new PanelNameIpcService({ projectStore, workspaceStore, userContext }).register(router);
  terminalService.register(router);
  // 055 R5 — the resource monitor's roster: a read of what the terminal layer already holds.
  new ResourceRosterService(terminalService, lockManager, () => deElevatedPty.agentPid()).register(router);
  container.bind<RpcRouter>(DAEMON_TYPES.RpcRouter).toConstantValue(router);

  container.bind<IpcServer>(DAEMON_TYPES.IpcServer).to(IpcServer);
  return container;
}
