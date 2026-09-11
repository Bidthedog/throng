import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createProject, type Panel, type Project, type WorkspaceLayout } from '@throng/core';
import {
  openDatabase,
  runMigrations,
  LATEST_VERSION,
  ProjectRepository,
  WorkspaceRepository,
  type ThrongDatabase,
} from '@throng/persistence';

/**
 * 043 T020 (research R11) — Find in Files needs NO schema change, and this is the guard that says so.
 *
 * ══ WHY A TEST RATHER THAN A NOTE IN THE PLAN ══
 *
 * `no-editor-migration.integration.test.ts` is the precedent and also the cautionary tale. Feature
 * 006 decided an editor panel needed no table — its kind and config ride the `workspace_layout`
 * blob — and pinned that decision here. Feature 016 then found state that genuinely was NOT panel
 * state (a language override, which must be found by a panel opening the same file later, in
 * another window or another session) and REVERSED the guard in the open rather than deleting it to
 * make a migration pass.
 *
 * So the value of this file is not that it stops a migration. It is that adding one has to argue
 * with a written decision first. The argument for this feature is short: everything a Find in Files
 * panel persists describes ITS OWN QUERY — term, match modes, scope, replace toggle, replacement —
 * and nothing else needs to find it. Results are deliberately not persisted at all (FR-027b), so
 * there is no unbounded blob to size, no pruning, and no foreign key anybody would want.
 *
 * ══ WHAT WOULD MAKE THIS GUARD WRONG ══
 *
 * The same thing that made 006's wrong: state that outlives the panel or is looked up by something
 * other than the panel. If a future increment remembers, say, a project's last search across
 * panels, that is not panel state and this file should be reversed, in the open, with its reasoning
 * replaced rather than removed.
 */
const OWNER = 'alice';
const PANEL_ID = 'fif-1';

let db: ThrongDatabase;
let dataDir: string;
let projects: ProjectRepository;
let workspaces: WorkspaceRepository;

/** A second, untouched store inside the same scratch directory `afterEach` already removes. */
function freshDbPath(): string {
  return join(dataDir, 'fresh.db');
}

function seedProject(): Project {
  const project = createProject(
    { name: 'FindProj', colour: '#6aa3ff', rootFolder: 'C:/code/findproj' },
    { id: 'p-find', ownerUser: OWNER, now: new Date().toISOString(), isActive: false },
  );
  projects.insert(project);
  return project;
}

/** A Find in Files panel exactly as the renderer persists one (FR-027b's five parts). */
function findPanel(): Panel {
  return {
    type: 'panel',
    id: PANEL_ID,
    originProjectId: 'p-find',
    title: 'Find in Files',
    kind: 'findInFiles',
    config: {
      term: 'needle',
      caseSensitive: true,
      wholeWord: true,
      scopeSubPath: 'src/renderer',
      replaceShown: true,
      replacement: 'pin',
    },
  };
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-nofind-data-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  projects = new ProjectRepository(db);
  workspaces = new WorkspaceRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('043 adds a panel type and no schema (research R11)', () => {
  it('leaves the latest schema version exactly where 016 left it', () => {
    expect(LATEST_VERSION).toBe(8);
  });

  it('still migrates a fresh store to that version and no further', () => {
    const fresh = openDatabase({ databasePath: freshDbPath() });
    try {
      expect(runMigrations(fresh).to).toBe(8);
      expect(Number(fresh.pragma('user_version', { simple: true }))).toBe(8);
    } finally {
      fresh.close();
    }
  });

  it('creates no table of its own — a search is not a stored thing', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all()
      .map((r) => (r as { name: string }).name);
    for (const unwanted of ['searches', 'file_searches', 'find_in_files', 'search_results']) {
      expect(tables).not.toContain(unwanted);
    }
  });

  it('round-trips a Find in Files panel through `workspace_layout` unchanged', () => {
    const project = seedProject();
    const base = workspaces.load(OWNER, project.id).layout;
    const layout: WorkspaceLayout = {
      ...base,
      tabs: [{ id: base.tabs[0].id, title: 'Tab 1', root: findPanel() }],
    };

    workspaces.save(OWNER, project.id, layout);
    const reloaded = workspaces.load(OWNER, project.id);
    const panel = reloaded.layout.tabs[0].root as Panel;

    expect(reloaded.restored).toBe(true);
    expect(panel.kind).toBe('findInFiles');
    expect(panel.config).toEqual(findPanel().config);
  });

  it('keeps the blob at the same layout schema version it went in at', () => {
    // The version that WOULD move if somebody decided this panel needed a layout migration. It is
    // the cheapest thing to assert and the first thing such a change would touch.
    const project = seedProject();
    const base = workspaces.load(OWNER, project.id).layout;
    const layout: WorkspaceLayout = {
      ...base,
      tabs: [{ id: base.tabs[0].id, title: 'Tab 1', root: findPanel() }],
    };

    workspaces.save(OWNER, project.id, layout);

    expect(workspaces.load(OWNER, project.id).layout.schemaVersion).toBe(base.schemaVersion);
  });
});
