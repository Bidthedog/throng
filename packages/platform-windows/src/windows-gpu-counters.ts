import { createRequire } from 'node:module';
import process from 'node:process';
import type { Unavailable } from '@throng/core';
import type { GpuReader } from './windows-process-metrics.js';

/**
 * GPU use per process from the PDH counter `\GPU Engine(*)\Utilization Percentage` (055 research R4)
 * — the counter Task Manager's GPU column reads. One query stays open for the collector's life; each
 * `read()` collects it once (a rate counter: the first read has nothing to compare and returns an
 * empty map). A process's figure is its LARGEST per-engine-type sum, as Task Manager shows it.
 * Every call runs through koffi's `.async`, off the caller's loop.
 */
const require = createRequire(import.meta.url);

const COUNTER = '\\GPU Engine(*)\\Utilization Percentage';
const PDH_FMT_DOUBLE = 0x200;
const PDH_MORE_DATA = 0x800007d2;
const PDH_CSTATUS_VALID_DATA = 0;
const PDH_CSTATUS_NEW_DATA = 1;
/** PDH_FMT_COUNTERVALUE_ITEM_W on x64: name pointer, then {CStatus, pad, double}. */
const ITEM_SIZE = 24;

export interface GpuCountersFfi {
  openQuery(handle: unknown[]): Promise<number>;
  addCounter(query: unknown, path: string, counter: unknown[]): Promise<number>;
  collect(query: unknown): Promise<number>;
  formattedArray(counter: unknown, size: number[], count: number[], buf: Buffer | null): Promise<number>;
  addressOf(buf: Buffer): bigint;
}

type KoffiFn = { async: (...args: unknown[]) => void };
function callAsync<T>(fn: KoffiFn, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) =>
    fn.async(...args, (error: unknown, result: T) => (error ? reject(error) : resolve(result))),
  );
}

let ffi: GpuCountersFfi | null | undefined;
function loadFfi(): GpuCountersFfi | null {
  if (ffi !== undefined) return ffi;
  try {
    const koffi = require('koffi');
    const pdh = koffi.load('pdh.dll');
    const PdhOpenQueryW = pdh.func('PdhOpenQueryW', 'uint32', ['void *', 'uintptr_t', '_Out_ void **']);
    const PdhAddEnglishCounterW = pdh.func('PdhAddEnglishCounterW', 'uint32', ['void *', 'str16', 'uintptr_t', '_Out_ void **']);
    const PdhCollectQueryData = pdh.func('PdhCollectQueryData', 'uint32', ['void *']);
    const PdhGetFormattedCounterArrayW = pdh.func('PdhGetFormattedCounterArrayW', 'uint32', ['void *', 'uint32', '_Inout_ uint32 *', '_Out_ uint32 *', 'void *']);
    ffi = {
      openQuery: (h) => callAsync(PdhOpenQueryW, null, 0, h),
      addCounter: (q, path, c) => callAsync(PdhAddEnglishCounterW, q, path, 0, c),
      collect: (q) => callAsync(PdhCollectQueryData, q),
      formattedArray: (c, size, count, buf) => callAsync(PdhGetFormattedCounterArrayW, c, PDH_FMT_DOUBLE, size, count, buf),
      addressOf: (buf) => koffi.address(buf) as bigint,
    };
  } catch {
    ffi = null;
  }
  return ffi;
}

const unavailable = (reason: string): Unavailable => ({ kind: 'unavailable', reason });

/** GPU % per pid from formatted counter items: per pid, sum each engine type, keep the largest. */
export function gpuByPid(items: readonly { readonly name: string; readonly value: number }[]): Map<number, number> {
  const sums = new Map<string, number>();
  for (const { name, value } of items) {
    const m = /^pid_(\d+)_.*_engtype_(.+)$/.exec(name);
    if (m === null || !Number.isFinite(value)) continue;
    const key = `${m[1]} ${m[2]}`;
    sums.set(key, (sums.get(key) ?? 0) + value);
  }
  const out = new Map<number, number>();
  for (const [key, sum] of sums) {
    const pid = Number(key.slice(0, key.indexOf(' ')));
    out.set(pid, Math.max(out.get(pid) ?? 0, Math.min(100, sum)));
  }
  return out;
}

/** The items of a PDH_FMT_COUNTERVALUE_ITEM_W array; names point into the same buffer. */
export function parseItems(buf: Buffer, count: number, base: bigint): { name: string; value: number }[] {
  const out: { name: string; value: number }[] = [];
  for (let i = 0; i < count; i++) {
    const off = i * ITEM_SIZE;
    const status = buf.readUInt32LE(off + 8);
    if (status !== PDH_CSTATUS_VALID_DATA && status !== PDH_CSTATUS_NEW_DATA) continue;
    const rel = Number(buf.readBigUInt64LE(off) - base);
    if (rel < 0 || rel >= buf.length) continue;
    let end = rel;
    while (end + 1 < buf.length && buf.readUInt16LE(end) !== 0) end += 2;
    out.push({ name: buf.toString('utf16le', rel, end), value: buf.readDoubleLE(off + 16) });
  }
  return out;
}

export class WindowsGpuCounters implements GpuReader {
  private query: unknown = null;
  private counter: unknown = null;
  private failure: string | null = null;

  constructor(private readonly api: GpuCountersFfi | null | undefined = undefined) {}

  private ffi(): GpuCountersFfi | null {
    if (this.api !== undefined) return this.api;
    return process.arch === 'x64' ? loadFfi() : null;
  }

  async read(): Promise<ReadonlyMap<number, number> | Unavailable> {
    if (this.failure !== null) return unavailable(this.failure);
    const api = this.ffi();
    if (api === null) return unavailable('GPU counters are not available on this platform');
    try {
      if (this.query === null) {
        const q: unknown[] = [null];
        const c: unknown[] = [null];
        if ((await api.openQuery(q)) !== 0 || (await api.addCounter(q[0], COUNTER, c)) !== 0) {
          this.failure = 'This machine publishes no GPU engine counters';
          return unavailable(this.failure);
        }
        this.query = q[0];
        this.counter = c[0];
      }
      // A failed read is unavailable, never zero (FR-011): an empty map would show every process at 0%.
      if ((await api.collect(this.query)) !== 0) return unavailable('GPU counters could not be collected');
      const size = [0];
      const count = [0];
      const probe = await api.formattedArray(this.counter, size, count, null);
      // No instances at all is a real answer — nothing is using a GPU engine.
      if (probe === 0 && (count[0] ?? 0) === 0) return new Map();
      if (probe !== PDH_MORE_DATA || (size[0] ?? 0) === 0) return unavailable('GPU counters are not ready yet');
      const buf = Buffer.alloc(size[0]!);
      if ((await api.formattedArray(this.counter, size, count, buf)) !== 0) return unavailable('GPU counters could not be read');
      return gpuByPid(parseItems(buf, count[0] ?? 0, api.addressOf(buf)));
    } catch {
      return unavailable('GPU counters could not be read');
    }
  }
}
