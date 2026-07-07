/**
 * EditorService — UI-main file I/O + confinement for the Editor panel type (006,
 * contracts/editor-service.md). Reads/saves via the injected {@link IFileSystem}
 * (reused from 004), decoding/encoding through the pure core text-fidelity model
 * so encoding/BOM/line-endings are preserved. Enforces save confinement on
 * RESOLVED REAL paths (project tree, or outside all projects for sub-workspace-
 * owned editors) — it never writes outside the allowed location. All failures are
 * returned (never thrown across the bridge). The daemon is not involved.
 */
import { basename, dirname, join, relative } from 'node:path';
import {
  decode,
  encode,
  isProbablyBinary,
  resolveSaveConfinement,
  type AppSettings,
  type EditorOwnerKind,
  type EncodingId,
  type IFileSystem,
  type LineEndingId,
} from '@throng/core';

export type LoadResult =
  | {
      ok: true;
      text: string;
      encoding: EncodingId;
      hasBom: boolean;
      lineEnding: LineEndingId;
      relativeFolder: string | null;
    }
  | { ok: false; reason: 'binary' | 'too-large' | 'io'; error: string };

export type SaveReason = 'out-of-tree' | 'no-location' | 'io';
export type SaveResult =
  | { ok: true; absPath: string; encoding: EncodingId; lineEnding: LineEndingId }
  | { ok: false; reason: SaveReason; error: string };

export interface LoadRequest {
  absPath: string;
  /** Owning project root (for the relative-folder pill); null for sub-ws-owned. */
  ownerRoot: string | null;
}

export interface SaveRequest {
  absPath: string;
  text: string;
  encoding: EncodingId;
  hasBom: boolean;
  lineEnding: LineEndingId;
  ownerKind: EditorOwnerKind;
  ownerRoot: string | null;
  allProjectRoots: readonly string[];
}

export class EditorService {
  constructor(
    private readonly fs: IFileSystem,
    private readonly settings: () => AppSettings,
  ) {}

  /** Read + decode a file for the editor. Guards binary and too-large files. */
  async load(req: LoadRequest): Promise<LoadResult> {
    try {
      const max = this.settings().editor.maxOpenFileBytes;
      const size = await this.fs.size(req.absPath);
      if (size > max) {
        return {
          ok: false,
          reason: 'too-large',
          error: `File is too large to open (${size} bytes; limit ${max}).`,
        };
      }
      const bytes = await this.fs.readBytes(req.absPath);
      if (isProbablyBinary(bytes)) {
        return { ok: false, reason: 'binary', error: 'This file cannot be opened as text.' };
      }
      const decoded = decode(bytes);
      return {
        ok: true,
        text: decoded.text,
        encoding: decoded.encoding,
        hasBom: decoded.hasBom,
        lineEnding: decoded.lineEnding,
        relativeFolder: relativeFolderOf(req.absPath, req.ownerRoot),
      };
    } catch (e) {
      return { ok: false, reason: 'io', error: message(e) };
    }
  }

  /**
   * Encode + write, preserving encoding/BOM/line-endings and enforcing confinement.
   *
   * Trust model: `ownerRoot`/`ownerKind`/`allProjectRoots` are supplied by the
   * (sandboxed, first-party) renderer — the same trust boundary as `FilesService`,
   * whose active root is likewise set by the renderer (`throng:files:setRoot`). The
   * renderer cannot reach `fs` directly; confinement here guards against ordinary
   * bugs (out-of-tree/cross-project saves), not a malicious renderer. Resolving the
   * roots server-side against a UI-main-held project list would harden Principle I
   * further and is a sensible follow-up.
   */
  async save(req: SaveRequest): Promise<SaveResult> {
    try {
      const realTarget = await this.resolveRealTarget(req.absPath);
      const confinement = resolveSaveConfinement(
        { ownerKind: req.ownerKind },
        { ownerRoot: req.ownerRoot, allProjectRoots: req.allProjectRoots },
      );
      if (!confinement.allowed(realTarget)) {
        return {
          ok: false,
          reason: 'out-of-tree',
          error:
            confinement.kind === 'in-owner-tree'
              ? 'Editors can only save within their project.'
              : 'Sub-workspace editors can only save outside every project.',
        };
      }
      const bytes = encode(req.text, {
        encoding: req.encoding,
        hasBom: req.hasBom,
        lineEnding: req.lineEnding,
      });
      await this.fs.writeBytes(req.absPath, bytes);
      return { ok: true, absPath: req.absPath, encoding: req.encoding, lineEnding: req.lineEnding };
    } catch (e) {
      return { ok: false, reason: 'io', error: message(e) };
    }
  }

  /** Resolve the real path of a save target that may not exist yet (new doc). */
  private async resolveRealTarget(absPath: string): Promise<string> {
    if (await this.fs.exists(absPath)) return this.fs.realpath(absPath);
    const dir = dirname(absPath);
    const realDir = (await this.fs.exists(dir)) ? await this.fs.realpath(dir) : dir;
    return join(realDir, basename(absPath));
  }
}

/** The file's folder relative to its owner root (for the file pill); null when
 *  unpathed or ownerless, "" when the file sits directly at the root. */
function relativeFolderOf(absPath: string, ownerRoot: string | null): string | null {
  if (!ownerRoot) return null;
  const rel = relative(ownerRoot, dirname(absPath));
  // Outside the root (shouldn't happen for a confined save) → null.
  if (rel.startsWith('..')) return null;
  return rel.split('\\').join('/');
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
