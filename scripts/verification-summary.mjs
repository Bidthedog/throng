// Print the verification gaps as Markdown, for a job summary (058 spec Assumptions, SC-008).
//
//   node scripts/verification-summary.mjs verification-gaps.json >> "$GITHUB_STEP_SUMMARY"
//
// A step the hosted runner could not exercise is `unproven`, and the spec says that gap is "reported
// on every run … rather than assumed covered". This is where a maintainer reading a run sees it
// without opening a verdict file: every unproven step, by combination, with the reason it gave. A run
// with none says so, because an empty section and a missing one read the same.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * @param {{combination: string, step: string, reason: string}[]} gaps
 * @returns {string} Markdown.
 */
export function renderGapsSummary(gaps) {
  if (gaps.length === 0) {
    return '### Verification gaps\n\nNone: every step of every combination was exercised.\n';
  }
  const rows = gaps.map((g) => `| \`${g.combination}\` | \`${g.step}\` | ${String(g.reason).replace(/\|/g, '\\|')} |`);
  return [
    '### Verification gaps',
    '',
    `${gaps.length} step${gaps.length === 1 ? '' : 's'} could not be exercised on the release runner and ${gaps.length === 1 ? 'was' : 'were'} not assumed to pass.`,
    'They are also listed in the release body.',
    '',
    '| Combination | Step | Why it is unproven |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const file = process.argv[2];
  const gaps = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  process.stdout.write(renderGapsSummary(Array.isArray(gaps) ? gaps : []));
}
