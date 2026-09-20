import type { IExecutableExtensions } from '@throng/core';

/**
 * The Windows answer to `IExecutableExtensions` (045 FR-039a; Principle II seam).
 *
 * Two sources, and both are needed:
 *
 *  1. **`PATHEXT`** — the OS's own list of what a bare command name may resolve to. Its shipped
 *     value covers `.COM .EXE .BAT .CMD .VBS .VBE .JS .JSE .WSF .WSH .MSC`, and the user can edit
 *     it.
 *  2. **A declared handler-launched set** — `.lnk`, `.url`, `.msi`, `.msp`, `.ps1`, `.scr`, `.cpl`,
 *     `.reg`, `.hta`, `.pif`. Windows never puts these in `PATHEXT` because they are not things
 *     `cmd` resolves a bare name to; it runs them through a registered handler instead. Reading
 *     `PATHEXT` alone would therefore let a Ctrl+click on a `.lnk` launch whatever it points at —
 *     the exact outcome FR-039 exists to prevent — so the second set is a floor, not a default, and
 *     survives a `PATHEXT` the user has trimmed.
 *
 * ══ READ PER CALL ══
 *
 * FR-039a requires a change the user makes to the OS's own list to take effect "without a restart",
 * so `PATHEXT` is read on every call rather than snapshotted in the constructor. The cost is a map
 * lookup and a `split` per hover; the alternative is a classification that is correct at launch and
 * silently stale afterwards. The environment arrives through a function so a test can move it
 * without touching the real one.
 */

/** Windows launches each of these through a handler; none of them is ever in `PATHEXT`. */
const HANDLER_LAUNCHED: readonly string[] = [
  '.lnk',
  '.url',
  '.msi',
  '.msp',
  '.ps1',
  '.scr',
  '.cpl',
  '.reg',
  '.hta',
  '.pif',
];

/** What `PATHEXT` ships with, used only when the environment supplies none at all. */
const PATHEXT_FALLBACK = '.COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC';

type EnvReader = () => Readonly<Record<string, string | undefined>>;

export class WindowsExecutableExtensions implements IExecutableExtensions {
  private readonly readEnv: EnvReader;

  constructor(readEnv: EnvReader = () => process.env) {
    this.readEnv = readEnv;
  }

  isExecutable(path: string): boolean {
    if (typeof path !== 'string' || path.length === 0) return false;
    // A trailing separator names a folder, and a folder is never executable.
    if (/[\\/]$/.test(path)) return false;
    const extension = this.extensionOf(path);
    if (extension === null) return false;
    return this.currentSet().has(extension);
  }

  executableExtensions(): readonly string[] {
    return [...this.currentSet()].sort();
  }

  /** Lower-cased, including the leading dot. `null` when the last segment carries none. */
  private extensionOf(path: string): string | null {
    const lastSeparator = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'));
    const name = path.slice(lastSeparator + 1);
    const dot = name.lastIndexOf('.');
    // `dot <= 0` covers both "no dot" and a leading-dot name, which has no extension in this
    // reading. `dot === name.length - 1` is a trailing dot, which names nothing.
    if (dot <= 0 || dot === name.length - 1) return null;
    return name.slice(dot).toLowerCase();
  }

  private currentSet(): ReadonlySet<string> {
    const set = new Set<string>(HANDLER_LAUNCHED);
    for (const raw of this.pathext().split(';')) {
      const entry = raw.trim().toLowerCase();
      if (entry.length === 0) continue;
      set.add(entry.startsWith('.') ? entry : `.${entry}`);
    }
    return set;
  }

  /**
   * `PATHEXT`, case-folded on the KEY as well as the value: Windows environment names fold case, so
   * a `Pathext` set by a launcher is the same variable and must not be missed.
   */
  private pathext(): string {
    const env = this.readEnv();
    for (const key of Object.keys(env)) {
      if (key.toLowerCase() === 'pathext') return env[key] ?? '';
    }
    return PATHEXT_FALLBACK;
  }
}
