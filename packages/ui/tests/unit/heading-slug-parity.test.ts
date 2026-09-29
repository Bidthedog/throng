/**
 * The pipeline's headings and the editor's headings slug IDENTICALLY (047 T006, research R2).
 *
 * Two independent producers build the shared `HeadingRecord` model: the Markdown pipeline
 * (`preview/providers/markdown/pipeline.ts`, markdown-it tokens, T004/T005) and the editor
 * (`editor/markdown-headings.ts`, the CodeMirror Lezer tree, T007). They must agree on every slug —
 * it is what `#links` target (R2, "why the slug is the identity") and what folding keys by (R3) — so
 * ONE fixture is run through both and their slug lists compared. Text and level are asserted too,
 * since a slug that merely matches by coincidence while the text differs would be a worse bug, not a
 * smaller one.
 *
 * The fixture exercises everything R2 calls out: setext headings, duplicate text (the de-dup
 * suffixing must land the SAME suffix on both sides), inline markup (stripped identically by core's
 * shared `markdownInlineText`), front matter (skipped by both, never scanned for a heading) and a
 * fenced code block (its `#` line is body text, not a heading, on both sides).
 */
import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown } from '@codemirror/lang-markdown';
import { type PipelineContext, createMarkdownPipeline } from '../../src/renderer/preview/providers/markdown/pipeline.js';
import { markdownHeadingRecords } from '../../src/renderer/editor/markdown-headings.js';

const FIXTURE = [
  '---',
  'title: "# not a heading"',
  '---',
  '',
  'Title',
  '=====',
  '',
  '## _Install_',
  '',
  '### Install',
  '',
  '```',
  '# not a heading either',
  '```',
  '',
  'Subtitle',
  '--------',
  '',
  '#### Install',
].join('\n');

function pipelineHeadings(text: string) {
  const pipeline = createMarkdownPipeline((html: string, _context: PipelineContext) => html);
  return pipeline.render(text).headings;
}

function editorHeadings(text: string) {
  const state = EditorState.create({ doc: text, extensions: [markdown()] });
  return markdownHeadingRecords(state);
}

describe('the pipeline and the editor slug the same document identically (R2)', () => {
  it('produce the same slug list, in the same order', () => {
    const pipeline = pipelineHeadings(FIXTURE);
    const editor = editorHeadings(FIXTURE);
    expect(editor.map((h) => h.slug)).toEqual(pipeline.map((h) => h.slug));
  });

  it('produce the same text and level for every heading, not just a coincidentally-matching slug', () => {
    const pipeline = pipelineHeadings(FIXTURE);
    const editor = editorHeadings(FIXTURE);
    expect(editor.map((h) => ({ level: h.level, text: h.text }))).toEqual(
      pipeline.map((h) => ({ level: h.level, text: h.text })),
    );
  });

  it('agree there are exactly five headings — front matter and the fence excluded on both sides', () => {
    expect(pipelineHeadings(FIXTURE)).toHaveLength(5);
    expect(editorHeadings(FIXTURE)).toHaveLength(5);
  });

  it('the two setext headings and the duplicate "Install" headings de-duplicate to the same suffixes', () => {
    const pipeline = pipelineHeadings(FIXTURE);
    const editor = editorHeadings(FIXTURE);
    const expected = ['title', 'install', 'install-1', 'subtitle', 'install-2'];
    expect(pipeline.map((h) => h.slug)).toEqual(expected);
    expect(editor.map((h) => h.slug)).toEqual(expected);
  });

  it('an empty document has no headings on either side', () => {
    expect(pipelineHeadings('just a paragraph')).toEqual([]);
    expect(editorHeadings('just a paragraph')).toEqual([]);
  });
});
