import { parse as parsePath } from 'node:path';
import {
  DEFAULT_APP_SETTINGS,
  detectPathCandidates,
  isLinkInProject,
  MAX_TIMED_OUT_LINK_CHECKS,
  resolveCandidate,
  type EditorLinkSettings,
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
 * Every method takes a `LinkResolutionRequest` — the TEXT, its kind, a base directory, a panel id
 * and a project ID — and never a resolved path (I1). The owning project ROOT is derived HERE from
 * that id (I2, the `authoritative()` precedent in `editor-ipc.ts`), so a renderer cannot widen its
 * own confinement: it may say which project its panel belongs to, which main can check against its
 * own cache, and it may not say where that project lives. And every action re-resolves and re-checks
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
  /**
   * I2. The owning project's ROOT, derived by main from the project ID the renderer named.
   *
   * A function rather than a service, which is the shape `PreviewService` and
   * `NavigationHistoryService` already take, and what keeps this testable without Electron. It
   * takes an ID and answers a root precisely because the renderer may name the former and must
   * never name the latter — the `authoritative()` precedent (`editor-ipc.ts:71-83`).
   */
  readonly projectRootFor: (originProjectId: string | undefined) => string | null;
  readonly previewRegistry: PreviewProviderRegistry;
  readonly readPreviewSettings: () => PreviewSettings;
  /**
   * FR-120 / SC-008. The link settings, read PER CHECK on the `readPreviewSettings` pattern — this
   * resolver is built once at startup, so a timeout captured at construction would freeze it until a
   * restart. Absent (a caller that never offers settings), the shipped default applies.
   */
  readonly readLinkSettings?: () => EditorLinkSettings;
}

/** A UNC volume root (`\\server\share\`, `//server/share/`) — the only kind a full stuck map gates. */
function isNetworkRoot(root: string): boolean {
  return /^[\\/]{2}/.test(root);
}

/** What one existence check found — `unreachable` when it lost the timeout race (FR-120). */
type Existence = 'file' | 'folder' | 'unreachable' | null;

/**
 * `LinkResolution`'s failure arm, or the located link. Internal: `locate`'s answer before it is shaped
 * for the three public methods.
 */
type Located = ResolvedLink | 'unreachable' | null;

export class FileLinkResolver {
  private shell: IShellIntegration | undefined;

  /**
   * FR-121 / FR-122 (data-model §13.5). Volume roots — `node:path`'s `parse(p).root`, `\\server\share\`
   * or `C:\` — whose `stat` outlived the timeout and has not settled. While a root is here, a check
   * under it answers `unreachable` without touching the filesystem; it leaves when that `stat` settles,
   * whichever way. Bounded by `MAX_TIMED_OUT_LINK_CHECKS`: when full, a check under any other NETWORK
   * (UNC) root also answers `unreachable` rather than risking another stuck thread-pool thread; a local
   * drive root is never gated by a full map, because a healthy local drive is never gated. Main-process memory
   * only; the renderer's cache TTL is the back-off (P10).
   */
  private readonly stuckRoots = new Set<string>();

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
    if (found === 'unreachable') return { ok: false, reason: 'unreachable' };
    return { ok: true, link: found };
  }

  /** FR-035 / FR-035a. Re-resolve, re-check, then reveal. A folder is opened; a file is selected. */
  async revealInFileManager(request: LinkResolutionRequest): Promise<LinkActionOutcome> {
    const found = await this.locate(request);
    if (found === null) return { ok: false, reason: 'gone', path: request.text };
    if (found === 'unreachable') return { ok: false, reason: 'unreachable', path: request.text };
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
    if (found === 'unreachable') return { ok: false, reason: 'unreachable', path: request.text };
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
   *
   * An attempt that is `unreachable` (FR-120) does not end the walk: a relative text may name a local
   * file through the project root after its base directory's share failed to answer, and every later
   * attempt under the same stuck root is answered at once by the gate. Only when nothing exists does
   * an unreachable attempt decide the answer — "did not answer", rather than "does not exist".
   */
  private async locate(request: LinkResolutionRequest): Promise<Located> {
    const projectRoot = this.deps.projectRootFor(request.originProjectId);
    let unreachable = false;
    for (const candidate of this.readingsOf(request)) {
      const attempts = resolveCandidate(candidate, {
        baseDirectory: request.baseDirectory,
        projectRoot,
        pathForms: this.deps.pathForms,
        // FR-151 / I7: can only remove readings, so it is carried without verification.
        ...(request.wslFlavour === true ? { wslFlavour: true as const } : {}),
      });
      for (const path of attempts) {
        const kind = await this.kindOf(path);
        if (kind === 'unreachable') unreachable = true;
        if (kind === null || kind === 'unreachable') continue;
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
    return unreachable ? 'unreachable' : null;
  }

  /**
   * The readings of the request's text, in the order R7 wants them.
   *
   * A hyperlink target is exactly one reading: the program chose the URI, so there is no ambiguity
   * to express and nothing to strip. Detected text goes back through the same grammar the surfaces
   * used, which is what keeps `src/foo.ts:42` meaning line 42 here as well as there — re-running
   * detection is cheaper than trusting a renderer to have split it the same way.
   *
   * Only the readings of the WHOLE text are kept — those spanning from the first candidate's start to
   * the widest candidate's end, position included (T202, SC-020). Since FR-150 a request's text may be
   * an extended reading (`…\notes.md for details`), and re-detecting it yields the shorter readings
   * inside it too; trying those would answer the long text with the short text's file, and the
   * surface would underline "for details" as part of the link. Which reading is the link is the
   * SURFACE's walk — longest first, the first that resolves — so the shorter one is asked for on its
   * own, and a request for the longer one answers only for the longer one.
   */
  private readingsOf(request: LinkResolutionRequest): LinkCandidate[] {
    if (request.kind === 'fileHyperlink') {
      return [{ text: request.text, start: 0, end: request.text.length }];
    }
    const found = detectPathCandidates(request.text, []);
    // A request whose text the grammar no longer recognises is still tried verbatim: the surface
    // asked about something, and answering "not a link" because of a scanning difference would be a
    // second opinion about FR-003 living in main.
    if (found.length === 0) return [{ text: request.text, start: 0, end: request.text.length }];
    const reach = (c: LinkCandidate): number => c.end + (c.positionText?.length ?? 0);
    const start = Math.min(...found.map((c) => c.start));
    const end = Math.max(...found.map(reach));
    return found.filter((c) => c.start === start && reach(c) === end);
  }

  /**
   * One existence check, raced against the existence-check timeout (FR-120, P7 – P10).
   *
   * The timeout is read from the settings on every call (SC-008). A root already stuck answers at once
   * with no `stat` (P8); so does any new root while `MAX_TIMED_OUT_LINK_CHECKS` roots are stuck (P9). A
   * `stat` that loses the race marks its root, and the mark clears when that same `stat` settles
   * (P10) — so a share that comes back is asked again, and the renderer's cache TTL is the back-off.
   */
  private async kindOf(path: string): Promise<Existence> {
    const root = parsePath(path).root.toLowerCase();
    if (this.stuckRoots.has(root)) return 'unreachable';
    // A full map gates only other NETWORK roots: a healthy local drive is never gated (§13.5), or
    // every local link would go dead once two shares were offline.
    if (this.stuckRoots.size >= MAX_TIMED_OUT_LINK_CHECKS && isNetworkRoot(root)) return 'unreachable';

    const checking = this.deps.fs.stat(path).then(
      ({ kind }): Existence => kind,
      (): Existence => null,
    );
    const timeoutMs = (this.deps.readLinkSettings?.() ?? DEFAULT_APP_SETTINGS.editor.links)
      .existenceCheckTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), timeoutMs);
    });
    const winner = await Promise.race([checking, timedOut]);
    clearTimeout(timer);
    if (winner !== 'timeout') return winner;

    this.stuckRoots.add(root);
    void checking.finally(() => this.stuckRoots.delete(root));
    return 'unreachable';
  }

  /** FR-030's tri-state. `none` is "no provider claims this", not "the provider is off". */
  private previewStateOf(path: string): ResolvedLink['preview'] {
    const provider = this.deps.previewRegistry.forPath(path);
    if (provider === undefined) return 'none';
    const settings = this.deps.readPreviewSettings();
    return settings.providers[provider.id]?.enabled === true ? 'enabled' : 'disabled';
  }
}
