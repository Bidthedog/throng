/**
 * 030 FR-006 — what level a notice reaches the diagnostic log at.
 *
 * Every notice is written to the log whatever its display mode, so that turning a severity off costs
 * the user visibility and never the record. That promise is only worth making if the level is
 * decided in ONE place: main writes the record, the renderer raises the notice, and two independent
 * maps would disagree the moment either changed — producing a record filed under a level nobody
 * thinks to filter for, which is the same as no record at all.
 */
import type { LogLevel } from '../diagnostics/log-level.js';
import type { NoticeSeverity } from './severity.js';

/**
 * The map. Deliberately not the identity: the log's four levels and the notice model's four
 * severities are different sets.
 *
 * `warning` → `warn` because the two vocabularies spell one idea differently, and `success` → `info`
 * because good news has no level of its own — a confirmation is an informational record, not a
 * category the log needs to know about. Nothing maps to `debug`: something was shown to a user (or
 * deliberately withheld from one), which is never a debugging detail, and `debug` sits below the
 * shipped threshold where the record would simply be dropped.
 */
export function noticeLogLevel(severity: NoticeSeverity): LogLevel {
  switch (severity) {
    case 'error':
      return 'error';
    case 'warning':
      return 'warn';
    case 'info':
    case 'success':
      return 'info';
  }
}
