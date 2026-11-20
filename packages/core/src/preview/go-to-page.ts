/**
 * Go to Page (074 FR-062b, maintainer's request 2026-11-19) — what a PDF preview's page field accepts, and what it
 * goes to. Pure: the renderer's modal (`ui/src/renderer/preview/providers/pdf/go-to-page.tsx`) decides nothing itself.
 *
 * The field is RESTRICTED to the document's pages: a keystroke that would leave anything but nothing or a whole number
 * from 1 to the page count is refused. Every prefix of an allowed number is itself allowed (`1` on the way to `12`),
 * so refusing keystrokes never stops a reader typing a page that exists.
 */

const WHOLE = /^[1-9][0-9]*$/;

/** Whether `text` may stand in the page field of a `pageCount`-page document: empty, or a page that exists. */
export function isPageInput(text: string, pageCount: number): boolean {
  if (text === '') return true;
  if (!WHOLE.test(text)) return false;
  const n = Number(text);
  return Number.isSafeInteger(n) && n >= 1 && n <= pageCount;
}

/** The page `text` names in a `pageCount`-page document, or `null` when it names none. */
export function resolveGotoPage(text: string, pageCount: number): number | null {
  const trimmed = text.trim();
  return trimmed !== '' && isPageInput(trimmed, pageCount) ? Number(trimmed) : null;
}
