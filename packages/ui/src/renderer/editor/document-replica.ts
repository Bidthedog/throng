import { ChangeSet } from '@codemirror/state';
import type { CanonicalChangeMsg, DispatchChangeMsg, MergeClass } from '@throng/core';

/**
 * A view's replica of a document owned by UI main (016, FR-028f · constitution XI).
 *
 * The authority owns the text. This is the other half of that arrangement: the piece that lets a
 * view show a keystroke INSTANTLY — without waiting for a round trip — and still converge on
 * exactly the document the authority holds.
 *
 * ## The problem it solves
 *
 * The view echoes the user's edit locally at once, because typing that waits for IPC is not typing.
 * So for a moment the view is AHEAD of the authority, holding a change the authority has not seen.
 * If another view's edit lands in that moment, the two have diverged, and every subsequent offset
 * in the in-flight change is measured against a document that no longer exists.
 *
 * The fix is symmetric, and it is the whole protocol:
 *
 *   • the AUTHORITY rebases the arriving change over everything that landed since its base version
 *     (`changes.map(applied)`), so it lands where the user meant it;
 *   • the REPLICA rebases each arriving canonical change over whatever it still has pending
 *     (`incoming.map(pending, true)`), and rebases its pending over the incoming change
 *     (`pending.map(incoming)`).
 *
 * The tie-break is complementary — `true` on the incoming side, the default on the pending side —
 * so both ends compute the SAME rebase from the same inputs. That is why the originator applies
 * nothing when its own change is acknowledged: it has already derived, locally, the exact change the
 * authority computed. It advances its version and moves on. (Re-applying it there is the classic bug
 * in this protocol: the edit lands twice, in the one view that was already correct.)
 *
 * ## One change in flight at a time
 *
 * `baseVersion` is a single integer, so it can only say "computed against the authority's version N"
 * — it cannot say "…and also on top of my own two unacknowledged edits". A second change sent while
 * the first is still in flight would therefore be rebased over that first change by the authority,
 * even though it was already computed on top of it: the edit would be applied twice over. So a
 * replica keeps at most ONE change in flight and composes everything typed meanwhile into a buffer,
 * which is sent the moment the acknowledgement arrives. Local echo is instant regardless — the
 * buffer delays the SEND, never the display.
 */

/** What the view should do in response to a canonical message. `null` — nothing at all. */
export interface ReplicaApply {
  /** The change to apply to the view, rebased over anything still pending. */
  changes: ChangeSet;
  /** An undo/redo's recorded cursor set, restored ONLY in the view that invoked it (FR-026f). */
  selection: unknown;
}

export class DocumentReplica {
  /** The last canonical version this replica has processed. */
  private synced = 0;
  /** Sent, not yet acknowledged. At most one, ever — see the note above. */
  private inFlight: ChangeSet | null = null;
  /** Typed since, composed into one change and sent on the next acknowledgement. */
  private buffer: ChangeSet | null = null;
  /** The selection before the FIRST buffered edit — the run's cursor set, not its latest. */
  private bufferSelection: unknown = null;
  private bufferClass: MergeClass = null;
  private inFlightSelection: unknown = null;
  private inFlightClass: MergeClass = null;
  /** Resolved when nothing is left in flight — a save must not race the edit it is saving. */
  private readonly idleWaiters: (() => void)[] = [];

  constructor(
    readonly documentId: string,
    /** Unique per VIEW, not per panel: two mirrored views of one document are two replicas. */
    readonly viewId: string,
    private readonly send: (msg: DispatchChangeMsg) => void,
  ) {}

  get version(): number {
    return this.synced;
  }

  /** True while this replica holds an edit the authority has not yet acknowledged. */
  get pending(): boolean {
    return this.inFlight !== null || this.buffer !== null;
  }

  /**
   * A LOCAL edit, already applied to the view and already on the user's screen.
   *
   * Sent immediately when nothing is in flight; composed into the buffer when something is.
   */
  record(changes: ChangeSet, selectionBefore: unknown, mergeClass: MergeClass): void {
    if (this.inFlight) {
      // Composing into the buffer merges these keystrokes into ONE dispatch, and therefore one undo
      // entry. That is the same grouping the authority would have applied to them anyway (a run of
      // typing within the group delay), so nothing is lost — and the run is described by the change
      // that OPENED it: its cursor set, and its class.
      if (this.buffer) {
        this.buffer = this.buffer.compose(changes);
        /**
         * A buffer that has absorbed a change of a DIFFERENT class can no longer claim the class it
         * opened with (FR-026).
         *
         * Type `a`; type `b` while `a` is still in flight; then paste. The buffer is now `b` + the
         * paste, and dispatching it as `'type'` invites the authority to merge it into the typing
         * run above — so ONE Ctrl+Z takes back the typing *and* the paste, which is precisely what
         * FR-026 forbids and what `delete.cut`/`input.paste` not being run classes is supposed to
         * prevent. The guard was on the class of the change that OPENED the buffer, and a paste that
         * arrived second slipped past it.
         *
         * A mixed buffer therefore merges with nothing. It is still ONE undo entry — it has to be,
         * the changes are already composed — but it will not be absorbed into the run above it.
         */
        if (mergeClass !== this.bufferClass) this.bufferClass = null;
      } else {
        this.buffer = changes;
        this.bufferSelection = selectionBefore;
        this.bufferClass = mergeClass;
      }
      return;
    }
    this.inFlight = changes;
    this.inFlightSelection = selectionBefore;
    this.inFlightClass = mergeClass;
    this.dispatchInFlight();
  }

  /**
   * A canonical change from the authority. Returns what the VIEW must apply, or `null` when there
   * is nothing to do — which is the case for this replica's own acknowledgement.
   */
  receive(msg: CanonicalChangeMsg): ReplicaApply | null {
    if (msg.version <= this.synced) return null; // already seen (a late duplicate)

    // Our own EDIT, acknowledged. Our copy already has it — we derived the authority's rebase
    // ourselves as the intervening changes arrived — so we apply NOTHING and simply advance.
    //
    // An undo or redo we invoked also carries our origin, and is NOT this: we asked the authority to
    // act and applied nothing locally, so it must be applied here like any other change. Only `kind`
    // tells them apart, which is why it exists.
    if (msg.kind === 'edit' && msg.origin === this.viewId && this.inFlight) {
      this.synced = msg.version;
      this.inFlight = null;
      this.inFlightSelection = null;
      this.inFlightClass = null;
      this.sendBuffer();
      this.settleIfIdle();
      return null;
    }

    // Anyone's change — another view's edit, or an undo/redo from either. Rebase it over everything
    // we still hold, and rebase what we hold over it.
    const incoming = ChangeSet.fromJSON(msg.changes);
    const applied = this.rebase(incoming);
    this.synced = msg.version;

    return {
      changes: applied,
      // An undo restores its cursor set ONLY in the view that invoked it: elsewhere it would
      // wrench the user's viewport to an edit they did not make (FR-026f).
      selection: msg.origin === this.viewId ? (msg.selection ?? null) : null,
    };
  }

  /**
   * The document was REPLACED (a revert, an external reload, or a resync). Everything pending
   * described the document that has just been discarded, so it is dropped, not rebased — there is
   * nowhere honest to land it.
   */
  reset(version: number): void {
    this.synced = version;
    this.inFlight = null;
    this.buffer = null;
    this.bufferSelection = null;
    this.inFlightSelection = null;
    this.inFlightClass = null;
    this.bufferClass = null;
    this.settleIfIdle();
  }

  /**
   * Resolves once the authority has seen everything this replica has typed.
   *
   * A save reads the authority's text, so saving while an edit is still in flight would write the
   * document as it was one keystroke ago — silently, and to the user's file.
   */
  async settled(): Promise<void> {
    if (!this.pending) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  /**
   * Rebase an incoming canonical change over our pending changes, and our pending changes over it.
   *
   * The order matters and the tie-break matters: each pending change is mapped over the incoming
   * change SO FAR (default tie-break), and the incoming change is then mapped over that pending
   * change with `before = true`. This is the complement of what the authority does when it rebases
   * our in-flight change over the same canonical change — which is exactly why both ends land on the
   * same document.
   */
  private rebase(incoming: ChangeSet): ChangeSet {
    let over = incoming;
    if (this.inFlight) {
      const mapped = this.inFlight.map(over);
      over = over.map(this.inFlight, true);
      this.inFlight = mapped;
    }
    if (this.buffer) {
      const mapped = this.buffer.map(over);
      over = over.map(this.buffer, true);
      this.buffer = mapped;
    }
    return over;
  }

  /** Send the buffered run as the next in-flight change. */
  private sendBuffer(): void {
    if (!this.buffer) return;
    this.inFlight = this.buffer;
    this.inFlightSelection = this.bufferSelection;
    this.inFlightClass = this.bufferClass;
    this.buffer = null;
    this.bufferSelection = null;
    this.bufferClass = null;
    this.dispatchInFlight();
  }

  private dispatchInFlight(): void {
    if (!this.inFlight) return;
    this.send({
      documentId: this.documentId,
      viewId: this.viewId,
      changes: this.inFlight.toJSON(),
      baseVersion: this.synced,
      selectionBefore: this.inFlightSelection,
      mergeClass: this.inFlightClass,
    });
  }

  private settleIfIdle(): void {
    if (this.pending) return;
    while (this.idleWaiters.length > 0) this.idleWaiters.pop()?.();
  }
}
