#!/usr/bin/env node
// demo/store-busy-timeout.test.mjs — the store's busy timeout is a FLEET-LIVENESS setting.
//
// WHY. Measured 2026-11-12T21:15:40Z: a resident broker pass met `database is locked errcode=5`, pi-durable
// closed the Session on the storage error, the reopen cap (3 attempts, ~35 s) was exhausted, and the broker
// stopped TERMINALLY - while its process kept running and serving READ-DRAIN. `ps` read healthy, the
// heartbeat read healthy, and the last `START` line read healthy; the only symptom was `lastPass` climbing.
// The fleet was dead ~4 min until `tools/broker-keepalive.mjs` printed `broker STRANDED (no pass 305s)`.
//
// Root cause: pi-durable's default busy timeout is 5 s, which a 750 MB store's write can exceed. A lock is
// transient, so waiting is the correct response. This demo is the CHECK RULE for that: every store open site
// in the product passes an explicit busy timeout, and the read-only open does too (otherwise an ordinary
// `status` read fails instantly during a checkpoint and lands on the write-mode fallback - the second-writer
// collision the read path exists to avoid).
//
// Cost: readFileSync of four source files, no store, no broker, no git. Measured < 1 s.
// last_verified: 2026-11-12 by delegate, against HEAD 7e215e4b.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { STORE_BUSY_TIMEOUT_MS } from "../src/readclient.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// 1. THE VALUE. Not "some timeout": a grace period long enough that a contended 750 MB write waits instead
//    of tearing the session down. 30 s is the measured choice; anything under 5 s is pi-durable's default.
assert.ok(Number.isFinite(STORE_BUSY_TIMEOUT_MS), "STORE_BUSY_TIMEOUT_MS must be a finite number");
assert.ok(
	STORE_BUSY_TIMEOUT_MS >= 30_000,
	`STORE_BUSY_TIMEOUT_MS is ${STORE_BUSY_TIMEOUT_MS}; a lock longer than pi-durable's 5 s default is exactly ` +
		"what killed a resident broker on 2026-11-12T21:15:40Z (store closed -> reopen cap -> terminal stop)",
);

// 2. EVERY OPEN SITE IN THE PRODUCT. A call that forgets the option silently reverts to 5 s, and the
//    regression is invisible until the next lock - so the guard is static and total, not a spot check.
const openSites = ["cli.mjs", "src/readclient.mjs"];
for (const rel of openSites) {
	const text = read(rel);
	const calls = [...text.matchAll(/openNodeSqliteStorage\(\s*([^)]*)\)/g)].map((m) => m[1]);
	assert.ok(calls.length > 0, `${rel} no longer opens the store - update this guard rather than deleting it`);
	for (const args of calls) {
		assert.match(
			args,
			/busyTimeoutMs/,
			`${rel} opens the store without an explicit busyTimeoutMs (args: "${args.trim()}") - it would fall back to pi-durable's 5 s default`,
		);
	}
}

// 3. THE IMPORT, not just the literal. cli.mjs must take the constant from src/readclient.mjs, so the broker's
//    open and the read path cannot drift to two different grace periods.
assert.match(
	read("cli.mjs"),
	/import \{[^}]*STORE_BUSY_TIMEOUT_MS[^}]*\} from "\.\/src\/readclient\.mjs"/,
	"cli.mjs must import STORE_BUSY_TIMEOUT_MS from src/readclient.mjs (one policy, one value)",
);

// 4. THE READ-ONLY OPEN. It takes no write lock but still needs the WAL index, which a concurrent CHECKPOINT
//    can hold; with the default 0 it fails instantly and pushes the caller onto the write-mode fallback.
const ro = read("src/readonlystore.mjs");
assert.match(
	ro,
	/new DatabaseSync\(dbPath, \{[^}]*readOnly: true[^}]*timeout:/,
	"the read-only open must pass a busy `timeout` to DatabaseSync, or a contended read falls back to a write open",
);

console.log(
	`ok - STORE_BUSY_TIMEOUT_MS=${STORE_BUSY_TIMEOUT_MS}ms; ${openSites.length} open sites pass it; the read-only open waits too`,
);
