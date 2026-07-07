/**
 * Contract suite for any {@link IConfigStore} implementation (Principle V /
 * contracts/os-config-store.md). The impl-specific test supplies a harness that
 * exposes the store plus a `seedRaw` hook to plant hand-edited/malformed file
 * content, so the same behavioural contract is verified against every impl.
 */
import { describe, it, expect } from 'vitest';
import type { ConfigDocId, IConfigStore } from '../abstractions/config-store.js';

export interface ConfigStoreHarness {
  store: IConfigStore;
  /** Plant raw bytes at a document's backing location (simulates a manual edit). */
  seedRaw(doc: ConfigDocId, raw: string): Promise<void>;
}

interface SampleDoc {
  value: number;
  label: string;
}

const DEFAULTS: SampleDoc = { value: 1, label: 'default' };

function validate(raw: unknown): SampleDoc {
  if (typeof raw === 'object' && raw !== null) {
    const r = raw as Record<string, unknown>;
    return {
      value: typeof r.value === 'number' ? r.value : DEFAULTS.value,
      label: typeof r.label === 'string' ? r.label : DEFAULTS.label,
    };
  }
  return { ...DEFAULTS };
}

export function runConfigStoreContract(
  name: string,
  makeHarness: () => Promise<ConfigStoreHarness>,
): void {
  const doc: ConfigDocId = { kind: 'settings' };

  describe(`IConfigStore contract: ${name}`, () => {
    it('returns defaults when the document is absent', async () => {
      const { store } = await makeHarness();
      const result = await store.read(doc, DEFAULTS, validate);
      expect(result).toEqual(DEFAULTS);
    });

    it('round-trips a written document', async () => {
      const { store } = await makeHarness();
      const written: SampleDoc = { value: 42, label: 'hello' };
      await store.write(doc, written);
      const read = await store.read(doc, DEFAULTS, validate);
      expect(read).toEqual(written);
    });

    it('falls back to defaults for a malformed document', async () => {
      const harness = await makeHarness();
      await harness.seedRaw(doc, '{ not valid json');
      const read = await harness.store.read(doc, DEFAULTS, validate);
      expect(read).toEqual(DEFAULTS);
    });

    it('reports a path for each document', async () => {
      const { store } = await makeHarness();
      expect(store.pathOf(doc)).toBeTruthy();
      expect(store.pathOf({ kind: 'theme', name: 'throng' })).toContain('throng');
    });
  });
}
