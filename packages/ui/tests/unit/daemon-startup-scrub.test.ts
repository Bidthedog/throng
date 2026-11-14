import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { scrubStartupLog } from '../../src/main/daemon-lifecycle.js';

/**
 * 068 FR-034b — `daemon-startup.log` is a raw stdout/stderr redirect the logger never sees, so main
 * anonymises it when it reads it back and overwrites the raw file with the anonymised text.
 */
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('scrubStartupLog', () => {
  it('overwrites the raw file with the anonymised text', () => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-startup-'));
    dirs.push(dir);
    const file = join(dir, 'daemon-startup.log');
    writeFileSync(file, 'Error: cannot open /home/alice/db.sqlite\n');
    scrubStartupLog(dir, (text) => text.replace('/home/alice/db.sqlite', '<path-12345678>'));
    expect(readFileSync(file, 'utf8')).toBe('Error: cannot open <path-12345678>\n');
  });

  it('leaves a missing file alone and never throws', () => {
    const dir = mkdtempSync(join(tmpdir(), 'throng-startup-'));
    dirs.push(dir);
    expect(() => scrubStartupLog(dir, (t) => t)).not.toThrow();
  });
});
