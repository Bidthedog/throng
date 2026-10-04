/**
 * 050 — cut, copy and paste between projects, end to end (US1, US2, US3; SC-001 – SC-003).
 *
 * ══ WHAT ONLY THIS LAYER CAN SEE ══
 *
 * Every piece is pinned lower down: the clipboard's transitions (core unit), the transfer engine and its
 * bracket on a real filesystem (integration), the Paste label, the greying and the two-stack undo sync
 * (component). What none of them composes is the application doing it: a REAL project switch remounting
 * the tree from a different root while main keeps the clipboard, main's engine moving the file between
 * two roots, the editor coordinator re-pointing an editor that lives in the OTHER project's workspace,
 * and the daemon holding one undo entry in two projects' stacks. Those are four processes' worth of
 * state agreeing about one file, which is `@reserve:runtime`.
 *
 * One app for the file (the tests share their projects), serial.
 */
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, expect, type Page } from '@playwright/test';
import {
  openApp,
  createProject,
  switchProject,
  firstPanelId,
  cleanupTemp,
  FILE_OP_TIMEOUT_MS,
  type OpenApp,
} from './harness.js';

test.describe.configure({ mode: 'serial' });

let shared: OpenApp;
let rootA: string;
let rootB: string;
const nameA = 'XProjA';
const nameB = 'XProjB';

test.beforeAll(async () => {
  rootA = mkdtempSync(join(tmpdir(), 'throng-xp-a-'));
  rootB = mkdtempSync(join(tmpdir(), 'throng-xp-b-'));
  writeFileSync(join(rootA, 'config.json'), '{"copied":true}\n');
  writeFileSync(join(rootA, 'moving.txt'), 'MOVE-ACROSS\n');
  mkdirSync(join(rootB, 'dest'));
  shared = await openApp();
  await createProject(shared.win, nameA, rootA);
  await createProject(shared.win, nameB, rootB);
});

test.afterAll(async () => {
  await shared?.close();
  if (rootA) cleanupTemp(rootA);
  if (rootB) cleanupTemp(rootB);
});

const tree = (win: Page) => win.getByTestId('file-explorer-tree');
const menuItem = (win: Page, name: RegExp) => win.getByRole('menuitem', { name });

/** The coordinator's own path for the document in `panelId` — the authority, not the view. */
async function docPath(win: Page, panelId: string): Promise<string | null> {
  const raw = await win.evaluate(async (pid) => {
    const docs = await window.throng.editor.list();
    return docs.find((d) => d.panelId === pid)?.absPath ?? null;
  }, panelId);
  return raw === null ? null : raw.replace(/\\/g, '/').toLowerCase();
}
const norm = (p: string): string => p.replace(/\\/g, '/').toLowerCase();

test('copy and move a file between projects; the open editor follows it (US1, US2, SC-001, SC-002)', { tag: ['@extended', '@explorer', '@reserve:runtime'] }, async () => {
  const { win } = shared;

  // ── Copy: Ctrl+C in A, Paste in B names what lands and where it came from (FR-025a). ──
  await switchProject(win, nameA);
  await tree(win).getByText('config.json', { exact: true }).click({ button: 'right' });
  await menuItem(win, /^Copy \(/).click();
  await switchProject(win, nameB);
  await tree(win).getByText('dest', { exact: true }).click({ button: 'right' });
  const paste = menuItem(win, /^Paste /);
  await expect(paste).toContainText(`Paste "config.json" from ${nameA}`);
  await paste.click();
  await expect.poll(() => existsSync(join(rootB, 'dest', 'config.json')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
  expect(existsSync(join(rootA, 'config.json'))).toBe(true);

  // ── Move: an editor open on the file in A shows the new path, clean, with the moved notice (FR-016, FR-035). ──
  await switchProject(win, nameA);
  const pid = await firstPanelId(win);
  await win.getByTestId(`panel-type-select-${pid}`).selectOption('editor');
  await win.getByTestId(`panel-type-confirm-${pid}`).click();
  await win.getByTestId(`editor-${pid}`).click();
  await tree(win).getByText('moving.txt', { exact: true }).click();
  await expect(win.getByTestId(`editor-${pid}`).locator('.cm-content')).toContainText('MOVE-ACROSS', { timeout: 8000 });

  await tree(win).getByText('moving.txt', { exact: true }).click({ button: 'right' });
  await menuItem(win, /^Cut \(/).click();

  // FR-004 — still greyed after a round trip through the other project.
  await switchProject(win, nameB);
  await switchProject(win, nameA);
  await expect(tree(win).locator('.tree-row--cut', { hasText: 'moving.txt' })).toHaveCount(1);

  await switchProject(win, nameB);
  await tree(win).getByText('dest', { exact: true }).click({ button: 'right' });
  await menuItem(win, /^Paste /).click();
  const moved = join(rootB, 'dest', 'moving.txt');
  await expect.poll(() => existsSync(moved), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
  await expect.poll(() => existsSync(join(rootA, 'moving.txt')), { timeout: FILE_OP_TIMEOUT_MS }).toBe(false);

  await expect.poll(() => docPath(win, pid), { timeout: FILE_OP_TIMEOUT_MS }).toBe(norm(moved));
  await switchProject(win, nameA);
  await expect(win.getByTestId(`panel-unsaved-${pid}`)).toHaveCount(0);
  await expect(win.getByTestId('notices').locator('.notice--error')).toHaveCount(0);
  // 050 FR-035 — A's editor stays behind, read-only, saying where the file went.
  await expect(win.getByTestId(`panel-failure-${pid}`)).toContainText('This file moved to another project', { timeout: FILE_OP_TIMEOUT_MS });
});

test('a move between projects is undone from the project it came from (US3, SC-003)', { tag: ['@extended', '@explorer', '@reserve:runtime'] }, async () => {
  const { win } = shared;
  const moved = join(rootB, 'dest', 'moving.txt');
  const home = join(rootA, 'moving.txt');
  const pid = await firstPanelId(win);

  // Ctrl+Z in A's tree — the project the file LEFT — brings it back, and the editor follows (FR-020).
  await switchProject(win, nameA);
  // Focus the tree on its root row — clicking a FILE would open it in the editor under test.
  await tree(win).getByRole('treeitem').first().click();
  await win.keyboard.press('Control+z');
  await expect.poll(() => existsSync(home), { timeout: FILE_OP_TIMEOUT_MS }).toBe(true);
  expect(existsSync(moved)).toBe(false);
  await expect.poll(() => docPath(win, pid), { timeout: FILE_OP_TIMEOUT_MS }).toBe(norm(home));
  // Back in its own project, the editor is an ordinary editor again (050 FR-035).
  await expect(win.getByTestId(`panel-failure-${pid}`)).toHaveCount(0, { timeout: FILE_OP_TIMEOUT_MS });

  // B's stacks were moved with it: its Undo no longer offers the move, its Redo does (US3 AS3).
  await switchProject(win, nameB);
  await tree(win).getByText('dest', { exact: true }).click({ button: 'right' });
  await expect(menuItem(win, /^Undo /)).toBeDisabled();
  await expect(menuItem(win, /^Redo /)).toBeEnabled();
  await win.keyboard.press('Escape');
});
