import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { SETTINGS_METADATA } from '../../src/config/settings-metadata.js';

/**
 * 055 T016 — every setting this spec adds has a descriptor and a production reader (Principle X).
 *
 * `settings-inertness-047.test.ts` is the pattern. The six `resourceMonitor.*` leaves are read in one
 * place, `resolveResourceMonitorSettings` (`core/src/resources/settings-resolution.ts`), which applies
 * their cross-field rules; so each leaf must be read THERE, and the resolver must be CALLED by both
 * processes that act on it — UI main (the collector's interval and history) and the renderer (the
 * bands and the history the charts keep). `confirmations.killProcesses` is read by the kill dialog's
 * `planConfirmations('killProcesses', …)`.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const RESOLVER = join(REPO_ROOT, 'packages/core/src/resources/settings-resolution.ts');

const LEAVES = [
  'captureIntervalSeconds',
  'historyMinutes',
  'cpuWarningPercent',
  'cpuCriticalPercent',
  'memoryWarningPercent',
  'memoryCriticalPercent',
] as const;

function sources(dir: string): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (d: string): void => {
    for (const entry of readdirSync(d)) {
      const p = join(d, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(p);
      } else if (/\.(ts|tsx)$/.test(entry)) out.push({ file: p.replace(/\\/g, '/'), text: readFileSync(p, 'utf8') });
    }
  };
  walk(join(REPO_ROOT, dir));
  return out;
}

describe('055 adds no inert setting (T016)', () => {
  const declared = SETTINGS_METADATA.map((d) => d.key);

  it('describes every new leaf', () => {
    for (const leaf of LEAVES) expect(declared).toContain(`resourceMonitor.${leaf}`);
    expect(declared).toContain('confirmations.killProcesses');
  });

  it('reads every resourceMonitor leaf in the resolver', () => {
    const text = readFileSync(RESOLVER, 'utf8');
    const unread = LEAVES.filter((leaf) => !new RegExp(`\\.\\s*${leaf}\\b`).test(text));
    expect(unread, 'leaves the resolver never reads').toEqual([]);
  });

  it('has UI main and the renderer both calling the resolver', () => {
    const calls = /\bresolveResourceMonitorSettings\(/;
    const main = sources('packages/ui/src/main').filter((s) => calls.test(s.text));
    const renderer = sources('packages/ui/src/renderer').filter((s) => calls.test(s.text));
    expect(main.length, 'UI main never resolves the monitor settings').toBeGreaterThan(0);
    expect(renderer.length, 'the renderer never resolves the monitor settings').toBeGreaterThan(0);
  });

  it('has the kill dialog reading confirmations.killProcesses', () => {
    const readers = sources('packages/ui/src/renderer').filter((s) => /planConfirmations\(\s*'killProcesses'/.test(s.text));
    expect(readers.map((r) => r.file.split('/').pop())).toContain('kill-confirm.tsx');
  });
});
