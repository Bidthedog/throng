import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, type AppSettings } from '@throng/core';
import { NodeFileSystem } from '../../src/main/node-file-system.js';
import { EditorService, type LoadRequest } from '../../src/main/editor-service.js';
import { EditorCoordinator } from '../../src/main/editor-coordinator.js';
import { EditorRecovery } from '../../src/main/editor-recovery.js';

/**
 * 018 / US9 — the drop/open decision against a REAL filesystem (FR-057…FR-066, SC-011/SC-012).
 *
 * The unit test proves the RULE. This proves the rule is applied to the path the operating system
 * actually has, which is a different claim and the one that matters: a symlink is a real thing on a real
 * disk, and a confinement rule that inspects the link instead of its target is not a confinement rule.
 *
 * It also proves the central thesis of the story — READ SCOPE EQUALS WRITE SCOPE. Before US9 the save
 * path resolved symlinks and applied the full rule while the load path did neither, so a file could be
 * OPENED into an editor that would later REFUSE TO SAVE IT. Here, load and save are asked the same
 * questions and must give the same answers.
 */

const fs = new NodeFileSystem(async () => {});

let project: string;
let outside: string;
let settings: AppSettings;
let service: EditorService;
/** Windows needs Developer Mode or elevation to create one; skipping is honest, faking is not. */
let symlinksWork = true;

const req = (absPath: string, over: Partial<LoadRequest> = {}): LoadRequest => ({
  absPath,
  ownerKind: 'project',
  ownerRoot: project,
  allProjectRoots: [project],
  ...over,
});

beforeEach(async () => {
  project = await mkdtemp(join(tmpdir(), 'throng-proj-'));
  outside = await mkdtemp(join(tmpdir(), 'throng-out-'));
  await writeFile(join(project, 'in.txt'), 'inside\n');
  await mkdir(join(project, 'sub'));
  await writeFile(join(outside, 'out.txt'), 'outside\n');
  settings = structuredClone(DEFAULT_APP_SETTINGS);
  service = new EditorService(fs, () => settings);
  try {
    await symlink(join(outside, 'out.txt'), join(project, 'escape.txt'), 'file');
    await symlink(join(project, 'in.txt'), join(outside, 'reach-in.txt'), 'file');
    symlinksWork = true;
  } catch {
    symlinksWork = false;
  }
});

afterEach(async () => {
  await rm(project, { recursive: true, force: true, maxRetries: 5 });
  await rm(outside, { recursive: true, force: true, maxRetries: 5 });
});

describe('symlinks are resolved BEFORE the ownership rule (SC-011)', () => {
  it('a link INSIDE the project that points OUT of it is refused', async () => {
    if (!symlinksWork) return;
    // The link lives in the project. Its target does not. Judging the link would let the file in — and
    // then the save path, which does resolve it, would refuse to write it back.
    const decision = await service.resolveEntry(req(join(project, 'escape.txt')));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('out-of-tree');
  });

  it('a link OUTSIDE the project that points INTO it is ACCEPTED for a project editor', async () => {
    if (!symlinksWork) return;
    // The mirror image, and the one a rule written from the link would get wrong in the other
    // direction: this file really does live in the project, so a project editor may have it.
    const decision = await service.resolveEntry(req(join(outside, 'reach-in.txt')));
    expect(decision.ok).toBe(true);
    if (decision.ok) expect(decision.absPath.toLowerCase()).toContain('in.txt');
  });

  it('…and that same link is REFUSED for a sub-workspace editor, because it resolves into a project', async () => {
    if (!symlinksWork) return;
    const decision = await service.resolveEntry(
      req(join(outside, 'reach-in.txt'), { ownerKind: 'subworkspace', ownerRoot: null }),
    );
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('out-of-tree');
  });
});

describe('the distinct reasons', () => {
  it('a folder is refused as a FOLDER, not as something else', async () => {
    const decision = await service.resolveEntry(req(join(project, 'sub')));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('folder');
  });

  it('an oversized file is refused as TOO-LARGE', async () => {
    await writeFile(join(project, 'big.txt'), 'x'.repeat(4096));
    settings.editor.maxOpenFileBytes = 1024;
    const decision = await service.resolveEntry(req(join(project, 'big.txt')));
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.reason).toBe('too-large');
  });

  it('a missing file is an IO error — and is NOT confused with a refusal', async () => {
    const result = await service.load(req(join(project, 'nope.txt')));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('io');
  });

  it('a REFUSED file reports out-of-tree — distinguishable from a missing one', async () => {
    // These two used to be the same reason, which is how an ownership refusal ended up being announced
    // as a missing file and then suppressed by a preference about missing files.
    const result = await service.load(req(join(outside, 'out.txt')));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe('out-of-tree');
      expect(result.reason).not.toBe('io');
    }
  });
});

describe('read scope equals write scope (SC-012)', () => {
  it('a sub-workspace editor cannot LOAD a file that lives inside a project', async () => {
    // THE TRAP. Before US9 this file opened happily, and then refused to save — the user typed into a
    // buffer that had nowhere to go, and found out at the worst possible moment.
    const result = await service.load(
      req(join(project, 'in.txt'), { ownerKind: 'subworkspace', ownerRoot: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('out-of-tree');

    // And the save path agrees — which is the whole point: one rule, not two that are supposed to.
    const saved = await service.save({
      absPath: join(project, 'in.txt'),
      text: 'x',
      encoding: 'utf8',
      hasBom: false,
      lineEnding: 'lf',
      ownerKind: 'subworkspace',
      ownerRoot: null,
      allProjectRoots: [project],
    });
    expect(saved.ok).toBe(false);
    if (!saved.ok) expect(saved.reason).toBe('out-of-tree');
  });

  it('an unknown owner root is not a licence to open anything', async () => {
    // The old load path SKIPPED the check when `ownerRoot` was null, turning a missing fact into
    // permission. A project-owned document with no known root confines nothing, so it falls to the
    // outside-all-projects rule — not to no rule.
    const result = await service.load(req(join(project, 'in.txt'), { ownerRoot: null }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('out-of-tree');
  });

  it('the ordinary case still works: a project file opens in its own project editor', async () => {
    const result = await service.load(req(join(project, 'in.txt')));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.text).toBe('inside\n');
  });
});

describe('the RESTORE route — no gesture at all (T103a, SC-012)', () => {
  it('a sub-workspace panel whose persisted file points INSIDE a project is refused on restore', async () => {
    // This is the route with no interaction to write a test around, and therefore the one most likely to
    // be forgotten: the user does nothing. The panel simply reopens on the next launch, holding a path it
    // saved when the rule was laxer — or when the folder was not yet a project. Read scope must equal
    // write scope on EVERY route in, not only the ones the user can see themselves taking.
    const recoveryDir = await mkdtemp(join(tmpdir(), 'throng-rec-'));
    try {
      const coordinator = new EditorCoordinator(
        service,
        new EditorRecovery(fs, recoveryDir),
        { relaySync: () => {} },
      );
      const result = await coordinator.load({
        panelId: 'p1',
        windowId: 'w1',
        ownerKind: 'subworkspace',
        ownerRoot: null,
        allProjectRoots: [project],
        tabId: 't1',
        absPath: join(project, 'in.txt'),
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe('out-of-tree');
    } finally {
      await rm(recoveryDir, { recursive: true, force: true, maxRetries: 5 });
    }
  });
});
