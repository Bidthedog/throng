/**
 * The path from throng to the node in focus (055 FR-060); any segment returns to that level.
 */
import type { ReactElement } from 'react';
import type { ResourceNode } from '@throng/core';
import { nodeAt } from './monitor-model.js';

export interface BreadcrumbProps {
  readonly tree: ResourceNode;
  readonly path: readonly string[];
  readonly onGo: (path: readonly string[]) => void;
}

export function Breadcrumb({ tree, path, onGo }: BreadcrumbProps): ReactElement {
  return (
    <nav className="breadcrumb" aria-label="Location in the hierarchy" data-testid="breadcrumb">
      <ol className="breadcrumb__list">
        {path.map((id, index) => {
          const upTo = path.slice(0, index + 1);
          const label = nodeAt(tree, upTo)?.label ?? id;
          const here = index === path.length - 1;
          return (
            <li key={id} className="breadcrumb__item">
              <button
                type="button"
                className="breadcrumb__segment"
                data-testid={`breadcrumb-segment-${id}`}
                aria-current={here ? 'location' : undefined}
                // A Tab stop in the header (FR-112) — except the level already shown, which goes nowhere.
                tabIndex={here ? -1 : undefined}
                onClick={() => onGo(upTo)}
              >
                {label}
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
