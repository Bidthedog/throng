/**
 * REPRO for #229 — a persisted editor `filePath` is stored in whatever shape its producer built,
 * not in one canonical OS-native form.
 *
 * The explorer tree builds an absolute path by concatenating a NATIVE root with a forward-slashed
 * tail (`file-tree.tsx:378` / `:514` — `` `${rootFolder}/${node.data.relPath}` ``). Nothing
 * normalises it on the way in, so the mixed form (`D:\git\throng/SECURITY.md`) survives into
 * `workspace_layout.layout_json` and is what every consumer reads back.
 *
 * `WorkspaceRepository.save` is the boundary this asserts against: it is the single place every
 * persisted layout passes through, so it is where the canon has to hold regardless of which
 * producer built the string.
 *
 * ── Platform note, stated rather than hidden ──
 * A "mixed" separator only exists where `\` IS a separator. On POSIX the producer's `${root}/${rel}`
 * is already canonical, so the case below cannot fail there — it is a regression guard on POSIX and
 * a reproduction on Windows, which is the platform the defect was reported on (Windows 11,
 * v1.0.0-alpha1). It is deliberately NOT skipped: the invariant is the same on both.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  collectPanels,
  createProject,
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

let db: ThrongDatabase;
let dataDir: string;
let projects: ProjectRepository;
let workspaces: WorkspaceRepository;

const OWNER = 'alice';

/** A native project root, exactly as the projects store holds one. */
let projectRoot: string;

function seedProject(id: string, name: string): Project {
  const project = createProject(
    { name, colour: '#6aa3ff', rootFolder: projectRoot },
    { id, ownerUser: OWNER, now: new Date().toISOString(), isActive: false },
  );
  projects.insert(project);
  return project;
}

/** Put one editor panel carrying `filePath` at the root of the project's only tab. */
function layoutWithEditorPath(base: WorkspaceLayout, filePath: string): WorkspaceLayout {
  const [panel] = collectPanels(base.tabs[0].root);
  const editor: Panel = { ...panel, kind: 'editor', config: { filePath } };
  return { ...base, tabs: [{ ...base.tabs[0], root: editor }] };
}

function reloadedFilePath(projectId: string): unknown {
  const { layout } = workspaces.load(OWNER, projectId);
  return collectPanels(layout.tabs[0].root)[0]?.config?.filePath;
}

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'throng-canon-'));
  projectRoot = join(dataDir, 'project');
  db = openDatabase({ databasePath: join(dataDir, 'throng.db') });
  runMigrations(db);
  projects = new ProjectRepository(db);
  workspaces = new WorkspaceRepository(db);
});

afterEach(() => {
  db.close();
  rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe('#229 — a persisted absolute path is stored in one canonical native form', () => {
  it('canonicalises the explorer tree\u2019s mixed-separator path on the way in', () => {
    const project = seedProject('p1', 'one');
    // Byte-for-byte the expression `file-tree.tsx` uses to build the path it hands the editor.
    const asTheTreeBuildsIt = `${projectRoot}/docs/SECURITY.md`;
    const canonical = join(projectRoot, 'docs', 'SECURITY.md');

    workspaces.save(
      OWNER,
      project.id,
      layoutWithEditorPath(workspaces.load(OWNER, project.id).layout, asTheTreeBuildsIt),
    );

    expect(reloadedFilePath(project.id)).toBe(canonical);
  });

  it('leaves no foreign separator in a stored path', () => {
    const project = seedProject('p2', 'two');
    const asTheTreeBuildsIt = `${projectRoot}/a/b/notes.txt`;

    workspaces.save(
      OWNER,
      project.id,
      layoutWithEditorPath(workspaces.load(OWNER, project.id).layout, asTheTreeBuildsIt),
    );

    const stored = reloadedFilePath(project.id) as string;
    const foreign = sep === '\\' ? '/' : '\\';
    expect(stored.includes(foreign)).toBe(false);
  });

  it('round-trips a path that was ALREADY canonical, unchanged', () => {
    const project = seedProject('p3', 'three');
    const canonical = join(projectRoot, 'src', 'index.ts');

    workspaces.save(
      OWNER,
      project.id,
      layoutWithEditorPath(workspaces.load(OWNER, project.id).layout, canonical),
    );

    expect(reloadedFilePath(project.id)).toBe(canonical);
  });
});
