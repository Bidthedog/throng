import {
  FILEOP_UNDO_GET_METHOD,
  FILEOP_UNDO_SET_METHOD,
  JSON_RPC_INVALID_PARAMS,
  type FileOpUndoGetResult,
  type FileOpUndoSetResult,
} from '@throng/ipc-contract';
import type { FileOpUndoRepository } from '@throng/persistence';
import type { IUserContext } from '@throng/core';
import { RpcError, type RpcRouter } from './rpc-router.js';

function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError('Params must be an object', JSON_RPC_INVALID_PARAMS);
  }
  return params as Record<string, unknown>;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new RpcError(`A non-empty "${key}" is required`, JSON_RPC_INVALID_PARAMS);
  }
  return value;
}

/**
 * `fileopUndo.*` RPC (024 US3, #85) — a thin adapter over {@link FileOpUndoRepository}.
 *
 * It validates params, resolves the OWNER from the user context, and holds no rules of its own: the
 * stack's shape, its 50-entry bound and what an entry means all belong to the pure engine in
 * `@throng/core`, which hands this one an opaque string.
 */
export class FileOpUndoIpcService {
  constructor(
    private readonly repo: FileOpUndoRepository,
    private readonly userContext: IUserContext,
  ) {}

  register(router: RpcRouter): void {
    router.register(FILEOP_UNDO_GET_METHOD, (params) => this.get(params));
    router.register(FILEOP_UNDO_SET_METHOD, (params) => this.set(params));
  }

  private owner(): string {
    // From the user context, never the params — a client that could name its owner could read
    // another user's history.
    return this.userContext.currentUser().userId;
  }

  private get(params: unknown): FileOpUndoGetResult {
    const projectId = requireString(asObject(params), 'projectId');
    return { stackJson: this.repo.get(this.owner(), projectId) };
  }

  private set(params: unknown): FileOpUndoSetResult {
    const p = asObject(params);
    const projectId = requireString(p, 'projectId');
    // The stack is allowed to be EMPTY (`{"undo":[],"redo":[]}`) — that is what clearing looks
    // like — so this one is not `requireString`'s non-empty check by accident.
    const stackJson = p.stackJson;
    if (typeof stackJson !== 'string') {
      throw new RpcError('A "stackJson" string is required', JSON_RPC_INVALID_PARAMS);
    }
    this.repo.set(this.owner(), projectId, stackJson, new Date().toISOString());
    return { ok: true };
  }
}
