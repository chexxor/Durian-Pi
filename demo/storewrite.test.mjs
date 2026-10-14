// F24 (#257) — store-write entry-id conflict retry.
//
// This demo is DETERMINISTIC — no wall-clock race. It proves the retry
// mechanism works by faking the storage collision:
//   (a) isEntryIdConflict matches the exact storage error,
//   (b) withStoreWriteRetry retries on conflict and returns the second attempt,
//   (c) non-conflict errors propagate immediately without retry.
//
// Run: node demo/storewrite.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import {
	isEntryIdConflict,
	withStoreWriteRetry,
	WRITE_CONFLICT_RETRIES,
	WRITE_CONFLICT_BACKOFF_MS,
} from "../src/storewrite.mjs";

// --- (a) isEntryIdConflict matches the exact storage error. ---
assert.ok(
	isEntryIdConflict(new Error("ID 10051 already belongs to entry")),
	"entry conflict",
);
assert.ok(
	isEntryIdConflict(new Error("ID 42 already belongs to conversation")),
	"conversation conflict",
);
assert.ok(
	isEntryIdConflict(new Error("ID 7 already belongs to document")),
	"document conflict",
);
assert.ok(
	!isEntryIdConflict(new Error("ID 10051 already belongs to user")),
	"not an entry/convo/doc: should not match",
);
assert.ok(
	!isEntryIdConflict(new Error("timeout waiting for lock")),
	"unrelated error must not match",
);
assert.ok(
	!isEntryIdConflict(null),
	"null must not match",
);
assert.ok(
	!isEntryIdConflict(""),
	"empty string must not match",
);

// --- (b) withStoreWriteRetry retries on conflict, succeeds on second attempt. ---
let attemptCount = 0;
const callLog = [];
const result = await withStoreWriteRetry(
	async () => {
		attemptCount += 1;
		callLog.push(attemptCount);
		if (attemptCount < 3) {
			throw new Error(`ID 999 already belongs to entry (conflict on attempt ${attemptCount})`);
		}
		return { ok: true, data: "delivered" };
	},
	{
		retries: 8,
		backoffMs: 1,
		sleep: async () => {}, // no wall-clock wait
	},
);
assert.equal(attemptCount, 3, "exactly 3 attempts: 2 conflicts + 1 success");
assert.equal(callLog.join(","), "1,2,3", "calls in order");
assert.deepStrictEqual(result, { ok: true, data: "delivered" }, "success value propagated");

// --- (c) Non-conflict error propagates immediately, no retry. ---
attemptCount = 0;
try {
	await withStoreWriteRetry(
		async () => {
			attemptCount += 1;
			throw new Error("unrelated storage error");
		},
		{
			retries: 8,
			backoffMs: 1,
			sleep: async () => {},
		},
	);
	assert.fail("should have thrown");
} catch (err) {
	assert.equal(attemptCount, 1, "non-conflict propagates without retry");
	assert.equal(err.message, "unrelated storage error");
}

// --- (d) Exhaustion: too many conflicts calls onExhausted. ---
attemptCount = 0;
let exhausted = false;
try {
	await withStoreWriteRetry(
		async () => {
			attemptCount += 1;
			throw new Error("ID 1 already belongs to entry");
		},
		{
			retries: 2, // allow 2 retries (3 total attempts)
			backoffMs: 1,
			sleep: async () => {},
			onExhausted: () => { exhausted = true; throw new Error("conflict retries exhausted"); },
		},
	);
	assert.fail("should have exhausted");
} catch (err) {
	assert.equal(exhausted, true, "onExhausted was called");
	assert.equal(attemptCount, 3, "3 attempts = 1 initial + 2 retries");
	assert.equal(err.message, "conflict retries exhausted");
}

console.log(
	"STOREWRITE TEST PASS (isEntryIdConflict matches entry/convo/doc errors; withStoreWriteRetry retries on conflict and succeeds; non-conflict errors propagate; exhaustion fires onExhausted)",
);
process.exit(0);
