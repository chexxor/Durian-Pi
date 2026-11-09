#!/usr/bin/env node
// tools/digest-scale-probe.mjs — does the clock-in digest stay inside its OWN byte budget at a
// realistic backlog? (#5398 bar (b); promoted from `.spike/delegate-20261108h/digest-scale-probe.mjs`
// under D236 (9) by #5617.)
//
// WHY THIS EXISTS. `demo/clockin-digest.test.mjs` renders a 4-row fixture, so it cannot see the store
// shape that actually breaks the digest: measured on `./selfdev.sqlite` at 2026-11-08T00:26Z the store
// held {done 3957, cancelled 842, held 422, deferred 365, claimed 11, queued 7}. At that shape the
// per-row deferred list was **24,107 B** — over `DIGEST_BUDGET_BYTES` (20,000) by itself — while the
// per-seat aggregate keeps that section at **856 B** (measured at 2026-11-08, this box). The demo is a
// gate; this probe is the SCALE re-check, and it costs under a second.
//
// It is OFFLINE and READ-ONLY: no store, no broker, no network, no seat turn, no metered call. It
// renders the real `docs/NEXT.md` pointer so the byte figure is the number a session would actually
// pay, and everything else is fixture rows. An unpromoted probe is lost next session, which is why
// this file is tracked (see the `.spike/` note in `tools/README.md`).
//
// usage:
//   node tools/digest-scale-probe.mjs                     # the measured 365-deferred-row shape
//   node tools/digest-scale-probe.mjs --rows 4000         # any shape you want to price
//   node tools/digest-scale-probe.mjs --sweep 160,365,1000,4000   # does the aggregate stay bounded?
// exit: 0 inside budget · 1 over budget (the bar #5398 set) · 2 usage error
//
// Measured 2026-11-08 on Linux Fedora 45 7.2.15-300.fc45.x86_64, node v24.22.1, at main 7ccb2163 (the
// OLD one-line-per-row shape): 365 rows -> digest 40,161 B total, deferred section 24,107 B, exit 1.
// With the aggregate (#5398, item-5398 @ 9ae25f09): 365 rows -> 15,013 B total, 856 B for the deferred
// view, exit 0, and the sweep stays bounded 160 -> 4000 rows.

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
	DIGEST_BUDGET_BYTES,
	pointerSection,
	renderDigest,
} from "../scripts/clockin.mjs";

const ROOT = join(import.meta.dirname, "..");

// The seat spread and subject wording of the 2026-11-07 outage-window deferrals, because the byte cost
// is a function of BOTH the row count and how many seats hold rows.
const SEAT_SPREAD = [
	["impl", 95],
	["devtools", 89],
	["lead", 64],
	["pm", 47],
	["scribe", 33],
	["qa", 28],
	["auditor", 5],
	["security", 3],
	["qa2", 1],
];

/** Fixture rows at a target deferred count, keeping the measured seat proportions. */
function fixture(deferredRows) {
	const total = SEAT_SPREAD.reduce((n, [, n2]) => n + n2, 0); // 365
	let id = 4200;
	const items = [];
	for (const [seat, n] of SEAT_SPREAD) {
		const take = deferredRows === total ? n : Math.max(1, Math.round((n * deferredRows) / total));
		for (let i = 0; i < take; i++)
			items.push({
				id: id++,
				to: seat,
				subject: `Unpark ${id}: the outage-window deferral sweep — verdict class and the answer it needs`,
				status: "deferred",
			});
	}
	for (let i = 0; i < 11; i++)
		items.push({ id: id++, to: SEAT_SPREAD[i % SEAT_SPREAD.length][0], subject: "claimed work in flight", status: "claimed" });
	for (let i = 0; i < 7; i++)
		items.push({ id: id++, to: SEAT_SPREAD[i % SEAT_SPREAD.length][0], subject: "queued follow-on", status: "queued" });
	const deferred = items.filter((i) => i.status === "deferred").length;
	return {
		items,
		counts: {
			done: 3957,
			cancelled: 842,
			held: 422,
			deferred,
			claimed: 11,
			queued: 7,
		},
	};
}

/** The shape the aggregate replaced, computed on the SAME rows so the delta is never a memory. */
function oldShapeDeferredBytes(items) {
	return Buffer.byteLength(
		`deferred (awaiting the operator): ${items
			.filter((i) => i.status === "deferred")
			.map((i) => `#${i.id} (${i.to}) ${String(i.subject || "").slice(0, 55)}`)
			.join(" · ")}`,
		"utf8",
	);
}

/** One render at a row count, with the bytes this probe exists to report. */
export function probe(deferredRows) {
	const pointer = pointerSection(readFileSync(join(ROOT, "docs", "NEXT.md"), "utf8"));
	const { items, counts } = fixture(deferredRows);
	const attention = SEAT_SPREAD.slice(0, 9).map(([seat]) => ({
		scope: "seat",
		seat,
		kind: "deferred_awaiting_answer",
		detail: `${items.filter((x) => x.to === seat).length} item(s) parked on a question; #4976 waiting on human`,
	}));
	const text = renderDigest({
		pointer,
		seats: 12,
		attention,
		broker: { detail: "down (no broker state)" },
		items,
		counts,
		git: {
			refs: 91,
			worktrees: 88,
			debt: Array.from({ length: 23 }, (_, i) => `item-${5000 + i} 3 commits unmerged`),
			base: "main",
			baseSha: "7ccb2163",
			head: { state: "ahead", at: "7ccb2163" },
		},
		runbooks: { dated: "2026-11-08", stale: [], probeFailures: 0 },
		config: { provider: "local", model: "local/qwen3.8-flash-next-iq3_s", local: "2 configured", maxSeats: 1 },
		localEndpoint: "http://127.0.0.1:8080/v1 (answers)",
		selfdevLines: 3010,
		selfdevHeadings: ["## Operational pitfalls (2026-11-08)", "## Operational pitfalls (2026-11-07)"],
		suiteMarker: "last suite: 260/261 at 7ccb2163",
		ms: 2600,
	});
	return {
		deferredRows: counts.deferred,
		items: items.length,
		bytes: Buffer.byteLength(text, "utf8"),
		budget: DIGEST_BUDGET_BYTES,
		oldShapeDeferredBytes: oldShapeDeferredBytes(items),
	};
}

const args = process.argv.slice(2);
let rows = 365;
let sweep = null;
for (let i = 0; i < args.length; i++) {
	const a = args[i];
	if (a === "--rows") rows = Number(args[++i]);
	else if (a === "--sweep") sweep = String(args[++i] || "").split(",").map(Number);
	else {
		console.error("usage: digest-scale-probe.mjs [--rows N] [--sweep 160,365,1000,4000]");
		process.exit(2);
	}
}
if (!Number.isFinite(rows) || rows < 0) {
	console.error("digest-scale-probe: --rows must be a non-negative number");
	process.exit(2);
}

const runs = sweep && sweep.length ? sweep : [rows];
let over = 0;
for (const n of runs) {
	const r = probe(n);
	console.log(JSON.stringify(r));
	const red = r.bytes > r.budget;
	if (red) over++;
	console.log(
		`${red ? "RED" : "GREEN"} — ${r.deferredRows} deferred rows: digest ${r.bytes} B vs budget ${r.budget} B; the per-row deferred list would cost ${r.oldShapeDeferredBytes} B on the same rows`,
	);
}
process.exit(over ? 1 : 0);
