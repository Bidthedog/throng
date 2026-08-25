import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * #316 — every E2E test that measures an elevation-SENSITIVE fact declares that it does.
 *
 * ══ WHAT THIS EXISTS TO CATCH ══
 *
 * GitHub's Windows runners are ALWAYS elevated; a developer's machine almost never is. An elevated
 * throng does not run terminals from the daemon — it routes them through the de-elevated agent — so
 * a handful of measurements return something different, or nothing at all, depending on integrity
 * level. A spec that makes one of those measurements without saying so is green locally, green on
 * the PR, and red on `master` in the Release lane, which is the first elevated execution it has
 * ever had. That is not a flake. It is a test whose assumption was never true where it eventually
 * ran, discovered at the one point where it blocks the installer.
 *
 * `terminal-reload-mode.e2e.ts` did exactly this and cost run 32813787173. The two sibling specs
 * that make the same measurements had guarded them from the start.
 *
 * ══ WHY THE FIX IS A GUARD AND NOT A REPAIR ══
 *
 * The measurement is not wrong; it is unavailable. Nothing the product could do would make the
 * daemon own a conhost while an elevated app is correctly routing terminals through the agent.
 * Skipping is therefore the honest outcome, and the coverage is not lost: a developer machine is
 * non-elevated, so `npm run gate` executes these tests on every run. Elevated CI is the environment
 * that cannot answer, and the guard is how a test says so out loud.
 *
 * ══ WHY PER TEST, AND WHY THE PROBES ARE NAMED SEPARATELY ══
 *
 * #112 settled the repo's preference: guard per ASSUMPTION, not per file. A file-level skip reads
 * as coverage while running nothing, which is how the guard once reached a third of the suite
 * (see the history in `admin.ts`). So this walks declarations rather than files, and it keeps the
 * two probes distinct — because `terminal-reload-mode` proved they are not the same assumption and
 * do not always travel together. Its first test failed on the CWD probe thirty seconds BEFORE it
 * would have reached the conhost probe, and an author who knew about only one of the two would
 * have guarded the wrong line and shipped the same red lane again.
 *
 * ══ WHY IT WALKS THE DIRECTORY ══
 *
 * Same reasoning as `e2e-tags.test.ts`: a guard that reads an enumeration passes contentedly while
 * an unlisted file sits beside the enumeration. There is no allowlist here on purpose.
 */
const E2E_DIR = join(process.cwd(), 'packages', 'ui', 'tests', 'e2e');

/**
 * The elevation-sensitive measurements, each with the reason it cannot hold on an elevated runner.
 * Add to this list only with a reason of the same kind — an environment fact, not a preference.
 */
const PROBES: readonly { id: string; why: string; re: RegExp }[] = [
  {
    id: 'daemon-owned-conhost',
    why: 'an elevated daemon routes terminals through the de-elevated agent, so the conhosts are the AGENT’s children and the daemon’s count is 0',
    re: /\b(?:conhostChildren|expectNoOrphanConhosts)\s*\(/,
  },
  {
    id: 'shell-reported-cwd',
    why: 'the working directory is read back from the shell the daemon started; under the de-elevated agent that readback does not reach the panel, so `panel-cwd-<id>` never appears',
    re: /panel-cwd-/,
  },
];

/**
 * `conhostChildren` counts only when it is the HARNESS one, which measures the daemon's children.
 * `terminal-modified-enter.e2e.ts` defines a local function of the same name and passes it
 * `process.pid` — the test process, not the daemon — so it makes no claim about elevation at all
 * and must not be asked for a guard it does not need. Keying on the import rather than on the bare
 * identifier is what keeps this guard off it.
 */
const HARNESS_CONHOST =
  /import\s*\{[^}]*\b(?:conhostChildren|expectNoOrphanConhosts)\b[^}]*\}\s*from\s*'\.\/harness\.js'/s;

const DECL =
  /^\s*(adminTest|test)\(\s*(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`)/;

/** A top-level `function foo(` / `async function foo(` — the only indirection this guard resolves. */
const FN_DECL = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/;

interface Violation {
  file: string;
  line: number;
  probe: string;
  test: string;
  why: string;
}

interface Block {
  name: string;
  start: number;
  end: number;
}

/**
 * Contiguous top-level blocks, each running until the next top-level declaration of ANY kind.
 *
 * The boundary set is deliberately the union of helpers AND tests rather than just the kind being
 * collected. Bounding a helper only by the next HELPER lets the last one in a file run to
 * end-of-file and swallow every test below it — which is not hypothetical: it is what the first
 * version of this guard did, and it reported `terminal-reload-mode`'s CWD probe against the wrong
 * test. The verdict survived; the line number and the probe attribution did not, and a guard whose
 * report points at the wrong line teaches people to distrust the report.
 */
function blocks(
  lines: string[],
  match: (t: string) => string | undefined,
  boundaries: readonly number[],
): Block[] {
  const starts: { name: string; line: number }[] = [];
  lines.forEach((t, i) => {
    const name = match(t);
    if (name !== undefined) starts.push({ name, line: i + 1 });
  });
  return starts.map((s) => {
    const next = boundaries.find((b) => b > s.line);
    return { name: s.name, start: s.line, end: (next ?? lines.length + 1) - 1 };
  });
}

function scan(): { violations: Violation[]; probesSeen: number; filesSeen: number } {
  const violations: Violation[] = [];
  let probesSeen = 0;
  let filesSeen = 0;

  for (const file of readdirSync(E2E_DIR).filter((f) => f.endsWith('.e2e.ts'))) {
    const src = readFileSync(join(E2E_DIR, file), 'utf8');
    const lines = src.split('\n');
    const harnessConhost = HARNESS_CONHOST.test(src);

    /*
     * A module-scope `test.beforeEach(() => skipIfElevated())` guards every test in the file.
     * `admin.ts` warns against it, and rightly — but `terminal-no-orphans.e2e.ts` is the case it
     * is correct for: EVERY test there makes the measurement, and the file records why in prose
     * above the call. Honour it, and let the per-test rule below catch the files where it would be
     * hiding tests that do not need skipping.
     */
    const fileGuard = /test\.beforeEach\(\s*\(\s*\)\s*=>\s*skipIfElevated\(\s*\)\s*\)/.test(src);

    const testName = (t: string): string | undefined => {
      const m = DECL.exec(t);
      return m ? `${m[1]} ${m[2] ?? m[3] ?? m[4] ?? '(untitled)'}` : undefined;
    };
    const helperName = (t: string): string | undefined => FN_DECL.exec(t)?.[1];
    const boundaries = lines
      .map((t, i) => (testName(t) !== undefined || helperName(t) !== undefined ? i + 1 : 0))
      .filter((n) => n > 0);

    const tests = blocks(lines, testName, boundaries);
    const helpers = blocks(lines, helperName, boundaries);

    /** A helper's body is part of the effective body of every test that calls it, one level deep. */
    const bodyOf = (b: Block): string => lines.slice(b.start - 1, b.end).join('\n');
    const effective = (t: Block): string => {
      const own = bodyOf(t);
      const called = helpers.filter((h) => new RegExp(`\\b${h.name}\\s*\\(`).test(own));
      return [own, ...called.map(bodyOf)].join('\n');
    };

    const guarded = (t: Block): boolean =>
      t.name.startsWith('adminTest ') || fileGuard || /skipIfElevated\(\s*\)/.test(effective(t));

    let fileHadProbe = false;
    for (const t of tests) {
      const body = effective(t);
      for (const p of PROBES) {
        if (p.id === 'daemon-owned-conhost' && !harnessConhost) continue;
        // Strip line comments and block-comment bodies: several specs DISCUSS these probes in
        // prose, and a guard that fires on a docblock is a guard people learn to work around.
        const code = body
          .split('\n')
          .filter((l) => !/^\s*(?:\*|\/\/)/.test(l))
          .join('\n');
        if (!p.re.test(code)) continue;
        fileHadProbe = true;
        probesSeen += 1;
        if (guarded(t)) continue;
        const line = lines.findIndex((l, i) => i + 1 >= t.start && i + 1 <= t.end && p.re.test(l) && !/^\s*(?:\*|\/\/)/.test(l));
        violations.push({
          file,
          line: line >= 0 ? line + 1 : t.start,
          probe: p.id,
          // `name` is "<fn> <title>"; the title itself contains spaces, so take everything after
          // the FIRST one rather than the second field.
          test: t.name.slice(t.name.indexOf(' ') + 1),
          why: p.why,
        });
      }
    }
    if (fileHadProbe) filesSeen += 1;
  }
  return { violations, probesSeen, filesSeen };
}

const result = scan();

describe('E2E elevation guards (#316)', () => {
  it('finds the probes at all', () => {
    /*
     * Anti-vacuity, the same control `e2e-tags.test.ts` opens with and the same one the spec this
     * guard is about relies on internally. If the declaration or import shapes ever change, every
     * assertion below would pass on an empty set — which is precisely the silent green this whole
     * guard exists to make impossible.
     */
    expect(result.probesSeen).toBeGreaterThanOrEqual(8);
    expect(result.filesSeen).toBeGreaterThanOrEqual(4);
  });

  it('every test that measures an elevation-sensitive fact calls skipIfElevated()', () => {
    const report = result.violations
      .map((v) => `${v.file}:${v.line} [${v.probe}] in "${v.test}"\n    ${v.why}`)
      .join('\n');
    expect(report, `Unguarded elevation-sensitive probes:\n${report}`).toBe('');
  });
});
