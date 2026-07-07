import type { IShellDetection } from '../abstractions/shell-detection.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(`IShellDetection contract violation: ${message}`);
  }
}

/**
 * Reusable contract suite for any `IShellDetection` implementation (005 Phase B).
 * Throws on the first violation; resolves when the subject satisfies every
 * structural obligation. Framework-agnostic — imports nothing, so `@throng/core`
 * stays free of OS/Node/test-runner deps and any package (or future OS impl) can
 * run it. Presence-of-executable is the impl's responsibility (it lists only what
 * it detected) and is exercised by the real-machine contract test.
 */
export async function runShellDetectionContract(
  make: () => IShellDetection,
  opts?: {
    /** Injected existence check (e.g. fs.existsSync). When provided, the suite
     *  asserts every returned `file` actually exists — the FR-024 "no false
     *  positives" guarantee that the ordered resolver only reports real shells. */
    fileExists?: (absPath: string) => boolean;
  },
): Promise<void> {
  const subject = make();

  const shells = await subject.detectInstalledShells();
  assert(Array.isArray(shells), 'detectInstalledShells() must resolve to an array');

  const ids = new Set<string>();
  for (const s of shells) {
    assert(
      typeof s.id === 'string' && s.id.length > 0,
      `each shell must have a non-empty id; got ${JSON.stringify(s.id)}`,
    );
    assert(
      typeof s.label === 'string' && s.label.length > 0,
      `shell ${s.id} must have a non-empty label`,
    );
    assert(
      typeof s.file === 'string' && s.file.length > 0,
      `shell ${s.id} must have a non-empty file`,
    );
    assert(
      Array.isArray(s.defaultArgs) && s.defaultArgs.every((a) => typeof a === 'string'),
      `shell ${s.id} defaultArgs must be a string[]`,
    );
    assert(!ids.has(s.id), `shell ids must be unique; '${s.id}' is duplicated`);
    ids.add(s.id);
    if (opts?.fileExists) {
      assert(
        opts.fileExists(s.file),
        `shell ${s.id} reports file '${s.file}' that does not exist (FR-024: no false positives)`,
      );
    }
  }

  // Stability + side-effect-free: a second call returns the same id set.
  const again = await subject.detectInstalledShells();
  const a = again.map((s) => s.id).sort();
  const b = [...ids].sort();
  assert(
    a.length === b.length && a.every((id, i) => id === b[i]),
    'detectInstalledShells() must be stable across calls (same set of ids)',
  );
}
