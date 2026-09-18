import { describe, it, expect } from 'vitest';
import { runExecutableExtensionsContract } from '@throng/core/testing';
import { WindowsExecutableExtensions } from '@throng/platform-windows';

/**
 * 045 FR-039a — `contracts/platform-ports.md` §2.
 *
 * The shared suite proves the shape of the rule. These cases prove the Windows CONTENT: the
 * extensions the OS runs, and the one thing the shared suite cannot express — that `PATHEXT` is
 * read **per call**, which is FR-039a's "without a restart".
 *
 * The environment is injected rather than read from `process.env`, so a fake can add and remove an
 * entry without mutating the real one. That is also what makes the per-call reading observable at
 * all: a snapshot taken in the constructor would pass every other case here and fail the user.
 */
describe('WindowsExecutableExtensions', () => {
  it('satisfies the shared IExecutableExtensions contract (EX1\u2013EX7)', () => {
    expect(() => runExecutableExtensionsContract(() => new WindowsExecutableExtensions())).not.toThrow();
  });

  describe('the extensions Windows runs', () => {
    const subject = new WindowsExecutableExtensions();

    it('classifies the PATHEXT set', () => {
      for (const p of ['setup.exe', 'build.bat', 'go.cmd', 'x.com', 'x.vbs', 'x.msc']) {
        expect(subject.isExecutable(p), p).toBe(true);
      }
    });

    it('classifies the handler-launched set PATHEXT does not carry', () => {
      for (const p of ['deploy.ps1', 'shortcut.lnk', 'installer.msi', 'saver.scr', 'panel.cpl']) {
        expect(subject.isExecutable(p), p).toBe(true);
      }
    });

    it('ignores case, as Windows does', () => {
      expect(subject.isExecutable('SETUP.EXE')).toBe(true);
      expect(subject.isExecutable('Setup.Exe')).toBe(true);
    });

    it('leaves ordinary documents alone', () => {
      for (const p of ['notes.txt', 'README.md', 'src/foo.ts', 'package.json', 'image.png']) {
        expect(subject.isExecutable(p), p).toBe(false);
      }
    });

    it('a folder is never executable, whatever it is named', () => {
      expect(subject.isExecutable('C:\\tools\\setup.exe\\')).toBe(false);
      expect(subject.isExecutable('C:\\tools\\bin')).toBe(false);
    });

    it('reports the set it uses, and every member of it is classified executable', () => {
      const reported = subject.executableExtensions();
      expect(reported.length).toBeGreaterThan(10);
      for (const ext of reported) expect(subject.isExecutable(`x${ext}`), ext).toBe(true);
    });
  });

  describe("PATHEXT is read PER CALL \u2014 FR-039a's \u201cwithout a restart\u201d", () => {
    it('an extension the environment ADDS becomes executable, with no new instance', () => {
      const env: Record<string, string | undefined> = { PATHEXT: '.COM;.EXE;.BAT' };
      const subject = new WindowsExecutableExtensions(() => env);
      expect(subject.isExecutable('macro.wsf')).toBe(false);
      env.PATHEXT = '.COM;.EXE;.BAT;.WSF';
      expect(subject.isExecutable('macro.wsf')).toBe(true);
      expect(subject.executableExtensions()).toContain('.wsf');
    });

    it('an extension the environment REMOVES stops being executable, with no new instance', () => {
      const env: Record<string, string | undefined> = { PATHEXT: '.COM;.EXE;.BAT' };
      const subject = new WindowsExecutableExtensions(() => env);
      expect(subject.isExecutable('build.bat')).toBe(true);
      env.PATHEXT = '.COM;.EXE';
      expect(subject.isExecutable('build.bat')).toBe(false);
    });

    it('the declared handler-launched set survives a PATHEXT that omits it', () => {
      // `.lnk` and `.msi` are never in PATHEXT; Windows launches them through a handler. Losing
      // them when the user trims PATHEXT would make a Ctrl+click run a shortcut.
      const subject = new WindowsExecutableExtensions(() => ({ PATHEXT: '.EXE' }));
      expect(subject.isExecutable('shortcut.lnk')).toBe(true);
      expect(subject.isExecutable('installer.msi')).toBe(true);
    });

    it('an absent or empty PATHEXT still leaves the declared set in force', () => {
      const none = new WindowsExecutableExtensions(() => ({}));
      expect(none.isExecutable('shortcut.lnk')).toBe(true);
      expect(none.executableExtensions().length).toBeGreaterThan(0);
      const empty = new WindowsExecutableExtensions(() => ({ PATHEXT: '' }));
      expect(empty.isExecutable('shortcut.lnk')).toBe(true);
    });

    it('a PATHEXT entry written without its dot, or with stray spaces, is still honoured', () => {
      const subject = new WindowsExecutableExtensions(() => ({ PATHEXT: 'EXE; .BAT ;.CMD' }));
      expect(subject.isExecutable('a.exe')).toBe(true);
      expect(subject.isExecutable('a.bat')).toBe(true);
      expect(subject.isExecutable('a.cmd')).toBe(true);
    });
  });
});
