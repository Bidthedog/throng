import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { IFontEnumeration } from '@throng/core';

const run = promisify(execFile);

/**
 * Windows concrete {@link IFontEnumeration} (007, FR-038a). Lists installed font
 * families via Windows PowerShell 5.1 + System.Drawing (always present on
 * Windows), one family name per line. Absence-tolerant: any failure (missing
 * PowerShell, timeout, assembly error) resolves to an empty list so the font
 * picker falls back to a curated list rather than crashing. Presence-only; runs
 * in the background off the startup path (SC-010) and its result is cached by the
 * caller (font-cache in UI main).
 */
export class WindowsFontEnumeration implements IFontEnumeration {
  async listInstalledFamilies(): Promise<string[]> {
    try {
      const { stdout } = await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Add-Type -AssemblyName System.Drawing; [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }',
        ],
        { timeout: 10_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 },
      );
      const seen = new Set<string>();
      const families: string[] = [];
      for (const line of stdout.split(/\r?\n/)) {
        const name = line.trim();
        if (name.length > 0 && !seen.has(name)) {
          seen.add(name);
          families.push(name);
        }
      }
      return families;
    } catch {
      return [];
    }
  }
}
