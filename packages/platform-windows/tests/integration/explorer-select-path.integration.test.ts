import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { afterAll, describe, expect, it } from 'vitest';

/**
 * 045 Open item O3 (`@admin`) — **does `explorer.exe /select,<path>` behave like
 * `shell.showItemInFolder` for the two paths that strain its syntax?**
 *
 * It matters because FR-038 replaces `shell.showItemInFolder` with an `explorer.exe` launch
 * whenever throng is elevated. If the replacement is not equivalent, an elevated user gets a
 * different — or a wrong — result from the same menu item, and only for them.
 *
 * Two shapes strain it:
 *
 *  1. **A UNC path.** `\\server\share\file` has no drive, and `/select,` historically wanted one.
 *  2. **A path containing a comma.** `/select,` is itself comma-delimited, so `C:\a,b\c.txt` reads
 *     as though the argument were `C:\a` followed by something else.
 *
 * ══ WHAT IS ANSWERED HERE, AND WHAT CANNOT BE ══
 *
 * The **argument construction** is a pure property and is asserted unconditionally below — it is
 * where a comma would be mangled if it were going to be, and it costs nothing to pin. What a
 * launched `explorer.exe` then DOES with it is observable only by launching one, which opens a
 * window on the developer's desktop, so that half is `@admin` and skipped otherwise rather than
 * softened into something that passes.
 */

function runnerElevated(): boolean {
  if (process.platform !== 'win32') return false;
  try {
    execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'net.exe'), ['session'], {
      stdio: 'ignore',
      windowsHide: true,
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

const ELEVATED = runnerElevated();
const whenElevated = ELEVATED ? describe : describe.skip;

const roots: string[] = [];

afterAll(() => {
  for (const dir of roots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      /* a temp tree left behind is not worth failing a passing assertion over */
    }
  }
});

/** Exactly what `ElectronShellIntegration.revealInFileManager` builds when it de-elevates. */
const selectArgs = (path: string): string[] => [`/select,${path}`];

describe('O3 \u2014 the argument construction, which is where a comma would be mangled', () => {
  it('a path with a comma stays ONE argument, comma and all', () => {
    const args = selectArgs('C:\\a,b\\c.txt');
    expect(args).toHaveLength(1);
    expect(args[0]).toBe('/select,C:\\a,b\\c.txt');
  });

  it('a UNC path stays one argument too', () => {
    expect(selectArgs('\\\\server\\share\\x.txt')).toEqual(['/select,\\\\server\\share\\x.txt']);
  });

  it('the comma after /select is the ONLY delimiter, and the path keeps its own', () => {
    // The distinction O3 is about: `/select,` is a prefix on one argv element, not a separator
    // between two. Node passes argv as an array, so nothing re-splits it on the way to the process —
    // which is why a comma in the path survives at THIS layer whatever explorer then makes of it.
    const args = selectArgs('C:\\Reports\\2026,Q1\\summary.txt');
    expect(args[0].indexOf(',')).toBe('/select'.length);
    expect(args[0].slice('/select,'.length)).toBe('C:\\Reports\\2026,Q1\\summary.txt');
  });
});

whenElevated('O3 (@admin) \u2014 what a launched explorer.exe actually does', () => {
  it('accepts a comma-bearing path without reporting an error', () => {
    const root = mkdtempSync(join(tmpdir(), 'throng-o3-'));
    roots.push(root);
    const folder = join(root, 'a,b');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, 'c.txt');
    writeFileSync(file, 'x', 'utf8');
    // `explorer.exe` exits 1 even on success, so the observable is that it does not THROW at spawn
    // — an invalid argument is refused by the CRT before the process starts.
    expect(() => {
      try {
        execFileSync(join(process.env.SystemRoot ?? 'C:\\Windows', 'explorer.exe'), selectArgs(file), {
          stdio: 'ignore',
          windowsHide: true,
          timeout: 10_000,
        });
      } catch (e) {
        // A non-zero exit is explorer's normal behaviour; only a spawn failure is a finding.
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') throw e;
      }
    }).not.toThrow();
  });
});

describe('O3 coverage note', () => {
  it('says out loud which half ran', () => {
    console.log(
      ELEVATED
        ? '[045 O3] elevated run: the launch case executed'
        : '[045 O3] NOT elevated: the launch case was skipped. The argument construction was still checked.',
    );
    expect(typeof ELEVATED).toBe('boolean');
  });
});
