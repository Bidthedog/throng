import { describe, it, expect } from 'vitest';
import type { IPlatformInfo } from '@throng/core';
import { runPlatformInfoContract } from '@throng/core/testing';

describe('runPlatformInfoContract', () => {
  it('passes for a compliant Windows implementation', () => {
    const compliant: IPlatformInfo = {
      osName: () => 'windows',
      pathSeparator: () => '\\',
    };
    expect(() => runPlatformInfoContract(() => compliant)).not.toThrow();
  });

  it('passes for a compliant POSIX implementation', () => {
    const compliant: IPlatformInfo = {
      osName: () => 'linux',
      pathSeparator: () => '/',
    };
    expect(() => runPlatformInfoContract(() => compliant)).not.toThrow();
  });

  it('fails when osName() returns a value outside the allowed set', () => {
    const bad = {
      osName: () => 'solaris',
      pathSeparator: () => '/',
    } as unknown as IPlatformInfo;
    expect(() => runPlatformInfoContract(() => bad)).toThrow(/osName/);
  });

  it('fails when osName() is not stable across calls', () => {
    let calls = 0;
    const bad: IPlatformInfo = {
      osName: () => (calls++ === 0 ? 'windows' : 'linux'),
      pathSeparator: () => '\\',
    };
    expect(() => runPlatformInfoContract(() => bad)).toThrow(/stable/);
  });

  it('fails when pathSeparator() is inconsistent with osName()', () => {
    const bad: IPlatformInfo = {
      osName: () => 'windows',
      pathSeparator: () => '/',
    };
    expect(() => runPlatformInfoContract(() => bad)).toThrow(/pathSeparator/);
  });

  it('fails when pathSeparator() is not a single character', () => {
    const bad: IPlatformInfo = {
      osName: () => 'linux',
      pathSeparator: () => '//',
    };
    expect(() => runPlatformInfoContract(() => bad)).toThrow(/pathSeparator/);
  });
});
