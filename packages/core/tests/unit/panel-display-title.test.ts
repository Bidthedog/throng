import { describe, it, expect } from 'vitest';
import {
  FIND_IN_FILES_KIND,
  findInFilesPanelType,
  panelDisplayTitle,
  type Panel,
} from '../../src/index.js';

/**
 * #218 — which name a panel wears, as one rule in one place.
 *
 * The precedence was spread across a JSX expression in `panel-placeholder.tsx`, which meant it could
 * only be asserted by launching the whole application. It is a pure decision over a panel plus two
 * live values, so it is tested here — and the E2E specs are then free to prove the wiring rather than
 * re-derive the rule four times.
 */
const panel = (over: Partial<Panel> = {}): Panel => ({
  type: 'panel',
  id: 'p1',
  originProjectId: 'proj',
  title: 'Panel 3',
  ...over,
});

describe('panelDisplayTitle', () => {
  it('shows the placeholder for an UNTYPED panel — the one state where "Panel X" is right', () => {
    expect(panelDisplayTitle(panel())).toBe('Panel 3');
  });

  it('shows a terminal’s live window title', () => {
    const p = panel({ kind: 'terminal', config: { flavourLabel: 'Command Prompt' } });
    expect(panelDisplayTitle(p, { terminalTitle: 'C:\\Windows\\system32\\cmd.exe' })).toBe(
      'C:\\Windows\\system32\\cmd.exe',
    );
  });

  it('falls back to the shell’s name when no window title has been announced', () => {
    // The stated SECONDARY source. A typed terminal must never show the placeholder: the panel
    // plainly holds a shell, and the flavour is known from the moment the type was confirmed —
    // before the shell has had a chance to announce anything.
    const p = panel({ kind: 'terminal', config: { flavourLabel: 'Command Prompt' } });
    expect(panelDisplayTitle(p)).toBe('Command Prompt');
    expect(panelDisplayTitle(p, { terminalTitle: null })).toBe('Command Prompt');
  });

  it('falls back to the flavour ID when a panel predates the stored label', () => {
    const p = panel({ kind: 'terminal', config: { flavourId: 'git-bash' } });
    expect(panelDisplayTitle(p)).toBe('git-bash');
  });

  it('shows the placeholder for a terminal with neither a title nor a flavour', () => {
    expect(panelDisplayTitle(panel({ kind: 'terminal' }))).toBe('Panel 3');
  });

  it('shows an editor’s file name without its final extension', () => {
    const p = panel({ kind: 'editor' });
    expect(panelDisplayTitle(p, { editorFilePath: 'C:/proj/src/index.test.ts' })).toBe('index.test');
  });

  it('shows the placeholder for an editor holding a never-saved document', () => {
    expect(panelDisplayTitle(panel({ kind: 'editor' }))).toBe('Panel 3');
  });

  it('lets a user’s rename outrank every automatic source', () => {
    const p = panel({
      kind: 'terminal',
      title: 'Build',
      titleIsCustom: true,
      config: { flavourLabel: 'Command Prompt' },
    });
    expect(panelDisplayTitle(p, { terminalTitle: 'cmd.exe' })).toBe('Build');
    const e = panel({ kind: 'editor', title: 'Scratch', titleIsCustom: true });
    expect(panelDisplayTitle(e, { editorFilePath: 'C:/proj/alpha.ts' })).toBe('Scratch');
  });

  it('ignores a blank or whitespace-only source rather than showing an empty header', () => {
    const p = panel({ kind: 'terminal', config: { flavourLabel: '   ' } });
    expect(panelDisplayTitle(p, { terminalTitle: '  ' })).toBe('Panel 3');
  });
});

/**
 * 031 US4 (N8, FR-037) — the limit binds the RESULT, not one favoured source.
 *
 * #218 made this function the single place a panel's name is decided, which is precisely why the
 * bound belongs here: a shell that announces a 400-character window title, a file with a very long
 * stem and a name the user typed all leave through the same return. Putting the cap in the header
 * component instead would bound whichever source that component happened to render.
 */
describe('panelDisplayTitle bounds its result (N8)', () => {
  /** man + ZWJ + woman + ZWJ + girl — ONE cluster, 8 UTF-16 units. */
  const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

  it('is unbounded when no limit is given, so existing callers are unaffected', () => {
    const p = panel({ kind: 'terminal' });
    const long = 'C:\\Windows\\system32\\cmd.exe — a very long announced window title';
    expect(panelDisplayTitle(p, { terminalTitle: long })).toBe(long);
    expect(panelDisplayTitle(p, { terminalTitle: long }, undefined)).toBe(long);
  });

  it('bounds a name the USER typed', () => {
    const p = panel({ title: 'Deployment scratchpad', titleIsCustom: true, kind: 'terminal' });
    expect(panelDisplayTitle(p, {}, 10)).toBe('Deployment');
  });

  it('bounds a live SHELL title', () => {
    const p = panel({ kind: 'terminal' });
    expect(panelDisplayTitle(p, { terminalTitle: 'C:\\Windows\\system32\\cmd.exe' }, 12)).toBe(
      'C:\\Windows\\s',
    );
  });

  it('bounds a terminal FLAVOUR label, and the flavour id behind it', () => {
    const label = panel({ kind: 'terminal', config: { flavourLabel: 'Command Prompt' } });
    expect(panelDisplayTitle(label, {}, 7)).toBe('Command');
    const id = panel({ kind: 'terminal', config: { flavourId: 'powershell-core' } });
    expect(panelDisplayTitle(id, {}, 5)).toBe('power');
  });

  it('bounds a name derived from an editor FILE path', () => {
    const p = panel({ kind: 'editor' });
    const path = 'C:/proj/src/document-authority.integration.test.ts';
    expect(panelDisplayTitle(p, { editorFilePath: path }, 9)).toBe('document-');
  });

  it('bounds the untyped PLACEHOLDER too — whatever the source means whatever the source', () => {
    expect(panelDisplayTitle(panel({ title: 'Panel 13' }), {}, 5)).toBe('Panel');
  });

  it('cuts on a grapheme boundary, never mid-cluster', () => {
    const p = panel({ kind: 'terminal' });
    const out = panelDisplayTitle(p, { terminalTitle: `ab${FAMILY}cd` }, 3);
    expect(out).toBe(`ab${FAMILY}`);
  });

  it('trims the trailing space a cut leaves behind (N9)', () => {
    // 'Panel 3' cut at 6 lands after the space; a header reading "Panel " is not a name.
    expect(panelDisplayTitle(panel(), {}, 6)).toBe('Panel');
  });

  it('leaves a name within the limit exactly as it was', () => {
    const p = panel({ kind: 'terminal', config: { flavourLabel: 'Command Prompt' } });
    expect(panelDisplayTitle(p, {}, 14)).toBe('Command Prompt');
    expect(panelDisplayTitle(p, {}, 64)).toBe('Command Prompt');
  });

  it('never returns an empty header for an absurd limit', () => {
    // A limit this small cannot arrive through the settings guard (10–128, FR-034), so this is
    // defensive: whatever it does, it must not blank the panel's name.
    expect(panelDisplayTitle(panel(), {}, 1)).toBe('P');
  });
});

/**
 * 043 T166 (FR-060) — a Find in Files panel is named for what it IS, and carries its term.
 *
 * ══ THIS IS A DEFECT, NOT A NEW IDEA ══
 *
 * The spec's own Assumptions already said *"A Find in Files panel is named for what it is showing —
 * 'Find in Files', carrying the search term once there is one"*. Nothing implemented it: this
 * function branches for `terminal` and `editor` and falls through to `panel.title`, which the layout
 * fills with the positional placeholder — so the maintainer saw a panel headed "Panel 7" with a
 * search plainly in it. FR-060 records the correction.
 *
 * The term is not decoration. FR-019 lets one Tab hold several of these, and the term is the only
 * thing that tells them apart — which is also why FR-061 removes rename rather than leaving a
 * user-chosen name free to hide it.
 *
 * ══ NO NEW `PanelTitleSources` FIELD (R30) ══
 *
 * The term is already on the panel: `findInFilesConfigOf` writes all five query fields into
 * `Panel.config` on every change, and the editor branch above already sets the precedent of reading
 * `panel.config` as a backstop. A third live source would be a second copy of a value the panel
 * persists anyway.
 */
describe('a Find in Files panel is titled for what it is (FR-060, T166)', () => {
  /** man + ZWJ + woman + ZWJ + girl — ONE cluster, 8 UTF-16 units. */
  const FAMILY = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';

  const fif = (config?: Record<string, unknown>): Panel =>
    panel({ kind: FIND_IN_FILES_KIND, ...(config === undefined ? {} : { config }) });

  it('says what it is before there is anything to search for', () => {
    // Never the positional placeholder: the panel is not untyped, and "Panel 3" is a name for a
    // panel whose kind is still an open question.
    expect(panelDisplayTitle(fif())).toBe('Find in Files');
    expect(panelDisplayTitle(fif({}))).toBe('Find in Files');
  });

  it('carries the search term once there is one', () => {
    expect(panelDisplayTitle(fif({ term: 'needle' }))).toBe('Find in Files: needle');
  });

  it('ignores a blank or whitespace-only term rather than heading the panel with a colon', () => {
    expect(panelDisplayTitle(fif({ term: '' }))).toBe('Find in Files');
    expect(panelDisplayTitle(fif({ term: '   ' }))).toBe('Find in Files');
  });

  it('ignores a term that is not a string, because `config` is untyped on disk', () => {
    expect(panelDisplayTitle(fif({ term: 42 }))).toBe('Find in Files');
  });

  it('is bounded by tabs.maxNameLength through the same path every other source takes', () => {
    // The whole reason FR-060 needs no length rule of its own (R30): `panelDisplayTitle` bounds its
    // RESULT, so a 400-character term is capped by exactly the mechanism that caps a 400-character
    // shell title.
    const p = fif({ term: 'supercalifragilistic' });
    expect(panelDisplayTitle(p)).toBe('Find in Files: supercalifragilistic');
    expect(panelDisplayTitle(p, {}, 20)).toBe('Find in Files: super');
  });

  it('cuts a term on a grapheme boundary, never mid-cluster', () => {
    const p = fif({ term: `ab${FAMILY}cd` });
    expect(panelDisplayTitle(p, {}, 17)).toBe('Find in Files: ab');
    expect(panelDisplayTitle(p, {}, 18)).toBe(`Find in Files: ab${FAMILY}`);
  });

  /**
   * 043 T194 (FR-081) — and the title says whether REPLACE is disclosed.
   *
   * ══ THIS REFINES FR-060, IT DOES NOT CONTRADICT IT ══
   *
   * FR-060 (asserted directly above) requires the title to say what the panel IS. FR-081 says what
   * it is depends on what it is showing: a panel with the replace row put away is a find panel, and
   * one with the row disclosed is a find-and-replace panel. The term suffix is untouched and follows
   * whichever of the two is in force — which is why every case below is asserted in both states
   * rather than only where they differ.
   *
   * ══ NO NEW `PanelTitleSources` FIELD, FOR THE SAME REASON THE TERM NEEDED NONE ══
   *
   * `replaceShown` is already written into `Panel.config` by `findInFilesConfigOf` and read back by
   * `findInFilesQueryFrom`, so the disclosure state is persisted exactly as the term is. A third
   * live source would be a second copy free to disagree with the one the restore path reads — which
   * is the argument `panel-title.ts` already makes for the term, in its own comment.
   *
   * ══ AND THE PANEL TYPE'S LABEL DOES NOT MOVE ══
   *
   * `findInFilesPanelType.label` is also the New Panel entry's label and the type icon descriptor's,
   * so renaming it to follow one panel's disclosure state would rename the TYPE everywhere — a menu
   * entry reading "Find & Replace in Files" because some panel elsewhere has its replace row open.
   * The composed string belongs to the panel, which is why it is composed here. Asserted rather than
   * left to review, because "make the title say it" has an obvious wrong implementation one line
   * away from the right one.
   */
  describe('and says whether replace is disclosed (FR-081, T194)', () => {
    it('is the find title with the replace row put away', () => {
      expect(panelDisplayTitle(fif({ replaceShown: false }))).toBe('Find in Files');
      expect(panelDisplayTitle(fif({ term: 'needle', replaceShown: false }))).toBe(
        'Find in Files: needle',
      );
    });

    it('is the find-and-replace title once the replace row is disclosed', () => {
      expect(panelDisplayTitle(fif({ replaceShown: true }))).toBe('Find & Replace in Files');
    });

    it('carries the term after whichever of the two is in force', () => {
      expect(panelDisplayTitle(fif({ term: 'needle', replaceShown: true }))).toBe(
        'Find & Replace in Files: needle',
      );
      // A blank term still adds no colon, in both states — FR-060's rule, unchanged by FR-081.
      expect(panelDisplayTitle(fif({ term: '   ', replaceShown: true }))).toBe(
        'Find & Replace in Files',
      );
    });

    it('treats anything but a true `replaceShown` as put away, because `config` is untyped on disk', () => {
      // The same defensive read `findInFilesQueryFrom` performs (`c.replaceShown === true`): a
      // restored blob can hold anything, and "the replace row is open" is not something to infer
      // from a truthy string.
      expect(panelDisplayTitle(fif({}))).toBe('Find in Files');
      expect(panelDisplayTitle(fif({ replaceShown: 'yes' }))).toBe('Find in Files');
      expect(panelDisplayTitle(fif({ replaceShown: 1 }))).toBe('Find in Files');
      expect(panelDisplayTitle(fif({ replaceShown: null }))).toBe('Find in Files');
    });

    it('leaves the panel TYPE’s own label alone, in both states', () => {
      // The label is the New Panel entry's and the type icon descriptor's. A panel's disclosure
      // state is not a rename of the type, and this is the assertion that says so.
      expect(findInFilesPanelType.label).toBe('Find in Files');
      panelDisplayTitle(fif({ replaceShown: true }));
      expect(findInFilesPanelType.label).toBe('Find in Files');
    });

    it('is bounded by tabs.maxNameLength exactly as the find title is', () => {
      // The longer of the two titles is the one that can push a term out of the bound, so the cap
      // has to be applied to the COMPOSED string rather than to the term — which it is, because
      // `panelDisplayTitle` bounds its result and nothing here truncates anything.
      const p = fif({ term: 'needle', replaceShown: true });
      expect(panelDisplayTitle(p, {}, 24)).toBe('Find & Replace in Files:');
      expect(panelDisplayTitle(p, {}, 28)).toBe('Find & Replace in Files: nee');
    });
  });
});
