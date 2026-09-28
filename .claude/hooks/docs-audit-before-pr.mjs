#!/usr/bin/env node
// PreToolUse(Bash) — before `gh pr create` / `gh pr edit`, run the mechanical half of the
// throng-docs audit (docs-currency.test.ts) and refuse the call while it is red. The judgement half
// is the throng-docs skill's; a green test adds a reminder to run it. See CLAUDE.md, Documentation.
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (raw += chunk));
process.stdin.on('end', () => {
  let command = '';
  try {
    command = JSON.parse(raw)?.tool_input?.command ?? '';
  } catch {
    process.exit(0);
  }
  if (!/\bgh\s+pr\s+(create|edit)\b/.test(command)) process.exit(0);

  const run = spawnSync(
    'npx',
    ['vitest', 'run', '--project', 'unit', 'packages/ui/tests/unit/docs-currency.test.ts'],
    { cwd: root, encoding: 'utf8', shell: true },
  );
  if (run.status !== 0) {
    const tail = `${run.stdout ?? ''}${run.stderr ?? ''}`
      .replace(/\x1b\[[0-9;]*m/g, '')
      .split('\n')
      .slice(-40)
      .join('\n');
    process.stderr.write(
      'docs-currency.test.ts is red, so this PR call is refused. Load the throng-docs skill, fix ' +
        'the documentation it reports, then retry.\n\n' +
        tail,
    );
    process.exit(2);
  }
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        additionalContext:
          'docs-currency.test.ts is green. Before this PR call, confirm the throng-docs audit ' +
          '(its judgement pass) was run for this change; if not, load the throng-docs skill first.',
      },
    }),
  );
  process.exit(0);
});
