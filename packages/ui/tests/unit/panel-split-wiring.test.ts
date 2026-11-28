/**
 * 048 FR-015, amended by the v1 review (#732) — no panel body menu is handed `split` at its call site: Split is the
 * panel title menu's alone. The terminal, the preview and the Find in Files panel build their menus inside components
 * that need xterm, a preview run and a scan to mount, so what this file asserts is a fact about the source text.
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

describe('no panel body menu is handed the Split argument (048 FR-015, amended by the v1 review, #732)', () => {
  // Split is the title menu's alone now: it acts on the panel, not on the content under the pointer.
  it.each([
    ['editor/use-editor.ts', 'editorContentMenu'],
    ['terminal/terminal-panel.tsx', 'terminalContentMenu'],
    ['preview/preview-panel.tsx', 'previewContentMenu'],
  ] as const)('%s hands %s no `split`', (file, builder) => {
    expect(callOf(file, builder)).not.toMatch(/\bsplit:/);
  });

  // The rows that moved to the title menu read the body's state through this registration (v1 review, #732).
  it.each(['editor/use-editor.ts', 'terminal/terminal-panel.tsx', 'preview/preview-panel.tsx'])('%s registers its title-menu extras', (file) => {
    expect(readFileSync(resolve(RENDERER, file), 'utf8')).toMatch(/registerPanelTitleExtras\((panel\.id|panelId),/);
  });

  // 060 FR-042 supersedes 048 FR-015 for the Find in Files body menu: Split is the panel header's there.
  it('find-in-files/find-in-files-panel.tsx hands findInFilesContentMenu no `split` (060 FR-042)', () => {
    expect(callOf('find-in-files/find-in-files-panel.tsx', 'findInFilesContentMenu')).not.toMatch(/\bsplit:/);
  });
});
