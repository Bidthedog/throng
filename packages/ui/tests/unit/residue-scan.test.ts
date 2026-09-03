import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS build/CI script, imported for its pure scan decision.
import { scanResidue } from '../../../../scripts/residue-scan.mjs';

/**
 * 020 FR-020/024, SC-004 — after an uninstall, nothing throng may remain: no component under the
 * install root and no throng process running. `scanResidue` is the pure decision; the harness
 * supplies the running-process list and install dir.
 */
describe('scanResidue (020 FR-020/024)', () => {
  it('is clean when there is no install dir and no throng process', () => {
    expect(scanResidue(undefined, ['node.exe', 'explorer.exe', 'System'])).toEqual([]);
  });

  it('flags a lingering throng process', () => {
    const offenders = scanResidue(undefined, ['throng.exe', 'explorer.exe']);
    expect(offenders.length).toBe(1);
    expect(offenders[0]).toMatch(/throng/i);
  });

  it('does not flag an unrelated node.exe (the CI runner has one)', () => {
    // Only throng-named processes are residue; a machine-wide node is not.
    expect(scanResidue(undefined, ['node.exe'])).toEqual([]);
    expect(scanResidue('C:\\Programs\\throng', [{ name: 'node.exe', path: 'C:\\Windows\\node.exe' }])).toEqual([]);
  });

  it('flags the detached daemon — a node.exe running from under the install dir (FR-020)', () => {
    const installDir = 'C:\\Users\\me\\AppData\\Local\\Programs\\throng';
    const offenders = scanResidue(installDir, [
      { name: 'node.exe', path: `${installDir}\\resources\\runtime\\node.exe` },
      { name: 'explorer.exe', path: 'C:\\Windows\\explorer.exe' },
    ]);
    expect(offenders.length).toBe(1);
    expect(offenders[0]).toMatch(/daemon/i);
  });
});

/**
 * 042 FR-021 — a throng process is residue when it is THIS installation's, not because it is named
 * throng.
 *
 * Found by verifying the archive artifact on a developer machine: the scan failed because the
 * developer's own throng was open from an unrelated folder. On a clean CI runner nothing else is
 * ever running, so the name-only rule looked correct and was never wrong there — which is exactly
 * why it would have stayed unnoticed until someone tried to reproduce a CI verdict locally.
 *
 * With a root given, attribution is by path. Without one, the old name-only rule stands, because
 * a caller that cannot say where the app lived has nothing better to go on.
 */
describe('scanResidue — attributing a process to the installation being scanned (042 FR-021)', () => {
  const root = 'C:\\Users\\me\\AppData\\Local\\Programs\\throng';

  it('flags a throng process running from under the scanned root', () => {
    const offenders = scanResidue(root, [{ name: 'throng.exe', path: `${root}\\throng.exe` }]);
    expect(offenders.length).toBe(1);
    expect(offenders[0]).toMatch(/throng/i);
  });

  it('does NOT flag a throng running from somewhere else — that is another installation', () => {
    expect(scanResidue(root, [{ name: 'throng.exe', path: 'E:\\tools\\throng\\throng.exe' }])).toEqual([]);
  });

  it('still flags a throng process whose path is unknown, rather than assuming it is innocent', () => {
    expect(scanResidue(root, [{ name: 'throng.exe', path: '' }]).length).toBe(1);
  });

  it('keeps the name-only rule when no root is given', () => {
    expect(scanResidue(undefined, [{ name: 'throng.exe', path: 'E:\\tools\\throng\\throng.exe' }]).length).toBe(1);
  });

  it('flags a survivor from a root that has already been deleted', () => {
    // The folder is gone; the process it started is not. Passing the root even after removal is
    // what keeps this detectable.
    const gone = 'C:\\Temp\\throng-verify-archive-1234';
    const offenders = scanResidue(gone, [{ name: 'throng.exe', path: `${gone}\\throng.exe` }]);
    expect(offenders.length).toBe(1);
  });

  it('is case-insensitive about the path, as Windows is', () => {
    const offenders = scanResidue(root, [{ name: 'throng.exe', path: `${root.toUpperCase()}\\THRONG.EXE` }]);
    expect(offenders.length).toBe(1);
  });
});
