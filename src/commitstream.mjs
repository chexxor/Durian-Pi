// src/commitstream.mjs — the seam for the commit stream.
//
// pi-durable renamed the commit subscription when it moved the listener contract from a bare
// callback to an observer object (measured at the pin we landed on, v1.5.1):
//
//   OLD  Session.subscribeCommits(listener)          -> () => void      (types.ts:1083 at 2ec55d80)
//   NEW  Session.observeCommits({advance, end})      -> { detach() }    (types.ts:1125 at dd30101c)
//
// The publication shape is the same `{ seq, changes }` CommitPublication, so everything downstream
// (src/scheduler.mjs's `notify`, the wake loop, `cli.mjs watch`) is unchanged; only the attach
// syntax moved. This module exists so the rename is ONE place to read, not nine places to grep.
//
// A throw in `advance` is reported by the Session and DETACHES the observer, so `detach()` is
// idempotent and safe to call from a finally block.
/**
 * Attach `listener(publication, context)` to every stored commit of `harness`.
 * Returns the unsubscribe function the callers used to get from `subscribeCommits`.
 */
export function followCommits(harness, listener) {
	const observation = harness.observeCommits({
		advance: (publication, context) => listener(publication, context),
		end: () => {},
	});
	return () => observation.detach();
}
