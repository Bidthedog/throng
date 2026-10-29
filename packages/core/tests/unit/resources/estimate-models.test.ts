import { describe, it, expect } from 'vitest';
import {
  ESTIMATE_CONSTANTS as K,
  editorMainBytes,
  editorRendererBytes,
  extrapolatedNodes,
  previewMainBytes,
  previewRendererBytes,
  terminalDaemonBytes,
  terminalRendererBytes,
} from '../../../src/resources/index.js';

describe('panel estimate models (055 FR-024, FR-024b, research R9)', () => {
  it("editor main part: the document's characters × k_doc plus its lines × k_line plus a per-document constant", () => {
    expect(editorMainBytes(1_000, 20, { linked: false })).toBe(Math.round(1_000 * K.kDoc + 20 * K.kLine + K.docConstant));
  });

  it('editor main part is counted once per document: a linked panel shows 0', () => {
    expect(editorMainBytes(1_000, 20, { linked: true })).toBe(0);
  });

  it('editor renderer part: characters × k_view, syntax-tree Tree objects × k_node, buffered nodes × k_buffer_node, rendered lines × k_rendered_line, and a per-panel constant', () => {
    expect(editorRendererBytes(1_000, 50, 200, 30)).toBe(
      Math.round(1_000 * K.kView + 50 * K.kNode + 200 * K.kBufferNode + 30 * K.kRenderedLine + K.viewConstant),
    );
  });

  it('editor renderer part follows the tree: the same characters with more nodes cost more', () => {
    expect(editorRendererBytes(1_000, 500, 0, 30) - editorRendererBytes(1_000, 0, 0, 30)).toBe(Math.round(500 * K.kNode));
  });

  it('a node packed in a buffer costs less than one that is a Tree object of its own', () => {
    expect(K.kBufferNode).toBeLessThan(K.kNode);
  });

  it('a tree that reaches only part of the document is scaled to the whole of it', () => {
    expect(extrapolatedNodes(100, 1_000, 10_000)).toBe(1_000);
  });

  it('a tree that reaches the whole document, or reaches nothing, is taken as it is', () => {
    expect(extrapolatedNodes(100, 10_000, 10_000)).toBe(100);
    expect(extrapolatedNodes(100, 12_000, 10_000)).toBe(100);
    expect(extrapolatedNodes(1, 0, 10_000)).toBe(1);
  });

  it("preview: rendered elements × k_dom, the spans among them at k_span instead, and the source's characters × k_preview_char", () => {
    expect(previewRendererBytes(500, 100, 1_000)).toBe(Math.round(400 * K.kDom + 100 * K.kSpan + 1_000 * K.kPreviewChar));
  });

  it('preview: never negative, and never more spans than elements', () => {
    expect(previewRendererBytes(-1, -1, -1)).toBe(0);
    expect(previewRendererBytes(10, 50, 0)).toBe(Math.round(10 * K.kSpan));
    expect(previewMainBytes(-1)).toBe(0);
  });

  it("preview main part: main's copy of the text it last sent, k_preview_main per character", () => {
    expect(previewMainBytes(1_000)).toBe(Math.round(1_000 * K.kPreviewMain));
  });

  it('terminal renderer: retained lines × (cols × 12 cell bytes + a per-line cost), plus a per-terminal constant', () => {
    expect(terminalRendererBytes(1_000, 120, 0)).toBe(1_000 * (120 * 12 + K.kTermLine) + K.termViewConstant);
  });

  it('terminal renderer: a wider terminal costs 12 bytes more per extra column on every retained line', () => {
    expect(terminalRendererBytes(1_000, 121, 0) - terminalRendererBytes(1_000, 120, 0)).toBe(12_000);
  });

  it('terminal renderer: each styled line costs k_styled_line more than a plain one', () => {
    expect(terminalRendererBytes(1_000, 120, 400) - terminalRendererBytes(1_000, 120, 0)).toBe(400 * K.kStyledLine);
  });

  it("terminal daemon: the scrollback string's length × 2", () => {
    expect(terminalDaemonBytes(65_536)).toBe(131_072);
  });

  it('never estimates a negative size', () => {
    expect(editorRendererBytes(-5, -5, -5, -5)).toBeGreaterThanOrEqual(0);
    expect(terminalRendererBytes(-1, 80, -1)).toBe(K.termViewConstant);
  });
});
