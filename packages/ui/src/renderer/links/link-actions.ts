import {
  defaultOpenActionFor,
  relativeToRoot,
  resolveDefaultLinkAction,
  toDisplayPath,
  type OsName,
} from '@throng/core';
import type {
  LinkActionOutcome,
  LinkPosition,
  LinkResolution,
  LinkResolutionRequest,
  LinkTarget,
  PreviewProviderRegistry,
  PreviewSettings,
  ResolvedLink,
} from '@throng/core';
import type { SubjectFailureReport } from '../workspace/panel-failure-notice.js';

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
 *
 * `unreachable` (FR-124) is its own sentence because its remedy is different: the location did not
 * answer within the existence-check timeout — an offline share — so the user reconnects rather than
 * re-creating a file that may well still be there.
 */
export function linkFailureMessage(outcome: Extract<LinkActionOutcome, { ok: false }>): string {
  switch (outcome.reason) {
    case 'gone':
      return 'That file or folder is no longer there.';
    case 'unreachable':
      return 'That location did not answer in time.';
    case 'refused':
      return 'That link could not be opened.';
  }
}

/**
 * One failed outcome in, one notice's worth of report out (FR-036, FR-037; 030 FR-007/FR-018).
 *
 * Shaping rather than raising, because `useReportSubjectFailure` is a hook and neither of the two
 * places a link is followed from — a terminal's mount effect and a CodeMirror event handler — is a
 * React render. Each surface holds the hook already; what neither should hold is its own opinion of
 * how a missing file is worded, which is how one condition ends up with three wordings.
 */
export function linkFailureReport(
  outcome: Extract<LinkActionOutcome, { ok: false }>,
  context: {
    /** The owning project's root, where the panel has one — the row shows a path relative to it. */
    readonly projectRoot?: string | null;
    readonly osName: OsName;
    readonly projectId?: string;
  },
): SubjectFailureReport {
  return {
    subject: outcome.path,
    reason: outcome.reason,
    message: linkFailureMessage(outcome),
    displayPath: relativeToRoot(outcome.path, context.projectRoot),
    detail: `${toDisplayPath(outcome.path, context.osName)} (${outcome.reason})`,
    ...(context.projectId ? { projectId: context.projectId } : {}),
  };
}

/**
 * FR-032 — Copy Link Address: the RESOLVED absolute path, plus the position exactly as it was
 * written.
 *
 * The path rather than the clicked text, because `src/foo.ts` pasted anywhere else names nothing;
 * the position verbatim, because `:42:7` and `(42,7)` are read back by different tools and
 * normalising one into the other hands the user something their tool cannot parse.
 *
 * It copies a path OUTSIDE the project too, which is where this differs from 044 FR-116: the OS
 * targets beside it will act on such a link, so a copy that produced nothing for exactly those links
 * would be an item that silently does not work.
 */
export async function copyLinkAddress(args: {
  readonly link: ResolvedLink;
  /** FR-004's `positionText`, verbatim. Absent when the link carried no position. */
  readonly positionText?: string;
}): Promise<void> {
  const text = `${args.link.path}${args.positionText ?? ''}`;
  // 'verbatim' — a path is not a line-wise or rectangular selection, so it pastes as written.
  await window.throng?.clipboard?.write({ text, mode: 'verbatim' });
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

/**
 * The performers a SURFACE supplies; the two OS routes come from {@link osLinkActions}.
 *
 * One interface for both panel types, because FR-054 puts a terminal's Ctrl+click and an editor's
 * Open Link chord on the same decision, and a second copy of this shape is a second place for the
 * preference to be read differently.
 */
export interface LinkFollowDeps {
  readonly openInEditor: LinkActionDeps['openInEditor'];
  readonly openInPreview: LinkActionDeps['openInPreview'];
  readonly reportFailure: LinkActionDeps['reportFailure'];
  /*
   * 045 FR-112: the `defaultAction` reader is gone with the setting it read. The click rule (FR-110)
   * fixes what a click does, so there is no preference left to keep live.
   */
  /**
   * FR-051: whether THIS file's own default open action is Preview. Absent means no.
   *
   * A reader rather than a value because both surfaces build these deps ONCE for the panel's whole
   * life, and 044's per-provider setting still changes live — a captured value would freeze it.
   */
  readonly previewIsDefault?: (link: ResolvedLink) => boolean;
}

/**
 * What the LIVE preferences say about where a link opens (FR-050, FR-051).
 *
 * The preview halves are here rather than in `@throng/core`'s `resolveDefaultLinkAction` because
 * 044 FR-070 keeps the provider registry out of the pure decision: core is told *whether* this
 * file's default open action is Preview, and never how that was worked out.
 */
export interface LinkRoutingInputs {
  readonly previewRegistry: PreviewProviderRegistry;
  /** `editor.previews`, which carries each provider's `enabled` and `defaultOpenAction`. */
  readonly previewSettings: PreviewSettings;
}

/**
 * The two settings-derived inputs {@link followLink} needs, composed once for BOTH surfaces
 * (FR-050 – FR-052, SC-008).
 *
 * One function so the terminal and the editor cannot read the preference differently — the failure
 * FR-054 exists to rule out, and one that would show up as "Ctrl+click does different things in the
 * two panels" long after the change that caused it.
 *
 * `read` is consulted on every gesture. A surface passes a closure over whatever it holds the live
 * settings in — the terminal a ref it rewrites each render, the editor its `metaRef` — so nothing
 * here has to know how a renderer keeps settings current.
 */
export function linkRouting(
  read: () => LinkRoutingInputs,
): Required<Pick<LinkFollowDeps, 'previewIsDefault'>> {
  return {
    previewIsDefault: (link) => {
      const now = read();
      return defaultOpenActionFor(now.previewRegistry, now.previewSettings, link.path) === 'preview';
    },
  };
}

/**
 * FR-040 / FR-054 — follow a link, wherever the gesture came from.
 *
 * ONE function for Ctrl+click, the Open Link chord and the plain Open Link item, on both surfaces.
 * The alternative is six call sites each resolving the preference for itself, five of which would
 * get it right; the sixth is FR-055, and its failure mode is a file that should not have opened with
 * nothing on screen to show for it.
 *
 * `resolve` is injected rather than imported so this stays free of the cache's `window` dependency:
 * the terminal passes `askTerminalLink`, the editor passes its own peek. A click that arrives before
 * the answer does asks again and does nothing, which is FR-071 — never a wait.
 */
export async function followLink(args: {
  readonly request: LinkResolutionRequest;
  /** FR-004's position, when the span carried one. A hyperlink never carries one. */
  readonly position?: LinkPosition;
  readonly resolve: (request: LinkResolutionRequest) => LinkResolution | undefined;
  readonly deps: LinkFollowDeps;
}): Promise<void> {
  const { request, position, resolve, deps } = args;
  const resolution = resolve(request);
  if (resolution === undefined || !resolution.ok) return; // FR-006: not a link, so nothing happens
  const link = resolution.link;

  // 045 FR-110 — the click rule decides, and nothing here keeps a second copy of it. Routing THROUGH
  // the decision rather than around it is the whole of T107.
  const target = resolveDefaultLinkAction({
    link,
    hasPosition: position !== undefined,
    previewIsDefault: deps.previewIsDefault?.(link) ?? false,
  });

  await performLinkTarget({
    target,
    link,
    request,
    ...(position === undefined ? {} : { position }),
    deps: {
      openInEditor: deps.openInEditor,
      openInPreview: deps.openInPreview,
      reportFailure: deps.reportFailure,
      ...osLinkActions(),
    },
  });
}

/** One outcome in, at most one notice out. */
async function report(deps: LinkActionDeps, running: Promise<LinkActionOutcome>): Promise<void> {
  const outcome = await running;
  if (!outcome.ok) deps.reportFailure(outcome);
}
