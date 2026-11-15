import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';
import { skipOnWindows } from '@throng/core/testing';

// @ts-expect-error — a plain .mjs script with no type declarations; the shape is asserted below.
import { fixNodePtyHelper } from '../../../../scripts/fix-node-pty-helper.mjs';

/**
 * 070 FR-004 — node-pty 1.1.0 publishes its macOS spawn-helper as 0644, and no terminal starts on a Mac without the
 * execute bit. The root postinstall restores it. Layer: unit — a temp folder laid out as node_modules/node-pty.
 */

const fix = fixNodePtyHelper as (root: string, platform?: string) => string[];
const made: string[] = [];
afterEach(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function install(): { root: string; helper: (dir: string) => string } {
  const root = mkdtempSync(join(tmpdir(), 'throng-pty-helper-'));
  made.push(root);
  const helper = (dir: string) => join(root, 'node_modules', 'node-pty', 'prebuilds', dir, 'spawn-helper');
  for (const dir of ['darwin-arm64', 'darwin-x64']) {
    mkdirSync(join(root, 'node_modules', 'node-pty', 'prebuilds', dir), { recursive: true });
    writeFileSync(helper(dir), 'helper');
    chmodSync(helper(dir), 0o644);
  }
  mkdirSync(join(root, 'node_modules', 'node-pty', 'prebuilds', 'win32-x64'), { recursive: true });
  return { root, helper };
}

describe.skipIf(skipOnWindows('asserts POSIX execute bits, which a Windows host does not keep'))('the node-pty helper repair (070 FR-004)', () => {
  it('makes each spawn-helper executable, as the package ships them without the bit', () => {
    const { root, helper } = install();
    expect(fix(root, 'darwin')).toEqual([helper('darwin-arm64'), helper('darwin-x64')]);
    for (const dir of ['darwin-arm64', 'darwin-x64']) expect(statSync(helper(dir)).mode & 0o777).toBe(0o755);
  });

  it('changes nothing the second time, and nothing on Windows', () => {
    const { root } = install();
    expect(fix(root, 'win32')).toEqual([]);
    fix(root, 'darwin');
    expect(fix(root, 'darwin')).toEqual([]);
  });

  it('does nothing where node-pty is not installed', () => {
    const root = mkdtempSync(join(tmpdir(), 'throng-pty-helper-'));
    made.push(root);
    expect(fix(root, 'darwin')).toEqual([]);
  });
});
