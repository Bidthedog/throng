import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Issue #82 — `npm run typecheck` MUST cover the code that ships.
 *
 * The bug: `typecheck` ran `tsc -b`, which walks the project references, and
 * `packages/ui/tsconfig.json` includes only `src/main`/`src/preload`. The entire renderer
 * (`src/renderer`, every `.tsx`, the whole editor + preferences UI) is built by Vite, which
 * strips types without checking them — so a renderer type error compiled, shipped, and threw
 * at runtime with a GREEN `typecheck` and a green CI. One had already slipped through.
 *
 * This guard is shaped like the requirement — "one command checks everything that ships" —
 * not like the change. It asserts the three structural facts that, together, make a renderer
 * type error fail the gate: the gate runs the renderer check; that check targets the renderer
 * tsconfig; and that tsconfig actually compiles `src/renderer` as a real (no-emit) check. Undo
 * any one of them — the exact regression #82 was — and this reddens.
 *
 * The behaviour itself (a deliberately-introduced renderer `.tsx` error fails `npm run
 * typecheck`) is verified live at merge; encoding it here would mean spawning `tsc` per run,
 * trading this fast, deterministic guard for a slow, flake-prone one.
 */

const ROOT_PKG = fileURLToPath(new URL('../../../../package.json', import.meta.url));
const RENDERER_TSCONFIG = fileURLToPath(new URL('../../tsconfig.renderer.json', import.meta.url));

interface PackageJson {
  scripts?: Record<string, string>;
}
interface TsConfig {
  include?: string[];
  compilerOptions?: { noEmit?: boolean };
}

const pkg = JSON.parse(readFileSync(ROOT_PKG, 'utf8')) as PackageJson;
const rendererTsconfig = JSON.parse(readFileSync(RENDERER_TSCONFIG, 'utf8')) as TsConfig;

describe('#82 — the typecheck gate covers the shipping renderer', () => {
  it('`npm run typecheck` runs the renderer check', () => {
    const typecheck = pkg.scripts?.typecheck ?? '';
    expect(
      typecheck,
      `root "typecheck" script does not run the renderer check — it is "${typecheck}". ` +
        'A renderer type error would ship with a green gate (issue #82).',
    ).toMatch(/typecheck:renderer|tsconfig\.renderer\.json/);
  });

  it('the renderer check targets the renderer tsconfig', () => {
    expect(pkg.scripts?.['typecheck:renderer'] ?? '').toContain('tsconfig.renderer.json');
  });

  it('the renderer tsconfig compiles src/renderer as a real, no-emit check', () => {
    expect(
      rendererTsconfig.include ?? [],
      'tsconfig.renderer.json no longer includes the renderer sources — nothing would be checked.',
    ).toContain('src/renderer/**/*');
    expect(rendererTsconfig.compilerOptions?.noEmit).toBe(true);
  });
});

/**
 * The same hole, one layer out: Playwright transpiles the E2E specs without checking them, and no
 * other tsconfig includes `tests/`. A narrowing that deleted an import a spec still used —
 * `join` in unsaved-dot-pulse.e2e.ts — passed lint and typecheck and surfaced only as a
 * ReferenceError in the gate's E2E stage, 20 minutes in.
 */
const E2E_TSCONFIG = fileURLToPath(new URL('../e2e/tsconfig.json', import.meta.url));
const e2eTsconfig = JSON.parse(readFileSync(E2E_TSCONFIG, 'utf8')) as TsConfig;

describe('the typecheck gate covers the E2E specs', () => {
  it('`npm run typecheck` runs the E2E check, against the E2E tsconfig', () => {
    expect(pkg.scripts?.typecheck ?? '').toContain('typecheck:e2e');
    expect(pkg.scripts?.['typecheck:e2e'] ?? '').toContain('tests/e2e/tsconfig.json');
  });

  it('the E2E tsconfig compiles every spec and helper as a no-emit check', () => {
    expect(e2eTsconfig.include ?? []).toContain('**/*.ts');
    expect(e2eTsconfig.compilerOptions?.noEmit).toBe(true);
  });
});
