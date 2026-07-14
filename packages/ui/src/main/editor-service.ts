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
  resolveDrop,
  type DropDecision,
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
  // `out-of-tree` (018 / US9, FR-061): a load refused by the CONFINEMENT rule, and a distinct reason
  // from `io`. It used to be reported as an io/missing-file error — which the renderer SUPPRESSES when
  // missing-file warnings are off, making an ownership refusal look like nothing happening at all. A
  // silent no-op is the one outcome a rejection may never have.
  | {
      ok: false;
      // `not-found` is a genuinely absent file (a dangling symlink, a file deleted mid-drag). It stays
      // DISTINCT from `out-of-tree`, which is a file that exists and is refused — the two used to be the
      // same reason, which is how a refusal came to be reported as an absence.
      reason: 'binary' | 'too-large' | 'io' | 'out-of-tree' | 'folder' | 'not-found';
      error: string;
    };

export type SaveReason = 'out-of-tree' | 'no-location' | 'io';
export type SaveResult =
  | { ok: true; absPath: string; encoding: EncodingId; lineEnding: LineEndingId }
  | { ok: false; reason: SaveReason; error: string };

export interface LoadRequest {
  absPath: string;
  /** Owning project root (for the relative-folder pill); null for sub-ws-owned. */
  ownerRoot: string | null;
  /**
   * The document's ownership, and every loaded project root (018 / US9, SC-012).
   *
   * The load path used to take neither, which is precisely why it could not enforce the rule the SAVE
   * path enforces — and so a file could be opened into an editor that would then refuse to save it.
   */
  ownerKind: EditorOwnerKind;
  allProjectRoots: readonly string[];
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

  /**
   * Read + decode a file for the editor.
   *
   * 018 / US9: this now runs the SAME confinement rule the save path runs, on the SAME resolved path
   * (`resolveEntry`). Read scope equals write scope — a file that cannot be saved is never opened, so
   * the user never types into a buffer that has nowhere to go.
   */
  async load(req: LoadRequest): Promise<LoadResult> {
    try {
      const decision = await this.resolveEntry(req);
      if (!decision.ok) return decision;
      const bytes = await this.fs.readBytes(decision.absPath);
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
        relativeFolder: relativeFolderOf(decision.absPath, req.ownerRoot),
      };
    } catch (e) {
      return { ok: false, reason: 'io', error: message(e) };
    }
  }

  /**
   * Resolve an entry the user is asking to open — from the tree, from a restore, or dropped in from the
   * operating system — and decide whether it may be.
   *
   * THE DECISION IS MADE HERE, IN MAIN. The renderer says "this path was dropped on me"; it does not get
   * to say whether that is allowed. Symlinks are resolved BEFORE the rule sees the path, because a rule
   * applied to a link rather than to its target is not a rule (SC-011).
   *
   * This is the one place the drop IPC and the load path share, which is what makes "read scope equals
   * write scope" a fact about the code rather than a promise in a comment.
   */
  async resolveEntry(req: LoadRequest): Promise<DropDecision> {
    const realPath = await this.resolveRealTarget(req.absPath);
    const stat = await this.fs.stat(realPath);
    // A folder has no meaningful size to compare against the limit, and `resolveDrop` refuses it before
    // it would ever look — but reading the size of one is an OS call that can fail, so don't make it.
    const size = stat.kind === 'folder' ? 0 : await this.fs.size(realPath);
    return resolveDrop(
      { realPath, isDirectory: stat.kind === 'folder', size },
      { ownerKind: req.ownerKind },
      { ownerRoot: req.ownerRoot, allProjectRoots: req.allProjectRoots },
      { maxOpenFileBytes: this.settings().editor.maxOpenFileBytes },
    );
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
