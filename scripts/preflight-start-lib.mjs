// The checks `npm run start:ui` makes before handing over to Electron (spec 062 FR-004). Electron aborts in native code
// on a sandbox it cannot use, and as root, before any throng JavaScript runs, so the app's own failure model cannot
// report either one. A separate module so the decisions can be tested without a machine in each state.

/** The checkout whose profile covers `root`: a worktree is covered by its main checkout's profile. */
export function mainCheckoutOf(root) {
  const at = root.indexOf('/.claude/worktrees/');
  return at === -1 ? root : root.slice(0, at);
}

/**
 * What stops Electron from starting here, as words for the developer. Empty means go.
 *
 * @param {object} m what was observed on this machine
 * @param {string} m.platform `process.platform`
 * @param {number|undefined} m.uid the effective user id
 * @param {string} m.restrictUserns contents of the kernel's restriction setting; '' when the setting does not exist
 * @param {boolean} m.sandboxHelperSetuid the helper is root-owned and setuid, which works without a profile
 * @param {string} m.root this checkout
 * @param {readonly string[]} m.installedProfiles the checkout each installed throng profile names
 * @param {{DISPLAY?: string, WAYLAND_DISPLAY?: string}} m.env
 */
export function preflightProblems(m) {
  if (m.platform !== 'linux') return [];
  if (m.uid === 0) {
    return ['throng will not run as root. Start it as your normal user, and use sudo inside a terminal when a command needs it.'];
  }
  const problems = [];
  if (!m.env.DISPLAY && !m.env.WAYLAND_DISPLAY) {
    problems.push('No desktop session was found: neither DISPLAY nor WAYLAND_DISPLAY is set. Start throng from inside your desktop.');
  }
  const covered = m.installedProfiles.includes(mainCheckoutOf(m.root));
  if (m.restrictUserns.trim() === '1' && !m.sandboxHelperSetuid && !covered) {
    problems.push(
      'This machine restricts the sandbox Electron needs, and throng keeps that sandbox on. Allow it for this checkout, once, with:\n' +
        `  sudo ${m.root}/scripts/linux/apparmor-profile.sh install\n` +
        'That adds one AppArmor profile for this checkout\'s Electron and changes nothing system-wide. See docs/installation.md.',
    );
  }
  return problems;
}

/**
 * Chromium picks its display backend before any of main's JavaScript runs, so XWayland has to be asked for on the real
 * command line (spec 062 FR-028). Main also appends the switch, for what reads it later, but that alone comes too late.
 *
 * @param {string} platform `process.platform`
 * @param {string} settingsText contents of settings.json; '' when there is none
 */
export function displayArguments(platform, settingsText) {
  if (platform !== 'linux') return [];
  let nativeWayland = false;
  try {
    nativeWayland = JSON.parse(settingsText)?.window?.nativeWayland === true;
  } catch {
    // Missing or malformed: the default, as the settings store would answer.
  }
  return nativeWayland ? [] : ['--ozone-platform=x11'];
}

/** The dev instance's settings file: the same rule as the app's folders. */
export function devSettingsPath(env, home) {
  const root =
    env.THRONG_CONFIG_ROOT ?? `${env.XDG_CONFIG_HOME?.startsWith('/') ? env.XDG_CONFIG_HOME : `${home}/.config`}/throng-dev`;
  return `${root}/settings.json`;
}

/** The checkout named by an installed profile's text, or null when it is not one of ours. */
export function checkoutNamedByProfile(text) {
  return /^# throng-checkout: (.+)$/m.exec(text)?.[1] ?? null;
}
