import { describe, expect, it } from 'vitest';
import { causeKey, causeMessage, classifyFailure } from '@throng/core';
import { withHostTraits } from '@throng/core/testing';

/** 070 FR-025, research R14: macOS withholds some folders until the user allows them, and says only EPERM. */
const errno = (code: string): NodeJS.ErrnoException => Object.assign(new Error(`${code}: operation not permitted, scandir`), { code });
const ROOTS = [
  '/Users/dev/Desktop',
  '/Users/dev/Documents',
  '/Users/dev/Downloads',
  '/Users/dev/Library/Mobile Documents/com~apple~CloudDocs',
  '/Volumes',
];

describe('a listing refused under a privacy-protected folder', () => {
  it('is classified as the OS withholding access, naming the protected folder', () => {
    const cause = classifyFailure(errno('EPERM'), {
      subject: 'notes',
      operation: 'access',
      path: '/Users/dev/Documents/work/notes',
      privacyProtectedRoots: ROOTS,
    });
    expect(cause).toMatchObject({ kind: 'privacy-withheld', subject: 'Documents' });
  });

  it('names iCloud Drive by its name, and a volume by the volume', () => {
    const icloud = classifyFailure(errno('EPERM'), {
      subject: 'x',
      operation: 'access',
      path: '/Users/dev/Library/Mobile Documents/com~apple~CloudDocs/p',
      privacyProtectedRoots: ROOTS,
    });
    expect(icloud?.subject).toBe('iCloud Drive');
    const volume = classifyFailure(errno('EPERM'), {
      subject: 'x',
      operation: 'access',
      path: '/Volumes/Work/p',
      privacyProtectedRoots: ROOTS,
    });
    expect(volume?.subject).toBe('Work');
  });

  it('says what is wrong and where the user allows it, in one sentence with no errno and no path', () => {
    const cause = classifyFailure(errno('EPERM'), {
      subject: 'notes',
      operation: 'access',
      path: '/Users/dev/Downloads/notes',
      privacyProtectedRoots: ROOTS,
    })!;
    const text = causeMessage(cause);
    expect(text).toMatch(/^"Downloads" is a folder macOS has not let throng open/);
    expect(text).toMatch(/System Settings/);
    expect(text).toMatch(/Privacy & Security/);
    expect(text).not.toMatch(/EPERM|\/Users/);
  });

  it('is one notice per protected folder, however many listings under it fail', () => {
    const at = (path: string) =>
      causeKey(classifyFailure(errno('EPERM'), { subject: path, operation: 'access', path, privacyProtectedRoots: ROOTS })!);
    expect(at('/Users/dev/Documents/a')).toBe(at('/Users/dev/Documents/b/c'));
    expect(at('/Users/dev/Documents/a')).not.toBe(at('/Users/dev/Desktop/a'));
  });

  it('follows the host’s path rules, so a different case of the folder is the same folder on macOS', () => {
    withHostTraits('macos', () => {
      const cause = classifyFailure(errno('EPERM'), {
        subject: 'x',
        operation: 'access',
        path: '/users/dev/documents/x',
        privacyProtectedRoots: ROOTS,
      });
      expect(cause?.kind).toBe('privacy-withheld');
    });
  });

  it('stays a permissions problem outside the protected folders, and a lock failure stays held (FR-039)', () => {
    const outside = { subject: 'p', operation: 'access' as const, path: '/Users/dev/code/p', privacyProtectedRoots: ROOTS };
    expect(classifyFailure(errno('EPERM'), outside)?.kind).toBe('permission-denied');
    expect(
      classifyFailure(errno('EPERM'), { subject: 'p', operation: 'lock', path: '/Users/dev/Documents/p', privacyProtectedRoots: ROOTS })?.kind,
    ).toBe('held');
    expect(classifyFailure(errno('EPERM'), { subject: 'p', operation: 'access' })?.kind).toBe('permission-denied');
    expect(classifyFailure(errno('ENOENT'), { ...outside, path: '/Users/dev/Documents/p' })?.kind).toBe('path-missing');
  });
});
