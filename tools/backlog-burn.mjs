#!/usr/bin/env node
// tools/backlog-burn.mjs — is the backlog actually shrinking, and at what rate?
//
// WHY THIS EXISTS (measured 2026-11-12, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64,
// node v24.22.1, git 2.56.0 — re-measure before quoting): `cli.mjs status` and
// `tools/queue-drain-audit.mjs` give a single census — a snapshot with no direction. The operator's
// directive "finish the backlog" is a RATE question: rows close while new rows are minted, so a
// fleet can be busy every minute and still grow. tools/broker-keepalive.mjs already appends a queue
// snapshot every 10th tick to its ledger, so the rate is already recorded; this tool reads it back.
//
// Trigger symptom: "the team is busy but the queue never empties / nothing is ever finished".
// Cost: < 1 s (one read of the JSONL ledger, no store open, no git).
// Exit codes: 0 = read OK; 2 = usage / no queue snapshots in the ledger.
//
// usage:
//   node tools/backlog-burn.mjs [--ledger .spike/fleet-ledger.jsonl] [--hours N]
//
// Reads lines that carry a `queue` object (keepalive ticks). Prints the first/last snapshot, the
// delta per hour for each state, the intake-vs-close verdict, and the ref/worktree trend.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, "..");

function arg(name, fallback) {
	const i = process.argv.findIndex((a) => a === name || a.startsWith(name + "="));
	if (i < 0) return fallback;
	return process.argv[i].includes("=") ? process.argv[i].split("=")[1] : process.argv[i + 1];
}

const ledger = arg("--ledger", join(REPO, ".spike", "fleet-ledger.jsonl"));
const hours = Number(arg("--hours", 0));

let lines;
try {
	lines = readFileSync(ledger, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
} catch (e) {
	console.error(`cannot read ledger ${ledger}: ${e.message}`);
	process.exit(2);
}

const snaps = lines.filter((l) => l.queue);
if (!snaps.length) {
	console.error(`no queue snapshots in ${ledger} — run tools/broker-keepalive.mjs --once first`);
	process.exit(2);
}

const cut = hours > 0 ? Date.now() - hours * 3600 * 1000 : 0;
const win = snaps.filter((s) => new Date(s.at).getTime() >= cut);
const first = win[0];
const last = win[win.length - 1];
const mins = (new Date(last.at) - new Date(first.at)) / 60000;
const perHour = (delta) => (mins > 0 ? delta / (mins / 60) : 0);
const STATES = ["done", "cancelled", "held", "deferred", "claimed", "queued"];
const total = (q) => STATES.reduce((a, k) => a + (q[k] ?? 0), 0);

console.log(
	`backlog burn ${first.at} -> ${last.at}  (${snaps.length} queue snapshots in window, ${win.length} used, span ${Math.round(mins)} min)`
);
console.log(`  ledger ${ledger}`);
for (const k of STATES) {
	const d = (last.queue[k] ?? 0) - (first.queue[k] ?? 0);
	console.log(`  ${k.padEnd(10)} ${first.queue[k] ?? 0} -> ${last.queue[k] ?? 0}   delta ${d >= 0 ? "+" : ""}${d}   ${perHour(d).toFixed(1)}/h`);
}
const rowsDelta = total(last.queue) - total(first.queue);
const closedDelta = (last.queue.done ?? 0) + (last.queue.cancelled ?? 0) - ((first.queue.done ?? 0) + (first.queue.cancelled ?? 0));
const openDelta = (last.queue.queued ?? 0) + (last.queue.claimed ?? 0) + (last.queue.held ?? 0) + (last.queue.deferred ?? 0) -
	((first.queue.queued ?? 0) + (first.queue.claimed ?? 0) + (first.queue.held ?? 0) + (first.queue.deferred ?? 0));
console.log(`  verdict: ${closedDelta} rows closed, ${openDelta >= 0 ? "+" : ""}${openDelta} open rows in the window -> backlog ${openDelta > 0 ? "GROWING" : openDelta < 0 ? "shrinking" : "flat"}`);
console.log(`  refs ${first.refs} -> ${last.refs} (${last.refs - first.refs}), worktrees ${first.worktrees} -> ${last.worktrees} (${last.worktrees - first.worktrees})`);
if (last.mainSha) console.log(`  main ${first.mainSha} -> ${last.mainSha}${first.mainSha === last.mainSha ? "  (NOT MOVING: nothing landed)" : "  (moving: landings happened)"}`);
