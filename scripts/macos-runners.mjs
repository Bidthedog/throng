// The macOS runners, named once (070 FR-037, research R25).
//
// `.github/macos-runners.json` is the only place a macOS runner label is written: `{ "current": …, "previous": … }`, one
// for each supported macOS release (FR-003a). Each workflow's `macos-runners` job runs this script and every macOS job
// takes its machine from that job's outputs, so moving the supported range forward is one edit to that file.
//
//   node scripts/macos-runners.mjs >> "$GITHUB_OUTPUT"
//
// prints two outputs, each one line:
//   labels=["<current>","<previous>"]               for a matrix over both releases
//   runners={"current":"<current>","previous":…}    for a job that picks a release by slot (release.yml's verify-macos)
//
// No dependencies, so the job needs no `npm ci`. Exit 1, naming what is wrong, on a file that is not exactly that shape.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** A GitHub-hosted runner label: lower-case words joined by `-` or `.`. Nothing an expression or a shell could read. */
const LABEL = /^[a-z0-9][a-z0-9.-]{0,63}$/;
const SLOTS = ['current', 'previous'];

/**
 * The job outputs for the runner list, or a throw naming what is wrong with it.
 *
 * @param {string} text the contents of `.github/macos-runners.json`
 * @returns {{labels: string[], runners: {current: string, previous: string}}}
 */
export function runnerOutputs(text) {
  const list = JSON.parse(text);
  if (list === null || typeof list !== 'object' || Array.isArray(list)) throw new Error('the runner list is not an object');
  const keys = Object.keys(list).sort();
  if (keys.join(',') !== SLOTS.join(',')) {
    throw new Error(`the runner list must name exactly ${SLOTS.join(' and ')}; it names ${keys.join(', ') || 'nothing'}`);
  }
  for (const slot of SLOTS) {
    if (typeof list[slot] !== 'string' || !LABEL.test(list[slot])) {
      throw new Error(`'${slot}' is not a runner label: ${JSON.stringify(list[slot])}`);
    }
  }
  if (list.current === list.previous) throw new Error(`'current' and 'previous' are both ${list.current}`);
  return { labels: [list.current, list.previous], runners: { current: list.current, previous: list.previous } };
}

/** What a macOS runner label looks like, whichever image GitHub names it after: `macos-15`, `macOS-14-xlarge`, `xcode-27`. */
const MACOS_LABEL = /\b(?:macos|xcode)-(?:\d[\w.-]*|latest[\w.-]*)/gi;
const READS_LIST = 'needs.macos-runners.outputs.';

const needsOf = (job) => (job?.needs === undefined ? [] : Array.isArray(job.needs) ? job.needs : [job.needs]);

/** The runner expression a job really takes its machine from: `runs-on`, or the matrix value `runs-on` names. */
function runnerSource(job) {
  const runsOn = typeof job?.['runs-on'] === 'string' ? job['runs-on'] : JSON.stringify(job?.['runs-on'] ?? '');
  const viaMatrix = /^\$\{\{\s*matrix\.([\w-]+)\s*\}\}$/.exec(runsOn.trim());
  if (!viaMatrix) return runsOn;
  const value = job?.strategy?.matrix?.[viaMatrix[1]];
  return typeof value === 'string' ? value : JSON.stringify(value ?? '');
}

/**
 * Every place a workflow names a macOS runner other than through its `macos-runners` job (FR-037, SC-011).
 *
 * Two readings: the TEXT, for a label or anything shaped like one, anywhere — a comment that names a release is a
 * second place to edit too; and the JOBS, for one that reads the list's outputs without needing the job that writes
 * them, or a workflow that reads them with no such job.
 *
 * @param {{name: string, text: string}[]} files the workflows
 * @param {string[]} labels the labels in the runner list
 * @param {(text: string) => any} parse a YAML parser
 * @returns {string[]} one line per violation; empty when there are none
 */
export function findRunnerLabelViolations(files, labels, parse) {
  const found = new Map();
  for (const { name, text } of files) {
    text.split('\n').forEach((line, i) => {
      const tokens = [...line.matchAll(MACOS_LABEL)].map((m) => m[0]);
      for (const label of labels) if (line.includes(label)) tokens.push(label);
      for (const token of tokens) {
        const key = `${name}:${i + 1}:${token.toLowerCase()}`;
        if (!found.has(key)) {
          found.set(key, `${name}:${i + 1}: names the macOS runner '${token}'; only .github/macos-runners.json may`);
        }
      }
    });

    const jobs = parse(text)?.jobs ?? {};
    let readers = 0;
    for (const [id, job] of Object.entries(jobs)) {
      const source = runnerSource(job);
      const matrix = JSON.stringify(job?.strategy?.matrix ?? '');
      if (!source.includes(READS_LIST) && !matrix.includes(READS_LIST)) continue;
      readers += 1;
      if (!needsOf(job).includes('macos-runners')) {
        found.set(`${name}:${id}:needs`, `${name}: ${id} reads the macOS runner list without needing the macos-runners job`);
      }
    }
    const writer = jobs['macos-runners'];
    const writes = JSON.stringify(writer?.steps ?? []).includes('scripts/macos-runners.mjs');
    if (readers > 0 && !writes) {
      found.set(`${name}:writer`, `${name}: has macOS jobs but no macos-runners job running scripts/macos-runners.mjs`);
    }
  }
  return [...found.values()];
}

function main() {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
  try {
    const { labels, runners } = runnerOutputs(readFileSync(resolve(root, '.github', 'macos-runners.json'), 'utf8'));
    process.stdout.write(`labels=${JSON.stringify(labels)}\nrunners=${JSON.stringify(runners)}\n`);
  } catch (err) {
    console.error(`[macos-runners] .github/macos-runners.json: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
