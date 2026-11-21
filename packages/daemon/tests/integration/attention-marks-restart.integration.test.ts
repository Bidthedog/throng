import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createDefaultLayout, type AttentionLedgerEntry } from '@throng/core';
import { runMigrations, type ThrongDatabase } from '@throng/persistence';
import {
  PROJECTS_CREATE_METHOD,
  TERMINAL_ATTACH_METHOD,
  TERMINAL_ATTENTION_LEDGER_METHOD,
  TERMINAL_ATTENTION_SYNC_METHOD,
  WORKSPACE_SAVE_METHOD,
} from '@throng/ipc-contract';
import type { Container } from 'inversify';
import { createDaemonContainer, DAEMON_TYPES } from '../../src/composition-root.js';
import type { RpcRouter } from '../../src/rpc-router.js';
import type { TerminalService } from '../../src/terminal-service.js';
import { CMD } from './terminal-harness.js';

/*
 * #692 — attention marks vanish after a restart while their notifications remain.
 *
 * Main keeps its marks in the daemon's ledger (057 FR-091) and reads them back when it reconnects. The
 * Notifications panel's entries are main's own and are kept on disk (068 FR-031), so they come back from
 * any restart. The marks did not: the ledger lived in the daemon's memory, and a daemon that ends — the
 * machine powered off, an upgrade, Terminate all on close — ended its terminals, forgot each one's mark as
 * it ended, and took the rest with it. The next mark then dismissed every entry left without one (057
 * FR-025). The maintainer's expected outcome (#692): every mark shown before the restart is shown again.
 *
 * Layer: integration — two daemons in turn over one real SQLite file, through their own RPC routers, with
 * a real terminal running when the first shuts down. Nothing narrower holds the daemon's whole lifetime.
 */

let dir = '';
const live: { container: Container; db: ThrongDatabase }[] = [];

afterEach(async () => {
  for (const { container, db } of live.splice(0)) {
    await container.get<TerminalService>(DAEMON_TYPES.TerminalService).shutdown();
    if (db.open) db.close();
  }
  if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

function boot(): { container: Container; db: ThrongDatabase; call: (method: string, params?: unknown) => Promise<any> } {
  const env = { ...process.env, THRONG_DATABASE_PATH: join(dir, 'throng.db'), THRONG_PIPE_NAME: `throng-692-${process.pid}-${live.length}` };
  // A quiet log: run from source, the PTY agent the container spawns at boot has no built entry to start, and
  // says so. The terminal below runs on the local PTY, which is what a non-elevated daemon uses.
  const container = createDaemonContainer(env, () => {});
  const db = container.get<ThrongDatabase>(DAEMON_TYPES.Database);
  runMigrations(db);
  live.push({ container, db });
  const router = container.get<RpcRouter>(DAEMON_TYPES.RpcRouter);
  let id = 0;
  const call = async (method: string, params: unknown = {}): Promise<any> => {
    const reply = (await router.handle({ jsonrpc: '2.0', id: ++id, method, params })) as { result?: unknown; error?: { message: string } };
    if (reply.error) throw new Error(`${method}: ${reply.error.message}`);
    return reply.result;
  };
  return { container, db, call };
}

async function stop(daemon: { container: Container; db: ThrongDatabase }): Promise<void> {
  await daemon.container.get<TerminalService>(DAEMON_TYPES.TerminalService).shutdown();
  daemon.db.close();
  live.splice(live.findIndex((d) => d.container === daemon.container), 1);
}

describe('attention marks across a daemon restart (#692)', () => {
  it('main reads back, from a new daemon, the marks it held when the old one ended its terminals and stopped', async () => {
    dir = mkdtempSync(join(tmpdir(), 'throng-692-'));
    const root = join(dir, 'proj');
    mkdirSync(root);

    const first = boot();
    const { project } = await first.call(PROJECTS_CREATE_METHOD, { name: 'Proj', colour: '#6aa3ff', rootFolder: root });
    const layout = createDefaultLayout(project.id, { tab: 't1', panel: 'p1' });
    await first.call(WORKSPACE_SAVE_METHOD, { projectId: project.id, layout });
    // A real terminal behind the marked panel, so the shutdown ends it as a power-off or an upgrade does.
    await first.call(TERMINAL_ATTACH_METHOD, { panelId: 'p1', projectId: project.id, launch: { file: CMD, args: [], cwd: root }, cols: 80, rows: 24 });
    const mark: AttentionLedgerEntry = {
      panelId: 'p1',
      projectId: project.id,
      kind: 'attention',
      reason: { signal: 'bell', detail: null },
      raisedAt: 1_700_000_000_000,
      panelTitle: 'Bash',
      projectName: 'Proj',
      tabTitle: 'Tab 1',
      whileDetached: false,
    };
    // Main's marks, as its debounced sync and its quit flush send them (FR-091).
    await first.call(TERMINAL_ATTENTION_SYNC_METHOD, { entries: [mark] });
    await stop(first);

    const second = boot();
    const { entries } = (await second.call(TERMINAL_ATTENTION_LEDGER_METHOD)) as { entries: AttentionLedgerEntry[] };
    expect(entries.map((e) => ({ panelId: e.panelId, kind: e.kind, signal: e.reason.signal, raisedAt: e.raisedAt }))).toEqual([
      { panelId: 'p1', kind: 'attention', signal: 'bell', raisedAt: 1_700_000_000_000 },
    ]);
  }, 60_000);
});
