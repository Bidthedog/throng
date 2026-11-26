// Does a pull request that changes what users see update the user guide (080 FR-018)?
//
// ci.yml pipes the pull request's changed paths in, one per line (the same list `ci-changes.mjs` reads), with the PR
// body in PR_BODY:
//
//   git diff --name-only HEAD^1 HEAD | PR_BODY="…" node scripts/guide-pr-check.mjs
//
// A change to a non-test file under packages/*/src passes when it also changes site/guide/, docs/preferences.md,
// docs/key-bindings.md or docs/theme-settings.md, or when the body has a line starting `No user-facing change: `
// and a reason. Otherwise it fails, listing the source files and the line to add (contracts/guide-map.md § PR marker).
//
// No dependencies, so the step needs no `npm ci`.
import { readFileSync } from 'node:fs';
import { isMain } from './is-main.mjs';

export const MARKER = /^No user-facing change: \S/m;
const SOURCE = /^packages\/[^/]+\/src\//;
const TEST = /\.(test|spec)\.[cm]?[jt]sx?$/;
const GUIDE = [/^site\/guide\//, /^docs\/preferences\.md$/, /^docs\/key-bindings\.md$/, /^docs\/theme-settings\.md$/];

/** `{ ok, message }` for a PR's changed paths and body. */
export function checkGuidePr({ changed, body }) {
  const paths = changed.map((p) => p.trim()).filter((p) => p !== '');
  const source = paths.filter((p) => SOURCE.test(p) && !TEST.test(p));
  if (source.length === 0) return { ok: true, message: 'no app source changed' };
  if (paths.some((p) => GUIDE.some((g) => g.test(p)))) return { ok: true, message: 'the guide or a reference changed' };
  if (MARKER.test((body ?? '').replace(/\r\n/g, '\n'))) return { ok: true, message: 'the PR says no user sees it' };
  return {
    ok: false,
    message: [
      'This pull request changes the app but not the user guide (site/guide/) or a reference (docs/preferences.md,',
      'docs/key-bindings.md, docs/theme-settings.md). Update the task that teaches it, or, if no user can see the',
      'change, add this line to the PR description with the reason:',
      '',
      '  No user-facing change: <reason>',
      '',
      'Source files changed:',
      ...source.slice(0, 30).map((p) => `  ${p}`),
    ].join('\n'),
  };
}

if (isMain(import.meta.url)) {
  const { ok, message } = checkGuidePr({ changed: readFileSync(0, 'utf8').split('\n'), body: process.env.PR_BODY ?? '' });
  (ok ? process.stdout : process.stderr).write(`${message}\n`);
  process.exit(ok ? 0 : 1);
}
