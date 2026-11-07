/*
 * Stand-in for a mouse-reporting TUI such as Claude Code (#544).
 *
 * It does what such a program does to its console: turns on VT input, so the console hands it the VT
 * sequences it receives rather than translating them into key events, and asks for SGR mouse reporting
 * (DECSET 1003 + 1006). Then it records every raw ReadFile chunk the console gives it, in order and with
 * the time it arrived, to RECORDER_OUT, until it has seen RECORDER_STOP. The test compares what arrived
 * with what was written, and where the read boundaries fell.
 *
 * koffi is imported from KOFFI_URL because this file runs from the test tree, outside any package that
 * depends on it.
 */
import { appendFileSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const koffi = (await import(process.env.KOFFI_URL)).default;
const out = process.env.RECORDER_OUT;
const stop = process.env.RECORDER_STOP;

const kernel32 = koffi.load('kernel32.dll');
const GetStdHandle = kernel32.func('GetStdHandle', 'void *', ['int32']);
const SetConsoleMode = kernel32.func('SetConsoleMode', 'bool', ['void *', 'uint32']);
const ReadFile = kernel32.func('ReadFile', 'bool', ['void *', 'void *', 'uint32', '_Out_ uint32 *', 'void *']);

const STD_INPUT_HANDLE = -10;
const ENABLE_VIRTUAL_TERMINAL_INPUT = 0x0200;

const input = GetStdHandle(STD_INPUT_HANDLE);
if (!SetConsoleMode(input, ENABLE_VIRTUAL_TERMINAL_INPUT)) {
  process.stdout.write('RECORDER-FAILED: SetConsoleMode\r\n');
  process.exit(1);
}

writeFileSync(out, '');
process.stdout.write('\x1b[?1003h\x1b[?1006h');
process.stdout.write('RECORDER-READY\r\n');

const buffer = Buffer.alloc(65536);
let seen = '';
for (;;) {
  const read = [0];
  if (!ReadFile(input, buffer, buffer.length, read, null)) break;
  const chunk = buffer.subarray(0, read[0]).toString('latin1');
  // One line per chunk: arrival time in ms, then the chunk hex-encoded, so its boundaries survive into the test.
  appendFileSync(out, `${performance.now().toFixed(2)} ${Buffer.from(chunk, 'latin1').toString('hex')}\n`);
  seen += chunk;
  if (seen.includes(stop)) break;
}

process.stdout.write('\x1b[?1003l\x1b[?1006l');
process.stdout.write('RECORDER-DONE\r\n');
