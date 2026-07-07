/**
 * Panel-type registry (005 Phase A — pure). The single seam through which panel
 * types are registered and listed; the type-selection form's dropdown is driven
 * by `list()` (FR-002), and a new type is added with no change to the form flow
 * (SC-010). A factory keeps registries isolatable for tests; the app uses the
 * shared `defaultPanelTypeRegistry` (see ./default-registry).
 */
import type { PanelKind } from '../workspace/model.js';
import type { PanelTypeDescriptor } from './descriptor.js';

export interface PanelTypeRegistry {
  /** Register a descriptor; idempotent by id (a duplicate id replaces, order kept). */
  register(descriptor: PanelTypeDescriptor): void;
  /** Every registered descriptor, in stable registration order. */
  list(): PanelTypeDescriptor[];
  /** Resolve a descriptor by id, or `undefined`. */
  get(id: PanelKind): PanelTypeDescriptor | undefined;
}

export function createPanelTypeRegistry(): PanelTypeRegistry {
  // Insertion-ordered map: a duplicate id overwrites the value but keeps its
  // original position, so `list()` order is stable and deterministic.
  const byId = new Map<string, PanelTypeDescriptor>();
  return {
    register(descriptor) {
      byId.set(descriptor.id, descriptor);
    },
    list() {
      return [...byId.values()];
    },
    get(id) {
      return byId.get(id);
    },
  };
}
