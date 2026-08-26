import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import {
  KEYBINDINGS_METADATA,
  SETTINGS_METADATA,
  THEME_METADATA,
  type FieldDescriptor,
  type MetadataRegistry,
} from '@throng/core';

/**
 * 040 US3 — `FieldDescriptor.subgroup` (spec FR-035; contracts/metadata.md; data-model.md §2).
 *
 * `FieldDescriptor` is ONE registry that THREE separate renderers read, so a field added to it is a
 * contract between one producer and three consumers. Two halves are asserted here, and the second
 * is the one that is easy to get wrong:
 *
 *  - the field exists, is OPTIONAL, and gives exactly ONE level of nesting;
 *  - it adds **no `ControlKind`**. 007 FR-028 declares the control vocabulary exhaustively, and
 *    "we extended the descriptor" sounds like it should have touched that vocabulary. It does not:
 *    `subgroup` is a descriptor field, not a control type, so #79 is unaffected. Stating it as an
 *    assertion rather than a note is what stops the next reader going looking for a spec conflict
 *    that is not there — and what catches anyone who tries to add `'subgroup'` to the union.
 *
 * **Why this reads the SOURCE.** An optional interface member is erased at runtime: no object can
 * demonstrate its absence, and vitest transpiles without type-checking, so a purely type-level
 * assertion here would pass whether or not the field had ever been declared. The declaration is
 * therefore asserted textually — the same technique `expand-barrel.test.ts` uses for a rule
 * TypeScript cannot express — while the type-level half is carried by `npm run typecheck` compiling
 * {@link NESTED} below.
 */

const METADATA_SRC = fileURLToPath(new URL('../../src/config/metadata.ts', import.meta.url));
const SOURCE = readFileSync(METADATA_SRC, 'utf8');

/** The body of one top-level `export interface <name> { … }`, braces excluded. */
function interfaceBody(name: string): string {
  const open = SOURCE.indexOf(`export interface ${name} {`);
  expect(open, `${name} is declared in metadata.ts`).toBeGreaterThan(-1);
  const from = SOURCE.indexOf('\n', open) + 1;
  const close = SOURCE.indexOf('\n}', from);
  expect(close, `${name}'s declaration is closed at column 0`).toBeGreaterThan(from);
  return SOURCE.slice(from, close);
}

/**
 * The string members of the `ControlKind` union, in declaration order.
 *
 * **The character class is `[^']+`, and that is the whole point of the function.** An earlier
 * version matched `'([a-z-]+)'`, which does not describe the union — it describes the members that
 * happen to be there today. Any member outside that class was SILENTLY SKIPPED rather than
 * reported, so adding `| 'fontWeight'` (or `'font_size'`, or `'Slider'`) to `ControlKind` widened
 * 007 FR-028's exhaustive vocabulary with every assertion below still green — the guard's own
 * regex was the hole in the guard. Matching everything between the quotes means a new member can
 * only ever show up as a MISMATCH against {@link SHIPPED_CONTROL_KINDS}, which is the argument the
 * frozen list exists to force.
 */
function controlVocabulary(): string[] {
  const from = SOURCE.indexOf('export type ControlKind =');
  const to = SOURCE.indexOf('export interface MapColumn');
  expect(from, 'ControlKind is declared in metadata.ts').toBeGreaterThan(-1);
  expect(to, 'MapColumn follows ControlKind').toBeGreaterThan(from);
  return unionMembers(SOURCE.slice(from, to));
}

/**
 * Every quoted member of a `|`-separated string union. Split out from {@link controlVocabulary} so
 * the extraction can be exercised against a synthetic union below — a guard whose reader is untested
 * is a guard that can pass by failing to look.
 */
function unionMembers(union: string): string[] {
  // `matchAll` clones the regex, so the shared `lastIndex` is never carried between calls.
  return [...union.matchAll(/^\s*\|\s*'([^']+)'/gmu)].map((m) => m[1]);
}

/**
 * The control vocabulary as 007 FR-028 declared it, frozen here so that widening it is a change
 * someone has to argue with rather than one they can make by reflex while adding a descriptor field.
 */
const SHIPPED_CONTROL_KINDS = [
  'number',
  'text',
  'toggle',
  'select',
  'multiselect',
  'array',
  'colour',
  'font-family',
  'font-size',
  'enum',
  'chord',
  'icon',
  'folder',
  'map',
  'records',
  'slider',
] as const;

/** A descriptor of the shape every registry has produced since 007 — no `subgroup`. */
const FLAT: FieldDescriptor = {
  key: 'editor.statusBar.showCaret',
  label: 'Show caret position',
  description: 'Whether the editor status bar reports line and column.',
  group: 'Editor',
  control: 'toggle',
};

/**
 * The same descriptor, nested one level. Its only job in this file is to be COMPILED: if
 * `subgroup` is not a declared member, `npm run typecheck` rejects this object literal.
 */
const NESTED: FieldDescriptor = { ...FLAT, subgroup: 'Status Bar' };

const REGISTRIES: readonly (readonly [string, MetadataRegistry])[] = [
  ['settings', SETTINGS_METADATA],
  ['keybindings', KEYBINDINGS_METADATA],
  ['themes', THEME_METADATA],
];

describe('FieldDescriptor.subgroup (040 FR-035)', () => {
  it('is declared on FieldDescriptor, optional, and typed as a plain string', () => {
    // `subgroup?: string` — the `?` is the requirement, not a formatting detail: FR-035 says
    // OPTIONAL, and a required member would make every one of the ~400 shipped descriptors invalid.
    expect(interfaceBody('FieldDescriptor')).toMatch(/^\s*subgroup\?: string;\s*$/mu);
  });

  it('gives exactly ONE level of nesting — there is no subsubgroup and no recursion', () => {
    // contracts/metadata.md: "One level only. There is no `subsubgroup` and no recursion." A general
    // tree is a renderer nobody needs and three tabs' worth of code to maintain.
    // Matched as MEMBER DECLARATIONS — `/subsubgroup/` alone hits the JSDoc sentence that forbids
    // one, so the guard would fail on the very comment stating the rule it enforces.
    const body = interfaceBody('FieldDescriptor');
    expect(body).not.toMatch(/^\s*sub(?:sub)+group\??:/mu);
    expect(body.match(/^\s*subgroup\??:/gmu)).toHaveLength(1);
    expect(body).not.toMatch(/^\s*subgroup\??:\s*(?:readonly\s+)?(?:string\[\]|FieldDescriptor)/mu);
  });

  it('is only meaningful inside a group, and `group` stays required', () => {
    // data-model.md §2: a subgroup with no group is not representable, and it is `group` being
    // required that makes that true rather than a check anyone has to remember to write.
    expect(interfaceBody('FieldDescriptor')).toMatch(/^\s*group: string;\s*$/mu);
  });
});

describe('subgroup is ADDITIVE — a descriptor without one is unchanged (040 FR-035)', () => {
  it('accepts a subgroup on an otherwise ordinary descriptor — but only the COMPILER can say so', () => {
    /*
     * {@link NESTED}'s real assertion is made by `npm run typecheck`: if `subgroup?: string` were
     * not a declared member, that object literal would be rejected where it is declared. The
     * expectation here cannot substitute for it — an optional member is erased at runtime, so no
     * object can demonstrate the declaration either way — and it is written down as a limitation
     * rather than dressed up as a check, because three earlier assertions in this file WERE dressed
     * up that way and would all have survived `subgroup` being deleted from `metadata.ts`:
     *
     *   - that `FLAT.subgroup` is `undefined` — asserting that an object literal declared twenty
     *     lines above lacks a key nobody wrote into it;
     *   - that `NESTED` differs from `FLAT` in exactly one key — asserting the semantics of the
     *     spread operator, which are not this feature's to get wrong;
     *   - that every shipped descriptor declares the five required fields — a real invariant, but
     *     one `settings-metadata.test.ts` already owns, and unrelated to `subgroup`.
     *
     * The load-bearing assertions for FR-035 are the three SOURCE-TEXT ones above, and typecheck.
     */
    expect(NESTED.subgroup).toBe('Status Bar');
  });

  it.each(REGISTRIES)(
    'no %s descriptor carries a subgroup without a group (real for settings; still vacuous for keybindings and themes)',
    (_name, registry) => {
      /*
       * ══ WHAT THIS ACTUALLY CHECKS TODAY, PER REGISTRY ══
       *
       * When 040 US3 added the FIELD, no shipped descriptor used it, so the pairing check ran zero
       * times everywhere and the test said so in its own name. **That is no longer true of
       * `settings`.** `settings-metadata.ts` now carries THREE `subgroup: 'Status Bar'` descriptors
       * — `editor.showStatusBar`, `editor.statusBar.showCursorPosition` and
       * `editor.statusBar.showCounts` — so for that registry the body below runs three times and is
       * real evidence: a nested descriptor that lost its `group`, or that shipped an empty
       * `subgroup`, fails here.
       *
       * `keybindings` and `themes` still nest nothing, so the check remains vacuous for those two.
       * Naming it per registry rather than blanket-VACUOUS matters both ways round: a reader must
       * not discount the settings row's green tick, and must not read the other two as evidence.
       * When either of them nests its first descriptor, this comment is what needs editing — the
       * assertions do not.
       *
       * ══ WHY THE ROW COUNT IS ONE ASSERTION AND NOT TWO ══
       *
       * `toBeGreaterThan(0)` is what stops a vacuous pass becoming permanent: a registry that
       * emptied, or an iteration that broke, would otherwise read as "no descriptor carries a
       * subgroup without a group" and pass. It carries that job alone. The `expect(rows)
       * .toBe(registry.length)` that used to sit beside it was a TAUTOLOGY — `rows` is incremented
       * exactly once per `for...of` step over an array, so no change to `metadata.ts` or to any
       * registry could ever separate the two, and it was asserting the semantics of `for...of`
       * inside the test that exists to prevent vacuity.
       */
      let rows = 0;
      for (const d of registry) {
        rows += 1;
        if (d.subgroup === undefined) continue;
        expect(d.subgroup, d.key).not.toBe('');
        expect(d.group, d.key).not.toBe('');
      }
      expect(rows).toBeGreaterThan(0);
    },
  );
});

describe('subgroup adds NO ControlKind (007 FR-028 — the control vocabulary is exhaustive)', () => {
  it('leaves the union exactly as 007 declared it', () => {
    expect(controlVocabulary()).toEqual([...SHIPPED_CONTROL_KINDS]);
  });

  it('READS a member outside [a-z-], so a camelCase addition cannot slip past (test-of-the-test)', () => {
    /*
     * The guard above is only as exhaustive as its reader. With the old `'([a-z-]+)'` pattern, a
     * member like `'fontWeight'` matched NOTHING — the extraction skipped the line, the returned
     * list still equalled SHIPPED_CONTROL_KINDS, and 007 FR-028's closed vocabulary could be
     * widened with the suite green. The failure was silent in the worst possible direction: the
     * test reporting "unchanged" precisely because it could not see the change.
     *
     * Asserted against a synthetic union rather than by editing `metadata.ts`, so the case is
     * exercised on every run instead of being a story in a comment.
     */
    const synthetic = [
      'export type Fake =',
      "  | 'toggle'",
      "  | 'fontWeight' // camelCase — invisible to the old pattern",
      "  | 'font_size'",
      "  | 'Slider';",
    ].join('\n');
    expect(unionMembers(synthetic)).toEqual(['toggle', 'fontWeight', 'font_size', 'Slider']);
  });

  it('does not add `subgroup` as a control type', () => {
    // The specific mistake this guards: reaching for the union because the descriptor grew a field.
    // `subgroup` is a property of the field, not a way of editing one, so #79 is unaffected.
    expect(controlVocabulary()).not.toContain('subgroup');
  });

  it.each(REGISTRIES)('every %s descriptor still renders as one of those controls', (_name, registry) => {
    for (const d of registry) {
      expect(SHIPPED_CONTROL_KINDS).toContain(d.control);
    }
  });
});
