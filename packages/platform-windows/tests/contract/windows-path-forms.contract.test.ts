import { describe, it, expect } from 'vitest';
import { runPathFormsContract } from '@throng/core/testing';
import { WindowsPathForms } from '@throng/platform-windows';

/**
 * 045 FR-012, FR-025 — `contracts/platform-ports.md` §1.
 *
 * The shared suite proves the relationships any implementation must have. The cases below prove the
 * Windows SPELLINGS, which the shared suite deliberately omits so a future macOS or Linux
 * implementation can pass it without the suite being rewritten (Principle II).
 */
describe('WindowsPathForms', () => {
  it('satisfies the shared IPathForms contract (PF1\u2013PF12)', () => {
    expect(() => runPathFormsContract(() => new WindowsPathForms())).not.toThrow();
  });

  describe('the Git Bash and WSL drive forms', () => {
    const subject = new WindowsPathForms();

    it('maps /d/x to the drive, upper-cased', () => {
      expect(subject.fromDriveForm('/d/x')).toBe('D:\\x');
      expect(subject.fromDriveForm('/d/git/throng/x.ts')).toBe('D:\\git\\throng\\x.ts');
    });

    it('maps the WSL form the same way', () => {
      expect(subject.fromDriveForm('/mnt/d/x')).toBe('D:\\x');
    });

    it('maps a bare drive form to the drive root', () => {
      expect(subject.fromDriveForm('/d')).toBe('D:\\');
      expect(subject.fromDriveForm('/d/')).toBe('D:\\');
    });

    it('refuses anything that is not a drive form', () => {
      expect(subject.fromDriveForm('/etc/hosts')).toBeNull();
      expect(subject.fromDriveForm('/mnt/hosts')).toBeNull();
      expect(subject.fromDriveForm('C:\\x')).toBeNull();
      expect(subject.fromDriveForm('')).toBeNull();
    });
  });

  describe('file: URIs', () => {
    const subject = new WindowsPathForms();

    it('a hostless URI becomes a local path, percent-decoded', () => {
      expect(subject.fromFileUrl('file:///D:/a%20b/c.txt')).toBe('D:\\a b\\c.txt');
      expect(subject.fromFileUrl('file:///C:/Users/dev')).toBe('C:\\Users\\dev');
    });

    it('a URI with a host becomes the UNC location', () => {
      expect(subject.fromFileUrl('file://server/share/x.txt')).toBe('\\\\server\\share\\x.txt');
    });

    it('localhost is the same as no host', () => {
      expect(subject.fromFileUrl('file://localhost/D:/x')).toBe('D:\\x');
    });

    it('refuses every other scheme', () => {
      expect(subject.fromFileUrl('http://x/y')).toBeNull();
      expect(subject.fromFileUrl('javascript:0')).toBeNull();
      expect(subject.fromFileUrl('')).toBeNull();
    });
  });

  describe('mixed separators', () => {
    const subject = new WindowsPathForms();

    it('an answer is spelled with backslashes whatever the input used', () => {
      expect(subject.fromDriveForm('/d/a/b/c.ts')).not.toContain('/');
      expect(subject.fromFileUrl('file:///D:/a/b/c.ts')).not.toContain('/');
    });

    it('a home form accepts either separator and answers in the platform\u2019s own', () => {
      const home = subject.homeDirectory();
      expect(subject.fromHomeForm('~/a/b')).toBe(`${home}\\a\\b`);
      expect(subject.fromHomeForm('~\\a\\b')).toBe(`${home}\\a\\b`);
    });
  });

  describe('the home folder', () => {
    it('is the real one, taken from the OS rather than from an environment guess', () => {
      const home = new WindowsPathForms().homeDirectory();
      expect(home).toMatch(/^[A-Za-z]:\\/);
      expect(home.length).toBeGreaterThan(3);
    });
  });
});
