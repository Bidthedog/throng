/**
 * 059 T031 — a replica takes a line-ending conversion from the canonical stream (contracts/editor-encoding.md).
 *
 * A conversion is a canonical `edit` with EMPTY `changes` and a `lineFormat`, sent to every replica, the
 * origin included. It is never the acknowledgement of a keystroke this view still has in flight — mistaking
 * it for one would drop the in-flight change's real acknowledgement, which then arrives as somebody else's
 * change and applies the keystroke a SECOND time.
 */
import { ChangeSet } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import type { DispatchChangeMsg } from '@throng/core';
import { DocumentReplica } from '../../src/renderer/editor/document-replica.js';

const VIEW = 'view-a';

function replicaAt(version: number) {
  const sent: DispatchChangeMsg[] = [];
  const r = new DocumentReplica('p1', VIEW, (m) => sent.push(m));
  r.reset(version);
  return { r, sent };
}

describe('a line-ending conversion on the canonical stream (059 T031)', () => {
  it('is applied (empty) and advances the version, from any origin', () => {
    const { r } = replicaAt(3);
    const apply = r.receive({
      documentId: 'p1',
      kind: 'edit',
      changes: ChangeSet.empty(5).toJSON(),
      version: 4,
      dirty: true,
      origin: VIEW,
      lineFormat: { lineEnding: 'crlf', mixed: false },
    });
    expect(apply).not.toBeNull();
    expect(apply?.changes.empty).toBe(true);
    expect(r.version).toBe(4);
  });

  it('is never taken for the acknowledgement of this view’s in-flight keystroke', () => {
    const { r, sent } = replicaAt(3);
    // A keystroke in flight: "x" typed at 0 of a 5-character document.
    r.record(ChangeSet.of({ from: 0, insert: 'x' }, 5), null, 'type');
    expect(sent).toHaveLength(1);
    expect(r.pending).toBe(true);

    // The authority orders the CONVERSION first, then acknowledges the keystroke.
    r.receive({
      documentId: 'p1',
      kind: 'edit',
      changes: ChangeSet.empty(5).toJSON(),
      version: 4,
      dirty: true,
      origin: VIEW,
      lineFormat: { lineEnding: 'lf', mixed: false },
    });
    expect(r.pending, 'the keystroke is still awaiting its own acknowledgement').toBe(true);

    const ack = r.receive({
      documentId: 'p1',
      kind: 'edit',
      changes: ChangeSet.of({ from: 0, insert: 'x' }, 5).toJSON(),
      version: 5,
      dirty: true,
      origin: VIEW,
    });
    expect(ack, 'its acknowledgement applies nothing — the view already shows it').toBeNull();
    expect(r.pending).toBe(false);
    expect(r.version).toBe(5);
  });
});

describe('an acknowledgement that carries the line format (059 FR-061, T063)', () => {
  /*
   * Round 2 makes the authority attach `lineFormat` to ANY canonical change that alters the per-line record:
   * an Insert Line Break, or deleting a mixed document's odd break. That change is still this view's own
   * edit coming back. Treating it as foreign would apply the view's own keystroke a second time.
   */
  it('is this view’s own edit acknowledged, and applies nothing', () => {
    const { r, sent } = replicaAt(3);
    r.record(ChangeSet.of({ from: 2, insert: '\n' }, 5), null, null, 'crlf');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.insertedLineEnding).toBe('crlf');

    const ack = r.receive({
      documentId: 'p1',
      kind: 'edit',
      changes: ChangeSet.of({ from: 2, insert: '\n' }, 5).toJSON(),
      version: 4,
      dirty: true,
      origin: VIEW,
      lineFormat: { lineEnding: 'lf', mixed: true },
    });
    expect(ack).toBeNull();
    expect(r.pending).toBe(false);
    expect(r.version).toBe(4);
  });

  it('a Change Encoding (empty changes, `encoding`) is never taken for an in-flight keystroke’s acknowledgement', () => {
    const { r } = replicaAt(3);
    r.record(ChangeSet.of({ from: 0, insert: 'x' }, 5), null, 'type');
    const apply = r.receive({
      documentId: 'p1',
      kind: 'edit',
      changes: ChangeSet.empty(5).toJSON(),
      version: 4,
      dirty: true,
      origin: VIEW,
      encoding: { encoding: 'utf16le', hasBom: true },
    });
    expect(apply).not.toBeNull();
    expect(r.pending, 'the keystroke still awaits its own acknowledgement').toBe(true);
  });

  it('an ordinary edit is sent with no inserted ending', () => {
    const { r, sent } = replicaAt(3);
    r.record(ChangeSet.of({ from: 0, insert: 'x' }, 5), null, 'type');
    expect(sent[0]).not.toHaveProperty('insertedLineEnding');
  });
});
