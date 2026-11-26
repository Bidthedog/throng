/**
 * Where each of the Resource Monitor's "?" controls opens the guide (080 FR-046). The words the old popovers held
 * now live in those guide tasks (`site/guide/resources.md`), so nothing here explains anything: it only names the
 * task. Supersedes 055 FR-093 and FR-119's help panel and popover helpers.
 */
import type { GuideTask } from '@throng/core';

type ResourcesTask = Pick<GuideTask, 'page' | 'anchor'> & { page: 'resources' };

/** The general "?" at the end of the first row (055 FR-121). */
export const MONITOR_HELP: ResourcesTask = { page: 'resources', anchor: 'find-your-way-around-the-resource-monitor' };

/** The things that carry a "?" of their own. */
export const HELPER_TOPICS = ['orderBy', 'hideIdle', 'hideEnded', 'interval', 'heldFolders', 'totalRow', 'marks'] as const;
export type HelperTopic = (typeof HELPER_TOPICS)[number];

const CHOOSE: ResourcesTask = { page: 'resources', anchor: 'choose-what-the-list-shows' };
const FIGURES: ResourcesTask = { page: 'resources', anchor: 'read-the-figures' };

/** Each "?": what it is about (its accessible name reads "Help: <label>") and the task it opens. */
export const HELPER_TARGETS: Readonly<Record<HelperTopic, { readonly label: string; readonly task: ResourcesTask }>> = {
  orderBy: { label: 'Order by', task: CHOOSE },
  hideIdle: { label: 'Hide idle', task: CHOOSE },
  hideEnded: { label: 'Hide ended', task: CHOOSE },
  interval: { label: 'Capture every', task: CHOOSE },
  heldFolders: { label: 'Held folders', task: { page: 'resources', anchor: 'see-which-folders-throng-is-holding' } },
  totalRow: { label: 'the Total row', task: FIGURES },
  marks: { label: '“-” and “~”', task: FIGURES },
};
