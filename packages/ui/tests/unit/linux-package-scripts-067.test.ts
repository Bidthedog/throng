import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';

const PACKAGING = resolve(import.meta.dirname, '../../../../packaging/linux');
const SHIPPED = {
  'throng-open-project.nemo_action': 'usr/share/nemo/actions',
  'throng-open-project-kde.desktop': 'usr/share/kio/servicemenus',
  'throng-open-project.desktop': 'usr/share/applications',
};

describe.skipIf(skipUnlessLinux('the maintainer scripts run on Linux only'))('the package scripts (067)', () => {
  let scratch: string;
  let prefix: string;
  let payload: string;
  let versions: string;

  const run = (script: string, version: string, ...args: string[]): ReturnType<typeof spawnSync> => {
    const staged = join(scratch, `${script}-${version}`);
    writeFileSync(staged, readFileSync(join(PACKAGING, script), 'utf8').replaceAll('@VERSION@', version));
    return spawnSync('sh', [staged, ...args], {
      encoding: 'utf8',
      env: { ...process.env, THRONG_PACKAGE_TEST_PREFIX: prefix },
    });
  };

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'throng-pkg-067-'));
    prefix = join(scratch, 'root');
    payload = join(prefix, 'opt/throng');
    versions = join(prefix, 'opt/throng-versions');
    mkdirSync(join(payload, 'resources/file-manager'), { recursive: true });
    for (const name of Object.keys(SHIPPED)) copyFileSync(join(PACKAGING, 'file-manager', name), join(payload, 'resources/file-manager', name));
    writeFileSync(join(payload, 'chrome-sandbox'), '');
    writeFileSync(join(payload, 'throng'), '#!/bin/sh\n');
  });
  afterEach(() => rmSync(scratch, { recursive: true, force: true }));

  it('installs the file-manager item for all three file managers, each invoking only throng <path> (FR-022, FR-033)', () => {
    expect(run('after-install.sh', '1.0.0', 'configure').status).toBe(0);
    for (const [name, dir] of Object.entries(SHIPPED)) {
      const text = readFileSync(join(prefix, dir, name), 'utf8');
      expect(text, name).toMatch(/^Exec=throng %F$/m);
    }
  });

  it('removes them with the package, and leaves them on an upgrade (FR-032)', () => {
    run('after-install.sh', '1.0.0', 'configure');
    run('after-remove.sh', '1.0.0', 'upgrade');
    for (const [name, dir] of Object.entries(SHIPPED)) expect(existsSync(join(prefix, dir, name)), name).toBe(true);
    run('after-remove.sh', '1.0.0', 'remove');
    for (const [name, dir] of Object.entries(SHIPPED)) expect(existsSync(join(prefix, dir, name)), name).toBe(false);
  });

  it('keeps a version something runs from, and removes it at a later install once nothing does (FR-103, FR-104)', async () => {
    run('after-install.sh', '1.0.0', 'configure');
    const old = join(versions, '1.0.0');
    const binary = join(old, 'running-copy');
    // A shell, because a coreutils `sleep` can be a multi-call binary that refuses another name.
    copyFileSync('/bin/sh', binary);
    chmodSync(binary, 0o755);
    const child: ChildProcess = spawn(binary, ['-c', 'read line'], { stdio: ['pipe', 'ignore', 'ignore'] });
    await new Promise((settle) => child.once('spawn', settle));
    const exited = new Promise((settle) => child.once('exit', settle));
    try {
      run('after-install.sh', '1.1.0', 'configure');
      expect(existsSync(old)).toBe(true);
    } finally {
      child.kill('SIGKILL');
      await exited;
    }
    run('after-install.sh', '1.2.0', 'configure');
    expect(existsSync(old)).toBe(false);
    expect(existsSync(join(versions, '1.2.0'))).toBe(true);
  });
});
