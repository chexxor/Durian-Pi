// verify-1940-inflight-compact.mjs (#1940 check 3) - stage an IN-FLIGHT generation on the TARGET
// seat, then spool op:compact and apply it via the broker drain; PROVE: (a) whether the op applies
// mid-flight or is refused (CAPTURE THE REASON EXACTLY), (b) the staged run settles (done vs
// aborted), (c) the full turn is committed, (d) the compaction entry behavior.
// Run: node verify-1940-inflight-compact.mjs
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { CompactionEntry, configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { drainIntentInbox, intentResultDir, readIntentFiles, writeIntent } from "./verify-d3d6be3/src/broker.mjs";
import { registerSeat, Router } from "./verify-d3d6be3/src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
let failures = 0;
const okk = (l) => console.log("  ok   " + l);
const check = (label, cond, detail = "") => { if (cond) okk(label); else { failures++; console.log("  FAIL " + label + (detail ? " -- " + detail : "")); } };

const dir = mkdtempSync(join(tmpdir(), "durig-verify-1940-"));
const dbPath = join(dir, "compact.db");

const faux = fauxProvider({ models: [{ id: "faux-seat" }], tokensPerSecond: 25, tokenSize: { min: 1, max: 2 } });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);
harness.resume();

let convId = null;
try {
	await harness.commit(async (tx) => {
		const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
		convId = c.id;
		await configure(tx, convId, { model: { provider: "faux", modelId: "faux-seat" } });
		await registerSeat(tx, "stuffed", convId, "implementation");
	}, ctx);

	const conv = await harness.conversation(convId, ctx);
	const FULL = "word ".repeat(400);
	for (let i = 0; i < 29; i++) {
		faux.setResponses([fauxAssistantMessage(fauxText("ack-" + i))]);
		const run = await conv.submit({ type: "input", content: "turn-" + i + " " + "x".repeat(4000) }, ctx);
		await run.wait(ctx);
	}
	faux.setResponses([fauxAssistantMessage(fauxText(FULL))]);
	const inFlight = await conv.submit({ type: "input", content: "the-long-final-turn " + "y".repeat(2000) }, ctx);
	await new Promise((r) => setTimeout(r, 600));
	const mid = await harness.inspect(ctx);
	const liveTasks = (mid.tasks ?? []).filter((t) => t.record?.state?.status === "running");
	check("STAGED: a run is in flight on the target seat when compact is spooled", liveTasks.length === 1, JSON.stringify(mid.tasks?.map((t) => t.record?.state?.status)));

	const R = "inflight-1";
	writeIntent(dbPath, { op: "compact", to: "stuffed", instructions: "fold early turns; keep the live one", requestId: R, from: "operator", createdAt: new Date().toISOString() });
	faux.appendResponses([fauxAssistantMessage(fauxText("(faux) folded summary"))]);
	const diagnostics = [];
	const drained = await drainIntentInbox(harness, storage, { dbPath, context: ctx, onDiagnostic: (d) => diagnostics.push(d) });
	console.log("  info drain=" + JSON.stringify(drained) + " diagnostics=" + JSON.stringify(diagnostics));

	const resultPath = join(intentResultDir(dbPath), R + ".json");
	const applied = drained.delivered === 1 && existsSync(resultPath);
	let result = null;
	if (applied) {
		result = JSON.parse(readFileSync(resultPath, "utf8"));
		console.log("  info result=" + JSON.stringify(result.result));
	} else {
		const errDir = dbPath + ".broker.inbox.error";
		if (existsSync(errDir)) {
			for (const f of readdirSyncSafe(errDir)) console.log("  info dead-letter " + f);
		}
	}

	// The staged run settles REGARDLESS; record HOW.
	const settled = await inFlight.wait(ctx);
	const settledDump = JSON.stringify(settled);
	console.log("  info settled=" + settledDump);
	check("SURVIVED: the in-flight run did NOT abort on the compaction (or its refusal)", !String(settled?.reason ?? "").startsWith("aborted:"), settledDump);

	const page = await conv.entries({}, 500, undefined, ctx);
	const text = page.items
		.filter((e) => e.kind === "pi.assistant")
		.map((e) => (Array.isArray(e.model) ? (e.model[0].content ?? []).map((p) => p.text ?? "").join("") : ""))
		.join("");
	check("NOT-TRUNCATED: the FULL long turn was committed", text.includes(FULL), "len=" + text.length);

	const ids = new Set(page.items.filter((e) => e.kind === CompactionEntry.kind).map((e) => String(e.id)));
	console.log("  info compaction entries=" + [...ids].join(",") + " spoolLeft=" + readIntentFiles(dbPath).length);

	if (applied) {
		check("APPLIED-MID-FLIGHT: the compact op applied while a run was live", result.ok === true && result.result?.summaryEntryId != null, JSON.stringify(result.result));
		check("COMPACTION LANDED: exactly one entry, the reported one", ids.size === 1 && ids.has(String(result.result.summaryEntryId)), [...ids].join(","));
	} else {
		check("REFUSED-MID-FLIGHT (THE BOUNDARY): the op dead-lettered with a named reason", drained.deadLettered === 1 && diagnostics.some((d) => d.kind === "intent-undeliverable"), JSON.stringify(diagnostics));
	}
} finally {
	await harness.close(ctx);
	try { rmSync(dir, { recursive: true, force: true }); } catch {}
}

console.log(failures === 0 ? "\nOUTCOME: behavior captured and as-documented" : "\nPROBE MISMATCHES: " + failures);

function readdirSyncSafe(d) {
	try {
		return require("node:fs").readdirSync(d);
	} catch {
		return [];
	}
}
process.exit(failures === 0 ? 0 : 1);
