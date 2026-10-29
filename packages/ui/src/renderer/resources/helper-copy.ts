/**
 * Every word the monitor's help says, in one table (055 FR-119, research R22): the help panel's disclaimer
 * and its five short sections, and the one or two sentences each "?" helper opens. One table so the panel
 * and the helpers cannot drift — a fact is written here once and the panel points at the helper for the detail.
 */

/** What the help panel opens with: the one thing every figure in the window shares. */
export const HELP_DISCLAIMER =
  'The figures here are representative of how throng’s parts compare with one another, not exact measurements.';

export interface HelpSection {
  readonly id: string;
  readonly title: string;
  /** One or two sentences. */
  readonly text: string;
}

/** The panel's sections, top to bottom: the toolbar, the filter, the left column, the right column, the hierarchy. */
export const HELP_SECTIONS: readonly HelpSection[] = [
  {
    id: 'toolbar',
    title: 'Toolbar',
    text: 'Choose what the list is ordered by, hide idle or ended processes and set how often a reading is taken. A “?” beside a control explains it.',
  },
  {
    id: 'filter',
    title: 'Filter',
    text: 'Type a name, command line or process id to keep only the processes that match, shown under their parents.',
  },
  {
    id: 'left-column',
    title: 'Left column',
    text: 'Lists the parts of throng and, under Projects, your work. Click a row to select it; double-click to open it.',
  },
  {
    id: 'right-column',
    title: 'Right column',
    text: 'Describes the selected row — or the level the left column shows — and graphs each of its figures over time.',
  },
  {
    id: 'hierarchy',
    title: 'Hierarchy',
    text: 'Components are throng’s own parts. Projects hold tabs, panels and the processes running in their terminals.',
  },
];

/** The things that carry a "?" helper. */
export const HELPER_TOPICS = ['orderBy', 'hideIdle', 'hideEnded', 'interval', 'heldFolders', 'totalRow', 'marks'] as const;
export type HelperTopic = (typeof HELPER_TOPICS)[number];

export interface HelperCopy {
  /** The helper's hover title and accessible name. */
  readonly title: string;
  /** One or two short sentences. */
  readonly text: string;
}

export const HELPER_COPY: Readonly<Record<HelperTopic, HelperCopy>> = {
  orderBy: {
    title: 'About Order by',
    text: 'Ranks the rows, and sets the length and colour of the bars, by the figure you choose. Clicking a column’s name does the same.',
  },
  hideIdle: {
    title: 'About Hide idle',
    text: 'Leaves out processes that are doing almost nothing. One with a busy process under it stays, so every process still shows under its parent.',
  },
  hideEnded: {
    title: 'About Hide ended',
    text: 'Leaves out processes that have ended, which is how it starts. Turn it off to see them greyed where they were.',
  },
  interval: {
    title: 'About Capture every',
    text: 'How often a reading is taken while this window is open. The history window sets the shortest interval allowed.',
  },
  heldFolders: {
    title: 'About Held folders',
    text: 'Folders throng is keeping open, with the terminals that hold them. A held folder cannot be deleted or moved until they let go.',
  },
  totalRow: {
    title: 'About the Total row',
    text: 'Adds up everything at this level, including processes a filter or a hide leaves out.',
  },
  marks: {
    title: 'About “-” and “~”',
    text: '“-” means a figure is not measured; rest the pointer on it to read why. “~” before a figure means it is an estimate.',
  },
};
