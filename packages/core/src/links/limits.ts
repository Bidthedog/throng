/**
 * The integrity guards link detection and link following run behind (045 FR-071, FR-121, FR-172).
 *
 * ══ NAMED CONSTANTS, NOT SETTINGS ══
 *
 * None answers a question a user has. Nobody wants a particular number of paths per line; they want
 * links that appear and a terminal that stays responsive, and these deliver that between them. A
 * setting nobody should change is a setting somebody eventually will — and then "my terminal is slow"
 * has a number in a JSON file as its answer. 030's scrollback guard and 044's preview size limit are
 * the precedents; `plan.md`'s Complexity Tracking records these beside them.
 *
 * They live in `core/src/links/` rather than beside their consumers because both panel types — and,
 * for the last two, main's resolver — are bound by them, and a number copied into two files is a
 * number that will disagree with itself.
 *
 * *Round four (T265, R32):* the renderer cache's lifetime — how long a resolution was believed — lived
 * here. Nothing is resolved to draw a link any more (FR-155), so the cache and its lifetime are gone;
 * FR-122's back-off survives in main as `LINK_ROOT_BACKOFF_MS`, below.
 */

/**
 * The most path candidates one line may turn into links (FR-071, as FR-155 leaves it).
 *
 * A bound on WORK, not on existence checks — there are none while drawing (FR-155). The terminal's
 * provider, its view pass and the editor's decoration build all scan a line synchronously, on the
 * pointer's or the render's path, and a single line can carry thousands of path-shaped tokens: a
 * `find` dump, a `tree`, a minified stack trace. Without a cap each one becomes a mark, a decoration
 * and a hit-test entry inside that callback.
 *
 * 64 because it is far above any line a human reads and far below any line that costs anything: a
 * compiler diagnostic names one or two files, a stack frame one, `git status` one per row.
 */
export const MAX_LINK_CANDIDATES_PER_LINE = 64;

/*
 * The idle-scan interval (FR-137) lived here: the quiet interval before the terminal's idle scan resolved
 * the rows in view. Round four (T264, R32) deleted the idle scan with it — the view pass
 * (`link-view-marks.ts`) marks by grammar on every render, throttled by `LINK_MARK_THROTTLE_MS`, and
 * waits for nothing.
 */

/**
 * The most words one path span may hold when the space rule scans across single spaces — the WHOLE
 * span, the starting token included, not the words added to it (FR-179f; plan Complexity Tracking,
 * third round, and round four's second-pass correction).
 *
 * A scan runs from a token until the first word ending in a separator or a known extension, so without
 * a cap a path followed by a long sentence that happens to end in `readme.md` would take the sentence
 * with it. It bounds the GRAMMAR — which spans are links at all, decided with no disk (FR-155) — and
 * sits beside `MAX_LINK_CANDIDATES_PER_LINE`, which bounds the line as a whole; this one bounds a
 * single span. `D:\temp is full of foo/bar.md` (5 words) is one link; `D:\a one two three four five
 * six.md` (7) is not.
 *
 * 6 because the spaced folders people actually have need far fewer: `C:\Program Files\Common Files\…`
 * is three words, a synced `…\OneDrive - Company Name\…` four.
 */
export const MAX_PATH_SPACE_WORDS = 6;

/**
 * How often the terminal's view pass may recompute the marks for the rows in view (FR-172, SC-021;
 * plan Complexity Tracking, round four).
 *
 * The pass runs from xterm's render events, never from output, so a program that repaints without
 * pause — Claude Code's spinner redraws many times a second — would otherwise scan the view on every
 * frame, which is the render-path cost FR-072 exists to prevent. The pass is throttled to this, with a
 * guaranteed trailing run, so the last frame drawn is always marked.
 *
 * 100 because it is several frames long, so a continuous repaint costs at most ten scans a second, and
 * still short enough that a mark appears before the eye has settled on the row. SC-021's "marked within
 * one throttle interval" is stated against it. A constant, not a setting: its only effect would be a
 * trade between CPU on the render path and mark latency that no user has a reason to make.
 */
export const LINK_MARK_THROTTLE_MS = 100;

/**
 * How long the plain-click link hint stays up (FR-165d; plan Complexity Tracking, round four).
 *
 * The hint says what Ctrl+click would do; it also hides on any Ctrl keydown, a link Ctrl+click,
 * another hint, a user scroll and blur. This is only its lifetime when none of those happens.
 *
 * 2,500 because it is long enough to read one short line and short enough not to linger over the text
 * it covers. A constant, not a setting: reading time does not depend on the machine, which is the line
 * Principle X draws — unlike the existence-check timeout, which differs between networks.
 */
export const LINK_HINT_MS = 2_500;

/**
 * The most existence checks that may be stuck past the timeout at once, process-wide (FR-121;
 * contract `link-resolution.md` §6.4 P9; data-model §13.5).
 *
 * Round four: those checks run only at a FOLLOW (`throng:links:follow`) or a Link-menu opening
 * (`throng:links:resolve`) — never to draw a link (FR-155). A `stat` against an offline share does not
 * fail, it waits — and it waits on one of libuv's four thread-pool threads, which saving, reading and
 * watching share. A check under a root that is already stuck never starts (P8), and a root in
 * back-off (`LINK_ROOT_BACKOFF_MS`) is not stuck and does not count; this bounds how many DIFFERENT
 * roots may be stuck at once. At 2, two threads stay free for the rest of the app whatever the network
 * does; at 4 a burst of clicks on offline shares could starve a save.
 */
export const MAX_TIMED_OUT_LINK_CHECKS = 2;

/**
 * How long a volume root whose existence check timed out is LEFT ALONE after that stuck check settles
 * (FR-122a; plan *Corrections after analysis*, eleventh pass, Complexity Tracking).
 *
 * FR-122's back-off used to be the renderer cache's lifetime; FR-155 deleted the cache, so the back-off
 * lives in main now. During it, a follow or a Link-menu opening under that root answers `unreachable`
 * at once without touching the disk, so repeated clicks on an offline share do not each wait out the
 * timeout. It does not count toward `MAX_TIMED_OUT_LINK_CHECKS`: a root in back-off holds no thread.
 *
 * 30,000 because it is the value the back-off always had (the old cache lifetime), now named for what
 * it does. A constant, not a setting: the machine-dependent number — how long to wait for a share — is
 * already the existence-check timeout setting; this only spaces the retries.
 */
export const LINK_ROOT_BACKOFF_MS = 30_000;
