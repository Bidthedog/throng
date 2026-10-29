/**
 * Layer: integration — only a real ETW session shows the trace counts what Windows' TCP/IP stack moved
 * (055 FR-113, SC-011, research R20). A known 20 MB crosses loopback between two child processes, and each
 * side's bytes must be counted within 10%. The session needs elevation: unelevated, the test asserts the
 * reason instead.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { describe, it, expect } from 'vitest';
import { NETWORK_ELEVATION_REQUIRED } from '@throng/core';
import { WindowsElevation } from '../../src/windows-elevation.js';
import { WindowsNetworkTrace } from '../../src/windows-network-trace.js';

const TRANSFER = 20 * 1024 * 1024;
const elevated = new WindowsElevation().isElevated();

const RECEIVER = `
const net = require('node:net');
const server = net.createServer((s) => { s.on('data', () => {}); s.on('end', () => { server.close(); }); });
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\\n'));
`;
const SENDER = `
const net = require('node:net');
const s = net.connect(Number(process.argv[1]), '127.0.0.1', () => s.end(Buffer.alloc(${TRANSFER}, 7)));
`;

const node = (source: string, ...args: string[]): ChildProcess =>
  spawn(process.execPath, ['-e', source, ...args], { stdio: ['ignore', 'pipe', 'inherit'] });

async function sessionNames(): Promise<string> {
  const child = spawn('logman', ['query', '-ets'], { stdio: ['ignore', 'pipe', 'ignore'] });
  let out = '';
  child.stdout!.on('data', (d: Buffer) => (out += d.toString()));
  await once(child, 'exit');
  return out;
}

describe('WindowsNetworkTrace (055 FR-113, SC-011, R20)', () => {
  it.skipIf(elevated)('says elevation is required when throng is not elevated', async () => {
    expect(await WindowsNetworkTrace.start()).toEqual({ kind: 'unavailable', reason: NETWORK_ELEVATION_REQUIRED });
  });

  it.skipIf(!elevated)(
    'counts a known loopback transfer for both processes within 10%, and leaves no session behind',
    async () => {
      const trace = await WindowsNetworkTrace.start();
      if (!(trace instanceof WindowsNetworkTrace)) throw new Error(`trace did not start: ${JSON.stringify(trace)}`);
      try {
        await new Promise((r) => setTimeout(r, 1_000));
        trace.takeBytes();
        const receiver = node(RECEIVER);
        const [port] = (await once(receiver.stdout!, 'data')) as [Buffer];
        const sender = node(SENDER, port.toString().trim());
        await Promise.all([once(sender, 'exit'), once(receiver, 'exit')]);
        // Real-time buffers are delivered at least every second.
        await new Promise((r) => setTimeout(r, 3_000));
        const bytes = trace.takeBytes();
        const sent = bytes.get(sender.pid!) ?? 0;
        const received = bytes.get(receiver.pid!) ?? 0;
        expect(Math.abs(sent - TRANSFER) / TRANSFER).toBeLessThan(0.1);
        expect(Math.abs(received - TRANSFER) / TRANSFER).toBeLessThan(0.1);
      } finally {
        await trace.dispose();
      }
      expect(await sessionNames()).not.toContain(`throng-net-${process.pid}`);
    },
    30_000,
  );
});
