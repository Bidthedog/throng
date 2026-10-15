/**
 * The Held folders section (055 FR-070 – FR-072, US4): every folder throng currently holds, the project
 * it serves, and each terminal that keeps it held — by tab and panel name. A terminal links to its panel
 * in the Projects breakdown, where the user can act on it (FR-071).
 *
 * What is held, and the moment a folder stops being, is the collector's: this draws the latest frame, so
 * a folder leaves at the first sample after its last terminal ends (FR-072) because the next frame no
 * longer lists it.
 */
import { type ReactElement } from 'react';
import type { ResourceNode } from '@throng/core';
import { focusOn, setSelection, useSession } from './monitor-session.js';

/** The ids from the root down to `id`, or `null` when the hierarchy does not hold it. */
function pathTo(node: ResourceNode, id: string, trail: readonly string[] = []): string[] | null {
  const here = [...trail, node.id];
  if (node.id === id) return here;
  for (const c of node.children) {
    const hit = pathTo(c, id, here);
    if (hit) return hit;
  }
  return null;
}

function labelOf(node: ResourceNode, id: string): string | undefined {
  if (node.id === id) return node.label;
  for (const c of node.children) {
    const hit = labelOf(c, id);
    if (hit !== undefined) return hit;
  }
  return undefined;
}

export function HeldFolders(): ReactElement {
  const { frame, tree } = useSession();
  const held = frame?.held ?? [];
  return (
    <section className="held-folders" data-testid="held-folders" aria-label="Held folders">
      <h3 className="breakdown__heading">Held folders</h3>
      {held.length === 0 ? (
        <p className="held-folders__empty">{frame === null ? '' : 'No folders are held'}</p>
      ) : (
        <ul className="held-folders__list">
          {held.map((folder) => (
            <li key={folder.path} className="held-folder" data-testid="held-folder">
              <div className="held-folder__path">{folder.path}</div>
              <div className="held-folder__project">{(tree && labelOf(tree, `p:${folder.projectId}`)) ?? folder.projectId}</div>
              <ul className="held-folder__terminals">
                {folder.panels.map((panel) => {
                  const path = tree ? pathTo(tree, `n:${panel.panelId}`) : null;
                  const name = `${panel.tabName} › ${panel.panelName}`;
                  return (
                    <li key={panel.panelId}>
                      <button
                        type="button"
                        className="held-folder__terminal"
                        data-testid={`held-folder-terminal-${panel.panelId}`}
                        title={path ? `Show ${name} in the breakdown` : `${name} is not in the breakdown`}
                        disabled={path === null}
                        onClick={() => {
                          if (path === null) return;
                          focusOn(path);
                          setSelection(`n:${panel.panelId}`);
                        }}
                      >
                        {name}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
