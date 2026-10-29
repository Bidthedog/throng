import { describe, expect, it } from 'vitest';
import {
  COMPONENT_DESCRIPTIONS,
  ROLE_DESCRIPTIONS,
  describeNode,
  type ComponentId,
  type ResourceNode,
  type ThrongRole,
} from '../../../src/resources/index.js';

/** 055 FR-102 — why each component and each of throng's own process roles exists. */

const COMPONENTS: readonly ComponentId[] = ['ui', 'daemon', 'helpers', 'projects'];
const ROLES: readonly ThrongRole[] = [
  'main',
  'window',
  'gpu',
  'utility',
  'daemon',
  'conhost',
  'lock-helper',
  'collector',
  'deelevation-agent',
];

const node = (extra: Partial<ResourceNode>): ResourceNode =>
  ({
    id: 'x',
    kind: 'process',
    label: 'x',
    own: {} as ResourceNode['own'],
    rolled: {} as ResourceNode['rolled'],
    children: [],
    owner: { component: 'ui' },
    ...extra,
  }) as ResourceNode;

describe('component and role descriptions (FR-102)', () => {
  it.each([...COMPONENTS.map((c) => COMPONENT_DESCRIPTIONS[c]), ...ROLES.map((r) => ROLE_DESCRIPTIONS[r])])(
    'is one or two sentences with no figure: %s',
    (text) => {
      const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 0);
      expect(sentences.length).toBeGreaterThanOrEqual(1);
      expect(sentences.length).toBeLessThanOrEqual(2);
      // A title never carries a live figure (FR-095), so no digits at all.
      expect(text).not.toMatch(/\d/);
    },
  );

  it('describes a component row by its component', () => {
    expect(describeNode(node({ kind: 'component', owner: { component: 'daemon' } }))).toBe(COMPONENT_DESCRIPTIONS.daemon);
  });

  it("describes one of throng's own processes by its role", () => {
    expect(describeNode(node({ role: 'conhost', owner: { component: 'helpers' } }))).toBe(ROLE_DESCRIPTIONS.conhost);
  });

  it("has no description for the user's own processes, projects, tabs or panels", () => {
    expect(describeNode(node({ owner: { component: 'projects' } }))).toBeUndefined();
    expect(describeNode(node({ kind: 'project', owner: { component: 'projects' } }))).toBeUndefined();
  });
});
