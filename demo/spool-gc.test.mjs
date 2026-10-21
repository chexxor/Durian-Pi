// demo/spool-gc.test.mjs — the spool RESULT ledger has a TTL/GC, guarded by in-flight (#2497 / architect A4).
//
// The result dir (`<db>.broker.inbox.out/`) is the idempotency ledger AND the producer's
// reply channel. A client that dies mid-poll leaves `<requestId>.json` behind with nobody to
// read it, and the `health` view is multi-MB, so the dir grows without bound. This proves
// `gcIntentResults` bounds it WITHOUT ever removing a result whose request is still in flight
// (a pending intent file still names its requestId), and that a result with no usable
// timestamp still cannot leak (mtime fallback).
//
// The OTHER half of #2497 — "a stale/poison row cannot stall the spool" — is already proven by
// demo/broker-inbox.test.mjs (an unreadable intent and an unknown-seat intent are DEAD-LETTERED,
// never retried forever) and by demo/broker-read.test.mjs (a re-drain whose result already
// exists is CONSUMED, not re-applied).
//
// Run: node demo/spool-gc.test.mjs  (exit 0 = pass)

import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, utimesSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gcIntentResults, intentResultDir, intentInboxDir, INTENT_RESULT_TTL_MS } from "../src/broker.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

const base = mkdtempSync(join(tmpdir(), "durig-spoolgc-"));
const dbPath = join(base, "test.db");
const resultDir = intentResultDir(dbPath);
const inboxDir = intentInboxDir(dbPath);

function writeResult(requestId, at) {
	mkdirSync(resultDir, { recursive: true });
	writeFileSync(join(resultDir, `${requestId}.json`), JSON.stringify({ requestId, op: "message", ok: true, at }));
}

function resultFiles() {
	if (!existsSync(resultDir)) return [];
	return readdirSync(resultDir).filter((n) => n.endsWith(".json")).sort();
}

try {
	console.log("\n=== spool result TTL/GC ===\n");

	check("the default TTL is a positive, finite number", Number.isFinite(INTENT_RESULT_TTL_MS) && INTENT_RESULT_TTL_MS > 0);

	// GC is safe on a store with no spool at all.
	check(
		"GC on a missing result dir is a no-op",
		JSON.stringify(gcIntentResults(join(base, "nope.db"))) === JSON.stringify({ removed: 0, kept: 0 }),
	);

	const now = Date.now();
	const OLD = new Date(now - 30 * 60_000).toISOString();
	const FRESH = new Date(now - 60_000).toISOString();

	writeResult("req-old", OLD); // older than TTL, not in flight -> REMOVED
	writeResult("req-fresh", FRESH); // inside the TTL -> KEPT
	writeResult("req-inflight", OLD); // old BUT a pending intent names it -> KEPT

	// A pending intent file (in-flight) whose requestId matches an old result.
	mkdirSync(inboxDir, { recursive: true });
	writeFileSync(
		join(inboxDir, "0000000000000001-1-abc123.json"),
		JSON.stringify({ requestId: "req-inflight", op: "message", to: "pm" }),
	);

	// A result with NO usable timestamp, but an old mtime -> REMOVED (mtime fallback).
	const noStamp = join(resultDir, "req-nostamp.json");
	writeFileSync(noStamp, JSON.stringify({ requestId: "req-nostamp", op: "message", ok: true }));
	const oldSeconds = (now - 30 * 60_000) / 1000;
	utimesSync(noStamp, oldSeconds, oldSeconds);

	const gc = gcIntentResults(dbPath, { ttlMs: INTENT_RESULT_TTL_MS, now: () => now });
	const remaining = resultFiles();

	check("exactly the two expired, non-in-flight results were removed", gc.removed === 2, JSON.stringify(gc));
	check("the fresh result was kept", remaining.includes("req-fresh.json"), JSON.stringify(remaining));
	check("the IN-FLIGHT result was kept even though it is expired", remaining.includes("req-inflight.json"), JSON.stringify(remaining));
	check("the stale timestamp-less result was removed via its mtime", !remaining.includes("req-nostamp.json"), JSON.stringify(remaining));
	check("nothing else survived", remaining.length === 2, JSON.stringify(remaining));

	// Once the in-flight request is consumed, its expired result becomes collectable.
	rmSync(join(inboxDir, "0000000000000001-1-abc123.json"), { force: true });
	const gc2 = gcIntentResults(dbPath, { ttlMs: INTENT_RESULT_TTL_MS, now: () => now });
	check("the in-flight result is collected once its request is gone", gc2.removed === 1, JSON.stringify(gc2));
	check("only the fresh result remains", JSON.stringify(resultFiles()) === JSON.stringify(["req-fresh.json"]), JSON.stringify(resultFiles()));

	// A result newer than the TTL is never touched, even with no in-flight request.
	const gc3 = gcIntentResults(dbPath, { ttlMs: INTENT_RESULT_TTL_MS, now: () => now });
	check("a fresh result is never collected", gc3.removed === 0 && gc3.kept === 1, JSON.stringify(gc3));

	console.log(failures === 0 ? "\nPASS — spool result TTL/GC verified" : `\nFAIL — ${failures} check(s) failed`);
} finally {
	try {
		rmSync(base, { recursive: true, force: true });
	} catch (err) {
		console.warn(`cleanup: could not remove ${base}: ${err.message}`);
	}
}

process.exit(failures === 0 ? 0 : 1);
