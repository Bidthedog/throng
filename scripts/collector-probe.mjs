// Does an installed copy's resource collector start? (#542)
//
//   <install root>/resources/runtime/node collector-probe.mjs <install root>
//
// Run by the INSTALLED copy's own bundled runtime, so it imports nothing but Node's built-ins. It forks the
// shipped collector the way UI main does and waits for the collector to ask for its first roster, which only
// happens once its whole import graph has loaded. Exits 0 when it does, 1 otherwise, printing why.
import { fork } from 'node:child_process';
import { join } from 'node:path';

const TIMEOUT_MS = 30_000;
const root = process.argv[2];
if (!root) {
  console.error('usage: collector-probe.mjs <install root>');
  process.exit(2);
}

const entry = join(root, 'resources', 'app', 'packages', 'ui', 'dist', 'collector', 'resource-collector-entry.js');
const child = fork(entry, [], {
  execPath: process.execPath,
  serialization: 'json',
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  windowsHide: true,
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += String(chunk);
});

const finish = (ok, why) => {
  clearTimeout(timer);
  console.log(`collector ${ok ? 'started' : 'did not start'}: ${why}`);
  // The collector exits the moment it is disconnected, as it does when throng closes.
  if (child.connected) child.disconnect();
  process.exitCode = ok ? 0 : 1;
};

const timer = setTimeout(() => finish(false, `no message in ${TIMEOUT_MS} ms ${stderr}`), TIMEOUT_MS);
child.on('message', (msg) => {
  if (msg.type === 'needRoster') finish(true, 'it asked for its first roster');
});
child.on('error', (err) => finish(false, err.message));
child.on('close', (code) => {
  if (process.exitCode === undefined) finish(false, `exit code ${code} ${stderr}`);
});
child.send({ type: 'configure', intervalSeconds: 1, historyMinutes: 1 });
