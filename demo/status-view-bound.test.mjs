// demo/status-view-bound.test.mjs — the read surfaces are BOUNDED, and the bound is reported (ROADMAP 331,
// the read-surface leg of the continuity work).
//
// THE NUMBER THAT MOTIVATED IT, measured on this rig 2026-11-09: `node cli.mjs status --json` printed
// **28,543,835 bytes**, of which `queueItems` was 24,746,566 — 88.3% of it rows in `done` or `cancelled`,
// states a status reader cannot act on. Same shape as #4986's 21.9 MB `queue` dump. A continuation note that
// lets a seat survive its window is worth nothing if reading the rig re-introduces the same blowup.
//
// WHAT IS BOUND is the PAYLOAD, not the storage read: the queue is ONE document, so every caller already read
// all 6,021 rows out of SQLite. What costs context and what can sit in the broker's result channel until the
// stream times out is what the view SERIALISES. Counts and attention are still derived from the FULL row set
// (the #5016 rule); the view only decides what travels, and says in rows and bytes what it dropped.
//
// Run: node demo/status-view-bound.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { QUEUE_VIEW_ROW_CAP, TERMINAL_QUEUE_STATUSES, projectQueueView, refuseOversizedQueueRead, queueCensusOf, deferredBacklogRows, terminalStatusIndex } from "../src/readapi.mjs";
import { enqueueItem, RigQueue, Router } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-status-bound-"));

// REAL-SHAPED bodies. A fixture with 20-byte bodies would pass any byte assertion and prove nothing: the live
// store's average body is ~4.3 KB (measured over 6,021 rows), so each fixture row carries ~2 KB.
const ROWS = 400;          // over the view cap, so the guard is exercised rather than described
const TERMINAL_ROWS = 100; // the terminal share the live rig actually has (5,027 of 6,021)
const DEFERRED_ROWS = 250; // more deferred rows than the cap: the backlog must survive a view that cannot show them
const bodyOf = (i) => `ROW-BODY-${i} ` + "quorum ".repeat(250);
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

async function buildStore(storage) {
	const registry = createRegistry();
	registry.install(Router);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	await harness.commit(
		async (tx) => {
			for (let i = 1; i <= ROWS; i += 1) {
				await enqueueItem(tx, "lead", "devtools", `subject ${i}`, bodyOf(i));
			}
			// Put the terminal share into `done` and the parked share into `deferred` through the queue document
			// itself. These are the states the real queue holds (QUEUE_STATUSES), so the fixture is not a row-shaped
			// fiction the filter happens to like.
			const queue = await tx.doc(RigQueue);
			for (const item of queue.items) {
				if (item.id <= TERMINAL_ROWS) item.status = "done";
				else if (item.id <= TERMINAL_ROWS + DEFERRED_ROWS) {
					item.status = "deferred";
					item.deferredTo = "human";
				}
			}
		},
		ctx,
	);
	await harness.close(ctx);
	return harness;
}

const cli = (args, dbPath) => {
	const r = spawnSync(process.execPath, ["cli.mjs", ...args], {
		cwd: ROOT,
		env: { ...process.env, DURIG_DB: dbPath },
		encoding: "utf8",
		timeout: 120000,
	});
	return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

try {
	// ─── A. the pure projection: what it drops, and that it says so ───
	const rows = Array.from({ length: ROWS }, (_, i) => ({
		id: i + 1,
		from: "lead",
		to: "devtools",
		subject: `subject ${i + 1}`,
		body: bodyOf(i + 1),
		status: i < TERMINAL_ROWS ? "done" : i < TERMINAL_ROWS + DEFERRED_ROWS ? "deferred" : "queued",
		...(i >= TERMINAL_ROWS && i < TERMINAL_ROWS + DEFERRED_ROWS ? { deferredTo: "human" } : {}),
	}));
	const view = projectQueueView(rows, { cap: 200 });
	assert.equal(view.total, ROWS, "the view knows the store's size even though it shows 200 rows");
	assert.equal(view.shown, 200, "the cap bites: 300 rows are in play and only 200 travel");
	assert.equal(view.droppedCapped, 100, "the capped rows are counted, not silently missing");
	assert.equal(view.droppedTerminal, TERMINAL_ROWS, "the terminal rows are the ones dropped, and the count is named");
	assert.ok(
		view.bytes.after < view.bytes.before * 0.6,
		`the payload really shrinks: ${view.bytes.before} -> ${view.bytes.after} B (${(view.bytes.after / view.bytes.before).toFixed(2)} of the store; the terminal share is ${TERMINAL_ROWS}/${ROWS} and ${view.droppedCapped} active rows were capped)`,
	);
	assert.ok(view.rows.every((r) => r.status !== "done"), "no terminal row survives the bounded view");
	assert.ok(view.rows[0].body.includes("ROW-BODY-101"), "NOT-VACUOUS: the rows that DO travel carry their bodies — the bound is scoping, never truncation");
	assert.deepEqual(view.rows, projectQueueView(rows, { cap: 200 }).rows, "the projection is deterministic (a view that drifts run to run cannot be audited)");

	const refusal = refuseOversizedQueueRead(rows, { capRows: QUEUE_VIEW_ROW_CAP });
	assert.ok(refusal, "an oversized unbounded read is refused, not attempted");
	assert.match(refusal, /400 rows/, "the refusal names the COUNT");
	assert.match(refusal, /MB|KB/, "and the SIZE");
	assert.equal(refuseOversizedQueueRead(rows.slice(0, 50), { capRows: 200 }), null, "a store under the cap is not refused — the guard bounds, it does not forbid");
	assert.ok(TERMINAL_QUEUE_STATUSES.length === 2, "the terminal vocabulary is exactly done/cancelled");

	// ─── C. THE DERIVATIONS A BOUND VIEW CANNOT RECOVER FROM ITS OWN ROWS TRAVEL WITH IT ───
	// This section exists because bounding the payload once silently broke the clock-in digest: scripts/clockin.mjs
	// reads `status` for its queue census, and a 200-row view against a 6,021-row store printed 200 rows and a
	// ZERO deferred backlog for a store holding 383 rows awaiting the operator. A smaller payload must never read
	// as a smaller rig (#5016).
	const census = queueCensusOf(rows);
	assert.equal(census.rows, ROWS, "the census counts the whole store, not the slice");
	assert.equal(census.terminal, TERMINAL_ROWS, "terminal rows are counted");
	assert.equal(census.active, DEFERRED_ROWS + (ROWS - TERMINAL_ROWS - DEFERRED_ROWS), "active rows are counted");
	assert.equal(census.counts.deferred, DEFERRED_ROWS, "the deferred backlog is counted from the full row set");
	const backlog = deferredBacklogRows(rows);
	assert.equal(backlog.length, DEFERRED_ROWS, `the deferred backlog is complete even though ${DEFERRED_ROWS} > ${QUEUE_VIEW_ROW_CAP}`);
	assert.ok(backlog.every((r) => r.status === "deferred"), "a projected backlog row keeps its status — the projection must stay filterable, not just pretty");
	assert.ok(!backlog.some((r) => "body" in r), "the backlog carries no bodies: 250 rows × 2 KB is the dump this work exists to avoid");
	assert.ok(backlog.some((r) => r.id > 300), "the backlog includes rows the view never shows — the ids beyond the cap are still reported");
	assert.equal(terminalStatusIndex(rows).length, TERMINAL_ROWS, "the dropped-row index has one entry per terminal row");
	assert.ok(terminalStatusIndex(rows).every((r) => typeof r.id === "number" && !("body" in r)), "the index is ids+statuses only");
	assert.equal(terminalStatusIndex([]).length, 0, "an empty store yields an empty index, not an error");

	// ─── B. the CLI, against a real sqlite store the same library wrote ───
	const dbPath = join(dir, "status-bound.sqlite");
	const storage = await openNodeSqliteStorage(dbPath);
	await buildStore(storage);
	await storage.close(ctx);

	const bounded = cli(["status", "--json"], dbPath);
	assert.equal(bounded.code, 0, `status failed: ${bounded.stderr.slice(0, 400)}`);
	const payload = JSON.parse(bounded.stdout);
	assert.equal(payload.ok, true, "the bounded view is a success, not a warning");
	assert.ok(payload.queueView, "the view ships a header saying what it dropped");
	assert.equal(payload.queueView.total, ROWS, "the header reports the store's row count");
	assert.equal(
		payload.queueView.droppedTerminal + payload.queueView.droppedCapped,
		payload.queueView.total - payload.queueView.shown,
		"droppedTerminal + droppedCapped account for every row the view did not show",
	);
	assert.ok(payload.queueView.bytes.after < payload.queueView.bytes.before, "the payload that travels is smaller than the payload the store holds");
	assert.ok(JSON.stringify(payload.queueItems).includes("ROW-BODY-201"), "the rows that still matter are still there, bodies included");
	assert.ok(payload.queueItems.every((r) => r.id > TERMINAL_ROWS), "the terminal rows are out of the payload (ids 1..${TERMINAL_ROWS})");
	assert.equal(payload.peerGraph.edges.length, payload.queueView.shown, "the peer graph is derived from what the view shows, and the omitted edge count is reported (graphOmittedEdges)");
	assert.equal(typeof payload.graphOmittedEdges, "number", "the omitted edges are counted, not silently missing");
	assert.equal(payload.queueCensus.rows, ROWS, "status reports the census even though it shows a slice");
	assert.equal(payload.queueCensus.counts.deferred, DEFERRED_ROWS, "the deferred backlog is visible in the bounded view");
	assert.equal(payload.queueDeferred.length, DEFERRED_ROWS, "the deferred ids travel even when the rows cannot");
	assert.equal(payload.queueTerminalIndex, null, "the dropped-row index is opt-in — the default view does not carry 100 extra rows");

	const widened = cli(["status", "--json", "--queue-limit=5"], dbPath);
	assert.equal(widened.code, 0);
	const widenedPayload = JSON.parse(widened.stdout);
	assert.equal(widenedPayload.queueView.shown, 5, "--queue-limit narrows the rows shown");
	assert.equal(widenedPayload.queueView.total, ROWS, "and still names the total");

	const unbounded = cli(["status", "--full-queue"], dbPath);
	assert.equal(unbounded.code, 1, "asking for the whole document on a store over the cap FAILS rather than hanging the broker");
	const refusalPayload = JSON.parse(unbounded.stdout);
	assert.equal(refusalPayload.ok, false, "the refusal is a structured answer, parseable by a machine");
	assert.match(refusalPayload.error, /400 rows/, "the refusal gives the count");
	assert.match(refusalPayload.error, /--status claimed|--limit/, "and the way to ask for a slice");

	const badLimit = cli(["status", "--queue-limit=0"], dbPath);
	assert.equal(badLimit.code, 1, "a limit of 0 is refused, not treated as 'no limit'");

	const indexed = cli(["status", "--json", "--with-terminal-index"], dbPath);
	const indexedPayload = JSON.parse(indexed.stdout);
	assert.equal(indexedPayload.queueTerminalIndex.length, TERMINAL_ROWS, "--with-terminal-index hands a script the rows the view dropped");
	assert.ok(!JSON.stringify(indexedPayload.queueTerminalIndex).includes("ROW-BODY"), "the index is ids+statuses, never bodies");

	console.log(
		`STATUS VIEW BOUND OK (fixture ${ROWS} rows: unbounded ${bytes(rows).toLocaleString()} B -> bounded view ${payload.queueView.bytes.after.toLocaleString()} B shown=${payload.queueView.shown} droppedTerminal=${payload.queueView.droppedTerminal}; --full-queue refused with a count, exit 1)`,
	);
} catch (err) {
	console.error("STATUS VIEW BOUND FAIL:", err?.message ?? err);
	process.exitCode = 1;
} finally {
	rmSync(dir, { recursive: true, force: true });
}
