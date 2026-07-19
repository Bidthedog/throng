import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * 021 / US7, FR-027–030 — the three-type button model, enforced from the CSS side.
 *
 * Every text dialog/form button is exactly one TYPE (Confirm / Cancel / Destroy) and consumes ONLY
 * that type's six `--throng-colour-<type>Button*` tokens. Two failure modes this guard forbids:
 *
 *  1. A THEMED TEXT BUTTON still borrowing a generic token (`--accent`, `--danger`, `accentText`,
 *     `dangerText`, `--border`) or the retired `--btn-*` alias — which would make it un-typeable: the
 *     theme author's Confirm/Cancel/Destroy dials would not reach it.
 *  2. An ICON control (`IconButton`, the preferences toolbar, the window controls) reaching for a
 *     button-TYPE token — those keep the neutral `hoverSurface`; a `*Button*` token on one of them is
 *     the exclusion (FR-030) violated.
 *
 * The guard walks the tree and reads real rule bodies — it is shaped like the requirement, not like a
 * remembered list of files.
 */

const RENDERER = fileURLToPath(new URL('../../src/renderer', import.meta.url));

function walk(dir: string, match: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...walk(path, match));
    else if (match.test(entry)) out.push(path);
  }
  return out;
}

function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ');
}

interface Rule {
  selectors: string[];
  body: string;
  where: string;
}

/** Every innermost CSS rule (selector list + declaration body), across every stylesheet. */
function rules(): Rule[] {
  const out: Rule[] = [];
  for (const file of walk(RENDERER, /\.css$/)) {
    const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
    const css = stripComments(readFileSync(file, 'utf8'));
    // Innermost rules only: `sel { body }` where body has no braces. Correct even inside @media,
    // because the outer at-rule's own "body" contains braces and is skipped by [^{}] on the body.
    for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selectorText = m[1];
      const body = m[2] ?? '';
      const selectors = selectorText
        .split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '' && !s.startsWith('@') && !s.includes(':root'));
      if (selectors.length === 0) continue;
      const line = css.slice(0, m.index).split('\n').length;
      out.push({ selectors, body, where: `${rel}:${line}` });
    }
  }
  return out;
}

/** Every `--throng-colour-<name>` and alias read inside a rule body. */
function varsRead(body: string): string[] {
  return [...body.matchAll(/var\(\s*(--[a-zA-Z0-9-]+)/g)].map((m) => m[1] ?? '');
}

// The themed TEXT buttons — the three-type classification (data-model §5). These MUST use only their
// type's six tokens.
const TEXT_BUTTON =
  /^\.(project-form__buttons button|modal__buttons button|modal__confirm|capture-modal__btn|panel-type-form__actions button|panel-type-form__confirm|panel-type-form__clear|folder-picker__browse|find-bar-btn)/;

// The ICON controls — the exclusion set (FR-030). These keep `hoverSurface` and MUST NOT touch a
// button-type token.
const ICON_EXCLUSION = /^\.(icon-button|prefs-toolbtn|window-control)/;

// Generic tokens a themed text button may NOT borrow (it would escape its type's dials).
const BORROWED = [
  /var\(\s*--accent\b/,
  /var\(\s*--danger\b/,
  /var\(\s*--border\b/,
  /var\(\s*--throng-colour-accent\b/,
  /var\(\s*--throng-colour-accentText\b/,
  /var\(\s*--throng-colour-danger\b/,
  /var\(\s*--throng-colour-dangerText\b/,
];

const isButtonTypeVar = (name: string): boolean => /--throng-colour-(confirm|cancel|destroy)Button/.test(name);

describe('the three-type button model (FR-027–030)', () => {
  it('has retired every `--btn-*` alias — no declaration and no read remains', () => {
    const offenders: string[] = [];
    for (const file of walk(RENDERER, /\.css$/)) {
      const rel = file.slice(RENDERER.length + 1).replace(/\\/g, '/');
      stripComments(readFileSync(file, 'utf8'))
        .split('\n')
        .forEach((line, i) => {
          if (/(?:^|[{;])\s*--btn-[a-z-]+\s*:/.test(line) || /var\(\s*--btn-/.test(line)) {
            offenders.push(`${rel}:${i + 1}`);
          }
        });
    }
    expect(offenders, `retired --btn-* still present:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('never paints an IconButton / toolbar / window-control with a button-TYPE token', () => {
    const offenders: string[] = [];
    for (const rule of rules()) {
      const usesType = varsRead(rule.body).some(isButtonTypeVar);
      if (!usesType) continue;
      for (const sel of rule.selectors) {
        if (ICON_EXCLUSION.test(sel)) offenders.push(`${sel} (${rule.where})`);
      }
    }
    expect(
      offenders.sort(),
      `icon controls must keep hoverSurface, not a button-type token:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('never leaves a borrowed generic token on a themed text button', () => {
    const offenders: string[] = [];
    for (const rule of rules()) {
      const borrowed = BORROWED.some((re) => re.test(rule.body));
      if (!borrowed) continue;
      for (const sel of rule.selectors) {
        if (TEXT_BUTTON.test(sel)) offenders.push(`${sel} (${rule.where})`);
      }
    }
    expect(
      offenders.sort(),
      `themed text buttons must use only their type's six tokens:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('guard-the-guard: it actually SEES both a text button and an icon control', () => {
    // If neither selector family is present the guard is inert and would pass over any violation.
    const all = rules();
    expect(all.some((r) => r.selectors.some((s) => TEXT_BUTTON.test(s)))).toBe(true);
    expect(all.some((r) => r.selectors.some((s) => ICON_EXCLUSION.test(s)))).toBe(true);
  });
});
