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
