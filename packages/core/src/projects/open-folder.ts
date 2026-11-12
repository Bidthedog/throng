import { isUnderPath } from '../fs/path-id.js';

export type OpenFolderDecision =
  | { readonly kind: 'add' }
  | { readonly kind: 'select'; readonly projectId: string }
  | { readonly kind: 'refuse-contains'; readonly projectName: string }
  | { readonly kind: 'refuse-invalid'; readonly reason: 'file' | 'missing' };

export type OpenFolderPathKind = 'folder' | 'file' | 'missing';

/** What opening `absPath` from outside throng does, given the project list (067 FR-026, FR-027; Principle I). */
export function decideOpenFolder(
  absPath: string,
  kind: OpenFolderPathKind,
  projects: readonly { readonly id: string; readonly name: string; readonly rootFolder: string }[],
): OpenFolderDecision {
  if (kind !== 'folder') return { kind: 'refuse-invalid', reason: kind };
  const owner = projects.find((p) => isUnderPath(absPath, p.rootFolder));
  if (owner) return { kind: 'select', projectId: owner.id };
  const inside = projects.find((p) => isUnderPath(p.rootFolder, absPath));
  if (inside) return { kind: 'refuse-contains', projectName: inside.name };
  return { kind: 'add' };
}
