// Stranded-admission attention test (ROADMAP 37a, dogfood F11): a submission is
// ADMITTED durably (the input committed) but never STARTED - the `send` was
// killed mid-flight - so the rig previously read idle-healthy while a request
// sat unprocessed. This proves computeAttention surfaces an admitted-but-unscheduled
// submission as `admitted_not_started` (with a declared scope and blind spot),
// that it names the fix, and that the whole status path carries it.
// Run: node demo/stranded.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, registerSeat } from "../src/rig.mjs";
import { computeAttention } from "../src/attention.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-stranded-"));
const db = join(dir, "rig.sqlite");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

// Open a harness WITHOUT resume(): scheduling stays off, so a submitted input
// is ADMITTED durably but never started - exactly the stranded state (F11).
async function admitWithoutScheduling() {
	const storage = await openNodeSqliteStorage(db);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	let convId;
	try {
		await harness.commit(async (tx) => {
			const conv = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, conv.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, "stuck", conv.id, "implementation");
			convId = conv.id;
		}, ctx);
		const conv = await harness.conversation(convId, ctx);
		await conv.submit({ type: "input", content: "never started" }, ctx);
		return convId;
	} finally {
		await harness.close(ctx);
		await storage.close(ctx);
	}
}

let convId;
try {
	convId = await admitWithoutScheduling();

	// Re-open storage (viewer-style) and recover the persisted facts the notice
	// is derived from: the latest submission is still queued/placed, and its
	// ADMISSION timestamp lives on the admitted input ENTRY (the record itself
	// carries only id/status/entry - no timestamp).
	const storage = await openNodeSqliteStorage(db);
	const subPage = await storage.scanSubmissions(
		{ conversationId: convId, order: "descending" },
		1,
		undefined,
		ctx,
	);
	const latest = subPage.items[0];
	assert.ok(latest, "a submission was admitted");
	assert.ok(
		latest.status === "queued" || latest.status === "placed",
		`admitted-but-unscheduled submission must still be queued/placed (got ${latest.status})`,
	);
	const ePage = await storage.scanEntries(
		{ conversationId: convId, order: "descending" },
		10,
		undefined,
		ctx,
	);
	const admittedEntry = ePage.items.find((e) => e.id === latest.entry);
	const admittedAt = admittedEntry?.model?.[0]?.timestamp;
	assert.ok(Number.isFinite(admittedAt), "the admitted input entry carries its timestamp");
	await storage.close(ctx);

	const seat = [{ name: "stuck", conversationId: convId }];
	const strandedLatest = new Map([[convId, { ...latest, admittedAt }]]);
	// Well past the default strandage threshold (STRANDED_ADMITTED_MS, 30 s).
	const past = admittedAt + 40_000;

	// The positive case: a stranded submission, no live slot, aged past the
	// threshold -> the notice appears, scoped to the seat, and names the fix.
	const notice = computeAttention(seat, [], strandedLatest, new Map(), {
		nowMs: past,
		seatsWithSlot: new Set(),
	}).find((n) => n.kind === "admitted_not_started");
	assert.ok(notice, `expected admitted_not_started; got ${JSON.stringify(computeAttention(seat, [], strandedLatest, new Map(), { nowMs: past }))}`);
	assert.equal(notice.scope, "seat", "seat-scoped notice");
	assert.equal(notice.seat, "stuck");
	assert.match(notice.detail, /admitted \d+s ago/, "states how long it has sat");
	assert.match(notice.detail, /resume\/doctor/, "names the fix, not only the symptom");

	// Negative control 1: a FRESH admission (under the threshold) is not stranded.
	assert.ok(
		!computeAttention(seat, [], strandedLatest, new Map(), {
			nowMs: admittedAt, // just admitted
			seatsWithSlot: new Set(),
		}).some((n) => n.kind === "admitted_not_started"),
		"a just-admitted submission is not yet stranded",
	);

	// Negative control 2: a stranded submission behind a LIVE generation slot for
	// the same seat is legitimate backpressure, not strandage.
	assert.ok(
		!computeAttention(seat, [], strandedLatest, new Map(), {
			nowMs: past,
			seatsWithSlot: new Set(["stuck"]),
		}).some((n) => n.kind === "admitted_not_started"),
		"a live slot for the seat suppresses the stranded notice",
	);

	// End-to-end: the status command must carry the notice through readRigHealth's
	// enrichment (admittedAt recovered from the entry, seatsWithSlot, nowMs). A
	// small DURIG_STRANDED_MS makes the already-aged submission fire without a 30s
	// wait; the writer harness is closed, so nothing schedules it in between.
	await new Promise((r) => setTimeout(r, 300));
	const child = spawn(process.execPath, ["cli.mjs", "status"], {
		cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
		env: {
			...process.env,
			DURIG_PROVIDER: "faux",
			DURIG_DB: db,
			DURIG_STRANDED_MS: "50",
		},
		stdio: ["ignore", "pipe", "pipe"],
	});
	let stdout = "";
	child.stdout.on("data", (c) => (stdout += c.toString("utf8")));
	const stderrOut = [];
	child.stderr.on("data", (c) => stderrOut.push(c.toString("utf8")));
	await new Promise((r) => child.once("exit", r));
	assert.equal(child.exitCode, 0, `status exited ${child.exitCode}; stderr=${stderrOut.join("").slice(0, 300)}`);
	const report = JSON.parse(stdout.trim());
	assert.ok(report.ok, `status not ok: ${JSON.stringify(report).slice(0, 200)}`);
	const stranded = (report.attention ?? []).find((n) => n.kind === "admitted_not_started");
	assert.ok(stranded, `status must report admitted_not_started; attention=${JSON.stringify(report.attention)}`);
	assert.equal(stranded.seat, "stuck");
	assert.match(stranded.detail, /resume\/doctor/, "the notice names the fix in the CLI path too");

	console.log("STRANDED TEST PASS (admitted-but-not-started surfaces as a notice in computeAttention and status)");
} finally {
	try {
		rmSync(dir, { recursive: true, force: true });
	} catch (err) {
		console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
	}
}
// After the finally: an exit inside the try would skip cleanup entirely.
process.exit(0);
