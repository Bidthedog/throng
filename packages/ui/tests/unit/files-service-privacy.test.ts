/**
 * 070 FR-025 (T033): a folder macOS withholds under its privacy rules answers a listing with a bare `EPERM`, the code an
 * ACL refusal gives. Main's `failure` must hand core the path and the platform's protected roots, or the refusal reads
 * as a permissions problem and never names the setting that fixes it. The sentence itself is core's
 * (`failure-cause-privacy.test.ts`); this proves main passes what core needs.
 */
import { describe, expect, it } from 'vitest';
import { failure } from '../../src/main/files-service.js';

const ROOTS = ['/Users/dev/Desktop', '/Users/dev/Documents', '/Users/dev/Downloads'];

function eperm(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`EPERM: operation not permitted, scandir '${path}'`), { code: 'EPERM', path });
}

describe('failure, for a listing macOS withholds', () => {
  it('is privacy-withheld, named by the protected folder, when the path lies under a protected root', () => {
    const envelope = failure(eperm('/Users/dev/Documents/work/src'), 'access', undefined, ROOTS);
    expect(envelope.cause?.kind).toBe('privacy-withheld');
    expect(envelope.cause?.subject).toBe('Documents');
    expect(envelope.error).toContain('System Settings');
    expect(envelope.error).not.toContain('/Users/dev');
  });

  it('stays a permissions failure outside every protected root, and with no roots (Windows, Linux)', () => {
    expect(failure(eperm('/Users/dev/code/src'), 'access', undefined, ROOTS).cause?.kind).toBe('permission-denied');
    expect(failure(eperm('/Users/dev/Documents/src'), 'access').cause?.kind).toBe('permission-denied');
  });
});
