#!/usr/bin/env node
// tools/claim-order.mjs — WHICH ROW DOES A CLAIM ACTUALLY TAKE? (#7272)
//
// WHY THIS EXISTS. Two accounts of the same seat disagreed: one said a seat claims the oldest
// queued row, the other said it claims the row with a live priority lease. Both were "read from
// the store", and neither could be checked by looking at the store, because the store holds a
// PRIORITY and a STRATEGY but never the ORDER a claim produced. The only way to settle that
// disagreement is to run the claim path itself on the live queue and print what it takes and what
// it passed over. This instrument does that, per seat, in one read.
//
// IT IS AN INSTRUMENT, NOT A FIX. It claims nothing, writes nothing, and opens no writing
// Harness: the queue and the seats document are read through the broker-served `cli.mjs` read
// views (`queue --json`, `status --json`), the same path `check` uses (D111).
//
// THE VERDICT IT PRINTS is deliberately narrow: it reports the ORDER the claim path resolves to
// for the rows that exist right now. It does not predict the future, and a row it reports as
// "passed over" is not starved unless it stays queued while rows behind it are claimed.
//
// Usage:
//   node tools/claim-order.mjs [--db ./selfdev.sqlite] [--seat impl --seat devtools] [--json out.json]
//   node cli.mjs queue --json | node tools/claim-order.mjs --stdin --seat impl
// Exit: 0 always (a measurement is not a fault). 2 = the read failed or no seat was resolvable.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolveStrategy, orderCandidates, effectivePriority, DEFAULT_STRATEGY } from "../src/workstrategy.mjs";
import { selectNextWork } from "../src/rig.mjs";

// #5047: `--json` is not pure JSON on stdout - a `{"spend":...}` line rides at every CLI start.
// Slice from the pretty-printed object, exactly as tools/queue-rows.mjs does.
function parseCliJson(text) {
	const i = text.indexOf("{\n");
	return JSON.parse(text.slice(i >= 0 ? i : text.indexOf("{")));
}

/**
 * THE REPORT FOR ONE SEAT. Pure: it takes the queue rows and the seat's declared strategy and
 * answers "which row does the claim path take, and in what order does it look?".
 *
 * It calls `selectNextWork` - the SAME function `claim_work` runs (src/rig.mjs:936) - so the
 * number printed here is the claim, not a lookalike ordering re-derived in the tool. A second
 * ordering rule living in the instrument is exactly how a gate rule drifts (#6112), which is why
 * there is no ordering logic in this file beyond the two exported helpers from
 * `src/workstrategy.mjs` used to SHOW the head of the queue.
 */
export function claimOrderReport(items, seat, { seatStrategy, teamStrategy, capabilities = [], now = Date.now() }) {
	const resolved = resolveStrategy({ seatStrategy, teamStrategy, defaultStrategy: DEFAULT_STRATEGY });
	const queued = (items ?? []).filter((it) => it.to === seat && it.status === "queued");
	const byInsertion = [...queued].sort((a, b) => a.id - b.id);
	const byStrategy = orderCandidates(queued, { strategy: resolved.strategy, now });
	const taken = selectNextWork(items, seat, { capabilities, strategy: resolved.strategy, now });
	const asOldest = selectNextWork(items, seat, { capabilities, strategy: DEFAULT_STRATEGY, now });
	// A row is "declared" only when it carries a priority FIELD; the rank it gets at claim time is decided
	// by effectivePriority, which is where a lapsed lease stops counting. Counting the raw field would
	// report a lapsed lease as still urgent - the exact drift this module exists to prevent.
	const leased = queued.map((it) => ({ it, eff: effectivePriority(it, now) })).filter((x) => x.eff.raw !== null);
	const liveLeases = leased.filter((x) => !x.eff.lapsed && !x.eff.invalid);
	const gatedLeases = liveLeases.filter((x) => (x.it.blockedBy ?? []).length > 0);
	return {
		seat,
		strategy: resolved.strategy,
		source: resolved.source,
		queued: queued.length,
		headByInsertion: byInsertion.slice(0, 3).map((it) => it.id),
		headByStrategy: byStrategy.slice(0, 3).map((it) => {
			const eff = effectivePriority(it, now);
			return { id: it.id, priority: eff.priority, lapsed: eff.lapsed, invalid: eff.invalid };
		}),
		taken: taken.item?.id ?? null,
		takenWouldBeUnderOldestFirst: asOldest.item?.id ?? null,
		// The rows the claim walked past, with the claim path's own reason.
		passedOver: taken.skipped.map((s) => ({ id: s.id, reason: s.reason })),
		leases: { declared: leased.length, live: liveLeases.length, lapsed: leased.filter((x) => x.eff.lapsed).length, invalid: leased.filter((x) => x.eff.invalid).length, onGatedRows: gatedLeases.length },
		reorders: taken.item?.id === asOldest.item?.id ? "no" : "yes",
	};
}

function reportLine(r) {
	const head = (list) => list.map((x) => (typeof x === "number" ? `#${x}` : `#${x.id}[${x.priority}${x.lapsed ? ",LAPSED" : ""}${x.invalid ? ",INVALID" : ""}]`)).join(" ") || "(none)";
	const label = (l) => l.padEnd(26);
	const lines = [
		`${r.seat}: resolved strategy=${r.strategy} (from ${r.source})  queued rows addressed to it=${r.queued}`,
		`  ${label("head by insertion (id)")}: ${head(r.headByInsertion)}`,
		`  ${label("head by claim order")}: ${head(r.headByStrategy)}`,
		`  ${label("a claim takes")}: ${r.taken === null ? "nothing claimable" : "#" + r.taken}`,
		`  ${label("oldest_first would take")}: ${r.takenWouldBeUnderOldestFirst === null ? "nothing claimable" : "#" + r.takenWouldBeUnderOldestFirst}`,
		`  -> the lease ${r.reorders === "yes" ? "REORDERS this seat's claim" : "changes nothing for this seat (claim order is unchanged)"}`,
	];
	if (r.passedOver.length) lines.push(`  ${label(`passed over (${r.passedOver.length})`)}: ${r.passedOver.map((s) => `#${s.id} ${s.reason}`).join(", ")}`);
	if (r.leases.declared) lines.push(`  ${label("leases")}: ${r.leases.live} live, ${r.leases.lapsed} lapsed, ${r.leases.invalid} unreadable, ${r.leases.onGatedRows} on a gated row (a lease cannot be claimed while its gate is open)`);
	return lines.join("\n");
}

// Guarded so the demo can `import` the report without the CLI running against a store (#7272).
function main() {
	const argv = process.argv.slice(2);
	const opt = (name, dflt) => {
		const i = argv.indexOf(`--${name}`);
		return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
	};

	if (argv.includes("--help")) {
		console.log("usage: node tools/claim-order.mjs [--db ./selfdev.sqlite] [--seat <name> | --seat=<name>=<strategy>]... [--json <out>] [--stdin]");
		return 0;
	}

	let items = [];
	const seatStrategies = {};
	let teamStrategy = null;
	const caps = {};
	let seatNames = [];

	// `--seat impl` or `--seat=impl=priority_first`: the name, and optionally the strategy to measure
	// against. In `--stdin` mode there is no seats document to read, so the strategy has to be supplied.
	const requestedSeats = () => {
		const out = [];
		for (let i = 0; i < argv.length; i += 1) {
			if (!argv[i].startsWith("--seat")) continue;
			const inline = argv[i].slice("--seat".length).replace(/^=/, "");
			const value = inline || argv[i + 1] || "";
			if (!value) continue;
			const [name, strategy] = value.split("=");
			out.push({ name, strategy: strategy ?? null });
		}
		return out;
	};

	if (argv.includes("--stdin")) {
		items = parseCliJson(readFileSync(0, "utf8")).items ?? []; // fd 0 read synchronously: process.stdin is not iterable here
		for (const { name, strategy } of requestedSeats()) {
			seatStrategies[name] = strategy;
			seatNames.push(name);
		}
		teamStrategy = opt("team", DEFAULT_STRATEGY);
	} else {
		const db = opt("db", "./selfdev.sqlite");
		const cli = opt("cli", "cli.mjs");
		const env = { ...process.env, DURIG_DB: db };
		const q = spawnSync(process.execPath, [cli, "queue", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env });
		if (q.status !== 0 || !q.stdout) {
			console.error(`claim-order: the queue read failed (exit ${q.status}) - ${q.stderr?.slice(0, 200)}`);
			return 2;
		}
		items = parseCliJson(q.stdout).items ?? [];
		const st = spawnSync(process.execPath, [cli, "status", "--json"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env });
		if (st.status !== 0 || !st.stdout) {
			console.error(`claim-order: the status read failed (exit ${st.status}) - ${st.stderr?.slice(0, 200)}`);
			return 2;
		}
		const view = parseCliJson(st.stdout);
		teamStrategy = view.workStrategy?.team?.strategy ?? null;
		for (const [name, entry] of Object.entries(view.workStrategy?.seats ?? {})) seatStrategies[name] = entry.strategy;
		for (const s of view.seats ?? []) caps[s.name] = s.capabilities ?? [];
		seatNames = requestedSeats().map((s) => s.name);
		for (const s of requestedSeats()) if (s.strategy) seatStrategies[s.name] = s.strategy;
		if (!seatNames.length) seatNames = Object.keys(seatStrategies);
	}

	if (!seatNames.length) {
		console.error("claim-order: no seat to measure (pass --seat <name>, or read a rig whose seats document declares strategies)");
		return 2;
	}

	const now = Date.now();
	const reports = seatNames.map((seat) => claimOrderReport(items, seat, {
		seatStrategy: seatStrategies[seat] ?? null,
		teamStrategy,
		capabilities: caps[seat] ?? [],
		now,
	}));
	for (const r of reports) console.log(reportLine(r));
	if (argv.includes("--json")) {
		writeFileSync(argv[argv.indexOf("--json") + 1], JSON.stringify({ now: new Date(now).toISOString(), teamStrategy, reports }, null, 2) + "\n");
		console.log(`wrote ${argv[argv.indexOf("--json") + 1]}`);
	}
	return 0;
}

if (process.argv[1] && process.argv[1].endsWith("claim-order.mjs")) process.exit(main());
