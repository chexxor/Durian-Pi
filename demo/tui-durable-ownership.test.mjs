// demo/tui-durable-ownership.test.mjs — the durable-TUI store-ownership guard (#2096; merge-plan §4).
//
// FAILING-FIRST: at HEAD src/storeownership.mjs does not exist -> this import fails (RED).
// GREEN AFTER: assessStoreOwnership() reports a store OWNED when a LIVE broker or a LIVE generation
// holder is present, and FREE otherwise. A stale heartbeat, a dead pid, and the PRIORITY reservation
// do NOT count as an owner. The durable TUI is a WRITER, so this is the fail-closed gate that keeps
// it from becoming a second writer on a store the broker owns (D42 / F24) — the same discipline as
// land.mjs's store resolution (#1383).
//
// Run: node demo/tui-durable-ownership.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessStoreOwnership, heldGenlocks, pidAlive } from "../src/storeownership.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-tui-ownership-"));
const store = join(dir, "tui.sqlite");
const livePid = process.pid; // our own pid is guaranteed alive
const deadPid = 999_998; // a pid no live process holds (the convention in genlock-priority.test.mjs)

let failures = 0;
function check(label, fn) {
	try {
		fn();
		console.log(`  ok   ${label}`);
	} catch (err) {
		failures += 1;
		console.log(`  FAIL ${label} -- ${err.message}`);
	}
}

try {
	check("an unowned store is FREE", () => {
		const r = assessStoreOwnership(store);
		assert.equal(r.owned, false, r.reasons.join("; "));
		assert.deepEqual(r.reasons, []);
		assert.equal(r.broker, null);
		assert.deepEqual(r.genlocks, []);
	});

	check("a LIVE broker OWNS the store (fresh heartbeat + live pid)", () => {
		writeFileSync(`${store}.broker.json`, JSON.stringify({ pid: livePid, heartbeatAt: Date.now() }));
		const r = assessStoreOwnership(store);
		assert.equal(r.owned, true);
		assert.ok(r.reasons.some((x) => x.includes("broker")), r.reasons.join("; "));
		assert.equal(r.broker.pid, livePid);
	});

	check("a STALE heartbeat does NOT own the store (a recycled pid is not the broker)", () => {
		writeFileSync(`${store}.broker.json`, JSON.stringify({ pid: livePid, heartbeatAt: Date.now() - 10 * 60_000 }));
		const r = assessStoreOwnership(store);
		assert.equal(r.owned, false, r.reasons.join("; "));
	});

	check("a DEAD pid does NOT own the store", () => {
		writeFileSync(`${store}.broker.json`, JSON.stringify({ pid: deadPid, heartbeatAt: Date.now() }));
		const r = assessStoreOwnership(store);
		assert.equal(r.owned, false, r.reasons.join("; "));
	});
	rmSync(`${store}.broker.json`, { force: true });

	check("a LIVE generation holder OWNS the store", () => {
		writeFileSync(`${store}.genlock.0`, JSON.stringify({ pid: livePid, seat: "impl", since: new Date().toISOString() }));
		const r = assessStoreOwnership(store);
		assert.equal(r.owned, true);
		assert.ok(r.reasons.some((x) => x.includes("generation")), r.reasons.join("; "));
		assert.equal(r.genlocks.length, 1);
		assert.equal(r.genlocks[0].seat, "impl");
	});

	check("the PRIORITY reservation is NOT a generation holder (#1498)", () => {
		writeFileSync(`${store}.genlock.priority`, JSON.stringify({ pid: livePid, reservedAt: Date.now() }));
		const g = heldGenlocks(store);
		assert.equal(g.length, 1, `only the numbered slot counts; got ${g.length}`);
		assert.ok(g[0].path.endsWith(".genlock.0"), g[0].path);
	});

	check("a DEAD generation holder does NOT own the store", () => {
		writeFileSync(`${store}.genlock.1`, JSON.stringify({ pid: deadPid, seat: "gone" }));
		const g = heldGenlocks(store);
		assert.equal(g.length, 1, `the dead slot is ignored; got ${g.length}`);
	});

	check("pidAlive: our own pid is alive; the sentinel pid is not", () => {
		assert.equal(pidAlive(livePid), true);
		assert.equal(pidAlive(deadPid), false);
	});

	check("the ENTRYPOINT tui.mjs consults the guard and fails closed", () => {
		const repo = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
		const tui = readFileSync(join(repo, "tui.mjs"), "utf8");
		assert.match(tui, /assessStoreOwnership\(dbPath\)/, "tui.mjs consults the ownership guard");
		assert.match(tui, /process\.exit\(1\)/, "tui.mjs fails closed (non-zero exit) on refusal");
		assert.match(tui, /DURIAN_PI_TUI_DB/, "tui.mjs reads the D103 store var");
	});
} finally {
	rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
	console.log(`\nFAIL — ${failures} check(s) failed`);
	process.exit(1);
}
console.log("\nTUI-DURABLE-OWNERSHIP TEST PASS (fail-closed store-ownership guard)");
process.exit(0);
