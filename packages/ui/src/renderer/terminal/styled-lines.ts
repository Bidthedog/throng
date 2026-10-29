/**
 * How many of a terminal buffer's lines carry an attribute — a colour, bold, an underline — for the
 * Resource Monitor's estimate (055 FR-024b, research R9).
 *
 * The calibration measured a styled line costing the renderer about 610 bytes more than a plain one of the
 * same width, beyond its cells (whose 12 bytes each are the same either way), so the estimate needs the
 * count. It is SAMPLED: at most {@link STYLED_LINE_SAMPLE} lines spread evenly over the buffer, each read
 * up to its first styled cell, and the sample's share scaled to the whole. The estimate is reported on
 * every tick, so a full scan of a full buffer — a thousand lines of up to hundreds of cells — is not
 * something it can afford; a sample of 64 is at most 64 lines × their columns of cell reads.
 */

/** The part of xterm's `IBuffer` this reads: structural, so a test can hand it a plain object. */
export interface StyledLineBuffer {
  readonly length: number;
  getLine(y: number): { readonly length: number; getCell(x: number): { isAttributeDefault(): boolean } | undefined } | undefined;
}

/** The most lines read for one count. */
export const STYLED_LINE_SAMPLE = 64;

/** The styled lines in `buffer`: counted exactly up to the sample's size, estimated from a sample beyond it. */
export function styledLineCount(buffer: StyledLineBuffer): number {
  const total = buffer.length;
  if (total <= 0) return 0;
  const sampled = Math.min(total, STYLED_LINE_SAMPLE);
  let styled = 0;
  for (let i = 0; i < sampled; i += 1) {
    const line = buffer.getLine(Math.floor((i * total) / sampled));
    if (line === undefined) continue;
    for (let x = 0; x < line.length; x += 1) {
      if (line.getCell(x)?.isAttributeDefault() === false) {
        styled += 1;
        break;
      }
    }
  }
  return Math.round((styled * total) / sampled);
}
