import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * A setting's Help: its section in `docs/preferences.md`, which the row's (?) opens (080 FR-013, FR-016).
 *
 * The maintainer's v1 review (#732) keeps a setting's description to what it does, in one line, and moves the
 * rest to Help. A requirement that the user be TOLD something about a setting is met by either, so a test that
 * pins such a fact reads this: the section's text after its key line, up to the next heading.
 */
const PREFERENCES = fileURLToPath(new URL('../../../../docs/preferences.md', import.meta.url));

export function settingHelp(key: string): string {
  const lines = readFileSync(PREFERENCES, 'utf8').split(/\r?\n/);
  const at = lines.findIndex((l) => l.trim() === `\`${key}\``);
  if (at < 0) throw new Error(`docs/preferences.md has no section for ${key}`);
  let end = at + 1;
  while (end < lines.length && !/^#{1,6} /.test(lines[end] as string)) end += 1;
  return lines.slice(at + 1, end).join('\n');
}
