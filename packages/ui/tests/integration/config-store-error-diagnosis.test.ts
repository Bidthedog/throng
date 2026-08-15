import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileConfigStore } from '../../src/main/config-store.js';

/**
 * 032 (#265) — a failed config write says what is ACTUALLY wrong, and names the file the user knows.
 *
 * ══ TWO WRONG MESSAGES, IN ORDER ══
 *
 * First:
 *
 *     Saving your settings failed. "settings.json.2.tmp" is open in another program.
 *
 * The atomic write stages to `<name>.N.tmp` and renames it into place; Node's rename error quotes
 * the SOURCE first, and every consumer downstream lifts the first quoted path as its subject. So
 * throng's own scratch file — which the user has never seen and cannot act on — became the headline.
 *
 * Then, with the name fixed:
 *
 *     Saving your settings failed. "settings.json" is open in another program.
 *
 * It was not open in another program. It was a folder. EPERM is the one genuinely ambiguous errno on
 * Windows — a held handle, an ACL refusal, and replacing a directory with a file all produce it —
 * and the renderer's string classifier maps it straight to `held`. Confidently, specifically wrong
 * is worse than vague: a user who believes it goes hunting for a program that does not exist.
 *
 * ══ THE FIX ══
 *
 * Guessing better is still guessing. The store is the only layer still holding the path, so on
 * failure it LOOKS. A specific accurate answer where one is available; an honest ambiguous one that
 * names both possibilities where it genuinely is not.
 *
 * And `error` and `detail` are now separate fields. One string could not be both a sentence fit for
 * a human and a record fit for a log — which is exactly how the staging path reached the screen in
 * the first place.
 */
const tempDirs: string[] = [];
function freshRoot(): string {
  const dir = mkdtempSync(join(tmpdir(), 'throng-diag-'));
  tempDirs.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** The failure the user actually hit: the target is a folder, so the rename is refused. */
function obstruct(root: string, name: string): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, 'blocker.txt'), 'x', 'utf8');
}

describe('the message the user reads', () => {
  it('says the target is a folder, rather than claiming it is open in another program', async () => {
    const root = freshRoot();
    obstruct(root, 'settings.json');

    const res = await new FileConfigStore(root).write({ kind: 'settings' }, { version: 1 });
    expect(res.ok).toBe(false);
    const error = res.ok ? '' : res.error;

    expect(error, 'it must say what is actually wrong').toMatch(/folder/i);
    expect(
      error,
      'it must not assert a cause it cannot distinguish — the file is not open at all',
    ).not.toMatch(/open in another program/i);
  });

  it('names the document the user knows, never the staging file', async () => {
    const root = freshRoot();
    obstruct(root, 'keybindings.json');

    const res = await new FileConfigStore(root).write(
      { kind: 'keybindings' },
      { version: 1, bindings: {} },
    );
    const error = res.ok ? '' : res.error;

    expect(error).toContain('keybindings.json');
    expect(error, "throng's scratch file must never appear in a sentence").not.toContain('.tmp');
  });

  it('carries no errno and no absolute path — those belong in the copy', async () => {
    // 029's rule for this surface. The sentence is for the user; the machinery is for the log.
    const root = freshRoot();
    obstruct(root, 'settings.json');

    const res = await new FileConfigStore(root).write({ kind: 'settings' }, { version: 1 });
    const error = res.ok ? '' : res.error;

    expect(error).not.toMatch(/EPERM|EACCES|EBUSY|ENOENT/);
    expect(error, 'no drive-letter path in the sentence').not.toMatch(/[A-Za-z]:\\/);
  });
});

describe('the detail a bug report is reconstructed from', () => {
  it('keeps the errno and the real staging path', async () => {
    /*
     * The user's own framing: "There is no harm using it as additional context (esp in the copied /
     * logged error)". The staging path is genuine debugging information about the write itself — it
     * simply is not the headline.
     */
    const root = freshRoot();
    obstruct(root, 'settings.json');

    const res = await new FileConfigStore(root).write({ kind: 'settings' }, { version: 1 });
    expect(res.ok).toBe(false);
    const detail = res.ok ? '' : (res.detail ?? '');

    expect(detail, 'the errno survives for whoever debugs the write').toMatch(/EPERM|EACCES|EBUSY/);
    expect(detail, 'and so does the staging path').toContain('.tmp');
  });
});
