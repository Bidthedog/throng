import type { AttentionKind, AttentionMark } from '@throng/core';

/**
 * A mark as main would broadcast it (057 data-model.md § AttentionMark), for the component tests that
 * stand in for main by calling `setAttentionMarks`. Not a test file: the component project includes only
 * `*.test.ts`.
 */
export function makeMark(
  panelId: string,
  projectId: string,
  opts: { kind?: AttentionKind; title?: string; projectName?: string; signal?: AttentionMark['reason']['signal']; detail?: string | null; raisedAt?: number; tabTitle?: string; doing?: string | null } = {},
): AttentionMark {
  return {
    panelId,
    projectId,
    panelTitle: opts.title ?? `Panel ${panelId}`,
    projectName: opts.projectName ?? projectId,
    tabTitle: opts.tabTitle ?? '',
    doing: opts.doing ?? null,
    producer: 'terminal',
    kind: opts.kind ?? 'attention',
    reason: { signal: opts.signal ?? 'bell', detail: opts.detail ?? null },
    raisedAt: opts.raisedAt ?? 1,
    dwellStartedAt: null,
  };
}
