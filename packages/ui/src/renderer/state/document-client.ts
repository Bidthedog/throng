import type {
  DocumentGetStateResult,
  DocumentMovePathResult,
  DocumentPruneResult,
  DocumentSetStateResult,
  DocumentStateDto,
} from '@throng/ipc-contract';
import type { ThrongBridge } from './bridge.js';

/**
 * Typed renderer client for the `document.*` daemon methods (016, FR-028b/FR-028e).
 *
 * The renderer never touches SQLite: renderer → preload → UI main → daemon. It also never names an
 * OWNER — the daemon resolves that from the user context, which is why there is no owner parameter
 * anywhere in this file.
 */
export class DocumentClient {
  constructor(private readonly bridge: ThrongBridge) {}

  /** The document's persisted state, or null when it has none. */
  async getState(projectId: string, relPath: string): Promise<DocumentStateDto | null> {
    const result = await this.bridge.invoke<DocumentGetStateResult>('document.getState', {
      projectId,
      relPath,
    });
    return result.state;
  }

  /** Set the language override, or clear it with `null`. */
  async setState(
    projectId: string,
    relPath: string,
    languageId: string | null,
  ): Promise<DocumentStateDto> {
    const result = await this.bridge.invoke<DocumentSetStateResult>('document.setState', {
      projectId,
      relPath,
      languageId,
    });
    return result.state;
  }

  /**
   * Carry the document's state with the file across an in-throng rename, move, or Save-As.
   *
   * `false` simply means the file had no override — the common case. Callers must not treat it as
   * a failure.
   */
  async movePath(projectId: string, fromRelPath: string, toRelPath: string): Promise<boolean> {
    const result = await this.bridge.invoke<DocumentMovePathResult>('document.movePath', {
      projectId,
      fromRelPath,
      toRelPath,
    });
    return result.moved;
  }

  /**
   * Drop rows whose file no longer exists (FR-028e). Called on project open, OFF the critical
   * path: it is the backstop for files deleted outside throng, and it must never be the thing
   * standing between the user and their first file.
   */
  async pruneMissing(projectId: string): Promise<number> {
    const result = await this.bridge.invoke<DocumentPruneResult>('document.pruneMissing', {
      projectId,
    });
    return result.pruned;
  }
}
