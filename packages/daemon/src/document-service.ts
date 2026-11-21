import {
  DOCUMENT_GET_STATE_METHOD,
  DOCUMENT_SET_STATE_METHOD,
  DOCUMENT_MOVE_PATH_METHOD,
  DOCUMENT_PRUNE_METHOD,
  DOCUMENT_SET_GRID_COLUMN_WIDTHS_METHOD,
  JSON_RPC_INVALID_PARAMS,
  type DocumentStateDto,
  type DocumentSetGridColumnWidthsResult,
  type DocumentGetStateResult,
  type DocumentMovePathResult,
  type DocumentPruneResult,
  type DocumentSetStateResult,
} from '@throng/ipc-contract';
import type { DocumentState, DocumentStateRepository } from '@throng/persistence';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logExpected, type IUserContext } from '@throng/core';
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
 * `document.*` RPC (016, contracts/document-state-rpc.md). A thin adapter over
 * {@link DocumentStateRepository}: it validates params, resolves the OWNER from the user context,
 * and holds no rules of its own.
 *
 * The client never sends the owner — it is taken from `IUserContext`, so a client cannot ask for
 * another user's rows by naming them.
 */
export class DocumentIpcService {
  constructor(
    private readonly repo: DocumentStateRepository,
    private readonly userContext: IUserContext,
    /** The project's root folder on disk — what a row's relative path is resolved against. */
    private readonly projectRoot: (ownerUser: string, projectId: string) => string | null,
  ) {}

  register(router: RpcRouter): void {
    router.register(DOCUMENT_GET_STATE_METHOD, (params) => this.getState(params));
    router.register(DOCUMENT_SET_STATE_METHOD, (params) => this.setState(params));
    router.register(DOCUMENT_MOVE_PATH_METHOD, (params) => this.movePath(params));
    router.register(DOCUMENT_PRUNE_METHOD, (params) => this.pruneMissing(params));
    router.register(DOCUMENT_SET_GRID_COLUMN_WIDTHS_METHOD, (params) => this.setGridColumnWidths(params));
  }

  private owner(): string {
    // Resolved from the user context, never from the params — see the file header.
    return this.userContext.currentUser().userId;
  }

  private getState(params: unknown): DocumentGetStateResult {
    const p = asObject(params);
    const state = this.repo.get(this.owner(), requireString(p, 'projectId'), requireString(p, 'relPath'));
    return { state: state === null ? null : toDto(state) };
  }

  private setState(params: unknown): DocumentSetStateResult {
    const p = asObject(params);
    const languageId = p.languageId;
    if (languageId !== null && typeof languageId !== 'string') {
      throw new RpcError('"languageId" must be a string or null', JSON_RPC_INVALID_PARAMS);
    }
    // A language id this build does not recognise is stored ANYWAY (FR-005b). The daemon is not
    // the arbiter of which languages exist — a build that reintroduces one must find the user's
    // choice still there, and validating here would erase it on the first save.
    const state = this.repo.set(
      this.owner(),
      requireString(p, 'projectId'),
      requireString(p, 'relPath'),
      languageId,
    );
    return { state: toDto(state) };
  }

  /** 073 FR-040 — the widths are validated here, so the store only ever holds the declared shape. */
  private setGridColumnWidths(params: unknown): DocumentSetGridColumnWidthsResult {
    const p = asObject(params);
    const widths = p.widths === null ? null : gridWidthsOf(p.widths);
    if (widths === undefined) {
      throw new RpcError('"widths" must map column indexes to widths, or be null', JSON_RPC_INVALID_PARAMS);
    }
    const json = widths === null || Object.keys(widths).length === 0 ? null : JSON.stringify(widths);
    const state = this.repo.setGridColumnWidths(this.owner(), requireString(p, 'projectId'), requireString(p, 'relPath'), json);
    return { state: toDto(state) };
  }

  private movePath(params: unknown): DocumentMovePathResult {
    const p = asObject(params);
    const owner = this.owner();
    const projectId = requireString(p, 'projectId');
    // Absent → the move stays inside `projectId`. Present → it must name one of THIS owner's
    // projects: rows are never written under a project the caller does not have.
    const toProjectId = p.toProjectId === undefined ? projectId : requireString(p, 'toProjectId');
    if (toProjectId !== projectId && this.projectRoot(owner, toProjectId) === null) {
      throw new RpcError(`Unknown project "${toProjectId}"`, JSON_RPC_INVALID_PARAMS);
    }
    const moved = this.repo.movePath(
      owner,
      projectId,
      requireString(p, 'fromRelPath'),
      requireString(p, 'toRelPath'),
      toProjectId,
    );
    return { moved };
  }

  private pruneMissing(params: unknown): DocumentPruneResult {
    const p = asObject(params);
    const projectId = requireString(p, 'projectId');
    const root = this.projectRoot(this.owner(), projectId);
    // A project whose root cannot be resolved prunes NOTHING. Treating "I cannot see the folder"
    // as "none of these files exist" would delete every override the project has, which is the
    // opposite of a safe default — an unreachable network share must not cost the user their
    // settings.
    if (!root) return { pruned: 0 };
    const pruned = this.repo.pruneMissing(this.owner(), projectId, (relPath) =>
      existsSync(join(root, relPath)),
    );
    return { pruned };
  }
}

/** The most columns a file's widths may name — an abuse limit, not a preference. */
const MAX_WIDTH_ENTRIES = 10_000;

/** Column index → px (40–2000), or `undefined` for anything else. */
function gridWidthsOf(raw: unknown): Record<string, number> | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_WIDTH_ENTRIES) return undefined;
  const out: Record<string, number> = {};
  for (const [k, v] of entries) {
    if (!/^(0|[1-9]\d{0,6})$/.test(k) || typeof v !== 'number' || !Number.isFinite(v) || v < 40 || v > 2000) return undefined;
    out[k] = Math.round(v);
  }
  return out;
}

/** A stored row as the wire carries it: the widths' JSON parsed, and dropped if it no longer parses. */
function toDto(state: DocumentState): DocumentStateDto {
  let gridColumnWidths: Record<string, number> | null = null;
  if (state.gridColumnWidths !== null) {
    try {
      gridColumnWidths = gridWidthsOf(JSON.parse(state.gridColumnWidths)) ?? null;
    } catch (error) {
      logExpected('document-service: read stored grid widths', 'a stored widths value that no longer parses is read as none', error);
      gridColumnWidths = null;
    }
  }
  return { projectId: state.projectId, relPath: state.relPath, languageId: state.languageId, gridColumnWidths };
}
