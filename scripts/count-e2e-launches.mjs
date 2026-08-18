/**
 * Count application launches across the E2E suite (034 SC-010, FR-040).
 *
 *   node scripts/count-e2e-launches.mjs
 *   node scripts/count-e2e-launches.mjs --all      # every file, not just the heaviest
 *
 * ══ WHY THIS IS NOT `grep -c 'runApp('` ══
 *
 * That is the obvious count and it is WRONG, by a wide margin. Most spec files that share one app
 * keep a LOCAL shim named `runApp` — either `import { runApp as runOwnApp }` plus a local
 * `runApp` that throws on options, or a plain local wrapper — so the name survives at every call
 * site while the launches do not. A textual count reads `explorer.e2e.ts` as seventeen launches
 * when it opens two apps.
 *
 * An early measurement made exactly that mistake and overstated the suite by roughly 40%. Since
 * SC-010 is a percentage reduction against a measured baseline of 681, an inflated count would have
 * reported progress that did not exist.
 *
 * A launch is therefore counted as:
 *   - `openApp(`         a shared app, normally opened once in `beforeAll`
 *   - `runOwnApp(`       the explicit escape a shared file gives a test that needs its own
 *   - `electron.launch(` a hand-rolled launcher (a few specs predate the harness)
 *   - `runApp(`          ONLY in files that do not define a local shim of that name
 *
 * ══ AND WHY COMMENTS ARE STRIPPED FIRST ══
 *
 * The second version of this mistake, found 2026-08-17 and more embarrassing than the first: it
 * counted these tokens INSIDE COMMENTS. Every shared-app conversion leaves a header explaining that
 * the file now uses `openApp()` in `beforeAll` — so the metric charged the branch one launch for
 * each conversion it DOCUMENTED, and the better the documentation, the worse the score. Seventeen of
 * a measured 495 were prose.
 *
 * That is worse than an ordinary off-by-N because it is anti-correlated with the work: it penalises
 * exactly the change the criterion exists to reward. Comments are removed before any counting, and
 * `//` is only honoured when it is not part of `://`, so a URL in a string does not truncate the
 * line after it.
 *
 * ══ THE BASELINE WAS NEVER A LAUNCH COUNT ══
 *
 * The worst of the three, found 2026-08-17 by re-measuring instead of inheriting. SC-010 asks for a
 * 40% fall "from the measured 681", and `baseline.md:275` records that figure under the heading
 * "`runApp()` call sites". It is the NAIVE COUNT — `grep -c 'runApp('`, shim-blind — which is the
 * exact measure this file's own header, eight lines up, says is wrong and "overstated the suite by
 * roughly 40%". Re-counting `d55054b` naively reproduces 681 to the digit; counting it properly
 * gives 592.
 *
 * So for the whole life of this spec the criterion divided a correctly-counted numerator by an
 * incorrectly-counted denominator, and every reduction reported against it was flattered by about
 * fifteen points. This branch has been publishing 29.8% for a suite that has actually fallen 19.3%.
 *
 * BASELINE is therefore 592, re-measured through this same code path. (40% of it would be 355 —
 * harder than the 408 SC-010 published, and unreachable; see SC-027 and the FLOOR below.)
 * That is a HARDER bar than the one the spec published, which is the point: a criterion is only
 * worth having if its denominator means what it says. `--baseline <ref>` re-derives it on demand,
 * because a number that cannot be re-derived is the thing that got us here.
 */
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Re-measured on `d55054b` through the code path below — NOT the 681 the spec published. */
const BASELINE = 592;
const PUBLISHED_BASELINE = 681;
/**
 * **SC-027**, which supersedes SC-010's 40%, is a FLOOR rather than a fraction: every spec file
 * carries a launch-sharing decision and every decision the evidence supports has been applied, so no
 * row in `packages/ui/tests/e2e/launch-sharing.md` sits above its own floor. 390 is the sum of those
 * 232 decisions.
 *
 * A percentage cannot know how many of a suite's launches are load-bearing, which is why the
 * original was a guess — and it was a guess against a denominator that was not a launch count. Two
 * of the 232 decisions were settled by CONVERSION rather than argument: `drag-ghost` and
 * `theme-flash` were both converted, both failed, and both were reverted, which raised this floor
 * rather than lowering it.
 *
 * If a conversion later proves one of them safe, lower this number in the same commit — it is a
 * ratchet, like `e2e-budget.json`, and it is only worth having if it is tightened.
 */
const TARGET_LAUNCHES = 390;
const CRITERION = 'SC-027';

const e2eDir = fileURLToPath(new URL('../packages/ui/tests/e2e/', import.meta.url));
const repoRoot = fileURLToPath(new URL('../', import.meta.url));

/**
 * Remove comments so prose describing a launch is never counted as one.
 *
 * `//` is honoured only when it is not preceded by `:`, so a URL inside a string does not swallow
 * the rest of its line. That is the one false positive worth guarding: a `runApp(` sitting after a
 * link on the same line would otherwise vanish from the count.
 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Does this file define its own `runApp`, making the imported one unreachable by that name? */
function shimsRunApp(src) {
  return (
    /runApp\s+as\s+runOwnApp/.test(src) ||
    /(?:const|function|async function)\s+runApp\b/.test(src)
  );
}

const count = (src, re) => (src.match(re) ?? []).length;

function measure(src) {
  const code = stripComments(src);
  const shimmed = shimsRunApp(code);
  const launches =
    count(code, /\bopenApp\s*\(/g) +
    count(code, /\brunOwnApp\s*\(/g) +
    count(code, /electron\.launch\s*\(/g) +
    (shimmed ? 0 : count(code, /\brunApp\s*\(/g));
  return { launches, shimmed, tests: count(code, /^test\(/gm) };
}

/** Re-count a git ref's tree through the SAME code path, so the two totals are comparable. */
function measureRef(ref) {
  const git = (args) => execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', maxBuffer: 1 << 28 });
  const dir = 'packages/ui/tests/e2e';
  const names = git(['ls-tree', '--name-only', `${ref}:${dir}`])
    .split('\n')
    .filter((n) => n.endsWith('.e2e.ts'));
  let launches = 0;
  for (const n of names) launches += measure(git(['show', `${ref}:${dir}/${n}`])).launches;
  return { files: names.length, launches };
}

if (process.argv.includes('--baseline')) {
  const ref = process.argv[process.argv.indexOf('--baseline') + 1] ?? 'd55054b';
  const b = measureRef(ref);
  console.log(`baseline ref    ${ref}`);
  console.log(`spec files      ${b.files}`);
  console.log(`LAUNCHES        ${b.launches}   (comment-stripped; the published 681 was not)`);
  process.exit(0);
}

const files = readdirSync(e2eDir).filter((f) => f.endsWith('.e2e.ts'));

const rows = files.map((file) => {
  const src = readFileSync(`${e2eDir}${file}`, 'utf8');
  return { file, ...measure(src) };
});

const total = rows.reduce((n, r) => n + r.launches, 0);
const target = TARGET_LAUNCHES;
const fell = (((BASELINE - total) / BASELINE) * 100).toFixed(1);

console.log(`spec files      ${files.length}`);
console.log(`tests           ${rows.reduce((n, r) => n + r.tests, 0)}`);
console.log(`LAUNCHES        ${total}`);
console.log(`baseline        ${BASELINE}  (origin/master d55054b, pre-034, re-measured)`);
console.log(
  `                the spec published ${PUBLISHED_BASELINE}, which is the NAIVE runApp( count — see the header`,
);
console.log(
  `reduction       ${fell}%   ${CRITERION} floor ${target} (every supported conversion applied)`,
);
console.log(
  total <= target
    ? `${CRITERION} MET`
    : `${CRITERION} NOT MET — ${total - target} launches still to remove`,
);

const showAll = process.argv.includes('--all');
const listed = [...rows].sort((a, b) => b.launches - a.launches).filter((r) => r.launches > 0);
console.log(`\n${showAll ? 'every file' : 'heaviest 15'}, launches first:`);
for (const r of showAll ? listed : listed.slice(0, 15)) {
  console.log(`  ${String(r.launches).padStart(3)}  ${r.file}${r.shimmed ? '   (shares an app)' : ''}`);
}
