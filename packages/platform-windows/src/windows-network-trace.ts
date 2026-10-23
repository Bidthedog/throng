import { createRequire } from 'node:module';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { NETWORK_ELEVATION_REQUIRED, NETWORK_TRACE_FAILED, type Unavailable } from '@throng/core';
import { NetworkByteCounter } from './etw-network-events.js';
import type { NetworkReader } from './windows-process-metrics.js';

/**
 * Network bytes per process from a real-time ETW session on Microsoft-Windows-Kernel-Network (055 FR-113,
 * research R20). Windows keeps no per-process network counter an unelevated process can read, and this
 * session is no exception: an unelevated process may start it but is refused the provider, which `start`
 * reports as `elevation-required`.
 *
 * The session is started, enabled and stopped from the caller's thread through koffi's `.async`. Consuming
 * it cannot be: `ProcessTrace` blocks the thread that calls it until the session stops, delivering every event
 * to a callback on that same thread. So it runs in a worker thread, whose callback sums bytes per pid and
 * posts the sums after each buffer the session delivers. The caller's loop only ever adds those sums up.
 *
 * Sessions are named `throng-net-<pid>`. Each is stopped on `dispose` and, best effort, on process exit; one
 * left behind by a collector that crashed is stopped by the next one to start, since the system allows only
 * 64 sessions and a leaked one holds its buffers until reboot.
 */
const require = createRequire(import.meta.url);

const SESSION_PREFIX = 'throng-net-';
const MAX_SESSIONS = 64;
const NAME_BYTES = 1024 * 2;

const ERROR_ACCESS_DENIED = 5;
const ERROR_ALREADY_EXISTS = 183;
const WNODE_FLAG_TRACED_GUID = 0x0002_0000;
const EVENT_TRACE_REAL_TIME_MODE = 0x0000_0100;
const EVENT_TRACE_CONTROL_STOP = 1;
const EVENT_CONTROL_CODE_ENABLE_PROVIDER = 1;
const TRACE_LEVEL_INFORMATION = 4;
/** KERNEL_NETWORK_KEYWORD_IPV4 | KERNEL_NETWORK_KEYWORD_IPV6. */
const KERNEL_NETWORK_KEYWORDS = 0x30n;
const PROCESS_TRACE_MODE_REAL_TIME = 0x0000_0100;
const PROCESS_TRACE_MODE_EVENT_RECORD = 0x1000_0000;
/** {7DD42A49-5329-4832-8DFD-43D979153A88} */
const KERNEL_NETWORK_DATA1 = 0x7dd4_2a49;
const KERNEL_NETWORK_GUID = Buffer.from([
  0x49, 0x2a, 0xd4, 0x7d, 0x29, 0x53, 0x32, 0x48, 0x8d, 0xfd, 0x43, 0xd9, 0x79, 0x15, 0x3a, 0x88,
]);
/** The send and receive event ids (see etw-network-events.ts). */
const EVENT_IDS = [10, 11, 26, 27, 42, 43, 58, 59];

type KoffiFn = ((...args: unknown[]) => unknown) & { async: (...args: unknown[]) => void };
function callAsync<T>(fn: KoffiFn, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) =>
    fn.async(...args, (error: unknown, result: T) => (error ? reject(error) : resolve(result))),
  );
}

interface Layout {
  /** sizeof(EVENT_TRACE_PROPERTIES) and the offsets written into it. */
  readonly props: { size: number; bufferSize: number; flags: number; clientContext: number; guid: number; logFileMode: number; flushTimer: number; logFileNameOffset: number; loggerNameOffset: number };
  /** What the worker needs of EVENT_TRACE_LOGFILEW and EVENT_RECORD. */
  readonly worker: {
    logSize: number;
    offLoggerName: number;
    offMode: number;
    offBufferCallback: number;
    offRecordCallback: number;
    offProvider: number;
    offId: number;
    offUserDataLength: number;
    offUserData: number;
  };
}

interface TraceFfi {
  readonly koffiPath: string;
  readonly layout: Layout;
  start(handle: unknown[], name: string, props: Buffer): Promise<number>;
  enable(handle: unknown, guid: Buffer): Promise<number>;
  stop(name: string, props: Buffer): Promise<number>;
  stopSync(name: string, props: Buffer): number;
  queryAll(pointers: Buffer, count: number, found: number[]): Promise<number>;
  addressOf(buf: Buffer): bigint;
}

let ffi: TraceFfi | null | undefined;
function loadFfi(): TraceFfi | null {
  if (ffi !== undefined) return ffi;
  try {
    const koffi = require('koffi');
    const GUID = koffi.struct({ Data1: 'uint32', Data2: 'uint16', Data3: 'uint16', Data4: koffi.array('uint8', 8) });
    const WNODE_HEADER = koffi.struct({
      BufferSize: 'uint32',
      ProviderId: 'uint32',
      HistoricalContext: 'uint64',
      TimeStamp: 'int64',
      Guid: GUID,
      ClientContext: 'uint32',
      Flags: 'uint32',
    });
    const PROPS = koffi.struct({
      Wnode: WNODE_HEADER,
      BufferSize: 'uint32',
      MinimumBuffers: 'uint32',
      MaximumBuffers: 'uint32',
      MaximumFileSize: 'uint32',
      LogFileMode: 'uint32',
      FlushTimer: 'uint32',
      EnableFlags: 'uint32',
      AgeLimit: 'int32',
      NumberOfBuffers: 'uint32',
      FreeBuffers: 'uint32',
      EventsLost: 'uint32',
      BuffersWritten: 'uint32',
      LogBuffersLost: 'uint32',
      RealTimeBuffersLost: 'uint32',
      LoggerThreadId: 'void *',
      LogFileNameOffset: 'uint32',
      LoggerNameOffset: 'uint32',
    });
    const EVENT_TRACE_HEADER = koffi.struct({
      Size: 'uint16',
      FieldTypeFlags: 'uint16',
      Version: 'uint32',
      ThreadId: 'uint32',
      ProcessId: 'uint32',
      TimeStamp: 'int64',
      Guid: GUID,
      ProcessorTime: 'uint64',
    });
    const EVENT_TRACE = koffi.struct({
      Header: EVENT_TRACE_HEADER,
      InstanceId: 'uint32',
      ParentInstanceId: 'uint32',
      ParentGuid: GUID,
      MofData: 'void *',
      MofLength: 'uint32',
      ClientContext: 'uint32',
    });
    const SYSTEMTIME = koffi.struct({ parts: koffi.array('uint16', 8) });
    const TIME_ZONE_INFORMATION = koffi.struct({
      Bias: 'int32',
      StandardName: koffi.array('uint16', 32),
      StandardDate: SYSTEMTIME,
      StandardBias: 'int32',
      DaylightName: koffi.array('uint16', 32),
      DaylightDate: SYSTEMTIME,
      DaylightBias: 'int32',
    });
    const TRACE_LOGFILE_HEADER = koffi.struct({
      BufferSize: 'uint32',
      Version: 'uint32',
      ProviderVersion: 'uint32',
      NumberOfProcessors: 'uint32',
      EndTime: 'int64',
      TimerResolution: 'uint32',
      MaximumFileSize: 'uint32',
      LogFileMode: 'uint32',
      BuffersWritten: 'uint32',
      LogInstanceGuid: GUID,
      LoggerName: 'void *',
      LogFileName: 'void *',
      TimeZone: TIME_ZONE_INFORMATION,
      BootTime: 'int64',
      PerfFreq: 'int64',
      StartTime: 'int64',
      ReservedFlags: 'uint32',
      BuffersLost: 'uint32',
    });
    const LOGFILE = koffi.struct({
      LogFileName: 'void *',
      LoggerName: 'void *',
      CurrentTime: 'int64',
      BuffersRead: 'uint32',
      ProcessTraceMode: 'uint32',
      CurrentEvent: EVENT_TRACE,
      LogfileHeader: TRACE_LOGFILE_HEADER,
      BufferCallback: 'void *',
      BufferSize: 'uint32',
      Filled: 'uint32',
      EventsLost: 'uint32',
      EventRecordCallback: 'void *',
      IsKernelTrace: 'uint32',
      Context: 'void *',
    });
    const EVENT_DESCRIPTOR = koffi.struct({
      Id: 'uint16',
      Version: 'uint8',
      Channel: 'uint8',
      Level: 'uint8',
      Opcode: 'uint8',
      Task: 'uint16',
      Keyword: 'uint64',
    });
    const EVENT_HEADER = koffi.struct({
      Size: 'uint16',
      HeaderType: 'uint16',
      Flags: 'uint16',
      EventProperty: 'uint16',
      ThreadId: 'uint32',
      ProcessId: 'uint32',
      TimeStamp: 'int64',
      ProviderId: GUID,
      EventDescriptor: EVENT_DESCRIPTOR,
      ProcessorTime: 'uint64',
      ActivityId: GUID,
    });
    const EVENT_RECORD = koffi.struct({
      EventHeader: EVENT_HEADER,
      BufferContext: 'uint32',
      ExtendedDataCount: 'uint16',
      UserDataLength: 'uint16',
      ExtendedData: 'void *',
      UserData: 'void *',
      UserContext: 'void *',
    });

    const off = (t: unknown, m: string): number => koffi.offsetof(t, m) as number;
    const wnode = off(PROPS, 'Wnode');
    const layout: Layout = {
      props: {
        size: koffi.sizeof(PROPS) as number,
        bufferSize: wnode + off(WNODE_HEADER, 'BufferSize'),
        flags: wnode + off(WNODE_HEADER, 'Flags'),
        clientContext: wnode + off(WNODE_HEADER, 'ClientContext'),
        guid: wnode + off(WNODE_HEADER, 'Guid'),
        logFileMode: off(PROPS, 'LogFileMode'),
        flushTimer: off(PROPS, 'FlushTimer'),
        logFileNameOffset: off(PROPS, 'LogFileNameOffset'),
        loggerNameOffset: off(PROPS, 'LoggerNameOffset'),
      },
      worker: {
        logSize: koffi.sizeof(LOGFILE) as number,
        offLoggerName: off(LOGFILE, 'LoggerName'),
        offMode: off(LOGFILE, 'ProcessTraceMode'),
        offBufferCallback: off(LOGFILE, 'BufferCallback'),
        offRecordCallback: off(LOGFILE, 'EventRecordCallback'),
        offProvider: off(EVENT_RECORD, 'EventHeader') + off(EVENT_HEADER, 'ProviderId'),
        offId: off(EVENT_RECORD, 'EventHeader') + off(EVENT_HEADER, 'EventDescriptor') + off(EVENT_DESCRIPTOR, 'Id'),
        offUserDataLength: off(EVENT_RECORD, 'UserDataLength'),
        offUserData: off(EVENT_RECORD, 'UserData'),
      },
    };

    const advapi = koffi.load('advapi32.dll');
    const StartTraceW = advapi.func('StartTraceW', 'uint32', ['_Out_ uint64 *', 'str16', 'void *']) as KoffiFn;
    const EnableTraceEx2 = advapi.func('EnableTraceEx2', 'uint32', [
      'uint64',
      'void *',
      'uint32',
      'uint8',
      'uint64',
      'uint64',
      'uint32',
      'void *',
    ]) as KoffiFn;
    const ControlTraceW = advapi.func('ControlTraceW', 'uint32', ['uint64', 'str16', 'void *', 'uint32']) as KoffiFn;
    const QueryAllTracesW = advapi.func('QueryAllTracesW', 'uint32', ['void *', 'uint32', '_Out_ uint32 *']) as KoffiFn;
    ffi = {
      koffiPath: require.resolve('koffi'),
      layout,
      start: (handle, name, props) => callAsync(StartTraceW, handle, name, props),
      enable: (handle, guid) =>
        callAsync(EnableTraceEx2, handle, guid, EVENT_CONTROL_CODE_ENABLE_PROVIDER, TRACE_LEVEL_INFORMATION, KERNEL_NETWORK_KEYWORDS, 0n, 0, null),
      stop: (name, props) => callAsync(ControlTraceW, 0n, name, props, EVENT_TRACE_CONTROL_STOP),
      stopSync: (name, props) => ControlTraceW(0n, name, props, EVENT_TRACE_CONTROL_STOP) as number,
      queryAll: (pointers, count, found) => callAsync(QueryAllTracesW, pointers, count, found),
      addressOf: (buf) => koffi.address(buf) as bigint,
    };
  } catch {
    ffi = null;
  }
  return ffi;
}

/** An EVENT_TRACE_PROPERTIES with room for both names after it, as every control call wants one. */
function properties(layout: Layout, realTime: boolean): Buffer {
  const p = layout.props;
  const size = p.size + NAME_BYTES * 2;
  const buf = Buffer.alloc(size);
  buf.writeUInt32LE(size, p.bufferSize);
  buf.writeUInt32LE(p.size, p.loggerNameOffset);
  buf.writeUInt32LE(p.size + NAME_BYTES, p.logFileNameOffset);
  if (realTime) {
    buf.writeUInt32LE(WNODE_FLAG_TRACED_GUID, p.flags);
    buf.writeUInt32LE(1, p.clientContext); // QueryPerformanceCounter timestamps
    buf.writeUInt32LE(EVENT_TRACE_REAL_TIME_MODE, p.logFileMode);
    buf.writeUInt32LE(1, p.flushTimer); // deliver buffers at least every second
  }
  return buf;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Stop every `throng-net-<pid>` session whose owner is no longer running. Best effort. */
async function stopStaleSessions(api: TraceFfi): Promise<void> {
  const each = api.layout.props.size + NAME_BYTES * 2;
  const block = Buffer.alloc(each * MAX_SESSIONS);
  const pointers = Buffer.alloc(8 * MAX_SESSIONS);
  const base = api.addressOf(block);
  for (let i = 0; i < MAX_SESSIONS; i++) {
    const one = block.subarray(i * each, (i + 1) * each);
    properties(api.layout, false).copy(one);
    pointers.writeBigUInt64LE(base + BigInt(i * each), i * 8);
  }
  const found = [0];
  if ((await api.queryAll(pointers, MAX_SESSIONS, found)) !== 0) return;
  for (let i = 0; i < (found[0] ?? 0); i++) {
    const one = block.subarray(i * each, (i + 1) * each);
    const at = one.readUInt32LE(api.layout.props.loggerNameOffset);
    const raw = one.subarray(at, at + NAME_BYTES).toString('utf16le');
    const name = raw.slice(0, Math.max(0, raw.indexOf('\0')));
    const owner = name.startsWith(SESSION_PREFIX) ? Number(name.slice(SESSION_PREFIX.length)) : NaN;
    if (Number.isInteger(owner) && owner !== process.pid && !isRunning(owner)) {
      await api.stop(name, properties(api.layout, false));
    }
  }
}

// Plain CommonJS, evaluated in the worker (the off-loop-exec.ts pattern): no module of its own to resolve, so
// packaging cannot lose it. koffi is required by the absolute path the caller resolved.
const WORKER_SOURCE = `
const { parentPort, workerData: d } = require('node:worker_threads');
const koffi = require(d.koffiPath);
const advapi = koffi.load('advapi32.dll');
const OpenTraceW = advapi.func('OpenTraceW', 'uint64', ['void *']);
const ProcessTrace = advapi.func('ProcessTrace', 'uint32', ['void *', 'uint32', 'void *', 'void *']);
const CloseTrace = advapi.func('CloseTrace', 'uint32', ['uint64']);
const RecordCallback = koffi.proto('void EtwRecordCallback(void *record)');
const BufferCallback = koffi.proto('uint32 EtwBufferCallback(void *logfile)');
const ids = new Set(d.eventIds);
let counts = new Map();
const flush = () => {
  if (counts.size === 0) return;
  parentPort.postMessage({ type: 'counts', counts });
  counts = new Map();
};
const onRecord = koffi.register((rec) => {
  try {
    if (koffi.decode(rec, d.offProvider, 'uint32') !== d.providerData1) return;
    if (!ids.has(koffi.decode(rec, d.offId, 'uint16'))) return;
    if (koffi.decode(rec, d.offUserDataLength, 'uint16') < 8) return;
    const data = koffi.decode(rec, d.offUserData, 'void *');
    const pid = koffi.decode(data, 0, 'uint32');
    counts.set(pid, (counts.get(pid) || 0) + koffi.decode(data, 4, 'uint32'));
  } catch {}
}, koffi.pointer(RecordCallback));
const onBuffer = koffi.register(() => {
  flush();
  return 1;
}, koffi.pointer(BufferCallback));
const name = Buffer.from(d.name + '\\0', 'utf16le');
const log = Buffer.alloc(d.logSize);
log.writeBigUInt64LE(BigInt(koffi.address(name)), d.offLoggerName);
log.writeUInt32LE(d.mode, d.offMode);
log.writeBigUInt64LE(BigInt(onBuffer), d.offBufferCallback);
log.writeBigUInt64LE(BigInt(onRecord), d.offRecordCallback);
const handle = BigInt(OpenTraceW(log));
if (handle === 0xFFFFFFFFFFFFFFFFn) {
  parentPort.postMessage({ type: 'ended', status: -1 });
} else {
  const handles = Buffer.alloc(8);
  handles.writeBigUInt64LE(handle, 0);
  const status = ProcessTrace(handles, 1, null, null);
  flush();
  CloseTrace(handle);
  parentPort.postMessage({ type: 'ended', status });
}
`;

/** A running network trace: {@link NetworkReader} over one ETW session. */
export class WindowsNetworkTrace implements NetworkReader {
  private readonly counter = new NetworkByteCounter();
  private lastRead = performance.now();
  private failed = false;
  private disposed = false;
  private readonly stopOnExit = (): void => {
    if (!this.disposed) this.api.stopSync(this.name, properties(this.api.layout, false));
  };

  private constructor(
    private readonly api: TraceFfi,
    private readonly name: string,
    private readonly worker: Worker,
  ) {
    worker.on('message', (m: { type: string; counts?: Map<number, number> }) => {
      if (m.type === 'counts' && m.counts) for (const [pid, bytes] of m.counts) this.counter.add(pid, bytes);
      else if (m.type === 'ended' && !this.disposed) this.failed = true;
    });
    worker.on('error', () => {
      if (!this.disposed) this.failed = true;
    });
    worker.unref();
    process.once('exit', this.stopOnExit);
  }

  /**
   * Start a session, or say why not: `elevation-required` when Windows refuses it to an unelevated
   * process, `trace-failed` for anything else.
   */
  static async start(): Promise<WindowsNetworkTrace | Unavailable> {
    const api = process.arch === 'x64' ? loadFfi() : null;
    if (api === null) return { kind: 'unavailable', reason: NETWORK_TRACE_FAILED };
    const name = `${SESSION_PREFIX}${process.pid}`;
    try {
      await stopStaleSessions(api).catch(() => undefined);
      const handle: unknown[] = [0n];
      let status = await api.start(handle, name, properties(api.layout, true));
      if (status === ERROR_ALREADY_EXISTS) {
        // Our own pid's name, left by a crashed collector the pid was reused from.
        await api.stop(name, properties(api.layout, false));
        status = await api.start(handle, name, properties(api.layout, true));
      }
      if (status === ERROR_ACCESS_DENIED) return { kind: 'unavailable', reason: NETWORK_ELEVATION_REQUIRED };
      if (status !== 0) return { kind: 'unavailable', reason: NETWORK_TRACE_FAILED };
      // An unelevated process may start a session but not enable a kernel provider in it.
      const enabled = await api.enable(BigInt(handle[0] as number | bigint), KERNEL_NETWORK_GUID);
      if (enabled !== 0) {
        await api.stop(name, properties(api.layout, false));
        return { kind: 'unavailable', reason: enabled === ERROR_ACCESS_DENIED ? NETWORK_ELEVATION_REQUIRED : NETWORK_TRACE_FAILED };
      }
      return WindowsNetworkTrace.consume(api, name);
    } catch {
      await api.stop(name, properties(api.layout, false)).catch(() => undefined);
      return { kind: 'unavailable', reason: NETWORK_TRACE_FAILED };
    }
  }

  /**
   * A reader that starts the trace on its first read — the monitor's first detail tick, so a collector whose
   * monitor never opens never traces — and keeps whatever that start gave, a trace or its reason.
   */
  static lazyReader(): NetworkReader {
    let started: Promise<WindowsNetworkTrace | Unavailable> | undefined;
    return {
      read: async () => {
        started ??= WindowsNetworkTrace.start();
        const trace = await started;
        return trace instanceof WindowsNetworkTrace ? trace.read() : trace;
      },
    };
  }

  private static consume(api: TraceFfi, name: string): WindowsNetworkTrace {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        ...api.layout.worker,
        koffiPath: api.koffiPath,
        name,
        mode: PROCESS_TRACE_MODE_REAL_TIME | PROCESS_TRACE_MODE_EVENT_RECORD,
        providerData1: KERNEL_NETWORK_DATA1,
        eventIds: EVENT_IDS,
      },
    });
    return new WindowsNetworkTrace(api, name, worker);
  }

  /** Bytes per pid since the last call — for the rate, and for tests that send a known amount. */
  takeBytes(): Map<number, number> {
    return this.counter.take();
  }

  async read(): Promise<ReadonlyMap<number, number> | Unavailable> {
    if (this.failed || this.disposed) return { kind: 'unavailable', reason: NETWORK_TRACE_FAILED };
    const now = performance.now();
    const rates = NetworkByteCounter.toRates(this.takeBytes(), now - this.lastRead);
    this.lastRead = now;
    return rates;
  }

  /** Stop the session; `ProcessTrace` then returns and the worker ends. */
  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    process.removeListener('exit', this.stopOnExit);
    await this.api.stop(this.name, properties(this.api.layout, false)).catch(() => undefined);
    const ended = new Promise<void>((resolve) => this.worker.once('exit', () => resolve()));
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000).unref());
    await Promise.race([ended, timeout]);
    await this.worker.terminate().catch(() => undefined);
  }
}
