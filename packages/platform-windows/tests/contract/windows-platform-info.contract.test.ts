import { describe, it, expect } from 'vitest';
import { runPlatformInfoContract } from '@throng/core/testing';
import { WindowsPlatformInfo } from '@throng/platform-windows';

describe('WindowsPlatformInfo', () => {
  it('satisfies the shared IPlatformInfo contract', () => {
    expect(() => runPlatformInfoContract(() => new WindowsPlatformInfo())).not.toThrow();
  });

  it('reports the Windows OS name', () => {
    expect(new WindowsPlatformInfo().osName()).toBe('windows');
  });

  it('reports the Windows path separator', () => {
    expect(new WindowsPlatformInfo().pathSeparator()).toBe('\\');
  });
});
