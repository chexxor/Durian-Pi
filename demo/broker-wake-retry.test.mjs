// demo/broker-wake-retry.test.mjs — the DORMANT-REVISIT GAP: a per-seat `wake-failed`
// must re-arm the wake loop, or the resident broker rests in `signal.wait` with a fresh
// heartbeat, a frozen `PASS`, and a seat that is never driven (the 2026-10-18
// dormant-stall recurrences).
//
// The failure modelled here is the observed one: the seat's `pi.live` probe hits a
// transient storage error, so the wake is reported `wake-failed` and skipped, and no
// commit follows to trigger another pass. With `wakeRetryMs > 0` the loop schedules a
// retry pass (backoff doubling per consecutive failing pass, capped); with
// `wakeRetryMs: 0` the retry is disabled, which reproduces the pre-fix behaviour so the
// contrast is proven in one run.
//
// Run: node demo/broker-wake-retry.test.mjs  (exit 0 = pass)

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { Router, enqueueItem, registerSeat } from "../src/rig.mjs";
import { WakeScheduler, createWakeSignal } from "../src/scheduler.mjs";
import { runWakeLoop } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const dir = mkdtempSync(join(tmpdir(), "durig-wake-retry-"));

let failures = 0;
const check = (label, cond, detail = "") => {
	if (cond) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
};

async function makeHarness() {
	const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
	const models = createModels();
	models.setProvider(faux.provider);
	const registry = createRegistry();
	registry.install(Router);
	const storage = new MemoryStorage();
	const harness = await Harness.open(storage, { models, registry }, ctx);
	return { harness, storage };
}

// A probe storage that fails the FIRST `pi.live` scan (a transient storage error, with
// a nested cause like the production SessionFailed) and delegates everything else to the
// real storage. `stats.liveScans` counts the pi.live probes so the demo can prove the
// retry actually re-probed the seat.
function flakyProbe(storage) {
	let failedOnce = false;
	const stats = { liveScans: 0 };
	return {
		stats,
		scanSubmissions: (...a) => storage.scanSubmissions(...a),
		document: (...a) => storage.document(...a),
		scanDocuments: (...a) => {
			const q = a[0];
			if (q?.kind === "pi.live") {
				stats.liveScans += 1;
				if (!failedOnce) {
					failedOnce = true;
					const inner = new Error("database is locked");
					inner.name = "SqliteError";
					const outer = new Error("session failed while reading a document");
					outer.name = "SessionFailed";
					outer.cause = inner;
					throw outer;
				}
			}
			return storage.scanDocuments(...a);
		},
	};
}

async function runScenario({ wakeRetryMs, maxDurationMs }) {
	const { harness, storage } = await makeHarness();
	const logPath = join(dir, `scenario-retry-${wakeRetryMs}.db`);
	const logFile = `${logPath}.broker.log`;
	let convId;
	try {
		await harness.commit(async (tx) => {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
			await registerSeat(tx, "solo", c.id, "worker");
			await enqueueItem(tx, "operator", "solo", "an item", "body");
			convId = c.id;
		}, ctx);

		const probe = flakyProbe(storage);
		const diagnostics = [];
		const result = await runWakeLoop({
			harness,
			probeStorage: probe,
			scheduler: new WakeScheduler({ minIntervalMs: 10, seatCooldownMs: 0 }),
			signal: createWakeSignal(),
			context: ctx,
			onDiagnostic: (d) => diagnostics.push(d),
			maxDurationMs,
			wakeRetryMs,
			wakeRetryMaxMs: 120,
			dbPath: logPath,
			isStopping: () => false,
		});

		const page = await storage.scanSubmissions(
			{ conversationId: convId, order: "descending" },
			10,
			undefined,
			ctx,
		);
		return {
			result,
			diagnostics,
			probeStats: probe.stats,
			submissions: page.items ?? [],
			brokerLog: existsSync(logFile) ? readFileSync(logFile, "utf8") : "",
		};
	} finally {
		await harness.close(ctx);
	}
}

// Two shapes of the SAME defect, one row each, so the assertions are written once:
// the retry disabled (the pre-fix behaviour) and enabled. Both must report the wake
// failure; only the enabled one may re-arm, re-probe, and wake the seat.
const scenarios = [
	{
		label: "retry disabled (pre-fix)",
		wakeRetryMs: 0,
		maxDurationMs: 500,
		expectWake: false,
		expectRetryLogged: false,
		minPasses: 1,
		maxPasses: 1,
	},
	{
		label: "retry enabled",
		wakeRetryMs: 30,
		maxDurationMs: 1500,
		expectWake: true,
		expectRetryLogged: true,
		minPasses: 2,
		maxPasses: Infinity,
	},
];

try {
	for (const s of scenarios) {
		const r = await runScenario({ wakeRetryMs: s.wakeRetryMs, maxDurationMs: s.maxDurationMs });
		check(
			`[${s.label}] the failed wake is reported`,
			r.diagnostics.some((d) => d.kind === "wake-failed"),
			JSON.stringify(r.diagnostics.slice(0, 2)),
		);
		check(
			`[${s.label}] the pass count is within ${s.minPasses}..${s.maxPasses === Infinity ? "inf" : s.maxPasses}`,
			r.result.passes >= s.minPasses && r.result.passes <= s.maxPasses,
			`passes=${r.result.passes}`,
		);
		check(
			`[${s.label}] the seat is ${s.expectWake ? "eventually woken" : "never woken"}`,
			s.expectWake ? r.submissions.length >= 1 : r.submissions.length === 0,
			`submissions=${r.submissions.length}`,
		);
		check(
			`[${s.label}] the WAKE-RETRY line is ${s.expectRetryLogged ? "present" : "absent"}`,
			s.expectRetryLogged === /WAKE-RETRY in=\d+ms seats=solo/.test(r.brokerLog),
			r.brokerLog.trim() || "(empty broker log)",
		);
		if (s.expectWake) {
			check(
				`[${s.label}] the retry re-probes the seat's pi.live`,
				r.probeStats.liveScans >= 2,
				`liveScans=${r.probeStats.liveScans}`,
			);
		}
	}
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(
	failures === 0
		? "\nPASS — a failed wake re-arms the loop instead of going dormant"
		: `\nFAIL — ${failures} check(s) failed`,
);
process.exit(failures === 0 ? 0 : 1);
