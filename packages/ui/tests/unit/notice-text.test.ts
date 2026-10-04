import { createElement as h } from 'react';
import { describe, expect, it } from 'vitest';

import {
  noticeParts,
  noticeToText,
  nodeText,
  panelFailureText,
} from '../../src/renderer/common/notice-text.js';
import type { AffectedPanel } from '@throng/core';

/**
 * 030 US5 (#238) — COPY THE WHOLE OF ANY ERROR.
 *
 * ══ THE DEFECT ══
 *
 * `noticeToText` was written as an ENUMERATION OF KNOWN FIELDS — `heading + message + details +
 * copyDetail`, over a `Pick<>` that named four of them. `Notice.body` was added later, carrying the
 * editor notice's structured file list, and the copy text silently stopped being the notice: the
 * user copied a heading and a sentence, and the list of files the notice was actually about stayed
 * on screen. Nothing failed. Nothing could fail — the field list agreed with itself.
 *
 * So FR-049 makes the rule structural: the copy text is derived from WHAT THE NOTICE RENDERS, in
 * the order it renders it. {@link noticeParts} is that order, and `notification.tsx` renders FROM
 * it — a part that is not in the list cannot appear on screen, and a part that is appears in both.
 *
 * ══ WHAT THIS FILE CAN AND CANNOT GUARD ══
 *
 * The E2E (`failure-copy.e2e.ts`) compares the copied text against the notice's rendered DOM, which
 * is what catches a part added to the card and forgotten here. It is structurally incapable of
 * seeing the two parts that are COPIED AND NEVER RENDERED — `copyDetail` (FR-034) and each affected
 * row's own `detail` (FR-048a) — because there is nothing in the DOM for them to be compared
 * against. Those two therefore have their own assertions below, and this is the one place in the
 * feature where the derive-from-rendered rule cannot protect itself.
 */

/** A row of the consolidated notice's list, in the shape `groupAffected` orders. */
function panel(over: Partial<AffectedPanel> & { panelId: string; panelName: string }): AffectedPanel {
  return {
    tabId: 't1',
    tabName: 'Main',
    tabOrder: 0,
    panelOrder: 0,
    ...over,
  };
}

describe('noticeToText — every rendered part, in render order', () => {
  it('emits heading, message, body, affected list and details, in the order they are rendered', () => {
    const text = noticeToText({
      severity: 'error',
      action: 'open',
      subject: { kind: 'project', name: 'Consol' },
      message: 'The file could not be opened.',
      body: h('ul', null, h('li', null, 'src/one.txt'), h('li', null, 'src/two.txt')),
      affected: [
        panel({ panelId: 'p1', panelName: 'Docs' }),
        panel({ panelId: 'p2', panelName: 'Shell', panelOrder: 1 }),
      ],
      details: ['first detail', 'second detail'],
      copyDetail: "ENOENT: no such file or directory, open 'C:\\gone\\one.txt'",
    });

    // The heading is the notice's own — composed once, by `noticeHeading`, never re-spelled here.
    // 050 FR-037: every SHOWN line first, then a blank line, `Details`, and what is never shown.
    expect(text.split('\n')).toEqual([
      "Couldn't open Consol",
      'The file could not be opened.',
      'src/one.txt',
      'src/two.txt',
      'Main',
      '  Docs',
      '  Shell',
      'first detail',
      'second detail',
      '',
      'Details',
      'Consol',
      "ENOENT: no such file or directory, open 'C:\\gone\\one.txt'",
    ]);
  });

  it('includes `body` — the part the field-list implementation silently dropped (#238)', () => {
    // The narrowest statement of the defect. A notice whose whole content is its body copied as a
    // heading and a sentence, and the list it was about did not travel.
    const text = noticeToText({
      severity: 'warning',
      title: 'File changed on disk',
      subject: { kind: 'none' },
      message: 'Saving will overwrite those changes.',
      body: h(
        'ul',
        { className: 'editor-notice__files' },
        h(
          'li',
          { className: 'editor-notice__file' },
          h('span', null, h('span', null, 'src\\'), h('span', null, 'code.txt')),
        ),
      ),
    });
    expect(text).toContain('src\\code.txt');
    expect(text.split('\n')).toEqual([
      'File changed on disk',
      'Saving will overwrite those changes.',
      'src\\code.txt',
    ]);
  });

  it('carries the whole affected list, grouped by tab, in displayed order (FR-050)', () => {
    // "Regardless of scroll" is a claim about the DATA, and it is true here by construction: the
    // list is what the notice holds, not what a viewport happens to be showing. The E2E proves the
    // scrolled case end to end; this proves the text is built from the whole list.
    const text = noticeToText({
      severity: 'error',
      subject: { kind: 'project', name: 'Consol' },
      message: 'The project root is no longer there.',
      affected: [
        panel({ panelId: 'p3', panelName: 'Scratch', tabId: 't2', tabName: 'Second', tabOrder: 1 }),
        panel({ panelId: 'p1', panelName: 'Docs' }),
        panel({ panelId: 'p2', panelName: 'Shell', panelOrder: 1 }),
      ],
    });
    expect(text.split('\n')).toEqual([
      'Consol',
      'The project root is no longer there.',
      'Main',
      '  Docs',
      '  Shell',
      'Second',
      '  Scratch',
      '',
      'Details',
      'Consol',
    ]);
  });

  it('contributes nothing for the parts a notice does not have', () => {
    // No blank lines, no orphan separators: an absent part is absent, not an empty one.
    expect(noticeToText({ severity: 'info', subject: { kind: 'none' }, message: 'Saved.' })).toBe(
      'Saved.',
    );
  });

  it('orders the PARTS themselves as the card renders them', () => {
    // The list `notification.tsx` renders from. Asserting the kinds pins the contract that the two
    // consumers cannot disagree: what is not in this array cannot be on screen.
    const parts = noticeParts({
      severity: 'error',
      title: 'Heading',
      subject: { kind: 'none' },
      message: 'Message',
      body: h('p', null, 'Body'),
      affected: [panel({ panelId: 'p1', panelName: 'Docs' })],
      details: ['detail'],
    });
    expect(parts.map((p) => p.kind)).toEqual(['heading', 'message', 'body', 'affected', 'details']);
  });
});

/**
 * The two asymmetries the DOM comparison cannot see (T064a).
 *
 * Both are copied and never rendered, so `failure-copy.e2e.ts` — which compares copy against the
 * rendered card — would pass with either of them missing. They are asserted here or nowhere.
 */
describe('noticeToText — copied, and deliberately never rendered', () => {
  it('copies `copyDetail`, the raw system error FR-034 forbids rendering', () => {
    const raw = "EBUSY: resource busy or locked, rename 'C:\\work\\src'";
    const text = noticeToText({
      severity: 'error',
      subject: { kind: 'file', name: 'src' },
      message: 'Another program is using that folder.',
      copyDetail: raw,
    });
    expect(text).toContain(raw);
    // LAST — a bug report wants the human sentence first and the machine text under it, below the
    // `Details` line (050 FR-037), which the shown lines never reach.
    expect(text.split('\n').at(-1)).toBe(raw);
    const lines = text.split('\n');
    expect(lines.indexOf('Details')).toBeGreaterThan(lines.indexOf('Another program is using that folder.'));
  });

  it("emits each affected row's OWN error under Details, never among the shown rows (FR-048a, 050 FR-037)", () => {
    // Two panels, two DIFFERENT unclassified failures, one notice. The shared message cannot state
    // either of them, and FR-034 forbids rendering them, so copy is the only route by which a user
    // ever sees which panel failed for which reason.
    const text = noticeToText({
      severity: 'error',
      subject: { kind: 'project', name: 'Consol' },
      message: 'Those files could not be opened.',
      affected: [
        panel({ panelId: 'p1', panelName: 'Docs', detail: 'C:\\work\\one.txt (io)' }),
        panel({ panelId: 'p2', panelName: 'Notes', panelOrder: 1, detail: 'C:\\work\\two.txt (binary)' }),
      ],
    });
    expect(text.split('\n')).toEqual([
      'Consol',
      'Those files could not be opened.',
      'Main',
      '  Docs',
      '  Notes',
      '',
      'Details',
      'Consol',
      'Docs — C:\\work\\one.txt (io)',
      'Notes — C:\\work\\two.txt (binary)',
    ]);
  });

  it('leaves a row without its own error out of Details, and adds no Details for nothing', () => {
    const text = noticeToText({
      severity: 'error',
      subject: { kind: 'none' },
      message: 'Those panels could not be opened.',
      affected: [panel({ panelId: 'p1', panelName: 'Docs' })],
    });
    expect(text).not.toContain('—');
    expect(text).not.toContain('Details');
  });
});

/**
 * 050 FR-037 / SC-013 — a shown line with no panel is copied like any other.
 *
 * `partText` walked `groups` and ignored `ungrouped`, which the affected list DRAWS after every
 * group (041 FR-013: a refused open creates no panel). The row vanished from the copy.
 */
describe('noticeToText — rows with no panel (050 FR-037)', () => {
  /** 041 FR-013 — a refused open: no panel, so no tab to sit under. */
  const refused = {
    subject: 'todo.md',
    reason: 'missing',
    displayPath: 'notes\\todo.md',
    detail: 'C:\\work\\notes\\todo.md (missing)',
  };

  it('copies an ungrouped row after every group, then its path and reason under Details', () => {
    const text = noticeToText({
      severity: 'error',
      subject: { kind: 'project', name: 'Consol' },
      message: 'Those files could not be opened.',
      affected: [panel({ panelId: 'p1', panelName: 'Docs' }), refused],
    });
    expect(text.split('\n')).toEqual([
      'Consol',
      'Those files could not be opened.',
      'Main',
      '  Docs',
      'notes\\todo.md',
      '',
      'Details',
      'Consol',
      'notes\\todo.md — C:\\work\\notes\\todo.md (missing)',
    ]);
  });

  it('copies a notice whose ONLY rows are ungrouped', () => {
    const text = noticeToText({
      severity: 'error',
      subject: { kind: 'none' },
      message: 'That file could not be opened.',
      affected: [refused],
    });
    expect(text.split('\n')).toContain('notes\\todo.md');
  });
});

describe('nodeText — the text of arbitrary rendered content', () => {
  it('reads through nested elements, block by block', () => {
    expect(
      nodeText(
        h(
          'ul',
          null,
          h('li', null, h('span', null, 'src\\'), h('span', null, 'one.txt')),
          h('li', null, 'two.txt'),
        ),
      ),
    ).toBe('src\\one.txt\ntwo.txt');
  });

  it('is empty for the nodes React renders as nothing', () => {
    for (const empty of [null, undefined, false, true, '']) {
      expect(nodeText(empty)).toBe('');
    }
  });
});

/**
 * The BANNER's copy text (FR-052) — the same four facts, from a surface that has no notice.
 *
 * `contracts/panel-failure-banner.md` fixes the shape: headline, the subject in FULL
 * `Project — Tab — Panel` form (there is no surrounding context to elide from it), the path, and the
 * system error. It is the route that always works, which is why the banner's pointer sentence leads
 * with it.
 */
describe('panelFailureText — the banner, with no notice on screen (FR-052/FR-053)', () => {
  it('names the headline, the subject in full, the path and the system error', () => {
    expect(
      panelFailureText({
        headline: 'This terminal could not be opened',
        subject: { kind: 'panel', name: 'Shell', tab: 'Main', project: 'Ghost' },
        detail: {
          path: 'C:\\throng-e2e-missing\\ghost',
          systemError: 'Cannot lock "C:\\throng-e2e-missing\\ghost": the path does not exist',
        },
      }).split('\n'),
    ).toEqual([
      // Shown, in the order the banner draws them (050 FR-037): headline, path, pointer.
      'This terminal could not be opened',
      'C:\\throng-e2e-missing\\ghost',
      'Copy the details here, or see the notification.',
      '',
      // Never shown (030 FR-034, FR-048a): the full subject and the raw system error.
      'Details',
      'Ghost — Main — Shell',
      'Cannot lock "C:\\throng-e2e-missing\\ghost": the path does not exist',
    ]);
  });

  it('copies the note, the retry-failed sentence and the pointer exactly as the banner shows them', () => {
    // The omissions of MT-02: the note, the retry-failed sentence and the pointer were rendered and
    // never copied, so a user pasting the banner into a report lost every sentence but the headline.
    expect(
      panelFailureText({
        headline: 'This file could not be read',
        subject: { kind: 'panel', name: 'Docs', tab: 'Main', project: 'Ghost' },
        detail: { path: 'C:\\ghost\\a.txt', systemError: 'EACCES: permission denied' },
        note: 'What is shown here is not the file. Restore the file before saving.',
        retryFailed: true,
      }).split('\n'),
    ).toEqual([
      'This file could not be read',
      'C:\\ghost\\a.txt',
      'What is shown here is not the file. Restore the file before saving.',
      'That did not work — the condition is still there.',
      'Copy the details here, or see the notification.',
      '',
      'Details',
      'Ghost — Main — Docs',
      'EACCES: permission denied',
    ]);
  });

  it('names no notification where none was raised, and no pointer at all on a Close banner', () => {
    const base = { headline: 'h', subject: { kind: 'none' } } as const;
    expect(panelFailureText({ ...base, pointer: 'copy-only' }).split('\n')).toEqual([
      'h',
      'Copy the details here.',
    ]);
    expect(panelFailureText({ ...base, pointer: 'none' })).toBe('h');
  });

  it('holds the moved notice its sentence and new path, with the subject under Details', () => {
    expect(
      panelFailureText({
        headline: 'This file moved to another project, at B\\new.txt. You can no longer work on it in this project.',
        subject: { kind: 'panel', name: 'Docs', tab: 'Main', project: 'A' },
        detail: { path: 'B\\new.txt' },
        pointer: 'none',
      }).split('\n'),
    ).toEqual([
      'This file moved to another project, at B\\new.txt. You can no longer work on it in this project.',
      'B\\new.txt',
      '',
      'Details',
      'A — Main — Docs',
    ]);
  });

  it('omits what the banner does not have, rather than emitting empty lines', () => {
    expect(
      panelFailureText({
        headline: 'This file could not be read',
        subject: { kind: 'none' },
        pointer: 'none',
      }),
    ).toBe('This file could not be read');
  });
});
