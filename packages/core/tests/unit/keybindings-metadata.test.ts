import { describe, it, expect } from 'vitest';
import { KEYBINDINGS_METADATA } from '../../src/config/keybindings-metadata.js';
import { assertEveryKeyDescribed, auditRegistry } from '../../src/config/metadata.js';
import { COMMAND_SCOPES, DEFAULT_KEYBINDINGS, type ActionId } from '../../src/config/keybindings.js';

const ACTION_IDS = Object.keys(DEFAULT_KEYBINDINGS.bindings);

describe('KEYBINDINGS_METADATA completeness (FR-047/030)', () => {
  it('describes every ActionId and no unknown keys', () => {
    expect(() => assertEveryKeyDescribed(ACTION_IDS, KEYBINDINGS_METADATA)).not.toThrow();
    expect(auditRegistry(ACTION_IDS, KEYBINDINGS_METADATA)).toEqual({
      missing: [],
      unknown: [],
      duplicated: [],
    });
  });

  it('every descriptor is a chord control with label/description/group', () => {
    for (const d of KEYBINDINGS_METADATA) {
      expect(d.control, d.key).toBe('chord');
      expect(d.label.length, d.key).toBeGreaterThan(0);
      expect(d.description.length, d.key).toBeGreaterThan(0);
      expect(d.group.length, d.key).toBeGreaterThan(0);
    }
  });

  it('describes the scroll-sync toggle once, as "Synchronise Scrolling" in Editor (044 FR-122d)', () => {
    const matches = KEYBINDINGS_METADATA.filter((d) => d.key === 'preview.toggleSyncScroll');
    expect(matches).toHaveLength(1);
    expect(matches[0].label).toBe('Synchronise Scrolling');
    expect(matches[0].group).toBe('Editor');
    // Beside "Toggle word wrap", the other view toggle in the group.
    const keys = KEYBINDINGS_METADATA.map((d) => d.key);
    expect(keys.indexOf('preview.toggleSyncScroll')).toBe(keys.indexOf('editor.toggleWordWrap') + 1);
  });

  /**
   * M9 (review finding) — `zoom.reset`'s description used to read "Ctrl+Shift+0 works too, so
   * Shift can stay held after zooming in with Ctrl++.", hard-coding the shipped chord into prose.
   * Rebind `zoom.reset` (or the guarded 046 FR-025 upgrade skips a user's rebind entirely, see
   * `applyKeybindingsUpgrade`) and the sentence becomes false — the description must describe the
   * ACTION, not name a specific key combination that the user might not have.
   */
  it('does not hard-code a chord into the zoom.reset description', () => {
    const d = KEYBINDINGS_METADATA.find((m) => m.key === 'zoom.reset');
    expect(d, 'no descriptor for zoom.reset').toBeDefined();
    // A chord token looks like "Ctrl+…", "Shift+…", "Alt+…" or a bare key name followed by "+".
    expect(d!.description).not.toMatch(/Ctrl\+|Shift\+|Alt\+|Cmd\+/);
  });

  /**
   * Branch-review finding (spec 046, FR-113) — `zoom.in`/`zoom.out`/`zoom.reset`'s descriptions used
   * to say "Also on the title bar's Zoom row", from 046 iterate round 1 (FR-107). The maintainer
   * removed that row mid-build ("Remove the new 'Zoom' options from the menu") and FR-113 made the
   * window zoom's three chords keyboard-only, with no mouse or menu route at all — a description
   * still pointing at the removed row would send a user hunting for a control that no longer exists.
   */
  it('does not point zoom.in/zoom.out/zoom.reset at the removed cog-menu Zoom row (FR-113)', () => {
    for (const key of ['zoom.in', 'zoom.out', 'zoom.reset']) {
      const d = KEYBINDINGS_METADATA.find((m) => m.key === key);
      expect(d, `no descriptor for ${key}`).toBeDefined();
      expect(d!.description, key).not.toMatch(/zoom row|cog menu/i);
    }
  });

  it('has unique descriptor keys', () => {
    const seen = new Set<string>();
    for (const d of KEYBINDINGS_METADATA) {
      expect(seen.has(d.key), `duplicate ${d.key}`).toBe(false);
      seen.add(d.key);
    }
  });

  /**
   * 046 T031 (US2, FR-022, FR-070, configuration-editor completeness). All four commands MUST
   * appear in the keybindings editor with a label and description.
   *
   * RE-PINNED by 046 iterate round 1 (T097, FR-087): `project.next`/`project.previous` stay in
   * `View` beside the pane toggles they cycle among, but `focus.explorer`/`focus.projects` move to
   * `Focus & Zoom` — the group that already holds every other `focus.*` command
   * (`focus.left`/`right`/`up`/`down`/`cycle`/`cycleBack`/`notice`), so a user hunting for "jump
   * focus somewhere" finds all of them in one place rather than two.
   */
  it('describes the four 046 side-pane commands with the spec-named labels, split across two groups (FR-022, FR-087)', () => {
    const GROUP: Record<string, string> = {
      'project.next': 'View',
      'project.previous': 'View',
      'focus.explorer': 'Focus & Zoom',
      'focus.projects': 'Focus & Zoom',
    };
    const LABEL: Record<string, string> = {
      'project.next': 'Next Project',
      'project.previous': 'Previous Project',
      'focus.explorer': 'Focus File Explorer',
      'focus.projects': 'Focus Projects',
    };
    for (const [key, label] of Object.entries(LABEL)) {
      const d = KEYBINDINGS_METADATA.find((m) => m.key === key);
      expect(d, `no descriptor for ${key}`).toBeDefined();
      expect(d!.group, key).toBe(GROUP[key]);
      expect(d!.label, key).toBe(label);
      expect(d!.description.trim().length, key).toBeGreaterThan(0);
    }
  });

  /**
   * 046 iterate round 3 (T172, FR-116, FR-087) — `focus.workspace` is keyboard-only: no menu carries
   * it, so the Key Bindings editor is its one discoverable home. It joins its two side-pane siblings
   * in `Focus & Zoom`, and like every window command it is live EVERYWHERE. Its description names no
   * chord (FR-119), for zoom.reset's reason above.
   */
  it('describes focus.workspace in Focus & Zoom, scoped EVERYWHERE, with no chord in its prose (FR-116)', () => {
    const d = KEYBINDINGS_METADATA.find((m) => m.key === 'focus.workspace');
    expect(d, 'no descriptor for focus.workspace').toBeDefined();
    expect(d!.group).toBe('Focus & Zoom');
    expect(d!.label).toBe('Focus Workspace');
    expect(d!.description.trim().length).toBeGreaterThan(0);
    expect(d!.description).not.toMatch(/Ctrl\+|Shift\+|Alt\+|Cmd\+/);
    // Read through a Partial so the RED run reports a missing scope rather than throwing.
    const scopes = COMMAND_SCOPES as Partial<Record<ActionId, ReadonlySet<string>>>;
    const scope = [...(scopes['focus.workspace'] ?? [])].sort();
    expect(scope).toEqual([...COMMAND_SCOPES['focus.projects']].sort());
    expect(scope).toContain('terminal');
    expect(scope).toContain('projects');
  });
});
