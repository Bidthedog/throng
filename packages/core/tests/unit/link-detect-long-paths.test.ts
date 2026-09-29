import { describe, expect, it } from 'vitest';
import { detectPathSpans } from '../../src/links/detect.js';

/**
 * Real paths printed by a Claude Code session in a throng terminal, reported as highlighted but not
 * opening on Ctrl+click. Detection is purely syntactic (045 FR-173), so each span must be the WHOLE
 * path: dot-folders, a `+` in a file name, and a leading `/` that means the session's own root.
 */
const REL = '/.claude/worktrees/S047-markdown-preview-enhancements/.claude/.manual-test-plans/feature+S047-markdown-preview-enhancements.md';
const ABS = `D:/git/throng${REL}`;

describe('long paths with dot-folders and a + in the file name', () => {
  it('a rooted path is one span, whole', () => {
    expect(detectPathSpans(REL)).toEqual([REL]);
  });

  it('an absolute path is one span, whole', () => {
    expect(detectPathSpans(ABS)).toEqual([ABS]);
  });

  it('the same path as a Markdown link target is one span, whole', () => {
    expect(detectPathSpans(`Test plan: [${REL}](${REL})`)).toContain(REL);
  });
});
