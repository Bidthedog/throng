/**
 * 053 — a session's window title, followed through its output (OSC 0 and OSC 2).
 *
 * A view learns a terminal's title only from the sequence that set it. A view re-attaching to a running
 * session rebuilds its screen from a bounded tail of output — empty while a program holds the alternate
 * screen — so a title set before the tail began never reaches it. The daemon reads every byte, so it
 * follows the title here and hands it to every view that attaches.
 *
 * Pure. A sequence split across chunks is carried, bounded, into the next.
 */

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);
const OSC = `${ESC}]`;
/** A complete OSC 0 or OSC 2, ended by BEL or ST; group 1 is the title. */
const TITLE = new RegExp(`${ESC}\\][02];([^${BEL}${ESC}]*)(?:${BEL}|${ESC}\\\\)`, 'g');
/** Longest unterminated sequence carried into the next chunk; a longer one is never a title worth waiting for. */
const MAX_CARRY = 1024;

export interface WindowTitleScan {
  /** The last title set; `''` when none, or when it was cleared. */
  title: string;
  /** An unterminated sequence at the end of the last chunk, read again with the next. */
  carry: string;
}

export function createWindowTitleScan(): WindowTitleScan {
  return { title: '', carry: '' };
}

export function scanWindowTitle(scan: WindowTitleScan, chunk: string): WindowTitleScan {
  const text = scan.carry + chunk;
  let title = scan.title;
  let end = 0;
  for (const m of text.matchAll(TITLE)) {
    title = m[1] ?? '';
    end = m.index + m[0].length;
  }
  // Carry from the last sequence opener (or a lone trailing ESC) that nothing has closed yet.
  let carry = '';
  const opener = Math.max(text.lastIndexOf(OSC), text.endsWith(ESC) ? text.length - 1 : -1);
  if (opener >= end) {
    const rest = text.slice(opener);
    const closed = rest.includes(BEL) || rest.slice(1).includes(ESC);
    if (!closed && rest.length <= MAX_CARRY) carry = rest;
  }
  return { title, carry };
}

