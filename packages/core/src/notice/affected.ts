/**
 * 030 US3 (#235) — the PANELS one cause defeated, as a list a notice can render.
 *
 * ══ THE DEFECT ══
 *
 * Rename a project's root folder with editors and terminals open and every casualty reports
 * separately: a storm of near-identical toasts, none of which says how many others there are, and
 * the editor half arriving as a per-tab "Cannot open 3 files" dialog that batched by whichever tab
 * the user happened to visit. One absent folder, told a dozen ways.
 *
 * `grouping.ts` decides WHICH failures are one notice. This module decides what that one notice
 * SAYS about them, and all three of its decisions are pure:
 *
 *   • ORDER — tabs in the workspace's tab order, panels in their order within the tab (FR-031a).
 *     The failures race, so input order carries no information; a list that inherited it would read
 *     differently on every run and a growing notice would look shuffled.
 *   • IDENTITY — a panel appears once, however many times its failure is reported (FR-037a). The
 *     notice GROWS as tabs are visited, and a tab re-visited must not double its rows.
 *   • NAMING — every rendered name goes through `formatSubject` (FR-031b), never the raw string.
 *     That is what applies the 48-character bound. A row rendering `panelName` straight to the DOM
 *     would bypass truncation and let one long name break FR-032's height bound — which is the
 *     whole reason `subject.ts` says truncation happens in one place and nowhere else.
 *
 * Pure, and therefore proven at the unit layer rather than through a browser: by the time the list
 * reaches the renderer there is nothing left to decide about it but which elements to emit.
 */
import { formatSubject } from './subject.js';

/**
 * One panel a consolidated notice speaks for.
 *
 * Names AND ordering, together: the raise site is the only place that knows both, because it is the
 * only place holding the workspace layout. A notice handed nothing but names would have to ask the
 * layout again at render time, from a component that may be rendering after the panel is gone.
 */
export interface AffectedPanel {
  /** Identity, for de-duplication on growth (FR-037a). Never rendered. */
  panelId: string;
  panelName: string;
  /** A panel always sits in a tab. */
  tabId: string;
  tabName: string;
  /** The workspace's own tab order (FR-031a) — the index of the tab in `layout.tabs`. */
  tabOrder: number;
  /** Position within the tab, in layout order (FR-031a). */
  panelOrder: number;
  /**
   * This panel's OWN raw error, where the cause differs per panel.
   *
   * Copied and logged, never rendered (FR-034/FR-048a). The notice states the shared cause; this is
   * the part that would otherwise reach the user nowhere at all.
   */
  detail?: string;
}

/** One rendered row. `label` is already through the formatter; nothing downstream re-derives it. */
export interface AffectedRow {
  panelId: string;
  label: string;
  detail?: string;
}

/** One tab's worth of rows, under the tab's own rendered name. */
export interface AffectedTabGroup {
  tabId: string;
  label: string;
  rows: readonly AffectedRow[];
}

/** What the surrounding notice already states, so the list never repeats it (FR-031/FR-031b). */
export interface AffectedContext {
  /** The project, named ONCE in the heading and never on a row. */
  project?: string;
}

/**
 * Merge newly reported panels into a list, de-duplicated by `panelId`.
 *
 * Returns the ORIGINAL array when nothing joined, and that identity is load-bearing rather than an
 * optimisation: FR-006a asks a growing notice to write a further log record and FR-037 asks a repeat
 * to write none, so the caller has to be able to tell the two apart. An equality check on lengths
 * would work today and stop working the moment a merge is allowed to update an existing row.
 *
 * The FIRST report of a panel wins. A second report of the same panel is the same failure seen
 * again — re-reporting it would either duplicate the row or silently rewrite a detail the user may
 * already have copied.
 */
export function mergeAffected(
  existing: readonly AffectedPanel[],
  incoming: readonly AffectedPanel[],
): readonly AffectedPanel[] {
  const joined = joinedPanels(existing, incoming);
  return joined.length === 0 ? existing : [...existing, ...joined];
}

/** The panels an incoming list would ADD — what FR-006a's growth record names. */
export function joinedPanels(
  existing: readonly AffectedPanel[],
  incoming: readonly AffectedPanel[],
): readonly AffectedPanel[] {
  const known = new Set(existing.map((p) => p.panelId));
  const joined: AffectedPanel[] = [];
  for (const panel of incoming) {
    if (known.has(panel.panelId)) continue;
    known.add(panel.panelId);
    joined.push(panel);
  }
  return joined;
}

/** One entry per `panelId`, first report winning — the shape every consumer below starts from. */
function distinct(affected: readonly AffectedPanel[]): AffectedPanel[] {
  return [...joinedPanels([], affected)];
}

/**
 * Group the list for rendering: tabs in `tabOrder`, rows in `panelOrder`, every name formatted.
 *
 * Ties break on the ids rather than on input order, so a list assembled by racing failures renders
 * identically every time — which is what makes an E2E assertion about the list's order meaningful
 * rather than lucky.
 */
export function groupAffected(
  affected: readonly AffectedPanel[],
  context: AffectedContext = {},
): readonly AffectedTabGroup[] {
  const unique = distinct(affected);

  const byTab = new Map<string, { order: number; name: string; panels: AffectedPanel[] }>();
  for (const panel of unique) {
    const group = byTab.get(panel.tabId);
    if (group) group.panels.push(panel);
    else byTab.set(panel.tabId, { order: panel.tabOrder, name: panel.tabName, panels: [panel] });
  }

  return [...byTab.entries()]
    .sort(([aId, a], [bId, b]) => a.order - b.order || aId.localeCompare(bId))
    .map(([tabId, group]) => ({
      tabId,
      // The tab through the same formatter as everything else — a `tab` subject with the project
      // elided by the context the heading already states.
      label: formatSubject({ kind: 'tab', name: group.name, project: context.project }, context),
      rows: group.panels
        .sort((a, b) => a.panelOrder - b.panelOrder || a.panelId.localeCompare(b.panelId))
        .map((panel) => ({
          panelId: panel.panelId,
          /*
           * FR-031b — a row is a PANEL subject, elided down to its own name.
           *
           * It carries both qualifiers because a panel is `Project — Tab — Panel` everywhere else in
           * the application, and what keeps them off the row is the CONTEXT — the heading names the
           * project, the group heading names the tab — rather than a second, row-shaped formatting
           * rule that would drift from the first.
           */
          label: formatSubject(
            { kind: 'panel', name: panel.panelName, tab: group.name, project: context.project },
            { ...context, tab: group.name },
          ),
          ...(panel.detail ? { detail: panel.detail } : {}),
        })),
    }));
}

/** The per-panel raw errors, as the log record wants them (FR-048a). */
export function affectedDetails(
  affected: readonly AffectedPanel[],
  context: AffectedContext = {},
): readonly { panel: string; detail: string }[] {
  return groupAffected(affected, context).flatMap((group) =>
    group.rows
      .filter((row) => row.detail)
      // Named `Tab — Panel` here and not merely `Panel`: a log line has no group heading above it to
      // lean on, which is the same reason `noticeLogRecord` formats its subject with no context.
      .map((row) => ({
        panel: [group.label, row.label].filter(Boolean).join(' — '),
        detail: row.detail!,
      })),
  );
}
