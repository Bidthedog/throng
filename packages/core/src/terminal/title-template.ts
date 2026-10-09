/**
 * 053 — the terminal title template language (contracts/title-template.md).
 *
 * A terminal panel's name is rendered from a template the user can edit. Two modes, chosen so a programmer can
 * read a template at a glance:
 *
 * - **Text** renders as typed — quotes, `?` and `:` included — except `{name}`, a placeholder (one of
 *   {@link TITLE_PLACEHOLDERS}), and `((` `))` `{{` `}}`, a literal bracket or brace (FR-005, FR-007).
 * - **An expression** is `( … )`, or a placeholder followed by an operator, running while operators join
 *   operands. Inside it spaces are insignificant, text is a C# string literal (`"…"`, with placeholders replaced,
 *   `""` a quote) and the operators are C#'s, with C#'s precedence: `?:`, `??`, `||`, `&&`, `!` (FR-006). A
 *   value is true when it is not empty; `||`, `&&` and `!` give true or false, which only a `?` may consume.
 *
 * Pure: no I/O, and a parse never throws — a bad template is an error value carrying the offset of the character
 * at fault (FR-008).
 */

/** Every placeholder, in the order the error message and the documentation list them. */
export const TITLE_PLACEHOLDERS = [
  'command',
  'app',
  'arch',
  'title',
  'shell',
  'path',
  'folder',
  'project',
  'admin',
] as const;

export type TitlePlaceholder = (typeof TITLE_PLACEHOLDERS)[number];

/**
 * FR-009 — a program that titled itself, else the running command, else nothing; then the shell and directory:
 * `claude: work on links | Git Bash (D:\git\throng)`, `ping localhost -t | Git Bash (D:\git\throng)`,
 * `Git Bash (D:\git\throng)`.
 */
export const DEFAULT_TERMINAL_TITLE_TEMPLATE =
  '({title} ? "{app}: {title} | " : {command} ? "{command} | " : ""){shell}({path} ? " ({path})" : "")';

/** One piece of a string literal: literal text, or a placeholder rendered in place. */
export type TitleTemplateStringPart = string | { name: TitlePlaceholder };

export type TitleTemplateExpression =
  | { kind: 'placeholder'; name: TitlePlaceholder }
  | { kind: 'string'; parts: TitleTemplateStringPart[] }
  | { kind: 'ternary'; condition: TitleTemplateExpression; then: TitleTemplateExpression; otherwise: TitleTemplateExpression }
  | { kind: 'coalesce'; left: TitleTemplateExpression; right: TitleTemplateExpression }
  | { kind: 'or' | 'and'; left: TitleTemplateExpression; right: TitleTemplateExpression }
  | { kind: 'not'; operand: TitleTemplateExpression };

export type TitleTemplateNode = { kind: 'text'; text: string } | { kind: 'expression'; expression: TitleTemplateExpression };

/** A parsed template: text and expressions, in order. */
export interface TitleTemplate {
  nodes: TitleTemplateNode[];
}

export type TitleTemplateParse = { ok: true; root: TitleTemplate } | { ok: false; error: string; at: number };

const KNOWN = new Set<string>(TITLE_PLACEHOLDERS);

class TemplateError extends Error {
  /** `message at <offset>`, then `hint` — where the remedy reads after the position. */
  constructor(
    message: string,
    readonly at: number,
    hint = '',
  ) {
    super(`${message} at ${at}${hint}`);
  }
}

/** Parse `text` into text and expressions. */
export function parseTitleTemplate(text: string): TitleTemplateParse {
  try {
    return { ok: true, root: { nodes: new Parser(text).template() } };
  } catch (error) {
    if (error instanceof TemplateError) return { ok: false, error: error.message, at: error.at };
    throw error;
  }
}

/** The descriptor's `validate` (FR-008): `null` when `value` is a template that parses, else the message. */
export function validateTitleTemplate(value: unknown): string | null {
  if (typeof value !== 'string') return 'The title template must be text';
  const parsed = parseTitleTemplate(value);
  return parsed.ok ? null : parsed.error;
}

/** Render a parsed template. A placeholder with no value renders empty. */
export function renderTitleTemplate(root: TitleTemplate, values: Record<TitlePlaceholder, string>): string {
  return root.nodes.map((node) => (node.kind === 'text' ? node.text : text(node.expression, values))).join('');
}

function text(e: TitleTemplateExpression, values: Record<TitlePlaceholder, string>): string {
  switch (e.kind) {
    case 'placeholder':
      return values[e.name] ?? '';
    case 'string':
      return e.parts.map((part) => (typeof part === 'string' ? part : (values[part.name] ?? ''))).join('');
    case 'ternary':
      return truth(e.condition, values) ? text(e.then, values) : text(e.otherwise, values);
    case 'coalesce': {
      const left = text(e.left, values);
      return left !== '' ? left : text(e.right, values);
    }
    default:
      // The parser refuses a true-or-false value wherever text is needed.
      return '';
  }
}

function truth(e: TitleTemplateExpression, values: Record<TitlePlaceholder, string>): boolean {
  switch (e.kind) {
    case 'or':
      return truth(e.left, values) || truth(e.right, values);
    case 'and':
      return truth(e.left, values) && truth(e.right, values);
    case 'not':
      return !truth(e.operand, values);
    default:
      return text(e, values) !== '';
  }
}

/** A parsed expression and, for one that gives true or false, the operator that made it so and where. */
interface Parsed {
  e: TitleTemplateExpression;
  condition?: { op: string; at: number };
}

const OPERAND = 'Expected a placeholder, a "string" or "("';

class Parser {
  private i = 0;

  constructor(private readonly s: string) {}

  template(): TitleTemplateNode[] {
    const nodes: TitleTemplateNode[] = [];
    const literal = (t: string): void => {
      const last = nodes.at(-1);
      if (last?.kind === 'text') last.text += t;
      else nodes.push({ kind: 'text', text: t });
    };
    while (this.i < this.s.length) {
      const pair = this.s.slice(this.i, this.i + 2);
      if (pair === '((' || pair === '))' || pair === '{{' || pair === '}}') {
        literal(pair[0]!);
        this.i += 2;
        continue;
      }
      const c = this.s[this.i]!;
      if (c === '(' || (c === '{' && this.operatorFollowsPlaceholder())) {
        nodes.push({ kind: 'expression', expression: this.asText(this.ternary()) });
        continue;
      }
      if (c === '{') {
        nodes.push({ kind: 'expression', expression: this.placeholder() });
        continue;
      }
      if (c === ')') throw new TemplateError('Unmatched ")"', this.i);
      if (c === '}') throw new TemplateError('Unmatched "}"', this.i);
      literal(c);
      this.i += 1;
    }
    return nodes;
  }

  /** In text, does the placeholder at `i` start an unbracketed expression? Moves nothing. */
  private operatorFollowsPlaceholder(): boolean {
    const close = this.s.indexOf('}', this.i + 1);
    if (close < 0) return false;
    let j = close + 1;
    while (this.s[j] === ' ') j += 1;
    const rest = this.s.slice(j, j + 2);
    return rest[0] === '?' || rest === '||' || rest === '&&';
  }

  // ─── expressions, lowest precedence first (C#) ───

  private ternary(): Parsed {
    const condition = this.coalesce();
    if (this.peek() !== '?' || this.peek(2) === '??') return condition;
    this.skip(1);
    const then = this.asText(this.ternary());
    if (this.peek() !== ':') throw new TemplateError('Expected ":"', this.at());
    this.skip(1);
    const otherwise = this.asText(this.ternary());
    return { e: { kind: 'ternary', condition: condition.e, then, otherwise } };
  }

  private coalesce(): Parsed {
    let left = this.or();
    while (this.peek(2) === '??') {
      this.skip(2);
      const right = this.or();
      left = { e: { kind: 'coalesce', left: this.asText(left), right: this.asText(right) } };
    }
    return left;
  }

  private or(): Parsed {
    let left = this.and();
    while (this.peek(2) === '||') {
      const at = this.at();
      this.skip(2);
      left = { e: { kind: 'or', left: left.e, right: this.and().e }, condition: { op: '||', at } };
    }
    return left;
  }

  private and(): Parsed {
    let left = this.unary();
    while (this.peek(2) === '&&') {
      const at = this.at();
      this.skip(2);
      left = { e: { kind: 'and', left: left.e, right: this.unary().e }, condition: { op: '&&', at } };
    }
    return left;
  }

  private unary(): Parsed {
    if (this.peek() === '!') {
      const at = this.at();
      this.skip(1);
      return { e: { kind: 'not', operand: this.unary().e }, condition: { op: '!', at } };
    }
    return this.primary();
  }

  private primary(): Parsed {
    this.skipSpaces();
    const c = this.s[this.i];
    if (c === '{') return { e: this.placeholder() };
    if (c === '"') return { e: this.string() };
    if (c === '(') {
      const opened = this.i;
      this.i += 1;
      const inner = this.ternary();
      this.skipSpaces();
      if (this.i >= this.s.length) throw new TemplateError('Unclosed bracket', opened);
      if (this.s[this.i] !== ')') throw new TemplateError('Expected ")"', this.i);
      this.i += 1;
      return inner;
    }
    throw new TemplateError(OPERAND, this.i);
  }

  /** Text is needed here: a true-or-false value is refused at the operator that produced it. */
  private asText(p: Parsed): TitleTemplateExpression {
    if (p.condition) throw new TemplateError(`"${p.condition.op}" gives true or false — use it before "?"`, p.condition.at);
    return p.e;
  }

  private string(): TitleTemplateExpression {
    const opened = this.i;
    this.i += 1;
    const parts: TitleTemplateStringPart[] = [];
    const literal = (t: string): void => {
      const last = parts.at(-1);
      if (typeof last === 'string') parts[parts.length - 1] = last + t;
      else parts.push(t);
    };
    while (this.i < this.s.length) {
      const pair = this.s.slice(this.i, this.i + 2);
      if (pair === '""' || pair === '{{' || pair === '}}') {
        literal(pair[0]!);
        this.i += 2;
        continue;
      }
      const c = this.s[this.i]!;
      if (c === '"') {
        this.i += 1;
        return { kind: 'string', parts };
      }
      if (c === '{') {
        parts.push({ name: this.placeholder().name });
        continue;
      }
      if (c === '}') throw new TemplateError('Unmatched "}"', this.i);
      literal(c);
      this.i += 1;
    }
    throw new TemplateError('Unclosed quote', opened);
  }

  private placeholder(): { kind: 'placeholder'; name: TitlePlaceholder } {
    const at = this.i;
    const close = this.s.indexOf('}', at + 1);
    if (close < 0) throw new TemplateError('Unclosed "{"', at);
    const name = this.s.slice(at + 1, close);
    if (name === '') throw new TemplateError('Empty placeholder', at);
    if (!KNOWN.has(name)) {
      const all = TITLE_PLACEHOLDERS.map((p) => `{${p}}`);
      throw new TemplateError(`Unknown placeholder {${name}}`, at, ` — use ${all.slice(0, -1).join(', ')} or ${all.at(-1)}`);
    }
    this.i = close + 1;
    return { kind: 'placeholder', name: name as TitlePlaceholder };
  }

  // ─── scanning inside an expression, where spaces are insignificant ───

  /** The next `n` characters after any spaces; moves nothing. */
  private peek(n = 1): string {
    let j = this.i;
    while (this.s[j] === ' ') j += 1;
    return this.s.slice(j, j + n);
  }

  /** The offset of the next character after any spaces; moves nothing. */
  private at(): number {
    let j = this.i;
    while (this.s[j] === ' ') j += 1;
    return j;
  }

  private skip(n: number): void {
    this.i = this.at() + n;
  }

  private skipSpaces(): void {
    this.i = this.at();
  }
}
