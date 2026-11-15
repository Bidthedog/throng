import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { skipOnMacos, skipOnWindows } from '@throng/core/testing';

/**
 * 070 FR-004, FR-044, T054, research R23 — the build signs every binary throng ships and fails on any a Mac would
 * refuse. The bundle here is a fake tree whose binaries are only Mach-O headers, and `codesign` and `lipo` are an
 * injected stand-in, so the discovery, the order of signing and every failure path run on any machine. Whether real
 * `codesign` accepts the real bundle is the macOS build job's to show.
 *
 * Layer: unit — a temp folder of small files and a fake command runner; nothing is signed.
 */

const HOOK = fileURLToPath(new URL('../../../../packaging/macos/after-sign.cjs', import.meta.url));
const { default: afterSign, signAndCheck, findMachOFiles, isMachOHeader } = createRequire(import.meta.url)(HOOK) as {
  default: (context: object) => Promise<void>;
  signAndCheck: (app: string, io: object) => string[];
  findMachOFiles: (root: string) => string[];
  isMachOHeader: (head: Buffer) => boolean;
};

const word = (...values: number[]): Buffer => Buffer.concat(values.map((v) => Buffer.from([v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255])));
/** <mach-o/loader.h> MH_MAGIC_64 as an arm64 file writes it to disk: little-endian, so it reads back as MH_CIGAM_64. */
const THIN = word(0xcffaedfe, 0x0c000001);
/** <mach-o/fat.h> FAT_MAGIC with two architectures. */
const FAT = word(0xcafebabe, 2);
/** A Java class file: the same first word as FAT_MAGIC, then a version. */
const JAVA = word(0xcafebabe, 0x00000034);

let scratch: string;
let app: string;
const R = 'Contents/Resources';
const BIN = {
  electron: 'Contents/MacOS/throng',
  framework: 'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
  node: `${R}/runtime/node`,
  pty: `${R}/app/node_modules/node-pty/prebuilds/darwin-arm64/pty.node`,
  spawnHelper: `${R}/app/node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper`,
  sqlite: `${R}/app/node_modules/better-sqlite3/prebuilds/darwin-arm64.node`,
  koffi: `${R}/app/node_modules/@koromix/koffi-darwin-arm64/darwin_arm64/koffi.node`,
};

function put(rel: string, bytes: Buffer | string): void {
  const path = join(app, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
}

beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), 'throng-after-sign-'));
  app = join(scratch, 'dist', 'mac-arm64', 'throng.app');
  for (const rel of Object.values(BIN)) put(rel, Buffer.concat([THIN, Buffer.alloc(64)]));
  put(`${R}/app/node_modules/fsevents/fsevents.node`, Buffer.concat([FAT, Buffer.alloc(64)]));
  put(`${R}/app/package.json`, '{"name":"throng"}');
  put(`${R}/app/node_modules/some-tool/Hello.class`, Buffer.concat([JAVA, Buffer.alloc(64)]));
  put(`${R}/tiny`, Buffer.from([0xcf, 0xfa]));
  symlinkSync('A', join(app, 'Contents/Frameworks/Electron Framework.framework/Versions/Current'));
});

afterAll(() => rmSync(scratch, { recursive: true, force: true }));

/** A codesign and lipo that succeed, unless told which file to fail and how. */
function fakeExec(options: { archs?: Record<string, string>; unsigned?: string[]; failSign?: string[] } = {}) {
  const calls: string[][] = [];
  const exec = (file: string, args: string[]) => {
    calls.push([file, ...args]);
    const target = args[args.length - 1] ?? '';
    const named = (list: string[] = []) => list.some((rel) => target.endsWith(rel));
    if (file === 'lipo') {
      const hit = Object.entries(options.archs ?? {}).find(([rel]) => target.endsWith(rel));
      return { status: 0, stdout: `${hit?.[1] ?? 'arm64'}\n`, stderr: '' };
    }
    if (args[0] === '--force' && named(options.failSign)) return { status: 1, stdout: '', stderr: 'internal error' };
    if (args[0] === '--verify' && named(options.unsigned)) return { status: 1, stdout: '', stderr: 'code object is not signed at all' };
    return { status: 0, stdout: '', stderr: '' };
  };
  return { exec, calls, log: () => {} };
}

describe.skipIf(skipOnWindows('walks a bundle of /-separated paths and symlinks, as only a Mac build makes'))('finding the Mach-O files (070 FR-044)', () => {
  it('knows Mach-O by its magic number: thin and fat, either byte order, and not a Java class', () => {
    expect(isMachOHeader(THIN)).toBe(true);
    expect(isMachOHeader(word(0xfeedfacf, 0))).toBe(true);
    expect(isMachOHeader(FAT)).toBe(true);
    expect(isMachOHeader(word(0xbebafeca, 0x02000000))).toBe(true);
    expect(isMachOHeader(JAVA)).toBe(false);
    expect(isMachOHeader(Buffer.from('#!/bin/sh\n'))).toBe(false);
    expect(isMachOHeader(Buffer.from([0xcf, 0xfa]))).toBe(false);
  });

  it('finds every binary in the bundle by content, whatever its name, and follows no link', () => {
    const found = findMachOFiles(app).map((p) => p.slice(app.length + 1));
    expect(found).toEqual([...Object.values(BIN), `${R}/app/node_modules/fsevents/fsevents.node`].sort());
  });
});

describe.skipIf(skipOnWindows('walks a bundle of /-separated paths and symlinks, as only a Mac build makes'))('signing and checking a bundle (070 FR-004, FR-044)', () => {
  it('passes a bundle whose every binary is signed and arm64', () => {
    expect(signAndCheck(app, fakeExec())).toEqual([]);
  });

  it('signs every binary under Resources, then re-seals the bundle, then verifies it, in that order', () => {
    const io = fakeExec();
    signAndCheck(app, io);
    const signed = io.calls.filter((c) => c[0] === 'codesign' && c[1] === '--force').map((c) => c[c.length - 1]);
    const ours = [BIN.node, BIN.pty, BIN.spawnHelper, BIN.sqlite, BIN.koffi, `${R}/app/node_modules/fsevents/fsevents.node`];
    expect(signed.slice(0, -1).map((p) => p?.slice(app.length + 1)).sort()).toEqual(ours.sort());
    expect(signed[signed.length - 1]).toBe(app);
    expect(io.calls.find((c) => c[1] === '--force' && c[c.length - 1] === app)).toContain('--sign');
    const seal = io.calls.findIndex((c) => c[1] === '--force' && c[c.length - 1] === app);
    const deep = io.calls.findIndex((c) => c.includes('--deep'));
    expect(deep).toBeGreaterThan(seal);
    expect(io.calls[deep]).toEqual(['codesign', '--verify', '--deep', '--strict', '--verbose=2', app]);
  });

  it.skipIf(skipOnWindows('asserts POSIX execute bits, which a Windows host does not keep'))(
    'makes spawn-helper and the runtime executable, as node-pty ships spawn-helper without the bit', () => {
      for (const rel of [BIN.spawnHelper, BIN.node]) chmodSync(join(app, rel), 0o644);
      expect(signAndCheck(app, { exec: fakeExec().exec, log: () => undefined })).toEqual([]);
      for (const rel of [BIN.spawnHelper, BIN.node]) expect(statSync(join(app, rel)).mode & 0o777).toBe(0o755);
      expect(statSync(join(app, BIN.pty)).mode & 0o111).toBe(0);
    },
  );

  it('signs ad hoc and nothing else: no identity, no timestamp server', () => {
    const io = fakeExec();
    signAndCheck(app, io);
    for (const call of io.calls.filter((c) => c[1] === '--force')) {
      expect(call.slice(1, 4)).toEqual(['--force', '--sign', '-']);
      expect(call).toContain('--timestamp=none');
    }
  });

  it('leaves Electron’s own binaries to electron-builder, and still checks them', () => {
    const io = fakeExec();
    signAndCheck(app, io);
    const signed = io.calls.filter((c) => c[1] === '--force').map((c) => c[c.length - 1]);
    expect(signed).not.toContain(join(app, BIN.electron));
    expect(io.calls).toContainEqual(['lipo', '-archs', join(app, BIN.framework)]);
    expect(io.calls).toContainEqual(['codesign', '--verify', '--strict', join(app, BIN.framework)]);
  });

  it('fails on a binary with no arm64 slice, naming it (FR-003)', () => {
    const failures = signAndCheck(app, fakeExec({ archs: { 'darwin-arm64.node': 'x86_64' } }));
    expect(failures).toEqual([`${BIN.sqlite}: not built for Apple silicon (lipo -archs: x86_64)`]);
  });

  it('accepts a universal binary, which runs on Apple silicon', () => {
    expect(signAndCheck(app, fakeExec({ archs: { 'fsevents.node': 'x86_64 arm64' } }))).toEqual([]);
  });

  it('fails on a binary that does not verify, naming it, and on a bundle that does not', () => {
    const failures = signAndCheck(app, fakeExec({ unsigned: ['spawn-helper', 'throng.app'] }));
    expect(failures).toContain('the bundle does not verify: code object is not signed at all');
    expect(failures).toContain(`${BIN.spawnHelper}: not validly signed: code object is not signed at all`);
  });

  it('fails when signing fails, and still reports every other problem', () => {
    const failures = signAndCheck(app, fakeExec({ failSign: ['runtime/node'], archs: { 'koffi.node': 'x86_64' } }));
    expect(failures).toContain(`${BIN.node}: codesign failed: internal error`);
    expect(failures).toContain(`${BIN.koffi}: not built for Apple silicon (lipo -archs: x86_64)`);
  });

  it('fails a bundle missing what the daemon needs (FR-004)', () => {
    const bare = join(scratch, 'bare.app');
    mkdirSync(join(bare, 'Contents/MacOS'), { recursive: true });
    writeFileSync(join(bare, 'Contents/MacOS/throng'), THIN);
    const failures = signAndCheck(bare, fakeExec());
    for (const what of ['the bundled Node runtime', "node-pty's spawn-helper", "node-pty's addon", "better-sqlite3's addon", "koffi's library"]) {
      expect(failures).toContain(`${what} is missing from the bundle`);
    }
  });
});

describe('the hook and the command (070 FR-044)', () => {
  it('does nothing for a Windows or Linux build', async () => {
    await expect(afterSign({ electronPlatformName: 'linux', appOutDir: '/nonexistent' })).resolves.toBeUndefined();
    await expect(afterSign({ electronPlatformName: 'win32', appOutDir: '/nonexistent' })).resolves.toBeUndefined();
  });

  // Off a Mac there is no codesign at all, which is the simplest bundle that cannot pass: the build must fail, not skip.
  it.skipIf(skipOnMacos('a Mac has codesign, so this bundle would sign; the missing-codesign failure shows only off a Mac'))(
    'fails the build when it cannot sign, rather than shipping unsigned', async () => {
    const context = { electronPlatformName: 'darwin', appOutDir: dirname(app), packager: { appInfo: { productFilename: 'throng' } } };
    await expect(afterSign(context)).rejects.toThrow(/problem\(s\) a Mac would refuse to run/);
    const cli = spawnSync(process.execPath, [HOOK, app], { encoding: 'utf8' });
    expect(cli.status).toBe(1);
    expect(cli.stderr).toMatch(/\[after-sign\] .*codesign failed/);
  });

  it('exits 2 with its usage when no bundle is named', () => {
    const cli = spawnSync(process.execPath, [HOOK], { encoding: 'utf8' });
    expect(cli.status).toBe(2);
    expect(cli.stderr).toMatch(/usage/);
  });
});
