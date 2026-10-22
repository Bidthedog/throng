import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 058 FR-018a / research D8 — every app the E2E suite launches keeps its own namespace.
 *
 * Since 058 the single-instance lock is derived from the daemon pipe, not from userData. A launch
 * that supplies `--user-data-dir` but no `THRONG_PIPE_NAME` therefore lands in the dev namespace a
 * developer's own `npm start` uses: it meets that instance's lock, is told to bring it forward and
 * QUITS — so the spec sees no window, and the developer's throng jumps to the front mid-run. Parallel
 * workers would do the same to each other. One missing line, one silent cross-instance collision.
 *
 * So every `electron.launch(` in the suite must set `THRONG_PIPE_NAME` in the options it passes.
 */
const E2E_DIR = fileURLToPath(new URL('../e2e/', import.meta.url));
/**
 * How far below `electron.launch(` its options may run before they must have named the pipe. Room
 * for a comment block inside the options — `app-shell.e2e.ts` explains its pipe in fourteen lines.
 */
const OPTIONS_WINDOW = 30;

function launchesWithoutPipe(file: string): number[] {
  const lines = readFileSync(join(E2E_DIR, file), 'utf8').split('\n');
  const missing: number[] = [];
  lines.forEach((line, i) => {
    const code = line.trim();
    if (code.startsWith('*') || code.startsWith('//') || !code.includes('electron.launch(')) return;
    const options = lines.slice(i, i + OPTIONS_WINDOW).join('\n');
    if (!options.includes('THRONG_PIPE_NAME')) missing.push(i + 1);
  });
  return missing;
}

describe('E2E launches keep their own namespace (058 FR-018a)', () => {
  const files = readdirSync(E2E_DIR).filter((f) => f.endsWith('.ts'));

  it('finds the launches it is guarding — the harness among them', () => {
    const withLaunch = files.filter((f) => readFileSync(join(E2E_DIR, f), 'utf8').includes('electron.launch('));
    expect(withLaunch).toContain('harness.ts');
  });

  it.each(files)('%s sets THRONG_PIPE_NAME on every electron.launch', (file) => {
    expect(launchesWithoutPipe(file), `launches at these lines name no pipe`).toEqual([]);
  });
});
