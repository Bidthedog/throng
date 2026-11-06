import ts from 'typescript';

/**
 * 066 FR-011 / FR-012 / FR-013 — the scanner behind `failure-logging-guard.test.ts`.
 *
 * Parsed with the TypeScript compiler, not matched with regexes, so `catch` inside a PowerShell string
 * or a worker's source text is never mistaken for code (research R6).
 *
 * A catch LOGS when its body calls one of the logging names below, or rethrows / rejects. It is a
 * deliberately small vocabulary: the names say what a catch meant, and anything outside it is either
 * renamed into it or added here with the reason it records a failure.
 */

/**
 * What counts as recording a failure:
 * - a call whose own name is a log — `log…` / `…Log` (`logCaught`, `logAt`, `this.log`, `agentLog`) —
 *   or `reportOwnFailure` (the file logger's own failures, to stderr);
 * - a level method (`error`, `warn`, …) only on something that IS a log: `console`, a `logger`, the
 *   `diagnostics` object, or anything named `…log` (`this.log.error`, `diagnostics.log.warn`). `toast.error`
 *   and `setState.error` are not logs.
 */
const LEVEL_METHODS = new Set(['fatal', 'error', 'warn', 'info', 'debug']);
const LOG_RECEIVER = /(^|\.)(console|logger|diagnostics|[A-Za-z_$]*[lL]og)$/;

function isLogName(name: string): boolean {
  return /^log/i.test(name) || /Log$/.test(name) || name === 'reportOwnFailure';
}

function isLoggingCallee(callee: ts.Expression): boolean {
  if (ts.isIdentifier(callee)) return isLogName(callee.text);
  if (ts.isPropertyAccessExpression(callee)) {
    const name = callee.name.text;
    if (isLogName(name)) return true;
    return LEVEL_METHODS.has(name) && LOG_RECEIVER.test(callee.expression.getText());
  }
  return false;
}

/** Process starts the parent must watch. */
const START_NAMES = new Set(['spawn', 'fork', 'execFile', 'execFileSync', 'spawnSync', 'execFileOffLoop']);

/** Calls that make a start watched. */
const WATCH_NAMES = new Set(['watchChild', 'logChildFailure']);

/**
 * The one catch nothing can record: a write to stderr — the log writer's own last resort — that threw.
 * Accepted only when the try block does nothing BUT write to stderr and the catch says why at the site
 * (contract *The logger's own failures*, spec FR-013).
 */
export const LAST_RESORT = /\/\/[ \t]*last-resort:[ \t]*\S/;

function isLastResort(clause: ts.CatchClause, source: string): boolean {
  const tryStatement = clause.parent;
  if (!ts.isTryStatement(tryStatement)) return false;
  const statements = tryStatement.tryBlock.statements;
  const onlyStderr =
    statements.length > 0 &&
    statements.every((s) => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression) && isStderrWrite(s.expression));
  return onlyStderr && LAST_RESORT.test(source.slice(clause.block.getStart(), clause.block.getEnd()));
}

export const CHILD_EXEMPT = /\/\/[ \t]*child-exempt:[ \t]*\S/;

export interface Violation {
  file: string;
  line: number;
  rule: 'silent-catch' | 'silent-promise-catch' | 'unreasoned-expected' | 'unwatched-start';
  text: string;
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function isStderrWrite(call: ts.CallExpression): boolean {
  const e = call.expression;
  return ts.isPropertyAccessExpression(e) && e.name.text === 'write' && /\bstderr$/.test(e.expression.getText());
}

/** Does this subtree record the failure: a logging call, a throw, or a reject? */
function records(node: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isThrowStatement(n)) {
      found = true;
      return;
    }
    if (ts.isCallExpression(n)) {
      if (isLoggingCallee(n.expression) || calleeName(n) === 'reject' || isStderrWrite(n)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** The innermost function (or the file) a node sits in — the scope a start's watching is looked for in. */
function enclosingScope(node: ts.Node): ts.Node {
  let n: ts.Node | undefined = node.parent;
  while (n && !ts.isFunctionLike(n) && !ts.isSourceFile(n)) n = n.parent;
  return n ?? node.getSourceFile();
}

function callsAnyOf(node: ts.Node, names: ReadonlySet<string>): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (ts.isCallExpression(n)) {
      const name = calleeName(n);
      if (name && names.has(name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

/** The body of a function declared in this file under `name` (a declaration, or a const holding one). */
function definitionBody(sf: ts.SourceFile, name: string): ts.Node | undefined {
  let body: ts.Node | undefined;
  const visit = (n: ts.Node): void => {
    if (body) return;
    if (ts.isFunctionDeclaration(n) && n.name?.text === name && n.body) body = n.body;
    else if (
      ts.isVariableDeclaration(n) &&
      ts.isIdentifier(n.name) &&
      n.name.text === name &&
      n.initializer &&
      (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))
    ) {
      body = n.initializer.body;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return body;
}

function isNonEmptyReason(arg: ts.Expression | undefined): boolean {
  if (!arg) return false;
  if (ts.isStringLiteral(arg) || ts.isNoSubstitutionTemplateLiteral(arg)) return arg.text.trim() !== '';
  if (ts.isTemplateExpression(arg)) return arg.head.text.trim() !== '' || arg.templateSpans.some((s) => s.literal.text.trim() !== '');
  return false;
}

export function scanSource(file: string, source: string): Violation[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: Violation[] = [];
  const at = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const lineText = (line: number): string => source.split('\n')[line - 1]?.trim() ?? '';
  const push = (node: ts.Node, rule: Violation['rule']): void => {
    const line = at(node);
    out.push({ file, line, rule, text: lineText(line).slice(0, 120) });
  };

  const visit = (node: ts.Node): void => {
    if (ts.isCatchClause(node) && !records(node.block) && !isLastResort(node, source)) push(node, 'silent-catch');

    if (ts.isCallExpression(node)) {
      const name = calleeName(node);

      if (name === 'catch' && ts.isPropertyAccessExpression(node.expression)) {
        const handler = node.arguments[0];
        let ok = false;
        if (handler === undefined) ok = false;
        else if (ts.isArrowFunction(handler) || ts.isFunctionExpression(handler)) ok = records(handler.body);
        else if (ts.isIdentifier(handler) || ts.isPropertyAccessExpression(handler)) {
          // `.catch(console.warn)`, `.catch(logCaughtHere)`, or a handler defined in this file — followed to
          // its body. One defined elsewhere cannot be seen, so it does not count.
          const body = ts.isIdentifier(handler) ? definitionBody(sf, handler.text) : undefined;
          ok = isLoggingCallee(handler) || (body !== undefined && records(body));
        }
        // `.catch(makeHandler())` builds its handler at runtime: nothing here can see what it does.
        if (!ok) push(node.expression.name, 'silent-promise-catch');
      }

      if (name === 'logExpected' && !isNonEmptyReason(node.arguments[1])) push(node, 'unreasoned-expected');

      if (name && START_NAMES.has(name) && !(ts.isPropertyAccessExpression(node.expression) && /^(this|Atomics)$/.test(node.expression.expression.getText()))) {
        const line = at(node);
        const before = source.split('\n').slice(Math.max(0, line - 3), line).join('\n');
        const watched = callsAnyOf(enclosingScope(node), WATCH_NAMES) || CHILD_EXEMPT.test(before);
        if (!watched) push(node, 'unwatched-start');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}
