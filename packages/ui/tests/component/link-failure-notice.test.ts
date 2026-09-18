import { describe, expect, it, vi } from 'vitest';
import type { LinkActionOutcome, LinkResolutionRequest, ResolvedLink } from '@throng/core';
import {
  linkFailureReport,
  performLinkTarget,
  type LinkActionDeps,
} from '../../src/renderer/links/link-actions.js';

/**
 * 045 FR-036, FR-037 — one condition, one notice (T086).
 *
 * ══ THE RULE THIS FILE EXISTS FOR ══
 *
 * CLAUDE.md's *One condition, one notice*: a single condition raises a single notice, and it belongs
 * to whatever OWNS the state rather than to whichever caller bounced off it. A link that cannot be
 * followed has exactly two shapes — the target has GONE between the hover and the follow (FR-037),
 * and the OS refused to open it (FR-036) — and both are facts about the disk, reported once, in one
 * wording, wherever the gesture came from.
 *
 * The failure spec 032 taught this repo was the opposite: three surfaces reporting one state in
 * three wordings, two of them telling the user what they could not do. So the assertions here are
 * about COUNT as much as content, and the report is composed in one place so a second surface cannot
 * word it differently.
 *
 * ══ WHY THE REPORT IS A VALUE RATHER THAN A CALL ══
 *
 * `useReportSubjectFailure` is a hook: it needs the workspace, the project list and the notify
 * store, none of which a terminal's mount effect or a CodeMirror event handler has. So the shaping —
 * the sentence, the subject, the displayed path, the copyable detail — is a pure function, and each
 * surface hands its result to the hook it already holds. That is what keeps the two surfaces from
 * drifting, and what lets this be a component test rather than an E2E.
 */

const link: ResolvedLink = {
  path: 'D:\\project\\src\\foo.ts',
  kind: 'file',
  inProject: true,
  executable: false,
  preview: 'none',
};

const request: LinkResolutionRequest = {
  text: 'src/foo.ts',
  kind: 'detectedPath',
  panelId: 'panel-1',
  originProjectId: 'project-1',
};

const gone: Extract<LinkActionOutcome, { ok: false }> = {
  ok: false,
  reason: 'gone',
  path: 'D:\\project\\src\\foo.ts',
};

const refused: Extract<LinkActionOutcome, { ok: false }> = {
  ok: false,
  reason: 'refused',
  path: 'D:\\project\\src\\foo.ts',
};

function deps(over: Partial<LinkActionDeps> = {}): LinkActionDeps {
  return {
    openInEditor: vi.fn(),
    openInPreview: vi.fn(),
    revealInOsExplorer: vi.fn(async () => ({ ok: true }) as const),
    openInOsDefaultProgram: vi.fn(async () => ({ ok: true }) as const),
    reportFailure: vi.fn(),
    ...over,
  };
}

describe('the notice a failed link raises (FR-036, FR-037)', () => {
  it('names the file and the reason, and says what is WRONG rather than what is forbidden', () => {
    const report = linkFailureReport(gone, {
      projectRoot: 'D:\\project',
      osName: 'windows',
      projectId: 'project-1',
    });

    expect(report.subject).toBe('D:\\project\\src\\foo.ts');
    expect(report.reason).toBe('gone');
    expect(report.message).toBe('That file or folder is no longer there.');
    expect(report.message).not.toMatch(/cannot|can't|not allowed/i);
    // The row shows the path relative to the project root; the copyable detail carries it in full.
    expect(report.displayPath).toBe('src/foo.ts');
    expect(report.detail).toContain('gone');
    expect(report.projectId).toBe('project-1');
  });

  it('words a refused OS open differently from a target that has gone', () => {
    const one = linkFailureReport(gone, { osName: 'windows' });
    const two = linkFailureReport(refused, { osName: 'windows' });

    expect(two.message).toBe('That link could not be opened.');
    expect(two.message).not.toBe(one.message);
    expect(two.reason).toBe('refused');
  });

  it('falls back to the absolute path when there is no project root to be relative to', () => {
    const report = linkFailureReport(refused, { osName: 'windows' });
    expect(report.displayPath.length).toBeGreaterThan(0);
  });
});

describe('exactly ONE notice per failed action', () => {
  it('a failed OS open reports once and only once (FR-036)', async () => {
    const reportFailure = vi.fn();
    await performLinkTarget({
      target: 'osDefaultProgram',
      link,
      request,
      deps: deps({
        reportFailure,
        openInOsDefaultProgram: vi.fn(async () => refused),
      }),
    });

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(refused);
  });

  it('a target that has GONE between hover and follow reports once (FR-037)', async () => {
    const reportFailure = vi.fn();
    await performLinkTarget({
      target: 'osExplorer',
      link,
      request,
      deps: deps({ reportFailure, revealInOsExplorer: vi.fn(async () => gone) }),
    });

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(gone);
  });

  it('a successful action raises no notice at all', async () => {
    const reportFailure = vi.fn();
    await performLinkTarget({ target: 'osExplorer', link, request, deps: deps({ reportFailure }) });

    expect(reportFailure).not.toHaveBeenCalled();
  });
});

/**
 * 045 T152 — FR-124: a location that DID NOT ANSWER is its own condition, with its own wording.
 *
 * What the user sees today: Ctrl+click a path on a share that has gone offline, and — once T146
 * bounds the check — the follow ends with the generic "That link could not be opened.", which names
 * no cause and points at no remedy. The remedy for an unreachable location is to reconnect, not to
 * re-create the file, so FR-124 requires a reason distinct from `gone` and a sentence that says the
 * location did not answer. Still ONE notice (CLAUDE.md's *One condition, one notice*), shaped here so
 * the terminal and the editor cannot word it differently.
 */
describe('T152 / FR-124 — an unreachable location raises one notice saying it did not answer', () => {
  const unreachable = {
    ok: false,
    reason: 'unreachable',
    path: '\\\\fileserver\\home\\notes.txt',
  } as unknown as Extract<LinkActionOutcome, { ok: false }>;

  it('names the path and says the location did not answer', () => {
    const report = linkFailureReport(unreachable, { osName: 'windows' });

    expect(report.subject).toBe('\\\\fileserver\\home\\notes.txt');
    expect(report.reason).toBe('unreachable');
    expect(report.message).toMatch(/did not answer|didn.t answer|not responding|not answering/i);
    expect(report.detail).toContain('fileserver');
    expect(report.message, 'say what is wrong, not what the user may not do').not.toMatch(
      /cannot|can't|not allowed/i,
    );
  });

  it('is worded differently from `gone` and from `refused`', () => {
    const message = linkFailureReport(unreachable, { osName: 'windows' }).message;

    expect(message).not.toBe(linkFailureReport(gone, { osName: 'windows' }).message);
    expect(message).not.toBe(linkFailureReport(refused, { osName: 'windows' }).message);
  });

  it('raises exactly ONE notice when a follow ends unreachable, carrying that reason', async () => {
    const reportFailure = vi.fn();
    await performLinkTarget({
      target: 'osExplorer',
      link,
      request,
      deps: deps({ reportFailure, revealInOsExplorer: vi.fn(async () => unreachable) }),
    });

    expect(reportFailure).toHaveBeenCalledTimes(1);
    expect(reportFailure).toHaveBeenCalledWith(unreachable);
  });
});
