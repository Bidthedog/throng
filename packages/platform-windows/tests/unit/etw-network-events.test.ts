import { describe, expect, it } from 'vitest';
import { NetworkByteCounter, parseKernelNetworkEvent } from '../../src/etw-network-events.js';

/**
 * 055 FR-113, research R20. Microsoft-Windows-Kernel-Network's send and receive events all open their
 * payload with the same two fields — `PID` (UInt32) then `size` (UInt32) — before the addresses, whose
 * width differs between IPv4 and IPv6.
 */

const payload = (pid: number, size: number, tail = 24): Buffer => {
  const b = Buffer.alloc(8 + tail);
  b.writeUInt32LE(pid, 0);
  b.writeUInt32LE(size, 4);
  return b;
};

describe('parseKernelNetworkEvent (FR-113, R20)', () => {
  it.each([
    [10, 'TCP send, IPv4'],
    [11, 'TCP receive, IPv4'],
    [26, 'TCP send, IPv6'],
    [27, 'TCP receive, IPv6'],
    [42, 'UDP send, IPv4'],
    [43, 'UDP receive, IPv4'],
    [58, 'UDP send, IPv6'],
    [59, 'UDP receive, IPv6'],
  ])('reads pid and bytes from event %i (%s)', (id) => {
    expect(parseKernelNetworkEvent(id, payload(4242, 1_500))).toEqual({ pid: 4242, bytes: 1_500 });
  });

  it('ignores every other event: connects, disconnects, retransmits, copies', () => {
    for (const id of [12, 13, 14, 15, 16, 17, 18, 28, 29, 30]) expect(parseKernelNetworkEvent(id, payload(1, 99))).toBeNull();
  });

  it('ignores a payload too short to hold the pid and size', () => {
    expect(parseKernelNetworkEvent(10, Buffer.alloc(7))).toBeNull();
  });
});

describe('NetworkByteCounter (FR-113)', () => {
  it('sums bytes per pid and hands them over once, resetting', () => {
    const c = new NetworkByteCounter();
    c.add(1, 100);
    c.add(2, 50);
    c.add(1, 25);
    expect(c.take()).toEqual(new Map([[1, 125], [2, 50]]));
    expect(c.take()).toEqual(new Map());
  });

  it('converts a taken count to bytes per second over the elapsed time', () => {
    const c = new NetworkByteCounter();
    c.add(7, 4_000);
    expect(NetworkByteCounter.toRates(c.take(), 2_000)).toEqual(new Map([[7, 2_000]]));
    expect(NetworkByteCounter.toRates(new Map([[7, 1]]), 0)).toEqual(new Map());
  });
});
