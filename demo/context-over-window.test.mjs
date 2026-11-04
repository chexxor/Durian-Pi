// demo/context-over-window.test.mjs — #5049 (ROADMAP 208): the context fraction is computed, printed and IGNORED.
//
// THE DEFECT, measured before this change existed: `src/context.mjs:99` sums one turn's
// `input + output + cacheRead + cacheWrite`, `status.context` prints `fraction`, and the live rig showed a seat at
// 244,751 / 24,576 = 9.959 while `grep -rn fraction src/attention.mjs src/checkup.mjs` returned NOTHING. A number
// that exceeds its window tenfold was displayed and then dropped on the floor.
//
// WHAT THIS GUARD MUST NOT BE. Two blind spots are in the measure itself, and a guard that ignores them is a false
// alarm that gets disabled (the #3539 lesson: a rule as specified can start hundreds-red and be switched off):
//   1. `consumed` is ONE TURN's MOVED tokens, not the live head. A seat that was compacted or reset after a long
//      turn keeps printing that old turn's number until its NEXT turn (D199/D200 record exactly this artifact).
//      So the measure must know whether a `pi.compaction` / `pi.reset` entry sits NEWER than the turn it measured,
//      and the notice must not fire on a measure that is behind such a boundary.
//   2. `cacheRead` is in the sum, so the axis is "tokens the provider MOVED", not "tokens re-read" — on this rig the
//      two differ by ~20x (an 8,757-token cached prefix costs ~0.1s of prompt time). The axis is stated IN the
//      notice text, not in a comment.
// And it stays a NOTICE + a `check` rule: a cheap signal may ACCEPT but never DECIDE (#3271/#3575). The actuator
// that stops a seat is a different row (#1781). Nothing here stops anything.
//
// Run: node demo/context-over-window.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { CONTEXT_OVER_WINDOW_CAUSE } from "../src/causes.mjs";
import { CONTEXT_DENOMINATORS, CONTEXT_HEAD_MARKERS, contextConsumption, contextOverWindow } from "../src/context.mjs";
import { computeAttention } from "../src/attention.mjs";
import { RULES, auditRig } from "../src/checkup.mjs";
import { Router, compilePersona, registerSeat } from "../src/rig.mjs";
import { readRigHealth, readSeatList, seatContextMap } from "../src/readapi.mjs";
import { readSeatPages } from "../src/rigstory.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

/* ------------------------------ the fixtures ------------------------------- */

const asst = (id, usage) => ({ id, kind: "pi.assistant", model: [{ role: "assistant", usage }] });
const compaction = (id) => ({ id, kind: "pi.compaction" });
const reset = (id) => ({ id, kind: "pi.reset" });

// One turn that moved 244,000 tokens against a 200,000 declared window: over.
const OVER = { input: 240_000, output: 4_000, cacheRead: 0, cacheWrite: 0 };
// The `advocate` shape from the live store: 244,751 MOVED, of which 243,200 was `cacheRead`. A third of it is
// "tokens re-read", which is why the axis has to travel with the number.
const CACHE_HEAVY = { input: 1_551, output: 0, cacheRead: 243_200, cacheWrite: 0 };
const LOCAL_WINDOW = { declared: 200_000 };

/* ------------------------- 1. the measure knows its head ------------------------ */

const current = contextConsumption([asst(50, OVER)], LOCAL_WINDOW);
assert.equal(current.head.state, "current", "a measure with no newer head boundary is CURRENT");
assert.equal(current.head.usageEntryId, 50, "the measure names the entry it came from");
assert.equal(current.head.boundaryEntryId, null, "and the boundary it looked for");
assert.ok(Math.abs(current.fraction - 1.22) < 1e-9, `244000/200000 = 1.22, got ${current.fraction}`);

// The artifact case: the seat was compacted AFTER the turn the measure reads. Newest-first page order, the order
// `readSeatPages` returns.
const behind = contextConsumption([compaction(60), asst(50, OVER)], LOCAL_WINDOW);
assert.equal(behind.head.state, "behind-boundary", "a reset/compaction NEWER than the measured turn makes it STALE");
assert.equal(behind.fraction, 1.22, "the number is still reported — hiding it would be worse than labelling it");

const behindReset = contextConsumption([reset(60), asst(50, OVER)], LOCAL_WINDOW);
assert.equal(behindReset.head.state, "behind-boundary", "pi.reset is a boundary too, not only pi.compaction");

// WHY A BOUNDED PAGE CANNOT MISS THIS: `readSeatPages` returns newest-first, and only a marker NEWER than the
// measured turn matters, so any marker that counts is at least as new as an entry that IS on the page. A fixture
// with 24 entries, the usage entry deep in the page and the boundary above it, pins the argument rather than
// trusting it.
const deepPage = [
	...Array.from({ length: 20 }, (_, i) => ({ id: 70 + i, kind: "pi.tool-result" })),
	compaction(65),
	asst(50, OVER),
	...Array.from({ length: 3 }, (_, i) => ({ id: 40 + i, kind: "pi.tool-result" })),
];
assert.equal(contextConsumption(deepPage, LOCAL_WINDOW).head.state, "behind-boundary", "a boundary newer than the usage entry is always on a newest-first page");

// The marker vocabulary has ONE owner. `src/compacteval.mjs` already declared which entry kinds move the head;
// re-declaring it here would let the two drift apart, and the drift would show up as a notice that silently stops
// firing. Scanned from source because importing compacteval drags pi-durable into a pure test.
const compactevalSource = fs.readFileSync(path.join(here, "..", "src", "compacteval.mjs"), "utf8");
const declaredMarkers = compactevalSource.match(/HEAD_MARKER_KINDS = new Set\(\[([^\]]*)\]/)?.[1] ?? "";
for (const marker of CONTEXT_HEAD_MARKERS) {
	assert.ok(declaredMarkers.includes(`"${marker}"`), `CONTEXT_HEAD_MARKERS must agree with compacteval's HEAD_MARKER_KINDS; ${marker} is missing there`);
}
assert.ok(
	CONTEXT_HEAD_MARKERS.every((m) => CONTEXT_DENOMINATORS.length > 0 && typeof m === "string"),
	"head markers are strings",
);

/* --------------------------- 2. the predicate, with its reasons --------------------------- */

const over = contextOverWindow(current);
assert.equal(over.fired, true, "a CURRENT measure over its window fires");
assert.equal(over.denominator, "declared", "the denominator's STATE travels, not just its value");
assert.equal(over.windowValue, 200_000);
assert.equal(over.cacheRead, 0, "the cacheRead share travels so the axis can be stated");

assert.equal(
	contextOverWindow(behind).fired,
	false,
	"the post-compaction artifact does NOT fire — this is the difference between a guard and a false alarm",
);
assert.equal(contextOverWindow(behind).reason, "behind-boundary", "and the exclusion is NAMED, not silent");

const noWindow = contextConsumption([asst(50, OVER)], {});
assert.equal(noWindow.fraction, null, "no window, no fraction (src/context.mjs's half-header rule)");
assert.equal(contextOverWindow(noWindow).fired, false, "and no notice");
assert.equal(contextOverWindow(noWindow).reason, "no-window", "with its reason");

const within = contextConsumption([asst(50, { input: 136_158, output: 0, cacheRead: 0, cacheWrite: 0 })], LOCAL_WINDOW);
assert.equal(contextOverWindow(within).fired, false, "0.68 of the window is not over the window");
assert.equal(contextOverWindow(within).reason, "within-window");

const noUsage = contextConsumption([{ id: 5, kind: "pi.user" }], LOCAL_WINDOW);
assert.equal(contextOverWindow(noUsage).fired, false, "a seat with no reported usage says nothing");
assert.equal(contextOverWindow(noUsage).reason, "no-usage");

// The cache-heavy artifact, over the window on the MOVED axis: it fires, and the fraction is honest about its axis.
const cacheOver = contextConsumption([asst(80, CACHE_HEAVY)], LOCAL_WINDOW);
assert.ok(Math.abs(cacheOver.fraction - 1.223755) < 1e-6, `244,751/200,000 = 1.2238, got ${cacheOver.fraction}`);
assert.equal(contextOverWindow(cacheOver).fired, true, "one turn that MOVED more than the window is the event, even if most of it was cache reads");
assert.equal(contextOverWindow(cacheOver).cacheRead, 243_200, "and the notice can say how much of it was re-read");

/* ------------------------------ 3. the notice ------------------------------ */

const seat = [{ name: "devtools", conversationId: 50, role: "worker" }];
const noticesFor = (measure, gates) =>
	computeAttention(seat, [], new Map(), new Map(), {
		contextBySeat: { devtools: measure },
		...(gates ? { compactGateBySeat: { devtools: gates } } : {}),
	});

const notice = noticesFor(current, { keepRecentTokens: 20_000 }).find((n) => n.kind === CONTEXT_OVER_WINDOW_CAUSE);
assert.ok(notice, `expected a ${CONTEXT_OVER_WINDOW_CAUSE} notice; got ${JSON.stringify(noticesFor(current))}`);
assert.equal(notice.scope, "seat", "a per-seat notice, so a per-seat renderer can select it");
assert.match(notice.detail, /1\.22/, "the fraction is in the text");
assert.match(notice.detail, /declared/, "the denominator's STATE is in the text");
assert.match(notice.detail, /200,?000/, "and its value");
assert.match(notice.detail, /MOVED/i, "the axis is IN the text, not in a comment");
assert.match(notice.detail, /not the live head|NOT the live head/, "and the one-turn caveat is in the text, not implied");
assert.match(notice.detail, /keepRecentTokens=20000.*willCut=true/, "the remedy states that the compact verb would actually cut");

const decline = noticesFor(within, { keepRecentTokens: 200_000 }).find((n) => n.kind === CONTEXT_OVER_WINDOW_CAUSE);
assert.equal(decline, undefined, "within-window still says nothing, whatever the gate");

const noGate = noticesFor(current).find((n) => n.kind === CONTEXT_OVER_WINDOW_CAUSE);
assert.ok(noGate, "the notice fires without a gate");
assert.match(noGate.detail, /willCut=unknown/, "and says the gate is unknown rather than inventing one");

// The artifact case stays SILENT at 9.959 — the exact number from the dispatch measurement, which is the number a
// naive guard would have screamed about.
const artifact = contextConsumption([compaction(275_007), asst(213_826, CACHE_HEAVY)], { declared: 24_576 });
assert.ok(artifact.fraction > 9, `the advocate artifact reproduces: fraction ${artifact.fraction}`);
assert.equal(noticesFor(artifact).find((n) => n.kind === CONTEXT_OVER_WINDOW_CAUSE), undefined, "a stale measure at fraction 9.9 does NOT fire");

// ACCEPT, NEVER DECIDE (#3271/#3575): the notice rides alongside the run's own outcome notices and suppresses
// nothing. If this guard could decide, it would eat the failure notice and the operator would lose the real event.
const failedLatest = new Map([[50, { status: "unanswered", reason: "model_error" }]]);
const both = computeAttention(seat, [], failedLatest, new Map([[50, "provider 502"]]), { contextBySeat: { devtools: current } });
assert.ok(both.some((n) => n.kind === "last_run_failed"), "the failed-run notice is still there");
assert.ok(both.some((n) => n.kind === CONTEXT_OVER_WINDOW_CAUSE), "and the context notice is added, not substituted");

// One vocabulary (#5047): the kind is owned by src/causes.mjs, like the money stop, so a reword cannot silently
// un-pair the notice from its rule.
assert.equal(CONTEXT_OVER_WINDOW_CAUSE, "context_over_window", "the cause name is the one the ROADMAP item names");
assert.equal(
	typeof (await import("../src/supervisor.mjs")).planEscalations,
	"function",
	"supervisor stays importable — this notice must NOT be wired into the park path (that is #1781's actuator)",
);
const escalated = (await import("../src/supervisor.mjs")).planEscalations({
	seats: seat,
	streakByConv: new Map(),
	errorByConv: new Map(),
	notices: [notice],
});
assert.deepEqual(escalated, [], "a context notice parks NOTHING: it is a signal, not a stop");

/* ------------------------------ 4. the check rule ------------------------------ */

const rule = RULES.find((r) => r.id === "context-over-window");
assert.ok(rule, "the rule is declared in the rule list");
assert.equal(rule.severity, "fix-now", "fix-now, not error: a seat over its window does not make the rig unable to work");

const spec = { seats: [{ name: "devtools" }], constitutionInline: "x" };
const auditInputs = { rig: "rig.json", spec, specConstitution: "x", stored: { reason: "read", text: "x" }, storedSeats: ["devtools"] };

const fired = auditRig({ ...auditInputs, contextBySeat: { devtools: current }, modelsBySeat: { devtools: "local/iq3_s" } });
assert.ok(
	fired.findings.some((f) => f.id === "context-over-window"),
	`the rule fires on a CURRENT over-window seat; got ${JSON.stringify(fired.findings.map((f) => f.id))}`,
);
assert.match(fired.findings.find((f) => f.id === "context-over-window").detail, /MOVED/, "and names the axis in the finding");
// The fix string is operator-facing, so its SHAPE is pinned: `compact` takes <seat> as its first argument, not
// <rig> <seat> — a fix line with the wrong argument order tells the operator to run a command that names the rig
// file as a seat.
assert.match(
	fired.findings.find((f) => f.id === "context-over-window").fix,
	/node cli\.mjs compact devtools/,
	"the fix names the verb with the seat as its first argument",
);
assert.match(fired.findings.find((f) => f.id === "context-over-window").fix, /exit code: 0 cut, 1 failed, 2 no-op/, "and carries the exit-code truth (#4898)");

const silent = auditRig({ ...auditInputs, contextBySeat: { devtools: behind } });
assert.equal(
	silent.findings.filter((f) => f.id === "context-over-window").length,
	0,
	"the post-compaction artifact is a NON-FIRING case",
);

const skipped = auditRig({ ...auditInputs, contextBySeat: null });
const skipCheck = skipped.checks.find((c) => c.id === "context-over-window");
assert.equal(skipCheck?.status, "skipped", "no context data means SKIPPED, never a silent pass");
assert.ok(skipCheck?.why, "and it carries the reason in the report");
// The distinction that matters: an EMPTY map is "read, nothing over window" (a pass), while null is
// "not read" (a skip). A rule that treats them alike hides an unread store as a clean rig.
const emptyMap = auditRig({ ...auditInputs, contextBySeat: {} });
assert.equal(
	emptyMap.checks.find((c) => c.id === "context-over-window")?.status,
	"pass",
	"an empty map is a real read with nothing to report, not a skip",
);

/* ------------------- 5. THE RULE STARTS GREEN on the live population ------------------- */
// Measured 2026-11-04 against the live rig store (read-only, `/home/chexxor/Git/Durian-Pi/selfdev.sqlite`, 12
// conversations carrying entries) with the DECLARED windows from durig.config.json (DURIG_LOCAL_CONTEXT=200000,
// DURIG_VERIFIER_CONTEXT=24576). Aggregate counts only — no seat content. The table is the population a landing
// would land on, so "starts green" is an executable claim, not a promise.
const live = [
	{ conv: 3, consumed: 114_617, stale: false },
	{ conv: 9, consumed: 150_539, stale: false },
	{ conv: 15, consumed: 20_110, stale: false },
	{ conv: 21, consumed: 38_224, stale: false },
	{ conv: 4918, consumed: 244_751, stale: true }, // the advocate artifact: one turn MOVED 244,751 (243,200 cacheRead)
	{ conv: 4924, consumed: 91_123, stale: false },
	{ conv: 4930, consumed: 141_833, stale: false },
	{ conv: 4936, consumed: 0, stale: false },
	{ conv: 4942, consumed: 0, stale: true },
	{ conv: 55605, consumed: 89_530, stale: false },
	{ conv: 86607, consumed: 0, stale: true },
	{ conv: 107595, consumed: 135_567, stale: false },
];
const liveMap = {};
for (const row of live) {
	// Every one of these seats is local-class on this rig, so its own denominator is the DECLARED 200000. The
	// verifier figure (24576) is the wrong denominator for them — using it is the 7-of-12 false alarm this guard
	// must not ship, which is why the denominator's state is part of the finding.
	liveMap[`seat${row.conv}`] = contextConsumption(
		row.stale ? [compaction(row.conv * 10 + 1), asst(row.conv, { input: row.consumed, output: 0, cacheRead: 0, cacheWrite: 0 })] : [asst(row.conv, { input: row.consumed, output: 0, cacheRead: 0, cacheWrite: 0 })],
		LOCAL_WINDOW,
	);
}
const liveAudit = auditRig({
	...auditInputs,
	storedSeats: Object.keys(liveMap),
	contextBySeat: liveMap,
	modelsBySeat: Object.fromEntries(Object.keys(liveMap).map((n) => [n, "local/iq3_s"])),
});
assert.equal(
	liveAudit.findings.filter((f) => f.id === "context-over-window").length,
	0,
	`the rule starts GREEN on the live population; findings: ${JSON.stringify(liveAudit.findings.filter((f) => f.id === "context-over-window"))}`,
);
// The counterfactual that justifies the discrimination: the same population, staleness discrimination kept,
// scored against the VERIFIER window — which is what a guard without denominator provenance does.
const naiveFires = live.filter((r) => !r.stale && r.consumed > 24_576).length;
assert.equal(naiveFires, 7, "the wrong denominator would raise 7 of the 12 live conversations — the false alarm this design avoids");
assert.equal(live.filter((r) => r.consumed > 200_000).length, 1, "exactly one conversation is over its declared window");
assert.equal(live.filter((r) => r.consumed > 200_000 && !r.stale).length, 0, "and it is the stale one, so the guard is silent on the live rig today");

/* ---------------- 6. the REAL read path: committed entries, real ids ---------------- */
// Everything above is pure over hand-made entries, and a hand-made entry can lie about the two things this
// guard leans on: REAL entry ids (the boundary comparison is `boundaryId > usageId`) and the real newest-first
// page order `readSeatPages` returns. So this section runs the producer the operator actually uses —
// `readRigHealth` over a store with committed entries — and asserts the notice arrives through it, then
// disappears when a real `pi.compaction` entry is committed AFTER the measured turn.
{
	const dir = mkdtempSync(join(tmpdir(), "context-window-"));
	try {
		const dbPath = join(dir, "store.db");
		const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
		const models = createModels();
		models.setProvider(faux.provider);
		const registry = createRegistry();
		registry.install(Router);
		const storage = new MemoryStorage();
		const harness = await Harness.open(storage, { models, registry }, BACKGROUND_CONTEXT);
		let convId;
		await harness.commit(async (tx) => {
			const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
			await configure(tx, c.id, {
				model: { provider: "faux", modelId: "faux-seat" },
				instructions: compilePersona({ role: "worker" }),
			});
			await registerSeat(tx, "devtools", c.id, "worker");
			convId = c.id;
		}, BACKGROUND_CONTEXT);
		await harness.commit(
			async (tx) => {
				await tx.appendEntry(convId, { kind: "pi.assistant", model: [{ role: "assistant", usage: OVER }] });
			},
			BACKGROUND_CONTEXT,
		);
		const cfg = { DURIG_CONTEXT_WINDOW: "200000", DURIG_COMPACTION_KEEP_RECENT_TOKENS: "20000" };
		const health = await readRigHealth(storage, dbPath, 1, { cfg });
		const live = health.attention.find((a) => a.kind === CONTEXT_OVER_WINDOW_CAUSE);
		assert.ok(
			live,
			`the real read path raises the notice; attention was ${JSON.stringify(health.attention.map((a) => a.kind))}`,
		);
		assert.match(live.detail, /one turn MOVED 244,000 tokens = 1\.22x the declared window of 200,000/, "the fraction, the denominator's state and its value all reach the operator");
		assert.match(live.detail, /keepRecentTokens=20000 willCut=true/, "and the remedy says the compact verb would actually cut");
		assert.equal(health.context.devtools.head.state, "current", "the snapshot carries the head state next to the number");

		// The gate is config-derived: with no DURIG_COMPACTION_* value the notice must NOT invent pi's default.
		const noGate = await readRigHealth(storage, dbPath, 1, { cfg: { DURIG_CONTEXT_WINDOW: "200000" } });
		assert.match(
			noGate.attention.find((a) => a.kind === CONTEXT_OVER_WINDOW_CAUSE).detail,
			/willCut=unknown/,
			"no declared compaction budget, no invented gate",
		);

		// Commit a REAL compaction boundary after the measured turn: the number stays (hiding a measurement is
		// worse than labelling it) but the notice goes silent, on real durable state rather than on my fixture.
		await harness.commit(
			async (tx) => {
				await tx.appendEntry(convId, { kind: "pi.compaction", head: 1 });
			},
			BACKGROUND_CONTEXT,
		);
		const after = await readRigHealth(storage, dbPath, 1, { cfg });
		assert.equal(after.context.devtools.head.state, "behind-boundary", "the store's own ids order the boundary after the turn");
		assert.ok(after.context.devtools.head.boundaryEntryId > after.context.devtools.head.usageEntryId, "and the comparison is over real entry ids");
		assert.equal(after.context.devtools.consumed, 244_000, "the measurement is still reported");
		assert.equal(
			after.attention.find((a) => a.kind === CONTEXT_OVER_WINDOW_CAUSE),
			undefined,
			"while the notice is silent",
		);

		// ONE producer: the map `check` scores is the map `status` printed. Two computations of a fraction is how
		// a rule and a display drift apart and the operator stops believing either.
		const roster = await readSeatList(storage);
		const pages = await readSeatPages(storage, BACKGROUND_CONTEXT, roster);
		const map = seatContextMap({ pages, seats: roster, cfg });
		assert.deepEqual(map.devtools, after.context.devtools, "check scores the number the operator was shown, not a re-derivation");
		const audit = auditRig({
			...auditInputs,
			storedSeats: ["devtools"],
			contextBySeat: map,
			modelsBySeat: { devtools: "faux/faux-seat" },
		});
		assert.equal(
			audit.findings.filter((f) => f.id === "context-over-window").length,
			0,
			"and the rule agrees with the notice about the same store state",
		);
		await harness.close(BACKGROUND_CONTEXT);
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

console.log(
	`CONTEXT-OVER-WINDOW PASS (head state ${current.head.state}/${behind.head.state}; fires on fraction ${over.fraction?.toFixed(2)} with denominator ${over.denominator}; silent on the 9.9 artifact and with no window; rule ${rule.id}/${rule.severity} starts green over a ${live.length}-seat live population, ${naiveFires} avoided false alarms)`,
);
