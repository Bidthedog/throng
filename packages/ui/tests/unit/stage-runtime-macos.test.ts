import { describe, expect, it } from 'vitest';

// @ts-expect-error — plain-JS build script, imported for its pure decision.
import { darwinRuntimeProblem, linkedLibraries } from '../../../../scripts/stage-runtime-lib.mjs';
// @ts-expect-error — plain-JS build script, imported for its pure decisions.
import { devSettingsPath, displayArguments, preflightProblems } from '../../../../scripts/preflight-start-lib.mjs';

/**
 * 070 FR-004, FR-035, FR-043, T037, research R23 — `npm run package` on a Mac stages the runner's arm64 node as
 * `runtime/node`, and only one that runs on a Mac with nothing installed; `npm run start:ui` asks a Mac for none of
 * Linux's sandbox and display preconditions. The `otool -L` text is in the shape macOS prints it.
 *
 * Layer: unit — pure decisions over captured text and plain values.
 */

const OFFICIAL = [
  '/Users/runner/hostedtoolcache/node/24.11.0/arm64/bin/node:',
  '\t/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation (compatibility version 150.0.0, current version 2420.0.0)',
  '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1345.100.2)',
  '\t/usr/lib/libc++.1.dylib (compatibility version 1.0.0, current version 1800.101.0)',
  '',
].join('\n');

const HOMEBREW = [
  '/opt/homebrew/Cellar/node/24.11.0/bin/node:',
  '\t/opt/homebrew/opt/libuv/lib/libuv.1.dylib (compatibility version 2.0.0, current version 2.0.0)',
  '\t/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib (compatibility version 3.0.0, current version 3.0.0)',
  '\t/usr/lib/libSystem.B.dylib (compatibility version 1.0.0, current version 1345.100.2)',
  '',
].join('\n');

describe('the bundled runtime on macOS (070 FR-004, FR-043)', () => {
  it('reads the libraries otool lists, not its heading', () => {
    expect(linkedLibraries(OFFICIAL)).toEqual([
      '/System/Library/Frameworks/CoreFoundation.framework/Versions/A/CoreFoundation',
      '/usr/lib/libSystem.B.dylib',
      '/usr/lib/libc++.1.dylib',
    ]);
  });

  it('stages an official arm64 build, which loads only the system’s libraries', () => {
    expect(darwinRuntimeProblem({ source: '/x/node', arch: 'arm64', otoolText: OFFICIAL })).toBeNull();
  });

  it('refuses a node that loads libraries from outside the system, naming them', () => {
    const problem = darwinRuntimeProblem({ source: '/opt/homebrew/bin/node', arch: 'arm64', otoolText: HOMEBREW });
    expect(problem).toContain('/opt/homebrew/opt/libuv/lib/libuv.1.dylib');
    expect(problem).toContain('/opt/homebrew/opt/openssl@3/lib/libssl.3.dylib');
    expect(problem).not.toContain('libSystem');
    expect(problem).toMatch(/official build/);
  });

  it('refuses an Intel node: no Intel copy is made (FR-003)', () => {
    expect(darwinRuntimeProblem({ source: '/x/node', arch: 'x64', otoolText: OFFICIAL })).toMatch(/Apple silicon only/);
  });

  it('refuses when otool listed nothing, rather than passing an unchecked binary', () => {
    expect(darwinRuntimeProblem({ source: '/x/node', arch: 'arm64', otoolText: '' })).toMatch(/cannot be checked/);
  });
});

describe('npm run start:ui on macOS (070 FR-035)', () => {
  const mac = {
    platform: 'darwin',
    uid: 501,
    restrictUserns: '',
    sandboxHelperSetuid: false,
    root: '/Users/me/throng',
    installedProfiles: [],
    env: {},
  };

  it('asks for no AppArmor profile and no DISPLAY: a Mac has neither, and needs neither', () => {
    expect(preflightProblems(mac)).toEqual([]);
  });

  it('adds no display backend switch', () => {
    expect(displayArguments('darwin', '{"window":{"nativeWayland":false}}')).toEqual([]);
  });

  it('leaves root to the app’s own refusal, which macOS reaches before anything starts (research R10)', () => {
    expect(preflightProblems({ ...mac, uid: 0 })).toEqual([]);
  });

  it('is unaffected by the settings path, which only Linux reads here', () => {
    expect(devSettingsPath({ THRONG_CONFIG_ROOT: '/tmp/x' }, '/Users/me')).toBe('/tmp/x/settings.json');
  });
});
