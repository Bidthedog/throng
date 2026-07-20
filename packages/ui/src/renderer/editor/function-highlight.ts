/**
 * Function-name colouring for the legacy StreamLanguage languages (021, #84 follow-up).
 *
 * PROBLEM. Ten languages have no first-class Lezer grammar and are highlighted by a wrapped
 * CodeMirror-5 mode (see `language-loaders.ts`): C#, Kotlin, Dart, Swift, Ruby, Lua, PowerShell,
 * Shell, TOML, INI. Those modes tokenise a function/method NAME as a plain `variable`/`def`, which
 * reaches the highlight style as `variableName`/`variableName.definition` and is painted with
 * `syntaxVariable`. So a function name is the same colour as an ordinary variable — the exact thing
 * the theme's dedicated `syntaxFunction` token exists to distinguish.
 *
 * The first-class grammars (JS/TS/JSON/Python/…) already tag `tags.function(...)` correctly and are
 * painted with `syntaxFunction` (`highlight-style.ts`). They MUST NOT be touched — this overlay is
 * mounted ONLY for the legacy set (see {@link functionHighlightFor}), so it can never fight a
 * grammar that already gets this right.
 *
 * APPROACH. A `ViewPlugin` that scans the VISIBLE text for identifiers in "function position" and
 * paints just the name with `syntaxFunction`, as an inline `!important` colour so it re-themes live
 * (the value is a CSS variable) and out-ranks the `variableName` span underneath it. "Function
 * position" is:
 *   - a CALL: an identifier immediately followed by `(` — `Foo(`, `greet(`, `WriteLine(`; and
 *   - a DEFINITION: a name introduced by a definition keyword — `def NAME`, `function NAME`,
 *     `func NAME`, `fun NAME`, `sub NAME`, … — which catches the no-paren forms (Ruby `def to_s`,
 *     PowerShell `function Get-Thing`).
 *
 * Every candidate is then filtered through the SYNTAX TREE: a match is kept only if the token there
 * is an identifier (`variableName…`/`propertyName`) or is untokenised (Shell does not tokenise its
 * function names at all — they resolve to the document's top node). Anything the mode already
 * tokenised as a keyword, string, comment, number, type, operator or punctuation is dropped. That
 * single check is what makes the heuristic safe: `if (`, `while (`, `return (` are `keyword` tokens
 * and are skipped for free, and a `foo(` sitting inside a `"string"` or a `# comment` is skipped
 * because it resolves to that string/comment node — no per-language string parsing needed here. A
 * small keyword-exclusion table (below) is a second belt for the untokenised (Shell) case.
 */
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from '@codemirror/view';
import { RangeSetBuilder, type EditorState, type Extension } from '@codemirror/state';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

/**
 * The legacy StreamLanguage languages the overlay is mounted for.
 *
 * TOML and INI also load via StreamLanguage but are DELIBERATELY excluded: neither has a function
 * concept, so there is nothing to recolour, and running the heuristic over them could only invent a
 * false positive on an identifier that happened to precede a `(` inside a value. The eight here are
 * exactly the legacy languages that DO have functions/methods.
 */
export const FUNCTION_OVERLAY_LANGUAGES: ReadonlySet<string> = new Set([
  'csharp',
  'kotlin',
  'dart',
  'swift',
  'ruby',
  'lua',
  'powershell',
  'shell',
]);

/**
 * Keywords that can be written as `keyword(` and must never be coloured as a function.
 *
 * ONE table, lower-cased, shared across every family — control flow, declarations and the handful
 * of contextual keywords (C#'s `nameof`/`sizeof`, PowerShell's `param`/`process`, the shell's
 * `fi`/`esac`/`done`). It is mostly a SECOND line of defence: for a tokenised language these words
 * arrive as `keyword` nodes and are already dropped by the tree filter. It does the real work only
 * for Shell, whose function names are untokenised, where a bare `if(`/`select(` would otherwise slip
 * through as "an identifier before a paren".
 */
const EXCLUDED_KEYWORDS: ReadonlySet<string> = new Set([
  // control flow
  'if', 'elif', 'elsif', 'else', 'elseif', 'for', 'foreach', 'while', 'until', 'unless',
  'switch', 'case', 'when', 'catch', 'try', 'finally', 'do', 'done', 'then', 'fi', 'esac',
  'return', 'throw', 'throws', 'yield', 'break', 'continue', 'goto', 'guard', 'defer', 'repeat',
  'with', 'select', 'where',
  // operators-as-words / expression keywords
  'in', 'is', 'as', 'new', 'typeof', 'sizeof', 'nameof', 'checked', 'unchecked', 'stackalloc',
  'default', 'delete', 'and', 'or', 'not', 'xor', 'await', 'async',
  // block / scope words
  'begin', 'end', 'super', 'base', 'this', 'self', 'lock', 'fixed', 'using', 'local',
  // declarations
  'val', 'var', 'let', 'const', 'def', 'function', 'func', 'fun', 'sub', 'class', 'struct',
  'enum', 'interface', 'protocol', 'extension', 'namespace', 'module', 'package', 'import',
  'include', 'require', 'from',
  // modifiers
  'static', 'public', 'private', 'protected', 'internal', 'override', 'virtual', 'abstract',
  'final', 'sealed', 'readonly', 'operator',
  // PowerShell block keywords
  'param', 'process', 'dynamicparam', 'filter', 'workflow', 'trap', 'configuration',
]);

/** Definition-introducing keywords: the word right before a name being DECLARED. */
const DEFINITION_KEYWORDS = ['def', 'function', 'func', 'fun', 'sub', 'method', 'proc', 'macro'];

// Call names are plain identifiers. Definition names additionally allow internal hyphens so a
// PowerShell `function Get-Thing` is captured whole (its own mode emits it as one token).
const CALL_IDENT = '[A-Za-z_][A-Za-z0-9_]*';
const DEF_IDENT = '[A-Za-z_][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)*';

/** An identifier immediately before `(` — a call, or a C-family method/function declaration. */
const CALL_RE = new RegExp(`(${CALL_IDENT})(?=\\()`, 'g');
/** A definition keyword followed by the name it introduces (`def foo`, `function Get-Thing`). */
const DEF_RE = new RegExp(`\\b(?:${DEFINITION_KEYWORDS.join('|')})[ \\t]+(${DEF_IDENT})`, 'g');

/**
 * Is the token at `pos` an identifier we may recolour?
 *
 * `true` for an identifier token (`variableName`, `variableName.definition`,
 * `variableName.standard`, `propertyName`) and for an UNTOKENISED position — the document's top
 * node — which is how Shell's function names surface (its mode tokenises neither the declaration nor
 * the call). `false` for everything the mode DID classify as something else: a keyword, string,
 * comment, number, type, operator or punctuation is, by construction, not a function name.
 */
function isIdentifierPosition(state: EditorState, pos: number): boolean {
  const tree = ensureSyntaxTree(state, pos + 1, 50) ?? syntaxTree(state);
  const node = tree.resolveInner(pos, 1);
  if (node.type.isTop) return true; // untokenised (e.g. a Shell function name)
  const name = node.name;
  return name.startsWith('variableName') || name === 'propertyName';
}

/**
 * The ranges to paint as functions within `[from, to)`, sorted and non-overlapping.
 *
 * Pure and view-free so it can be unit-tested against a real StreamLanguage state without a DOM.
 */
export function functionRanges(
  state: EditorState,
  from: number,
  to: number,
): Array<{ from: number; to: number }> {
  const text = state.doc.sliceString(from, to);
  const found: Array<{ from: number; to: number }> = [];

  const consider = (name: string, start: number): void => {
    if (EXCLUDED_KEYWORDS.has(name.toLowerCase())) return;
    if (!isIdentifierPosition(state, start)) return;
    found.push({ from: start, to: start + name.length });
  };

  for (const m of text.matchAll(CALL_RE)) {
    // Group 1 is anchored at the match start, so its offset is the match index.
    consider(m[1], from + (m.index ?? 0));
  }
  for (const m of text.matchAll(DEF_RE)) {
    // The name is captured at the END of the match (keyword + whitespace precede it).
    const name = m[1];
    consider(name, from + (m.index ?? 0) + (m[0].length - name.length));
  }

  found.sort((a, b) => a.from - b.from || a.to - b.to);
  const out: Array<{ from: number; to: number }> = [];
  let lastEnd = -1;
  for (const r of found) {
    if (r.from < lastEnd) continue; // a call and a definition can name the same span — keep one
    out.push(r);
    lastEnd = r.to;
  }
  return out;
}

/**
 * The paint — a class the overlay stamps on the identifier's span. The COLOUR is applied by
 * {@link functionHighlightTheme} below, not inline, and that is deliberate: this decoration nests
 * as the OUTER span, wrapping the mode's own `variableName` highlight span, so an inline colour on
 * the outer element would never reach the inner element that actually paints the glyphs. The theme
 * rule targets that inner span directly (exactly as `highlight-style.ts`'s long-line guard does).
 */
const functionMark = Decoration.mark({ class: 'cm-throng-fn' });

/**
 * Paint the function name with `syntaxFunction`, on both the overlay span and any highlight span it
 * wraps. A live CSS variable, so a theme change repaints it with no rebuild; `!important` beats the
 * mode's `variableName` colour (which is class-based and not important). Injected via
 * `EditorView.theme` — an in-module style, NOT a stylesheet edit — and mounted only alongside the
 * overlay (legacy languages), so it can match nothing anywhere else.
 */
const functionHighlightTheme = EditorView.theme({
  '.cm-throng-fn, .cm-throng-fn span': {
    color: 'var(--throng-colour-syntaxFunction) !important',
  },
});

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    for (const r of functionRanges(view.state, from, to)) {
      builder.add(r.from, r.to, functionMark);
    }
  }
  return builder.finish();
}

/**
 * The overlay itself — visible-range only, rebuilt on edit, scroll, and when the language's parse
 * advances (the tree filter needs the freshly-parsed tokens, e.g. a string that had not been parsed
 * yet the first time a line scrolled into view).
 */
const functionHighlightPlugin: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = buildDecorations(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * The overlay for `languageId`: the plugin for a legacy StreamLanguage language, nothing otherwise.
 *
 * Returning `[]` for every first-class language is what guarantees no double-decoration — a JS/TS/
 * Python editor never mounts this, so its grammar-driven `syntaxFunction` colouring is left exactly
 * as it was. `applyLanguage` feeds this into {@link functionHighlightCompartment} on every language
 * change, so re-pointing a panel from Ruby to JavaScript removes the overlay in the same dispatch
 * that swaps the grammar.
 */
export function functionHighlightFor(languageId: string): Extension {
  return FUNCTION_OVERLAY_LANGUAGES.has(languageId)
    ? [functionHighlightPlugin, functionHighlightTheme]
    : [];
}
