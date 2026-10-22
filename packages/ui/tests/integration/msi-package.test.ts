import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { declareArtifactSet } from '@throng/core';

/**
 * 058 FR-006 — a per-user MSI install never requests elevation. A dual-purpose package can only start
 * unelevated if its summary information says so: the word-count property (PID_WORDCOUNT = 15) has bit
 * 8 set when "elevated privileges are not required". Without it Windows raises a UAC prompt for every
 * run, per-user included, before a single dialog — and the first measurement of the template's own
 * output was exactly that (word count 2).
 *
 * Layer: integration — it reads the real built package, which no unit test has. It only READS the
 * database (Windows Installer's COM automation, read-only); it never installs or runs it, which is the
 * release matrix's job. It is skipped, with the reason in the test's name, wherever there is no built
 * MSI to read or the platform cannot read one.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const version = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')).version as string;
const msi = declareArtifactSet(version).artifacts.find((a) => a.role === 'msi')!;
const msiPath = join(repoRoot, 'dist', 'installer', msi.filename);

const skipReason =
  process.platform !== 'win32'
    ? 'Windows Installer automation is Windows-only'
    : !existsSync(msiPath)
      ? `${msi.filename} is not built — run npm run package first`
      : null;

/** Run a read-only Windows Installer query against the built package and return its output. */
function readPackage(script: string): string {
  const encoded = Buffer.from(
    `$ErrorActionPreference = 'Stop'\n$installer = New-Object -ComObject WindowsInstaller.Installer\n` +
      `$db = $installer.GetType().InvokeMember('OpenDatabase', 'InvokeMethod', $null, $installer, @($env:THRONG_MSI, 0))\n${script}`,
    'utf16le',
  ).toString('base64');
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded], {
    encoding: 'utf8',
    env: { ...process.env, THRONG_MSI: msiPath },
  }).trim();
}

const WORD_COUNT = `$si = $db.GetType().InvokeMember('SummaryInformation', 'GetProperty', $null, $db, @(0))
$si.GetType().InvokeMember('Property', 'GetProperty', $null, $si, @(15))`;

const PROPERTY = (name: string) => `$view = $db.GetType().InvokeMember('OpenView', 'InvokeMethod', $null, $db, @("SELECT Value FROM Property WHERE Property='${name}'"))
$view.GetType().InvokeMember('Execute', 'InvokeMethod', $null, $view, $null) | Out-Null
$rec = $view.GetType().InvokeMember('Fetch', 'InvokeMethod', $null, $view, $null)
if ($rec) { $rec.GetType().InvokeMember('StringData', 'GetProperty', $null, $rec, @(1)) } else { '<absent>' }`;

describe(skipReason ? `the built MSI (skipped: ${skipReason})` : 'the built MSI (058 FR-006)', () => {
  it.skipIf(skipReason !== null)('does not require elevated privileges to start (summary word count bit 8)', () => {
    const wordCount = Number(readPackage(WORD_COUNT));
    expect(Number.isInteger(wordCount)).toBe(true);
    expect(wordCount & 8).toBe(8);
  });

  it.skipIf(skipReason !== null)('is dual-purpose: ALLUSERS=2, so the scope is decided at install time', () => {
    expect(readPackage(PROPERTY('ALLUSERS'))).toBe('2');
  });

  it.skipIf(skipReason !== null)('ships no MSIINSTALLPERUSER default, so an elevated run can default to machine-wide', () => {
    expect(readPackage(PROPERTY('MSIINSTALLPERUSER'))).toBe('<absent>');
  });
});
