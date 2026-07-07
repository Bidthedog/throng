/**
 * Save-path confinement (006 Phase A/E, FR-021/022/036). Pure. Inputs are
 * RESOLVED REAL paths (the UI-main caller runs realpath first, as in 004). A
 * project-owned editor may save only within its owning project's tree; a
 * sub-workspace-owned editor may save only OUTSIDE every loaded project. Reuses
 * the 004 `isWithinRoot` normalise (case + separators). No OS calls.
 */
import { isWithinRoot } from '../explorer/path-rules.js';
import type { EditorDocument } from './document.js';

/** True when `absPath` is the tree `root` itself or lives inside it. */
export function isWithinTree(absPath: string, root: string): boolean {
  return isWithinRoot(root, absPath);
}

/** True when `absPath` lies outside every one of `allProjectRoots`. */
export function isOutsideAllProjects(absPath: string, allProjectRoots: readonly string[]): boolean {
  return allProjectRoots.every((root) => !isWithinRoot(root, absPath));
}

export type SaveConfinementKind = 'in-owner-tree' | 'outside-all-projects';

export interface SaveConfinement {
  /** Whether a candidate save target is permitted for this document. */
  allowed: (candidate: string) => boolean;
  kind: SaveConfinementKind;
}

/**
 * Resolve where a document is allowed to save:
 * - **project-owned** → within the owning project's tree (`ownerRoot`);
 * - **sub-workspace-owned** → outside every loaded project.
 */
export function resolveSaveConfinement(
  doc: Pick<EditorDocument, 'ownerKind'>,
  roots: { ownerRoot: string | null; allProjectRoots: readonly string[] },
): SaveConfinement {
  if (doc.ownerKind === 'project' && roots.ownerRoot !== null) {
    const ownerRoot = roots.ownerRoot;
    return { kind: 'in-owner-tree', allowed: (candidate) => isWithinTree(candidate, ownerRoot) };
  }
  return {
    kind: 'outside-all-projects',
    allowed: (candidate) => isOutsideAllProjects(candidate, roots.allProjectRoots),
  };
}
