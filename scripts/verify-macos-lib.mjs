// The decisions behind verify-macos-package.mjs (070 FR-010, research R26), kept apart from the harness so they can be
// tested on a machine that is not a Mac: what the command line asks for, which processes are this copy's, which
// leftovers are documented, and the verdict itself.
import { GATEKEEPER_UNPROVEN_REASON, MACOS_RUNNER_SLOTS, buildArtifactVerdict, combinationsOf, declareArtifactSet } from '@throng/core';

const ROLES = ['dmg', 'macarchive'];

const USAGE =
  'usage: verify-macos-package.mjs <artifact> --role dmg|macarchive --runner current|previous --expected-version V ' +
  '--verdict-out <file> [--older <older .dmg or .zip>]   (the dmg needs --older for its in-use upgrade)';

/**
 * What the harness was asked to do, or why it cannot be done (exit 2).
 *
 * `--runner` names which supported macOS release this machine is (`current` or `previous`), because each release's
 * verdict is a combination of its own (`dmg-current`), never the runner label: that lives in .github/macos-runners.json.
 *
 * @param {string[]} argv the arguments after the script
 */
export function parseMacosVerifyArgs(argv) {
  const flag = (name) => {
    const i = argv.indexOf(name);
    return i === -1 ? undefined : argv[i + 1];
  };
  const artifact = argv[0] !== undefined && !argv[0].startsWith('--') ? argv[0] : undefined;
  const role = flag('--role');
  const runner = flag('--runner');
  const expectedVersion = flag('--expected-version');
  const verdictOut = flag('--verdict-out');
  const older = flag('--older');
  const refuse = (why) => ({ ok: false, code: 2, message: `[verify-macos] ${why}\n${USAGE}` });

  if (!artifact) return refuse('no artifact named');
  if (!ROLES.includes(role)) return refuse(`--role must be one of ${ROLES.join(', ')}, not ${role ?? 'nothing'}`);
  if (!MACOS_RUNNER_SLOTS.includes(runner)) return refuse(`--runner must be one of ${MACOS_RUNNER_SLOTS.join(', ')}, not ${runner ?? 'nothing'}`);
  if (!expectedVersion) return refuse('no --expected-version');
  if (!verdictOut) return refuse('no --verdict-out');
  if (role === 'dmg' && !older) return refuse('the dmg needs --older for the upgrade over a running copy');
  if (older !== undefined && !/\.(dmg|zip)$/.test(older)) return refuse(`--older must be a .dmg or a .zip, not ${older}`);
  return { ok: true, artifact, role, runner, expectedVersion, verdictOut, older };
}

/**
 * The verdict document for one copy on one release, as the publish gate reads it. A step the run never reached has no
 * result and fails; the Gatekeeper first launch is unproven, with its reason, because no hosted runner can click Open
 * Anyway (RUNNER_LIMITED_STEPS).
 *
 * @param {{version: string, role: string, runner: string, sha256: string, results: Record<string, boolean | 'unproven'>}} m
 */
export function macosVerdict({ version, role, runner, sha256, results }) {
  const combination = combinationsOf(declareArtifactSet(version)).find((c) => c.role === role && c.runner === runner);
  if (!combination) throw new Error(`no macOS combination for ${role} on ${runner}`);
  const verdict = buildArtifactVerdict(combination, sha256, results, { 'gatekeeper-first-launch': GATEKEEPER_UNPROVEN_REASON });
  return { document: { version, ...verdict }, verdictFile: combination.verdictFile, passed: verdict.passed };
}

/**
 * Is this process this copy's? Its executable is inside the bundle, or its command line names a file inside it (the
 * daemon runs under the bundle's own runtime, `…/throng.app/Contents/Resources/runtime/node …/daemon/dist/main.js`).
 * Matched by the bundle's path, because every other Electron app on the Mac has the same helper names.
 *
 * @param {{comm: string, args: string}} row a row of scripts/process-table.mjs
 * @param {string} bundle the `.app`, absolute
 */
export function isThrongProcess(row, bundle) {
  return row.comm.startsWith(`${bundle}/`) || row.args.includes(`${bundle}/`);
}

/** The filename without the architecture, which the version matcher would read as part of the prerelease. */
export const versionlessFilename = (filename) => filename.replace(/-mac-arm64\.(dmg|zip)$/, '.pkg');

/**
 * What a copy may leave in `~/Library` after it is deleted (research R5): the data and settings, the logs, and what
 * macOS itself writes for any app — preferences, saved window state, the URL cache. Anything else naming throng is
 * residue. `docs/install-macos.md` lists the same entries for a person removing throng by hand.
 */
export const DOCUMENTED_LIBRARY_ENTRIES = [
  'Application Support/throng',
  'Logs/throng',
  'Caches/throng',
  'Caches/com.throng.throng',
  'Preferences/com.throng.throng.plist',
  'Saved Application State/com.throng.throng.savedState',
  'HTTPStorages/com.throng.throng',
  'HTTPStorages/com.throng.throng.binarycookies',
];

/** The `~/Library` folders whose entries the residue scan reads. */
export const LIBRARY_FOLDERS_SCANNED = ['Application Support', 'Caches', 'Logs', 'Preferences', 'Saved Application State', 'HTTPStorages', 'WebKit', 'Containers'];

/**
 * The entries naming throng that nothing documents. A dev folder (`throng-dev`) is always one: a packaged copy that
 * wrote there was running in dev mode (FR-014).
 *
 * @param {string[]} found `~/Library`-relative paths, `Caches/com.throng.throng` form, of every entry naming throng
 */
export function undocumentedLibraryEntries(found) {
  return found.filter((entry) => !DOCUMENTED_LIBRARY_ENTRIES.includes(entry)).sort();
}

/** Where the dev instance keeps its folders; none may appear on a machine that only ran the packaged copy. */
export const DEV_LIBRARY_ENTRIES = ['Application Support/throng-dev', 'Logs/throng-dev'];

/**
 * The path the packaged app is told it runs from, through T035's THRONG_TEST_EXEC_PATH seam, to prove a translocated
 * launch refuses (FR-007). Shaped as Gatekeeper's App Translocation shapes it: a read-only mount under a random folder.
 */
export const TRANSLOCATED_EXEC_PATH =
  '/private/var/folders/zz/zyxvpxvq6csfxvn_n0000000000000/T/AppTranslocation/0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9/d/throng.app/Contents/MacOS/throng';
