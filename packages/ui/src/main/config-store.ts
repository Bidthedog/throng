/**
 * FileConfigStore — the UI-main concrete {@link IConfigStore} (T033 / contract
 * os-config-store.md). Stores the user-scoped config documents as human-editable
 * JSON under a configured root (`%USERPROFILE%\.throng\` in production, a temp
 * dir in tests). I/O only: parsing/validation/default-merge is delegated to the
 * pure `@throng/core/config` schema functions supplied by the caller.
 *
 * Behaviour (research D1): an absent document is created from defaults and the
 * defaults returned; a malformed document resolves to defaults and is left
 * untouched on disk so the user can fix their edit; writes are atomic (temp file
 * + rename) and best-effort (a failure is logged, never thrown).
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ConfigDocId, ConfigReadOptions, IConfigStore } from '@throng/core';

export class FileConfigStore implements IConfigStore {
  constructor(private readonly configRoot: string) {}

  pathOf(doc: ConfigDocId): string {
    switch (doc.kind) {
      case 'settings':
        return join(this.configRoot, 'settings.json');
      case 'keybindings':
        return join(this.configRoot, 'keybindings.json');
      case 'theme':
        return join(this.configRoot, 'themes', `${doc.name}.json`);
    }
  }

  async read<T>(
    doc: ConfigDocId,
    defaults: T,
    validate: (raw: unknown) => T,
    options?: ConfigReadOptions,
  ): Promise<T> {
    const path = this.pathOf(doc);
    let raw: string;
    try {
      raw = await readFile(path, 'utf8');
    } catch (err) {
      // Absent → create from defaults and return them (first-run), UNLESS the
      // caller opted out (e.g. a theme named by settings that doesn't exist —
      // we must not write a stray file; we fall back to the hardcoded defaults).
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && options?.create !== false) {
        await this.write(doc, defaults);
      }
      return defaults;
    }
    try {
      return validate(JSON.parse(raw) as unknown);
    } catch {
      // Malformed JSON → defaults; leave the user's file intact (D1).
      return defaults;
    }
  }

  async write<T>(doc: ConfigDocId, value: T): Promise<void> {
    const path = this.pathOf(doc);
    try {
      await mkdir(dirname(path), { recursive: true });
      const tmp = `${path}.tmp`;
      await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
      await rename(tmp, path); // atomic replace (libuv MoveFileEx w/ replace on Windows)
    } catch (err) {
      // Best-effort: surface the failure without crashing the app (contract).
      console.error(`[config-store] failed to write ${path}:`, err);
    }
  }
}
