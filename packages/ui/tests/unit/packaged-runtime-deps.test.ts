import { readdirSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 020 T049 / FR-009 — packaging dependency-resolution guard.
 *
 * The installed app crashed TWICE this feature because electron-builder prunes node_modules to the
 * ROOT package.json's production-dependency closure: first the `@throng/*` workspace symlinks were
 * dropped, then the workspace libraries' own third-party deps (`picomatch`, `@codemirror/state`)
 * were pruned — and the app died at startup with ERR_MODULE_NOT_FOUND. It shipped green because the
 * verify harness's launch step never booted a real window (now fixed).
 *
 * This guard makes that class of regression impossible to reintroduce silently: every third-party
 * module imported as a BARE specifier by the NON-BUNDLED runtime code — the UI main + preload, the
 * daemon, and the `@throng/*` libraries — MUST be declared in the root `package.json` dependencies,
 * so electron-builder keeps it. The renderer is Vite-bundled, so its imports (react, @codemirror,
 * @xterm, …) are inlined and deliberately NOT scanned.
 */

const root = fileURLToPath(new URL('../../../../', import.meta.url));

// The code that ships as plain files and resolves from node_modules at runtime (NOT bundled).
const NON_BUNDLED_DIRS = [
  'packages/core/src',
  'packages/ipc-contract/src',
  'packages/persistence/src',
  'packages/platform-windows/src',
  'packages/daemon/src',
  'packages/ui/src/main',
  'packages/ui/src/preload',
];

// `electron` is provided by the Electron runtime; `@throng/*` are the workspace libraries, mapped
// into node_modules by electron-builder's files/from-to (electron-builder.yml).
function isRuntimeThirdParty(spec: string): boolean {
  if (spec.startsWith('.') || spec.startsWith('node:')) return false;
  if (isBuiltin(spec)) return false;
  if (spec === 'electron') return false;
  if (spec.startsWith('@throng/')) return false;
  return true;
}

/** The npm package name of a bare specifier (`@scope/pkg/sub` → `@scope/pkg`, `pkg/sub` → `pkg`). */
function packageName(spec: string): string {
  const parts = spec.split('/');
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

const IMPORT_RE = /(?:from|import|require)\s*\(?\s*["']([^"']+)["']/g;

function collectImports(absDir: string, found: Set<string>): void {
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(absDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const p = join(absDir, e.name);
    // Skip test support that is never loaded at runtime (it imports vitest, a devDependency).
    if (e.isDirectory()) {
      if (e.name === 'tests' || e.name === 'testing') continue;
      collectImports(p, found);
    } else if (/\.(ts|tsx|cts|mts|js|cjs|mjs)$/.test(e.name) && !/\.test\./.test(e.name)) {
      const text = readFileSync(p, 'utf8');
      for (const m of text.matchAll(IMPORT_RE)) {
        if (isRuntimeThirdParty(m[1])) found.add(packageName(m[1]));
      }
    }
  }
}

describe('packaged runtime dependencies are declared at the root (020 T049 / FR-009)', () => {
  it('every bare third-party import in non-bundled runtime code is a root dependency', () => {
    const rootDeps = new Set(
      Object.keys(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).dependencies ?? {}),
    );
    const imported = new Set<string>();
    for (const dir of NON_BUNDLED_DIRS) collectImports(join(root, dir), imported);

    // Sanity: the scan actually found the known runtime deps (so a broken scan can't pass vacuously).
    expect(imported.has('picomatch')).toBe(true);
    expect(imported.has('better-sqlite3')).toBe(true);

    const undeclared = [...imported].filter((name) => !rootDeps.has(name)).sort();
    expect(
      undeclared,
      `these packages are imported by non-bundled runtime code but are NOT in the root ` +
        `package.json "dependencies", so electron-builder will prune them and the installed app ` +
        `will crash at startup: ${undeclared.join(', ')}`,
    ).toEqual([]);
  });
});

/**
 * 020 T048 / FR-041 — packaging adds NO outbound network call to the application (auto-update is out
 * of scope). This guard scans the feature's app-runtime source for network APIs so a future "just
 * fetch the latest version" cannot slip in unnoticed.
 */
describe('the packaging feature makes no outbound network call (020 T048 / FR-041)', () => {
  const FILES = [
    'packages/core/src/config/pipe-endpoint.ts',
    'packages/core/src/config/product-version.ts',
    'packages/core/src/config/publish-gate.ts',
    'packages/core/src/config/verification-verdict.ts',
    'packages/core/src/config/install-handoff.ts',
    'packages/ui/src/main/about-window.ts',
    'packages/ui/src/main/app-menu.ts',
    'packages/ui/src/main/daemon-lifecycle.ts',
    'packages/ui/src/renderer/about/about-app.tsx',
  ];
  // OUTBOUND network only: fetch/XHR, and the node HTTP client modules. Local named-pipe IPC
  // (`node:net`) is how the UI talks to its own daemon — that is not an outbound call and is allowed.
  const NETWORK_RE = /\bfetch\s*\(|\bXMLHttpRequest\b|\bhttps?\.(get|request)\b|['"]node:https?['"]/;

  it('none of the feature\'s app-runtime files make a network request', () => {
    const offenders = FILES.filter((f) => {
      try {
        return NETWORK_RE.test(readFileSync(join(root, f), 'utf8'));
      } catch {
        return false;
      }
    });
    expect(offenders, `network calls found in: ${offenders.join(', ')}`).toEqual([]);
  });
});
