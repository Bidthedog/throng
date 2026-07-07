/**
 * EditorRecovery — crash/close survival for open editor documents (006 Phase E,
 * FR-041/042/043). Writes each open document's in-progress content to
 * `%APPDATA%\throng\recovery\<panelId>` continuously while it is open (independent
 * of auto-save, and NOT a dirty signal — FR-053), restores it on launch matched by
 * panelId, and removes it on full save / editor close. Owned by UI main; uses
 * `node:fs` directly (this is a UI-main module, not core).
 */
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

/** Encode a panelId into a safe flat filename (panelIds are opaque tokens). */
function safeName(panelId: string): string {
  return encodeURIComponent(panelId);
}

function decodeName(name: string): string {
  try {
    return decodeURIComponent(name);
  } catch {
    return name;
  }
}

export interface RecoveredDoc {
  panelId: string;
  text: string;
}

export class EditorRecovery {
  constructor(private readonly dir: string) {}

  private async ensureDir(): Promise<void> {
    await mkdir(this.dir, { recursive: true });
  }

  /** Write (overwrite) the recovery temp for a panel's current content. */
  async write(panelId: string, text: string): Promise<void> {
    await this.ensureDir();
    await writeFile(join(this.dir, safeName(panelId)), text, 'utf8');
  }

  /** Remove a panel's recovery temp (full save / close without unsaved content). */
  async remove(panelId: string): Promise<void> {
    await rm(join(this.dir, safeName(panelId)), { force: true });
  }

  /** All recovery temps currently on disk (launch-time reconciliation). */
  async list(): Promise<RecoveredDoc[]> {
    let names: string[];
    try {
      names = await readdir(this.dir);
    } catch {
      return [];
    }
    const out: RecoveredDoc[] = [];
    for (const name of names) {
      try {
        const text = await readFile(join(this.dir, name), 'utf8');
        out.push({ panelId: decodeName(name), text });
      } catch {
        /* skip unreadable temp */
      }
    }
    return out;
  }

  /** Read one panel's recovery temp, or null if absent. */
  async read(panelId: string): Promise<string | null> {
    try {
      return await readFile(join(this.dir, safeName(panelId)), 'utf8');
    } catch {
      return null;
    }
  }
}
