import type { LinkActionOutcome, LinkResolution, LinkResolutionRequest } from '@throng/core';

/**
 * `throng:links:*` — the only way a renderer learns anything about a file link
 * (045 FR-035 – FR-037, `contracts/settings-and-environment.md` §3).
 *
 * Three channels, all `invoke`, all answering the window that asked. There is no `send` and no
 * broadcast here, and that absence is a policy rather than an omission (I6): every answer contains a
 * resolved absolute path, and broadcasting one would hand one window's filesystem to every other.
 *
 * ══ THE HANDLERS ARE A GATE, NOT A PASS-THROUGH ══
 *
 * A renderer is untrusted about paths. So each handler rebuilds the request from exactly four fields
 * and forwards NOTHING else (I1) — an `absPath` or a `projectRoot` a renderer adds is dropped on the
 * floor rather than reaching the resolver, where it might later be believed. A request with no
 * `panelId` is refused outright rather than resolved against no project (I2): main derives the
 * owning root from the panel, and a resolution with no root to check against would silently answer
 * `inProject: false` for a file that is in fact inside one, which is the shape of a bug that only
 * shows up as a missing menu item.
 *
 * ══ FAILURES COME BACK AS VALUES ══
 *
 * A handler that rejects surfaces across the bridge as an opaque `Error: Error invoking remote
 * method` with the real reason stripped. Every one of these answers a value instead, so the caller
 * has something it can turn into ONE notice naming the file and the reason (030).
 */

/** The slice of Electron's `ipcMain` this module needs. */
export interface LinkIpcMain {
  handle(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
  on(channel: string, listener: (event: unknown, payload: unknown) => unknown): void;
}

/** What the channels are served by — `FileLinkResolver`, structurally. */
export interface LinkIpcService {
  resolve(request: LinkResolutionRequest): Promise<LinkResolution>;
  revealInFileManager(request: LinkResolutionRequest): Promise<LinkActionOutcome>;
  openWithDefaultProgram(request: LinkResolutionRequest): Promise<LinkActionOutcome>;
}

const KINDS = new Set(['detectedPath', 'fileHyperlink']);

/**
 * I1/I2. Rebuild the request from the five fields it is allowed to have, or `null`.
 *
 * Written as a whitelist rather than a delete-list on purpose: a delete-list has to be updated every
 * time someone invents a new field to smuggle, and it fails open when nobody does.
 *
 * `originProjectId` is an **ID and not a root**, and the difference is the confinement: main looks
 * the id up in its own project cache, so a renderer naming one it does not own gets nothing, while
 * a renderer able to name a ROOT could name `C:\`. Same reasoning as `authoritative()`.
 */
function sanitise(payload: unknown): LinkResolutionRequest | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const raw = payload as Record<string, unknown>;
  if (typeof raw.text !== 'string' || raw.text.length === 0) return null;
  if (typeof raw.kind !== 'string' || !KINDS.has(raw.kind)) return null;
  if (typeof raw.panelId !== 'string' || raw.panelId.length === 0) return null;
  return {
    text: raw.text,
    kind: raw.kind as LinkResolutionRequest['kind'],
    // Absent rather than wrong: a base directory that is not a string is not a directory, and
    // FR-022's "an untitled buffer supplies none" is already the handled case.
    baseDirectory: typeof raw.baseDirectory === 'string' ? raw.baseDirectory : undefined,
    panelId: raw.panelId,
    // Absent rather than wrong, and absent means "no owning project" — which judges every target
    // outside one (M3), the safe reading of a claim main could not parse.
    originProjectId: typeof raw.originProjectId === 'string' ? raw.originProjectId : undefined,
  };
}

export function registerLinkIpc(ipcMain: LinkIpcMain, service: LinkIpcService): void {
  ipcMain.handle('throng:links:resolve', async (_event, payload): Promise<LinkResolution> => {
    const request = sanitise(payload);
    // A malformed request is a NON-LINK, not an error: the renderer asked whether something is a
    // link, and "no" is the honest answer to a question main will not act on (FR-006).
    if (request === null) return { ok: false };
    try {
      return await service.resolve(request);
    } catch {
      return { ok: false };
    }
  });

  for (const [channel, act] of [
    ['throng:links:reveal', (r: LinkResolutionRequest) => service.revealInFileManager(r)],
    ['throng:links:open', (r: LinkResolutionRequest) => service.openWithDefaultProgram(r)],
  ] as const) {
    ipcMain.handle(channel, async (_event, payload): Promise<LinkActionOutcome> => {
      const request = sanitise(payload);
      if (request === null) return { ok: false, reason: 'refused', path: '' };
      try {
        return await act(request);
      } catch {
        // The path the user named, not a resolved one — we have no resolved one to give.
        return { ok: false, reason: 'refused', path: request.text };
      }
    });
  }
}
