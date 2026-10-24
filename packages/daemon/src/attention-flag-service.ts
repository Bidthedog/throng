import {
  ATTENTION_FLAG_CLEAR_METHOD,
  ATTENTION_FLAG_LIST_METHOD,
  ATTENTION_FLAG_SET_METHOD,
  JSON_RPC_INVALID_PARAMS,
  type AttentionFlagListResult,
  type AttentionFlagOkResult,
} from '@throng/ipc-contract';
import type { AttentionFlagEntry } from '@throng/core';
import type { AttentionFlagRepository } from '@throng/persistence';
import { RpcError, type RpcRouter } from './rpc-router.js';

function invalid(message: string): RpcError {
  return new RpcError(message, JSON_RPC_INVALID_PARAMS);
}

function asObject(params: unknown): Record<string, unknown> {
  if (typeof params !== 'object' || params === null || Array.isArray(params)) {
    throw invalid('Params must be an object');
  }
  return params as Record<string, unknown>;
}

function requireString(p: Record<string, unknown>, key: string, allowEmpty = false): string {
  const value = p[key];
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    throw invalid(`A${allowEmpty ? '' : ' non-empty'} "${key}" string is required`);
  }
  return value;
}

function parseEntry(params: unknown): AttentionFlagEntry {
  const p = asObject(params);
  const raisedAt = p.raisedAt;
  if (typeof raisedAt !== 'number' || !Number.isFinite(raisedAt)) {
    throw invalid('A finite "raisedAt" number is required');
  }
  return {
    panelId: requireString(p, 'panelId'),
    projectId: requireString(p, 'projectId'),
    // Titles are display text and may legitimately be empty (an unnamed tab).
    panelTitle: requireString(p, 'panelTitle', true),
    tabTitle: requireString(p, 'tabTitle', true),
    projectName: requireString(p, 'projectName', true),
    raisedAt,
  };
}

/**
 * `attention.flag*` RPC (057 round 12, FR-125 / FR-128) — a thin adapter over
 * {@link AttentionFlagRepository}. Flags live in SQLite, never in the terminal attention ledger.
 */
export class AttentionFlagIpcService {
  constructor(private readonly repo: AttentionFlagRepository) {}

  register(router: RpcRouter): void {
    router.register(ATTENTION_FLAG_LIST_METHOD, (): AttentionFlagListResult => ({
      flags: this.repo.list(),
    }));
    router.register(ATTENTION_FLAG_SET_METHOD, (params): AttentionFlagOkResult => {
      this.repo.set(parseEntry(params));
      return { ok: true };
    });
    router.register(ATTENTION_FLAG_CLEAR_METHOD, (params): AttentionFlagOkResult => {
      this.repo.clear(requireString(asObject(params), 'panelId'));
      return { ok: true };
    });
  }
}
