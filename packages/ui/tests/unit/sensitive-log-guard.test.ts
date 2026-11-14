import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 068 FR-034b (review) — text the user typed or ran is free text no pattern can recognise, so a log
 * call that interpolates it must mark it with `sensitive(...)` (core `diagnostics/anonymise.ts`).
 * This guards the families the sweep found: a raw protocol line cut with `line.slice(` inside a log
 * message, the agent's `argv` (which carries the anonymiser salt), and a start request's command.
 */
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGES = join(REPO, 'packages');

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'dist') sources(path, out);
    } else if (/\.(ts|tsx|cts|mts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

/** Interpolations that put raw user text or the salt into a message, each with why it is banned. */
const BANNED: ReadonlyArray<[RegExp, string]> = [
  [/\$\{\s*line\.slice\(/, 'a raw protocol line (keystrokes, commands) interpolated into a log message'],
  [/\$\{\s*JSON\.stringify\(\s*process\.argv\s*\)/, 'argv carries the anonymiser salt'],
  [/file=\$\{\s*msg\.file\s*\}/, "the user's command interpolated into a log message"],
  [/args=\$\{\s*JSON\.stringify\(\s*msg\.args\s*\)/, "the user's command arguments interpolated into a log message"],
];

describe('068 FR-034b — logged user text is marked sensitive', () => {
  it('finds no raw command, protocol line or salt interpolated into a log message', () => {
    const hits: string[] = [];
    for (const pkg of readdirSync(PACKAGES, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      let files: string[];
      try {
        files = sources(join(PACKAGES, pkg.name, 'src'));
      } catch {
        continue;
      }
      for (const file of files) {
        const text = readFileSync(file, 'utf8');
        for (const [pattern, why] of BANNED) {
          if (pattern.test(text)) hits.push(`${relative(REPO, file)}: ${why}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });
});
