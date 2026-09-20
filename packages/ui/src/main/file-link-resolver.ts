import { dirname, parse as parsePath } from 'node:path';
import {
  DEFAULT_APP_SETTINGS,
  detectPathCandidates,
  isLinkInProject,
  knownFileExtensionsSet,
  LINK_ROOT_BACKOFF_MS,
  MAX_TIMED_OUT_LINK_CHECKS,
  resolveCandidate,
  sanitiseLinkTarget,
  type EditorLinkSettings,
  type IExecutableExtensions,
  type IFileSystem,
  type IPathForms,
  type IShellIntegration,
  type LinkActionOutcome,
  type LinkCandidate,
  type LinkFollowOutcome,
  type LinkResolution,
  type LinkResolutionRequest,
  type PreviewProviderRegistry,
  type PreviewSettings,
  type ResolvedLink,
  type ShellActionResult,
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
 * `locate`'s answer before it is shaped for the public methods: the first reading that EXISTS, or why
 * there was none — `missing` (nothing exists) or `unreachable` (nothing exists, and at least one
 * reading did not answer within the deadline, FR-120 / FR-124).
 */
type Located = ResolvedLink | 'unreachable' | 'missing';

/**
 * One request, ready to walk (045 round four): the sanitised request, the owning root main derived for
 * it, every reading in FR-022 – FR-025's order, and whether it is a folder BY GRAMMAR (FR-158d).
 */
interface Plan {
  readonly request: LinkResolutionRequest;
  readonly projectRoot: string | null;
  readonly readings: readonly string[];
  /** FR-160's "first reading": what decides when nothing exists, and what a folder by grammar opens. */
  readonly first: string | null;
  /**
   * FR-158a / FR-158c / FR-158d: a location written with a trailing separator, an OSC 8 target ending
   * in one, or the project root itself. It is never checked — at a follow or a menu opening — and it
   * opens as a folder (its first reading), even under a root in back-off (FR-122a's note).
   */
  readonly folderByGrammar: boolean;
}

/** `osReason` when the OS gave words, nothing when it gave none (data-model §16.15). */
function osReasonOf(words: string): { osReason?: string } {
  return words.trim().length > 0 ? { osReason: words } : {};
}

/** `D:\a\b\` → `D:\a\b`; a volume root (`D:\`, `\\server\share\`) is left as it is. */
function withoutTrailingSeparator(path: string): string {
  if (parsePath(path).root === path) return path;
  return path.replace(/[\\/]+$/, '');
}

/** A path's form for comparison: case and separators folded, no trailing separator. */
function comparable(path: string): string {
  return path.replace(/\//g, '\\').replace(/\\+$/, '').toLowerCase();
}

export class FileLinkResolver {
  private shell: IShellIntegration | undefined;

  /**
   * FR-121 / FR-122 (data-model §13.5). Volume roots — `node:path`'s `parse(p).root`, `\\server\share\`
   * or `C:\` — whose `stat` outlived the timeout and has not settled. While a root is here, a check
   * under it answers `unreachable` without touching the filesystem. Bounded by
   * `MAX_TIMED_OUT_LINK_CHECKS`: when full, a check under any other NETWORK (UNC) root also answers
   * `unreachable` rather than risking another stuck thread-pool thread; a local drive root is never
   * gated by a full map, because a healthy local drive is never gated. Main-process memory only.
   */
  private readonly stuckRoots = new Set<string>();

  /**
   * FR-122a (data-model §16.19, §16.20). When a stuck `stat` settles, its root moves HERE with a "left
   * alone until" time, `LINK_ROOT_BACKOFF_MS` after the settle: until then a check under it answers
   * `unreachable` at once. A separate map from `stuckRoots` on purpose — a root in back-off holds no
   * thread, so it does not count toward `MAX_TIMED_OUT_LINK_CHECKS`, and two roots in back-off never gate
   * a third. An entry is dropped once its time has passed.
   */
  private readonly leftAloneUntil = new Map<string, number>();

  constructor(private readonly deps: FileLinkResolverDeps) {}

  /**
   * The OS seam, set after construction because `ElectronShellIntegration` and this resolver are
   * built at the same point in `main.ts` and neither needs the other to exist first. Absent, the
   * action methods refuse rather than silently succeeding.
   */
  setShell(shell: IShellIntegration): void {
    this.shell = shell;
  }

  /**
   * The Link menu's one resolution when it opens (FR-170); a follow is {@link follow}'s. A folder by
   * grammar is answered without a check (FR-158d); an unresolved answer carries
   * what the menu would offer by extension (FR-170a), and no `reason` means not found (FR-160).
   */
  async resolve(request: LinkResolutionRequest): Promise<LinkResolution> {
    const plan = this.plan(request);
    if (plan === null) return { ok: false };
    if (plan.folderByGrammar && plan.first !== null) {
      return { ok: true, link: this.folderLink(plan.first, plan.projectRoot) };
    }
    const found = await this.locate(plan);
    if (typeof found === 'object') return { ok: true, link: found };
    const named = plan.first ?? plan.request.text;
    return {
      ok: false,
      ...(found === 'unreachable' ? { reason: 'unreachable' as const } : {}),
      executableByExtension: this.deps.executables.isExecutable(named),
      previewByExtension: this.previewStateOf(named),
    };
  }

  /**
   * A Ctrl+click, the chord and Open Link — ONE request, ONE bounded pass (FR-161; plan *Corrections,
   * tenth pass*; data-model §16.18). Resolved under the one deadline, and when the outcome is a reveal it
   * is performed HERE, on the same `stat`'s answer, so the renderer never makes a second round trip:
   *
   *   | an existing in-project FILE                     | `openInThrong` — the renderer's click rule opens it |
   *   | a folder, anywhere (FR-160a), or by grammar     | OS Explorer on the folder itself → `revealed`        |
   *   | an existing out-of-project file                 | OS Explorer on its parent, selected → `revealed`     |
   *   | nothing behind an in-project first reading      | `notFound` (FR-160) — or `unreachable` (FR-124)      |
   *   | nothing behind an out-of-project first reading  | OS Explorer on its parent, no notice → `revealed`    |
   *
   * A request `sanitiseLinkTarget` refuses answers `rejected` (FR-156). A panel with no project, or one
   * main has never heard of, has no root, so every target is out-of-project (M3, I2) — never `rejected`.
   */
  async follow(request: LinkResolutionRequest): Promise<LinkFollowOutcome> {
    const plan = this.plan(request);
    if (plan === null) return { kind: 'rejected' };
    if (plan.first === null) return { kind: 'notFound', path: plan.request.text };
    if (plan.folderByGrammar) return this.revealed(plan.first, (shell, p) => shell.openFolder(p));

    const found = await this.locate(plan);
    if (typeof found === 'object') {
      if (found.kind === 'folder') return this.revealed(found.path, (shell, p) => shell.openFolder(p));
      if (found.inProject) return { kind: 'openInThrong', link: found };
      return this.revealed(found.path, (shell, p) => shell.revealInFileManager(p));
    }
    if (isLinkInProject(plan.first, plan.projectRoot)) {
      return { kind: found === 'unreachable' ? 'unreachable' : 'notFound', path: plan.first };
    }
    return this.revealed(dirname(plan.first), (shell, p) => shell.openFolder(p));
  }

  /** One OS reveal, as a follow's outcome: `revealed`, or `refused` with the OS's words. */
  private async revealed(
    path: string,
    call: (shell: IShellIntegration, path: string) => Promise<ShellActionResult | void>,
  ): Promise<LinkFollowOutcome> {
    const outcome = await this.act(path, call);
    if (outcome.ok) return { kind: 'revealed' };
    return {
      kind: 'refused',
      path: outcome.path,
      ...(outcome.osReason === undefined ? {} : { osReason: outcome.osReason }),
    };
  }

  /**
   * FR-035 / FR-035a, as FR-158a / FR-158b amend them — the explicit Open in OS Explorer item.
   *
   * Re-resolved from the request, never a path the renderer supplied (FR-035a, I1). The one bounded
   * pass is also the file-or-folder check: a folder opens AS ITSELF, a file opens its parent with it
   * selected, and a location that is not there — or does not answer, outside the project — is handed to
   * OS Explorer on its PARENT with no throng notice, never answered `gone` (S10). A folder by grammar is
   * opened unchecked. Only an in-project first reading that did not answer is reported, as FR-124's
   * `unreachable`.
   */
  async revealInFileManager(request: LinkResolutionRequest): Promise<LinkActionOutcome> {
    const plan = this.plan(request);
    if (plan === null) return { ok: false, reason: 'refused', path: '' };
    const text = plan.request.text;
    if (plan.first === null) return { ok: false, reason: 'gone', path: text };
    if (plan.folderByGrammar) return this.act(plan.first, (shell, p) => shell.openFolder(p));

    const found = await this.locate(plan);
    if (typeof found === 'object') {
      return found.kind === 'folder'
        ? this.act(found.path, (shell, p) => shell.openFolder(p))
        : this.act(found.path, (shell, p) => shell.revealInFileManager(p));
    }
    if (found === 'unreachable' && isLinkInProject(plan.first, plan.projectRoot)) {
      return { ok: false, reason: 'unreachable', path: text };
    }
    return this.act(dirname(plan.first), (shell, p) => shell.openFolder(p));
  }

  /**
   * FR-036. Re-resolve, re-check (FR-037 stands for an action that needs the file itself), then open in
   * the OS's own application for the type. Open Program is this same call on an executable (FR-170, S8),
   * so it takes the same de-elevating route (FR-038).
   *
   * The folder refusal is repeated here rather than left to the shell, and deliberately: FR-030
   * makes this a file-only target, so a folder reaching it at all means a caller offered an item it
   * should not have. Answering `refused` names that as a refusal rather than letting the shell's
   * error surface as though the file were at fault.
   */
  async openWithDefaultProgram(request: LinkResolutionRequest): Promise<LinkActionOutcome> {
    const plan = this.plan(request);
    if (plan === null) return { ok: false, reason: 'refused', path: '' };
    const text = plan.request.text;
    if (plan.folderByGrammar) return { ok: false, reason: 'refused', path: plan.first ?? text };
    const found = await this.locate(plan);
    if (found === 'missing') return { ok: false, reason: 'gone', path: text };
    if (found === 'unreachable') return { ok: false, reason: 'unreachable', path: text };
    if (found.kind === 'folder') return { ok: false, reason: 'refused', path: found.path };
    return this.act(found.path, (shell, p) => shell.openWithDefaultProgram(p));
  }

  /**
   * One OS call on a path main derived, as one outcome. The OS's own words — a refusal the seam
   * resolved (`ShellActionResult`) or an error it threw — travel as `osReason` on the refused arm, so
   * the one notice can name them (FR-036, T229).
   */
  private async act(
    path: string,
    call: (shell: IShellIntegration, path: string) => Promise<ShellActionResult | void>,
  ): Promise<LinkActionOutcome> {
    if (this.shell === undefined) return { ok: false, reason: 'refused', path };
    try {
      const result = await call(this.shell, path);
      if (result !== undefined && !result.ok) {
        return { ok: false, reason: 'refused', path, ...osReasonOf(result.osReason) };
      }
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: 'refused', path, ...osReasonOf(error instanceof Error ? error.message : '') };
    }
  }

  /**
   * FR-156: every request is sanitised again here — the renderer is not trusted to have done it — and
   * a refused one is `null`. Then every reading, in order, and FR-158d's folder-by-grammar test. Pure:
   * no disk.
   */
  private plan(raw: LinkResolutionRequest): Plan | null {
    const clean = sanitiseLinkTarget(raw.text);
    if (!clean.ok) return null;
    const request = clean.value === raw.text ? raw : { ...raw, text: clean.value };
    const projectRoot = this.deps.projectRootFor(request.originProjectId);
    const readings: string[] = [];
    for (const candidate of this.readingsOf(request)) {
      for (const path of resolveCandidate(candidate, {
        baseDirectory: request.baseDirectory,
        projectRoot,
        pathForms: this.deps.pathForms,
        // FR-151 / I7: can only remove readings, so it is carried without verification.
        ...(request.wslFlavour === true ? { wslFlavour: true as const } : {}),
      })) {
        if (!readings.includes(path)) readings.push(path);
      }
    }
    const reading = readings[0] ?? null;
    const folderByGrammar =
      reading !== null &&
      (/[\\/]$/.test(request.text) ||
        (projectRoot !== null && comparable(reading) === comparable(projectRoot)));
    // A folder by grammar opens as the folder it names, spelled without the separator that marked it —
    // unless that separator IS the folder (`C:\`, `\\server\share\`).
    const first = reading !== null && folderByGrammar ? withoutTrailingSeparator(reading) : reading;
    return { request, projectRoot, readings, first, folderByGrammar };
  }

  /** FR-158d's synthesised answer for a folder by grammar (data-model §16.22). */
  private folderLink(path: string, projectRoot: string | null): ResolvedLink {
    return { path, kind: 'folder', inProject: isLinkInProject(path, projectRoot), executable: false, preview: 'none' };
  }

  /**
   * The first reading that EXISTS, wherever it lies (FR-160's note), under ONE deadline for the whole
   * request (FR-161, T226, T227): every reading and every root shares `existenceCheckTimeoutMs`, so a
   * follow over several hanging readings still ends within it. Walking the readings in order is what
   * makes R5, R6 and R7 orderings rather than special cases.
   *
   * An attempt that is `unreachable` does not end the walk: a relative text may name a local file
   * through the project root after its base directory's share failed to answer. Only when nothing
   * exists does an unreachable attempt decide the answer — "did not answer", rather than "not found".
   */
  private async locate(plan: Plan): Promise<Located> {
    const deadline = Date.now() + this.timeoutMs();
    let unreachable = false;
    for (const path of plan.readings) {
      const kind = await this.kindOf(path, deadline);
      if (kind === 'unreachable') unreachable = true;
      if (kind === null || kind === 'unreachable') continue;
      return {
        path,
        kind,
        inProject: isLinkInProject(path, plan.projectRoot),
        // A folder is never executable, whatever it is named (FR-039a).
        executable: kind === 'file' && this.deps.executables.isExecutable(path),
        preview: kind === 'file' ? this.previewStateOf(path) : 'none',
      };
    }
    return unreachable ? 'unreachable' : 'missing';
  }

  /** The timeout, read per request (SC-008): a changed setting applies to the next follow. */
  private timeoutMs(): number {
    return (this.deps.readLinkSettings?.() ?? DEFAULT_APP_SETTINGS.editor.links).existenceCheckTimeoutMs;
  }

  /**
   * FR-178a. The SAME resolved extension set the surfaces scanned with
   * (`renderer/links/link-scan-options.ts`), read per request on the `timeoutMs` pattern.
   *
   * It is not an optimisation: the grammar in {@link readingsOf} must end a spaced path exactly where
   * the surface ended it, or the text a Ctrl+click sends re-detects as two shorter spans and matches
   * neither — which answers `notFound` for a file the user configured throng to recognise, and draws
   * every Link menu row disabled. The renderer memoises this by value because it scans every visible
   * line; here it is one gesture's work, so it is simply built.
   */
  private knownExtensions(): ReadonlySet<string> {
    const links = this.deps.readLinkSettings?.();
    return knownFileExtensionsSet(
      links?.knownFileExtensions ?? DEFAULT_APP_SETTINGS.editor.links.knownFileExtensions,
    );
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
   * the widest candidate's end, position included (T202, SC-020): a text that re-detects as several
   * spans must never be answered with a shorter span's file. Since round four (FR-173, T242) detection
   * gives one span per link, and an ENCLOSED span needs no terminator — so when no reading reaches the
   * end of the text, the text as sent is the one reading.
   */
  private readingsOf(request: LinkResolutionRequest): LinkCandidate[] {
    if (request.kind === 'fileHyperlink') {
      return [{ text: request.text, start: 0, end: request.text.length }];
    }
    const found = detectPathCandidates(request.text, [], { knownExtensions: this.knownExtensions() });
    // A request whose text the grammar no longer recognises is still tried verbatim: the surface
    // asked about something, and answering "not a link" because of a scanning difference would be a
    // second opinion about FR-003 living in main.
    const verbatim = [{ text: request.text, start: 0, end: request.text.length }];
    if (found.length === 0) return verbatim;
    const reach = (c: LinkCandidate): number => c.end + (c.positionText?.length ?? 0);
    const start = Math.min(...found.map((c) => c.start));
    const end = Math.max(...found.map(reach));
    // T242: an enclosed span (FR-173a – c) needs no terminator, so its bare text may re-detect as a
    // shorter span stopping at a space (`C:\Program Files` → `C:\Program`). When no reading reaches
    // the end of the text (FR-005's trailing punctuation aside), the text as sent is the reading —
    // never a shorter one it happens to contain.
    if (end < request.text.replace(/[\s,.:;]+$/, '').length) return verbatim;
    return found.filter((c) => c.start === start && reach(c) === end);
  }

  /**
   * One existence check, bounded by what is left of the request's deadline (FR-120, FR-161, P7 – P10).
   *
   * A root in back-off answers at once with no `stat` (FR-122a); so does a root already stuck (P8), any
   * new NETWORK root while `MAX_TIMED_OUT_LINK_CHECKS` roots are stuck (P9), and any check once the
   * deadline has passed. A `stat` that loses the race marks its root stuck; when that same `stat`
   * settles, whichever way, the root leaves the stuck map and is left alone for `LINK_ROOT_BACKOFF_MS`.
   */
  private async kindOf(path: string, deadline: number): Promise<Existence> {
    const root = parsePath(path).root.toLowerCase();
    const until = this.leftAloneUntil.get(root);
    if (until !== undefined) {
      if (Date.now() < until) return 'unreachable';
      this.leftAloneUntil.delete(root);
    }
    if (this.stuckRoots.has(root)) return 'unreachable';
    // A full map gates only other NETWORK roots: a healthy local drive is never gated (§13.5), or
    // every local link would go dead once two shares were offline.
    if (this.stuckRoots.size >= MAX_TIMED_OUT_LINK_CHECKS && isNetworkRoot(root)) return 'unreachable';
    const remaining = deadline - Date.now();
    if (remaining <= 0) return 'unreachable';

    const checking = this.deps.fs.stat(path).then(
      ({ kind }): Existence => kind,
      (): Existence => null,
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), remaining);
    });
    const winner = await Promise.race([checking, timedOut]);
    clearTimeout(timer);
    if (winner !== 'timeout') return winner;

    this.stuckRoots.add(root);
    void checking.finally(() => {
      this.stuckRoots.delete(root);
      this.leftAloneUntil.set(root, Date.now() + LINK_ROOT_BACKOFF_MS);
    });
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
