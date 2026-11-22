/**
 * The Resource Monitor's "?" helpers (055 FR-119): Order by, Hide idle, Hide ended, the capture interval, Held
 * folders, the Total row and the "-" / "~" markers. Its words are `helper-copy.ts`'s, the same table the help panel
 * draws from; the control and its popover are the shared `common/help-tip.tsx`.
 */
import type { ReactElement } from 'react';
import { HelpTip } from '../common/help-tip.js';
import { HELPER_COPY, type HelperTopic } from './helper-copy.js';

export function InfoHelper({ topic }: { topic: HelperTopic }): ReactElement {
  const copy = HELPER_COPY[topic];
  return <HelpTip title={copy.title} text={copy.text} testId={`info-helper-${topic}`} />;
}
