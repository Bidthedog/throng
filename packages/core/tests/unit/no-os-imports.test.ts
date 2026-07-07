import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { builtinModules } from 'node:module';
import { describe, it, expect } from 'vitest';

// SC-010 structural guard: the platform-agnostic core MUST NOT import OS,
// Electron, or Node process/OS APIs. Concrete OS calls live only in
// platform-* packages behind the IPlatformInfo contract (Principle II).

const coreSrcDir = fileURLToPath(new URL('../../src', import.meta.url));

const NODE_BUILTINS = new Set(builtinModules);

/** A module specifier is forbidden in core if it reaches OS/process/Electron APIs. */
function isForbidden(specifier: string): boolean {
  if (specifier === 'electron' || specifier.startsWith('electron/')) return true;
  if (specifier.startsWith('node:')) return true;
  if (NODE_BUILTINS.has(specifier)) return true;
  return false;
}

const IMPORT_RE = /\b(?:import|export)\b[^'"]*?from\s*['"]([^'"]+)['"]/g;
const BARE_IMPORT_RE = /\bimport\s*['"]([^'"]+)['"]/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]/g;
const REQUIRE_RE = /\brequire\s*\(\s*['"]([^'"]+)['"]/g;

async function collectTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      files.push(...(await collectTsFiles(full)));
    } else if (entry.name.endsWith('.ts')) {
      files.push(full);
    }
  }
  return files;
}

function findForbiddenSpecifiers(source: string): string[] {
  const found = new Set<string>();
  for (const re of [IMPORT_RE, BARE_IMPORT_RE, DYNAMIC_IMPORT_RE, REQUIRE_RE]) {
    re.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(source)) !== null) {
      const specifier = match[1];
      if (isForbidden(specifier)) found.add(specifier);
    }
  }
  return [...found];
}

describe('core OS-isolation guard', () => {
  it('detects forbidden specifiers, including dynamic import() and require() (self-check)', () => {
    const sample = [
      "import os from 'node:os';",
      "import { app } from 'electron';",
      "import fs from 'fs';",
      "const cp = require('child_process');",
      "const p = await import('node:path');",
    ].join('\n');
    expect(findForbiddenSpecifiers(sample).sort()).toEqual([
      'child_process',
      'electron',
      'fs',
      'node:os',
      'node:path',
    ]);
  });

  it('core/src imports no OS, Electron, or Node builtin APIs', async () => {
    const files = await collectTsFiles(coreSrcDir);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      for (const specifier of findForbiddenSpecifiers(source)) {
        violations.push(`${file} -> ${specifier}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('covers the 002 domain directories (projects, workspace, ports, abstractions)', async () => {
    // The guard scans core/src recursively, so the new docking/project domain
    // (which must stay OS-free, research D1) is automatically in scope. Assert
    // each expected directory is actually represented so coverage can't silently
    // regress if the scan ever changes (T004).
    const files = (await collectTsFiles(coreSrcDir)).map((f) => f.replace(/\\/g, '/'));
    for (const dir of ['/projects/', '/workspace/', '/ports/', '/abstractions/', '/config/']) {
      expect(files.some((f) => f.includes(dir))).toBe(true);
    }
  });
});
