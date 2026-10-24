/**
 * Who owns a node, by name (055 FR-032, FR-063b): the project, tab and panel (or the component) it
 * belongs to, outermost first. The detail pane shows it and the kill confirmation names it.
 */
import type { ComponentId, ResourceNode } from '@throng/core';
import { descendants } from './monitor-model.js';

const COMPONENT_LABEL: Readonly<Record<ComponentId, string>> = {
  ui: 'UI',
  daemon: 'Daemon',
  helpers: 'Helpers',
  projects: 'Projects',
};

export function ownerNames(node: ResourceNode, tree: ResourceNode): string[] {
  const byId = new Map(descendants(tree).map((n) => [n.id, n]));
  const o = node.owner;
  if (o.projectId === undefined && o.tabId === undefined && o.panelId === undefined) {
    return [COMPONENT_LABEL[o.component]];
  }
  return [
    o.projectId === undefined ? undefined : byId.get(`p:${o.projectId}`)?.label,
    o.tabId === undefined ? undefined : byId.get(`t:${o.tabId}`)?.label,
    o.panelId === undefined ? undefined : byId.get(`n:${o.panelId}`)?.label,
  ].filter((name): name is string => name !== undefined);
}
