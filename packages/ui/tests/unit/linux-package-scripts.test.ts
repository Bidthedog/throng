import { execFileSync, spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { skipUnlessLinux } from '@throng/core/testing';

const PACKAGING = resolve(import.meta.dirname, '../../../../packaging/linux');
const SCRIPTS = ['before-install.sh', 'after-install.sh', 'before-remove.sh', 'after-remove.sh'];

/** The scripts as a package carries them, version filled in as stage-runtime fills it. */
function staged(name: string, version: string, into: string): string {
  const text = readFileSync(join(PACKAGING, name), 'utf8')
    .replaceAll('@VERSION@', version)
    .replaceAll('@PACKAGE_VERSION@', version.replaceAll('-', '~'));
  const file = join(into, `${name}-${version}`);
  writeFileSync(file, text);
  return file;
}

describe.skipIf(skipUnlessLinux('the maintainer scripts run on Linux only'))('the package scripts (063)', () => {
  let scratch: string;
  let prefix: string;
  let payload: string;
  let versions: string;

  const run = (script: string, version: string, ...args: string[]) =>
    spawnSync('sh', [staged(script, version, scratch), ...args], {
      encoding: 'utf8',
      env: { ...process.env, THRONG_PACKAGE_TEST_PREFIX: prefix },
    });

  /** What dpkg and rpm do to a file on upgrade: write a new one, and rename it over the old. */
  const replaceInPayload = (name: string, text: string): void => {
    writeFileSync(join(payload, `${name}.new`), text);
    renameSync(join(payload, `${name}.new`), join(payload, name));
  };

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'throng-pkg-'));
    prefix = join(scratch, 'root');
    payload = join(prefix, 'opt/throng');
    versions = join(prefix, 'opt/throng-versions');
    mkdirSync(join(payload, 'resources'), { recursive: true });
    writeFileSync(join(payload, 'chrome-sandbox'), '');
    writeFileSync(join(payload, 'throng'), '#!/bin/sh\n');
    writeFileSync(join(payload, 'resources/page.js'), 'old');
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('installs a version folder of hard links, and points current and the command at it', () => {
    expect(run('after-install.sh', '1.0.0', 'configure').status).toBe(0);

    expect(statSync(join(versions, '1.0.0/resources/page.js')).ino).toBe(statSync(join(payload, 'resources/page.js')).ino);
    expect(readlinkSync(join(versions, 'current'))).toBe('1.0.0');
    expect(readlinkSync(join(prefix, 'usr/bin/throng'))).toBe(join(versions, 'current/throng'));
  });

  it('can run twice for one version', () => {
    expect(run('after-install.sh', '1.0.0', 'configure').status).toBe(0);
    expect(run('after-install.sh', '1.0.0', 'configure').status).toBe(0);
    expect(readlinkSync(join(versions, 'current'))).toBe('1.0.0');
  });

  it('leaves a version intact when an upgrade replaces its files while it runs (FR-009)', async () => {
    run('after-install.sh', '1.0.0', 'configure');
    // A copy running from the old version folder, as a left-open throng is.
    const running = join(versions, '1.0.0/throng-bin');
    // A shell, because a coreutils `sleep` can be a multi-call binary that refuses another name.
    copyFileSync('/bin/sh', running);
    chmodSync(running, 0o755);
    const child = spawn(running, ['-c', 'read line'], { stdio: ['pipe', 'ignore', 'ignore'] });
    await new Promise((settle) => child.once('spawn', settle));
    try {
      replaceInPayload('resources/page.js', 'new');
      expect(run('after-install.sh', '2.0.0', 'configure').status).toBe(0);

      expect(readFileSync(join(versions, '1.0.0/resources/page.js'), 'utf8')).toBe('old');
      expect(readFileSync(join(versions, '2.0.0/resources/page.js'), 'utf8')).toBe('new');
      expect(readlinkSync(join(versions, 'current'))).toBe('2.0.0');
    } finally {
      child.kill('SIGKILL');
    }
  });

  it('prunes a version once nothing runs from it', () => {
    run('after-install.sh', '1.0.0', 'configure');
    replaceInPayload('resources/page.js', 'new');
    run('after-install.sh', '2.0.0', 'configure');

    expect(existsSync(join(versions, '1.0.0'))).toBe(false);
    expect(existsSync(join(versions, '2.0.0'))).toBe(true);
  });

  // rpm passes 1 or 2 to posttrans, the same as to post, so post has a script of its own. Measured on Fedora 45.
  it.each(['1', '2'])('runs on the .rpm posttrans, which passes "%s"', (argument) => {
    expect(run('after-install.sh', '1.0.0', argument).status).toBe(0);
    expect(existsSync(join(versions, '1.0.0'))).toBe(true);
  });

  it('does nothing when dpkg backs out of a failed upgrade', () => {
    expect(run('after-install.sh', '1.0.0', 'abort-upgrade', '0.9.0').status).toBe(0);
    expect(existsSync(versions)).toBe(false);
  });

  it('leaves nothing world-writable, whatever umask it is called with (FR-005)', () => {
    const script = staged('after-install.sh', '1.0.0', scratch);
    const r = spawnSync('sh', ['-c', 'umask 000; sh "$0" configure', script], {
      encoding: 'utf8',
      env: { ...process.env, THRONG_PACKAGE_TEST_PREFIX: prefix },
    });
    expect(r.status).toBe(0);
    expect(statSync(versions).mode & 0o777).toBe(0o755);
    expect(statSync(join(versions, '1.0.0')).mode & 0o002).toBe(0);
  });

  it.each(['upgrade', '1', 'failed-upgrade'])('keeps everything on "%s"', (argument) => {
    run('after-install.sh', '1.0.0', 'configure');
    expect(run('before-remove.sh', '1.0.0', argument).status).toBe(0);
    expect(run('after-remove.sh', '1.0.0', argument).status).toBe(0);
    expect(existsSync(join(versions, '1.0.0'))).toBe(true);
    expect(existsSync(join(prefix, 'usr/bin/throng'))).toBe(true);
  });

  it.each(['remove', '0'])('removes all it added on "%s" (FR-012)', (argument) => {
    run('after-install.sh', '1.0.0', 'configure');
    expect(run('before-remove.sh', '1.0.0', argument).status).toBe(0);
    expect(run('after-remove.sh', '1.0.0', argument).status).toBe(0);
    expect(existsSync(versions)).toBe(false);
    expect(existsSync(join(prefix, 'usr/bin/throng'))).toBe(false);
    expect(existsSync(payload)).toBe(false);
  });

  it('touches nothing under a home folder, and carries nothing electron-builder or rpm would expand', () => {
    for (const name of SCRIPTS) {
      const text = readFileSync(join(PACKAGING, name), 'utf8');
      expect(text, name).not.toMatch(/\$HOME|\/home\/|\.config|\.local/);
      expect(text, `${name}: electron-builder throws on an unknown macro`).not.toMatch(/\$\{[a-zA-Z]+\}/);
      expect(text, `${name}: rpm expands a percent sign in a scriptlet`).not.toContain('%');
    }
  });

  describe.skipIf(spawnSync('dpkg', ['--version']).status !== 0)('the downgrade refusal (FR-011)', () => {
    it('refuses an older package over a newer one, naming both', () => {
      const r = run('before-install.sh', '1.0.0-alpha11', 'upgrade', '1.0.0~alpha12');
      expect(r.status).toBe(1);
      expect(r.stderr).toContain('1.0.0~alpha12');
      expect(r.stderr).toContain('1.0.0~alpha11');
      expect(r.stderr).toMatch(/remove throng first/);
    });

    it('takes a prerelease as older than its release', () => {
      expect(run('before-install.sh', '1.0.0-alpha12', 'upgrade', '1.0.0').status).toBe(1);
    });

    it.each([
      ['an older version', '1.0.0-alpha12', 'upgrade', '1.0.0~alpha11'],
      ['the same version', '1.0.0-alpha12', 'upgrade', '1.0.0~alpha12'],
      ['a prerelease to its release', '1.0.0', 'upgrade', '1.0.0~alpha12'],
      ['a first install', '1.0.0', 'install', ''],
    ])('lets %s through', (_label, version, action, installed) => {
      expect(run('before-install.sh', version, action, installed).status).toBe(0);
    });
  });
});

describe.skipIf(skipUnlessLinux('the maintainer scripts run on Linux only'))('the .rpm downgrade refusal (FR-011)', () => {
  let scratch: string;

  /** A stand-in `rpm`, naming what is installed and how it compares. The real comparison is proved on Fedora (T013). */
  const runWith = (installed: string, order: string, version: string, ...args: string[]) => {
    const tools = join(scratch, 'tools');
    mkdirSync(tools, { recursive: true });
    writeFileSync(join(tools, 'rpm'), `#!/bin/sh\ncase "$1" in -q) printf '${installed}' ;; --eval) echo "$2" >"${join(tools, 'eval')}"; echo ${order} ;; esac\n`);
    chmodSync(join(tools, 'rpm'), 0o755);
    const r = spawnSync('sh', [staged('before-install.sh', version, scratch), ...args], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${tools}:${process.env.PATH}` },
    });
    return { ...r, evaluated: existsSync(join(tools, 'eval')) ? readFileSync(join(tools, 'eval'), 'utf8') : '' };
  };

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'throng-pkg-'));
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('refuses an older package over a newer one, naming both', () => {
    const r = runWith('1.0.0~alpha12', '1', '0.9.0', '2');
    expect(r.status).toBe(1);
    expect(r.stderr).toContain('1.0.0~alpha12');
    expect(r.stderr).toContain('0.9.0');
    expect(r.evaluated).toContain("rpm.vercmp('1.0.0~alpha12','0.9.0')");
  });

  it.each(['-1', '0'])('lets an upgrade or a reinstall through (%s)', (order) => {
    expect(runWith('0.9.0', order, '1.0.0', '2').status).toBe(0);
  });

  it('is carried by both packages', () => {
    const config = readFileSync(resolve(PACKAGING, '../../electron-builder.yml'), 'utf8');
    expect(config.match(/--before-install=/g)).toHaveLength(2);
  });

  it('does not ask on a first install', () => {
    const r = runWith('', '1', '1.0.0', '1');
    expect(r.status).toBe(0);
    expect(r.evaluated).toBe('');
  });
});

describe.skipIf(skipUnlessLinux('the launcher runs on Linux only'))('the launcher (063 FR-006, FR-008)', () => {
  let scratch: string;
  let folder: string;
  let tools: string;

  /** A package folder whose `throng-bin` reports the arguments it was given. */
  function install(into: string): void {
    mkdirSync(into, { recursive: true });
    copyFileSync(join(PACKAGING, 'launcher.sh'), join(into, 'throng'));
    chmodSync(join(into, 'throng'), 0o755);
    writeFileSync(join(into, 'chrome-sandbox'), '');
    writeFileSync(join(into, 'throng-bin'), '#!/bin/sh\necho "RAN $*"\n');
    chmodSync(join(into, 'throng-bin'), 0o755);
  }

  /** A stand-in `unshare`, so the restriction can be on or off whatever this machine does. */
  function fakeUnshare(exitCode: number): void {
    writeFileSync(join(tools, 'unshare'), `#!/bin/sh\necho "$*" >> "${join(tools, 'unshare.args')}"\nexit ${exitCode}\n`);
    chmodSync(join(tools, 'unshare'), 0o755);
  }

  const launch = (path: string, env: NodeJS.ProcessEnv = {}, ...args: string[]) =>
    spawnSync(path, args, { encoding: 'utf8', env: { PATH: `${tools}:/usr/bin:/bin`, HOME: scratch, ...env } });

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'throng-launcher-'));
    folder = join(scratch, 'throng folder');
    tools = join(scratch, 'tools');
    mkdirSync(tools);
    install(folder);
  });
  afterEach(() => {
    rmSync(scratch, { recursive: true, force: true });
  });

  it('runs the binary with its arguments, from a path with a space', () => {
    fakeUnshare(0);
    const r = launch(join(folder, 'throng'), {}, '--flag', 'two words');
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('RAN');
    expect(r.stdout).toContain('--flag two words');
  });

  it('asks the question a restriction refuses, not the one it lets through', () => {
    fakeUnshare(0);
    launch(join(folder, 'throng'));
    expect(readFileSync(join(tools, 'unshare.args'), 'utf8')).toContain('--user --map-root-user');
  });

  it('under a restriction, stops, keeps the sandbox on, and gives the exact commands for this folder', () => {
    fakeUnshare(1);
    const plain = join(scratch, 'throng-folder');
    install(plain);
    const r = launch(join(plain, 'throng'));
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('RAN');
    expect(r.stderr).toContain(`sudo chown root:root '${join(plain, 'chrome-sandbox')}'`);
    expect(r.stderr).toContain(`sudo chmod 4755 '${join(plain, 'chrome-sandbox')}'`);
    expect(readFileSync(join(PACKAGING, 'launcher.sh'), 'utf8')).not.toContain('--no-sandbox');
  });

  it('under a restriction, in a path with a space, says to move it: the helper cannot run from there', () => {
    fakeUnshare(1);
    const r = launch(join(folder, 'throng'));
    expect(r.status).toBe(1);
    expect(r.stdout).not.toContain('RAN');
    expect(r.stderr).toContain(folder);
    expect(r.stderr).toMatch(/path with no spaces/);
    expect(r.stderr).not.toContain('sudo ');
  });

  it('quotes the commands correctly for a folder with an apostrophe', () => {
    fakeUnshare(1);
    const odd = join(scratch, "it's-here");
    install(odd);
    const line = launch(join(odd, 'throng'))
      .stderr.split('\n')
      .find((l) => l.includes('chmod 4755'))!
      .trim()
      .replace('sudo chmod 4755 ', '');
    expect(execFileSync('sh', ['-c', `printf %s ${line}`], { encoding: 'utf8' })).toBe(join(odd, 'chrome-sandbox'));
  });

  it('follows a symlink to the folder it really lives in, as the command does', () => {
    fakeUnshare(0);
    const link = join(scratch, 'link-to-throng');
    symlinkSync(join(folder, 'throng'), link);
    expect(launch(link).stdout).toContain('RAN');
  });

  describe('the display backend (062 FR-028)', () => {
    const settingsAt = (text: string): void => {
      const root = join(scratch, '.config/throng');
      mkdirSync(root, { recursive: true });
      writeFileSync(join(root, 'settings.json'), text);
    };

    beforeEach(() => fakeUnshare(0));

    it('asks for XWayland by default', () => {
      expect(launch(join(folder, 'throng')).stdout).toContain('--ozone-platform=x11');
    });

    it('stands aside when the user opted in to native Wayland, however the file is spaced', () => {
      settingsAt('{\n  "window": {\n    "nativeWayland":   true\n  }\n}\n');
      expect(launch(join(folder, 'throng')).stdout).not.toContain('--ozone-platform');
    });

    it('asks for XWayland when the setting is off or the file is broken', () => {
      settingsAt('{ "window": { "nativeWayland": false } }');
      expect(launch(join(folder, 'throng')).stdout).toContain('--ozone-platform=x11');
      settingsAt('{ not json');
      expect(launch(join(folder, 'throng')).stdout).toContain('--ozone-platform=x11');
    });

    it('reads the settings from where the app does', () => {
      const custom = join(scratch, 'xdg/throng');
      mkdirSync(custom, { recursive: true });
      writeFileSync(join(custom, 'settings.json'), '{ "window": { "nativeWayland": true } }');
      expect(launch(join(folder, 'throng'), { XDG_CONFIG_HOME: join(scratch, 'xdg') }).stdout).not.toContain('--ozone-platform');
      // A relative XDG_CONFIG_HOME is ignored, as LinuxUserDirectories ignores it.
      settingsAt('{ "window": { "nativeWayland": true } }');
      expect(launch(join(folder, 'throng'), { XDG_CONFIG_HOME: 'relative' }).stdout).not.toContain('--ozone-platform');
    });
  });
});

describe('the afterPack hook (063 research D3)', () => {
  const afterPack = createRequire(import.meta.url)(join(PACKAGING, 'after-pack.cjs')).default as (
    context: unknown,
  ) => Promise<void>;

  it('leaves a Windows build alone', async () => {
    // A context with nothing else on it: touching any of it would throw.
    await expect(afterPack({ electronPlatformName: 'win32' })).resolves.toBeUndefined();
  });

  it.skipIf(skipUnlessLinux('the hook moves a Linux binary'))('puts the launcher where the binary was', async () => {
    const out = mkdtempSync(join(tmpdir(), 'throng-pack-'));
    try {
      writeFileSync(join(out, 'throng'), 'ELF');
      mkdirSync(join(out, 'resources'));
      chmodSync(join(out, 'resources'), 0o777);
      writeFileSync(join(out, 'resources/data.pak'), 'x');
      chmodSync(join(out, 'resources/data.pak'), 0o666);
      writeFileSync(join(out, 'chrome-sandbox'), 'ELF');
      chmodSync(join(out, 'chrome-sandbox'), 0o777);
      chmodSync(join(out, 'throng'), 0o777);
      await afterPack({ electronPlatformName: 'linux', appOutDir: out, packager: { executableName: 'throng' } });
      // Nobody but root may write to an installed copy: Electron's files can arrive world-writable.
      expect(statSync(join(out, 'throng-bin')).mode & 0o777).toBe(0o755);
      expect(statSync(join(out, 'chrome-sandbox')).mode & 0o777).toBe(0o755);
      expect(statSync(join(out, 'resources')).mode & 0o777).toBe(0o755);
      expect(statSync(join(out, 'resources/data.pak')).mode & 0o777).toBe(0o644);
      expect(readFileSync(join(out, 'throng-bin'), 'utf8')).toBe('ELF');
      expect(readFileSync(join(out, 'throng'), 'utf8')).toMatch(/^#!\/bin\/sh/);
      expect(statSync(join(out, 'throng')).mode & 0o111).toBe(0o111);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  });
});
