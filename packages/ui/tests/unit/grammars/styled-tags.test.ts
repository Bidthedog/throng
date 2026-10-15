/**
 * Every tag the 055 grammars emit is STYLED (055 FR-020, SC-006).
 *
 * A grammar that loads, parses and tokenises perfectly still renders flat if its tags match nothing
 * in `throngHighlightStyle` — 016 hit exactly that with markdown's prose tags. Legibility per theme is
 * the existing theme-syntax tests' job; this proves every new tag lands on one of the tokens they check.
 */
import { describe, expect, it } from 'vitest';
import { getStyleTags, tags, type Tag } from '@lezer/highlight';
import { ensureSyntaxTree, type StreamParser } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { loadLanguage } from '../../../src/renderer/editor/language-loaders.js';
import { throngHighlightStyle } from '../../../src/renderer/editor/highlight-style.js';
import { batch } from '../../../src/renderer/editor/grammars/batch.js';
import { dotenv } from '../../../src/renderer/editor/grammars/dotenv.js';
import { ignore } from '../../../src/renderer/editor/grammars/ignore.js';
import { tokenize } from './tokenize.js';

/** A fixture per hand-written grammar that exercises every form its requirement names. */
const FIXTURES: readonly [string, StreamParser<unknown>, string][] = [
  ['batch', batch as StreamParser<unknown>, '@echo off\nREM x\n:: y\n:build\ngoto build\nset A="v" & echo %A% %~dp0 %%i !B! 2>&1 a^&b'],
  ['dotenv', dotenv as StreamParser<unknown>, '# c\nexport K=v # n\nQ="q"\nU=${H}/x'],
  ['ignore', ignore as StreamParser<unknown>, '# c\n!keep\n*.png binary -diff'],
];

/** A short, representative file per shipped legacy grammar 055 wires up. */
const SHIPPED_FIXTURES: Readonly<Record<string, string>> = {
  diff: '--- a/x\n+++ b/x\n@@ -1,2 +1,2 @@\n-old\n+new\n same',
  protobuf: 'syntax = "proto3";\n// c\nmessage M { int32 id = 1; repeated string s = 2; }',
  cmake: '# c\ncmake_minimum_required(VERSION 3.20)\nset(VAR "v" ${OTHER})\nif(WIN32)\nendif()',
  groovy: '// c\nclass A { def x = "s"; int n = 1; @Override String go() { return "${x}" } }',
  fsharp: '// c\nlet add x y = x + y\ntype T = { A: int }\nmatch v with | Some s -> "s" | None -> ""',
  vb: "' c\nPublic Function F(x As Integer) As String\n  Return \"s\" & 1\nEnd Function",
  vbscript: "' c\nDim x\nx = \"s\" & 1\nIf x Then MsgBox x End If",
  scala: '// c\nobject M { def f(x: Int): String = s"v $x"; val n = 1 }',
  perl: '# c\nmy $x = "s";\nsub f { return @_ }\nprint $x =~ /re/ ? 1 : 0;',
  r: '# c\nf <- function(x) { x + 1L }\ny <- c("a", TRUE, NULL)',
  haskell: '-- c\nmodule M where\nf :: Int -> String\nf x = show (x + 1) ++ "s"',
  elm: '-- c\nmodule M exposing (f)\nf : Int -> String\nf x = String.fromInt x ++ "s"',
  erlang: '% c\n-module(m).\nf(X) -> {ok, "s", X + 1, atom}.',
  clojure: '; c\n(defn f [x] (str "s" (+ x 1) :kw nil true))',
  julia: '# c\nfunction f(x::Int)\n  return "s$(x)" * string(1.5)\nend',
  http: 'POST /api HTTP/1.1\nContent-Type: application/json\n\n{"a": 1}',
  gherkin: '# c\n@tag\nFeature: F\n  Scenario: S\n    Given a "thing" with <x>\n    | a | b |',
  jinja: '{# c #}\n{% if x %}{{ name | upper }}{% endif %} "s" 1',
  nsis: '; c\n!include "x.nsh"\nSection "Main"\n  StrCpy $0 "s"\nSectionEnd',
  nginx: '# c\nserver {\n  listen 80;\n  location / { proxy_pass http://up; }\n}',
  dockerfile: '# c\nFROM node:24 AS build\nARG V=1\nENV A="s" B=$V\nRUN echo "${A}" && npm ci\nCOPY . /app',
};

describe('every tag a shipped grammar emits is styled (055 FR-020, SC-006)', () => {
  it.each(Object.keys(SHIPPED_FIXTURES))('%s', async (id) => {
    const support = await loadLanguage(id);
    expect(support, `${id} loaded nothing`).not.toBeNull();
    const state = EditorState.create({ doc: SHIPPED_FIXTURES[id]!, extensions: [support!] });
    const tree = ensureSyntaxTree(state, state.doc.length, 5000);
    expect(tree, `${id} did not finish parsing`).not.toBeNull();
    const unstyled = new Set<string>();
    let tagged = 0;
    tree!.iterate({
      enter(node) {
        const rule = getStyleTags(node);
        if (!rule) return;
        tagged++;
        if (throngHighlightStyle.style(rule.tags) === null) unstyled.add(`${node.type.name} "${state.sliceDoc(node.from, node.to)}"`);
      },
    });
    expect(tagged, `${id} emitted no highlight tags at all`).toBeGreaterThan(0);
    expect([...unstyled], `${id}: these would render flat`).toEqual([]);
  });
});

describe('every tag a hand-written grammar emits is styled (FR-020, SC-006)', () => {
  it.each(FIXTURES)('%s', (_name, parser, source) => {
    const emitted = new Set(tokenize(parser, source).flat().map(([, style]) => style).filter((s): s is string => s !== null));
    expect(emitted.size).toBeGreaterThan(0);
    for (const name of emitted) {
      const tag = (tags as unknown as Record<string, Tag | undefined>)[name];
      expect(tag, `"${name}" is not a highlight tag`).toBeDefined();
      expect(throngHighlightStyle.style([tag!]), `"${name}" would render unstyled`).not.toBeNull();
    }
  });
});

describe('the diff grammar’s tags are styled (research R6)', () => {
  it.each([
    ['inserted', tags.inserted],
    ['deleted', tags.deleted],
    ['meta', tags.meta],
  ])('styles %s', (_name, tag) => {
    expect(throngHighlightStyle.style([tag])).not.toBeNull();
  });
});
