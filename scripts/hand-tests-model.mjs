// The pure half of the hand-test driver (058): what each manual-test group covers, how a run is
// recorded, and the decisions the driver makes that a unit test can show. The driver itself
// (verify-hand-tests.mjs) drives real installers and real dialogs and only ever runs on a hosted
// runner; nothing here touches the machine.
//
// The groups are the manual test plan's MT-01..MT-08 (.claude/.manual-test-plans/). A step is
// `passed`, `failed`, or `runner-gap`: a gap is only for what the runner physically cannot do, and it
// always names the stand-in that was done instead.

/** The steps of each group, in order. `id` is stable (it keys the JSON); `title` quotes the plan. */
export const GROUPS = {
  'MT-01': {
    title: 'Setup, installed just for me',
    steps: [
      { id: 'scope-page-defaults-to-only-me', title: 'Run as a standard account: the scope page opens with "Only for me" selected (step 1)' },
      { id: 'installs-without-elevation', title: 'Finish the wizard: no administrator prompt, and it installs (step 2)' },
      { id: 'shortcut-and-entry', title: 'The "throng (per-user)" shortcut and the "throng <version> (per-user)" entry exist (steps 3, 4)' },
      { id: 'launches-as-the-account', title: 'throng.exe runs as that account with a visible window (step 3)' },
      { id: 'terminal-works', title: 'A terminal works in the account\'s daemon (step 3)' },
      { id: 'other-account-sees-nothing', title: 'A second standard account sees neither the shortcut nor the entry (negative)' },
    ],
  },
  'MT-02': {
    title: 'Setup, installed for everyone',
    steps: [
      { id: 'installs-for-everyone', title: 'As the administrator, choose "Anyone who uses this computer" and finish with Run throng ticked (steps 1, 2)' },
      { id: 'app-started-by-wizard', title: 'throng started when the wizard finished (step 2)' },
      { id: 'integrity-not-high', title: 'The app\'s main process is at Medium integrity (step 2)' },
      { id: 'labels-all-users', title: '"throng (all users)" shortcut and "throng <version> (all users)" entry (step 3)' },
      { id: 'standard-account-launches', title: 'A standard account sees the shortcut, throng starts first time, and a terminal works (step 4)' },
      { id: 'isolation', title: 'Both accounts\' daemons are up at once and each sees only its own data (step 5)' },
      { id: 'no-second-prompt', title: 'No second administrator prompt after the single approval (negative)' },
    ],
  },
  'MT-03': {
    title: 'Declining the administrator prompt',
    steps: [
      { id: 'setup-decline-message', title: 'Setup: choosing "Anyone" as a standard account shows the explanation (step 1)' },
      { id: 'setup-scope-page-still-showing', title: 'Setup: the scope page is still showing after the message is closed (step 2)' },
      { id: 'setup-only-me-installs', title: 'Setup: "Only for me" installs with no prompt (step 3)' },
      { id: 'setup-nothing-before-install', title: 'Setup: nothing in Installed apps and no shortcut until then (negative)' },
      { id: 'msi-decline-message', title: 'MSI: choosing "all users" and declining shows the same explanation (step 4)' },
      { id: 'msi-scope-page-still-showing', title: 'MSI: the scope choice is still showing (step 4)' },
      { id: 'msi-nothing-before-install', title: 'MSI: nothing installed after declining (negative)' },
    ],
  },
  'MT-04': {
    title: 'The MSI, interactively, in both scopes',
    steps: [
      { id: 'standard-account-per-user', title: 'Standard account, default scope: no prompt, "throng MSI (per-user)" labels (step 1)' },
      { id: 'admin-all-users', title: 'Administrator chooses all users: "(all users)" labels (step 2)' },
      { id: 'launch-option', title: 'Finish with the launch option ticked: throng starts (step 3)' },
      { id: 'integrity-not-high', title: 'The launched app runs at Medium integrity (step 3)' },
      { id: 'setup-folders-untouched', title: 'Neither scope touches the setup\'s folders (negative)' },
      { id: 'elevated-wizard-closes-original', title: 'A standard account approving the all-users relaunch: the original window closes quietly (negative)' },
    ],
  },
  'MT-05': {
    title: 'Upgrading or removing an everyone-install someone else is using',
    steps: [
      { id: 'setup-holds-files', title: 'Setup for everyone installed; the standard account\'s daemon holds its files (step 1)' },
      { id: 'setup-interactive-refusal', title: 'Setup, interactive: refuses before changing anything, naming the account, exit 2 (step 2)' },
      { id: 'setup-unattended-3010', title: 'Setup, unattended: exits 3010 and terminates nothing (step 3)' },
      { id: 'setup-restart-and-launch', title: 'Restart; both accounts launch (step 4)' },
      { id: 'msi-interactive-refusal', title: 'MSI, interactive: a message naming the account, and no second notice after it, nothing removed (step 5)' },
      { id: 'msi-unattended-3010', title: 'MSI, unattended: 3010 and nothing terminated (step 5)' },
      { id: 'nothing-closed', title: 'In no step is the standard account\'s throng or terminal closed (negative)' },
    ],
  },
  'MT-06': {
    title: 'Several copies, one running throng',
    steps: [
      { id: 'coexistence-verdict', title: 'Steps 1-5 and 8: covered by the release run\'s coexistence verdict (linked)' },
      { id: 'old-copy-defers', title: 'The previous release\'s throng, started while the current one runs, opens no second window (step 6)' },
      { id: 'old-copy-alone-attaches', title: 'Alone, the previous release starts and attaches to the newer copy\'s daemon, leaving it and its terminal running (step 7)' },
      { id: 'different-build-copy-replaces-daemon', title: 'A current copy of a different build, started alone, replaces the running daemon (FR-021a)' },
    ],
  },
  'MT-07': {
    title: 'Uninstall keeps other people\'s data',
    steps: [
      { id: 'both-accounts-have-data', title: 'Each account creates a project in its own real data folder (steps 1, 2)' },
      { id: 'gui-uninstall-deletes-own-data-only', title: 'The administrator\'s GUI uninstall with "also delete" removes the administrator\'s data and keeps the other account\'s (steps 3, 4)' },
      { id: 'unattended-uninstall-deletes-nothing', title: 'A silent /allusers uninstall deletes neither account\'s data (negative)' },
    ],
  },
  'MT-08': {
    title: 'Downgrading a copy in place',
    steps: [
      { id: 'older-setup-refuses', title: 'The older setup, choosing everyone, refuses saying a newer version is installed (step 1)' },
      { id: 'refusal-removes-nothing', title: 'The refused downgrade removes nothing (negative)' },
      { id: 'older-setup-installs-alongside', title: 'The older setup, choosing only me, installs alongside (step 2)' },
      { id: 'each-copy-reports-its-version', title: 'Each copy reports its own version (step 2)' },
    ],
  },
};

export const STATUSES = ['passed', 'failed', 'runner-gap'];

/**
 * @param {string[]} argv
 * @returns {{ok: true, mode: 'list'} | {ok: true, mode: 'run', group: string, dir: string, outDir: string, version?: string, olderZip?: string} | {ok: false, message: string}}
 */
export function parseHandTestArgs(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] !== undefined && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
  };
  if (argv.includes('--list')) return { ok: true, mode: 'list' };
  const group = flag('--group');
  if (!group || !GROUPS[group]) {
    return { ok: false, message: `--group is required; one of: ${Object.keys(GROUPS).join(', ')} (or --list)` };
  }
  return {
    ok: true,
    mode: 'run',
    group,
    dir: flag('--dir') ?? 'dist/installer',
    outDir: flag('--out-dir') ?? 'hand-test-evidence',
    version: flag('--expected-version'),
    olderZip: flag('--older-zip'),
    olderSetup: flag('--older-setup'),
  };
}

/** The `--list` output: every group and step, so a reviewer can see what a run will claim. */
export function renderList() {
  return Object.entries(GROUPS)
    .map(([id, g]) => [`${id}  ${g.title}`, ...g.steps.map((s) => `    ${s.id.padEnd(40)} ${s.title}`)].join('\n'))
    .join('\n\n');
}

/**
 * A recorder for one group. Every step the group declares must end up with a result: a step that was
 * never reached is `failed` ("did not run"), not absent, so a run that stopped early cannot read green.
 */
export function createRecorder(groupId, version) {
  const group = GROUPS[groupId];
  if (!group) throw new Error(`unknown group ${groupId}`);
  const results = new Map();

  const record = (id, status, reason, extra = {}) => {
    if (!group.steps.some((s) => s.id === id)) throw new Error(`${groupId} has no step '${id}'`);
    if (!STATUSES.includes(status)) throw new Error(`unknown status '${status}'`);
    if (status === 'runner-gap' && !extra.standIn) {
      throw new Error(`${groupId} ${id}: a runner-gap must name the stand-in that was done instead`);
    }
    results.set(id, { status, reason: reason ?? '', ...extra });
  };

  return {
    pass: (id, reason, evidence) => record(id, 'passed', reason, evidence ? { evidence } : {}),
    fail: (id, reason, evidence) => record(id, 'failed', reason, evidence ? { evidence } : {}),
    gap: (id, reason, standIn, evidence) => record(id, 'runner-gap', reason, { standIn, ...(evidence ? { evidence } : {}) }),
    has: (id) => results.has(id),
    toJson() {
      const steps = group.steps.map((s) => ({
        id: s.id,
        title: s.title,
        ...(results.get(s.id) ?? { status: 'failed', reason: 'did not run' }),
      }));
      return {
        group: groupId,
        title: group.title,
        version: version ?? null,
        passed: steps.every((s) => s.status !== 'failed'),
        counts: {
          passed: steps.filter((s) => s.status === 'passed').length,
          failed: steps.filter((s) => s.status === 'failed').length,
          runnerGap: steps.filter((s) => s.status === 'runner-gap').length,
        },
        steps,
      };
    },
  };
}

/**
 * MT-05 stand-in for "restart the VM": the files queued for replacement at the next restart are
 * exactly the ones the running account holds open, and nothing outside the install root.
 *
 * @param {string} pending the PendingFileRenameOperations multi-string, joined with newlines.
 * @param {string} root the install root.
 * @param {string[]} held executable paths the other account's processes are running from.
 */
export function judgePendingRenames(pending, root, held) {
  const normal = (p) => p.replace(/^\\\?\?\\/, '').replace(/^\\\\\?\\/, '').toLowerCase();
  const rootLower = root.toLowerCase().replace(/\\+$/, '');
  // The multi-string alternates source and destination; an empty destination means "delete".
  const sources = pending
    .split(/\r?\n/)
    .map((l) => l.trim())
    // NSIS queues "*1" (replace) entries; strip that flag.
    .map((l) => l.replace(/^\*\d+/, ''))
    .filter((l) => l !== '' && l.startsWith('\\??\\'))
    .map(normal);
  const underRoot = sources.filter((p) => p.startsWith(`${rootLower}\\`));
  const outside = sources.filter((p) => !p.startsWith(`${rootLower}\\`) && p.includes('throng'));
  const missing = held.map((h) => h.toLowerCase()).filter((h) => h.startsWith(`${rootLower}\\`) && !sources.includes(h) && !sources.some((s) => s.startsWith(h)));
  return { ok: underRoot.length > 0 && outside.length === 0 && missing.length === 0, underRoot, outside, missing };
}

/** Does a dialog's text say what a refusal must say: the account, and that nothing was changed? */
export function refusalNamesAccount(text, accountName) {
  return text.toLowerCase().includes(accountName.toLowerCase());
}

/** The account name part of a `DOMAIN\user` string. */
export function accountOf(owner) {
  return owner.includes('\\') ? owner.split('\\').pop() : owner;
}
