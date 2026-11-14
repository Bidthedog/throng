import { type NoticeSubject } from './subject.js';

/**
 * 068 US3 (FR-061, FR-063) — WHERE A NOTICE BELONGS, as data.
 *
 * `NoticeOrigin` is what a raiser says a notice relates to, by id: a panel (and so a link to it, FR-063) or only a
 * project. `NoticePlace` is the NAMES the UI showed for them when the notice was raised — project, tab, panel — kept
 * with the notice so a toast, its Notifications panel entry and its copied text all read `Project › Tab › Panel`.
 *
 * The names are a snapshot. A panel renamed afterwards leaves the entry as it was raised, which is what the notice
 * said at the time and what a restored entry must keep across a restart. They are never written to the diagnostic
 * log (FR-034b): a project, tab and panel name is exactly what an anonymised record must not carry.
 */
export interface NoticeOrigin {
  /** The panel the notice relates to. Its presence makes the toast and the entry a link to that panel. */
  panelId?: string;
  /** The project it relates to; with no `panelId`, the notice names the project only. */
  projectId?: string;
}

export interface NoticePlace {
  project?: string;
  tab?: string;
  panel?: string;
}

/** What joins the parts: the breadcrumb form the docs use (FR-061). */
export const PLACE_SEPARATOR = ' › ';

/**
 * The place a subject already names, read off it. A raiser that knows a panel's project, tab and name — they all do,
 * through `usePanelPlace` — states them once, as its subject, and the notice's place follows from that rather than
 * from a second spelling of the same three names. A subject that is no place (a file, a pane, a panel type) names none.
 */
export function placeOfSubject(subject: NoticeSubject | undefined): NoticePlace | undefined {
  if (!subject) return undefined;
  const place: NoticePlace = {};
  switch (subject.kind) {
    case 'project':
      place.project = subject.name;
      break;
    case 'tab':
      place.project = subject.project;
      place.tab = subject.name;
      break;
    case 'panel':
      place.project = subject.project;
      place.tab = subject.tab;
      place.panel = subject.name;
      break;
    case 'terminal':
      place.project = subject.project;
      place.tab = subject.tab;
      place.panel = subject.panel;
      break;
    default:
      return undefined;
  }
  return normalisePlace(place);
}

/**
 * The panel and project a panel or terminal subject carries by id (068 FR-061, FR-063). Every raiser that names a panel
 * does so through `panelSubject`/`terminalSubject`, which state the ids beside the names, so the notice is placed and
 * linked from the one thing it already says. `formatSubject` ignores the ids: they are never rendered, and never logged.
 */
export function originOfSubject(subject: NoticeSubject | undefined): NoticeOrigin | undefined {
  if (!subject || (subject.kind !== 'panel' && subject.kind !== 'terminal')) return undefined;
  const panelId = subject.panelId || undefined;
  const projectId = subject.projectId || undefined;
  if (panelId === undefined && projectId === undefined) return undefined;
  return { ...(panelId !== undefined ? { panelId } : {}), ...(projectId !== undefined ? { projectId } : {}) };
}

/** Drop absent and blank names; `undefined` when none is left. */
export function normalisePlace(place: NoticePlace | undefined): NoticePlace | undefined {
  if (!place) return undefined;
  const out: NoticePlace = {};
  for (const key of ['project', 'tab', 'panel'] as const) {
    const value = place[key]?.trim();
    if (value) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

/**
 * `Project › Tab › Panel`, or whatever of it the notice has: a project alone is just the project. Each name is bounded
 * as a subject's names are, so a long folder name cannot break the notice's height.
 */
export function formatPlace(place: NoticePlace | undefined): string {
  const normal = normalisePlace(place);
  if (!normal) return '';
  return [normal.project, normal.tab, normal.panel]
    .filter((p): p is string => p !== undefined)
    .join(PLACE_SEPARATOR);
}
