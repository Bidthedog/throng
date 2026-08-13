import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import { noticeLogRecord } from '@throng/core';
import {
  NOTICE_LOG_CHANNEL,
  NOTICE_LOG_COMPONENT,
  noticeLogLines,
  registerNoticeLogIpc,
  type NoticeLogIpc,
  type NoticeLogSink,
} from '../../src/main/notice-log.js';

/**
 * 030 FR-006/FR-007/FR-034/FR-048a — the renderer→main notice log channel.
 *
 * `formatLogLine` renders `<iso> <LEVEL> [<component>] <message>`, so a record that put its severity
 * in the prose would be unfindable and one that relied on the level would have LOST it: `info` and
 * `success` are two severities and one level. Everything asserted here is about the part of the line
 * this module owns — the labelled fields, and the fact that one record is one line per fact.
 */

function fakeSink(): NoticeLogSink & { written: Array<{ level: string; message: string; component?: string }> } {
  const written: Array<{ level: string; message: string; component?: string }> = [];
  return {
    written,
    logAlways: (level, message, component) => written.push({ level, message, component }),
  };
}

function fakeIpc(): NoticeLogIpc & { fire: (payload: unknown) => void } {
  const handlers: Array<(event: unknown, payload: unknown) => void> = [];
  return {
    on(channel, listener) {
      expect(channel).toBe(NOTICE_LOG_CHANNEL);
      handlers.push(listener);
    },
    fire(payload) {
      for (const h of handlers) h({}, payload);
    },
  };
}

describe('noticeLogLines (the field layout)', () => {
  it('always states the severity, which the level cannot carry', () => {
    const [line] = noticeLogLines(noticeLogRecord({ severity: 'success', message: 'Renamed.' }));
    expect(line).toBe('severity=success | Renamed.');
    const [other] = noticeLogLines(noticeLogRecord({ severity: 'info', message: 'Renamed.' }));
    // Same level, different records — and the file can tell them apart.
    expect(other).not.toBe(line);
  });

  it('quotes the subject so one containing spaces stays one field', () => {
    const [line] = noticeLogLines(
      noticeLogRecord({
        severity: 'error',
        message: "Couldn't rename it.",
        subject: { kind: 'panel', name: 'one.txt', tab: 'Tab 1', project: 'Alpha' },
      }),
    );
    expect(line).toBe('severity=error subject="Alpha — Tab 1 — one.txt" | Couldn\'t rename it.');
  });

  it('states what was attempted, so the line identifies the event (FR-007)', () => {
    /*
     * The record this exists for, written verbatim by `app.tsx`'s restore notice: before these two
     * fields the line read `severity=error | A fresh workspace was opened instead.` and said nothing
     * whatever about the restore that failed. FR-007's literal minimum was met and its sentence —
     * "enough to identify the event without the screen" — was not.
     */
    const [line] = noticeLogLines(
      noticeLogRecord({
        severity: 'error',
        message: 'A fresh workspace was opened instead.',
        subject: { kind: 'none' },
        action: 'restore your previous layout',
      }),
    );
    expect(line).toBe(
      'severity=error action="restore your previous layout" | A fresh workspace was opened instead.',
    );

    // Quoted for the reason the subject is: an action is a phrase, and an unquoted one would put
    // its second word where a reader expects the next label.
    const [titled] = noticeLogLines(
      noticeLogRecord({
        severity: 'warning',
        message: 'Saving will overwrite those changes.',
        subject: { kind: 'file', name: 'one.txt' },
        title: 'File changed on disk',
      }),
    );
    expect(titled).toBe(
      'severity=warning subject="one.txt" title="File changed on disk" | Saving will overwrite those changes.',
    );
  });

  it('quotes the cause too — a cause key is `kind:subject`, and the subject is a real path', () => {
    const [line] = noticeLogLines(
      noticeLogRecord({ severity: 'error', message: 'Gone.', causeKey: 'path-missing:test 1' }),
    );
    expect(line).toContain('cause="path-missing:test 1"');
    // Unquoted, the space would make `cause=path-missing:test` and a stray field called `1`.
    expect(line).not.toContain('cause=path-missing:test 1 ');
  });

  it('puts the message after a bar, so prose can contain anything', () => {
    const [line] = noticeLogLines(
      noticeLogRecord({
        severity: 'warning',
        message: 'A name with = and | in it',
        subject: { kind: 'file', name: 'odd.txt' },
        affectedCount: 3,
      }),
    );
    expect(line).toBe('severity=warning subject="odd.txt" affected=3 | A name with = and | in it');
    // The FIRST bar is the boundary — everything after it is prose, however it is punctuated.
    expect(line.indexOf(' | ')).toBe(line.length - ' | A name with = and | in it'.length);
  });

  it('omits every field the notice does not have, rather than writing empty ones', () => {
    expect(noticeLogLines(noticeLogRecord({ severity: 'info', message: 'x' }))).toEqual([
      'severity=info | x',
    ]);
  });

  it('writes the raw system error on its own line (FR-034)', () => {
    const lines = noticeLogLines(
      noticeLogRecord({
        severity: 'error',
        message: "Couldn't open it.",
        detail: "ENOENT: no such file or directory, realpath 'D:\\test 1'",
      }),
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toBe("detail | ENOENT: no such file or directory, realpath 'D:\\test 1'");
  });

  it('writes one further line per affected panel, each naming its panel (FR-048a)', () => {
    const lines = noticeLogLines(
      noticeLogRecord({
        severity: 'error',
        message: 'Some panels could not be restored.',
        detail: 'EPERM: operation not permitted',
        affectedCount: 2,
        affectedDetails: [
          { panel: 'Tab 1 — one.txt', detail: 'EPERM: operation not permitted, open' },
          { panel: 'Tab 2 — two.txt', detail: 'EBUSY: resource busy or locked' },
        ],
      }),
    );
    expect(lines).toEqual([
      'severity=error affected=2 | Some panels could not be restored.',
      'detail | EPERM: operation not permitted',
      'panel="Tab 1 — one.txt" detail | EPERM: operation not permitted, open',
      'panel="Tab 2 — two.txt" detail | EBUSY: resource busy or locked',
    ]);
  });

  it('escapes a quote inside a quoted field, so the field cannot be closed early', () => {
    const [line] = noticeLogLines(
      noticeLogRecord({ severity: 'error', message: 'x', subject: { kind: 'file', name: 'a"b' } }),
    );
    expect(line).toBe('severity=error subject="a\\"b" | x');
  });

  it('leaves a Windows path exactly as the user would paste it', () => {
    // Escaping backslashes would be the tidier grammar and the worse log: a reader comparing
    // `D:\\git\\throng` against their address bar is comparing two different strings.
    const [line] = noticeLogLines(
      noticeLogRecord({
        severity: 'error',
        message: 'x',
        subject: { kind: 'file', name: 'one.txt', dir: 'D:\\git\\throng' },
        causeKey: 'path-missing:D:\\git\\throng\\test 1',
      }),
    );
    expect(line).toContain('subject="D:\\git\\throng — one.txt"');
    expect(line).toContain('cause="path-missing:D:\\git\\throng\\test 1"');
  });
});

describe('registerNoticeLogIpc (the channel)', () => {
  it('writes every line through logAlways, under the renderer-notice component', () => {
    const sink = fakeSink();
    const ipc = fakeIpc();
    registerNoticeLogIpc(sink, ipc);

    ipc.fire(
      noticeLogRecord({
        severity: 'warning',
        message: 'Careful.',
        subject: { kind: 'file', name: 'one.txt' },
        detail: 'EPERM',
      }),
    );

    expect(sink.written).toEqual([
      { level: 'warn', message: 'severity=warning subject="one.txt" | Careful.', component: NOTICE_LOG_COMPONENT },
      { level: 'warn', message: 'detail | EPERM', component: NOTICE_LOG_COMPONENT },
    ]);
  });

  it('reads the attempted action off the payload, rather than dropping it at the boundary', () => {
    // `recordFrom` reads the payload field by field, so a field added to the record and not to the
    // reader is silently lost on the way across — the record would be right in the renderer and the
    // line wrong in the file, with nothing failing.
    const sink = fakeSink();
    const ipc = fakeIpc();
    registerNoticeLogIpc(sink, ipc);
    ipc.fire(
      noticeLogRecord({
        severity: 'error',
        message: 'A fresh workspace was opened instead.',
        subject: { kind: 'none' },
        action: 'restore your previous layout',
        title: 'Your layout could not be restored',
      }),
    );
    expect(sink.written[0]?.message).toBe(
      'severity=error action="restore your previous layout" title="Your layout could not be restored" ' +
        '| A fresh workspace was opened instead.',
    );
  });

  it('applies no policy of its own — it neither filters by severity nor re-derives the level', () => {
    const sink = fakeSink();
    const ipc = fakeIpc();
    registerNoticeLogIpc(sink, ipc);
    for (const severity of ['error', 'warning', 'info', 'success'] as const) {
      ipc.fire(noticeLogRecord({ severity, message: `a ${severity}` }));
    }
    // Four notices in, four records out. A silenced severity is exactly the one whose record is the
    // only evidence it happened at all (FR-006b), so a filter here would be the bug.
    expect(sink.written.map((w) => w.level)).toEqual(['error', 'warn', 'info', 'info']);
  });

  it('survives a malformed payload without throwing — an uncaught throw here kills main', () => {
    const sink = fakeSink();
    const ipc = fakeIpc();
    registerNoticeLogIpc(sink, ipc);
    expect(() => {
      ipc.fire(null);
      ipc.fire('not a record');
      ipc.fire({ severity: 'nonsense', message: 42 });
    }).not.toThrow();
    // Salvaged, not dropped: a record we cannot read is still evidence something happened.
    expect(sink.written.length).toBeGreaterThan(0);
    for (const w of sink.written) expect(w.level).toBe('error');
  });

  it('is the channel the preload actually sends on', () => {
    // The preload is a sandboxed CommonJS bundle that imports nothing from @throng, so its channel
    // is a literal. A silent rename on either side would leave notices being sent to a channel
    // nobody listens on — and nothing would fail, which is the whole problem with a silent drop.
    const preload = readFileSync(
      fileURLToPath(new URL('../../src/preload/preload.cts', import.meta.url)),
      'utf8',
    );
    expect(preload).toContain(`ipcRenderer.send('${NOTICE_LOG_CHANNEL}'`);
  });

  it('honours the level the renderer chose, without re-deriving it from the severity', () => {
    const sink = fakeSink();
    const ipc = fakeIpc();
    registerNoticeLogIpc(sink, ipc);
    // Contrived, and deliberately so: main is not the authority on the mapping (contract).
    ipc.fire({ level: 'debug', severity: 'error', message: 'as the renderer asked', subject: '' });
    expect(sink.written[0]?.level).toBe('debug');
  });
});
