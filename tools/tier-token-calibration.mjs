#!/usr/bin/env node
// tools/tier-token-calibration.mjs — measure how much CONTEXT a queue row of each tier actually
// consumes, so the pool's size gate (docs/POOL-QUEUE-SPEC.md §6.2, P6a) is built on numbers
// instead of guesses.
//
// WHY THIS EXISTS (operator ruling 2026-11-12, docs/POOL-QUEUE-SPEC.md §9.1 item 8, build row 0):
// the spec's tier->token table (4k/12k/40k/120k) is a PROPOSED DEFAULT, not a measurement, and a
// wrong `feature` estimate refuses real work in a way that reads like an unlucky claim rather than
// a defect. So the table must be derived before the gate is written.
//
// THE RAW MATERIAL, and the trap in it:
//   `selfdev.sqlite.spend.jsonl` records one line per MODEL CALL (keys at, model, host, authKeyEnv,
//   prompt_tokens, completion_tokens, reasoning_tokens, cached_tokens, usd, status) with NO item,
//   seat or tier reference — measured 2026-11-13: 2,248 lines, 0 with an item id. The ledger alone
//   therefore cannot answer "how many tokens does a `feature` row cost".
//   The durable store DOES hold the linkage: every assistant entry in `entries` carries a `usage`
//   object and a `timestamp`; the queue view carries each row's `claimed`/`done` transition instants;
//   `status --json` maps a seat name to its conversation. The join is:
//     item -> seat -> conversation -> entries in [claim, done].
//   TWO measures are printed because they answer different questions:
//     ADDITIVE = (usage.output + usage.reasoning of every assistant turn in the claim->done window)
//                + (bytes of tool-result entries in the same window / 4, an estimate, stated below).
//                This is the material the WORK put into context.
//     MARGINAL = max per-turn context in the window - min per-turn context in the window. A
//                compaction reset inside the window makes this misleading, so it is a cross-check.
//   Attribution caveat printed with the numbers: turns are attributed by TIME WINDOW, so a seat
//   working two rows at once double-counts the overlap; the census prints how many windows overlap.
//
// Usage:
//   node tools/tier-token-calibration.mjs [--db ./selfdev.sqlite] [--json <out.json>]
//        [--include-notices]  DONE notices are acks, not work; they are excluded by default and
//                             counted separately.
//
// Read-only: the store is opened readOnly:true, and `queue`/`status` are broker-served VIEWS (D111),
// so no second writing owner is opened. Exit 0 = a table was produced; 1 = store/queue unreadable;
// 2 = usage readable but no attributable window for any tier.
//
// Measured cost: 63 s on this box (the `entries` scan is 254k rows) — Linux, Fedora Linux 45,
// kernel 7.2.15-300.fc45.x86_64, node v24.22.1, store ./selfdev.sqlite, 2026-11-13T01:0xZ.
// Run it once per calibration, not per session.

import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const has = (name) => argv.includes(`--${name}`);

const DB = opt("db", "./selfdev.sqlite");
const OUT = opt("json", null);
const BYTES_PER_TOKEN = 4; // an estimate; the tool prints it next to every number it derived from it
const TIERS = ["trivial", "small", "feature", "project"];

const t0 = Date.now();
const ms = () => Date.now() - t0;
const note = (m) => process.stderr.write(`[tier-token-calibration ${ms()}ms] ${m}\n`);
const jsonSlice = (text) =>
	JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
const runCli = (args) =>
	execFileSync("node", ["cli.mjs", ...args], {
		env: { ...process.env, DURIG_DB: DB },
		maxBuffer: 64 * 1024 * 1024,
		encoding: "utf8",
	});

// ---------------------------------------------------------------- queue rows (ONE read, broker-served view)
let items;
try {
	items = jsonSlice(runCli(["queue", "--json", "--no-body"])).items ?? [];
	note(`queue rows read: ${items.length}`);
} catch (err) {
	console.error(`QUEUE_READ_FAILED: ${err.message}`);
	process.exit(1);
}

// ---------------------------------------------------------------- seats -> conversation (ONE read)
let seatRows;
try {
	const status = jsonSlice(runCli(["status", "--json"]));
	seatRows = (status.seats ?? []).map((s) => ({
		name: s.name,
		conversationId: s.conversationId,
		window: status.context?.[s.name]?.window?.value ?? null,
		capabilities: s.capabilities ?? [],
	}));
} catch (err) {
	console.error(`STATUS_READ_FAILED: ${err.message}`);
	process.exit(1);
}

// ---------------------------------------------------------------- one SQL read of the entry ledger
let db;
try {
	db = new DatabaseSync(DB, { readOnly: true });
} catch (err) {
	console.error(`STORE_OPEN_FAILED: ${err.message}`);
	process.exit(1);
}

try {
	// json_extract on the entry record: assistant entries carry usage in model[0]; tool results carry
	// their content there too, so length(record) is the honest byte count of what the turn read.
	const entryRows = db.prepare(
		"select conversation_id conv, json_extract(record,'$.kind') kind, " +
		"json_extract(record,'$.model[0].timestamp') at, " +
		"json_extract(record,'$.model[0].usage.output') out, " +
		"json_extract(record,'$.model[0].usage.reasoning') reason, " +
		"json_extract(record,'$.model[0].usage.input') inp, " +
		"json_extract(record,'$.model[0].usage.cacheRead') cache_read, " +
		"json_extract(record,'$.model[0].usage.cacheWrite') cache_write, " +
		"length(record) bytes from entries",
	).all();
	note(`entries read: ${entryRows.length}`);

	const byConv = new Map(); // conversationId -> [{at, kind, out, reason, context, bytes}]
	for (const r of entryRows) {
		const at = Number(r.at);
		if (!Number.isFinite(at)) continue;
		const list = byConv.get(r.conv) ?? [];
		list.push({
			at,
			kind: r.kind,
			out: Number(r.out) || 0,
			reason: Number(r.reason) || 0,
			context: (Number(r.inp) || 0) + (Number(r.cache_read) || 0) + (Number(r.cache_write) || 0),
			bytes: Number(r.bytes) || 0,
		});
		byConv.set(r.conv, list);
	}

	const windows = [];
	const perTier = new Map();
	let noticeRows = 0;
	for (const item of items) {
		if (!item.tier) continue;
		if (item.notice && !has("include-notices")) {
			noticeRows += 1;
			continue;
		}
		if (item.status !== "done") continue; // cancelled/held/deferred rows never had work done on them
		const claimed = item.transitions?.find((t) => t.event === "claimed");
		const done = item.transitions?.find((t) => t.event === "done");
		if (!claimed || !done) continue;
	 const seat = seatRows.find((w) => w.name === item.to);
		if (!seat || !seat.conversationId) continue;
		const from = Date.parse(claimed.at);
		const to = Date.parse(done.at);
		const events = (byConv.get(seat.conversationId) ?? []).filter((e) => e.at >= from && e.at <= to);
		if (!events.length) continue;
		const assistant = events.filter((e) => e.kind === "pi.assistant");
		const toolBytes = events
			.filter((e) => e.kind === "pi.tool-result")
			.reduce((a, e) => a + e.bytes, 0);
		const additive =
			assistant.reduce((a, e) => a + e.out + e.reason, 0) + Math.round(toolBytes / BYTES_PER_TOKEN);
		const peak = assistant.length ? Math.max(...assistant.map((e) => e.context)) : 0;
		const base = assistant.length ? Math.min(...assistant.map((e) => e.context)) : 0;
		perTier.set(item.tier, (perTier.get(item.tier) ?? []).concat([{
			id: item.id,
			seat: seat.name,
			turns: assistant.length,
			additive,
			marginal: peak - base,
			minutes: (to - from) / 60000,
		}]));
		windows.push({ id: item.id, seat: seat.name, from, to });
	}

	// Overlap census: windows on the SAME seat that overlap in time are attributed twice.
	let overlapping = 0;
	const bySeat = new Map();
	for (const w of windows) bySeat.set(w.seat, (bySeat.get(w.seat) ?? []).concat(w));
	for (const list of bySeat.values()) {
		list.sort((a, b) => a.from - b.from);
		for (let i = 1; i < list.length; i++) {
			if (list[i].from < list[i - 1].to) overlapping += 1;
		}
	}

	const quant = (xs, p) => {
		if (!xs.length) return null;
		const s = [...xs].sort((a, b) => a - b);
		return s[Math.min(s.length - 1, Math.floor(p * s.length))];
	};

	const report = TIERS.map((tier) => {
		const list = perTier.get(tier) ?? [];
		const add = list.map((x) => x.additive);
		return {
			tier,
			rows: list.length,
			p10: quant(add, 0.1),
			p25: quant(add, 0.25),
			p50: quant(add, 0.5),
			p75: quant(add, 0.75),
			p90: quant(add, 0.9),
			medianMarginalTokens: quant(list.map((x) => x.marginal), 0.5),
			medianTurns: quant(list.map((x) => x.turns), 0.5),
			medianMinutes: quant(list.map((x) => x.minutes), 0.5),
		};
	});

	console.log("TIER -> TOKENS, measured from the durable store");
	console.log(`elapsed: ${(ms() / 1000).toFixed(1)} s`);
	console.log(
		`store: ${DB}  queue rows: ${items.length}  entries: ${entryRows.length}  ` +
		`attributed claim->done windows: ${windows.length} (overlapping: ${overlapping})  notice rows skipped: ${noticeRows}`,
	);
	console.log(
		"definition: additiveTokens = (usage.output + usage.reasoning of every assistant turn in the claim->done window) " +
		"+ (bytes of tool-result entries in the same window / 4)",
	);
	console.log("            marginalTokens = max per-turn context in the window - min per-turn context in the window");
	console.log("tier      rows   p10      p25      p50      p75      p90      medMarginal  medTurns  medMinutes");
	for (const r of report) {
		console.log(
			`${String(r.tier).padEnd(9)} ${String(r.rows).padEnd(6)} ${String(r.p10 ?? "-").padEnd(8)} ` +
			`${String(r.p25 ?? "-").padEnd(8)} ${String(r.p50 ?? "-").padEnd(8)} ${String(r.p75 ?? "-").padEnd(8)} ` +
			`${String(r.p90 ?? "-").padEnd(8)} ${String(r.medianMarginalTokens ?? "-").padEnd(12)} ` +
			`${String(r.medianTurns ?? "-").padEnd(9)} ${String(r.medianMinutes ?? "-").padEnd(11)}`,
		);
	}
	console.log("SUGGESTED DURIG_TIER_TOKENS (p25, rounded to the nearest hundred; a tier the store cannot answer keeps an explicit default):");
	for (const r of report) {
		const usable = r.p25 != null && r.rows >= 20 ? Math.round(r.p25 / 100) * 100 : null;
		console.log(`  ${r.tier}: ${usable ?? "NOT MEASURABLE (rows < 20)"}   [rows=${r.rows}, p25=${r.p25 ?? "-"}, p50=${r.p50 ?? "-"}, p75=${r.p75 ?? "-"}]`);
	}
	console.log(`seats: ${seatRows.map((w) => `${w.name}=${w.window ?? "window unset"}`).join(", ")}`);
	console.log(
		"NOTE: selfdev.sqlite.spend.jsonl has NO per-item linkage (keys at,model,host,authKeyEnv,prompt_tokens," +
		"completion_tokens,reasoning_tokens,cached_tokens,priceSource,priceAsOf,usd,totalBefore,totalAfter,status,note). " +
		"It answers cost per call, not tokens per row - that is why this join goes through the entries table.",
	);

	if (OUT) {
		writeFileSync(
			OUT,
			JSON.stringify(
				{
					measuredAt: new Date().toISOString(),
					db: DB,
					report,
					windows: windows.length,
					overlapping,
					noticeRowsSkipped: noticeRows,
					seats: seatRows,
					bytesPerToken: BYTES_PER_TOKEN,
				},
				null,
				2,
			),
		);
		note(`wrote ${OUT}`);
	}
	if (!report.some((r) => r.rows > 0)) {
		console.error("NO_ATTRIBUTABLE_WINDOWS: the store has no claim->done window tied to a tiered row");
		process.exit(2);
	}
	process.exit(0);
} finally {
	db.close();
}
