/**
 * 032 FR-019/FR-019a — the notice says WHAT is wrong, per offending value.
 *
 * The point of the feature is that a user who has typed something the app will not accept can see
 * which value it was and what it accepts, without leaving the editor to go and look. So the tests
 * that matter are the ones asserting the MESSAGE contains the options or the range — not merely
 * that something was flagged.
 *
 * The other load-bearing test is `does not report an absent key`. Reporting absence would make every
 * settings file written before a release that adds a setting "invalid", and FR-018 blocks the user
 * from leaving an invalid document — so that mistake would lock them inside the JSON editor over a
 * document that works perfectly.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_APP_SETTINGS,
  SETTINGS_METADATA,
  checkSettingsText,
  describeSettingsValidity,
  formatSettingsProblem,
  isSettingsTextValid,
} from '../../src/index.js';

/** A complete, valid document, as JSON text. */
const VALID = JSON.stringify(DEFAULT_APP_SETTINGS, null, 2);

/** The registry's first descriptor declaring a non-empty option set. */
const ENUMERATED = SETTINGS_METADATA.find(
  (d) => (d.allowedValues?.length ?? 0) > 0 && d.control !== 'map',
)!;

/** The registry's first descriptor declaring a numeric bound. */
const BOUNDED = SETTINGS_METADATA.find(
  (d) =>
    d.control !== 'map' &&
    (d.columns?.length ?? 0) === 0 &&
    (typeof (d.hardMin ?? d.min) === 'number' || typeof (d.hardMax ?? d.max) === 'number'),
)!;

/** `VALID`, with one dotted key replaced. */
function withValue(key: string, value: unknown): string {
  const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
  const parts = key.split('.');
  const last = parts.pop()!;
  let cursor = doc;
  for (const part of parts) cursor = cursor[part] as Record<string, unknown>;
  cursor[last] = value;
  return JSON.stringify(doc, null, 2);
}

describe('a valid document', () => {
  it('is valid', () => {
    expect(isSettingsTextValid(VALID)).toBe(true);
    expect(checkSettingsText(VALID)).toEqual({ kind: 'checked', problems: [] });
  });

  it('is still valid with a hand-added key the schema does not model', () => {
    // A hand-added key is legitimate — the write path preserves it — so flagging it would block the
    // user from leaving over something the app is perfectly happy with.
    const doc = { ...DEFAULT_APP_SETTINGS, myOwnNote: 'remember this' };
    expect(isSettingsTextValid(JSON.stringify(doc))).toBe(true);
  });

  it('does not report an absent key', () => {
    const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
    delete doc.appearance;
    expect(isSettingsTextValid(JSON.stringify(doc))).toBe(true);
  });

  it('an EMPTY object is valid', () => {
    // Every key takes its shipped default. Nothing is wrong with it, and a user who has cleared the
    // file to start again must be able to leave.
    expect(isSettingsTextValid('{}')).toBe(true);
  });
});

describe('FR-019a — an unparseable document', () => {
  it('is reported as unparseable, not as a bad value', () => {
    const validity = checkSettingsText('{ "appearance": { "theme": "Matrix" ');
    expect(validity.kind).toBe('unparseable');
  });

  it('says where the parse gave up, when the parser says', () => {
    // A trailing comma before the closing brace — the single commonest hand-edit mistake, and one
    // V8 does report a position for.
    const validity = checkSettingsText('{\n  "appearance": { "theme": "Matrix" },\n}');
    if (validity.kind !== 'unparseable') throw new Error('expected unparseable');
    // Line and column, not a character offset — an offset into a 200-line document is not something
    // a person can act on.
    expect(validity.line).toBeGreaterThan(0);
    expect(validity.column).toBeGreaterThan(0);
    expect(describeSettingsValidity(validity)[0]).toMatch(/line \d+, column \d+/);
  });

  it('says so plainly when the parser supplies NO position', () => {
    /*
     * FR-019a says "with the position of the parse failure WHERE THE PARSER SUPPLIES ONE", and that
     * qualifier is load-bearing rather than defensive. V8 reports a position for most syntax errors
     * and none at all for "Unexpected end of JSON input" — which is what a half-typed document
     * looks like, so it is the case a user in this editor hits most.
     *
     * Inventing a position for it would be worse than omitting one: it would point at a character
     * that is not the problem.
     *
     * An emptied buffer is the realistic instance — select-all, delete, start again — and it is one
     * the user must not be able to leave, so getting its message right matters.
     */
    const validity = checkSettingsText('');
    if (validity.kind !== 'unparseable') throw new Error('expected unparseable');
    expect(validity.line).toBeUndefined();

    const lines = describeSettingsValidity(validity);
    expect(lines[0]).toBe('This is not valid JSON.'); // no invented location
    expect(lines[1]).toContain('JSON'); // the parser's own message still travels
  });

  it('keeps the parser’s own message', () => {
    // It names the character it did not expect, which is the one fact we cannot reconstruct.
    const validity = checkSettingsText('{ nope }');
    expect(describeSettingsValidity(validity).join(' ').length).toBeGreaterThan(20);
  });

  it('reports a document that parses but is not an object', () => {
    expect(checkSettingsText('[1,2,3]').kind).toBe('not-an-object');
    expect(checkSettingsText('"a string"').kind).toBe('not-an-object');
    expect(checkSettingsText('null').kind).toBe('not-an-object');
  });
});

describe('FR-019 — an enumerated value', () => {
  it('names the setting and LISTS ITS OPTIONS', () => {
    const text = withValue(ENUMERATED.key, '__not_a_valid_option__');
    const validity = checkSettingsText(text);
    if (validity.kind !== 'checked') throw new Error('expected a checked document');

    const problem = validity.problems.find((p) => p.key === ENUMERATED.key);
    expect(problem, `${ENUMERATED.key} should have been reported`).toBeDefined();
    expect(problem!.label).toBe(ENUMERATED.label);

    // THE POINT OF THE FEATURE: every allowed option appears in the message, so the user does not
    // have to leave the editor to find out what the setting accepts.
    const line = describeSettingsValidity(validity).find((l) => l.includes(ENUMERATED.key))!;
    for (const allowed of ENUMERATED.allowedValues!) {
      expect(line).toContain(String(allowed));
    }
  });

  it('accepts every option the registry declares', () => {
    for (const allowed of ENUMERATED.allowedValues!) {
      expect(isSettingsTextValid(withValue(ENUMERATED.key, allowed))).toBe(true);
    }
  });
});

describe('FR-019 — a bounded value', () => {
  it('names the setting and STATES ITS RANGE', () => {
    const hi = BOUNDED.hardMax ?? BOUNDED.max;
    const lo = BOUNDED.hardMin ?? BOUNDED.min;
    const outOfRange = typeof hi === 'number' ? hi + 1000 : (lo as number) - 1000;

    const validity = checkSettingsText(withValue(BOUNDED.key, outOfRange));
    if (validity.kind !== 'checked') throw new Error('expected a checked document');

    const line = describeSettingsValidity(validity).find((l) => l.includes(BOUNDED.key));
    expect(line, `${BOUNDED.key} = ${outOfRange} should have been reported`).toBeDefined();
    if (typeof lo === 'number') expect(line).toContain(String(lo));
    if (typeof hi === 'number') expect(line).toContain(String(hi));
  });

  it('reports a non-number in a bounded slot', () => {
    const validity = checkSettingsText(withValue(BOUNDED.key, 'not a number'));
    if (validity.kind !== 'checked') throw new Error('expected a checked document');
    expect(validity.problems.some((p) => p.key === BOUNDED.key)).toBe(true);
  });
});

describe('every problem, not the first', () => {
  it('reports several offending values in one pass', () => {
    // A user fixing one value at a time, each round trip revealing the next, is the worst version of
    // this — especially when they cannot leave the editor until all of them are right.
    let text = withValue(ENUMERATED.key, '__nope__');
    const doc = JSON.parse(text) as Record<string, unknown>;
    const parts = BOUNDED.key.split('.');
    const last = parts.pop()!;
    let cursor = doc;
    for (const part of parts) cursor = cursor[part] as Record<string, unknown>;
    cursor[last] = 'also not a number';
    text = JSON.stringify(doc);

    const validity = checkSettingsText(text);
    if (validity.kind !== 'checked') throw new Error('expected a checked document');
    expect(validity.problems.map((p) => p.key).sort()).toEqual([ENUMERATED.key, BOUNDED.key].sort());
  });
});

describe('the wording the user actually reads', () => {
  it('reads "Label" (key) must be one of: a, b, c. Found "x".', () => {
    /*
     * The exact shape, pinned. Each part is doing a job:
     *
     *   - the LABEL is quoted because it is prose the user recognises from the form;
     *   - the KEY is bare because it is what they must find in the file;
     *   - the options are UNQUOTED and the found value IS quoted, so the two cannot be confused at a
     *     glance — and the quotes make a trailing space or an empty string visible.
     */
    const validity = checkSettingsText(withValue('confirmations.destroyProject', 'doubles'));
    if (validity.kind !== 'checked') throw new Error('expected a checked document');

    const problem = validity.problems.find((p) => p.key === 'confirmations.destroyProject');
    expect(formatSettingsProblem(problem!)).toBe(
      '"Remove a project" (confirmations.destroyProject) must be one of: none, single, double. Found "doubles".',
    );
  });

  it('quotes the found value so an empty string is visible', () => {
    const validity = checkSettingsText(withValue('confirmations.destroyProject', ''));
    if (validity.kind !== 'checked') throw new Error('expected a checked document');
    const problem = validity.problems.find((p) => p.key === 'confirmations.destroyProject');
    expect(problem!.foundText).toBe('""');
  });

  it('states a range for a bounded value, with the number found', () => {
    const validity = checkSettingsText(withValue('panes.projects.maxWidth', 99_999));
    if (validity.kind !== 'checked') throw new Error('expected a checked document');
    const problem = validity.problems.find((p) => p.key === 'panes.projects.maxWidth');
    const line = formatSettingsProblem(problem!);
    expect(line).toContain('"Projects pane max width" (panes.projects.maxWidth) must be between');
    expect(line).toContain('Found 99999.');
  });
});

describe('appearance.theme — the one setting whose valid set is runtime (FR-019c)', () => {
  const THEMES = ['throng', 'Matrix', 'Gothic'];

  it('accepts a theme that exists', () => {
    expect(
      isSettingsTextValid(withValue('appearance.theme', 'Matrix'), { knownThemes: THEMES }),
    ).toBe(true);
  });

  it('REFUSES a theme that does not, and lists the ones that do', () => {
    /*
     * The trap this closes: the Themes tab's JSON document IS the active theme's file. A theme with
     * no file behind it opens that editor on an empty, unparseable buffer the user never touched,
     * and every exit refused — including "Discard and close". Reported as being stuck on the Themes
     * page with no way out but killing the application.
     */
    const validity = checkSettingsText(withValue('appearance.theme', 'NoSuchTheme'), {
      knownThemes: THEMES,
    });
    if (validity.kind !== 'checked') throw new Error('expected a checked document');

    const problem = validity.problems.find((p) => p.key === 'appearance.theme');
    expect(problem, 'a theme that names nothing must be reported').toBeDefined();
    expect(formatSettingsProblem(problem!)).toBe(
      '"Theme" (appearance.theme) must be one of: throng, Matrix, Gothic. Found "NoSuchTheme".',
    );
  });

  it('checks NOTHING when the theme list is not known yet', () => {
    // The list arrives over IPC after the editor mounts. Reporting a theme as unknown while the set
    // of known themes is empty would be reporting a problem that does not exist — and, worse, would
    // block the user during a gap they cannot see or wait out.
    expect(isSettingsTextValid(withValue('appearance.theme', 'NoSuchTheme'))).toBe(true);
    expect(
      isSettingsTextValid(withValue('appearance.theme', 'NoSuchTheme'), { knownThemes: [] }),
    ).toBe(true);
  });

  it('does not report an ABSENT theme', () => {
    // Absence is not malformation, here as everywhere: an omitted theme takes the shipped default.
    const doc = structuredClone(DEFAULT_APP_SETTINGS) as unknown as Record<string, unknown>;
    delete (doc.appearance as Record<string, unknown>).theme;
    expect(isSettingsTextValid(JSON.stringify(doc), { knownThemes: THEMES })).toBe(true);
  });

  it('refuses a non-string theme', () => {
    expect(isSettingsTextValid(withValue('appearance.theme', 7), { knownThemes: THEMES })).toBe(
      false,
    );
  });
});

describe('the registry is the only source of truth', () => {
  it('every reported problem names a real descriptor', () => {
    // Derived, not listed: this cannot drift from `SETTINGS_METADATA` because it is walking it.
    const validity = checkSettingsText(withValue(ENUMERATED.key, '__nope__'));
    if (validity.kind !== 'checked') throw new Error('expected a checked document');
    for (const problem of validity.problems) {
      expect(SETTINGS_METADATA.some((d) => d.key === problem.key)).toBe(true);
    }
  });
});
