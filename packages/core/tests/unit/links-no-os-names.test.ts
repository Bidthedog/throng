import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 045 FR-026 / FR-039a, Principle II — a structural guard beside `no-os-imports.test.ts`.
 *
 * That one stops core IMPORTING an OS API. This one stops core KNOWING an OS fact without
 * importing anything: an extension list, a drive-letter mapping, a `PATHEXT`. Both failures look
 * identical from outside — the rules quietly stop being portable — but only the first is an import,
 * so the first guard cannot see the second.
 *
 * ══ COMMENTS ARE STRIPPED FIRST, ON PURPOSE ══
 *
 * The rule is that core may not ACT on an OS fact, not that it may not EXPLAIN why it refuses to.
 * `default-action.ts` earns its keep by saying out loud that a click on a downloaded `setup.exe`
 * must not run it; a guard that banned the word would make the file less clear in order to look
 * more portable, which is the wrong trade and the reason a grep over raw source was not used here.
 * A `.exe` in code is still a violation, and the self-check below proves the stripper does not
 * swallow one.
 */

const linksDir = fileURLToPath(new URL('../../src/links', import.meta.url));

/**
 * Extensions core must never name: it asks `IExecutableExtensions` instead (FR-039a).
 *
 * Matched with a trailing boundary rather than as a bare substring, because `.exe` is also the
 * start of `.exec` and of `.executable` — and a guard that fires on those teaches the next author
 * to rename a property to get a green bar, which is the opposite of what it is for.
 */
const FORBIDDEN_EXTENSIONS = ['exe', 'bat', 'cmd', 'ps1', 'lnk', 'msi', 'com', 'vbs', 'scr', 'cpl', 'hta'];

/**
 * A drive-letter mapping, in the shapes it would take: the `X:\` spelling a mapping PRODUCES (a
 * colon followed by a literal backslash — `:\/` in a URL scheme regex is not one), and the prefixes
 * it would CONSUME. `IPathForms.fromDriveForm` owns all of them (FR-025).
 */
const FORBIDDEN_MAPPINGS = [/:\\\\/, /\/mnt\//i, /cygdrive/i];

const FORBIDDEN_IMPORTS = ['node:path', 'node:os', 'node:fs'];

/** Remove block and line comments, keeping offsets irrelevant — only the presence of text matters. */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  let inBlock = false;
  let inLine = false;
  let inString: string | null = null;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (inBlock) {
      if (two === '*/') {
        inBlock = false;
        i += 2;
        continue;
      }
      i += 1;
      continue;
    }
    if (inLine) {
      if (source[i] === '\n') {
        inLine = false;
        out += '\n';
      }
      i += 1;
      continue;
    }
    if (inString) {
      if (source[i] === '\\') {
        out += source.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (source[i] === inString) inString = null;
      out += source[i];
      i += 1;
      continue;
    }
    if (two === '/*') {
      inBlock = true;
      i += 2;
      continue;
    }
    if (two === '//') {
      inLine = true;
      i += 2;
      continue;
    }
    if (source[i] === "'" || source[i] === '"' || source[i] === '`') {
      inString = source[i];
    }
    out += source[i];
    i += 1;
  }
  return out;
}

async function collect(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) files.push(...(await collect(full)));
    else if (entry.name.endsWith('.ts')) files.push(full);
  }
  return files;
}

function violationsIn(code: string): string[] {
  const found: string[] = [];
  if (/PATHEXT/i.test(code)) found.push('PATHEXT');
  for (const ext of FORBIDDEN_EXTENSIONS) {
    if (new RegExp(`\\.${ext}(?![A-Za-z0-9])`, 'i').test(code)) found.push(`.${ext}`);
  }
  for (const mapping of FORBIDDEN_MAPPINGS) {
    if (mapping.test(code)) found.push(mapping.source);
  }
  for (const specifier of FORBIDDEN_IMPORTS) {
    if (code.includes(specifier)) found.push(specifier);
  }
  return found;
}

describe('core/src/links names no operating system (FR-026, FR-039a)', () => {
  it('self-check: the stripper removes comments and keeps code', () => {
    const sample = [
      '/* a comment naming .exe and PATHEXT */',
      "// another naming C:\\ and /mnt/d",
      "const ext = '.exe';",
    ].join('\n');
    const code = stripComments(sample);
    expect(code).not.toContain('a comment naming');
    expect(code).toContain("const ext = '.exe';");
    expect(violationsIn(code)).toContain('.exe');
  });

  it('self-check: a drive mapping and an OS import are both caught', () => {
    expect(violationsIn(stripComments("const p = letter + ':\\\\';")).length).toBeGreaterThan(0);
    expect(violationsIn(stripComments("import { join } from 'node:path';"))).toContain('node:path');
  });

  it('self-check: ordinary JavaScript that merely LOOKS like a violation is not one', () => {
    // `.exec` and `.executable` start with `.exe`; a URL scheme regex contains `:\/`. None of the
    // three is an OS fact, and a guard that fired on them would be gamed by renaming a property.
    expect(violationsIn('const m = RE.exec(s); if (link.executable) return 1;')).toEqual([]);
    expect(violationsIn('const S = /^[A-Za-z][A-Za-z0-9+.-]*:\\/\\//;')).toEqual([]);
  });

  it('the folder actually exists and holds the modules this feature added', () => {
    // A guard that scans nothing passes for the wrong reason.
    return collect(linksDir).then((files) => {
      const names = files.map((f) => f.slice(f.lastIndexOf('/') + 1)).sort();
      expect(names).toEqual(
        expect.arrayContaining([
          'classify.ts',
          'default-action.ts',
          'detect.ts',
          'menu.ts',
          'resolve.ts',
          'targets.ts',
          'types.ts',
        ]),
      );
    });
  });

  it('no module under core/src/links names an extension, a drive mapping or an OS module', async () => {
    const files = await collect(linksDir);
    const offenders: string[] = [];
    for (const file of files) {
      const found = violationsIn(stripComments(await readFile(file, 'utf8')));
      if (found.length > 0) offenders.push(`${file} -> ${found.join(', ')}`);
    }
    expect(offenders).toEqual([]);
  });
});
