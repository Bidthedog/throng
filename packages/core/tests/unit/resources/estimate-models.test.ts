import { describe, it, expect } from 'vitest';
import {
  ESTIMATE_CONSTANTS as K,
  editorMainBytes,
  editorRendererBytes,
  previewRendererBytes,
  terminalDaemonBytes,
  terminalRendererBytes,
} from '../../../src/resources/index.js';

describe('panel estimate models (055 FR-024, FR-024b, research R9)', () => {
  it("editor main part: the document's UTF-16 bytes × k_doc plus a per-document constant", () => {
    expect(editorMainBytes(1_000, { linked: false })).toBe(Math.round(2_000 * K.kDoc + K.docConstant));
  });

  it('editor main part is counted once per document: a linked panel shows 0', () => {
    expect(editorMainBytes(1_000, { linked: true })).toBe(0);
  });

  it("editor renderer part: UTF-16 bytes × k_view plus a per-panel constant", () => {
    expect(editorRendererBytes(1_000)).toBe(Math.round(2_000 * K.kView + K.viewConstant));
  });

  it('preview: rendered node count × k_dom plus the content bytes', () => {
    expect(previewRendererBytes(500, 1_000)).toBe(Math.round(500 * K.kDom + 2_000));
  });

  it('terminal renderer: retained lines × cols × 12 plus a per-line overhead', () => {
    expect(terminalRendererBytes(1_000, 120)).toBe(1_000 * 120 * 12 + 1_000 * K.lineOverhead);
  });

  it("terminal daemon: the scrollback string's length × 2", () => {
    expect(terminalDaemonBytes(65_536)).toBe(131_072);
  });

  it('never estimates a negative size', () => {
    expect(editorRendererBytes(-5)).toBeGreaterThanOrEqual(0);
    expect(terminalRendererBytes(-1, 80)).toBe(0);
  });
});
