/**
 * Microsoft-Windows-Kernel-Network's send and receive events (055 FR-113, research R20). Every one of them
 * opens its payload with `PID` (UInt32) then `size` (UInt32); the addresses after them differ in width
 * between IPv4 and IPv6 and are not read.
 */
const SEND_RECEIVE_EVENT_IDS: ReadonlySet<number> = new Set([
  10, // TCP send, IPv4
  11, // TCP receive, IPv4
  26, // TCP send, IPv6
  27, // TCP receive, IPv6
  42, // UDP send, IPv4
  43, // UDP receive, IPv4
  58, // UDP send, IPv6
  59, // UDP receive, IPv6
]);

/** The pid and byte count of a send or receive event; `null` for any other event. */
export function parseKernelNetworkEvent(eventId: number, userData: Buffer): { pid: number; bytes: number } | null {
  if (!SEND_RECEIVE_EVENT_IDS.has(eventId) || userData.length < 8) return null;
  return { pid: userData.readUInt32LE(0), bytes: userData.readUInt32LE(4) };
}

/** Bytes per pid since the last {@link take}, fed by the trace's callback. */
export class NetworkByteCounter {
  private counts = new Map<number, number>();

  add(pid: number, bytes: number): void {
    this.counts.set(pid, (this.counts.get(pid) ?? 0) + bytes);
  }

  take(): Map<number, number> {
    const out = this.counts;
    this.counts = new Map();
    return out;
  }

  /** Bytes per second over `elapsedMs`; nothing when no time has passed. */
  static toRates(counts: ReadonlyMap<number, number>, elapsedMs: number): Map<number, number> {
    const out = new Map<number, number>();
    if (elapsedMs <= 0) return out;
    for (const [pid, bytes] of counts) out.set(pid, (bytes / elapsedMs) * 1_000);
    return out;
  }
}
