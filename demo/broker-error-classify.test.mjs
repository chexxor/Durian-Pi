// demo/broker-error-classify.test.mjs — the residual `database is locked` PROBE (#2496 / ROADMAP 159).
//
// The residual cause is UNVERIFIED, so `describeError` must surface the SQLite
// `errcode`/`errstr` (and any string `code`) found ANYWHERE in the cause chain, not just the
// outer message. pi-durable WRAPS the real failure (`SessionFailed` -> the sqlite error), so
// the errcode lives on a NESTED cause — exactly what this proves.
//
// RECORDED FACT (#2496): pi-durable opens every transaction with `BEGIN IMMEDIATE`, which
// takes the write lock up front and STRUCTURALLY EXCLUDES the deferred-`BEGIN`
// `SQLITE_BUSY_SNAPSHOT` case — so a residual `database is locked` here cannot be a
// snapshot-busy. `errcode` is what distinguishes the remaining possibilities.
//
// Run: node demo/broker-error-classify.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { describeError } from "../src/broker.mjs";

let failures = 0;
function check(label, condition, detail = "") {
	if (condition) {
		console.log(`  ok   ${label}`);
	} else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}

console.log("\n=== residual-error classification probe ===\n");

/* --- the existing shape is preserved (other demos assert on error/cause) --- */
const plain = describeError(new Error("boom"));
check("a bare error reports its message as `error`", plain.error === "Error: boom", JSON.stringify(plain));
check("a bare error has no `cause`", plain.cause === null, JSON.stringify(plain));
check("a bare error adds no errcode/errstr keys", !("errcode" in plain) && !("errstr" in plain), JSON.stringify(plain));

/* --- the nested cause chain is still joined (the #1587 part-2 shape) --- */
const outer = new Error("SessionFailed: storage error");
outer.cause = new Error("database is locked");
const nested = describeError(outer);
check("the outer message stays `error`", nested.error === "Error: SessionFailed: storage error", JSON.stringify(nested));
check(
	"the nested cause is joined into `cause`",
	typeof nested.cause === "string" && nested.cause.includes("database is locked"),
	JSON.stringify(nested),
);

/* --- THE PROBE: errcode/errstr are surfaced from the NESTED cause --- */
// A node:sqlite failure looks like { code, errcode, errstr }; pi-durable wraps it.
const sqliteCause = Object.assign(new Error("database is locked"), { errcode: 5, errstr: "database is locked" });
const sessionFailed = Object.assign(new Error("SessionFailed: storage error"), { cause: sqliteCause });
const probed = describeError(sessionFailed);
check("errcode is surfaced from the nested cause", probed.errcode === 5, JSON.stringify(probed));
check("errstr is surfaced from the nested cause", probed.errstr === "database is locked", JSON.stringify(probed));

/* --- a string `code` is surfaced too (Node-level errors carry one) --- */
const coded = Object.assign(new Error("busy"), { code: "SQLITE_BUSY" });
check("a string `code` is surfaced", describeError(coded).code === "SQLITE_BUSY", JSON.stringify(describeError(coded)));

/* --- nearest-first: the OUTERMOST errcode wins (the closest to the caller) --- */
const outerCoded = Object.assign(new Error("outer"), { errcode: 5, cause: Object.assign(new Error("inner"), { errcode: 6 }) });
check("the outermost errcode wins", describeError(outerCoded).errcode === 5, JSON.stringify(describeError(outerCoded)));

/* --- depth-bounded (<=6) so a cyclic cause chain cannot hang the logger --- */
const a = new Error("a");
const b = new Error("b");
a.cause = b;
b.cause = a;
let bounded = null;
try {
	bounded = describeError(a);
} catch (err) {
	// a throw here is a failure, not a skip
}
check("a cyclic cause chain terminates", bounded !== null, "describeError threw on a cycle");

/* --- null-ish input is safe --- */
check("no error reports null", describeError(null).error === null, JSON.stringify(describeError(null)));

console.log(failures === 0 ? "\nPASS — residual-error probe verified" : `\nFAIL — ${failures} check(s) failed`);

process.exit(failures === 0 ? 0 : 1);
