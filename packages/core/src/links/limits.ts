/**
 * The two integrity guards link detection runs behind (045 FR-070, FR-071).
 *
 * ══ NAMED CONSTANTS, NOT SETTINGS ══
 *
 * Neither answers a question a user has. Nobody wants a particular cache lifetime or a particular
 * number of paths per line; they want links that appear and a terminal that stays responsive, and
 * these two deliver that between them. A setting nobody should change is a setting somebody
 * eventually will — and then "my terminal is slow" has a number in a JSON file as its answer. 030's
 * scrollback guard and 044's preview size limit are the precedents; `plan.md`'s Complexity Tracking
 * records this as the third.
 *
 * They live in `core/src/links/` rather than beside their two consumers because the cache and the
 * provider are *both* bound by them and neither owns the other — and because a number copied into
 * two files is a number that will disagree with itself.
 */

/**
 * How long a resolution is believed without corroboration (FR-070).
 *
 * The file watcher drops entries for everything it sees; this is the backstop for everything it does
 * not — a file written outside every watched root, a network share, a path no watcher registered.
 * Long enough that resting the pointer on one path does not re-ask several times a second (xterm
 * re-runs its link providers on every repaint, and the self-heal repaint is on a 2s interval); short
 * enough that a file created after its name was printed becomes a link without the user doing
 * anything about it.
 */
export const LINK_CACHE_TTL_MS = 30_000;

/**
 * The most path candidates one buffer row may turn into links (FR-071).
 *
 * This protects the POINTER, not the output path — nothing on the output path asks about a file at
 * all (FR-072). A link provider runs synchronously while the mouse moves, and a single line can
 * carry thousands of path-shaped tokens: a `find` dump, a `tree`, a minified stack trace. Without a
 * cap each one becomes a resolution request and a decoration inside that callback.
 *
 * 64 because it is far above any line a human reads and far below any line that costs anything: a
 * compiler diagnostic names one or two files, a stack frame one, `git status` one per row.
 */
export const MAX_LINK_CANDIDATES_PER_LINE = 64;
