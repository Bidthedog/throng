// Layer: integration — what is left on disk after a crash, a close and a quit are claims about the folder itself.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PrintHostFiles } from '../../src/main/print-host-files.js';

/**
 * 075 FR-066 — Print Preview writes the whole printable document, the reader's text, to `<userData>/print-jobs/hosts`
 * for its print host to load. A copy must not outlive its window: not after a close, a quit, or a crash that ran
 * neither.
 */
let root: string;
let dir: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'throng-print-hosts-'));
  dir = join(root, 'print-jobs', 'hosts');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('the print host documents on disk', () => {
  it('removes what a crashed session left before the first new copy is written', async () => {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'left-by-a-crash.html'), '<p>the reader\'s document</p>');
    const files = new PrintHostFiles(dir);
    const file = await files.write('job', 'html', '<p>now</p>');
    expect(readdirSync(dir)).toEqual(['job.html']);
    expect(file).toBe(join(dir, 'job.html'));
  });

  it('has removed a copy by the time its removal settles', async () => {
    const files = new PrintHostFiles(dir);
    const file = await files.write('job', 'html', '<p>x</p>');
    await files.remove(file);
    expect(existsSync(file)).toBe(false);
  });

  it('removes the whole folder, at once, when the app quits with Print Preview open', async () => {
    const files = new PrintHostFiles(dir);
    await files.write('open', 'pdf', new Uint8Array([1, 2, 3]));
    files.removeAllNow();
    expect(existsSync(join(root, 'print-jobs'))).toBe(false);
  });
});
