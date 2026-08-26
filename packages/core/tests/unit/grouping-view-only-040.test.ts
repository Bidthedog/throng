import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { formatGrouped, parseGrouped, resolveGotoLine } from '@throng/core';
import { serializeShippedDefaults } from '../../src/config/shipped-defaults.js';

/**
 * 040 FR-028 / FR-028a — grouping is a VIEW concern, and the readouts are display-only.
 *
 * The bar renders `Ln 1,204` and `1,048,576 chars`. Constitution 5.4.0 requires that, and FR-027
 * puts every figure through the one core formatter. This file asserts the other half of the rule:
 * a grouping separator never reaches anything that is STORED, and nothing ever reads a rendered
 * figure back.
 *
 * ══ WHY A NEGATIVE NEEDS MORE THAN AN ASSERTION ABOUT TODAY'S CODE ══
 *
 * "No separator is stored" and "no readout is parsed back" are absences, and an absence asserted
 * only where it happens to be true is worth nothing — the next call site is somewhere this file
 * never looked. So two of the three groups below are SWEEPS: one over the bytes actually written to
 * disk, and one over every production source in the repository. They fail when a new call site
 * appears, which is the only time they can be useful.
 *
 * ══ WHAT IS NOT ASSERTED HERE ══
 *
 * That the readouts are grouped at all (FR-027) is `status-strip.tsx`'s own component tests, where
 * a bar is rendered and the locale is passed in. This file is only about the separator staying on
 * the screen.
 */

const REPO_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));

/**
 * Locales chosen because their separators DIFFER, which is the whole hazard: a parser that assumed
 * a comma turns `1.024` into either a corrupted number or a rejected one, depending which way the
 * bug fell. `fr-FR` groups with a narrow no-break space, which is also the one a careless
 * `split(',')` leaves behind intact.
 */
const LOCALES = ['en-US', 'de-DE', 'fr-FR'] as const;

/** Large enough that every locale above actually groups it — some do not group four digits. */
const BIG = 1234567;

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-028 — the separator never reaches a stored value
 * ────────────────────────────────────────────────────────────────────────── */

describe('a grouping separator never reaches a stored value (FR-028)', () => {
  it('is absent from every byte of the shipped defaults record', () => {
    /*
     * `serializeShippedDefaults()` is the exact text written to disk — settings, keybindings and
     * every bundled theme — so this scans the real artifact rather than a model of it.
     *
     * The pattern is "a JSON string value shaped like a grouped number": one to three digits, then
     * one or more groups of exactly three preceded by a separator any locale might use. A number
     * stored AS A NUMBER cannot carry a separator at all, so a string is the only shape this defect
     * can take.
     */
    /** Comma, full stop, NBSP, narrow NBSP, thin space, plain space — every separator Intl uses. */
    const separators = ',.\u00a0\u202f\u2009 ';
    const groupedString = new RegExp(`"[+-]?\\d{1,3}(?:[${separators}]\\d{3})+"`, 'g');
    const found = serializeShippedDefaults().match(groupedString) ?? [];
    expect(
      found,
      `the shipped defaults contain ${found.length} value(s) shaped like a grouped number. ` +
        `Grouping is a view concern (FR-028): a stored quantity is a number, and a separator in ` +
        `settings.json or a theme file is the defect constitution 4.5.0 exists to prevent.`,
    ).toEqual([]);
  });

  it('the three settings this feature adds are booleans, so no figure is stored at all', () => {
    // The readouts have no persisted counterpart — nothing the bar computes is written anywhere.
    // What 040 stores is three flags saying whether to draw them.
    const raw = JSON.parse(serializeShippedDefaults()) as {
      settings: {
        editor: { showGutter: unknown; statusBar: { showCursorPosition: unknown; showCounts: unknown } };
      };
    };
    expect(typeof raw.settings.editor.showGutter).toBe('boolean');
    expect(typeof raw.settings.editor.statusBar.showCursorPosition).toBe('boolean');
    expect(typeof raw.settings.editor.statusBar.showCounts).toBe('boolean');
  });

  it('the parser is the exact inverse of the formatter, in every locale', () => {
    /*
     * This is what makes the rule survivable at the ONE boundary where a displayed number legally
     * becomes a stored one — the preferences numeric control. The separator is derived from the
     * locale rather than assumed, so `1.234.567` in de-DE comes back as 1234567 rather than as
     * 1.234567 or as a rejection.
     */
    for (const locale of LOCALES) {
      const rendered = formatGrouped(BIG, locale);
      expect(rendered, `${locale} did not group ${BIG}`).not.toBe(String(BIG));
      expect(parseGrouped(rendered, locale), `round trip failed for ${locale}`).toBe(BIG);
    }
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-028 — nothing the bar renders is ever parsed back
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The config layer declares, parses, defaults and persists. `number-format.ts` DEFINES the two
 * functions, so its own text mentions them by construction and cannot count as a call site.
 */
const DEFINING_MODULE = join('config', 'number-format.ts');

function productionSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) {
        if (entry !== 'node_modules' && entry !== 'dist') walk(p);
      } else if (/\.(ts|tsx)$/.test(entry)) {
        out.push({ file: p, text: readFileSync(p, 'utf8') });
      }
    }
  };
  for (const pkg of readdirSync(join(REPO_ROOT, 'packages'))) {
    const src = join(REPO_ROOT, 'packages', pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(src);
  }
  return out;
}

/** Repo-relative, forward-slashed, so a failure message names a path a reader can open. */
function relative(file: string): string {
  return file.slice(REPO_ROOT.length).replace(/\\/g, '/');
}

/** Files that CALL `name` — a call, not a mention: a comment or a re-export is not a caller. */
function callersOf(name: string, sources: { file: string; text: string }[]): string[] {
  const call = new RegExp(`(?<![\\w.])${name}\\s*\\(`);
  return sources
    .filter(({ file }) => !file.endsWith(DEFINING_MODULE))
    .filter(({ text }) => call.test(text))
    .map(({ file }) => relative(file));
}

describe('the readouts are display-only and never parsed back (FR-028)', () => {
  it('has exactly one production caller of parseGrouped, and it is the preferences number control', () => {
    /*
     * The single legal direction for a grouped string is: a user types into the numeric settings
     * control, the control parses it, and the NUMBER is stored. Every other appearance of
     * `parseGrouped` would be something reading a rendered figure back — which for a status-bar
     * readout is a value that was never anything but pixels.
     *
     * Asserted as an exhaustive set rather than as "the status bar does not call it", because the
     * second form is satisfied by a helper module the bar calls that does the parsing for it.
     */
    const callers = callersOf('parseGrouped', productionSources());
    expect(
      callers,
      `parseGrouped is called from ${callers.join(', ')}. A displayed figure is parsed back in ` +
        `exactly one place — the preferences numeric control, where the user typed it. A readout ` +
        `is not an input (FR-028).`,
    ).toEqual(['packages/ui/src/renderer/preferences/form-controls.tsx']);
  });

  it('no editor module parses a displayed figure back', () => {
    // The narrower statement, kept for the failure message: if the exhaustive list above ever
    // legitimately grows, this is the part of it that must still hold.
    const editorCallers = callersOf('parseGrouped', productionSources()).filter((f) =>
      f.includes('/renderer/editor/'),
    );
    expect(editorCallers).toEqual([]);
  });
});

/* ────────────────────────────────────────────────────────────────────────── *
 * FR-028a — the grouped line number and Go To Line do not connect
 * ────────────────────────────────────────────────────────────────────────── */

describe('the bar and Go To Line do not connect (FR-028a)', () => {
  it('rejects the figure the bar renders, and accepts the plain one', () => {
    /*
     * They LOOK as though they should connect, which is why the requirement is written down: the
     * bar says `Ln 1,234,567` and the modal asks for a line number. `resolveGotoLine`'s
     * `WHOLE_NUMBER` accepts digits and a sign and nothing else — constitution 5.4.0's second
     * exclusion — so a grouped figure resolves to `null` and the caret does not move.
     *
     * This is not a complaint about the parser. It is the reason FR-028a forbids this feature from
     * seeding, pasting or otherwise feeding a readout into that field.
     */
    for (const locale of LOCALES) {
      const asRendered = formatGrouped(BIG, locale);
      expect(resolveGotoLine(asRendered, 2_000_000), `${locale}: ${asRendered}`).toBeNull();
    }
    expect(resolveGotoLine(String(BIG), 2_000_000)).toBe(BIG);
  });

  it('leaves resolveGotoLine untouched — no separator tolerance was added', () => {
    // 033 owns this parser. If a separator a user retypes by hand should be tolerated, that is an
    // issue against #234 and not a change 040 may make quietly.
    expect(resolveGotoLine('1,204', 5000)).toBeNull();
    expect(resolveGotoLine('1 204', 5000)).toBeNull();
    expect(resolveGotoLine('1204', 5000)).toBe(1204);
    expect(resolveGotoLine('+7', 5000)).toBe(7);
  });

  it('does not seed the Go To Line field from the bar', () => {
    /*
     * The mechanical half of "MUST NOT seed, paste or otherwise feed a readout into that field".
     * The modal seeds from its own remembered NUMBER with `String`, and `goto-line.tsx` reaches for
     * neither the formatter nor any module that holds a readout — so there is no path by which a
     * grouped string could arrive in that input.
     */
    const modal = productionSources().find((s) =>
      relative(s.file).endsWith('packages/ui/src/renderer/navigate/goto-line.tsx'),
    );
    expect(modal, 'goto-line.tsx was not found — has it moved?').toBeDefined();
    const text = modal?.text ?? '';

    expect(/(?<![\w.])formatGrouped\s*\(/.test(text), 'goto-line.tsx formats a seeded value').toBe(
      false,
    );
    for (const readoutModule of ['status-strip', 'caret-store', 'document-metrics-store']) {
      expect(
        text.includes(readoutModule),
        `goto-line.tsx reaches into ${readoutModule} — a readout must not reach that field`,
      ).toBe(false);
    }
  });
});
