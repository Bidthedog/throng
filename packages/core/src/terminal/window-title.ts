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

/**
 * Titles a shell sets for itself (053 FR-003): Git Bash's prompt (`MINGW64:/d/git/throng`, and the
 * other MSYS2 environments), and a program's own path — how cmd, PowerShell and Windows PowerShell
 * title their window, cmd with ` - <command>` while one runs, either with `Administrator: ` first.
 * Shared by the renderer's `{title}` (053) and the daemon's account of what a terminal is doing (057 FR-102).
 */
const SHELL_TITLE = /^(?:(?:MINGW(?:32|64)|MSYS|UCRT64|CLANG(?:32|64|ARM64)):|(?:Administrator: )?[A-Za-z]:\\[^"]*?\.(?:exe|com)(?: - |$))/i;

export function isShellTitle(title: string): boolean {
  return SHELL_TITLE.test(title);
}

/**
 * Whether `title` is the running program's own (053 `{title}`, 057 FR-102): not empty, not one of
 * {@link isShellTitle}'s forms, and not the title the prompt showed — `promptTitle`, read at the last
 * observation that saw nothing running — nor cmd's `<that> - <command>`. The caller decides that a command
 * is running; with none, every title is the shell's.
 */
export function isProgramTitle(title: string, promptTitle: string | undefined): boolean {
  if (title === '' || isShellTitle(title)) return false;
  return !(promptTitle !== undefined && promptTitle !== '' && (title === promptTitle || title.startsWith(`${promptTitle} - `)));
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

