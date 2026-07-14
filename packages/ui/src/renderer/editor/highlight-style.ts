/**
 * The highlight style and the long-line guard (016, FR-006/FR-007/FR-008a).
 *
 * Every colour here is a CSS VARIABLE, never a literal. That is the whole trick: the theme writes
 * `--throng-colour-syntaxKeyword`, the style references it, and switching theme repaints code
 * LIVE — no view rebuild, no reparse, no flicker. Bake the colours into the style and a theme
 * change would need every open editor torn down and re-created.
 */
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { EditorView, Decoration, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, type Extension } from '@codemirror/state';

const v = (token: string): string => `var(--throng-colour-${token})`;

/**
 * Lezer tags → the ten theme tokens. Several tags share a token deliberately: a theme author is
 * asked for ten colours, not forty, and "the names a language gives things" is one idea.
 */
export const throngHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier, tags.controlKeyword, tags.moduleKeyword, tags.definitionKeyword], color: v('syntaxKeyword') },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.character], color: v('syntaxString') },
  { tag: [tags.comment, tags.lineComment, tags.blockComment, tags.docComment], color: v('syntaxComment'), fontStyle: 'italic' },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null, tags.atom], color: v('syntaxNumber') },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.standard(tags.typeName), tags.tagName], color: v('syntaxType') },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: v('syntaxFunction') },
  { tag: [tags.variableName, tags.propertyName, tags.attributeName, tags.labelName], color: v('syntaxVariable') },
  { tag: [tags.operator, tags.operatorKeyword, tags.compareOperator, tags.logicOperator, tags.arithmeticOperator], color: v('syntaxOperator') },
  { tag: [tags.punctuation, tags.separator, tags.bracket, tags.paren, tags.brace, tags.squareBracket, tags.angleBracket], color: v('syntaxPunctuation') },
  { tag: [tags.invalid], color: v('syntaxInvalid') },

  /**
   * PROSE (016, FR-006) — markdown, and the prose parts of any document that has them.
   *
   * These were missing, and the effect was total: markdown's grammar loaded, parsed and tokenised
   * perfectly, and then every one of its tags — `heading`, `strong`, `emphasis`, `link`, `monospace`,
   * `quote`, `list` — matched nothing in the ten rules above, all of which describe CODE. So a
   * markdown file was rendered in one flat colour and looked, reasonably enough, like it had no
   * highlighting at all.
   *
   * They are mapped onto the SAME ten theme tokens rather than earning new ones. A theme author is
   * asked for ten colours, not forty (see the note above), and every extra token would need a
   * descriptor, hand-written copy, a completeness test and a value in all fifteen bundled themes —
   * for a distinction most themes would answer with the same colour twice.
   *
   * The weight and slant, though, are markdown's whole point: `**bold**` that is merely a different
   * colour is not bold. So those are carried literally, and heading level is carried by SIZE.
   */
  { tag: [tags.heading, tags.heading1, tags.heading2], color: v('syntaxKeyword'), fontWeight: '700' },
  { tag: [tags.heading3, tags.heading4, tags.heading5, tags.heading6], color: v('syntaxKeyword'), fontWeight: '600' },
  { tag: [tags.strong], color: v('syntaxType'), fontWeight: '700' },
  { tag: [tags.emphasis], color: v('syntaxType'), fontStyle: 'italic' },
  { tag: [tags.strikethrough], color: v('syntaxComment'), textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: v('syntaxFunction'), textDecoration: 'underline' },
  // Inline code and fenced blocks read as literal content — the same idea as a string.
  { tag: [tags.monospace], color: v('syntaxString') },
  // A block quotation is somebody else's words: the same "not the main voice" role as a comment.
  { tag: [tags.quote], color: v('syntaxComment'), fontStyle: 'italic' },
  // The bullets, the `#`s, the backticks — the marks that make the structure, not the content.
  { tag: [tags.list, tags.contentSeparator, tags.processingInstruction], color: v('syntaxPunctuation') },
]);

/**
 * The one line-level exception to "every file is fully highlighted" (FR-008a).
 *
 * A single line beyond this length — a minified bundle, a base64 blob — is rendered as plain text.
 * Highlighting cost tracks the VISIBLE REGION, not document size, so a huge file is not a problem;
 * a huge LINE is, because it is all visible at once and the parser cannot skip it.
 *
 * FIXED, not configurable: exposing it would demand a descriptor, Settings exposure and
 * completeness coverage (FR-022) for a knob with no user value.
 */
export const LONG_LINE_THRESHOLD = 10_000;

/**
 * Suppress highlighting on any line longer than {@link LONG_LINE_THRESHOLD}, while the REST of the
 * document highlights normally and the line itself stays fully editable. The decoration paints the
 * default foreground over whatever the grammar produced — the line is still parsed, but it is not
 * painted, which is where the cost lives.
 */
const longLinePlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = this.build(view);
    }

    update(update: ViewUpdate): void {
      if (update.docChanged || update.viewportChanged) this.decorations = this.build(update.view);
    }

    build(view: EditorView): DecorationSet {
      const builder = new RangeSetBuilder<Decoration>();
      for (const { from, to } of view.visibleRanges) {
        let pos = from;
        while (pos <= to) {
          const line = view.state.doc.lineAt(pos);
          if (line.length > LONG_LINE_THRESHOLD) {
            builder.add(line.from, line.from, Decoration.line({ class: 'cm-throng-plain-line' }));
          }
          pos = line.to + 1;
        }
      }
      return builder.finish();
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/** The plain-text treatment a long line falls back to: the editor's ordinary foreground. */
const longLineTheme = EditorView.theme({
  '.cm-throng-plain-line span': {
    color: 'var(--throng-colour-editorFg) !important',
    fontStyle: 'normal !important',
  },
});

/** Syntax highlighting, theme-driven, with the long-line guard. Mount once per view. */
export const throngHighlighting: Extension = [
  syntaxHighlighting(throngHighlightStyle),
  longLinePlugin,
  longLineTheme,
];
