import type { AttentionFlagEntry } from '@throng/core';

// --- 057 manual flags (contracts/daemon-attention.md, FR-125, FR-128) ---

/** Read every manual flag held in the `attention_flag` table. No params. */
export const ATTENTION_FLAG_LIST_METHOD = 'attention.flagList';
/** Upsert a manual flag by `panelId`. Params are an {@link AttentionFlagEntry}. */
export const ATTENTION_FLAG_SET_METHOD = 'attention.flagSet';
/** Delete a manual flag; a missing row is not an error. Params `{ panelId }`. */
export const ATTENTION_FLAG_CLEAR_METHOD = 'attention.flagClear';

export interface AttentionFlagListResult {
  flags: AttentionFlagEntry[];
}
export type AttentionFlagSetParams = AttentionFlagEntry;
export interface AttentionFlagClearParams {
  panelId: string;
}
export interface AttentionFlagOkResult {
  ok: true;
}
