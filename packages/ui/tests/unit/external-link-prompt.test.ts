import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { IShellIntegration } from '@throng/core';
import { describe, expect, it, vi } from 'vitest';

import { withExternalLinkPrompt, type LinkPromptAnswer } from '../../src/main/external-link-prompt.js';

/**
 * 080 FR-063 — every external link passes one gate before the OS sees it. With the setting on, the user is asked
 * and only Open opens; with it off, the link opens at once. One prompt at a time: a link followed while one is
 * open is dropped and the open prompt comes forward. Nothing else on the seam is touched.
 */
function fakeShell(): IShellIntegration & { opened: string[] } {
  const opened: string[] = [];
  return {
    opened,
    revealInFileManager: vi.fn(async () => ({ ok: true as const })),
    openFolder: vi.fn(async () => {}),
    openExternal: vi.fn(async (url: string) => {
      opened.push(url);
    }),
    openWithDefaultProgram: vi.fn(async () => ({ ok: true as const })),
  };
}

/**
 * The gate covers every route only while nothing in main reaches Electron's `shell.openExternal` except the seam
 * itself, and while main.ts hands every consumer the wrapped seam. A source guard, as `window-parent-tdz` is.
 */
describe('nothing bypasses the external-link prompt (080 FR-063)', () => {
  const MAIN_DIR = join(__dirname, '../../src/main');

  it('calls Electron shell.openExternal only inside the shell seam', () => {
    const offenders = readdirSync(MAIN_DIR)
      .filter((f) => f.endsWith('.ts') && f !== 'electron-shell-integration.ts')
      .filter((f) => {
        const src = readFileSync(join(MAIN_DIR, f), 'utf8');
        const importsShell = [...src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'electron'/g)].some((m) => /\bshell\b/.test(m[1] ?? ''));
        return importsShell && /\bshell\.openExternal\(/.test(src);
      });
    expect(offenders).toEqual([]);
  });

  it('wraps the app shell integration once, where main builds it', () => {
    const main = readFileSync(join(MAIN_DIR, 'main.ts'), 'utf8');
    expect(main).toMatch(/const baseShellIntegration = createAppShellIntegration\(shell\);/);
    expect(main).toMatch(/const shellIntegration = withExternalLinkPrompt\(baseShellIntegration,/);
    expect(main.match(/createAppShellIntegration\(/g)).toHaveLength(1);
  });
});

describe('withExternalLinkPrompt (080 FR-063)', () => {
  it('opens at once, unasked, while the setting is off', async () => {
    const inner = fakeShell();
    const ask = vi.fn(async (): Promise<LinkPromptAnswer> => 'open');
    const shell = withExternalLinkPrompt(inner, { enabled: () => false, ask, focusPrompt: vi.fn() });
    await shell.openExternal('https://example.com/');
    expect(ask).not.toHaveBeenCalled();
    expect(inner.opened).toEqual(['https://example.com/']);
  });

  it('asks with the URL, and opens only on Open', async () => {
    const inner = fakeShell();
    const ask = vi.fn(async (): Promise<LinkPromptAnswer> => 'open');
    const onOpen = vi.fn();
    const shell = withExternalLinkPrompt(inner, { enabled: () => true, ask, focusPrompt: vi.fn(), onOpen });
    await shell.openExternal('https://example.com/a');
    expect(ask).toHaveBeenCalledExactlyOnceWith('https://example.com/a');
    expect(onOpen).toHaveBeenCalledOnce();
    expect(inner.opened).toEqual(['https://example.com/a']);
  });

  it('opens nothing on Cancel, and resolves rather than failing', async () => {
    const inner = fakeShell();
    const shell = withExternalLinkPrompt(inner, { enabled: () => true, ask: async () => 'cancel', focusPrompt: vi.fn() });
    await expect(shell.openExternal('https://example.com/b')).resolves.toBeUndefined();
    expect(inner.opened).toEqual([]);
  });

  it('drops a link followed while a prompt is open, and brings that prompt forward', async () => {
    const inner = fakeShell();
    let answer: (a: LinkPromptAnswer) => void = () => {};
    const ask = vi.fn(() => new Promise<LinkPromptAnswer>((resolve) => (answer = resolve)));
    const focusPrompt = vi.fn();
    const shell = withExternalLinkPrompt(inner, { enabled: () => true, ask, focusPrompt });
    const first = shell.openExternal('https://example.com/1');
    await shell.openExternal('https://example.com/2');
    expect(ask).toHaveBeenCalledOnce();
    expect(focusPrompt).toHaveBeenCalledOnce();
    answer('open');
    await first;
    expect(inner.opened).toEqual(['https://example.com/1']);
    // The gate is free again once the prompt is answered.
    const third = shell.openExternal('https://example.com/3');
    answer('open');
    await third;
    expect(inner.opened).toEqual(['https://example.com/1', 'https://example.com/3']);
  });

  it('reads the setting on every link, so turning it off takes effect at once', async () => {
    const inner = fakeShell();
    let on = true;
    const ask = vi.fn(async (): Promise<LinkPromptAnswer> => 'cancel');
    const shell = withExternalLinkPrompt(inner, { enabled: () => on, ask, focusPrompt: vi.fn() });
    await shell.openExternal('https://example.com/x');
    on = false;
    await shell.openExternal('https://example.com/y');
    expect(ask).toHaveBeenCalledOnce();
    expect(inner.opened).toEqual(['https://example.com/y']);
  });

  it('passes every other seam call straight through', async () => {
    const inner = fakeShell();
    const shell = withExternalLinkPrompt(inner, { enabled: () => true, ask: async () => 'cancel', focusPrompt: vi.fn() });
    await shell.openFolder('/p');
    await shell.revealInFileManager('/p/f');
    await shell.openWithDefaultProgram('/p/f');
    expect(inner.openFolder).toHaveBeenCalledWith('/p');
    expect(inner.revealInFileManager).toHaveBeenCalledWith('/p/f');
    expect(inner.openWithDefaultProgram).toHaveBeenCalledWith('/p/f');
  });
});
