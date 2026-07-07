/**
 * Pure, OS-agnostic shell-executable resolver (005 batch-2, FR-024). It tries an
 * ordered list of probes — well-known **path** → executable on **PATH** → platform
 * **registry** — and returns the first that resolves to an existing executable, or
 * null if none do (so a shell installed nowhere is simply absent — no false
 * positive). All OS interaction is injected via `ShellResolver`, keeping this core
 * module free of any `node:`/OS import (Principle II); the Windows concrete supplies
 * real `exists`/`onPath`/`readRegistry`/`join`.
 */

/** One ordered resolution step for a shell's executable. */
export type ShellProbe =
  | { kind: 'path'; value: string }
  | { kind: 'onPath'; exe: string }
  | { kind: 'registry'; key: string; append: string };

/** Injected OS operations the resolver needs (kept out of core). */
export interface ShellResolver {
  /** Does an absolute path point to an existing file? */
  exists(absPath: string): boolean;
  /** Resolve an executable name against PATH → its full path, or null. */
  onPath(exe: string): string | null;
  /** Read a registry key's install-directory value, or null. */
  readRegistry(key: string): string | null;
  /** Join a directory with a relative sub-path (OS-specific separator). */
  join(dir: string, sub: string): string;
}

/** First probe that resolves to an existing executable, in order; else null. */
export function resolveShellFile(probes: ShellProbe[], resolver: ShellResolver): string | null {
  for (const probe of probes) {
    if (probe.kind === 'path') {
      if (resolver.exists(probe.value)) return probe.value;
    } else if (probe.kind === 'onPath') {
      const hit = resolver.onPath(probe.exe);
      if (hit) return hit;
    } else {
      const dir = resolver.readRegistry(probe.key);
      if (dir) {
        const full = resolver.join(dir, probe.append);
        if (resolver.exists(full)) return full;
      }
    }
  }
  return null;
}
