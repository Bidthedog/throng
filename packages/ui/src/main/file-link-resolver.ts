import {
  detectPathCandidates,
  isLinkInProject,
  resolveCandidate,
  type IExecutableExtensions,
  type IFileSystem,
  type IPathForms,
  type IShellIntegration,
  type LinkActionOutcome,
  type LinkCandidate,
  type LinkResolution,
  type LinkResolutionRequest,
  type PreviewProviderRegistry,
  type PreviewSettings,
  type ResolvedLink,
} from '@throng/core';

/**
 * The ONE authority for "what is this link, and may it be opened" (045, `data-model.md` §6).
 *
 * ══ WHY THIS IS IN MAIN, AND WHY THERE IS EXACTLY ONE OF IT ══
 *
 * FR-010 requires terminals and editors to produce the same link for the same text. The cheapest way
 * to break that is to give each surface its own resolver: two caches, two orderings, two answers to
 * "does this exist", and a bug that reproduces in one panel type and not the other. So both surfaces
 * ask this, over `throng:links:*`, and neither can resolve anything for itself — the renderer has no
 * filesystem and is not given one.
 *
 * ══ THE RENDERER NEVER HANDS OVER A PATH ══
 *
 * Every method takes a `LinkResolutionRequest` — the TEXT, its kind, a base directory and a panel id
 * — and never a resolved path (I1). The owning project root is derived HERE from `panelId` (I2, the
 * `authoritative()` precedent in `editor-ipc.ts`), so a renderer cannot widen its own confinement by
 * naming a root it does not own. And every action re-resolves from scratch and re-checks existence
 * before touching the OS (FR-037), because the file that was there when the link was underlined may
 * be gone by the time it is clicked.
 *
 * ══ THE RENDERER ALSO NEVER IMPORTS A PROVIDER ══
 *
 * `preview` is answered here from `registry.forPath(path)` plus `settings.providers[id]?.enabled`,
 * which is the pair `defaultOpenActionFor` already uses. 044's guard is that a preview provider is a
 * main-side concept; answering the tri-state here keeps it that way.
 *
 * Collaborators arrive by constructor (Principle IX). `projectRootFor` is a function rather than a
 * service — the shape `PreviewService` and `NavigationHistoryService` take — so this stays testable
 * against a real disk with no Electron anywhere near it.
 */
export interface FileLinkResolverDeps {
  readonly fs: IFileSystem;
  readonly pathForms: IPathForms;
  readonly executables: IExecutableExtensions;
  /** I2: main's own answer, derived from the panel. Never the renderer's claim. */
  readonly projectRootFor: (panelId: string) => string | null;
  readonly previewRegistry: PreviewProviderRegistry;
  readonly readPreviewSettings: () => PreviewSettings;
}

export class FileLinkResolver {
  private shell: IShellIntegration | undefined;

  constructor(private readonly deps: FileLinkResolverDeps) {}

  /**
   * The OS seam, set after construction because `ElectronShellIntegration` and this resolver are
   * built at the same point in `main.ts` and neither needs the other to exist first. Absent, the two
   * action methods refuse rather than silently succeeding.
   */
  setShell(shell: IShellIntegration): void {
    this.shell = shell;
  }

  async resolve(request: LinkResolutionRequest): Promise<LinkResolution> {
    const found = await this.locate(request);
    if (found === null) return { ok: false };
    return { ok: true, link: found };
  }

  /** FR-035 / FR-035a. Re-resolve, re-check, then reveal. A folder is opened; a file is selected. */
  async revealInFileManager(request: LinkResolutionRequest): Promise<LinkActionOutcome> {
    const found = await this.locate(request);
    if (found === null) return { ok: false, reason: 'gone', path: request.text };
    if (this.shell === undefined) return { ok: false, reason: 'refused', path: found.path };
    try {
      if (found.kind === 'folder') await this.shell.openFolder(found.path);
      else await this.shell.revealInFileManager(found.path);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'refused', path: found.path };
    }
  }

  /**
   * FR-036. Re-resolve, re-check, then open in the OS's own application for the type.
   *
   * The folder refusal is repeated here rather than left to the shell, and deliberately: FR-030
   * makes this a file-only target, so a folder reaching it at all means a caller offered an item it
   * should not have. Answering `refused` names that as a refusal rather than letting the shell's
   * error surface as though the file were at fault.
   */
  async openWithDefaultProgram(request: LinkResolutionRequest): Promise<LinkActionOutcome> {
    const found = await this.locate(request);
    if (found === null) return { ok: false, reason: 'gone', path: request.text };
    if (found.kind === 'folder') return { ok: false, reason: 'refused', path: found.path };
    if (this.shell === undefined) return { ok: false, reason: 'refused', path: found.path };
    try {
      await this.shell.openWithDefaultProgram(found.path);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'refused', path: found.path };
    }
  }

  /**
   * Text to at most one existing location, with every field the surfaces need.
   *
   * The candidate readings are walked in order and the FIRST that exists wins (R1), which is what
   * makes R5, R6 and R7 orderings rather than special cases: a positioned reading is simply tried
   * before the reading without it, and whichever is real decides what the trailing `:42:7` was.
   */
  private async locate(request: LinkResolutionRequest): Promise<ResolvedLink | null> {
    const projectRoot = this.deps.projectRootFor(request.panelId);
    for (const candidate of this.readingsOf(request)) {
      const attempts = resolveCandidate(candidate, {
        baseDirectory: request.baseDirectory,
        projectRoot,
        pathForms: this.deps.pathForms,
      });
      for (const path of attempts) {
        const kind = await this.kindOf(path);
        if (kind === null) continue;
        return {
          path,
          kind,
          inProject: isLinkInProject(path, projectRoot),
          // A folder is never executable, whatever it is named (FR-039a).
          executable: kind === 'file' && this.deps.executables.isExecutable(path),
          preview: kind === 'file' ? this.previewStateOf(path) : 'none',
        };
      }
    }
    return null;
  }

  /**
   * The readings of the request's text, in the order R7 wants them.
   *
   * A hyperlink target is exactly one reading: the program chose the URI, so there is no ambiguity
   * to express and nothing to strip. Detected text goes back through the same grammar the surfaces
   * used, which is what keeps `src/foo.ts:42` meaning line 42 here as well as there — re-running
   * detection is cheaper than trusting a renderer to have split it the same way.
   */
  private readingsOf(request: LinkResolutionRequest): LinkCandidate[] {
    if (request.kind === 'fileHyperlink') {
      return [{ text: request.text, start: 0, end: request.text.length }];
    }
    const found = detectPathCandidates(request.text, []);
    // A request whose text the grammar no longer recognises is still tried verbatim: the surface
    // asked about something, and answering "not a link" because of a scanning difference would be a
    // second opinion about FR-003 living in main.
    return found.length > 0 ? found : [{ text: request.text, start: 0, end: request.text.length }];
  }

  private async kindOf(path: string): Promise<'file' | 'folder' | null> {
    try {
      const { kind } = await this.deps.fs.stat(path);
      return kind;
    } catch {
      return null;
    }
  }

  /** FR-030's tri-state. `none` is "no provider claims this", not "the provider is off". */
  private previewStateOf(path: string): ResolvedLink['preview'] {
    const provider = this.deps.previewRegistry.forPath(path);
    if (provider === undefined) return 'none';
    const settings = this.deps.readPreviewSettings();
    return settings.providers[provider.id]?.enabled === true ? 'enabled' : 'disabled';
  }
}
