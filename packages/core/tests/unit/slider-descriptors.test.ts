import { describe, expect, it } from 'vitest';

import { SETTINGS_METADATA, THEME_METADATA, type FieldDescriptor } from '../../src/index.js';

/**
 * 018 / FR-034, FR-035 — the slider's bounds and step are DECLARED, and the declaration is honest.
 *
 * `step` has been declared by eight descriptors since feature 007 and READ BY NOBODY: dead metadata,
 * sitting in the registry, describing a behaviour that did not exist. The slider is what makes it
 * load-bearing.
 */
const ALL: FieldDescriptor[] = [...SETTINGS_METADATA, ...THEME_METADATA];

describe('every slider descriptor declares what a slider needs', () => {
  it('declares a minimum, a maximum AND a step', () => {
    // Discovered, not hand-listed: FR-034 forbids a "silent, undeclared bound", and the only way to
    // know none has crept in is to walk the registry.
    for (const d of ALL.filter((x) => x.control === 'slider')) {
      expect(d.min, `${d.key} declares a slider with no minimum`).toBeTypeOf('number');
      expect(d.max, `${d.key} declares a slider with no maximum`).toBeTypeOf('number');
      expect(d.step, `${d.key} declares a slider with no step`).toBeTypeOf('number');
    }
  });

  it('has a step of at least 1% of its range — a slider you can actually aim', () => {
    /*
     * "A step exists" is NOT the assertion that matters.
     *
     * A step of 1024 across a 2 GiB range gives a slider two million indistinguishable positions:
     * technically compliant, practically useless, and exactly the trap the maximum-file-size setting
     * would have fallen into had it been given a ceiling so it could take a slider.
     *
     * At least 1% of the range means at most a hundred stops across the drag. The auto-save delay
     * was the one shipped descriptor that failed this (50 across 0–10000 = 0.5%), and it is widened
     * rather than waved through — a rule the codebase does not satisfy is a red bar nobody can fix.
     */
    for (const d of ALL.filter((x) => x.control === 'slider')) {
      const range = d.max! - d.min!;
      const ratio = d.step! / range;
      expect(
        ratio,
        `${d.key}: step ${d.step} is ${(ratio * 100).toFixed(2)}% of its ${range} range — ` +
          `that is ${Math.round(range / d.step!)} indistinguishable positions`,
      ).toBeGreaterThanOrEqual(0.01);
    }
  });

  it('gives the maximum-file-size setting a slider that moves in 5 MB steps', () => {
    // 018 shipped this TYPED, arguing that a slider from a kilobyte to gigabytes moves in megabyte
    // jumps per pixel and is a worse control than the text box it replaces. The argument was about the
    // RANGE, and it was answered by the STEP: five megabytes is the unit anyone actually thinks in
    // here, and it collapses the range to fifty positions you can aim at. Superseded on the record
    // rather than quietly reversed — and the typed field is still there for an exact number.
    const MiB = 1024 * 1024;
    const maxFile = SETTINGS_METADATA.find((d) => d.key === 'editor.maxOpenFileBytes');
    expect(maxFile?.control).toBe('slider');
    expect(maxFile?.step).toBe(5 * MiB);
    expect(maxFile?.min).toBe(5 * MiB);
    expect(maxFile?.max).toBe(250 * MiB);
  });

  it('gives the theme font weights the CSS weight range, which they never had', () => {
    const weights = THEME_METADATA.filter((d) => d.key.endsWith('.weight') || /weights\./.test(d.key));
    expect(weights.length).toBeGreaterThan(0);
    for (const d of weights) {
      expect(d.control, `${d.key}`).toBe('slider');
      expect(d.min).toBe(100);
      expect(d.max).toBe(900);
      expect(d.step).toBe(100);
    }
  });
});

describe('SC-007 — the CONVERSE: bounds imply a slider', () => {
  it('every numeric that declares a minimum AND a maximum declares the slider control', () => {
    // The forward guard ("every slider has sane bounds") was the easy half, and it passed while the
    // requirement was still broken: the theme font sizes declared 6-96 with a step of 1 and rendered as
    // a BARE TEXT BOX, because nothing checked that a numeric carrying bounds actually asked for the
    // control those bounds exist to drive. FR-034 names font sizes FIRST among the numerics that become
    // sliders, and US7's own independent test says "drag a slider for a font size".
    //
    // So the guard is written in the direction that fails: it DISCOVERS every bounded numeric, rather
    // than checking the ones that were remembered.
    const offenders = [...SETTINGS_METADATA, ...THEME_METADATA]
      .filter((d) => typeof d.min === 'number' && typeof d.max === 'number')
      .filter((d) => d.control !== 'slider')
      .map((d) => `${d.key} (control: ${d.control})`);
    expect(
      offenders,
      `these declare bounds but not the control those bounds exist for:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
