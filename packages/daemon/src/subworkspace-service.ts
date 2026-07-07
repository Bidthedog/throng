import {
  SUBWORKSPACE_LIST_METHOD,
  SUBWORKSPACE_RENAME_METHOD,
  SUBWORKSPACE_RECOLOUR_METHOD,
  SUBWORKSPACE_DELETE_METHOD,
  SUBWORKSPACE_REORDER_METHOD,
  SUBWORKSPACE_UPDATE_BOUNDS_METHOD,
  JSON_RPC_INVALID_PARAMS,
} from '@throng/ipc-contract';
import type { ISubWorkspaceStore, IUserContext } from '@throng/core';
import { RpcError, type RpcRouter } from './rpc-router.js';

export interface SubWorkspaceIpcDeps {
  store: ISubWorkspaceStore;
  userContext: IUserContext;
}

function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null) {
    throw new RpcError('Params must be an object', JSON_RPC_INVALID_PARAMS);
  }
  return params as Record<string, unknown>;
}

function requireId(params: unknown): string {
  const id = asObject(params).id;
  if (typeof id !== 'string' || id.length === 0) {
    throw new RpcError('A non-empty "id" is required', JSON_RPC_INVALID_PARAMS);
  }
  return id;
}

/**
 * Daemon adapter for `subworkspace.*` (003 / contracts/ipc-subworkspaces.md):
 * the post-creation management surface (list/rename/recolour/delete) over the
 * {@link ISubWorkspaceStore}. Owner resolved from {@link IUserContext}.
 */
export class SubWorkspaceIpcService {
  constructor(private readonly deps: SubWorkspaceIpcDeps) {}

  private get owner(): string {
    return this.deps.userContext.currentUser().userId;
  }

  register(router: RpcRouter): void {
    router.register(SUBWORKSPACE_LIST_METHOD, () => ({
      subWorkspaces: this.deps.store.list(this.owner),
    }));

    router.register(SUBWORKSPACE_RENAME_METHOD, (params) => {
      const id = requireId(params);
      const name = asObject(params).name;
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new RpcError('A non-empty "name" is required', JSON_RPC_INVALID_PARAMS);
      }
      this.deps.store.rename(this.owner, id, name.trim());
      return { ok: true } as const;
    });

    router.register(SUBWORKSPACE_RECOLOUR_METHOD, (params) => {
      const id = requireId(params);
      const colour = asObject(params).colour;
      if (typeof colour !== 'string' || colour.length === 0) {
        throw new RpcError('A non-empty "colour" is required', JSON_RPC_INVALID_PARAMS);
      }
      this.deps.store.recolour(this.owner, id, colour);
      return { ok: true } as const;
    });

    router.register(SUBWORKSPACE_DELETE_METHOD, (params) => {
      this.deps.store.delete(this.owner, requireId(params));
      return { ok: true } as const;
    });

    router.register(SUBWORKSPACE_REORDER_METHOD, (params) => {
      const orderedIds = asObject(params).orderedIds;
      if (!Array.isArray(orderedIds) || orderedIds.some((id) => typeof id !== 'string')) {
        throw new RpcError('"orderedIds" must be an array of ids', JSON_RPC_INVALID_PARAMS);
      }
      this.deps.store.reorder(this.owner, orderedIds as string[]);
      return { ok: true } as const;
    });

    router.register(SUBWORKSPACE_UPDATE_BOUNDS_METHOD, (params) => {
      const id = requireId(params);
      const bounds = asObject(params).bounds as
        | { x: number; y: number; width: number; height: number; displayId?: string }
        | undefined;
      if (
        !bounds ||
        ['x', 'y', 'width', 'height'].some((k) => typeof (bounds as Record<string, unknown>)[k] !== 'number')
      ) {
        throw new RpcError('"bounds" must be {x,y,width,height}', JSON_RPC_INVALID_PARAMS);
      }
      this.deps.store.updateBounds(this.owner, id, bounds);
      return { ok: true } as const;
    });
  }
}
