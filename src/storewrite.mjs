// F24: cross-process store WRITES collide on entry ids.
//
// durig drives seats from per-invocation CLI processes, each of which opens the
// store once and caches `durable_metadata.next_id` at open. Two processes that
// open before either writes therefore mint the SAME candidate id for their next
// entry; the loser's commit fails inside its SQLite transaction with
//   `ID <n> already belongs to entry`
// and pi-durable then marks the session "poisoned ... reopen it". The message
// is silently dropped unless the caller does something.
//
// The failed commit is fully ROLLED BACK (checkGlobalIds throws before any row
// is written), only the caller and the caller's *harness* are stale. So the fix
// is: re-open the harness (which re-reads next_id from metadata) and run the
// attempt again. Because the collision happens at storage ADMISSION - before any
// generation - retrying cannot double-run a model or duplicate a message.
//
// This module carries only the two pieces that must not drift: how to recognise
// that exact conflict, and the bounded reopen-and-retry loop the write paths use.

/** True for the storage's global-id conflict, and only that. */
export function isEntryIdConflict(err) {
	return /ID \d+ already belongs to (entry|conversation|document)\b/.test(
		String(err?.message ?? err),
	);
}

/** Retry bounds: a persistent conflict is a real error, not something to spin on. */
export const WRITE_CONFLICT_RETRIES = 8;
export const WRITE_CONFLICT_BACKOFF_MS = 25;

/**
 * Run a write attempt, reopening and retrying if it loses the entry-id race.
 *
 * `runAttempt` must OPEN ITS OWN harness/store and perform the write inside one
 * call, so each retry reads a fresh `next_id`. It is called up to
 * WRITE_CONFLICT_RETRIES + 1 times. A non-conflict error propagates at once; a
 * conflict after the last attempt calls `onExhausted(err)` (which should fail
 * with a described error, never the raw storage string).
 *
 * `sleep` and `onRetry` are injectable so a test can drive the loop without
 * wall-clock waits.
 *
 * @param {() => Promise<any>} runAttempt
 * @param {{ retries?: number, backoffMs?: number, sleep?: (ms: number) => Promise<void>, onRetry?: (attempt: number) => void, onExhausted?: (err: any) => never }} [options]
 */
export async function withStoreWriteRetry(runAttempt, options = {}) {
	const retries = options.retries ?? WRITE_CONFLICT_RETRIES;
	const backoffMs = options.backoffMs ?? WRITE_CONFLICT_BACKOFF_MS;
	const sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
	const onRetry = options.onRetry ?? (() => {});
	const onExhausted =
		options.onExhausted ??
		((err) => {
			throw err;
		});
	for (let attempt = 0; ; attempt++) {
		try {
			return await runAttempt();
		} catch (err) {
			if (!isEntryIdConflict(err)) throw err;
			if (attempt >= retries) onExhausted(err);
			onRetry(attempt);
			await sleep(backoffMs);
		}
	}
}
