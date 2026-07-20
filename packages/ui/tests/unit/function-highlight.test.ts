import { describe, expect, it } from 'vitest';
import { StreamLanguage } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import {
  FUNCTION_OVERLAY_LANGUAGES,
  functionHighlightFor,
  functionRanges,
} from '../../src/renderer/editor/function-highlight.js';

/**
 * 021 (#84 follow-up) — function-name colouring for the legacy StreamLanguage languages.
 *
 * The overlay's detection is pure (`functionRanges` takes a state, not a view), so it is exercised
 * here against REAL wrapped CodeMirror-5 modes — the exact tokenisers the app loads — with no DOM.
 * Each case asserts the function NAMES that must be recoloured and, just as importantly, the
 * variables / keywords / string contents that must NOT be.
 */
async function detected(modPath: string, key: string, code: string): Promise<string[]> {
  const mod = (await import(modPath)) as Record<string, unknown>;
  const lang = StreamLanguage.define(mod[key] as Parameters<typeof StreamLanguage.define>[0]);
  const state = EditorState.create({ doc: code, extensions: [lang] });
  return functionRanges(state, 0, code.length).map((r) => state.doc.sliceString(r.from, r.to));
}

describe('functionRanges — legacy StreamLanguage function detection', () => {
  it('colours C# method declarations and calls, not their locals', async () => {
    const names = await detected(
      '@codemirror/legacy-modes/mode/clike',
      'csharp',
      'int Adder(int operand) {\n  int total = operand;\n  return total;\n}\nint result = Adder(5);\n',
    );
    expect(names).toContain('Adder'); // declaration `Adder(` and call `Adder(5)`
    expect(names).not.toContain('operand');
    expect(names).not.toContain('total');
    expect(names).not.toContain('result');
    expect(names).not.toContain('return'); // `return` is a keyword token → dropped by the tree filter
  });

  it('colours a Ruby def name (no parens) and a call, not the locals', async () => {
    const names = await detected(
      '@codemirror/legacy-modes/mode/ruby',
      'ruby',
      'def greet\n  total = compute(name)\n  total\nend\ngreet\n',
    );
    expect(names).toContain('greet'); // `def greet` — no parentheses, caught by the definition form
    expect(names).toContain('compute'); // `compute(name)` — a call
    expect(names).not.toContain('total');
    expect(names).not.toContain('name');
    expect(names).not.toContain('end');
  });

  it('colours Lua function definitions and calls, not variables', async () => {
    const names = await detected(
      '@codemirror/legacy-modes/mode/lua',
      'lua',
      'local function greet(name)\n  print(name)\n  return helper(name)\nend\ngreet(x)\n',
    );
    expect(names).toContain('greet');
    expect(names).toContain('print');
    expect(names).toContain('helper');
    expect(names).not.toContain('name');
    expect(names).not.toContain('x');
    expect(names).not.toContain('local');
  });

  it('colours a Shell function name even though the mode leaves it untokenised', async () => {
    const names = await detected(
      '@codemirror/legacy-modes/mode/shell',
      'shell',
      'greet() {\n  echo "call foo() inside a string"\n}\ngreet bar\n',
    );
    expect(names).toContain('greet'); // `greet()` — untokenised, resolves to the top node
    // `foo(` sits inside a "string" token, so the tree filter must drop it.
    expect(names).not.toContain('foo');
    // `echo` and the `greet` call have no parens, so they are never candidates.
    expect(names).not.toContain('echo');
  });

  it('colours a hyphenated PowerShell function name, not its cmdlet calls', async () => {
    const names = await detected(
      '@codemirror/legacy-modes/mode/powershell',
      'powerShell',
      'function Get-Greeting {\n  Write-Host "hi"\n}\nGet-Greeting\n',
    );
    expect(names).toContain('Get-Greeting'); // whole hyphenated name, via the definition form
    expect(names).not.toContain('Write-Host'); // a call with no parens — not a candidate
  });

  it('never colours an identifier inside a comment', async () => {
    const names = await detected(
      '@codemirror/legacy-modes/mode/swift',
      'swift',
      'func greet() {\n  // ignored(this)\n  return\n}\ngreet()\n',
    );
    expect(names).toContain('greet');
    expect(names).not.toContain('ignored'); // inside a `// comment` token
  });
});

describe('functionHighlightFor — gating to the legacy set only', () => {
  it('lists the eight function-bearing legacy languages and excludes toml/ini', () => {
    expect([...FUNCTION_OVERLAY_LANGUAGES].sort()).toEqual(
      ['csharp', 'dart', 'kotlin', 'lua', 'powershell', 'ruby', 'shell', 'swift'].sort(),
    );
    expect(FUNCTION_OVERLAY_LANGUAGES.has('toml')).toBe(false);
    expect(FUNCTION_OVERLAY_LANGUAGES.has('ini')).toBe(false);
  });

  it('returns the overlay for a legacy language and nothing for a first-class grammar', () => {
    // A first-class grammar (JS/TS/Python) already colours functions via `tags.function(...)`, so
    // the overlay must be absent there — an empty extension — to avoid double-decorating it.
    expect(functionHighlightFor('javascript')).toEqual([]);
    expect(functionHighlightFor('typescript')).toEqual([]);
    expect(functionHighlightFor('python')).toEqual([]);
    expect(functionHighlightFor('ruby')).not.toEqual([]);
    expect(functionHighlightFor('csharp')).not.toEqual([]);
  });
});
