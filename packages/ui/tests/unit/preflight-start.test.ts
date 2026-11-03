import { describe, expect, it } from 'vitest';
import { checkoutNamedByProfile, devSettingsPath, displayArguments, mainCheckoutOf, preflightProblems } from '../../../../scripts/preflight-start-lib.mjs';

const machine = {
  platform: 'linux',
  uid: 1000,
  restrictUserns: '1\n',
  sandboxHelperSetuid: false,
  root: '/src/throng',
  installedProfiles: ['/src/throng'],
  env: { DISPLAY: ':0' },
};

describe('preflight before Electron starts (062 FR-002, FR-004, FR-019)', () => {
  it('lets a prepared machine through', () => {
    expect(preflightProblems(machine)).toEqual([]);
  });

  it('never stands in the way off Linux', () => {
    expect(preflightProblems({ ...machine, platform: 'win32', uid: undefined, installedProfiles: [], env: {} })).toEqual([]);
  });

  it('names the one command when the sandbox is restricted and this checkout has no profile', () => {
    const [problem] = preflightProblems({ ...machine, installedProfiles: ['/elsewhere/throng'] });
    expect(problem).toContain('sudo /src/throng/scripts/linux/apparmor-profile.sh install');
  });

  it('accepts a worktree under a covered checkout, and names the script in the worktree when it is not', () => {
    // The main checkout may be on a branch that does not have the script yet.
    const root = '/src/throng/.claude/worktrees/feature';
    expect(preflightProblems({ ...machine, root })).toEqual([]);
    expect(preflightProblems({ ...machine, root, installedProfiles: [] })[0]).toContain(`sudo ${root}/scripts/linux/apparmor-profile.sh install`);
  });

  it('asks for nothing on a machine with no restriction, or a setuid helper', () => {
    expect(preflightProblems({ ...machine, restrictUserns: '', installedProfiles: [] })).toEqual([]);
    expect(preflightProblems({ ...machine, restrictUserns: '0', installedProfiles: [] })).toEqual([]);
    expect(preflightProblems({ ...machine, sandboxHelperSetuid: true, installedProfiles: [] })).toEqual([]);
  });

  it('refuses root with the plain message, and nothing else', () => {
    const problems = preflightProblems({ ...machine, uid: 0 });
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/normal user.*sudo inside a terminal/);
  });

  it('says so when there is no desktop to open a window on', () => {
    expect(preflightProblems({ ...machine, env: {} })[0]).toContain('DISPLAY');
    expect(preflightProblems({ ...machine, env: { WAYLAND_DISPLAY: 'wayland-0' } })).toEqual([]);
  });

  it('asks for XWayland on the real command line unless the user chose native Wayland (FR-028)', () => {
    expect(displayArguments('linux', '')).toEqual(['--ozone-platform=x11']);
    expect(displayArguments('linux', 'not json')).toEqual(['--ozone-platform=x11']);
    expect(displayArguments('linux', '{"window":{"nativeWayland":false}}')).toEqual(['--ozone-platform=x11']);
    expect(displayArguments('linux', '{"window":{"nativeWayland":true}}')).toEqual([]);
    expect(displayArguments('win32', '')).toEqual([]);
  });

  it('finds the dev settings as the app does', () => {
    expect(devSettingsPath({}, '/home/u')).toBe('/home/u/.config/throng-dev/settings.json');
    expect(devSettingsPath({ XDG_CONFIG_HOME: '/x' }, '/home/u')).toBe('/x/throng-dev/settings.json');
    expect(devSettingsPath({ XDG_CONFIG_HOME: 'rel' }, '/home/u')).toBe('/home/u/.config/throng-dev/settings.json');
    expect(devSettingsPath({ THRONG_CONFIG_ROOT: '/c' }, '/home/u')).toBe('/c/settings.json');
  });

  it('reads the checkout a profile names, and ignores a file that is not ours', () => {
    expect(checkoutNamedByProfile('# Written by...\n# throng-checkout: /src/throng\nabi <abi/4.0>,')).toBe('/src/throng');
    expect(checkoutNamedByProfile('profile other {}')).toBeNull();
    expect(mainCheckoutOf('/a/b')).toBe('/a/b');
  });
});
