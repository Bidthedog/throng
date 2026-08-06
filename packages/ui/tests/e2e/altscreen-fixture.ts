import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

/**
 * A stand-in for a full-screen program (028 follow-up).
 *
 * The defects being chased only appear while something owns the ALTERNATE screen — the state Claude
 * Code, vim and tmux run in, where the program paints absolutely and is the only authority for what
 * is on screen. The suite cannot depend on a third-party tool, and does not need to: what the tests
 * need is the CONDITIONS, not the program. This writes them.
 *
 * It enters the alt screen, paints numbered marker rows, and then sits reading stdin forever —
 * deliberately WITHOUT redrawing on its own. A program that repaints spontaneously would mask every
 * fault here, because the screen would come back right whatever throng did to it.
 */
export const ALT_MARKER = 'ALTROW';

export interface AltScreenOptions {
  rows?: number;
  /** Negotiate the kitty keyboard protocol, as Claude Code does. */
  kitty?: boolean;
  /** Enable win32-input-mode (DEC private 9001), as PSReadLine does while editing a line. */
  win32Input?: boolean;
}

export function writeAltScreenProgram(root: string, opts: AltScreenOptions = {}): string {
  const rows = opts.rows ?? 5;
  const kitty = opts.kitty ?? false;
  const win32Input = opts.win32Input ?? false;
  const file = join(root, 'altpaint.cjs');
  writeFileSync(
    file,
    `
const out = process.stdout;
// Enter the alternate screen and hide the cursor, as a full-screen program does.
out.write('\\u001b[?1049h');
${kitty ? "// Negotiate the kitty keyboard protocol, as Claude Code does.\nout.write('\\\\u001b[>1u');" : ''}
${win32Input ? "// Enable win32-input-mode, as PSReadLine does while it is editing a line.\nout.write('\\\\u001b[?9001h');" : ''}
function paint() {
  out.write('\\u001b[H\\u001b[2J');
  for (let i = 1; i <= ${rows}; i += 1) {
    out.write('\\u001b[' + i + ';1H' + '${ALT_MARKER}' + i);
  }
}
paint();
// Repaint ONLY when the window changes — exactly what a real full-screen program does, and what
// throng's repaint nudge is designed to provoke.
process.stdout.on('resize', paint);
process.stdin.resume();
process.stdin.setRawMode && process.stdin.setRawMode(true);
process.stdin.on('data', (b) => {
  // Echo nothing. Record the bytes so a test can assert what actually reached the program.
  require('fs').appendFileSync(${JSON.stringify(join(root, 'keys.log'))}, JSON.stringify([...b]) + '\\n');
});
`,
    'utf8',
  );
  return file;
}

/** Turn a panel into a cmd terminal and wait for its prompt. */
export async function makeCmdTerminal(win: Page, panelId: string, marker: string): Promise<void> {
  await win.getByTestId(`panel-type-select-${panelId}`).selectOption('terminal');
  await win.getByTestId('terminal-flavour').selectOption('cmd');
  const confirm = win.getByTestId(`panel-type-confirm-${panelId}`);
  await expect(confirm).toBeEnabled();
  await confirm.click();
  const term = win.getByTestId(`terminal-${panelId}`);
  await expect(term).toBeVisible();
  await expect(term).toContainText(marker, { timeout: 20000 });
}

/** Run the alt-screen stand-in in an already-live terminal and wait for its first paint. */
export async function runAltScreenProgram(win: Page, panelId: string): Promise<void> {
  const term = win.getByTestId(`terminal-${panelId}`);
  await term.click();
  await win.keyboard.type('node altpaint.cjs');
  await win.keyboard.press('Enter');
  await expect(term).toContainText(`${ALT_MARKER}1`, { timeout: 25000 });
  await expect(term).toContainText(`${ALT_MARKER}5`, { timeout: 25000 });
}
