import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createProject,
  updatePanelConfig,
  type Panel,
  type Project,
  type WorkspaceLayout,
} from '@throng/core';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  WorkspaceRepository,
  type ThrongDatabase,
} from '@throng/persistence';
import {
  findInFilesConfigOf,
  findInFilesQueryFrom,
  type FindInFilesQuery,
} from '../../src/renderer/find-in-files/panel-config.js';

/**
 * 043 T103 — a Find in Files panel's QUERY survives a restart, and its results do not
 * (FR-027a, FR-027b, FR-027c, US5 scenarios 9 and 10).
 *
 * ══ WHY THIS IS INTEGRATION AND NOT A UNIT TEST OF THE MAPPING ══
 *
 * The mapping either side of the blob is pure and could be asserted in isolation, and asserting it
 * that way would prove nothing about a restart. What has to hold is that the SAME bytes come back
 * out of SQLite: `PanelConfig` is a `Record<string, unknown>` serialised verbatim, so this is a
 * claim about JSON round-tripping through a real `workspace_layout` row — including the `null` that
 * says "the whole root", which is the one value a careless serialisation drops.
 *
 * ══ WHY THE PANEL STATE GOING IN IS A FULL ONE ══
 *
 * The interesting half of FR-027b is what does NOT come back. A test that persisted a query object
 * and read a query object back could not tell a mapping that excludes results from one that never
 * had any to exclude. So the state written here is one that HAS results, a stale-file marking, a
 * committed set and a replacement typed over live rows — a panel mid-preview — and the assertion is
 * on the shape of what reached the blob.
 *
 * ══ WHY THE STORE ITSELF IS NOT MOUNTED ══
 *
 * `find-in-files-store.ts` touches `window` when it opens its update channel, so it belongs to the
 * component layer and is exercised there (`find-in-files-discard.test.ts` mounts a restored panel
 * and asserts it comes back not-yet-run). What lives here is the half that layer cannot see: the
 * database.
 */
const OWNER = 'alice';
const PANEL_ID = 'fif-1';

let db: ThrongDatabase;
let dataDir: string;
let projects: ProjectRepository;
let workspaces: WorkspaceRepository;

/** A panel mid-preview: a full query, results on screen, and a replacement typed over them. */
const LIVE_PANEL = {
  panelId: PANEL_ID,
  projectId: 'p-find',
  projectRoot: 'C:/code/findproj',
  term: 'needle',
  modes: { caseSensitive: true, wholeWord: true },
  scopeSubPath: 'src/renderer',
  scopeNotice: null,
  grouping: 'file' as const,
  collapsed: new Set<string>(['src/renderer/app.tsx']),
  results: {
    generation: 3,
    status: 'complete' as const,
    rows: [{ relPath: 'src/renderer/app.tsx', line: 4, column: 7, from: 40, to: 46 }],
    totalMatches: 1,
    filesScanned: 12,
    skipped: 2,
    staleFiles: ['src/renderer/app.tsx'],
    version: 9,
  },
  replaceEnabled: true,
  replacement: 'pin',
  committed: new Set<string>(['src/renderer/app.tsx:40']),
  seedSeq: 2,
  focusTarget: 'search' as const,
};

function seedProject(): Project {
  const project = createProject(
    { name: 'FindProj', colour: '#6aa3ff', rootFolder: 'C:/code/findproj' },
    { id: 'p-find', ownerUser: OWNER, now: new Date().toISOString(), isActive: false },
  );
  projects.insert(project);
  return project;
}

function findPanel(): Panel {
  return {
    type: 'panel',
    id: PANEL_ID,
    originProjectId: 'p-find',
    title: 'Find in Files',
    kind: 'findInFiles',
  };
}

/** Save a layout holding one Find in Files panel configured from `query`, and read it back. */
function roundTrip(projectId: string, query: FindInFilesQuery): Panel {
  const base = workspaces.load(OWNER, projectId).layout;
  const layout: WorkspaceLayout = {
    ...base,
    tabs: [{ id: base.tabs[0].id, title: 'Tab 1', root: findPanel() }],
  };
  // The runtime mutation the panel itself performs (`workspace-store.tsx` → `updatePanelConfig`),
  // rather than a hand-built config — so a change to how a panel writes is caught here too.
  workspaces.save(OWNER, projectId, updatePanelConfig(layout, PANEL_ID, findInFilesConfigOf(query)));
  return workspaces.load(OWNER, projectId).layout.tabs[0].root as Panel;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-fifpersist-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  projects = new ProjectRepository(db);
  workspaces = new WorkspaceRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('the panel’s query crosses a restart (FR-027a, FR-027b)', () => {
  it('brings back all five parts of the query, through a real layout row', () => {
    const project = seedProject();

    const panel = roundTrip(project.id, LIVE_PANEL);

    expect(findInFilesQueryFrom(panel.config)).toEqual({
      term: 'needle',
      modes: { caseSensitive: true, wholeWord: true },
      scopeSubPath: 'src/renderer',
      replaceEnabled: true,
      replacement: 'pin',
    });
  });

  it('restores the MATCH MODES, not merely the word', () => {
    /*
     * FR-027b's own parenthesis: a case-sensitive whole-word search restored as case-insensitive
     * substring is a different query wearing the same term. Asserted against a panel where both
     * modes are OFF as well as one where both are on, because a mapping that dropped the keys
     * entirely would satisfy the "both on" case by accident of the defaults only in one direction.
     */
    const project = seedProject();

    const both = findInFilesQueryFrom(roundTrip(project.id, LIVE_PANEL).config);
    const neither = findInFilesQueryFrom(
      roundTrip(project.id, { ...LIVE_PANEL, modes: { caseSensitive: false, wholeWord: false } })
        .config,
    );

    expect(both.modes).toEqual({ caseSensitive: true, wholeWord: true });
    expect(neither.modes).toEqual({ caseSensitive: false, wholeWord: false });
  });

  it('says "the whole root" as null rather than as the sub-directory ""', () => {
    const project = seedProject();

    const panel = roundTrip(project.id, { ...LIVE_PANEL, scopeSubPath: '' });

    expect((panel.config as { scopeSubPath?: unknown }).scopeSubPath).toBeNull();
    expect(findInFilesQueryFrom(panel.config).scopeSubPath).toBe('');
  });
});

describe('what the blob must NOT be carrying (FR-027b, FR-027c, FR-027d)', () => {
  it('persists the query and nothing else — no rows, no counts, no staleness, no commit marks', () => {
    const project = seedProject();

    const panel = roundTrip(project.id, LIVE_PANEL);

    expect(Object.keys(panel.config ?? {}).sort()).toEqual([
      'caseSensitive',
      'replaceShown',
      'replacement',
      'scopeSubPath',
      'term',
      'wholeWord',
    ]);
    // Said again as a substring search over the stored JSON, because the key list above would pass
    // if a future field nested the results one level down inside one of these six.
    const stored = JSON.stringify(panel.config);
    for (const leak of ['rows', 'relPath', 'totalMatches', 'staleFiles', 'committed', 'generation']) {
      expect(stored).not.toContain(leak);
    }
  });

  it('brings back a replacement with nothing to apply it to (FR-027c)', () => {
    /*
     * There is no pending-preview object to discard, and that is the design rather than an
     * omission: a preview is the replacement plus the rows on screen. Restoring the replacement
     * while restoring no rows is therefore a panel previewing nothing — which is why FR-027c needs
     * no cleanup code and why this asserts the ABSENCE that makes it true.
     */
    const project = seedProject();

    const restored = findInFilesQueryFrom(roundTrip(project.id, LIVE_PANEL).config);

    expect(restored.replaceEnabled).toBe(true);
    expect(restored.replacement).toBe('pin');
    expect(restored).not.toHaveProperty('results');
    expect(restored).not.toHaveProperty('committed');
  });

  it('reads a panel saved before this feature as an empty query rather than throwing', () => {
    // A layout row written by an older build has a panel with no `config` at all. The read is total
    // over `Record<string, unknown>` precisely so restoring one is a normal path, not a crash on
    // the startup of the first project someone opens.
    const project = seedProject();
    const base = workspaces.load(OWNER, project.id).layout;
    workspaces.save(OWNER, project.id, {
      ...base,
      tabs: [{ id: base.tabs[0].id, title: 'Tab 1', root: findPanel() }],
    });

    const panel = workspaces.load(OWNER, project.id).layout.tabs[0].root as Panel;

    expect(findInFilesQueryFrom(panel.config)).toEqual({
      term: '',
      modes: { caseSensitive: false, wholeWord: false },
      scopeSubPath: '',
      replaceEnabled: false,
      replacement: '',
    });
  });
});
