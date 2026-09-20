/**
 * Contract suite for any {@link IShellIntegration} implementation (Principle V /
 * contracts/os-shell-integration.md). The harness reports which underlying OS
 * call the impl made, so impls verify they route file → reveal-and-select and
 * folder → open-contents (FR-035).
 *
 * 045 adds SI1–SI4 (`contracts/platform-ports.md` §3) for `openWithDefaultProgram`. Three of them
 * need REAL locations to ask about — "rejects for a path that does not exist" cannot be asserted
 * against a fake that never looks — so a harness opts into them by supplying `fixtures`. A harness
 * that supplies none still gets every case that does not need the disk, including the one that says
 * the method must exist at all. SI4 is `@admin` and lives in
 * {@link runShellIntegrationDeElevationContract}, because it is meaningless in a non-elevated run
 * and must not assert a hollow baseline there (Principle V).
 */
import { describe, it, expect } from 'vitest';
import type { IShellIntegration } from '../abstractions/shell-integration.js';

export interface ShellIntegrationHarness {
  shell: IShellIntegration;
  /** Calls recorded since the last reset, in order. */
  calls(): ReadonlyArray<
    { op: 'reveal' | 'open'; path: string } | { op: 'openExternal'; url: string }
  >;
  reset(): void;
  /**
   * 045 SI1–SI3. Real locations this subject can be asked about. Absent for a harness whose subject
   * is driven entirely by a fake shell and never touches a disk; present for one that does.
   */
  fixtures?: {
    /** A file that exists. */
    readonly existingFile: string;
    /** A folder that exists. */
    readonly existingFolder: string;
    /** A path that does not exist. */
    readonly missing: string;
  };
  /**
   * 045 T259 (FR-036, `contracts/platform-ports.md` §7.2). The same kind of subject over an OS that
   * REFUSES every call it is handed, so the failure half of the result can be asserted. Absent for a
   * harness that cannot make its OS refuse.
   */
  failing?: () => IShellIntegration;
}

/** What a de-elevating implementation launched instead of performing the action itself (SI4). */
export interface DeElevationHarness {
  shell: IShellIntegration;
  /**
   * The launch specs handed to the de-elevating launcher, in order.
   *
   * Not `IDeElevator.wrap`, which is what this said until 045 Open item O2 was settled: `wrap`
   * rewrites a spec for a SPAWNER to run, and a reveal has none — see the amendment in
   * `contracts/platform-ports.md` §3.
   */
  launched(): ReadonlyArray<{ readonly file: string; readonly args: readonly string[] }>;
  /** The OS calls the process made DIRECTLY. Must stay empty while elevated. */
  directOsCalls(): ReadonlyArray<{ op: string; path: string }>;
  reset(): void;
  /** A real file the actions can be pointed at. */
  readonly existingFile: string;
}

export function runShellIntegrationContract(
  name: string,
  makeHarness: () => ShellIntegrationHarness,
): void {
  describe(`IShellIntegration contract: ${name}`, () => {
    it('reveals a file selected in its parent', async () => {
      const h = makeHarness();
      h.reset();
      await h.shell.revealInFileManager('C:/proj/src/main.ts');
      expect(h.calls()).toEqual([{ op: 'reveal', path: 'C:/proj/src/main.ts' }]);
    });

    it('opens a folder to show its contents', async () => {
      const h = makeHarness();
      h.reset();
      await h.shell.openFolder('C:/proj/src');
      expect(h.calls()).toEqual([{ op: 'open', path: 'C:/proj/src' }]);
    });

    it('opens an external URL through the OS default handler (044 FR-091 / R10)', async () => {
      const h = makeHarness();
      h.reset();
      await h.shell.openExternal('https://example.com');
      expect(h.calls()).toEqual([{ op: 'openExternal', url: 'https://example.com' }]);
    });

    // ── 045 FR-036 ─────────────────────────────────────────────────────────────────────────────
    it('045 FR-036: exposes openWithDefaultProgram', () => {
      expect(typeof makeHarness().shell.openWithDefaultProgram).toBe('function');
    });

    const fixtures = makeHarness().fixtures;
    const withDisk = fixtures === undefined ? describe.skip : describe;

    /*
     * *Round four (T259, platform-ports.md \u00a77.2):* SI1 \u2013 SI3 asserted a REJECTION carrying the path and a
     * reason. The action now RESOLVES `{ ok: false, osReason }` \u2014 the OS's own words travel as a value,
     * so the one notice can name them (FR-036). The claims are the same; the shape is \u00a77.2's.
     */
    withDisk('045 SI1\u2013SI3: openWithDefaultProgram, against real locations', () => {
      it('SI1: refuses a path that does not exist, with a reason', async () => {
        const h = makeHarness();
        h.reset();
        await expect(h.shell.openWithDefaultProgram(h.fixtures!.missing)).resolves.toMatchObject({ ok: false });
      });

      it('SI2: refuses a folder \u2014 it is a file operation (FR-030)', async () => {
        const h = makeHarness();
        h.reset();
        await expect(h.shell.openWithDefaultProgram(h.fixtures!.existingFolder)).resolves.toMatchObject({
          ok: false,
        });
      });

      it('SI3: a refusal carries the path and a reason, so ONE notice can name both', async () => {
        const h = makeHarness();
        h.reset();
        const result = await h.shell.openWithDefaultProgram(h.fixtures!.missing);
        expect(result.ok).toBe(false);
        const osReason = result.ok ? '' : result.osReason;
        expect(osReason).toContain(h.fixtures!.missing);
        expect(osReason.replace(h.fixtures!.missing, '').trim().length).toBeGreaterThan(0);
      });

      it('refuses neither a real file nor the OS call it needs to make for one', async () => {
        const h = makeHarness();
        h.reset();
        await expect(h.shell.openWithDefaultProgram(h.fixtures!.existingFile)).resolves.toEqual({ ok: true });
      });
    });

    it('045 T259: a reveal the OS accepts resolves { ok: true }', async () => {
      const h = makeHarness();
      h.reset();
      await expect(h.shell.revealInFileManager('C:/proj/src/main.ts')).resolves.toEqual({ ok: true });
    });

    const failing = makeHarness().failing;
    const withFailure = failing === undefined ? describe.skip : describe;

    withFailure('045 T259 / FR-036: when the OS refuses, the result names the OS\u2019s reason', () => {
      it('a failing reveal resolves { ok: false, osReason } with a non-empty osReason', async () => {
        const result = await makeHarness().failing!().revealInFileManager('C:/proj/src/main.ts');
        expect(result.ok).toBe(false);
        expect(result.ok ? '' : result.osReason.trim()).not.toBe('');
      });

      (fixtures === undefined ? it.skip : it)(
        'a failing default-program open resolves { ok: false, osReason } with a non-empty osReason',
        async () => {
          const h = makeHarness();
          const result = await h.failing!().openWithDefaultProgram(h.fixtures!.existingFile);
          expect(result.ok).toBe(false);
          expect(result.ok ? '' : result.osReason.trim()).not.toBe('');
        },
      );
    });
  });
}

/**
 * 045 SI4 (`@admin`). From an ELEVATED host, neither OS action may be performed by the elevated
 * process itself — both must go out through a de-elevating launcher, or a link printed by an
 * ordinary terminal becomes a way to start an administrator program (FR-038, Principle III).
 *
 * Separate from the suite above because it is meaningless in a non-elevated run: a developer
 * machine is normally not elevated and hosted runners always are, so this is `@admin` rather than
 * something guarded by `skipIfElevated()`, and it must never assert a hollow baseline.
 */
export function runShellIntegrationDeElevationContract(
  name: string,
  makeHarness: () => DeElevationHarness,
): void {
  describe(`IShellIntegration de-elevation contract (SI4): ${name}`, () => {
    it('reveals through the launcher, never from the elevated process', async () => {
      const h = makeHarness();
      h.reset();
      await h.shell.revealInFileManager(h.existingFile);
      expect(h.directOsCalls()).toEqual([]);
      expect(h.launched().length).toBe(1);
      expect(h.launched()[0].args.join(' ')).toContain(h.existingFile);
    });

    it('opens with the default program through the launcher, never from the elevated process', async () => {
      const h = makeHarness();
      h.reset();
      await h.shell.openWithDefaultProgram(h.existingFile);
      expect(h.directOsCalls()).toEqual([]);
      expect(h.launched().length).toBe(1);
      expect(h.launched()[0].args.join(' ')).toContain(h.existingFile);
    });
  });
}
