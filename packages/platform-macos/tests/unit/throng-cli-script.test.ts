import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { skipOnWindows } from '@throng/core/testing';

/**
 * `packaging/macos/throng-cli.sh`, the script `/usr/local/bin/throng` links to (070 FR-024a, research R20). POSIX `sh`
 * with nothing macOS-only in it, so its path handling runs here: a fake bundle whose executable writes down the
 * arguments it was started with.
 */
const SCRIPT = resolve(import.meta.dirname, '../../../../packaging/macos/throng-cli.sh');
const NUL = String.fromCharCode(0);

const run = (file: string, args: string[], cwd: string): Promise<{ code: number; stderr: string }> =>
  new Promise((done) =>
    execFile('/bin/sh', [file, ...args], { cwd }, (error, _stdout, stderr) =>
      done({ code: error ? Number((error as { code?: number }).code ?? 1) : 0, stderr: String(stderr) }),
    ),
  );

const waitForFile = async (path: string): Promise<string> => {
  for (let waited = 0; waited < 5000; waited += 25) {
    if (existsSync(path)) {
      const text = readFileSync(path, 'utf8');
      if (text.endsWith('END\n')) return text;
    }
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error('the bundle executable was never started');
};

describe.skipIf(skipOnWindows('runs a POSIX sh script through real symlinks'))('the throng command script', () => {
  let root: string;
  let record: string;
  let link: string;

  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), 'throng cli ')));
    const contents = join(root, 'Apps', 'throng.app', 'Contents');
    mkdirSync(join(contents, 'MacOS'), { recursive: true });
    mkdirSync(join(contents, 'Resources', 'bin'), { recursive: true });
    copyFileSync(SCRIPT, join(contents, 'Resources', 'bin', 'throng'));
    record = join(root, 'args.txt');
    // The fake app: each argument NUL-terminated, so a space inside one cannot be mistaken for two.
    writeFileSync(
      join(contents, 'MacOS', 'throng'),
      `#!/bin/sh\nfor a in "$@"; do printf '%s\\0' "$a"; done > '${record}.part'\necho END >> '${record}.part'\nmv '${record}.part' '${record}'\n`,
      { mode: 0o755 },
    );
    mkdirSync(join(root, 'usr-local-bin'));
    link = join(root, 'usr-local-bin', 'throng');
    symlinkSync(join(contents, 'Resources', 'bin', 'throng'), link);
    mkdirSync(join(root, 'work', 'My Project'), { recursive: true });
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('starts the bundle’s executable through the link, with every folder made absolute and kept whole', async () => {
    const cwd = join(root, 'work');
    expect((await run(link, ['My Project', '/abs/path', '--flag', '.'], cwd)).code).toBe(0);
    const args = (await waitForFile(record)).replace(/END\n$/, '').split(NUL).slice(0, -1);
    expect(args).toEqual([join(cwd, 'My Project'), '/abs/path', '--flag', `${cwd}/.`]);
  });

  it('follows a link to the link', async () => {
    const second = join(root, 'usr-local-bin', 'tg');
    symlinkSync('throng', second);
    expect((await run(second, [], root)).code).toBe(0);
    expect(await waitForFile(record)).toBe('END\n');
  });

  it('says the app is gone, and fails, when the bundle has moved', async () => {
    rmSync(join(root, 'Apps', 'throng.app', 'Contents', 'MacOS', 'throng'));
    const result = await run(link, [], root);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/Install the 'throng' command again/);
  });
});
