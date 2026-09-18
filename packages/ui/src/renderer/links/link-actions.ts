import type {
  LinkActionOutcome,
  LinkPosition,
  LinkResolutionRequest,
  LinkTarget,
  ResolvedLink,
} from '@throng/core';

/**
 * The ONE router both surfaces call to perform a link target (045 FR-033 – FR-037, FR-054, FR-055).
 *
 * ══ ONE FUNCTION, BECAUSE FR-055 HAS NO SECOND CHANCE ══
 *
 * FR-054 puts six call sites on the same behaviour: Open Link, Ctrl+click and the Open Link chord,
 * in a terminal and in an editor. Each of them could pick a destination for itself, and five of them
 * could do it correctly. The sixth is FR-055 — a file outside the owning project opened in a throng
 * editor — and it is the worst failure in the feature to review for, because there is nothing to
 * see: no error, no refusal, just a file that should not have opened.
 *
 * So the guard lives HERE, once, below every caller, rather than in each caller's own branch. The
 * component test drives every target against every link shape and asserts that `editor` and
 * `preview` are unreachable for anything out of project — which is a claim about this function, and
 * therefore about all six sites at once.
 *
 * ══ THE PERFORMERS ARE INJECTED ══
 *
 * Not because there is more than one implementation, but because the four destinations live in four
 * different corners of the renderer (the editor open router, the preview opener, and two bridge
 * calls). Taking them as parameters is what lets the routing rule be tested without mounting an app,
 * and keeps this module free of every import that would drag one in.
 */
export interface LinkActionDeps {
  /** FR-033. Honours *Open files in*; always an editor, whatever the file's default open action. */
  openInEditor(link: ResolvedLink, position?: LinkPosition): void | Promise<void>;
  /** FR-034. Beside the file's editor, focusing an existing preview. A position is IGNORED. */
  openInPreview(link: ResolvedLink): void | Promise<void>;
  /** FR-035 / FR-035a. Sends the REQUEST; main re-resolves and re-checks (FR-037). */
  revealInOsExplorer(request: LinkResolutionRequest): Promise<LinkActionOutcome>;
  /** FR-036. Sends the REQUEST, for the same reason. */
  openInOsDefaultProgram(request: LinkResolutionRequest): Promise<LinkActionOutcome>;
  /** One notice, naming the file and the reason (030). Called at most once per action. */
  reportFailure(outcome: Extract<LinkActionOutcome, { ok: false }>): void;
}

/**
 * What the user reads when a link could not be followed (FR-036, FR-037; 030 FR-034).
 *
 * Spoken, and about the TARGET rather than about the user's options: a link whose file was deleted
 * between the hover and the click is a fact about the disk, not a refusal to serve them. One
 * sentence per reason, so one condition raises one notice with one wording wherever it happens.
 */
export function linkFailureMessage(outcome: Extract<LinkActionOutcome, { ok: false }>): string {
  return outcome.reason === 'gone'
    ? 'That file or folder is no longer there.'
    : 'That link could not be opened.';
}

/**
 * The two OS destinations, bound to `window.throng.links` (FR-035, FR-035a, FR-036).
 *
 * They are the half of `LinkActionDeps` that is the same on every surface, so a caller composes them
 * with its own editor/preview openers rather than writing the bridge calls out again. Both send the
 * REQUEST — the link's text and the panel it was seen in — and never a resolved path: main
 * re-resolves it, derives the owning project from the panel, and re-checks the target still exists
 * before it acts (FR-037, I1/I2).
 */
export function osLinkActions(): Pick<
  LinkActionDeps,
  'revealInOsExplorer' | 'openInOsDefaultProgram'
> {
  return {
    revealInOsExplorer: (request) => sendToMain('reveal', request),
    openInOsDefaultProgram: (request) => sendToMain('open', request),
  };
}

async function sendToMain(
  route: 'reveal' | 'open',
  request: LinkResolutionRequest,
): Promise<LinkActionOutcome> {
  const send = window.throng?.links?.[route];
  // No bridge means no route out of the renderer at all. Reported rather than swallowed: the user
  // chose something and nothing happened, which is the one outcome a link must never produce
  // silently. `text` is all there is to name here — a resolved path is main's to know, not ours.
  if (send === undefined) return { ok: false, reason: 'refused', path: request.text };
  return send(request);
}

export async function performLinkTarget(args: {
  readonly target: LinkTarget;
  readonly link: ResolvedLink;
  readonly request: LinkResolutionRequest;
  /** FR-004's position, when the link carried one. */
  readonly position?: LinkPosition;
  readonly deps: LinkActionDeps;
}): Promise<void> {
  const { target, link, request, position, deps } = args;

  switch (target) {
    case 'editor':
    case 'preview': {
      // FR-055, once, below every caller. Reaching here means a caller offered an item FR-030 says
      // is absent for this link — so it is reported rather than silently dropped: the user chose
      // something, and a menu item that does nothing at all reads as a broken app.
      if (!(link.kind === 'file' && link.inProject)) {
        deps.reportFailure({ ok: false, reason: 'refused', path: link.path });
        return;
      }
      // FR-034: the preview is given no position. A preview cannot reveal a line and column, which
      // is the same reason FR-052 sends a positioned link to an editor under *Open in throng*.
      if (target === 'preview') await deps.openInPreview(link);
      else await deps.openInEditor(link, position);
      return;
    }
    case 'osExplorer':
      await report(deps, deps.revealInOsExplorer(request));
      return;
    case 'osDefaultProgram':
      await report(deps, deps.openInOsDefaultProgram(request));
      return;
  }
}

/** One outcome in, at most one notice out. */
async function report(deps: LinkActionDeps, running: Promise<LinkActionOutcome>): Promise<void> {
  const outcome = await running;
  if (!outcome.ok) deps.reportFailure(outcome);
}
