import type { SubWorkspace, Tab } from '@throng/core';

/**
 * A sub-workspace's `content_json` holds its Tabs plus the active Tab. Originally
 * it was a bare `Tab[]`; it is now `{ tabs, activeTabId }`. Both shapes are read so
 * pre-existing rows keep working (003).
 */
export interface SubWorkspaceContent {
  tabs: Tab[];
  activeTabId?: string;
}

export function parseSubWorkspaceContent(json: string): SubWorkspaceContent {
  const value = JSON.parse(json) as unknown;
  if (Array.isArray(value)) return { tabs: value as Tab[] }; // legacy bare Tab[]
  const obj = value as { tabs?: Tab[]; activeTabId?: string };
  return { tabs: obj.tabs ?? [], activeTabId: obj.activeTabId };
}

export function serializeSubWorkspaceContent(sub: SubWorkspace): string {
  return JSON.stringify({ tabs: sub.tabs, activeTabId: sub.activeTabId });
}
