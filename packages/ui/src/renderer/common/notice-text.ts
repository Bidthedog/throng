import { isValidElement, type ReactElement, type ReactNode } from 'react';
import {
  formatSubject,
  groupAffected,
  ungroupedAffected,
  type AffectedRow,
  type AffectedTabGroup,
  type NoticeSubject,
} from '@throng/core';

import type { Notice } from './notification.js';

/**
 * 030 US5 (#238) — WHAT A NOTICE SAYS, AS TEXT.
 *
 * ══ THE DEFECT THIS MODULE EXISTS TO CLOSE ══
 *
 * `noticeToText` used to be an ENUMERATION OF KNOWN FIELDS, over a `Pick<>` that named four of
 * them: `heading + message + details + copyDetail`. `Notice.body` was added afterwards, carrying the
 * editor notice's structured file list, and the copy text silently stopped being the notice — the
 * user copied a heading and a sentence, and the list the notice was actually about stayed on screen.
 *
 * Nothing failed, and nothing COULD fail: a field list agrees with itself by construction, and the
 * `Pick<>` did not even accept the field it was dropping. Rewriting one field list as a longer field
 * list reproduces the defect the day the next part is added.
 *
 * ══ THE RULE (FR-049) ══
 *
 * {@link noticeParts} is the notice's rendered content — every part, in the order it is rendered —
 * and it has exactly two consumers, which is the whole design:
 *
 *   • `notification.tsx` RENDERS from it, so a part that is not in this list cannot be on screen;
 *   • {@link noticeToText} SERIALISES from it, so a part that is on screen is in the copy.
 *
 * The E2E guard (`failure-copy.e2e.ts`) compares the copied text against the notice's own rendered
 * DOM, in order, which is what catches the remaining hole: markup added to the card directly rather
 * than through a part. Omission fails a test instead of shipping.
 *
 * ══ THE TWO PARTS THAT ARE COPIED AND NEVER RENDERED ══
 *
 * `Notice.copyDetail` (the raw system error, FR-034) and each affected row's own `detail`
 * (FR-048a). A DOM comparison is structurally incapable of noticing either going missing — there is
 * nothing on screen to compare against — so they are asserted individually in
 * `tests/unit/notice-text.test.ts`. This is the one place the derive-from-rendered rule cannot
 * protect itself, and it is deliberately small.
 *
 * ══ ORDER: RENDER ORDER, WHICH IS NOT THE CONTRACT'S ILLUSTRATION ══
 *
 * `contracts/notice-api.md` illustrates the affected list ABOVE the body. The card renders `body`
 * first (`notification.tsx`), and the contract's own rule — "in the order it renders it" — wins over
 * its illustration, which is explicitly marked as one. No notice carries both today, so the two read
 * identically; when one does, the copy will match the screen rather than the sketch.
 */

/** One rendered part of a notice. The union IS the render order's alphabet. */
export type NoticePart =
  | { kind: 'heading'; text: string }
  | { kind: 'message'; text: string }
  /** Arbitrary rendered content — today the editor notice's structured file list. */
  | { kind: 'body'; node: ReactNode }
  /**
   * The casualties one cause defeated, already grouped and formatted by `@throng/core`.
   *
   * `groups` are the rows that have a PANEL, under their tab headings. `ungrouped` are the rows that
   * do not (041 FR-013: a refused open creates none), which have no tab to sit under and render as
   * one section after every group. Both travel in ONE part so the drawn list and the copied list
   * cannot diverge — the reason grouping moved out of the component in the first place.
   */
  | { kind: 'affected'; groups: readonly AffectedTabGroup[]; ungrouped: readonly AffectedRow[] }
  | { kind: 'details'; items: readonly string[] };

/**
 * A notice as this module reads it — the stored shape, minus the id nothing here needs.
 *
 * Deliberately NOT a `Pick<>` of the fields this file happens to use: that is precisely what made
 * the previous implementation incapable of seeing `body`, because a field it did not name was a
 * field it could not receive.
 */
export type NoticeContent = Omit<Notice, 'id'>;

/**
 * The heading a notice shows above its message (030 FR-020, `contracts/notice-api.md`).
 *
 * WHAT WAS ATTEMPTED, ON WHAT. The two together are the heading; the message below states only what
 * went wrong. That split is the whole of #195's fix on screen — "An error occurred when you tried to
 * rename this item" told the user everything except the part they needed.
 *
 *   title                          → the title, unchanged: it already names its own event
 *   subject ≠ none, action         → `Couldn't {action} {subject}`
 *   subject ≠ none, no action      → the subject alone
 *   subject = none, action, error  → today's derived sentence
 *   otherwise                      → no heading, exactly as today
 *
 * `formatSubject` renders the subject and NOTHING here does: quoting, ordering, elision and the
 * 48-character bound are decided in one place (FR-021), so a heading can never disagree with a
 * banner or a log record about what a panel is called.
 *
 * The derived sentence stays behind `severity === 'error'`: "an error occurred" is a lie over a
 * warning. A subject, by contrast, is a fact at any severity — the panel-rename warning presents one
 * with no action at all.
 *
 * Lives here rather than in `notification.tsx` because the heading is the notice's FIRST RENDERED
 * PART, and the part list is what both the card and the clipboard are built from.
 */
export function noticeHeading(
  n: Pick<Notice, 'title' | 'action' | 'severity' | 'subject'>,
): string | undefined {
  if (n.title) return n.title;
  const subject = n.subject ? formatSubject(n.subject) : '';
  if (subject) return n.action ? `Couldn't ${n.action} ${subject}` : subject;
  if (n.severity === 'error' && n.action) return `An error occurred when you tried to ${n.action}`;
  return undefined;
}

/**
 * The project a subject names, for the affected list's context (FR-031b).
 *
 * The heading already states it, so the rows must not — and rather than carry a second field saying
 * what the subject already says, the context is READ OFF the subject. A notice about anything but a
 * project or something inside one has no project to elide, which is the correct answer and not a
 * missing case.
 */
export function projectOf(subject: NoticeSubject | undefined): string | undefined {
  if (!subject) return undefined;
  switch (subject.kind) {
    case 'project':
      return subject.name;
    case 'tab':
    case 'panel':
    case 'terminal':
      return subject.project;
    default:
      return undefined;
  }
}

/**
 * EVERYTHING THE NOTICE RENDERS, IN RENDER ORDER.
 *
 * The single list `notification.tsx` renders from and {@link noticeToText} serialises from. Adding a
 * rendered part means adding it here, once, and both follow.
 */
export function noticeParts(n: NoticeContent): readonly NoticePart[] {
  const parts: NoticePart[] = [];
  const heading = noticeHeading(n);
  if (heading) parts.push({ kind: 'heading', text: heading });
  // Always present — the card always renders the `<p>`, even for a notice whose message is empty,
  // and a part list that disagreed with the DOM about that would be a part list nobody could trust.
  parts.push({ kind: 'message', text: n.message });
  if (n.body !== undefined && n.body !== null && n.body !== false) {
    parts.push({ kind: 'body', node: n.body });
  }
  if (n.affected?.length) {
    // Grouping, ordering and every rendered name are `@throng/core`'s (`notice/affected.ts`) — pure
    // decisions, made once, so the copied list and the drawn list cannot order or name differently.
    const context = { project: projectOf(n.subject) };
    parts.push({
      kind: 'affected',
      groups: groupAffected(n.affected, context),
      ungrouped: ungroupedAffected(n.affected, context),
    });
  }
  if (n.details?.length) parts.push({ kind: 'details', items: n.details });
  return parts;
}

/** Tags whose content starts a new line when read, matching how a browser reads `innerText`. */
const BLOCK = new Set([
  'address',
  'article',
  'blockquote',
  'br',
  'div',
  'dd',
  'dl',
  'dt',
  'figure',
  'footer',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
]);

/** Walk a node, marking block boundaries with newlines that {@link nodeText} then normalises. */
function walk(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(walk).join('');
  if (isValidElement(node)) {
    const el = node as ReactElement<{ children?: ReactNode }>;
    const inner = walk(el.props?.children);
    /*
     * A COMPONENT's own output is not reachable from here — rendering it needs a renderer, and a
     * hook inside it would throw outside one. Its children (what the caller passed IN) are still
     * read, which covers every `body` in the application today. If a future body is a component that
     * renders text of its own, the E2E's DOM comparison is what will say so, out loud, at the
     * moment it is introduced.
     */
    return typeof el.type === 'string' && BLOCK.has(el.type) ? `\n${inner}\n` : inner;
  }
  return '';
}

/**
 * The text of arbitrary rendered content — what a reader would see, line by line.
 *
 * Block boundaries become line breaks and inline elements do not, which is what a browser's
 * `innerText` does, and therefore what the E2E's DOM comparison is comparing against.
 */
export function nodeText(node: ReactNode): string {
  return walk(node)
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');
}

/** One part, as the text it reads as. */
export function partText(part: NoticePart): string {
  switch (part.kind) {
    case 'heading':
    case 'message':
      return part.text;
    case 'body':
      return nodeText(part.node);
    case 'affected':
      /*
       * The tab, then its rows indented under it — the shape the list is drawn in.
       *
       * FR-048a: a row carrying its OWN raw error emits it beside the row. Two different
       * unclassified failures in one operation share a notice whose message can state neither, and
       * FR-034 forbids rendering them, so this line is the only route by which a user ever learns
       * which panel failed for which reason.
       */
      return part.groups
        .flatMap((group) => [
          ...(group.label ? [group.label] : []),
          ...group.rows.map((row) => `  ${row.label}${row.detail ? ` — ${row.detail}` : ''}`),
        ])
        .join('\n');
    case 'details':
      return part.items.join('\n');
  }
}

/**
 * A notice as PLAIN TEXT, for the clipboard (FR-048/FR-049).
 *
 * The whole notice, in the order it is read on screen, and then the raw system error underneath it:
 * a bug report wants the human sentence first and the machine text below, and the machine text is
 * precisely the part a user cannot retype accurately.
 */
export function noticeToText(n: NoticeContent): string {
  return [...noticeParts(n).map(partText), n.copyDetail]
    .filter((text): text is string => !!text && text.trim().length > 0)
    .join('\n');
}

/** What a failure banner copies (FR-052) — the four facts it holds. */
export interface PanelFailureCopy {
  /** The banner's own headline, in its panel type's words (FR-040). */
  headline: string;
  /** What the banner is about, in FULL: there is no surrounding context to elide it against. */
  subject: NoticeSubject;
  detail?: { path?: string; systemError?: string };
}

/**
 * THE BANNER'S copy text (FR-052), which must work with no notice on screen (FR-053).
 *
 * The banner is not a notice and has no `noticeToText` to lean on: it is a standing statement about
 * a panel's condition, and it stands whatever the notification preferences say (FR-005a). For a
 * silenced severity this text and the diagnostic log are the ONLY routes by which the system error
 * reaches the user, which is why the pointer sentence leads with Copy rather than with the notice.
 *
 * The subject goes through `formatSubject` like every other subject in the application (FR-021), so
 * a banner can never spell `Project — Tab — Panel` differently from the notice about the same panel.
 */
export function panelFailureText(copy: PanelFailureCopy): string {
  return [copy.headline, formatSubject(copy.subject), copy.detail?.path, copy.detail?.systemError]
    .filter((part): part is string => !!part && part.trim().length > 0)
    .join('\n');
}
