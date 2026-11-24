import { useMemo, type ReactElement } from 'react';
import { formatGrouped } from '@throng/core';
import { useProjectsOptional } from '../state/projects-store.js';
import { ProjectsTotalMark } from '../attention/holder-marks.js';

/**
 * #715 — the Projects pane's own total: every project, in every category, minimised or not. The shared
 * `.throng-count-pill` (057 FR-129's), with `.panel__count` holding its width as the number changes
 * (as FR-133). A quantity the user reads, so digit-grouped (constitution 5.4.0).
 *
 * On the expanded pane's header only: the maintainer found the count not useful on the collapsed rail
 * (2026-11-24).
 */
export function ProjectsCountPill(): ReactElement {
  const count = useProjectsOptional()?.projects.length ?? 0;
  return (
    <span className="throng-count-pill panel__count" data-testid="projects-count">
      {formatGrouped(count)}
    </span>
  );
}

/**
 * The collapsed Projects pane's rail (#715): the attention total over every project — only here, because
 * the rows that show their own marks are hidden — a minimised category header's mark standing for the
 * whole list. No project count. Projects are passed in category order, so its popover lists them as the
 * pane does.
 */
export function ProjectsRailSummary(): ReactElement {
  const store = useProjectsOptional();
  const projects = store?.projects;
  const categories = store?.categories;
  const projectIds = useMemo(() => {
    const order = new Map((categories ?? []).map((c, i) => [c.id, i]));
    const rank = (categoryId: string): number => order.get(categoryId) ?? Number.MAX_SAFE_INTEGER;
    return [...(projects ?? [])].sort((a, b) => rank(a.categoryId) - rank(b.categoryId)).map((p) => p.id);
  }, [projects, categories]);
  return (
    <span className="pane-rail__summary">
      <ProjectsTotalMark projectIds={projectIds} />
    </span>
  );
}
