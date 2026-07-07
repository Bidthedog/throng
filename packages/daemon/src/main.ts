import 'reflect-metadata';
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
async function main(): Promise<void> {
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
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((error: unknown) => {
  console.error('[throng-daemon] fatal startup error:', error);
  process.exit(1);
});
