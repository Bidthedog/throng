/** ESC, built rather than typed so no raw control byte sits in this file. */
const ESC = String.fromCharCode(27);

/**
 * Whether `data` from xterm's `onData` is a focus report, `CSI I` or `CSI O` (DEC 1004).
 *
 * The view never forwards one (057 FR-099): the daemon tells a focus-reporting program when its panel
 * stops and starts being attended, from main's judgement, because a tab or project switch unmounts the
 * view before it could. A second source would tell the program twice — and the view's reports were also
 * wrong on their own, since xterm answers a re-asserted 1004 with a report when focus never moved (028).
 */
export function isFocusReport(data: string): boolean {
  return data === `${ESC}[I` || data === `${ESC}[O`;
}
