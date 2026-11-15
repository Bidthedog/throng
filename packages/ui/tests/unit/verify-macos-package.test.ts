import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { GATEKEEPER_UNPROVEN_REASON, MACOS_PACKAGE_STEPS, matchReleaseVersions } from '@throng/core';

import {
  DEV_LIBRARY_ENTRIES,
  isThrongProcess,
  macosVerdict,
  parseMacosVerifyArgs,
  TRANSLOCATED_EXEC_PATH,
  undocumentedLibraryEntries,
  versionlessFilename,
  // @ts-expect-error — plain-JS release script, imported for its pure decisions.
} from '../../../../scripts/verify-macos-lib.mjs';
// @ts-expect-error — plain-JS release script, imported for its shared helpers.
import { createRpc, runStep, snapshot } from '../../../../scripts/verify-package-lib.mjs';
import { skipOnWindows } from '@throng/core/testing';

/**
 * 070 FR-010, T056, research R26 — the macOS release check. What only a Mac can show (that the copy installs, launches
 * and is removed) runs on the release's macOS runners; what is decided here is how each step is recorded, which
 * processes and leftovers are the copy's, and the verdict the publish gate reads.
 *
 * Layer: unit — pure functions, a temp folder, and a socket in it standing in for the daemon.
 */

const VERSION = '1.0.0-alpha17';
const ALL_PASS = Object.fromEntries(MACOS_PACKAGE_STEPS.map((step) => [step, true]));
const SHA = 'a'.repeat(64);

describe('the command line', () => {
  const base = ['throng-1.0.0-alpha17-mac-arm64.dmg', '--role', 'dmg', '--runner', 'current', '--expected-version', VERSION, '--verdict-out', 'v.json'];

  it('takes the artifact, its role, which supported release this is, the version and where the verdict goes', () => {
    expect(parseMacosVerifyArgs([...base, '--older', 'old/throng-0.9.0-mac-arm64.dmg'])).toEqual({
      ok: true,
      artifact: 'throng-1.0.0-alpha17-mac-arm64.dmg',
      role: 'dmg',
      runner: 'current',
      expectedVersion: VERSION,
      verdictOut: 'v.json',
      older: 'old/throng-0.9.0-mac-arm64.dmg',
    });
  });

  it('needs no older copy for the archive, which has no upgrade step', () => {
    const archive = ['x.zip', '--role', 'macarchive', '--runner', 'previous', '--expected-version', VERSION, '--verdict-out', 'v.json'];
    expect(parseMacosVerifyArgs(archive).ok).toBe(true);
  });

  it.each([
    ['no artifact', ['--role', 'dmg']],
    ['an unknown role', [...base.slice(0, 2), 'pkg', ...base.slice(3)]],
    ['a runner label instead of a slot', [...base.slice(0, 4), 'macos-26', ...base.slice(5)]],
    ['no version', base.filter((a) => a !== '--expected-version' && a !== VERSION)],
    ['no verdict file', base.slice(0, -2)],
    ['a disk image with no older copy', base],
    ['an older copy that is neither image nor archive', [...base, '--older', 'old.tar.gz']],
  ])('refuses %s with exit 2 and the usage', (_why, argv) => {
    const r = parseMacosVerifyArgs(argv);
    expect(r.ok).toBe(false);
    expect(r.code).toBe(2);
    expect(r.message).toMatch(/usage: verify-macos-package\.mjs/);
  });
});

describe('the verdict (FR-010)', () => {
  it('passes when every step passed and the Gatekeeper first launch is unproven, with its reason', () => {
    const { document, verdictFile, passed } = macosVerdict({
      version: VERSION,
      role: 'dmg',
      runner: 'previous',
      sha256: SHA,
      results: { ...ALL_PASS, 'gatekeeper-first-launch': 'unproven' },
    });
    expect(passed).toBe(true);
    expect(verdictFile).toBe('verification-verdict-dmg-previous.json');
    expect(document).toMatchObject({ version: VERSION, role: 'dmg', combination: 'dmg-previous', sha256: SHA, passed: true });
    expect(document.steps['gatekeeper-first-launch']).toBe('unproven');
    expect(document.unprovenReasons).toEqual({ 'gatekeeper-first-launch': GATEKEEPER_UNPROVEN_REASON });
  });

  it('fails on a step the run never reached, naming the first', () => {
    const { results } = { results: { ...ALL_PASS, 'gatekeeper-first-launch': 'unproven' } } as { results: Record<string, unknown> };
    delete results['cli-command'];
    delete results['uninstall'];
    const { document, passed } = macosVerdict({ version: VERSION, role: 'dmg', runner: 'current', sha256: SHA, results });
    expect(passed).toBe(false);
    expect(document.failedStep).toBe('cli-command');
  });

  it('records the in-use upgrade not-applicable for the archive, and passes it without one', () => {
    const results: Record<string, unknown> = { ...ALL_PASS, 'gatekeeper-first-launch': 'unproven' };
    delete results['in-use-upgrade'];
    const { document, passed } = macosVerdict({ version: VERSION, role: 'macarchive', runner: 'current', sha256: SHA, results });
    expect(passed).toBe(true);
    expect(document.steps['in-use-upgrade']).toBe('not-applicable');
    expect(document.steps.shortcut).toBe('not-applicable');
  });

  it('never lets another step stand unproven', () => {
    const { document, passed } = macosVerdict({
      version: VERSION,
      role: 'dmg',
      runner: 'current',
      sha256: SHA,
      results: { ...ALL_PASS, reattach: 'unproven' },
    });
    expect(passed).toBe(false);
    expect(document.steps.reattach).toBe('failed');
  });
});

describe('which processes and leftovers are the copy’s', () => {
  const bundle = '/Users/runner/Applications/throng.app';

  it('takes the app, its helpers and the daemon on the bundle’s runtime, by the bundle’s path', () => {
    expect(isThrongProcess({ comm: `${bundle}/Contents/MacOS/throng`, args: `${bundle}/Contents/MacOS/throng` }, bundle)).toBe(true);
    const helper = `${bundle}/Contents/Frameworks/throng Helper (Renderer).app/Contents/MacOS/throng Helper (Renderer)`;
    expect(isThrongProcess({ comm: helper, args: `${helper} --type=renderer` }, bundle)).toBe(true);
    const node = `${bundle}/Contents/Resources/runtime/node`;
    expect(isThrongProcess({ comm: node, args: `${node} ${bundle}/Contents/Resources/app/packages/daemon/dist/main.js` }, bundle)).toBe(true);
  });

  it('leaves another app, and a copy elsewhere whose path merely starts the same way', () => {
    expect(isThrongProcess({ comm: '/Applications/Slack.app/Contents/MacOS/Slack', args: 'Slack' }, bundle)).toBe(false);
    expect(isThrongProcess({ comm: '/Users/runner/Applications/throng.app.old/Contents/MacOS/throng', args: '' }, bundle)).toBe(false);
  });

  it('accepts only the documented leftovers, and never a dev folder (FR-014)', () => {
    expect(undocumentedLibraryEntries(['Application Support/throng', 'Logs/throng', 'Preferences/com.throng.throng.plist'])).toEqual([]);
    expect(undocumentedLibraryEntries(['Application Support/throng', 'Caches/throng-updater', ...DEV_LIBRARY_ENTRIES])).toEqual([
      'Application Support/throng-dev',
      'Caches/throng-updater',
      'Logs/throng-dev',
    ]);
  });

  it('matches the version against the filename without its architecture', () => {
    for (const ext of ['dmg', 'zip']) {
      const installerFilename = versionlessFilename(`throng-${VERSION}-mac-arm64.${ext}`);
      expect(matchReleaseVersions({ installerFilename, packageVersion: VERSION, reportedVersion: VERSION, releaseTag: `v${VERSION}` }).matched).toBe(true);
    }
  });

  it('launches as translocated from where Gatekeeper puts a translocated copy (FR-007)', () => {
    expect(TRANSLOCATED_EXEC_PATH).toContain('/AppTranslocation/');
    expect(TRANSLOCATED_EXEC_PATH.endsWith('/throng.app/Contents/MacOS/throng')).toBe(true);
  });
});

describe('the shared step runner and helpers (verify-package-lib.mjs)', () => {
  const quiet = (): void => {};

  it('records true, false and unproven as the step answered, and anything else as a failure', async () => {
    const results: Record<string, unknown> = {};
    await runStep(results, 'launch', () => true, quiet);
    await runStep(results, 'reattach', async () => false, quiet);
    await runStep(results, 'gatekeeper-first-launch', () => 'unproven', quiet);
    await runStep(results, 'install', () => 'yes', quiet);
    expect(results).toEqual({ launch: true, reattach: false, 'gatekeeper-first-launch': 'unproven', install: false });
  });

  it('records a step that throws as failed, says where, and lets the next step run', async () => {
    const results: Record<string, unknown> = {};
    const lines: string[] = [];
    await runStep(results, 'core-journey', () => Promise.reject(new Error('the daemon did not answer')), (l: string) => lines.push(l));
    await runStep(results, 'cli-command', () => true, quiet);
    expect(results).toEqual({ 'core-journey': false, 'cli-command': true });
    expect(lines[0]).toMatch(/^core-journey: stopped: Error: the daemon did not answer/);
  });

  describe.skipIf(skipOnWindows('serves the daemon on a Unix socket, as macOS does; a Windows host has named pipes'))('against a daemon on a socket', () => {
    let dir: string;
    let server: Server;
    beforeAll(async () => {
      dir = mkdtempSync(join(tmpdir(), 'throng-rpc-'));
      server = createServer((socket) => {
        socket.setEncoding('utf8');
        socket.on('data', (line: string) => {
          const call = JSON.parse(line) as { id: number; method: string };
          const reply = call.method === 'health.ping' ? { result: { pid: 42 } } : { error: { message: 'no such method' } };
          socket.write(`${JSON.stringify({ jsonrpc: '2.0', id: call.id, ...reply })}\n`);
        });
      });
      await new Promise<void>((settle) => server.listen(join(dir, 'd.sock'), settle));
    });
    afterAll(() => {
      server.close();
      rmSync(dir, { recursive: true, force: true });
    });

    it('answers with the result, and rejects with the daemon’s error, naming the method', async () => {
      const rpc = createRpc(join(dir, 'd.sock'));
      await expect(rpc('health.ping')).resolves.toEqual({ pid: 42 });
      await expect(rpc('projects.nonesuch')).rejects.toThrow('projects.nonesuch: no such method');
    });

    it('rejects when nothing is listening', async () => {
      await expect(createRpc(join(dir, 'absent.sock'))('health.ping', {}, 1000)).rejects.toThrow();
    });
  });

  it('sees a file written in a snapshot it was not in (no-write)', () => {
    const root = mkdtempSync(join(tmpdir(), 'throng-snap-'));
    try {
      writeFileSync(join(root, 'a'), '1');
      const before = snapshot(root);
      expect(snapshot(root)).toBe(before);
      utimesSync(join(root, 'a'), new Date(2001, 1, 1), new Date(2001, 1, 1));
      expect(snapshot(root)).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
