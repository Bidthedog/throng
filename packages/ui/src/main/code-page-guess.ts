/**
 * 059 FR-069 — whether a file read in a code page may be in another one, and which.
 *
 * Bytes cannot tell the single-byte code pages apart, so detection always ends in the fallback. Two signals say
 * the reading may be wrong: the decoded text's own shape ({@link looksMisreadAs}), and jschardet's letter-
 * frequency statistics. Measured on sample files, jschardet names Greek, Cyrillic, Hebrew and Arabic with
 * confidence and Latin-script text only weakly — so a CONFIDENT guess for another code page raises the notice on
 * its own (that is how Greek read as Cyrillic is caught, which the text alone never shows), and a weak one only
 * names the code page once the text has already raised it.
 *
 * In main, not core: the renderer imports core's root, and jschardet is not something it should ship.
 */
import { chardet } from 'jschardet';
import { CODE_PAGE_IDS, looksMisreadAs, readText, type CodePageId } from '@throng/core';

/** jschardet's names for the code pages it may answer with; nothing else is a useful suggestion. */
const CANDIDATES = CODE_PAGE_IDS.map((id) => `Windows-${id.slice('windows'.length)}`);
/** How much is sampled: enough for stable statistics, small enough to cost tens of ms on open. */
const SAMPLE_BYTES = 16 * 1024;
/** A guess at least this confident raises the notice without the text's help. */
const CONFIDENT = 0.3;

function toCodePage(name: string | null): CodePageId | null {
  const m = /^(?:windows-|cp)(125[0-8])$/i.exec(name ?? '');
  return m ? (`windows${m[1]}` as CodePageId) : null;
}

/**
 * Every byte some code page leaves undefined (1253, 1255, 1257). jschardet rules a code page out on ONE such byte,
 * so a Greek file with a stray 0xAA was guessed as Turkish (FR-072); blanking them to a space costs the statistics
 * a letter or two and keeps every code page in the running.
 */
const UNDEFINED_SOMEWHERE: ReadonlySet<number> = (() => {
  const out = new Set<number>();
  for (const id of CODE_PAGE_IDS) {
    const r = readText(Uint8Array.from({ length: 128 }, (_, i) => 0x80 + i), id);
    if (!r.ok) continue;
    for (let i = 0; i < 128; i++) if ((r.file.text.charCodeAt(i) & 0xff00) === 0xf700) out.add(0x80 + i);
  }
  return out;
})();

/**
 * The most likely code page by jschardet whose own reading does not look misread, with its confidence, or `null`.
 * The self-check stops a suggestion the user would reopen into gibberish (FR-072).
 */
function guess(bytes: Uint8Array): { page: CodePageId; confidence: number } | null {
  const sample = bytes.length > SAMPLE_BYTES ? bytes.subarray(0, SAMPLE_BYTES) : bytes;
  const blanked = sample.map((b) => (UNDEFINED_SOMEWHERE.has(b) ? 0x20 : b));
  for (const r of chardet.detectAll(blanked, { includeEncodings: CANDIDATES, ignoreThreshold: true })) {
    const page = toCodePage(r.encoding);
    if (!page) continue;
    const reading = readText(sample, page);
    if (reading.ok && !looksMisreadAs(reading.file.text, page)) return { page, confidence: r.confidence };
  }
  return null;
}

/**
 * The read notice's verdict on a file read in `readAs` (FR-069): `null` when the reading looks right; otherwise
 * the code page to suggest, `likely: null` when there is none better than the one already read.
 */
export function codePageHint(bytes: Uint8Array, text: string, readAs: CodePageId): { likely: CodePageId | null } | null {
  const g = guess(bytes);
  const other = g !== null && g.page !== readAs ? g : null;
  if (looksMisreadAs(text, readAs)) return { likely: other?.page ?? null };
  return other !== null && other.confidence >= CONFIDENT ? { likely: other.page } : null;
}
