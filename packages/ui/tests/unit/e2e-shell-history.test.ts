import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * Every E2E app launch keeps the developer's shell history out of it (#339).
 *
 * ══ WHY A GUARD AND NOT JUST THE FIX ══
 *
 * The fix is one line in `harness.ts`, and it covers every spec that launches through the harness —
 * which is most of them, but not all. Around ten specs call `electron.launch()` directly, and such
 * a spec opts out of EVERY protection the harness provides, silently and by omission rather than by
 * decision. That has already cost this suite once: `terminal-clipboard.e2e.ts` carries a comment
 * recording that its direct launch missed `THRONG_E2E_CLIPBOARD`, so the tests pasted the
 * DEVELOPER'S REAL CLIPBOARD and failed 3/3 on a dev box while passing on CI, whose clipboard is
 * empty.
 *
 * Shell history is the same shape of mistake with a worse failure mode, because it is not a flake —
 * it never fails at all. A spec that writes the developer's history file passes perfectly, and the
 * only symptom appears hours later in someone else's terminal, as commands that have gone missing
 * from Ctrl+R. Nothing in a test run would ever point at it.
 *
 * ══ WHY IT WALKS THE DIRECTORY ══
 *
 * It DISCOVERS the launches rather than checking a list, for the reason `e2e-tags.test.ts` gives:
 * a guard that reads an enumeration passes contentedly while the unlisted file beside it does the
 * thing the guard forbids.
 */
const E2E_DIR = join(process.cwd(), 'packages', 'ui', 'tests', 'e2e');

/** The switch that asks throng to launch shells which persist nothing. */
const FLAG = 'THRONG_TEST_SHELL_HISTORY';

/** `harness.ts` sets the flag for everything it launches, so it is the fix, not a violation. */
const HARNESS = 'harness.ts';

function e2eFiles(): string[] {
  return readdirSync(E2E_DIR).filter((f) => f.endsWith('.ts'));
}

/**
 * The `env: { … }` object of each direct `electron.launch({ … })` in a file.
 *
 * Brace-matched from the `env:` key rather than regexed to a closing brace, because these blocks
 * contain nested objects and comment prose full of braces.
 */
function launchEnvBlocks(source: string): string[] {
  const blocks: string[] = [];
  const launch = /electron\.launch\(\{/g;
  let hit: RegExpExecArray | null;
  while ((hit = launch.exec(source)) !== null) {
    const envAt = source.indexOf('env:', hit.index);
    if (envAt === -1) continue;
    const open = source.indexOf('{', envAt);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < source.length; i++) {
      if (source[i] === '{') depth++;
      else if (source[i] === '}') {
        depth--;
        if (depth === 0) {
          blocks.push(source.slice(open, i + 1));
          break;
        }
      }
    }
  }
  return blocks;
}

describe('#339 no E2E app launch may write the developer shell history', () => {
  it('sets the flag in the harness every shared app comes from', () => {
    const source = readFileSync(join(E2E_DIR, HARNESS), 'utf8');
    expect(source).toContain(`${FLAG}: 'off'`);
  });

  it('sets the flag on every spec that launches Electron for itself', () => {
    const offenders: string[] = [];
    for (const file of e2eFiles()) {
      if (file === HARNESS) continue;
      const source = readFileSync(join(E2E_DIR, file), 'utf8');
      for (const env of launchEnvBlocks(source)) {
        if (env.includes(FLAG)) continue;
        offenders.push(file);
      }
    }
    expect(
      [...new Set(offenders)],
      `these specs call electron.launch() without ${FLAG}, so the shells they open write the ` +
        `developer's real PSReadLine history — add "${FLAG}: 'off'" to the launch env, or launch ` +
        `via harness.ts (#339)`,
    ).toEqual([]);
  });
});
