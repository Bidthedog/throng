/**
 * Each line's ending follows it through an edit (059 FR-061, research R17).
 *
 * The buffer is `\n`-normalised, so a mixed document's endings exist only in the per-break record of
 * its {@link LineFormat}: entry `i` is the ending of line `i + 1`. This maps that record through a
 * `ChangeSet` over the document it was made against — the breaks inside a replaced range go with it,
 * and the breaks in the inserted text take `inserted` (the dominant ending for an ordinary edit, the
 * chosen one for Insert Line Break). Without it, any edit that changed the number of lines left the
 * record describing a different document, and the next save fell back to one ending everywhere.
 */
import type { ChangeSet, Text } from '@codemirror/state';
import type { LineEndingId } from '../workspace/model.js';
import type { LineFormat } from './document-sync.js';

export function mapLineEndings(
  format: LineFormat,
  before: Text,
  changes: ChangeSet,
  inserted: LineEndingId = format.lineEnding,
): LineFormat {
  // The common case allocates nothing: a uniform document gaining breaks in its own ending stays uniform.
  if ((format.mixedLineEndings?.length ?? 0) === 0 && inserted === format.lineEnding) return format;

  const record: LineEndingId[] =
    format.mixedLineEndings && format.mixedLineEndings.length > 0
      ? [...format.mixedLineEndings]
      : new Array<LineEndingId>(Math.max(0, before.lines - 1)).fill(format.lineEnding);

  const edits: { at: number; removed: number; added: number }[] = [];
  changes.iterChanges((fromA, toA, _fromB, _toB, text) => {
    const first = before.lineAt(fromA).number;
    edits.push({ at: first - 1, removed: before.lineAt(toA).number - first, added: text.lines - 1 });
  });
  // Last first, so every earlier edit's index still names the break it was computed for.
  for (let i = edits.length - 1; i >= 0; i--) {
    const e = edits[i] as { at: number; removed: number; added: number };
    record.splice(e.at, e.removed, ...new Array<LineEndingId>(e.added).fill(inserted));
  }

  if (record.length === 0) return { lineEnding: format.lineEnding };
  const only = record[0] as LineEndingId;
  if (record.every((r) => r === only)) return { lineEnding: only };
  return { lineEnding: format.lineEnding, mixedLineEndings: record };
}
