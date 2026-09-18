import type { IExecutableExtensions } from '../abstractions/executable-extensions.js';

/**
 * Reusable contract suite for any `IExecutableExtensions` implementation (045 EX1–EX7,
 * `contracts/platform-ports.md` §2).
 *
 * Pure-throw, in the style of `platform-info-contract.ts`: imports nothing, throws
 * `IExecutableExtensions contract violation: …` on the first breach.
 *
 * ══ IT NAMES NO EXECUTABLE EXTENSION ══
 *
 * Not one case below says `.exe`. Every executable case is driven from the implementation's own
 * `executableExtensions()`, which is the point of that member: the suite asserts the SHAPE of the
 * rule — extension only, case-insensitive, stable, never a folder — and the implementation supplies
 * the content. A suite that hard-coded the Windows list would fail on the first platform to be
 * added, and it would also be testing the list against a copy of itself.
 *
 * The non-executable cases DO name extensions (`.txt`, `.md`, `.ts`, `.json`), and that is
 * deliberate rather than inconsistent: those are EX5's claim, that an implementation which called
 * an ordinary document executable would be wrong on every platform there is.
 */

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`IExecutableExtensions contract violation: ${message}`);
}

export function runExecutableExtensionsContract(makeSubject: () => IExecutableExtensions): void {
  const subject = makeSubject();

  // ── EX6 ──────────────────────────────────────────────────────────────────────────────────────
  const reported = subject.executableExtensions();
  assert(
    Array.isArray(reported) || (typeof reported === 'object' && reported !== null),
    `executableExtensions() must return an array; got ${typeof reported}`,
  );
  const extensions = [...reported];
  assert(
    extensions.length > 0,
    'executableExtensions() must be non-empty — a classification that calls nothing executable makes FR-039 vacuous',
  );
  for (const ext of extensions) {
    assert(
      typeof ext === 'string' && ext.startsWith('.') && ext.length > 1,
      `every reported extension must be a string beginning with a dot; got ${JSON.stringify(ext)}`,
    );
    assert(
      !/[\\/]/.test(ext),
      `a reported extension must not contain a separator; got ${JSON.stringify(ext)}`,
    );
  }

  // Every extension the implementation reports must actually be classified executable. Without
  // this, the two members could describe different rules and SC-010 would be measuring the wrong one.
  for (const ext of extensions) {
    assert(
      subject.isExecutable(`some${ext}`),
      `isExecutable must agree with executableExtensions(); it reported ${ext} but did not classify 'some${ext}'`,
    );
  }

  // ── EX1 ──────────────────────────────────────────────────────────────────────────────────────
  for (const noExtension of ['README', 'a/b/Makefile', 'LICENSE']) {
    assert(
      !subject.isExecutable(noExtension),
      `a path with no extension must not be executable; ${JSON.stringify(noExtension)} was`,
    );
  }

  // ── EX2 ──────────────────────────────────────────────────────────────────────────────────────
  // A folder is never executable, and a trailing separator is the only signal a rule about
  // extensions alone can have that it is looking at one.
  for (const ext of extensions) {
    for (const separator of ['/', '\\']) {
      const folder = `dir${ext}${separator}`;
      assert(
        !subject.isExecutable(folder),
        `a path ending in a separator names a folder and must not be executable; ${JSON.stringify(folder)} was`,
      );
    }
  }

  // ── EX3 ──────────────────────────────────────────────────────────────────────────────────────
  for (const ext of extensions) {
    const lower = `setup${ext.toLowerCase()}`;
    const upper = `setup${ext.toUpperCase()}`;
    assert(
      subject.isExecutable(lower) === subject.isExecutable(upper),
      `extension matching must ignore case; ${JSON.stringify(lower)} and ${JSON.stringify(upper)} disagreed`,
    );
  }

  // ── EX4 ──────────────────────────────────────────────────────────────────────────────────────
  for (const ext of extensions) {
    const sample = `stable${ext}`;
    assert(
      subject.isExecutable(sample) === subject.isExecutable(sample),
      `isExecutable must be stable within one environment; ${JSON.stringify(sample)} changed answer`,
    );
  }

  // ── EX5 ──────────────────────────────────────────────────────────────────────────────────────
  for (const document of ['notes.txt', 'README.md', 'src/foo.ts', 'package.json', 'a/b/c.log']) {
    assert(
      !subject.isExecutable(document),
      `an ordinary document extension must not be executable; ${JSON.stringify(document)} was`,
    );
  }

  // ── EX7 ──────────────────────────────────────────────────────────────────────────────────────
  const nul = String.fromCharCode(0);
  const hostile = ['', '.', '..', 'x.', '.x', `.${extensions[0].slice(1)}`, `a${nul}b.txt`, 'x'.repeat(40_000)];
  for (const input of hostile) {
    let answer: boolean | undefined;
    let threw: unknown;
    try {
      answer = subject.isExecutable(input);
    } catch (e) {
      threw = e;
    }
    assert(
      threw === undefined,
      `isExecutable must be total and must not throw; it threw ${String(threw)} for ${JSON.stringify(input)}`,
    );
    assert(
      typeof answer === 'boolean',
      `isExecutable must return a boolean; got ${typeof answer} for ${JSON.stringify(input)}`,
    );
  }
}
