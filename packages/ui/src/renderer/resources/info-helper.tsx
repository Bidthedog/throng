/**
 * The Resource Monitor's "?" beside Order by, Hide idle, Hide ended, the capture interval, Held folders, the Total
 * row and the "-" / "~" markers (080 FR-046): a help link like every other (?), opening the guide task that
 * explains it (`helper-targets.ts`). It keeps the `info-helper` class for its place beside the text it explains;
 * `help-link` gives it the help link's size. Supersedes 055 FR-119's popover helpers.
 */
import { helpUrl } from '@throng/core';
import type { ReactElement } from 'react';
import { HelpLink } from '../common/help-link.js';
import { effectiveHelpBase } from '../help/help-opener.js';
import { HELPER_TARGETS, type HelperTopic } from './helper-targets.js';

export function InfoHelper({ topic }: { topic: HelperTopic }): ReactElement | null {
  const { label, task } = HELPER_TARGETS[topic];
  return (
    <HelpLink
      url={helpUrl(task, { base: effectiveHelpBase() })}
      label={label}
      testId={`info-helper-${topic}`}
      className="icon-button info-helper"
    />
  );
}
