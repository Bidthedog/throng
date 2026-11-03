// `npm run start:ui`: say what is missing in plain words, then hand over to Electron (spec 062 FR-004).
import { spawn } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
import { checkoutNamedByProfile, devSettingsPath, displayArguments, preflightProblems } from './preflight-start-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const electron = createRequire(import.meta.url)('electron');

const readOr = (path, fallback) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return fallback;
  }
};

function installedProfiles() {
  const dir = '/etc/apparmor.d';
  let names;
  try {
    names = readdirSync(dir).filter((n) => n.startsWith('throng-dev-'));
  } catch {
    return [];
  }
  return names.map((n) => checkoutNamedByProfile(readOr(join(dir, n), ''))).filter((c) => c !== null);
}

function helperIsSetuid() {
  try {
    const info = statSync(join(dirname(electron), 'chrome-sandbox'));
    return info.uid === 0 && (info.mode & 0o4000) !== 0;
  } catch {
    return false;
  }
}

if (process.platform === 'linux') {
  const problems = preflightProblems({
    platform: process.platform,
    uid: process.getuid?.(),
    restrictUserns: readOr('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', ''),
    sandboxHelperSetuid: helperIsSetuid(),
    root,
    installedProfiles: installedProfiles(),
    env: process.env,
  });
  if (problems.length > 0) {
    for (const problem of problems) console.error(`\n${problem}`);
    console.error('');
    process.exit(1);
  }
}

const display = displayArguments(process.platform, readOr(devSettingsPath(process.env, homedir()), ''));
const child = spawn(electron, [...display, 'packages/ui/dist/main/main.js', ...process.argv.slice(2)], { cwd: root, stdio: 'inherit' });
child.on('error', (error) => {
  console.error(`Could not start Electron: ${error.message}`);
  process.exit(1);
});
child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
