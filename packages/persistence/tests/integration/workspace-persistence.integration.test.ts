import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addTab, createProject, type Project, type WorkspaceLayout } from '@throng/core';
import {
  openDatabase,
  runMigrations,
  ProjectRepository,
  WorkspaceRepository,
  type ThrongDatabase,
} from '@throng/persistence';

let db: ThrongDatabase;
let dataDir: string;
let projects: ProjectRepository;
let workspaces: WorkspaceRepository;

const OWNER = 'alice';

function seedProject(id: string, name: string): Project {
  const project = createProject(
    { name, colour: '#6aa3ff', rootFolder: `C:/code/${name}` },
    { id, ownerUser: OWNER, now: new Date().toISOString(), isActive: false },
  );
  projects.insert(project);
  return project;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-wsp-'));
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  projects = new ProjectRepository(db);
  workspaces = new WorkspaceRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('per-project workspace persistence', () => {
  it('isolates layouts per project with no cross-contamination (SC-006)', () => {
    const p1 = seedProject('p1', 'one');
    const p2 = seedProject('p2', 'two');

    // p1: two tabs; p2: a single default tab.
    const layout1 = addTab(workspaces.load(OWNER, p1.id).layout, {
      tab: randomUUID(),
      panel: randomUUID(),
    });
    const layout2 = workspaces.load(OWNER, p2.id).layout;
    workspaces.save(OWNER, p1.id, layout1);
    workspaces.save(OWNER, p2.id, layout2);

    const reloaded1 = workspaces.load(OWNER, p1.id);
    const reloaded2 = workspaces.load(OWNER, p2.id);

    expect(reloaded1.restored).toBe(true);
    expect(reloaded1.layout.tabs).toHaveLength(2);
    expect(reloaded2.layout.tabs).toHaveLength(1);
    expect(reloaded1.layout.projectId).toBe('p1');
    expect(reloaded2.layout.projectId).toBe('p2');
  });

  it('preserves the active tab across a save/load round-trip (SC-006)', () => {
    const p1 = seedProject('p1', 'one');
    const base = workspaces.load(OWNER, p1.id).layout;
    const withTab = addTab(base, { tab: 'tab-2', panel: randomUUID() });
    // addTab activates the new tab.
    expect(withTab.activeTabId).toBe('tab-2');
    workspaces.save(OWNER, p1.id, withTab);

    const reloaded = workspaces.load(OWNER, p1.id);
    expect(reloaded.layout.activeTabId).toBe('tab-2');
  });

  it('preserves split sizes across a save/load round-trip', () => {
    const p1 = seedProject('p1', 'one');
    const layout: WorkspaceLayout = {
      ...workspaces.load(OWNER, p1.id).layout,
    };
    const sized: WorkspaceLayout = {
      ...layout,
      tabs: [
        {
          id: layout.tabs[0].id,
          title: 'Tab 1',
          root: {
            type: 'split',
            orientation: 'row',
            children: [
              { type: 'panel', id: 'a', originProjectId: 'p1', title: 'A' },
              { type: 'panel', id: 'b', originProjectId: 'p1', title: 'B' },
            ],
            sizes: [0.7, 0.3],
          },
        },
      ],
    };
    workspaces.save(OWNER, p1.id, sized);

    const reloaded = workspaces.load(OWNER, p1.id);
    const root = reloaded.layout.tabs[0].root;
    expect(root.type).toBe('split');
    if (root.type === 'split') {
      expect(root.sizes).toEqual([0.7, 0.3]);
    }
  });

  it('cascades layout deletion when a project is deleted (FR-006, T048)', () => {
    const p1 = seedProject('p1', 'one');
    workspaces.save(OWNER, p1.id, workspaces.load(OWNER, p1.id).layout);

    // Confirm a row exists, then delete the project.
    const before = db
      .prepare('SELECT COUNT(*) AS n FROM workspace_layout WHERE project_id = ?')
      .get('p1') as { n: number };
    expect(before.n).toBe(1);

    projects.remove(OWNER, 'p1');

    const after = db
      .prepare('SELECT COUNT(*) AS n FROM workspace_layout WHERE project_id = ?')
      .get('p1') as { n: number };
    expect(after.n).toBe(0);
  });

  it('skips a corrupt sub-workspace row instead of failing the whole load', () => {
    workspaces.persistSubWorkspaces('alice', [
      {
        id: 'good',
        ownerUser: 'alice',
        name: 'Good',
        colour: '#8a8f98',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        tabs: [{ id: 't', title: 'D', root: { type: 'panel', id: 'p', originProjectId: 'x', title: 'P' } }],
      },
    ]);
    // Inject an unparseable row directly.
    db.prepare(
      `INSERT INTO sub_workspaces (id, owner_user, bounds_json, content_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run('bad', 'alice', '{ not json', '{ also bad', 'now');

    const loaded = workspaces.loadSubWorkspaces('alice');
    expect(loaded.map((s) => s.id)).toEqual(['good']);
  });

  it('persists + restores a sub-workspace active tab, and reads legacy content (003)', () => {
    workspaces.persistSubWorkspaces('alice', [
      {
        id: 'sw',
        ownerUser: 'alice',
        name: 'SW',
        colour: '#8a8f98',
        bounds: { x: 0, y: 0, width: 800, height: 600 },
        tabs: [
          { id: 't1', title: 'A', root: { type: 'panel', id: 'p1', originProjectId: 'x', title: 'P' } },
          { id: 't2', title: 'B', root: { type: 'panel', id: 'p2', originProjectId: 'x', title: 'P' } },
        ],
        activeTabId: 't2',
      },
    ]);
    expect(workspaces.loadSubWorkspaces('alice')[0].activeTabId).toBe('t2');

    // A legacy row whose content_json is a bare Tab[] still loads (activeTabId undefined).
    db.prepare(
      `INSERT INTO sub_workspaces (id, owner_user, name, colour, bounds_json, content_json, updated_at, position)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      'legacy',
      'alice',
      'Legacy',
      '#8a8f98',
      JSON.stringify({ x: 0, y: 0, width: 400, height: 300 }),
      JSON.stringify([{ id: 'lt', title: 'L', root: { type: 'panel', id: 'lp', originProjectId: 'x', title: 'P' } }]),
      'now',
      9,
    );
    const legacy = workspaces.loadSubWorkspaces('alice').find((s) => s.id === 'legacy');
    expect(legacy?.tabs).toHaveLength(1);
    expect(legacy?.activeTabId).toBeUndefined();
  });

  it('falls back to a default empty workspace with reason=corrupt on a bad document', () => {
    seedProject('p1', 'one');
    db.prepare(
      `INSERT INTO workspace_layout (owner_user, project_id, schema_version, layout_json, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(OWNER, 'p1', 1, '{ not valid json', 'now');

    const result = workspaces.load(OWNER, 'p1');
    expect(result.restored).toBe(false);
    expect(result.reason).toBe('corrupt');
    expect(result.layout.tabs).toHaveLength(1);
  });
});
