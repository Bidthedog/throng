/**
 * The remembered-input half of the navigation store (033 Phase 8, FR-061 – FR-063).
 *
 * The rules this covers are pure state transitions, so they belong HERE rather than in the E2E: what
 * counts as accepted, what a project change discards, and what turning a setting off discards. The
 * E2E (`navigation-remember.e2e.ts`) proves the modals are wired to them and that the value arrives
 * selected — the parts only a real window can answer.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  applyRememberSettings,
  noteActiveProjectRoot,
  rememberGotoLineNumber,
  rememberQuickOpenQuery,
  rememberedInput,
  resetRememberedInput,
} from '../../src/renderer/navigate/navigation-store.js';

const BOTH_ON = { quickOpenQuery: true, gotoLineNumber: true };

describe('remembered modal input (033, data-model.md §6)', () => {
  beforeEach(() => {
    resetRememberedInput();
  });

  it('starts holding nothing — the shipped state is two empty modals (FR-057)', () => {
    expect(rememberedInput()).toEqual({ quickOpenQuery: null, gotoLineNumber: null });
  });

  it('records an accepted query and an accepted line, independently', () => {
    rememberQuickOpenQuery('picker', 'C:/proj');
    expect(rememberedInput()).toEqual({ quickOpenQuery: 'picker', gotoLineNumber: null });

    rememberGotoLineNumber(412);
    expect(rememberedInput()).toEqual({ quickOpenQuery: 'picker', gotoLineNumber: 412 });
  });

  it('keeps only the LAST accepted value of each', () => {
    rememberQuickOpenQuery('first', 'C:/proj');
    rememberQuickOpenQuery('second', 'C:/proj');
    rememberGotoLineNumber(1);
    rememberGotoLineNumber(99);
    expect(rememberedInput()).toEqual({ quickOpenQuery: 'second', gotoLineNumber: 99 });
  });

  describe('the active project changes (FR-062)', () => {
    it('discards the query when the root moves to a different project', () => {
      rememberQuickOpenQuery('src/app', 'C:/one');
      noteActiveProjectRoot('C:/two');
      expect(rememberedInput().quickOpenQuery).toBeNull();
    });

    it('leaves the query alone when the root is the SAME project', () => {
      rememberQuickOpenQuery('src/app', 'C:/one');
      noteActiveProjectRoot('C:/one');
      noteActiveProjectRoot('C:/one');
      expect(rememberedInput().quickOpenQuery).toBe('src/app');
    });

    it('does not treat a momentarily rootless window as a project change', () => {
      rememberQuickOpenQuery('src/app', 'C:/one');
      noteActiveProjectRoot(null);
      noteActiveProjectRoot('');
      noteActiveProjectRoot('C:/one');
      expect(rememberedInput().quickOpenQuery).toBe('src/app');
    });

    it('leaves the remembered LINE alone — a line number is not project-scoped', () => {
      rememberGotoLineNumber(412);
      rememberQuickOpenQuery('src/app', 'C:/one');
      noteActiveProjectRoot('C:/two');
      expect(rememberedInput()).toEqual({ quickOpenQuery: null, gotoLineNumber: 412 });
    });

    it('re-scopes to the new project, so the NEXT switch back discards again', () => {
      rememberQuickOpenQuery('a', 'C:/one');
      noteActiveProjectRoot('C:/two');
      rememberQuickOpenQuery('b', 'C:/two');
      noteActiveProjectRoot('C:/one');
      expect(rememberedInput().quickOpenQuery).toBeNull();
    });
  });

  describe('a setting is turned off (FR-063)', () => {
    it('discards the value that setting holds, and only that one', () => {
      rememberQuickOpenQuery('src/app', 'C:/one');
      rememberGotoLineNumber(412);

      applyRememberSettings({ quickOpenQuery: false, gotoLineNumber: true });
      expect(rememberedInput()).toEqual({ quickOpenQuery: null, gotoLineNumber: 412 });

      applyRememberSettings({ quickOpenQuery: false, gotoLineNumber: false });
      expect(rememberedInput()).toEqual({ quickOpenQuery: null, gotoLineNumber: null });
    });

    it('does not resurrect the value when the setting comes back on', () => {
      rememberQuickOpenQuery('src/app', 'C:/one');
      rememberGotoLineNumber(412);
      applyRememberSettings({ quickOpenQuery: false, gotoLineNumber: false });
      applyRememberSettings(BOTH_ON);
      expect(rememberedInput()).toEqual({ quickOpenQuery: null, gotoLineNumber: null });
    });

    it('is idempotent — it is driven by an effect that re-runs on any settings change', () => {
      rememberQuickOpenQuery('src/app', 'C:/one');
      applyRememberSettings(BOTH_ON);
      applyRememberSettings(BOTH_ON);
      applyRememberSettings(BOTH_ON);
      expect(rememberedInput().quickOpenQuery).toBe('src/app');
    });

    it('drops the project the query was scoped to as well, so nothing stale survives', () => {
      rememberQuickOpenQuery('src/app', 'C:/one');
      applyRememberSettings({ quickOpenQuery: false, gotoLineNumber: false });
      applyRememberSettings(BOTH_ON);
      // Same root as before the discard: with the scope stale rather than cleared, this would be
      // the transition that let a discarded query matter again.
      noteActiveProjectRoot('C:/one');
      rememberQuickOpenQuery('fresh', 'C:/one');
      noteActiveProjectRoot('C:/one');
      expect(rememberedInput().quickOpenQuery).toBe('fresh');
    });
  });
});
