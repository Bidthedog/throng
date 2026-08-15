import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * 032 T047 (FR-013, SC-007) — no spec writes a RUNNING app's config root directly.
 *
 * ══ WHY THIS IS A TEST AND NOT A GREP ══
 *
 * The first draft of this guarantee was `grep -rl "writeFileSync" packages/ui/tests/e2e`. That
 * matches **119 files and 378 occurrences**: it counts pre-launch seeds, project fixtures, editor
 * content and everything else, so it can never pass and measures nothing. A check that cannot fail
 * is not a check, and a check that always fails gets ignored, which is worse.
 *
 * The distinction that actually matters is not "does this file write" but "does it write a CONFIG
 * document while an app is RUNNING". A seed written before `runApp` has no watcher to race and is
 * completely fine. A write inside the callback is the #253 defect: `writeFileSync` truncates and
 * then fills, so the config watcher can wake mid-write, read unparseable JSON, and broadcast the
 * shipped defaults — after which nothing re-reads, because the writer has finished.
 *
 * So the classification is by brace depth relative to the enclosing `runApp`/`openApp`, which is
 * mechanical and cannot drift the way a hand-maintained allowlist would.
 *
 * ══ EXPECTED STATE ══
 *
 * RED until T031 converts the four live writers to the shared atomic helper. The four are named in
 * research.md R7a; two of them are not mentioned by #253 at all.
 */
const E2E_DIR = new URL('../e2e/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

/** Only CONFIG documents matter. A spec writing a project file into a temp folder is not a config writer. */
const CONFIG_TARGET = /settings\.json|keybindings\.json|themes[\\/]|icon-packs[\\/]/;
const WRITE_CALL = /\b(writeFileSync|writeFile|appendFileSync)\s*\(/;
const APP_START = /\b(runApp|openApp)\s*\(/;

interface LiveWrite {
  file: string;
  line: number;
  text: string;
}

/**
 * Every config-document write that happens while an app is running.
 *
 * Depth-tracked rather than regex-matched across the whole file: a write is "live" only when it sits
 * inside the callback passed to `runApp`/`openApp`, which is precisely when a config watcher exists
 * to catch it half-written.
 */
function findLiveConfigWrites(): LiveWrite[] {
  const found: LiveWrite[] = [];

  for (const file of readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts'))) {
    const lines = readFileSync(join(E2E_DIR, file), 'utf8').split('\n');
    let depth = 0;
    let appDepth: number | null = null;

    lines.forEach((line, i) => {
      if (APP_START.test(line) && appDepth === null) appDepth = depth;

      if (WRITE_CALL.test(line)) {
        // The target may be on this line or a following one — these calls are often wrapped.
        const window = lines.slice(i, i + 4).join(' ');
        if (CONFIG_TARGET.test(window) && appDepth !== null && depth > appDepth) {
          found.push({ file, line: i + 1, text: line.trim().slice(0, 80) });
        }
      }

      for (const ch of line) {
        if (ch === '{' || ch === '(') depth++;
        else if (ch === '}' || ch === ')') depth--;
      }
      if (appDepth !== null && depth <= appDepth) appDepth = null;
    });
  }

  return found;
}

describe('no E2E spec writes a running app config root directly (FR-013)', () => {
  it('every live config write goes through the shared atomic helper', () => {
    const live = findLiveConfigWrites();

    expect(
      live,
      `these specs write a CONFIG document while an app is running, using a plain write rather than\n` +
        `the shared atomic helper. writeFileSync truncates then fills, so the watcher can read the\n` +
        `file half-written, broadcast the defaults, and never re-read:\n` +
        live.map((w) => `  ${w.file}:${w.line}  ${w.text}`).join('\n'),
    ).toEqual([]);
  });

  it('pre-launch seeds are NOT flagged — they have no watcher to race', () => {
    /*
     * The guard has to stay narrow or it becomes the useless grep again. 32 of the 36 config writes
     * in the tree are seeds written before `runApp`, and every one of them is correct as it stands.
     * `preferences-settings.e2e.ts` is the case #253 got wrong, so it is the one worth pinning.
     */
    const live = findLiveConfigWrites();
    expect(live.map((w) => w.file)).not.toContain('preferences-settings.e2e.ts');
  });
});
