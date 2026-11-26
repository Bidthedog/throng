/**
 * 080 FR-010, FR-011, SC-001 — F1 opens the guide from every throng window, and a browser that will not open is
 * reported in the window that asked.
 *
 * The main and sub-workspace windows get both from the window dispatcher and `app.tsx`. Each other window kind is
 * its own React root (`renderer/main.tsx` routes them), with no dispatcher, so each must mount `useHelpKey` and the
 * failed-open notice itself. `use-help-key.test.ts` and `open-external-failed-notice.test.ts` prove what those do;
 * this proves no window kind is left without them, which a new window kind would otherwise silently be.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const RENDERER = join(process.cwd(), 'packages', 'ui', 'src', 'renderer');

/** Every window kind `main.tsx` mounts besides the workspace windows. */
const WINDOWS = [
  'preferences/preferences-app.tsx',
  'resources/monitor-app.tsx',
  'about/about-app.tsx',
  'help/help-app.tsx',
  'print-preview/print-preview-app.tsx',
];

describe('Help from every throng window (080 FR-010, FR-011)', () => {
  it('names every window kind main.tsx mounts', () => {
    const main = readFileSync(join(RENDERER, 'main.tsx'), 'utf8');
    const apps = [...main.matchAll(/import\('\.\/([^']+)\.js'\)/g)].map((m) => `${m[1]}.tsx`);
    expect(apps.filter((a) => !a.startsWith('composition-root')).sort()).toEqual([...WINDOWS].sort());
  });

  it.each(WINDOWS)('%s opens Help with F1 and reports a failed open', (file) => {
    const source = readFileSync(join(RENDERER, file), 'utf8');
    expect(source, 'mounts useHelpKey()').toMatch(/\buseHelpKey\(\)/);
    expect(source, 'renders <OpenExternalFailedNotice />').toMatch(/<OpenExternalFailedNotice\s*\/>/);
  });

  // 080 FR-070 — main asks the window a link was followed in, so a window kind with no host would leave its links
  // waiting on an answer nobody can give.
  it.each([...WINDOWS, 'app.tsx', 'composition-root.tsx'])('%s shows the external-link prompt inline', (file) => {
    expect(readFileSync(join(RENDERER, file), 'utf8'), 'renders <LinkPromptHost />').toMatch(/<LinkPromptHost\s*\/>/);
  });
});
