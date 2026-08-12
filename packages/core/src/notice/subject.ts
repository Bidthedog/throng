/**
 * 030 (#195) — what a notice is ABOUT.
 *
 * The bug is a notice that says "this item could not be renamed" while four projects are open. The
 * fix is not better wording at each call site, because a call site can always be written badly
 * again. It is that the subject is a REQUIRED, STRUCTURED field with exactly ONE formatter:
 *
 *   • structured, so a call site cannot invent its own spelling of `Project — Tab — Panel`;
 *   • required, so omission is not expressible (FR-019) — `{ kind: 'none' }` is a deliberate,
 *     visible statement that the subject is genuinely unavailable, not an oversight;
 *   • one formatter, so truncation and context elision happen HERE and nowhere else (FR-021).
 *
 * That last point is load-bearing rather than tidy: the consolidated notice bounds its height, and
 * a row that rendered a panel name straight to the DOM would bypass truncation and let one long
 * name break the bound.
 */

/**
 * The concrete thing a notice is about.
 *
 * The kinds are the workspace's OWN vocabulary (FR-024) — Pane, Tab, Panel, Panel Type, Project,
 * Sub-workspace — so a notice never invents a word for something the UI already names.
 *
 * There is deliberately no `panelTitle` member. "Panel Title" is prose vocabulary: the word a
 * message uses when it talks *about* a panel's title ("that Panel Title is already taken"). The
 * thing such a notice is about is the Panel, whose `name` IS its title. A separate kind would give
 * two ways to say one thing, and the two would be formatted differently within a release.
 */
export type NoticeSubject =
  | { kind: 'none' }
  | { kind: 'file'; name: string; dir?: string }
  | { kind: 'folder'; name: string; dir?: string }
  | { kind: 'project'; name: string }
  | { kind: 'pane'; name: string }
  | { kind: 'tab'; name: string; project?: string }
  | { kind: 'panel'; name: string; tab?: string; project?: string }
  | { kind: 'panelType'; name: string }
  | { kind: 'terminal'; flavour: string; panel?: string; tab?: string; project?: string }
  | { kind: 'subWorkspace'; name: string };

/**
 * The kinds as data, so a test can prove the set is closed and a consumer can iterate it.
 *
 * Typed from the union, so adding a member without adding it here — or the reverse — is a compile
 * error rather than a silent divergence.
 */
export const SUBJECT_KINDS: readonly NoticeSubject['kind'][] = [
  'none',
  'file',
  'folder',
  'project',
  'pane',
  'tab',
  'panel',
  'panelType',
  'terminal',
  'subWorkspace',
];

/**
 * What the surrounding UI already states (FR-022a).
 *
 * A part named here is OMITTED from the rendered subject — never re-spelled. In the consolidated
 * notice the context is `{ project, tab }`, because the heading names the project and the row sits
 * under its tab's heading; what is left is the panel name, which is the only part that row adds.
 *
 * Elision is by VALUE, not by presence: a context stating project "Alpha" does not silence a
 * subject in project "Bravo", because those are two different things and hiding the difference is
 * precisely the ambiguity #195 is about.
 */
export interface SubjectContext {
  project?: string;
  tab?: string;
  panel?: string;
  dir?: string;
}

/**
 * The bound on ONE name part (FR-021).
 *
 * Measured in characters rather than pixels so the rule is deterministic and unit-testable. 48
 * keeps a full `Project — Tab — Panel` under about 150 characters, which the toast fits without
 * wrapping past two lines at the 1920×1080 the E2E suite runs at.
 */
export const SUBJECT_NAME_MAX = 48;

/** What joins the parts. An em dash with spaces, matching `Project — Tab — Panel` (FR-022). */
export const SUBJECT_SEPARATOR = ' — ';

/**
 * Truncate one name part, the ellipsis REPLACING the final character so the result is exactly the
 * bound rather than one over it.
 *
 * Iterating code points rather than slicing UTF-16 units: cutting a string mid-surrogate produces a
 * lone surrogate, which renders as a broken glyph in the toast — a defect that would only ever show
 * up on someone's real folder name.
 */
function truncate(part: string): string {
  const chars = [...part];
  if (chars.length <= SUBJECT_NAME_MAX) return part;
  return `${chars.slice(0, SUBJECT_NAME_MAX - 1).join('')}…`;
}

/** The qualifier parts a subject carries, outermost first; the subject's own name is last. */
function partsOf(subject: NoticeSubject): (string | undefined)[] {
  switch (subject.kind) {
    case 'none':
      return [];
    case 'file':
    case 'folder':
      return [subject.dir, subject.name];
    case 'tab':
      return [subject.project, subject.name];
    case 'panel':
      return [subject.project, subject.tab, subject.name];
    case 'terminal':
      return [subject.project, subject.tab, subject.panel, subject.flavour];
    case 'project':
    case 'pane':
    case 'panelType':
    case 'subWorkspace':
      return [subject.name];
  }
}

/** The context value that would silence a part, in the same order `partsOf` returns them. */
function contextFor(subject: NoticeSubject, context: SubjectContext): (string | undefined)[] {
  switch (subject.kind) {
    case 'none':
      return [];
    case 'file':
    case 'folder':
      // The subject's own name is never elided — it IS the subject.
      return [context.dir, undefined];
    case 'tab':
      return [context.project, undefined];
    case 'panel':
      return [context.project, context.tab, undefined];
    case 'terminal':
      return [context.project, context.tab, context.panel, undefined];
    case 'project':
    case 'pane':
    case 'panelType':
    case 'subWorkspace':
      return [undefined];
  }
}

/**
 * Render a subject for display. The ONLY place a subject becomes a string (FR-021).
 *
 * Absent, empty and elided parts are dropped rather than joined, so nothing ever renders a dangling
 * separator — the edge case that makes a formatter look broken on exactly the failure a user is
 * already annoyed about.
 *
 * Truncation is applied PER PART and never to the joined string. Losing the panel name because the
 * project name was long is the opposite of the point, so a three-part subject can legitimately
 * render longer than the per-part bound.
 */
export function formatSubject(subject: NoticeSubject, context: SubjectContext = {}): string {
  const parts = partsOf(subject);
  const elide = contextFor(subject, context);
  const rendered: string[] = [];
  for (const [index, part] of parts.entries()) {
    const value = part?.trim();
    if (!value) continue;
    // Compared against the RAW part, before truncation: two long names that the context matches are
    // still the same name, and truncating first would make elision depend on length.
    if (value === elide[index]?.trim()) continue;
    rendered.push(truncate(value));
  }
  return rendered.join(SUBJECT_SEPARATOR);
}
