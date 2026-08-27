/**
 * 030 US3 (#235), widened by 041 — the CASUALTIES one cause defeated, as a list a notice can render.
 *
 * ══ TWO KINDS OF ROW SINCE 041 (#327/#328) ══
 *
 * A casualty used to BE a panel. 041 FR-013 stopped creating a panel for a refused open, so a row may
 * now speak for a panel (`AffectedPanel`) or for a subject with no panel at all (`AffectedSubject`).
 * `groupAffected` returns the first kind, grouped by tab; `ungroupedAffected` returns the second,
 * which has no tab to sit under. De-duplication is by `casualtyKey` — the panel where there is one,
 * else `(subject, reason)`.
 *
 * ══ THE PANEL-NAMED SYMBOLS ARE KEPT ON PURPOSE ══
 *
 * `mergeAffected`, `joinedPanels` and `affectedDetails` now handle casualties that may not be panels,
 * and their names still say "panel". That is a decision, not drift: renaming them touches every
 * caller and every existing test, and 041's widening is held to the rule that NO pre-existing test is
 * edited — because those tests are the proof that 030's behaviour survived it. A rename is a
 * mechanical follow-up available at any time; smuggling one inside a behavioural change is how a
 * "nothing observable changed" phase stops being provable.
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
import { casualtyKey } from './casualty.js';
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
   * 041 FR-007e — OPTIONAL here, REQUIRED on {@link AffectedSubject}, and that asymmetry is the point.
   *
   * A panel-less casualty needs these two to have any identity at all, so the obvious move is to
   * require them everywhere. It cannot be done: six call sites construct panelled rows without them,
   * and four of those are the tests whose job is to prove 030's behaviour survived this widening. A
   * widening that has to edit those tests can no longer prove anything about them.
   */
  subject?: string;
  reason?: string;
  /** 041 FR-018 — unused by a panelled row, which renders its panel name. See {@link AffectedSubject}. */
  displayPath?: string;
  /**
   * This panel's OWN raw error, where the cause differs per panel.
   *
   * Copied and logged, never rendered (FR-034/FR-048a). The notice states the shared cause; this is
   * the part that would otherwise reach the user nowhere at all.
   */
  detail?: string;
}

/**
 * 041 FR-013 — a casualty with NO panel, because none was created.
 *
 * A refused open is the case: throng declines to open the file, so there is nothing on screen to
 * name and the row must be identified by what was attempted rather than by where it failed.
 *
 * `panelId?: undefined` is what makes this a discriminated union rather than two overlapping shapes.
 * It lets `casualtyKey`'s `??` narrow, and it stops a caller supplying a panel id here and silently
 * getting the panelled identity with none of the panelled fields.
 */
export interface AffectedSubject {
  panelId?: undefined;
  /** What the open was attempted on — half the identity (FR-007). */
  subject: string;
  /** Why it was refused — the other half. */
  reason: string;
  /**
   * What this row RENDERS: the path relative to the project root (FR-018).
   *
   * Relative because the notice already names the project (030 FR-031), so the root is context. The
   * ABSOLUTE path stays in {@link detail}, for Copy and the log (FR-018c) — narrowing what is shown,
   * never what is recoverable.
   */
  displayPath?: string;
  /** The absolute path and the raw error. Copy and the log only, never rendered. */
  detail?: string;
}

/**
 * One row of a notice's list: a panel that was defeated, or a subject that was refused.
 *
 * The union is the enforcement. A panel-less row CANNOT omit its identity, and a panelled row is
 * unchanged from what it was before 041 — which is what lets every existing caller and every existing
 * test stand untouched (FR-007e).
 */
export type AffectedCasualty = AffectedPanel | AffectedSubject;

/** One rendered row. `label` is already through the formatter; nothing downstream re-derives it. */
export interface AffectedRow {
  /** 041 — optional: a row for a refused open speaks for no panel. */
  panelId?: string;
  label: string;
  /** 041 FR-018 — the project-relative path a panel-less row renders in place of a panel name. */
  displayPath?: string;
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
  existing: readonly AffectedCasualty[],
  incoming: readonly AffectedCasualty[],
): readonly AffectedCasualty[] {
  const joined = joinedPanels(existing, incoming);
  return joined.length === 0 ? existing : [...existing, ...joined];
}

/**
 * The casualties an incoming list would ADD — what FR-006a's growth record names.
 *
 * Keyed on the CASUALTY (041 FR-007b), not on the panel. Keying on `panelId` alone gives every
 * panel-less row the same key — `undefined` — so the first refused open in a notice would absorb
 * every later one, which is #328 arriving from the opposite direction.
 *
 * Still named `joinedPanels`, and it now reports casualties that may not be panels. Kept on purpose:
 * renaming it touches every caller and every existing test, which would break the one rule this
 * widening is held to — that no pre-existing test is edited, because those tests ARE the proof that
 * 030's behaviour survived. A rename is a mechanical follow-up available at any time.
 */
export function joinedPanels(
  existing: readonly AffectedCasualty[],
  incoming: readonly AffectedCasualty[],
): readonly AffectedCasualty[] {
  const known = new Set(existing.map((c) => casualtyKey(c)));
  const joined: AffectedCasualty[] = [];
  for (const casualty of incoming) {
    const key = casualtyKey(casualty);
    if (known.has(key)) continue;
    known.add(key);
    joined.push(casualty);
  }
  return joined;
}

/** One entry per casualty, first report winning — the shape every consumer below starts from. */
function distinct(affected: readonly AffectedCasualty[]): AffectedCasualty[] {
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
  affected: readonly AffectedCasualty[],
  context: AffectedContext = {},
): readonly AffectedTabGroup[] {
  // 041 — PANELLED rows only, and the signature is deliberately unchanged. Panel-less casualties come
  // back from `ungroupedAffected` instead of widening this return, because this function has four
  // consumers and five destructuring sites in its own suite: changing its shape would force an edit
  // to the very tests that prove 030's behaviour survived. It is also the truer decomposition —
  // grouping rows by tab and listing rows that HAVE no tab are two operations, not one wider result.
  const unique = distinct(affected).filter((c): c is AffectedPanel => c.panelId !== undefined);

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

/**
 * 041 FR-007c/FR-007d — the rows that have NO panel, as one ungrouped section.
 *
 * A sibling of `groupAffected` rather than a second field on its return, for the reason given there.
 * Two decisions, both the pure kind this module exists to keep pure:
 *
 *   • ORDER — by `casualtyKey`, never by arrival. The failures race, so input order carries no
 *     information and a notice that grew would look shuffled between renders. Exactly 030 FR-031a's
 *     reasoning, applied to rows that have no tab to be ordered within.
 *   • NAMING — through `formatSubject`, the same call a panelled row makes. That is what applies the
 *     48-character bound, so one long path cannot break FR-032's height bound. A row rendering the
 *     raw string would bypass truncation, which `subject.ts` says must have exactly one home.
 *
 * The row's `detail` — the ABSOLUTE path and the raw error — rides along untouched and unrendered
 * (FR-018c), for Copy and the diagnostics log.
 */
export function ungroupedAffected(
  affected: readonly AffectedCasualty[],
  context: AffectedContext = {},
): readonly AffectedRow[] {
  return distinct(affected)
    .filter((c): c is AffectedSubject => c.panelId === undefined)
    .sort((a, b) => casualtyKey(a).localeCompare(casualtyKey(b)))
    .map((casualty) => ({
      // The project is CONTEXT, not part of the name — the heading already states it (030 FR-031),
      // exactly as a panelled row leans on the heading rather than repeating it.
      label: formatSubject({ kind: 'file', name: casualty.displayPath ?? casualty.subject }, context),
      ...(casualty.displayPath ? { displayPath: casualty.displayPath } : {}),
      ...(casualty.detail ? { detail: casualty.detail } : {}),
    }));
}

/**
 * The per-casualty raw errors, as the log record wants them (FR-048a).
 *
 * ══ IT MUST PROJECT BOTH KINDS OF ROW (041 FR-005a) ══
 *
 * This flat-mapped `groupAffected` alone, which was complete while every row had a panel. After 041 a
 * refused open has none — so leaving it would mean a panel-less casualty's absolute path never
 * reached the diagnostics log at all.
 *
 * That is the quietest way this feature could lose data, and it is worth naming precisely: FR-005a
 * says suppression narrows what is SHOWN and never what is LOGGED, and `detail` is never rendered by
 * construction — so the value that went missing would be one nobody could watch disappear.
 */
export function affectedDetails(
  affected: readonly AffectedCasualty[],
  context: AffectedContext = {},
): readonly { panel: string; detail: string }[] {
  const grouped = groupAffected(affected, context).flatMap((group) =>
    group.rows
      .filter((row) => row.detail)
      // Named `Tab — Panel` here and not merely `Panel`: a log line has no group heading above it to
      // lean on, which is the same reason `noticeLogRecord` formats its subject with no context.
      .map((row) => ({
        panel: [group.label, row.label].filter(Boolean).join(' — '),
        detail: row.detail!,
      })),
  );
  // A panel-less row has no tab heading to qualify it, so its own label stands alone.
  const ungrouped = ungroupedAffected(affected, context)
    .filter((row) => row.detail)
    .map((row) => ({ panel: row.label, detail: row.detail! }));
  return [...grouped, ...ungrouped];
}
