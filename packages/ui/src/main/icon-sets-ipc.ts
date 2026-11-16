/**
 * The `throng:iconSets:*` handlers (spec 069, contracts/icon-sets-ipc.md).
 *
 * The renderer is not trusted and never sends a path. A set is named, the name is looked up in the
 * service's listing, and only then does a path exist, here in main. `throng` is the compiled-in
 * default set and is never a folder (FR-021), so it is never in the listing and every handler
 * refuses it as an unknown set.
 *
 * Every refusal is logged (Principle XIII): validation with `logExpected`, I/O with `logCaught`.
 *
 * Every action reads the sets from disk again, before and after it (FR-041): before, so a set made,
 * renamed or removed outside throng is what the action finds; after, so every window draws what the
 * folders now hold. The fresh listing is broadcast whether the action succeeded or not, because a
 * refusal is often the first sign the folders changed underneath the window.
 */
import type { IShellIntegration, UserIconSetDto } from '@throng/core';
import { logCaught, logExpected } from '@throng/core';
import type { IconSetFailure, IconSetResult, IconSetService } from './icon-set-service.js';

export const ICON_SETS_CHANNELS = {
  create: 'throng:iconSets:create',
  override: 'throng:iconSets:override',
  reload: 'throng:iconSets:reload',
  openFolder: 'throng:iconSets:openFolder',
  rename: 'throng:iconSets:rename',
  remove: 'throng:iconSets:remove',
  resetIcon: 'throng:iconSets:resetIcon',
  backupsPresent: 'throng:iconSets:backupsPresent',
  backupsReady: 'throng:iconSets:backupsReady',
} as const;

export interface IconSetsIpcMain {
  handle(channel: string, listener: (event: unknown, payload?: unknown) => Promise<unknown>): void;
}

export interface IconSetsIpcDeps {
  service: Pick<
    IconSetService,
    'create' | 'override' | 'reload' | 'rescan' | 'rename' | 'remove' | 'resetIcon' | 'pathOf' | 'dir' | 'ensureDir'
  > & {
    list(): readonly UserIconSetDto[];
  };
  shell: Pick<IShellIntegration, 'openFolder'>;
  /** `validateIconSetName` from core (FR-025), injected so the handler is tested without it. */
  validateName(name: string, existing: readonly string[]): { ok: true } | { ok: false; reason: string };
  /** Re-read the config and broadcast it, so every window receives the changed sets. */
  onChanged(): Promise<void>;
  /** Point the themes naming a renamed or deleted set at its new name, or at the default set (FR-042, FR-043). */
  retargetThemes(from: string, to: string | undefined): Promise<unknown>;
  /** Let the folder about to open in the file manager come up above Preferences (FR-045). */
  beforeOpenFolder(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function refuse(reason: IconSetFailure, message: string): IconSetResult {
  return { ok: false, reason, message };
}

export function registerIconSetsIpc(ipc: IconSetsIpcMain, deps: IconSetsIpcDeps): void {
  const listed = (): string[] => deps.service.list().map((s) => s.name);

  /** Read the folders again, run the action against what they hold now, read them again and broadcast. */
  const act = async (work: () => Promise<IconSetResult>): Promise<IconSetResult> => {
    await deps.service.rescan();
    let result: IconSetResult;
    try {
      result = await work();
    } finally {
      await deps.service.rescan();
      await deps.onChanged();
    }
    return result;
  };

  ipc.handle(ICON_SETS_CHANNELS.create, async (_event, payload) => {
    const name = isRecord(payload) ? str(payload.name) : undefined;
    const from = isRecord(payload) ? str(payload.from) : undefined;
    if (name === undefined || from === undefined) {
      logExpected('icon-sets: create', 'a malformed payload is refused', payload);
      return refuse('invalid-name', 'That is not a usable icon set name.');
    }
    return act(async () => {
      const verdict = deps.validateName(name, listed());
      if (!verdict.ok) {
        logExpected('icon-sets: create', 'the user chose a name FR-025 refuses', verdict.reason);
        return refuse('invalid-name', verdict.reason);
      }
      return deps.service.create(name, from);
    });
  });

  ipc.handle(ICON_SETS_CHANNELS.override, async (_event, payload) => {
    const set = isRecord(payload) ? str(payload.set) : undefined;
    const key = isRecord(payload) ? str(payload.key) : undefined;
    const replace = isRecord(payload) && payload.replace === true;
    return act(async () => {
      const known = knownSet('override', set);
      if (known) return known;
      if (key === undefined) {
        logExpected('icon-sets: override', 'the renderer sends only listed keys; a missing key is refused', payload);
        return refuse('unknown-key', 'That is not an icon key.');
      }
      return deps.service.override(set as string, key, replace);
    });
  });

  /** A refusal when `set` is not a listed user set, or undefined when it is. */
  const knownSet = (what: string, set: string | undefined): IconSetResult | undefined => {
    if (set !== undefined && deps.service.pathOf(set) !== undefined) return undefined;
    logExpected(`icon-sets: ${what}`, 'the set is not in the listing (or is the default set)', set);
    return refuse('unknown-set', 'That icon set is not available.');
  };

  // Any set, or none: Reload reads every set again (FR-041).
  ipc.handle(ICON_SETS_CHANNELS.reload, async () => act(() => deps.service.reload()));

  ipc.handle(ICON_SETS_CHANNELS.rename, async (_event, payload) => {
    const from = isRecord(payload) ? str(payload.from) : undefined;
    const to = isRecord(payload) ? str(payload.to) : undefined;
    return act(async () => {
      const known = knownSet('rename', from);
      if (known) return known;
      if (to === undefined) {
        logExpected('icon-sets: rename', 'a malformed payload is refused', payload);
        return refuse('invalid-name', 'That is not a usable icon set name.');
      }
      // The set's own name is not a clash: a change of case alone is a rename too.
      const verdict = deps.validateName(to, listed().filter((n) => n !== from));
      if (!verdict.ok) {
        logExpected('icon-sets: rename', 'the user chose a name FR-025 refuses', verdict.reason);
        return refuse('invalid-name', verdict.reason);
      }
      const result = await deps.service.rename(from as string, to);
      if (result.ok) await deps.retargetThemes(from as string, to);
      return result;
    });
  });

  ipc.handle(ICON_SETS_CHANNELS.remove, async (_event, payload) => {
    const set = isRecord(payload) ? str(payload.set) : undefined;
    return act(async () => {
      const known = knownSet('delete', set);
      if (known) return known;
      const result = await deps.service.remove(set as string);
      if (result.ok) await deps.retargetThemes(set as string, undefined);
      return result;
    });
  });

  ipc.handle(ICON_SETS_CHANNELS.resetIcon, async (_event, payload) => {
    const set = isRecord(payload) ? str(payload.set) : undefined;
    const key = isRecord(payload) ? str(payload.key) : undefined;
    return act(async () => {
      const known = knownSet('reset icon', set);
      if (known) return known;
      if (key === undefined) {
        logExpected('icon-sets: reset icon', 'the renderer sends only listed keys; a missing key is refused', payload);
        return refuse('unknown-key', 'That is not an icon key.');
      }
      return deps.service.resetIcon(set as string, key);
    });
  });

  ipc.handle(ICON_SETS_CHANNELS.openFolder, async (_event, payload) => {
    const set = isRecord(payload) ? str(payload.set) : undefined;
    return act(async () => {
      let path: string | undefined;
      if (set === undefined) {
        path = deps.service.dir;
      } else {
        path = deps.service.pathOf(set);
        if (path === undefined) return knownSet('open folder', set) as IconSetResult;
      }
      try {
        if (set === undefined) await deps.service.ensureDir();
        deps.beforeOpenFolder();
        await deps.shell.openFolder(path);
        return { ok: true };
      } catch (error) {
        logCaught('icon-sets: open folder', error);
        return refuse('io', error instanceof Error ? error.message : String(error));
      }
    });
  });
}
