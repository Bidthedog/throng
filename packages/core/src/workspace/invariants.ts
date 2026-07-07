import { isPanel, isSplit, type LayoutNode, type Panel, type WorkspaceLayout } from './model.js';

/**
 * Workspace invariants (data-model §2), unit-tested (Principle V). These are the
 * structural rules every layout the operations produce must satisfy:
 *   INV-1 every Tab has ≥ 1 Panel; INV-2 ≥ 1 Tab; INV-3 splits never have one
 *   child (collapsed away); INV-4 the main layout holds only its project's
 *   Panels; INV-7 activeTabId resolves and split sizes align with children.
 */

const SIZE_EPSILON = 0.01;

/** Total number of Panels in a layout node (recursive). */
export function countPanels(node: LayoutNode): number {
  return isPanel(node) ? 1 : node.children.reduce((n, child) => n + countPanels(child), 0);
}

/** All Panels in a node, left-to-right (recursive). */
export function collectPanels(node: LayoutNode): Panel[] {
  return isPanel(node) ? [node] : node.children.flatMap(collectPanels);
}

function validateNode(node: LayoutNode, violations: string[]): void {
  if (!isSplit(node)) return;
  if (node.children.length < 2) {
    violations.push('INV-3: a SplitNode must have at least two children');
  }
  if (node.sizes.length !== node.children.length) {
    violations.push('INV-7: split sizes length must match children length');
  } else {
    const sum = node.sizes.reduce((a, b) => a + b, 0);
    if (Math.abs(sum - 1) > SIZE_EPSILON) {
      violations.push(`INV-7: split sizes must sum to ~1 (got ${sum})`);
    }
  }
  for (const child of node.children) validateNode(child, violations);
}

/**
 * Validate a **main** workspace layout (the active project's Workspace Pane).
 * Returns a list of human-readable violations (empty when valid). Includes
 * INV-4: no cross-project Panels in the main layout.
 */
export function validateMainLayout(layout: WorkspaceLayout): string[] {
  const violations: string[] = [];
  if (layout.tabs.length < 1) {
    violations.push('INV-2: a workspace must contain at least one Tab');
  }
  for (const tab of layout.tabs) {
    if (countPanels(tab.root) < 1) {
      violations.push(`INV-1: tab ${tab.id} must contain at least one Panel`);
    }
    validateNode(tab.root, violations);
    for (const panel of collectPanels(tab.root)) {
      if (panel.originProjectId !== layout.projectId) {
        violations.push(
          `INV-4: panel ${panel.id} (project ${panel.originProjectId}) may not appear in the main layout of project ${layout.projectId}`,
        );
      }
    }
  }
  if (layout.tabs.length > 0 && !layout.tabs.some((t) => t.id === layout.activeTabId)) {
    violations.push('INV-7: activeTabId must reference an existing Tab');
  }
  return violations;
}

export function isMainLayoutValid(layout: WorkspaceLayout): boolean {
  return validateMainLayout(layout).length === 0;
}
