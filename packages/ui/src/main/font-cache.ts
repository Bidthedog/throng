/**
 * Installed-font cache (feature 007, FR-038a / SC-010). Enumeration is OS-specific
 * and can be slow, so at startup UI main kicks off a BACKGROUND populate (never
 * awaited on the startup path) that writes `%APPDATA%\throng\fonts.json`. The
 * font-family picker reads the cache; a restart refreshes it (no live refresh).
 * An empty/absent cache is tolerated — the picker falls back to a curated list.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { IFontEnumeration } from '@throng/core';

export class FontCache {
  private readonly cachePath: string;

  constructor(
    private readonly enumeration: IFontEnumeration,
    appDataDir: string,
  ) {
    this.cachePath = join(appDataDir, 'fonts.json');
  }

  /** Enumerate installed families and write the cache. Never blocks startup. */
  populateInBackground(): void {
    void (async () => {
      try {
        const families = await this.enumeration.listInstalledFamilies();
        await mkdir(dirname(this.cachePath), { recursive: true });
        await writeFile(this.cachePath, `${JSON.stringify({ families }, null, 2)}\n`, 'utf8');
      } catch {
        // best-effort: a failed enumeration just leaves the picker on its fallback
      }
    })();
  }

  /** Read the cached families (empty array if the cache is absent/unparseable). */
  async read(): Promise<string[]> {
    try {
      const raw = JSON.parse(await readFile(this.cachePath, 'utf8')) as { families?: unknown };
      return Array.isArray(raw.families)
        ? raw.families.filter((f): f is string => typeof f === 'string')
        : [];
    } catch {
      return [];
    }
  }
}
