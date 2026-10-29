import type { ProcessKey, ResourceNode } from './types.js';

/** The standard throng action at each level (FR-063), plus the monitor's two kills. */
export type ResourceActionId =
  | 'unloadProject'
  | 'unloadProjectOther'
  | 'destroyTab'
  | 'destroyPanel'
  | 'killProcess'
  | 'killBelow';

export interface ResourceAction {
  readonly id: ResourceActionId;
  readonly enabled: boolean;
  /** Why it is disabled; present only when `enabled` is false. */
  readonly reason?: string;
}

export interface ActionContext {
  /** A process that ended while the modal is open (FR-065): it stays, greyed, with no actions. */
  readonly isEnded: (node: ResourceNode) => boolean;
  /** Whether a tab or panel is open in some window, so its Destroy can run (research R12). */
  readonly isMounted: (node: ResourceNode) => boolean;
}

/**
 * Only the ACTIVE project's tabs and panels are open in a window (the main window reports one layout);
 * a project that is merely loaded has none, so loading is not what is missing — switching to it is.
 */
const NOT_MOUNTED = 'Not open in any window: switch to its project to destroy it';

const on = (id: ResourceActionId): ResourceAction => ({ id, enabled: true });
const destroy = (id: ResourceActionId, node: ResourceNode, ctx: ActionContext): ResourceAction =>
  ctx.isMounted(node) ? on(id) : { id, enabled: false, reason: NOT_MOUNTED };

function hasLiveProcessBelow(node: ResourceNode, ctx: ActionContext): boolean {
  return node.children.some(
    (c) => (c.kind === 'process' && !ctx.isEnded(c)) || hasLiveProcessBelow(c, ctx),
  );
}

/**
 * The actions a node offers, in menu order (data-model *Actions*). Only Projects nodes have any
 * (FR-062); Kill All Below appears only when something live is below (FR-063a); an ended node has none.
 */
export function actionsFor(node: ResourceNode, ctx: ActionContext): ResourceAction[] {
  if (node.owner.component !== 'projects' || ctx.isEnded(node)) return [];
  const out: ResourceAction[] = [];
  switch (node.kind) {
    case 'project':
      // `p:` with nothing after it is the "No project" group of rootless terminals: no project to unload.
      if (node.projectState !== 'unloaded' && node.id !== 'p:') out.push(on('unloadProject'), on('unloadProjectOther'));
      break;
    case 'tab':
      out.push(destroy('destroyTab', node, ctx));
      break;
    case 'panel':
      out.push(destroy('destroyPanel', node, ctx));
      if (node.panelKind !== 'terminal') return out;
      break;
    case 'process':
      out.push(on('killProcess'));
      break;
    default:
      return [];
  }
  if (hasLiveProcessBelow(node, ctx)) out.push(on('killBelow'));
  return out;
}

/**
 * The live processes Kill All Below ends, leaves first and a process node itself last (FR-063a,
 * research R8). A project, tab or panel is a UI element: only the processes inside it are listed.
 */
export function killOrder(node: ResourceNode, ctx: Pick<ActionContext, 'isEnded'>): ProcessKey[] {
  if (node.owner.component !== 'projects') return [];
  const out: ProcessKey[] = [];
  const visit = (n: ResourceNode): void => {
    for (const c of n.children) visit(c);
    if (n.kind === 'process' && n.process !== undefined && !ctx.isEnded(n)) out.push(n.process.key);
  };
  visit(node);
  return out;
}
