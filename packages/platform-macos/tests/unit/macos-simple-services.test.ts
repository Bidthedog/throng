import { describe, expect, it } from 'vitest';
import { runExecutableExtensionsContract, runPlatformInfoContract, runRefusedUriSchemesContract } from '@throng/core/testing';
import {
  MacosExecutableExtensions,
  MacosFileManagerRegistration,
  MacosOsPropertiesDialog,
  MacosPlatformInfo,
  MacosRefusedUriSchemes,
} from '../../src/macos-simple-services.js';

/** These seams are pure rules, so their shared contracts run here, on every host, rather than on a Mac only. */
describe('macOS simple services (070 FR-013, FR-023, FR-024, research R11, R13)', () => {
  it('platform info names macOS', () => {
    runPlatformInfoContract(() => new MacosPlatformInfo());
    expect(new MacosPlatformInfo().osName()).toBe('macos');
    expect(new MacosPlatformInfo().pathSeparator()).toBe('/');
  });

  it('executable extensions pass the shared contract and include what Finder would run', () => {
    runExecutableExtensionsContract(() => new MacosExecutableExtensions());
    const ext = new MacosExecutableExtensions();
    for (const file of ['Tool.app', 'run.command', 'Install.pkg', 'Bundle.mpkg', 'Flow.workflow', 'x.terminal', 'y.tool']) {
      expect(ext.isExecutable(`/Users/dev/${file}`)).toBe(true);
    }
    expect(ext.isExecutable('/Users/dev/Tool.app/')).toBe(false);
    expect(ext.isExecutable('/Users/dev/notes.md')).toBe(false);
  });

  it('refused URI schemes pass the shared contract and include the ones that configure or install', () => {
    runRefusedUriSchemesContract(() => new MacosRefusedUriSchemes());
    const refused = new MacosRefusedUriSchemes().refusedSchemes();
    for (const scheme of ['x-apple.systempreferences', 'x-apple-helpbasic', 'applescript', 'itms-services', 'macappstore']) {
      expect(refused.has(scheme)).toBe(true);
    }
  });

  it('report the OS properties dialog as absent, pointing at Finder', async () => {
    const dialog = new MacosOsPropertiesDialog();
    expect(dialog.available).toBe(false);
    expect(await dialog.show('/Users/dev/a.txt')).toEqual({ ok: false, osReason: expect.stringMatching(/Finder.s Get Info/) });
  });

  it('report the file-manager item as unavailable, with its reason', async () => {
    const registration = new MacosFileManagerRegistration();
    expect(await registration.status()).toEqual({ state: 'unavailable', reason: expect.stringMatching(/Finder/) });
    expect(await registration.setEnabled(true)).toEqual(await registration.status());
  });
});
