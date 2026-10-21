// demo/broker-one-connection.test.mjs — F8 (#2578), lead ruling #2874 option (B):
// KEEP `probeStorage` as the documented P5/#110 exception; the store's READ op is served from
// the harness Storage, so the second handle is a second CONNECTION for probing only — not a
// second reader of the store. (Option A — deleting it — is deferred until F8's lock contention
// is reproduced on a correctly-linked tree, post-#2801.)
//
// This is a SHAPE test on purpose: (B) is a KEEP+document outcome, so what must hold is that the
// read path prefers the harness Storage AND that the exception is documented at EVERY place the
// second handle is opened — otherwise the next reader "fixes" F8 by deleting a P5/#110 safeguard.
//
// FAILING-FIRST (before the fix): cmdServe opens `probeStorage` with NO rationale, so the
// documentation assertion fails for that site.
//
// Run: node demo/broker-one-connection.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const cli = readFileSync(join(dir, "cli.mjs"), "utf8");
const broker = readFileSync(join(dir, "src/broker.mjs"), "utf8");

/* 1. the store's READ op is served from the harness Storage (not the probe handle). */
assert.match(
	broker,
	/dispatchRead\(readStorage \?\? probeStorage, request/,
	"the read op is served from the harness Storage (`readStorage ?? probeStorage`)",
);

/* 2. the second handle is opened in exactly two places, and BOTH document the P5/#110 exception. */
const lines = cli.split("\n");
const opens = lines.map((l, i) => (/(^|\s)probeStorage = await openStore\(\)/.test(l) ? i : -1)).filter((i) => i >= 0);
assert.equal(opens.length, 2, `the second handle is opened in exactly two places (cmdRun, cmdServe); found ${opens.length}`);
for (const i of opens) {
	const above = lines.slice(Math.max(0, i - 9), i).join("\n");
	assert.match(above, /P5 \/ #110/, `the open at cli.mjs:${i + 1} documents the P5/#110 exception above it`);
}
console.log("  ok   the read op uses the harness Storage, and BOTH probe-handle opens document P5/#110");

console.log("\nBROKER-ONE-CONNECTION TEST PASS (F8 scoped to (B): read off one storage; the probe exception documented)");
process.exit(0);
