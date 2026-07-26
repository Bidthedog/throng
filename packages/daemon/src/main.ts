import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseLogLevel } from '@throng/core';
import { createFileLog, writeCrashReport, type DiagnosticLog } from '@throng/platform-windows';
import type { IDaemonSettings, IPersistenceSettings, IPlatformInfo } from '@throng/core';
import { runMigrations, type ThrongDatabase } from '@throng/persistence';
import { createDaemonContainer, DAEMON_TYPES } from './composition-root.js';
import { IpcServer } from './ipc-server.js';
import { TerminalService } from './terminal-service.js';
import { reapOrphans } from './reap-orphans.js';

/**
 * Daemon entrypoint: compose the container, open + migrate the persistence
 * store on startup (T034 / FR-011), start the named-pipe IPC server, and
 * install a graceful shutdown handler that releases the pipe (FR-005; also
 * mitigates the pipe-name-in-use edge case).
 */
/**
 * Durable diagnostics for the daemon (#123).
 *
 * The daemon is spawned DETACHED by an app launched from a shortcut: it has no console, and until
 * now its `stdio` was `'ignore'` outright — every `console.log` below went to a stream that did not
 * exist. It is also the process most worth hearing from, because it is the one that outlives the
 * UI and owns the terminals.
 *
 * The log directory is INJECTED (`THRONG_LOG_DIR`, set by the UI that spawns it) rather than
 * derived here, so the daemon writes beside the UI whose instance it belongs to — dev beside dev,
 * installed beside installed — and a daemon started by hand simply logs nowhere rather than
 * guessing at somebody's data directory.
 */
function startDaemonDiagnostics(): DiagnosticLog | null {
  const dir = process.env.THRONG_LOG_DIR;
  if (!dir) return null;
  const log = createFileLog({
    dir,
    fileName: 'daemon.log',
    component: 'daemon',
    level: parseLogLevel(process.env.THRONG_LOG_LEVEL),
    // Rotation/retention arrive with the level, from the same settings the UI is using — one
    // "Logging" section governs both halves of one application (Principle X).
    policy: {
      maxBytes: Number(process.env.THRONG_LOG_MAX_KB) * 1024 || undefined,
      keep: Number(process.env.THRONG_LOG_KEEP) || undefined,
    },
  });
  // Everything the daemon already prints becomes durable, without rewriting a single call site —
  // which is what the issue asks for: make existing diagnostics reachable, do not redesign them.
  log.attachConsole();
  return log;
}

/** The build this daemon was stamped with (`dist/BUILD_ID`), for its crash reports. */
function daemonBuildId(): string {
  try {
    return readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'BUILD_ID'), 'utf8').trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

async function main(): Promise<void> {
  const diagnostics = startDaemonDiagnostics();
  if (diagnostics) {
    diagnostics.info(`daemon starting — pid ${process.pid}, node ${process.version}`);
    const dir = process.env.THRONG_LOG_DIR as string;
    const buildId = daemonBuildId();
    // A daemon that dies takes every terminal it owns with it, and it dies unobserved by
    // definition — nobody is watching a detached background process. Both fatal paths are recorded.
    process.on('uncaughtException', (error: Error) => {
      writeCrashReport(dir, {
        component: 'daemon',
        at: new Date(),
        reason: 'uncaughtException',
        version: process.env.THRONG_VERSION ?? 'unknown',
        buildId,
        pid: process.pid,
        output: error.stack ?? String(error),
      });
      diagnostics.error(`FATAL uncaughtException: ${error.stack ?? String(error)}`);
      process.exit(1);
    });
    process.on('unhandledRejection', (reason: unknown) => {
      diagnostics.error(
        `unhandledRejection: ${reason instanceof Error ? (reason.stack ?? reason.message) : String(reason)}`,
      );
    });
  }

  const container = createDaemonContainer();

  const platform = container.get<IPlatformInfo>(DAEMON_TYPES.PlatformInfo);
  console.log(`[throng-daemon] platform: ${platform.osName()}`);

  // A fresh daemon means the previous one is gone (single-instance per pipe). Reap
  // any de-elevation agents, --headless conhosts or directory-lock holders it left
  // orphaned — the self-termination heartbeat is fooled by PID reuse, and a hard
  // kill skips cleanup (Constitution VII). Only touches processes whose parent is
  // already dead, so it never harms a concurrent live daemon.
  const reaped = reapOrphans();
  if (reaped.length > 0) {
    console.log(`[throng-daemon] reaped ${reaped.length} orphaned process(es): ${reaped.join(', ')}`);
  }

  const persistenceSettings = container.get<IPersistenceSettings>(
    DAEMON_TYPES.PersistenceSettings,
  );
  const database = container.get<ThrongDatabase>(DAEMON_TYPES.Database);
  const migration = runMigrations(database);
  console.log(
    `[throng-daemon] store ready at ${persistenceSettings.databasePath} (user_version ${migration.to})`,
  );
  if (migration.repairs.length > 0) {
    // Schema drift was healed (the store's user_version was ahead of its actual
    // columns — see schema-guard.ts). Surface it loudly: it indicates a DB left
    // half-migrated by an intermediate build.
    const summary = migration.repairs.map((r) => `${r.table}.${r.column}`).join(', ');
    console.warn(`[throng-daemon] schema-guard healed ${migration.repairs.length} drifted column(s): ${summary}`);
  }

  const daemonSettings = container.get<IDaemonSettings>(DAEMON_TYPES.DaemonSettings);
  const server = container.get<IpcServer>(DAEMON_TYPES.IpcServer);
  await server.start();
  console.log(
    `[throng-daemon] listening on ${daemonSettings.pipeName}; pid ${process.pid}`,
  );

  // EXTENSION POINT (FR-007): the daemon will own the terminal layer (detached
  // PTYs, tagging, persistence, reattachment) and the project/change-review
  // services above it — composed in this container. None exist in the bootstrap.

  const terminals = container.get<TerminalService>(DAEMON_TYPES.TerminalService);

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[throng-daemon] ${signal} received — shutting down`);
    // Kill live terminals FIRST so exiting the daemon never orphans their conhost.exe
    // hosts (or a de-elevated agent). Synchronous; done before the process exits.
    try {
      terminals.shutdown();
    } catch (error) {
      console.warn('[throng-daemon] terminal shutdown error:', error);
    }
    await server.stop();
    database.close();
    // The counterpart of the startup line: a log that simply STOPS cannot be told from a daemon
    // that was killed, and those two need very different investigations.
    diagnostics?.info(`daemon stopped cleanly after ${signal}`);
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[throng-daemon] fatal startup error:', error);
  process.exit(1);
});
