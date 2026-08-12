import { describe, expect, it } from 'vitest';

import { noticeHeading } from '../../src/renderer/common/notification.js';
import type { NoticeSubject } from '@throng/core';

/**
 * 030 US2 (#195) — THE HEADING PRESENTS THE SUBJECT.
 *
 * The bug is a notice that says "this item could not be renamed" while four projects are open. The
 * fix is structural — a required, structured `subject` with one formatter — and this is the half of
 * it the user actually sees: `noticeHeading` composes what was ATTEMPTED with what it was attempted
 * ON, and the message below states only what went wrong (FR-020).
 *
 * The table is `contracts/notice-api.md`'s, pinned here row by row so a later edit to the wording
 * has to be a deliberate edit to a contract rather than a quiet drift at one call site.
 */

const none: NoticeSubject = { kind: 'none' };
const file: NoticeSubject = { kind: 'file', name: 'notes.txt' };
const panel: NoticeSubject = { kind: 'panel', name: 'Build', tab: 'Main', project: 'Alpha' };

describe('noticeHeading — the contract table', () => {
  it('an explicit title WINS: it already names its own event', () => {
    // The editor notice carries "File changed on disk". Deriving a heading over the top of one that
    // already names the event would bury it.
    expect(
      noticeHeading({
        title: 'File changed on disk',
        severity: 'error',
        action: 'save this file',
        subject: file,
      }),
    ).toBe('File changed on disk');
  });

  it('a subject AND an action compose into "Couldn\'t {action} {subject}"', () => {
    expect(noticeHeading({ severity: 'error', action: 'rename', subject: file })).toBe(
      "Couldn't rename notes.txt",
    );
  });

  it('a panel subject is presented as Project — Tab — Panel, through the one formatter', () => {
    // FR-021/FR-022 — the call site never spells this itself, so two notices about one panel name
    // it identically.
    expect(noticeHeading({ severity: 'error', action: 'rename', subject: panel })).toBe(
      "Couldn't rename Alpha — Main — Build",
    );
  });

  it('a subject with no action is the heading on its own', () => {
    // The panel-rename warning: nothing was "attempted and refused", the name was simply adjusted.
    expect(noticeHeading({ severity: 'warning', subject: panel })).toBe('Alpha — Main — Build');
  });

  it('no subject, an action and severity error keeps today\'s derived sentence', () => {
    // FR-027 — where the subject is genuinely unavailable the message is left as it was, never
    // padded with a placeholder. This row is what makes `{ kind: none }` a safe, honest statement.
    expect(noticeHeading({ severity: 'error', action: 'move these items', subject: none })).toBe(
      'An error occurred when you tried to move these items',
    );
  });

  it('no subject and an action on a NON-error severity has no heading', () => {
    // "An error occurred" is a lie over a warning or an info notice.
    expect(noticeHeading({ severity: 'warning', action: 'move these items', subject: none })).toBeUndefined();
  });

  it('none of the above has no heading, exactly as today', () => {
    expect(noticeHeading({ severity: 'info', subject: none })).toBeUndefined();
    expect(noticeHeading({ severity: 'error', subject: none })).toBeUndefined();
  });

  it('a notice that states no subject at all still behaves as it did', () => {
    // `Notice` (the STORED shape) keeps `subject` optional so a heading can be derived for a notice
    // read back without one; `NoticeInput` is what makes stating one compulsory.
    expect(noticeHeading({ severity: 'error', action: 'delete this' })).toBe(
      'An error occurred when you tried to delete this',
    );
  });

  it('an over-long name is truncated by the formatter, not by the heading', () => {
    // FR-021 — truncation happens in ONE place. A heading that sliced the string itself would be a
    // second rule, and the two would disagree within a release.
    const long = 'x'.repeat(60);
    const heading = noticeHeading({ severity: 'error', action: 'rename', subject: { kind: 'file', name: long } });
    expect(heading).toBe(`Couldn't rename ${'x'.repeat(47)}…`);
  });
});
