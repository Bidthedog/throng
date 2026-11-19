import ts from 'typescript';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';
import { buildRepoProgram, scanSettingReaders, type KeyReaders } from './settings-readers-scan.js';
import { CONFIGURATION_LAYER, INERT_ALLOWLIST, allowlistProblems, isProductionSource } from './inert-settings-policy.js';

/**
 * 071 (#108) — no Settings descriptor is inert.
 *
 * A setting is INERT when Preferences renders a control for it, the value saves, and nothing acts on it: the user
 * changes it and nothing happens. `explorer.openMode` shipped that way for a year (#95). 019 FR-022 made "a control
 * that governs nothing must not ship" policy; this test is its enforcement, over every descriptor rather than the
 * handful each feature's own test used to check by matching text (FR-001, FR-014, FR-015).
 *
 * Readers are resolved through the TypeScript type checker (`settings-readers-scan.ts`), never by searching for a
 * key's name: 019 measured 11 false positives from settings read through aliased section objects (019 C16). The
 * scan's rules are each proved in isolation by `settings-readers-scan.test.ts`.
 *
 * A reader proves the setting is WIRED to something, not that its effect is right; each feature's own tests own
 * correctness.
 *
 * Run the report of every key and its readers: `SETTINGS_READERS_REPORT=1 npx vitest run --project unit
 * --silent=false packages/core/tests/unit/no-inert-settings.test.ts` (FR-013). `--silent=false` because vitest 5
 * hides a passing test's console output.
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Building one program over every package's source and scanning it is this file's whole cost — about 11 s on a
 * workstation, close to the 10.6 s a plain type check of the same program takes (research R2, R7) — so it happens
 * once, in the hook, and every case below reads the same report in milliseconds. The hook states its own budget
 * rather than inheriting the unit project's 15 s test timeout. Hosted runners took 15–28 s for it, and one macOS
 * runner whose whole unit stage ran 3.5× slower than usual took 128 s, so the budget is 240 s: a hung build is
 * hung, so the headroom costs the signal nothing.
 */
const BUILD_BUDGET_MS = 240_000;

let report: KeyReaders[] = [];

beforeAll(() => {
  const program = buildRepoProgram(REPO);
  report = scanSettingReaders({
    program,
    rootType: (checker, p) => {
      const file = p.getSourceFile(`${REPO}packages/core/src/config/app-settings.ts`.replace(/\\/g, '/'));
      const symbol = file && checker.getSymbolAtLocation(file)?.exports?.get(ts.escapeLeadingUnderscores('AppSettings'));
      if (!symbol) throw new Error('AppSettings not found in packages/core/src/config/app-settings.ts');
      return checker.getDeclaredTypeOfSymbol(symbol);
    },
    keys: SETTINGS_METADATA.map((d) => d.key),
    // TypeScript writes every file name with `/`, on Windows too, so the prefixes below match on every lane.
    relPath: (sf) => sf.fileName.slice(REPO.replace(/\\/g, '/').length),
    isProduction: isProductionSource,
    configLayer: CONFIGURATION_LAYER.map((c) => c.prefix),
  });
}, BUILD_BUDGET_MS);

describe('071 no inert settings (FR-001, FR-010)', () => {
  it('scans every Settings descriptor', () => {
    expect(report.map((r) => r.key)).toEqual(SETTINGS_METADATA.map((d) => d.key));
  });

  it('has a reader outside the configuration layer for every Settings descriptor', () => {
    const allowlisted = new Set(INERT_ALLOWLIST.map((a) => a.key));
    const inert = report.filter((r) => r.readers.length === 0 && !allowlisted.has(r.key)).map((r) => r.key);
    expect(
      inert,
      `${inert.length} setting${inert.length === 1 ? ' is' : 's are'} rendered in Preferences but nothing outside the ` +
        `configuration layer reads ${inert.length === 1 ? 'it' : 'them'}, so changing ${inert.length === 1 ? 'it' : 'them'} ` +
        `does nothing:\n${inert.map((k) => `  - ${k}  (no reader)`).join('\n')}\n` +
        'Wire each one to the behaviour it names, remove it with a supersession, or allowlist it with a reason ' +
        '(packages/core/tests/unit/inert-settings-policy.ts).',
    ).toEqual([]);
  });

  it('keeps a valid allowlist: every entry current, still unread, and with a reason (FR-011)', () => {
    expect(allowlistProblems(INERT_ALLOWLIST, report)).toEqual([]);
  });
});

describe('071 the read shapes 019’s text scan could not see resolve on the real code (SC-002)', () => {
  /*
   * 019 did not record its eleven misfires by key, so these stand in for them: one real setting for each read
   * shape research R3 met in the repository. Each must have a reader, and no reader may be a configuration-layer
   * file (which would mean the layer list leaked).
   */
  const SHAPES = [
    { key: 'explorer.dragCopyModifier', shape: 'an aliased section object' },
    { key: 'explorer.dragMoveModifier', shape: 'an aliased section object' },
    { key: 'confirmations.destroyPanel', shape: 'a section passed to a mirror-typed parameter' },
    { key: 'newProject.overridePath', shape: 'a section passed to a Pick<> parameter' },
    { key: 'resourceMonitor.cpuWarningPercent', shape: 'a section read by its resolver' },
    { key: 'editor.previews.providers.markdown.gutter', shape: 'an entry of the providers map' },
  ];

  it.each(SHAPES)('$key, read through $shape, has a reader', ({ key }) => {
    const readers = report.find((r) => r.key === key)?.readers ?? [];
    expect(readers, `${key} has no reader`).not.toEqual([]);
    const leaked = readers.filter((f) => CONFIGURATION_LAYER.some((c) => f.startsWith(c.prefix)));
    expect(leaked).toEqual([]);
  });
});

describe('071 where each setting is read (FR-013)', () => {
  it('reports one entry per descriptor, printing them when asked', () => {
    expect(report).toHaveLength(SETTINGS_METADATA.length);
    if (process.env.SETTINGS_READERS_REPORT === '1') {
      const reasons = new Map(INERT_ALLOWLIST.map((a) => [a.key, a.reason]));
      const lines = report.map(({ key, readers }) =>
        readers.length > 0 ? `${key} ← ${readers.join(', ')}` : `${key} ← (allowlisted: ${reasons.get(key) ?? 'NOT ALLOWLISTED'})`,
      );
      console.log(lines.join('\n'));
    }
  });
});
