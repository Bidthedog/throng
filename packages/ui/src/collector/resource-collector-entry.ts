/**
 * The resource collector process (055 research R1): forked by UI main over a Node IPC channel, it
 * measures throng and everything throng started, off every throng event loop. Its file name is the
 * marker the daemon's startup sweep recognises (`reap-orphans.ts`), so a collector orphaned by a
 * crashed UI main is reaped.
 *
 * It exits the moment its parent disconnects (contracts/collector-protocol.md, *Liveness*).
 */
import process from 'node:process';
import type { MainToCollector } from '@throng/ipc-contract';
import { ResourceCollector } from './collector.js';
import { composeCollector } from './composition-root.js';

if (typeof process.send !== 'function') {
  process.stderr.write('resource collector: must be started with an IPC channel\n');
  process.exit(1);
}

const { metrics, onTestMessage } = composeCollector(process.env);
const collector = new ResourceCollector({
  metrics,
  collectorPid: process.pid,
  send: (msg) => {
    if (process.connected) process.send!(msg);
  },
});

process.on('message', (raw) => {
  const msg = raw as MainToCollector | { type: string };
  if (msg.type.startsWith('test:')) onTestMessage?.(msg as { type: string });
  else collector.handle(msg as MainToCollector);
});
process.on('disconnect', () => {
  collector.stop();
  process.exit(0);
});

collector.start();
