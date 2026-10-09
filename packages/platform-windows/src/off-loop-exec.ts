import { execFile, type ExecFileOptions } from 'node:child_process';
import { Worker } from 'node:worker_threads';

/**
 * `execFile`, with the process START made on a worker thread (051 FR-010).
 *
 * Starting a process is synchronous on Windows: `CreateProcess` and its pipes run on whichever thread calls
 * `execFile`, and nothing else on that thread's event loop runs meanwhile. The terminal service's own loop carries
 * every terminal's keystrokes and output, so each start it made there held all of them. A start was assumed to cost
 * ~10 ms; measured on a developer machine while ten terminals end it costs 60-230 ms, and an end of ten asks for about
 * thirty (`taskkill`, the attached-process helper, the console-host query) — keystrokes echoed 100-350 ms late
 * (051 MT-02, SC-003) and unrelated requests waited as long (FR-021).
 *
 * On a worker the start blocks only the worker. The process runs as before; its result comes back as a message, and
 * the callback is called on the caller's loop with the shape `execFile` gives it — `error.code` (the exit code, so
 * `taskkill`'s 128 still reads as "already gone"), `stdout`, `stderr`.
 *
 * One worker, made on first use, holding the process alive only while a request is outstanding. If it cannot be made,
 * or dies, requests fall back to `execFile` on the caller's thread: slower, never lost.
 */

export type ExecCallback = (error: (Error & { code?: unknown }) | null, stdout: string, stderr: string) => void;

interface Reply {
  id: number;
  error: { message: string; code?: unknown; killed?: boolean; signal?: unknown } | null;
  stdout: string;
  stderr: string;
}

// Plain CommonJS, evaluated in the worker: it has no module of its own to resolve, so packaging cannot lose it.
const WORKER_SOURCE = `
const { parentPort } = require('node:worker_threads');
const { execFile } = require('node:child_process');
parentPort.on('message', ({ id, file, args, options }) => {
  try {
    execFile(file, args, options, (error, stdout, stderr) => {
      parentPort.postMessage({
        id,
        error: error ? { message: error.message, code: error.code, killed: error.killed, signal: error.signal } : null,
        stdout: String(stdout ?? ''),
        stderr: String(stderr ?? ''),
      });
    });
  } catch (error) {
    parentPort.postMessage({ id, error: { message: String(error && error.message || error) }, stdout: '', stderr: '' });
  }
});
`;

let worker: Worker | null = null;
let workerBroken = false;
let nextId = 1;
const pending = new Map<number, ExecCallback>();

function settle(reply: Reply): void {
  const callback = pending.get(reply.id);
  if (!callback) return;
  pending.delete(reply.id);
  if (pending.size === 0) worker?.unref();
  if (!reply.error) return callback(null, reply.stdout, reply.stderr);
  const error = Object.assign(new Error(reply.error.message), {
    code: reply.error.code,
    killed: reply.error.killed,
    signal: reply.error.signal,
  });
  callback(error, reply.stdout, reply.stderr);
}

/** The worker, made on first use; `null` once it has proved it cannot run here. */
function theWorker(): Worker | null {
  if (worker || workerBroken) return worker;
  try {
    const made = new Worker(WORKER_SOURCE, { eval: true });
    made.on('message', settle);
    const fail = (why: unknown) => {
      if (worker !== made) return;
      worker = null;
      const lost = [...pending.entries()];
      pending.clear();
      const error = new Error(`the process runner stopped: ${String((why as Error)?.message ?? why)}`);
      for (const [, callback] of lost) callback(error, '', '');
    };
    made.on('error', fail);
    made.on('exit', (code) => fail(`exit ${code}`));
    made.unref();
    worker = made;
  } catch {
    workerBroken = true;
  }
  return worker;
}

/** `execFile(file, args, options, callback)`, started off the caller's event loop. Output is always text. */
export function execFileOffLoop(file: string, args: readonly string[], options: ExecFileOptions, callback: ExecCallback): void {
  const w = theWorker();
  if (!w) {
    execFile(file, [...args], { ...options, encoding: 'utf8' }, (error, stdout, stderr) =>
      callback(error, String(stdout ?? ''), String(stderr ?? '')),
    );
    return;
  }
  const id = nextId++;
  pending.set(id, callback);
  w.ref();
  w.postMessage({ id, file, args: [...args], options: { ...options, encoding: 'utf8' } });
}
