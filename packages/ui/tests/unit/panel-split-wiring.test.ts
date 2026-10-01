/**
 * 048 FR-015 — every panel content menu is handed `split`, at the call site.
 *
 * `menu-sections.test.ts` proves each BUILDER draws the Split row when it is given `split`, and
 * `component/panel-content-split.test.ts` drives the placeholder and the editor for real. The terminal,
 * the preview and the Find in Files panel build their menus inside components that need xterm, a preview
 * run and a scan to mount — so the one thing left to assert about them is that the call site passes the
 * argument, and that is a fact about the source text.
 *
 * ANTI-VACUITY: each assertion first finds the call, so a rename of a builder fails loudly instead of
 * passing on an empty search.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = resolve(__dirname, '../../src/renderer');

/** The text of the `builder({ ... })` call, from its opening to the matching close brace. */
function callOf(file: string, builder: string): string {
  const source = readFileSync(resolve(RENDERER, file), 'utf8');
  const start = source.indexOf(`${builder}({`);
  expect(start, `${file} no longer calls ${builder}({…})`).toBeGreaterThanOrEqual(0);
  let depth = 0;
  for (let i = start + builder.length + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') depth++;
    if (ch === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  throw new Error(`${file}: unbalanced call to ${builder}`);
}

describe('panel content menus are handed the Split argument (048 FR-015)', () => {
  it.each([
    ['editor/use-editor.ts', 'editorContentMenu'],
    ['terminal/terminal-panel.tsx', 'terminalContentMenu'],
    ['preview/preview-panel.tsx', 'previewContentMenu'],
    ['find-in-files/find-in-files-panel.tsx', 'findInFilesContentMenu'],
  ] as const)('%s passes `split: { panelId… }` to %s', (file, builder) => {
    const call = callOf(file, builder);
    expect(call).toMatch(/\bsplit:\s*\{[^}]*panelId/);
    expect(call).toMatch(/keybindings/);
  });
});
