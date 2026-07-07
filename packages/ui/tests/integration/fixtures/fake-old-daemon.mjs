// Test fixture: a "pre-buildId" daemon. It answers health.ping like the daemon
// did BEFORE the build-id protocol existed — i.e. with NO `buildId` field — and
// holds the pipe until it is killed. Used to prove ensureDaemon retires a daemon
// running code older than the build-id handshake (which cannot report its build).
import { createServer } from 'node:net';

const pipe = process.env.THRONG_PIPE_NAME;
if (!pipe) {
  process.stderr.write('fake-old-daemon: THRONG_PIPE_NAME required\n');
  process.exit(2);
}

const server = createServer((sock) => {
  sock.setEncoding('utf8');
  let buf = '';
  sock.on('data', (chunk) => {
    buf += chunk;
    let nl = buf.indexOf('\n');
    while (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) {
        let req;
        try { req = JSON.parse(line); } catch { req = null; }
        if (req && req.method === 'health.ping') {
          // Deliberately NO buildId — this is the whole point of the fixture.
          sock.write(JSON.stringify({
            jsonrpc: '2.0',
            id: req.id,
            result: { status: 'ok', pid: process.pid, daemonStartedAt: new Date(0).toISOString() },
          }) + '\n');
        }
      }
      nl = buf.indexOf('\n');
    }
  });
  sock.on('error', () => sock.destroy());
});

server.on('error', (e) => {
  process.stderr.write(`fake-old-daemon: ${e.code}\n`);
  process.exit(1);
});
server.listen(pipe, () => {
  process.stdout.write('listening\n');
});
