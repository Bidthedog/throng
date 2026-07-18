import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAgentLogger } from '../../src/pty-agent-log.js';

/**
 * 019 #94 follow-up — the de-elevated agent dies AFTER connecting, and because it runs
 * detached at medium integrity with no console, nobody has ever seen WHY. This logger is
 * the durable channel that survives the crash, so its two load-bearing guarantees are
 * pinned here: (1) a written line lands on disk, and (2) a FAILED write never throws —
 * a diagnostic sink must not be able to take down the very process it exists to observe.
 */

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* best-effort scratch cleanup */
    }
  }
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-agentlog-'));
  dirs.push(dir);
  return dir;
}

describe('createAgentLogger', () => {
  it('names the file throng-agent-<pid>.log under the given dir', () => {
    const dir = scratch();
    const logger = createAgentLogger(4321, dir);
    expect(logger.path).toBe(join(dir, 'throng-agent-4321.log'));
  });

  it('appends each logged line durably to disk', () => {
    const dir = scratch();
    const logger = createAgentLogger(1, dir);
    logger.log('agent start pid=1');
    logger.log('about to pty.start (native ConPTY spawn) key=7');

    const contents = readFileSync(logger.path, 'utf8');
    const lines = contents.trimEnd().split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('agent start pid=1');
    expect(lines[1]).toContain('about to pty.start (native ConPTY spawn) key=7');
    // Each line is timestamped (ISO-8601 prefix) so a crash can be located in time.
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('NEVER throws when the write fails (the simulated crash-path invariant)', () => {
    // A directory that does not exist and cannot be created implicitly makes every
    // appendFileSync fail with ENOENT — the stand-in for any I/O failure during a
    // crash. The logger must swallow it: losing a line beats crashing the agent.
    const logger = createAgentLogger(99, join(tmpdir(), 'throng-nonexistent', 'deeper', 'still'));
    expect(() => logger.log('this write will fail')).not.toThrow();
  });
});
