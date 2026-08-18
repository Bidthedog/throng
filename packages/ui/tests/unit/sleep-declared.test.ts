import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { describe, it, expect } from 'vitest';

/**
 * The declared-sleep register (spec 034, FR-019 / SC-006).
 *
 * `sleep-budget.test.ts` is a ratchet on the NUMBER of sleeps; this is a gate on their REASONS, and
 * the two answer different questions. The ratchet stops the debt growing. It cannot tell you whether
 * any individual wait was ever thought about, and at the baseline that mattered: 222 sleeps, **137
 * of them with no comment at all**, and the other 85 carrying comments about the step rather than
 * about the duration.
 *
 * So every remaining `waitForTimeout` must carry a marker naming what the test would otherwise wait
 * ON, immediately above the call:
 *
 * ```ts
 * // sleep-justified: claude's TUI redraws for a while after it reports ready, and nothing it emits
 * // marks the end of that — there is no observable to wait on.
 * await win.waitForTimeout(3000);
 * ```
 *
 * Why a marker and not "a comment nearby": a comment above a sleep is evidence that somebody wrote a
 * comment, not that anybody justified the sleep. The baseline is full of sleeps sitting under a
 * comment describing the CLICK above them. A distinct token cannot be produced by accident, which is
 * the only property that makes the gate mean anything.
 *
 * **This deliberately covers the helpers too.** `sleep-budget.json` counts only `*.e2e.ts`, so a
 * sleep moved into `harness.ts` or `helpers/` left the ratchet entirely — and a sleep in a helper is
 * the expensive kind, because it runs once per caller rather than once.
 */

const E2E_DIR = fileURLToPath(new URL('../e2e', import.meta.url));

/** The marker, and enough of a reason to be one. */
const MARKER = /^\s*(?:\/\/|\*)\s*sleep-justified:\s*(.+)$/;
const MIN_REASON = 25;

/**
 * A real call site, as opposed to the word appearing in prose.
 *
 * The existing ratchet matches `waitForTimeout(` anywhere, which counts the four places this file's
 * own doc comment says the word. Requiring an `await` and a receiver keeps the gate pointed at code.
 */
const CALL = /\bawait\s+[\w.]*\.waitForTimeout\(/;
const IN_COMMENT = /^\s*(\/\/|\*|\/\*)/;

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface Site {
  where: string;
  code: string;
  why: string | null;
}

function sitesIn(file: string): Site[] {
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  const sites: Site[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (IN_COMMENT.test(lines[i]) || !CALL.test(lines[i])) continue;
    /*
     * Walk back past blank lines, then across the whole CONTIGUOUS comment block above the call,
     * and accept the marker anywhere in it.
     *
     * The first version required it on the nearest line, which rejected the ordinary way people
     * write a two-line reason — marker on the first line, the rest of the sentence on the second.
     * That is the scanner being wrong, not the comment: it would have taught authors to repeat a
     * token on every line to satisfy a machine, and a rule that makes good writing harder gets
     * worked around rather than followed. The block must still be contiguous and immediately above
     * the call, so an unrelated marker further up cannot adopt a sleep that has none.
     */
    let j = i - 1;
    while (j >= 0 && lines[j].trim() === '') j--;
    const block: string[] = [];
    while (j >= 0 && IN_COMMENT.test(lines[j])) {
      block.unshift(lines[j]);
      j--;
    }
    let why: string | null = null;
    for (let k = 0; k < block.length; k++) {
      const m = block[k].match(MARKER);
      if (!m) continue;
      // Everything from the marker to the end of the block is the reason, so a wrapped sentence is
      // measured whole rather than truncated at the first newline.
      why = [m[1], ...block.slice(k + 1).map((l) => l.replace(/^\s*(?:\/\/|\*)\s?/, ''))]
        .join(' ')
        .trim();
      break;
    }
    sites.push({
      where: `${relative(E2E_DIR, file).replace(/\\/g, '/')}:${i + 1}`,
      code: lines[i].trim(),
      why,
    });
  }
  return sites;
}

describe('declared-sleep register', () => {
  const sites = tsFilesUnder(E2E_DIR).flatMap(sitesIn);

  it('finds the sleeps at all, so an empty pass cannot be mistaken for a clean one', () => {
    // Without this, deleting the CALL pattern by mistake turns every assertion below green while
    // proving nothing — the vacuous-pass trap FR-046a exists for, applied to the guard itself.
    expect(sites.length, 'no waitForTimeout call sites were found — the scanner is broken').toBeGreaterThan(0);
  });

  it('every sleep names what the test would otherwise wait on', () => {
    const bare = sites.filter((s) => s.why === null);
    expect(
      bare.map((s) => `${s.where}  ${s.code}`),
      `These waits are undeclared. A waitForTimeout asserts that N milliseconds is always enough on ` +
        `every machine under every load, which is the defect class behind #245, #246 and #251. If ` +
        `there is an observable — an element, a value, a file's content, a screen that has stopped ` +
        `changing — wait for THAT (see quiesced() and geom() in harness.ts). If there genuinely is ` +
        `not, say so on the line above:\n` +
        `    // sleep-justified: <what you would wait on, and why it does not exist>\n`,
    ).toEqual([]);
  });

  it('a justification says something', () => {
    const thin = sites.filter((s) => s.why !== null && s.why.length < MIN_REASON);
    expect(
      thin.map((s) => `${s.where}  "${s.why}"`),
      `A marker with nothing after it is worse than no marker — it reads as a judgement somebody ` +
        `made. Name the observable that does not exist, in at least ${MIN_REASON} characters:\n`,
    ).toEqual([]);
  });
});
