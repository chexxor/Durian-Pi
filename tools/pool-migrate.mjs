#!/usr/bin/env node
// tools/pool-migrate.mjs — N19 "The Pool": classify the backlog that COULD be pooled, with a reason per
// row. It PROPOSES; it never writes. (docs/POOL-QUEUE-SPEC.md §5 P1/P2, §6.4; D275.)
//
// WHY THIS EXISTS (a measurement, not a wish). Measured 2026-11-13 on this rig's live store: 7,655 rows,
// 846 queued, 7 carry `requires`, 0 carry `pool`. `send_work` is the only writer of `requires`, so the
// backlog cannot be annotated, and a pool with no rows cannot be exercised. Before anyone converts a row,
// the operator needs the count of what is convertible and the reason each row is not — otherwise "pool the
// backlog" is a wish with no denominator.
//
// THE RULES THE CLASSIFIER ENCIDES, in the order they are applied (first match wins, so the arithmetic
// balances and one row never lands in two classes):
//   1. already-pooled   `pool: true` — provenance says it is already in the pool (P5/P7).
//   2. notice           a DONE/CANCELLED ack, not work. Pooling a notice would spawn a notice chain
//                       (ROADMAP 39) and a seat would claim an ack as a task.
//   3. blocked          a `blockedBy` gate, and a DEAD gate (one naming a cancelled row) is named as
//                       dead, because an open gate is recoverable and a dead one is not (#6215).
//   4. untiered-or-oversized  no tier -> the size gate has nothing to measure; tier estimate larger than
//                       70 % of EVERY declared usable window -> big-work-only, split before pooling (P6a).
//   5. single-owner     the proposed capability SET is advertised by the addressee alone — pooling it
//                       would put a one-seat job in a shared pool (this is the `code`-is-impl-only shape).
//   6. migratable       a queued, gated-clean, sized row whose SET is advertised by at least one seat
//                       OTHER than the addressee.
//
// OWNERSHIP GAP (the operator decision this tool exists to surface): `rig.selfdev.json`'s `ownership`
// maps an artifact CLASS to owner seats. `requires` is a capability test, not an ownership test, so a
// migratable row can be claimable by a seat the ownership map does not cover. Every migratable row that
// names an artifact path is checked against that map and the gap rows are listed by id. That list is a
// RULING REQUEST, not a defect to fix here: the roster is read-only to this instrument.
//
// WHAT IT NEVER DOES: no write path exists in this file. `--dry-run` is the only mode; `--apply` is
// rejected by name. The store is read through the broker seam when a broker is resident (D111), and
// falls back to a read-only open ONLY when no broker is alive or the broker answered nothing and no
// generation lease is live — src/readclient.mjs refuses a direct open otherwise and says why.
//
// Usage:
//   node tools/pool-migrate.mjs --dry-run [--db ./selfdev.sqlite] [--rig rig.selfdev.json]
//                                 [--limit 25] [--seat <name>] [--all] [--json <out.json>]
// Cost, measured on the 7,655-row store with no broker resident: see the `elapsed:` line it prints.
// Exit: 0 on a successful read; 1 if the store cannot be read or an argument is invalid.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { brokerAlive, readBrokerState } from "../src/broker.mjs";
import { tierTokenTable } from "../src/config.mjs";
import { deadGateIds, POOL_SIZE_GATE_FRACTION, requiredCapabilities, Seats } from "../src/rig.mjs";
import { poolCensus, readQueueItems, readSeatsDocument } from "../src/readapi.mjs";
import { readData } from "../src/readclient.mjs";

export const VERDICTS = ["already-pooled", "notice", "blocked", "unaddressed", "untiered-or-oversized", "single-owner", "migratable"];

/**
 * THE SHAPE TRAP, found on contact 2026-11-13 (measured: verdicts read 268 single-owner / 167
 * migratable with no broker resident, then 438 single-owner / 0 migratable through a resident broker —
 * the same store, the same rows, the only difference was which read served it).
 *
 * A resident broker serves the `seats` VIEW as `readSeatList` — an ARRAY of seat rows, no tier table.
 * The no-broker fallback is `readSeatsDocument` — `{found, value}` with the roster as an OBJECT keyed
 * by name. Reading one as the other silently empties the roster: `capsOf` then returns `[]` for every
 * seat, `others.length === 0` for every row, and the tool reports the whole backlog as single-owner
 * while printing a perfectly balanced arithmetic. A silently empty roster is worse than an error, so
 * BOTH shapes are normalized here, and the source is printed.
 */
export function rosterOf(doc) {
	if (Array.isArray(doc)) {
		const named = doc.filter((s) => s && s.name);
		return { seats: Object.fromEntries(named.map((s) => [s.name, s])), tierTokens: null, source: "seats view (list)" };
	}
	const value = doc && doc.found ? doc.value : doc;
	return { seats: value?.seats ?? {}, tierTokens: value?.tierTokens ?? null, source: "seats document" };
}

/** The artifact classes the rig's `ownership` block can name, matched from a path in the row's own text.
 *  This is a PROPOSAL, not a rig rule: there is no check rule for it yet, and the tool prints that in
 *  the report rather than pretending the mapping is settled. */
const ARTIFACT_CLASS = [
	[/\b(src|tools|scripts|demo)\/[A-Za-z0-9_./-]+/, "src-tools-harness"],
	[/\bdocs\/(FEATURES|MILESTONES|COMMANDS|QUICKSTART)[A-Za-z0-9_./-]*/, "feature-docs"],
	[/\bdocs\/[A-Za-z0-9_./-]+/, "workflow-docs"],
];

function artifactClass(item) {
	const text = `${item.subject ?? ""} ${item.body ?? ""}`;
	for (const [re, cls] of ARTIFACT_CLASS) if (re.test(text)) return cls;
	return null;
}

/**
 * The pure classification. Kept separate from I/O so a demo can drive EVERY verdict class with a fixture
 * and see the arithmetic balance, which is the only way to know the classes are not vacuous.
 */
export function poolProposal({ items = [], seats = {}, tierTokens = {}, fraction = POOL_SIZE_GATE_FRACTION, ownership = null }) {
	const seatNames = Object.keys(seats);
	const capsOf = (name) => (seats[name]?.capabilities ?? []);
	const queued = items.filter((it) => it.status === "queued");
	const windows = seatNames.map((n) => ({ name: n, usable: seats[n]?.usableWindow })).filter((s) => Number.isFinite(s.usable) && s.usable > 0);
	const largestWindow = windows.length ? Math.max(...windows.map((w) => w.usable)) : null;

	const rows = [];
	const by = Object.fromEntries(VERDICTS.map((v) => [v, 0]));
	for (const item of queued) {
		const dead = deadGateIds(item, items);
		const gates = Array.isArray(item.blockedBy) ? item.blockedBy : [];
		const proposed = requiredCapabilities(item.requires);
		const addressee = item.to ?? null;
		// When nothing is annotated yet, the honest proposal is the addressee's OWN capability set: that is
		// what the work demonstrably needs, and it is the smallest set that does not exclude the seat already
		// holding the row.
		const suggestion = proposed.length ? proposed : addressee ? capsOf(addressee) : [];
		const claimants = seatNames.filter((n) => suggestion.every((c) => capsOf(n).includes(c)));
		const others = claimants.filter((n) => n !== addressee);
		let verdict, reason;
		if (item.pool === true) {
			verdict = "already-pooled";
			reason = "already in the pool (pool: true); nothing to migrate";
		} else if (item.notice === true) {
			verdict = "notice";
			reason = "a protocol notice, not work; pooling it would spawn a notice chain (ROADMAP 39)";
		} else if (addressee === null) {
			verdict = "unaddressed";
			reason = "no addressee and no pool flag: no seat's claim path can reach it, so it is neither anyone's work nor pool work";
		} else if (dead.length) {
			verdict = "blocked";
			reason = `dead gate: #${dead.join(", #")} is cancelled and can never reach done, so the row is unclaimable whatever the pool says`;
		} else if (gates.length) {
			verdict = "blocked";
			reason = `gated on #${gates.join(", #")} — pool it only after the gate closes`;
		} else if (!item.tier) {
			verdict = "untiered-or-oversized";
			reason = "no tier: the 70 % size gate has nothing to measure, so a seat could take a row it cannot finish";
		} else if (largestWindow !== null && (tierTokens[item.tier] ?? 0) > fraction * largestWindow) {
			verdict = "untiered-or-oversized";
			reason = `tier ${item.tier} ≈ ${tierTokens[item.tier]} tokens exceeds ${Math.round(fraction * 100)} % of the largest declared window (${largestWindow}); split before pooling (P6a)`;
		} else if (largestWindow === null && item.tier === "project") {
			verdict = "untiered-or-oversized";
			reason = "tier project is bigger than every seat's budget by the shipped table, and no seat declares a usable window yet, so it would enter the pool ungated";
		} else if (others.length === 0) {
			verdict = "single-owner";
			reason = `only ${addressee ?? "(nobody)"} advertises [${suggestion.join(", ")}] on this roster; pooling it moves a one-seat job, it does not share it`;
		} else {
			verdict = "migratable";
			reason = `[${suggestion.join(", ")}] is advertised by ${claimants.length} seats (${claimants.join(", ")}) and tier ${item.tier} fits the declared windows`;
		}
		by[verdict] += 1;
		const cls = artifactClass(item);
		const owners = cls && ownership && Array.isArray(ownership[cls]) ? ownership[cls] : null;
		const gap = owners ? others.filter((n) => !owners.includes(n)) : [];
		rows.push({
			id: item.id,
			to: addressee,
			tier: item.tier ?? null,
			requires: suggestion,
			verdict,
			reason,
			claimants: others,
			artifact: cls,
			ownershipGap: gap.length ? gap : null,
		});
	}
	return {
		queued: queued.length,
		totalRows: items.length,
		by,
		balance: VERDICTS.reduce((a, v) => a + by[v], 0),
		rows,
		migratable: rows.filter((r) => r.verdict === "migratable"),
		// Only rows the tool actually proposes to pool can create an ownership problem, so the gap list is
		// scoped to migratable rows - counting a notice or a blocked row here would inflate the number the
		// operator has to rule on.
		gapRows: rows.filter((r) => r.verdict === "migratable" && r.ownershipGap?.length),
		seatsWithoutWindow: seatNames.filter((n) => !Number.isFinite(seats[n]?.usableWindow) || (seats[n]?.usableWindow ?? 0) <= 0),
		largestWindow,
		tierTokens,
		fraction,
	};
}

function hostLine() {
	// Never `uname -a`: it prints the hostname, and the operator ruled that the project must not
	// depend on a hostname (2026-11-04). OS + distro + kernel + node is the required shape.
	// Each piece is read on its own so one unreadable file cannot erase the whole line — the first
	// run of this tool printed "distro unknown" and no kernel because spawnSync returns a Buffer,
	// and Buffer has no .trim(): that threw into the catch and lost the kernel too.
	let pretty = "distro unknown";
	try {
		const osrel = readFileSync("/etc/os-release", "utf8");
		pretty = (osrel.match(/^PRETTY_NAME="([^"]+)"/m) ?? [])[1] || "distro unknown";
	} catch { /* /etc/os-release unreadable: distro is reported as unknown, kernel still printed */ }
	let kernel = "kernel unknown";
	try {
		const u = spawnSync("uname", ["-r"]);
		if (u.status === 0 && u.stdout) kernel = `kernel ${u.stdout.toString().trim()}`;
	} catch { /* spawnSync failed: reported, not swallowed */ }
	return `${process.platform} / ${pretty} / ${kernel} / node ${process.version}`;
}

function parseArgs(argv) {
	const out = { db: process.env.DURIG_DB || "./selfdev.sqlite", rig: "rig.selfdev.json", limit: 25, seat: null, all: false, json: null, dryRun: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--dry-run") { out.dryRun = true; continue; }
		if (a === "--all") { out.all = true; continue; }
		if (a.startsWith("--")) {
			const name = a.slice(2);
			if (!["db", "rig", "limit", "seat", "json"].includes(name)) throw new Error(`unknown argument: ${a} (known: --dry-run, --db, --rig, --limit, --seat, --all, --json)`);
			const value = argv[i + 1];
			if (value === undefined) throw new Error(`--${name} needs a value`);
			if (name === "limit") {
				out.limit = Number(value);
				if (!Number.isInteger(out.limit) || out.limit < 1) throw new Error("--limit must be a positive integer");
			} else out[name] = value;
			i += 1;
			continue;
		}
		throw new Error(`unexpected argument: ${a}`);
	}
	if (out.dryRun) return out;
	throw new Error("--dry-run is required; this instrument has no write mode by design");
}

async function main() {
	const started = Date.now();
	let args;
	try {
		args = parseArgs(process.argv.slice(2));
	} catch (err) {
		console.error(`pool-migrate: ${err.message}`);
		console.error("usage: node tools/pool-migrate.mjs --dry-run [--db <store>] [--rig <rigfile>] [--limit N] [--seat <name>] [--all] [--json <out>]");
		return 1;
	}

	const state = readBrokerState(args.db);
	const resident = brokerAlive(state);
	const readPath = resident ? `broker seam (pid ${state.pid})` : "no broker resident -> read-only open of the store";

	let items, seatsDoc, rigSpec;
	try {
		items = await readData(args.db, "queue", {}, (storage) => readQueueItems(storage));
		// The DOCUMENT view, not the `seats` list view: this tool needs `tierTokens` and each seat's
		// `usableWindow`, and the list view carries neither. `readSeatsDocument` remains the fallback for
		// the no-broker path (src/readclient.mjs chooses).
		seatsDoc = await readData(
			args.db,
			"document",
			{ kind: Seats.definition.kind, scope: { kind: "session" } },
			(storage) => readSeatsDocument(storage),
		);
	} catch (err) {
		console.error(`pool-migrate: cannot read ${args.db}: ${err.message}`);
		console.error("If the broker is wedged, copy the store and run against the copy: cp selfdev.sqlite /tmp/pool-audit.sqlite");
		return 1;
	}

	const roster = rosterOf(seatsDoc);
	const seats = roster.seats;
	const tierTokens = roster.tierTokens ?? tierTokenTable();
	let ownership = null;
	const rigPath = resolve(args.rig);
	if (existsSync(rigPath)) {
		try {
			rigSpec = JSON.parse(readFileSync(rigPath, "utf8"));
			ownership = rigSpec?.ownership ?? null;
		} catch (err) {
			console.error(`pool-migrate: ${args.rig} unreadable (${err.message}); ownership check SKIPPED, not silently passed`);
		}
	} else {
		console.log(`ownership check: SKIPPED - ${args.rig} not found; the roster is read from the store, not from a rig file`);
	}

	const proposal = poolProposal({ items, seats, tierTokens, fraction: POOL_SIZE_GATE_FRACTION, ownership });
	const census = poolCensus(items, Object.entries(seats).map(([name, s]) => ({ name, usableWindow: s?.usableWindow })), tierTokens, POOL_SIZE_GATE_FRACTION);

	const rowsToShow = args.seat ? proposal.rows.filter((r) => r.to === args.seat) : proposal.rows;
	const shown = args.all ? rowsToShow : rowsToShow.slice(0, args.limit);

	console.log("pool-migrate --dry-run (READ-ONLY: this tool has no write path)");
	console.log(`store: ${args.db}   read via: ${readPath}`);
	console.log(`host: ${hostLine()}`);
	console.log(`tier table in force: ${JSON.stringify(tierTokens)}   gate: ${Math.round(POOL_SIZE_GATE_FRACTION * 100)}% of the usable window`);
	console.log("");
	console.log(`roster: ${Object.keys(seats).length} seats, from ${roster.source}${roster.tierTokens ? " (tier table from the roster)" : " (tier table: the shipped default — the serving view carried no tier table)"}`);
	console.log(`rows read: ${proposal.totalRows}   queued: ${proposal.queued}   pool census (same read): ${census.rows} pooled, ${census.open} open, ${census.claimed} claimed, ${census.sizeRefused} size-refused, seats without a declared window: ${census.seatsWithoutWindow.length}`);
	console.log("");
	console.log(`verdicts over the ${proposal.queued} queued rows (first match wins, so each row is in exactly one class):`);
	for (const v of VERDICTS) console.log(`  ${String(proposal.by[v]).padStart(6)}  ${v}`);
	console.log(`  ------\n  ${String(proposal.balance).padStart(6)}  sum of classes`);
	console.log(`  balance: ${proposal.balance === proposal.queued ? "OK (classes sum to the queued count)" : `MISMATCH (${proposal.balance} vs ${proposal.queued}) — report this, do not trust the numbers`}`);
	console.log("");
	console.log(`largest declared usable window: ${proposal.largestWindow ?? "none declared — the size gate is disarmed until `up --refresh` records windows"}`);
	if (proposal.seatsWithoutWindow.length) console.log(`seats with no declared window (${proposal.seatsWithoutWindow.length}): ${proposal.seatsWithoutWindow.join(", ")}`);
	console.log("");
	const gapByClass = {};
	for (const r of proposal.gapRows) gapByClass[r.artifact] = (gapByClass[r.artifact] ?? 0) + 1;
	console.log(`ownership check (${ownership ? `${Object.keys(ownership).length} classes in ${args.rig}` : "SKIPPED - no ownership block in the rig file"}): ${proposal.gapRows.length} of ${proposal.migratable.length} proposed pool rows have a claimant the ownership map does NOT list for the artifact the row names (${Object.entries(gapByClass).map(([c, n]) => `${c}: ${n}`).join(", ") || "none"})`);
	if (proposal.gapRows.length) {
		const first = proposal.gapRows.slice(0, args.limit);
		for (const r of first) console.log(`  gap #${r.id} to=${r.to} artifact=${r.artifact} proposed claimant(s) NOT in the owner list: ${r.ownershipGap.join(", ")}`);
		if (proposal.gapRows.length > first.length) console.log(`  ... ${proposal.gapRows.length - first.length} more gap rows in the --json artifact`);
	}
	console.log("");
	console.log(`rows shown: ${shown.length} of ${rowsToShow.length} (${args.all ? "all" : `--limit ${args.limit}`}; pass --all for every row)`);
	for (const r of shown) console.log(`  #${r.id} to=${r.to ?? "POOL"} tier=${r.tier ?? "-"} requires=[${r.requires.join(",")}] verdict=${r.verdict} :: ${r.reason}`);
	if (args.json) {
		writeFileSync(args.json, JSON.stringify({ host: hostLine(), readPath, tierTokens, census, proposal, elapsedSeconds: (Date.now() - started) / 1000 }, null, 1), "utf8");
		console.log(`\nproposal written to ${args.json} (an output artifact the operator asked for; the store is untouched)`);
	}
	console.log(`elapsed: ${((Date.now() - started) / 1000).toFixed(1)} s`);
	return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
	main().then((code) => process.exit(code)).catch((err) => {
		console.error("pool-migrate failed:", err?.message ?? err);
		process.exit(1);
	});
}
