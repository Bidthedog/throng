/**
 * What a skipped test says about why it skipped (062 FR-042, 070 FR-038). A platform guard carries its reason as the
 * argument of `skipUnlessWindows`, `skipUnlessLinux` or `skipUnlessMacos`, so the reason is read from the test file's
 * own source: the guard nearest above the test's line, else the first guard in the file.
 */
const GUARD = /skip(?:Unless|On)(Windows|Linux|Macos)\(\s*(['"`])((?:(?!\2).)+)\2\s*\)/g;

/**
 * Whether a file decides anything by platform. A skip in a file that never does is not a platform skip: a tags filter
 * (`!regression`), a contract's own fixture switch or a deliberate `it.skip`. It is listed, but owes no platform reason.
 */
const PLATFORM_CONDITION = /process\.platform|os\.platform\(|platform\(\)\s*[!=]==|is(?:Windows|Linux|Macos)Host\(/;

/** The group a skip in a file with no platform condition falls into. */
export const NOT_A_PLATFORM_SKIP = 'not a platform skip (a tags filter, a fixture switch or a deliberate skip)';

export interface Guard {
  readonly platform: 'Windows' | 'Linux' | 'Macos';
  readonly reason: string;
  /** 1-based line of the call. */
  readonly line: number;
}

/** Every stated platform guard in a test file's source. */
export function guardsIn(source: string): Guard[] {
  const found: Guard[] = [];
  for (const match of source.matchAll(GUARD)) {
    const line = source.slice(0, match.index).split('\n').length;
    found.push({ platform: match[1] as Guard['platform'], reason: match[3]!.trim(), line });
  }
  return found;
}

/** The reason a test at `line` (1-based) skipped, or null when its file states none. */
export function skipReasonFor(source: string, line: number): string | null {
  const guards = guardsIn(source).filter((g) => g.reason.length > 0);
  if (guards.length === 0) return PLATFORM_CONDITION.test(source) ? null : NOT_A_PLATFORM_SKIP;
  const above = guards.filter((g) => g.line <= line).at(-1);
  return `${(above ?? guards[0]!).platform}: ${(above ?? guards[0]!).reason}`;
}

export interface SkippedTest {
  readonly file: string;
  readonly name: string;
  readonly line: number;
}

/** Skipped tests grouped by their stated reason; those with none under `null`. */
export function groupSkips(skipped: readonly SkippedTest[], sourceOf: (file: string) => string): Map<string | null, SkippedTest[]> {
  const groups = new Map<string | null, SkippedTest[]>();
  for (const test of skipped) {
    const reason = skipReasonFor(sourceOf(test.file), test.line);
    const list = groups.get(reason) ?? [];
    list.push(test);
    groups.set(reason, list);
  }
  return groups;
}
