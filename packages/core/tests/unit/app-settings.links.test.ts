import { describe, expect, it } from 'vitest';
import { DEFAULT_APP_SETTINGS, parseAppSettings } from '../../src/config/app-settings.js';
import { DEFAULT_LINK_ACTIONS } from '../../src/links/default-action.js';

/**
 * 045 FR-050, FR-060, FR-080b — the four settings leaves (`contracts/settings-and-environment.md`
 * §1).
 *
 * Each leaf needs FOUR edits in `app-settings.ts`, and the fourth is the one that fails silently:
 * a field in the interface, the defaults and the tolerant parse but NOT in the section's `clone…`
 * compiles, ships, and is dropped on every write — the user's value comes back as the default and
 * nothing anywhere says so (`app-settings.ts:1017-1019`, 039's own note). So the round-trip cases
 * below are not belt-and-braces; they are the only thing that catches that edit being missed.
 */

describe('editor.links — the three link settings (FR-050, FR-060)', () => {
  it('ships Open in throng, and both detection switches ON', () => {
    expect(DEFAULT_APP_SETTINGS.editor.links).toEqual({
      defaultAction: 'throng',
      detectInEditors: true,
      detectInTerminals: true,
    });
  });

  it('the shipped default action is the first of FR-050’s values', () => {
    expect(DEFAULT_APP_SETTINGS.editor.links.defaultAction).toBe(DEFAULT_LINK_ACTIONS[0]);
  });

  it('parses every one of FR-050’s values', () => {
    for (const action of DEFAULT_LINK_ACTIONS) {
      expect(
        parseAppSettings({ editor: { links: { defaultAction: action } } }).editor.links.defaultAction,
      ).toBe(action);
    }
  });

  it('falls back for a wrong type and for an unknown enum value, per leaf', () => {
    for (const bad of [null, 0, '', 'OSExplorer', 'browser', [], {}, true]) {
      expect(
        parseAppSettings({ editor: { links: { defaultAction: bad } } }).editor.links.defaultAction,
        String(bad),
      ).toBe('throng');
    }
    for (const bad of [null, 0, 'true', 'yes', [], {}]) {
      const s = parseAppSettings({
        editor: { links: { detectInEditors: bad, detectInTerminals: bad } },
      });
      expect(s.editor.links.detectInEditors, String(bad)).toBe(true);
      expect(s.editor.links.detectInTerminals, String(bad)).toBe(true);
    }
  });

  it('a bad leaf does not take its siblings down with it', () => {
    const s = parseAppSettings({
      editor: { links: { defaultAction: 'nonsense', detectInTerminals: false } },
    });
    expect(s.editor.links.defaultAction).toBe('throng');
    expect(s.editor.links.detectInTerminals).toBe(false);
    expect(s.editor.links.detectInEditors).toBe(true);
  });

  it('a missing or malformed links block falls back whole', () => {
    expect(parseAppSettings({ editor: {} }).editor.links).toEqual(DEFAULT_APP_SETTINGS.editor.links);
    expect(parseAppSettings({ editor: { links: 'off' } }).editor.links).toEqual(
      DEFAULT_APP_SETTINGS.editor.links,
    );
  });

  it('ROUND-TRIP: a non-default value survives a parse of a parsed document', () => {
    const once = parseAppSettings({
      editor: { links: { defaultAction: 'osExplorer', detectInEditors: false, detectInTerminals: false } },
    });
    const twice = parseAppSettings(once);
    expect(twice.editor.links).toEqual({
      defaultAction: 'osExplorer',
      detectInEditors: false,
      detectInTerminals: false,
    });
  });

  it('the parsed block is never the shipped defaults object itself', () => {
    // A shared reference lets one reader's mutation edit the shipped defaults for the whole process.
    expect(parseAppSettings({}).editor.links).not.toBe(DEFAULT_APP_SETTINGS.editor.links);
    expect(parseAppSettings({}).editor.links).not.toBe(parseAppSettings({}).editor.links);
  });
});

describe('terminals.advertiseHyperlinks (FR-080b)', () => {
  it('ships ON', () => {
    expect(DEFAULT_APP_SETTINGS.terminals.advertiseHyperlinks).toBe(true);
  });

  it('parses a boolean and falls back for anything else', () => {
    expect(
      parseAppSettings({ terminals: { advertiseHyperlinks: false } }).terminals.advertiseHyperlinks,
    ).toBe(false);
    for (const bad of [null, 0, 'false', 'off', [], {}]) {
      expect(
        parseAppSettings({ terminals: { advertiseHyperlinks: bad } }).terminals.advertiseHyperlinks,
        String(bad),
      ).toBe(true);
    }
  });

  it('ROUND-TRIP: an OFF value survives a parse of a parsed document', () => {
    const once = parseAppSettings({ terminals: { advertiseHyperlinks: false } });
    expect(parseAppSettings(once).terminals.advertiseHyperlinks).toBe(false);
  });

  it('it does not disturb its neighbours in the terminal section', () => {
    const s = parseAppSettings({
      terminals: { advertiseHyperlinks: false, shellIntegration: false, linkHoverDelayMs: 900 },
    });
    expect(s.terminals.advertiseHyperlinks).toBe(false);
    expect(s.terminals.shellIntegration).toBe(false);
    expect(s.terminals.linkHoverDelayMs).toBe(900);
  });
});
