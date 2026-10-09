import { describe, expect, it } from 'vitest';
import {
  DEFAULT_TERMINAL_TITLE_TEMPLATE,
  parseTitleTemplate,
  renderTitleTemplate,
  validateTitleTemplate,
  type TitlePlaceholder,
} from '@throng/core';

/**
 * 053 FR-005 – FR-009 — the terminal title template language (contracts/title-template.md).
 *
 * The whole truth table lives here: every surface that names a terminal renders through these three
 * functions, so a rule proved here is proved everywhere.
 */

const NONE: Record<TitlePlaceholder, string> = {
  command: '',
  app: '',
  arch: '',
  title: '',
  shell: '',
  path: '',
  folder: '',
  project: '',
  admin: '',
};

function render(template: string, values: Partial<Record<TitlePlaceholder, string>> = {}): string {
  const parsed = parseTitleTemplate(template);
  if (!parsed.ok) throw new Error(`did not parse: ${parsed.error}`);
  return renderTitleTemplate(parsed.root, { ...NONE, ...values });
}

const SHELL = { shell: 'Git Bash', path: 'D:\\git\\throng', folder: 'throng' };
const PING = { ...SHELL, command: 'ping localhost -t', app: 'ping' };
const CLAUDE = { ...SHELL, command: 'claude', app: 'claude', title: 'work on links' };

describe('053 FR-009 — the default template', () => {
  it('is the titled-program, else command, else nothing expression', () => {
    expect(DEFAULT_TERMINAL_TITLE_TEMPLATE).toBe(
      '({title} ? "{app}: {title} | " : {command} ? "{command} | " : ""){shell}({path} ? " ({path})" : "")',
    );
  });

  it('a program that titled itself: its name and title first', () => {
    expect(render(DEFAULT_TERMINAL_TITLE_TEMPLATE, CLAUDE)).toBe('claude: work on links | Git Bash (D:\\git\\throng)');
  });

  it('a running command with no title of its own', () => {
    expect(render(DEFAULT_TERMINAL_TITLE_TEMPLATE, PING)).toBe('ping localhost -t | Git Bash (D:\\git\\throng)');
  });

  it('a bare prompt', () => {
    expect(render(DEFAULT_TERMINAL_TITLE_TEMPLATE, SHELL)).toBe('Git Bash (D:\\git\\throng)');
  });

  it('no directory known: no empty brackets', () => {
    expect(render(DEFAULT_TERMINAL_TITLE_TEMPLATE, { shell: 'Git Bash' })).toBe('Git Bash');
  });
});

describe('053 FR-005 — text outside an expression renders as typed', () => {
  it('quotes, question marks, colons and bars are text', () => {
    expect(render('"WOOP" a?b: c | d')).toBe('"WOOP" a?b: c | d');
  });

  it('a placeholder renders its value', () => {
    expect(render('{shell} in {folder}', SHELL)).toBe('Git Bash in throng');
  });

  it('a placeholder not followed by an operator stays in the text, with the spaces after it', () => {
    expect(render('{shell} : {folder}', SHELL)).toBe('Git Bash : throng');
  });

  it('doubled brackets and braces are literal', () => {
    expect(render('{shell} (({folder}))', SHELL)).toBe('Git Bash (throng)');
    expect(render('{{x}}')).toBe('{x}');
  });
});

describe('053 FR-005 — where an expression is', () => {
  it('in brackets', () => {
    expect(render('[({title} ?? "WOOP")]')).toBe('[WOOP]');
  });

  it('without brackets, from a placeholder followed by an operator', () => {
    expect(render('{title} ? "WOOP" : "WAAP"', { title: 'x' })).toBe('WOOP');
    expect(render('{title} ? "WOOP" : "WAAP"')).toBe('WAAP');
  });

  it('an unbracketed expression ends at its last operand; the text after it keeps its spaces', () => {
    expect(render('{title} ?? {app} | {shell}', PING)).toBe('ping | Git Bash');
  });

  it('spaces inside an expression are insignificant', () => {
    expect(render('(   {title}   ??   {app}   )', PING)).toBe('ping');
    expect(render('({title}??{app})', PING)).toBe('ping');
  });

  it('brackets nest inside an expression, closing together freely', () => {
    expect(render('( ({title} ?? {app}) ? "on" : "off")', PING)).toBe('on');
    expect(render('({app} ? ({title} ?? ({app})) : "")', PING)).toBe('ping');
  });

  it('in text, (( is a literal bracket — an expression opening on a bracket needs a space', () => {
    expect(render('(({app}))', PING)).toBe('(ping)');
  });
});

describe('053 FR-006 — operators, with C# meaning and precedence', () => {
  it('?? gives the first value that is not empty', () => {
    expect(render('({title} ?? {app} ?? "none")', { app: 'ping' })).toBe('ping');
    expect(render('({title} ?? {app} ?? "none")')).toBe('none');
  });

  it('a value is true when it is not empty', () => {
    expect(render('({app} ? "yes" : "no")', { app: 'x' })).toBe('yes');
    expect(render('({app} ? "yes" : "no")')).toBe('no');
  });

  it('&& and || combine conditions', () => {
    expect(render('({app} && {title} ? "both" : "not both")', { app: 'a' })).toBe('not both');
    expect(render('({app} && {title} ? "both" : "not both")', { app: 'a', title: 't' })).toBe('both');
    expect(render('({app} || {title} ? "either" : "neither")', { title: 't' })).toBe('either');
    expect(render('({app} || {title} ? "either" : "neither")')).toBe('neither');
  });

  it('! negates', () => {
    expect(render('(!{title} ? "untitled" : "titled")')).toBe('untitled');
    expect(render('(!({app} && {title}) ? "y" : "n")', { app: 'a', title: 't' })).toBe('n');
  });

  it('&& binds tighter than ||, as in C#', () => {
    // a || (b && c): with a set, true whatever b and c are.
    expect(render('({app} || {title} && {path} ? "y" : "n")', { app: 'a' })).toBe('y');
  });

  it('?: is right-associative, as in C#', () => {
    const t = '({title} ? "T" : {command} ? "C" : "-")';
    expect(render(t, { title: 'x', command: 'c' })).toBe('T');
    expect(render(t, { command: 'c' })).toBe('C');
    expect(render(t)).toBe('-');
  });

  it('?? binds tighter than ?:, as in C#', () => {
    expect(render('({title} ?? {app} ? "has" : "none")', { app: 'a' })).toBe('has');
  });

  it('a branch may itself be a bracketed expression', () => {
    expect(render('({app} ? ({title} ?? {app}) : "idle")', PING)).toBe('ping');
  });
});

describe('053 FR-007 — string literals', () => {
  it('render their text, with placeholders replaced', () => {
    expect(render('({app} ? "{app} on {shell}" : "")', PING)).toBe('ping on Git Bash');
  });

  it('brackets, colons and question marks inside a string are text', () => {
    expect(render('({app} ? "(a?b:c)" : "")', PING)).toBe('(a?b:c)');
  });

  it('"" is a quote and {{ }} are braces', () => {
    expect(render('({app} ? "say ""hi"" {{x}}" : "")', PING)).toBe('say "hi" {x}');
  });

  it('an empty string renders nothing', () => {
    expect(render('a("")b')).toBe('ab');
  });
});

describe('053 FR-008 — errors, each with its offset', () => {
  it.each([
    ['(a', 'Expected a placeholder, a "string" or "(" at 1'],
    ['({shell}', 'Unclosed bracket at 0'],
    ['a)', 'Unmatched ")" at 1'],
    ['{a', 'Unclosed "{" at 0'],
    ['a}', 'Unmatched "}" at 1'],
    ['{}', 'Empty placeholder at 0'],
    ['("a', 'Unclosed quote at 1'],
    ['({title} ? "a")', 'Expected ":" at 14'],
    ['({app} || {title})', '"||" gives true or false — use it before "?" at 7'],
    ['({app} && {title})', '"&&" gives true or false — use it before "?" at 7'],
    ['(!{title})', '"!" gives true or false — use it before "?" at 1'],
    ['()', 'Expected a placeholder, a "string" or "(" at 1'],
    ['({title} ??)', 'Expected a placeholder, a "string" or "(" at 11'],
    ['{title} ?', 'Expected a placeholder, a "string" or "(" at 9'],
  ])('%s → %s', (template, message) => {
    expect(parseTitleTemplate(template)).toMatchObject({ ok: false, error: message });
    expect(validateTitleTemplate(template)).toBe(message);
  });

  it('an unknown placeholder names itself and the nine that exist, in text and in a string', () => {
    const list = '{command}, {app}, {arch}, {title}, {shell}, {path}, {folder}, {project} or {admin}';
    expect(validateTitleTemplate('{nope}')).toBe(`Unknown placeholder {nope} at 0 — use ${list}`);
    expect(validateTitleTemplate('({app} ? "{nope}" : "")')).toBe(`Unknown placeholder {nope} at 10 — use ${list}`);
  });

  it('a valid template validates to null', () => {
    expect(validateTitleTemplate(DEFAULT_TERMINAL_TITLE_TEMPLATE)).toBeNull();
    expect(validateTitleTemplate('')).toBeNull();
  });

  it('a non-string is refused, not thrown', () => {
    expect(validateTitleTemplate(42)).toBe('The title template must be text');
  });
});
