import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanSource, type Violation } from './failure-logging-scan.js';

/**
 * 066 SC-002 / SC-003 (FR-011 – FR-013), constitution XIII — no shipped code fails silently.
 *
 * Every `catch` and `.catch(…)` in `packages/*\/src` records what it caught (a logging call, a rethrow
 * or a reject); every `logExpected` states its reason; every process start is watched by its parent or
 * says at the site why not (`// child-exempt: <reason>`). A failure names the file and line.
 */

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const PACKAGES = join(REPO, 'packages');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'dist') continue;
      sourceFiles(path, out);
    } else if (/\.(ts|tsx|cts|mts)$/.test(entry.name) && !entry.name.endsWith('.d.ts')) {
      out.push(path);
    }
  }
  return out;
}

function scanRepo(): Violation[] {
  const all: Violation[] = [];
  for (const pkg of readdirSync(PACKAGES, { withFileTypes: true })) {
    if (!pkg.isDirectory()) continue;
    const src = join(PACKAGES, pkg.name, 'src');
    let files: string[];
    try {
      files = sourceFiles(src);
    } catch {
      continue; // a package without src (a meta package) has nothing to scan
    }
    for (const file of files) all.push(...scanSource(relative(REPO, file), readFileSync(file, 'utf8')));
  }
  return all;
}

const render = (v: Violation): string => `${v.file}:${v.line} ${v.rule} — ${v.text}`;

describe('the scanner (self-test)', () => {
  const scan = (src: string) => scanSource('x.ts', src).map((v) => v.rule);

  it('flags an empty catch and a comment-only catch', () => {
    expect(scan('try { a() } catch {}')).toEqual(['silent-catch']);
    expect(scan('try { a() } catch { /* fine */ }')).toEqual(['silent-catch']);
  });

  it('flags a catch that returns a fallback without logging', () => {
    expect(scan('function f() { try { return a() } catch { return [] } }')).toEqual(['silent-catch']);
  });

  it('accepts a catch that logs, rethrows or rejects', () => {
    expect(scan("try { a() } catch (e) { logCaught('w', e) }")).toEqual([]);
    expect(scan("try { a() } catch (e) { logExpected('w', 'gone', e) }")).toEqual([]);
    expect(scan('try { a() } catch (e) { console.warn(e) }')).toEqual([]);
    expect(scan('try { a() } catch (e) { this.log.error(String(e)) }')).toEqual([]);
    expect(scan('try { a() } catch (e) { throw new Error("x", { cause: e }) }')).toEqual([]);
    expect(scan('new Promise((_, reject) => { try { a() } catch (e) { reject(e) } })')).toEqual([]);
    expect(scan('try { a() } catch (e) { process.stderr.write(String(e)) }')).toEqual([]);
  });

  it('flags a promise .catch that drops the error, and accepts one that logs', () => {
    expect(scan('p.catch(() => {})')).toEqual(['silent-promise-catch']);
    expect(scan('p.catch(() => undefined)')).toEqual(['silent-promise-catch']);
    expect(scan('p.catch(() => [])')).toEqual(['silent-promise-catch']);
    expect(scan("p.catch((e) => logCaught('w', e))")).toEqual([]);
    expect(scan('p.catch(console.warn)')).toEqual([]);
  });

  it('follows a named .catch handler to its definition, and flags one it cannot see (review)', () => {
    expect(scan('const ignore = () => {}; p.catch(ignore)')).toEqual(['silent-promise-catch']);
    expect(scan("const onFail = (e: unknown) => logCaught('w', e); p.catch(onFail)")).toEqual([]);
    expect(scan("function onFail(e: unknown) { logCaught('w', e) } p.catch(onFail)")).toEqual([]);
    expect(scan('p.catch(importedHandler)')).toEqual(['silent-promise-catch']);
    expect(scan('p.catch(noop())')).toEqual(['silent-promise-catch']);
  });

  it('counts error()/warn() as logging only on something that is a log (review)', () => {
    expect(scan("try { a() } catch (e) { toast.error('x') }")).toEqual(['silent-catch']);
    expect(scan("try { a() } catch (e) { setState.error(e) }")).toEqual(['silent-catch']);
    expect(scan("try { a() } catch (e) { diagnostics.log.error('x') }")).toEqual([]);
    expect(scan("try { a() } catch (e) { deps.log('warn', 'x') }")).toEqual([]);
    expect(scan("try { a() } catch (e) { this.logger.warn('x') }")).toEqual([]);
  });

  it('flags a logExpected without a stated reason', () => {
    expect(scan("try { a() } catch (e) { logExpected('w', '', e) }")).toEqual(['unreasoned-expected']);
    expect(scan('try { a() } catch (e) { logExpected("w", reason, e) }')).toEqual(['unreasoned-expected']);
    expect(scan('try { a() } catch (e) { logExpected("w", `gone: ${x}`, e) }')).toEqual([]);
  });

  it('flags an unwatched process start, and accepts a watched or a stated-exempt one', () => {
    expect(scan("function f() { spawn('x', []) }")).toEqual(['unwatched-start']);
    expect(scan("function f() { const c = spawn('x', []); watchChild(c, o) }")).toEqual([]);
    expect(scan("function f() { execFile('x', [], (e, o, s) => { if (e) logChildFailure('x', e, s) }) }")).toEqual([]);
    expect(scan("function f() {\n  // child-exempt: the PTY's exit is tracked by onExit\n  pty.spawn('x', [])\n}")).toEqual([]);
    expect(scan("function f() {\n  // child-exempt:\n  spawn('x', [])\n}")).toEqual(['unwatched-start']);
  });

  it("accepts a stated last resort only around a bare stderr write — the log writer's own fallback", () => {
    const fallback = (body: string) => `try { ${body} } catch {\n  // last-resort: stderr is gone\n}`;
    expect(scan(fallback("process.stderr.write('x')"))).toEqual([]);
    expect(scan(fallback("doWork(); process.stderr.write('x')"))).toEqual(['silent-catch']);
    expect(scan("try { process.stderr.write('x') } catch {}")).toEqual(['silent-catch']);
  });

  it('never reads code inside a string', () => {
    expect(scan("const ps = 'try { x } catch { }'; const js = `p.catch(() => {})`;")).toEqual([]);
  });
});

describe('XIII — no silent failure in packages/*/src (066 SC-002, SC-003)', () => {
  it('every catch records, every expected failure says why, every child is watched', () => {
    const violations = scanRepo();
    expect(violations.map(render), `${violations.length} silent sites:\n${violations.map(render).join('\n')}`).toEqual([]);
  });
});

/**
 * 068 FR-034b — `createFileLog.emit` is the chokepoint where text is anonymised, so nothing else may
 * write into the logs folder. A write call whose destination names the log folder or a `.log` file is
 * flagged anywhere but `node-file-log.ts`. Reading the folder, and writing a file that is not a log
 * (the salt, an anonymised rewrite of `daemon-startup.log` through a variable), are not flagged.
 */
const LOG_WRITER = /\b(?:appendFileSync|writeFileSync|createWriteStream|appendFile|writeFile)\s*\(([^;\n]{0,120})/g;
const LOG_TARGET = /\blogDir\b|\blogsDir\b|LOG_DIR|\.log['"`]|['"`]logs['"`]/;
const CHOKEPOINT = 'packages/platform-node/src/node-file-log.ts';

function scanLogWrites(file: string, source: string): string[] {
  if (file.replaceAll('\\', '/') === CHOKEPOINT) return [];
  const hits: string[] = [];
  for (const match of source.matchAll(LOG_WRITER)) {
    if (LOG_TARGET.test(match[1] ?? '')) hits.push(`${file}: ${match[0].trim()}`);
  }
  return hits;
}

describe('068 FR-034b — the logs folder has one writer', () => {
  it('flags a write into the logs folder and accepts other writes', () => {
    expect(scanLogWrites('a.ts', "appendFileSync(join(logDir, 'x.log'), line)")).toHaveLength(1);
    expect(scanLogWrites('a.ts', "writeFileSync(join(dir, 'daemon-startup.log'), t)")).toHaveLength(1);
    expect(scanLogWrites('a.ts', "createWriteStream(join(process.env.THRONG_LOG_DIR, 'a'))")).toHaveLength(1);
    expect(scanLogWrites('a.ts', 'writeFileSync(path, salt)')).toEqual([]);
    expect(scanLogWrites('a.ts', 'appendFileSync(attentionOsLog, line)')).toEqual([]);
    expect(scanLogWrites(CHOKEPOINT, 'appendFileSync(path, line)')).toEqual([]);
  });

  it('finds no write into the logs folder outside node-file-log.ts', () => {
    const hits: string[] = [];
    for (const pkg of readdirSync(PACKAGES, { withFileTypes: true })) {
      if (!pkg.isDirectory()) continue;
      let files: string[];
      try {
        files = sourceFiles(join(PACKAGES, pkg.name, 'src'));
      } catch {
        continue;
      }
      for (const file of files) hits.push(...scanLogWrites(relative(REPO, file), readFileSync(file, 'utf8')));
    }
    expect(hits).toEqual([]);
  });
});
