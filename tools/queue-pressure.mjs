#!/usr/bin/env node
// tools/queue-pressure.mjs — "is the queue manageable, and is it growing?" in ONE bounded call.
//
// TRIGGER (the symptom that loads this instrument): `cli.mjs watch` prints a queue number that looks
// overwhelming, or a session is about to route more work and needs to know whether the backlog is already
// outrunning the fleet.
//
// WHAT IT ANSWERS, each a measurement with its predicate named:
//   1. the live-row split: WORK vs NOTICE vs REGISTRATION (src/queueclass.mjs is the ONE predicate);
//   2. the age of the live rows, and where the old mass actually sits;
//   3. the mint-vs-close RATE over a window — the honest answer to "is the backlog growing";
//   4. open work per seat against fleet capacity, and the BAND verdict;
//   5. a PLAN for `pm` to execute: the notices to acknowledge and the registrations to move to the ledger.
//      This tool TRANSITIONS NOTHING — queue transitions are `pm`'s ActiveRecord verbs
//      (docs/runbooks/stale-held-backlog.md), and a delegate does not route rows (AGENTS.md).
//
// Exact command (the cost is printed at the end):
//   DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs
//   node tools/queue-pressure.mjs --db ./selfdev.sqlite --window-days 7 --band-per-seat 10 [--json out.json]
//   node tools/queue-pressure.mjs --snapshot .spike/queue-raw.json   # a `cli.mjs queue --json --no-body` capture, ~0.5 s
//
// Exit code: 0 when open work is inside the band AND the window is not growing past the fleet; 1 otherwise. A
// window "growing past the fleet" means it net-grew by at least ONE FULL FLEET BAND (src/queueclass.mjs
// pressureVerdict) — a net +4 on a two-seat rig is a Tuesday, not a crisis. That is the gate — "the backlog is
// growing" becomes a measured verdict that fails, not prose — and `check`'s queue-pressure rule reads the SAME
// function, so the two cannot disagree.
//
// Measured cost, re-run before quoting: 2.2 s against the live store (the queue read is the whole cost);
// 0.9 s against a snapshot capture. Host it was first measured on: Linux, Fedora Linux 45 (Forty Five), kernel
// 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0. `last_verified: 2026-11-15` by
// `DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs` (exit 1 — the store IS out of band, which is the
// point: a 0 would mean the gate found nothing to say).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { ageBuckets, classifyRow, pressureVerdict, queueShape } from "../src/queueclass.mjs";
import { queuePressureSettings } from "../src/config.mjs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const DB = opt("db", process.env.DURIG_DB || "./selfdev.sqlite");
const SNAPSHOT = opt("snapshot", null);
const OUT = opt("json", null);
const WINDOW_DAYS = Math.max(1, Number(opt("window-days", 7)) || 7);
const settings = queuePressureSettings();
const BAND = opt("band-per-seat", undefined) === undefined ? settings.bandPerSeat : Number(opt("band-per-seat"));

const t0 = Date.now();

function decodeCliJson(text) {
	// `cli.mjs queue --json` is not pure JSON on stdout (a spend line prints at every start, #5047), so a
	// whole-file parse dies on "Extra data". Same decoder tools/queue-drain-audit.mjs uses.
	const at = text.indexOf("{");
	if (at < 0) throw new Error("queue output has no JSON object");
	return JSON.parse(text.slice(at, text.lastIndexOf("}") + 1));
}

function readRows() {
	if (SNAPSHOT) {
		// A snapshot file must be a QUEUE CAPTURE, not this tool's own report — `--json out.json` writes the
		// report, `--snapshot` reads a capture. Pointing one at the other used to die as a TypeError three
		// frames deep; the refusal now names the capture command so the reader can fix it without reading code.
		const snap = decodeCliJson(readFileSync(SNAPSHOT, "utf8"));
		if (!Array.isArray(snap.items)) throw new Error(`snapshot ${SNAPSHOT} has no items[] — it must be a queue capture: DURIG_DB=<store> node cli.mjs queue --json --no-body > <file>`);
		return snap.items;
	}
	const r = spawnSync(process.execPath, ["cli.mjs", "queue", "--json", "--no-body"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, DURIG_DB: DB },
	});
	if (r.status !== 0) throw new Error(`cli.mjs queue failed: ${String(r.stderr || "").slice(0, 400)}`);
	return decodeCliJson(r.stdout).items;
}

function readSeats() {
	const r = spawnSync(process.execPath, ["cli.mjs", "ps", "--json"], {
		encoding: "utf8",
		maxBuffer: 8 * 1024 * 1024,
		env: { ...process.env, DURIG_DB: DB },
	});
	if (r.status !== 0) return [];
	try {
		return (decodeCliJson(r.stdout).seats ?? []).map((s) => s.name);
	} catch {
		return [];
	}
}

function hostLine() {
	// Hostname-free on purpose (operator ruling 2026-11-04): OS + distro + kernel + node, never user@hostname.
	const u = spawnSync("uname", ["-s"], { encoding: "utf8" }).stdout?.trim() || "unknown";
	const k = spawnSync("uname", ["-r"], { encoding: "utf8" }).stdout?.trim() || "unknown";
	let distro = "unknown";
	try {
		const rel = readFileSync("/etc/os-release", "utf8");
		distro = (rel.match(/^PRETTY_NAME="([^"]+)"/m) ?? [])[1] ?? "unknown";
	} catch {
		/* non-Fedora hosts: the OS and kernel still name the box adequately */
	}
	return `${u}, ${distro}, kernel ${k}, node ${process.version}`;
}

const items = readRows();
const shape = queueShape(items);
const seats = readSeats();
const verdict = pressureVerdict(shape, items, { perSeat: BAND, seats: seats.length, windowDays: WINDOW_DAYS });
const { band, burn } = verdict;
const ages = ageBuckets(items.filter((it) => !["done", "cancelled"].includes(it.status)));
const oldest = items
	.filter((it) => !["done", "cancelled"].includes(it.status))
	.map((it) => ({ id: it.id, status: it.status, to: it.to, opened: (it.transitions ?? []).find((t) => t.event === "queued")?.at, subject: String(it.subject ?? "").slice(0, 60) }))
	.filter((r) => r.opened)
	.sort((a, b) => Date.parse(a.opened) - Date.parse(b.opened))
	.slice(0, 10);

const report = {
	host: hostLine(),
	rows: shape.rows,
	live: shape.live,
	split: { work: shape.work, notice: shape.notice, registration: shape.registration },
	workByStatus: shape.workByStatus,
	noticeByStatus: shape.noticeByStatus,
	registrationByStatus: shape.registrationByStatus,
	queuedWork: shape.queuedWork,
	awaitingOperator: shape.awaitingOperator,
	agesOfLiveRows: ages,
	window: burn,
	pressure: { fail: verdict.fail, reasons: verdict.reasons, growthFloor: verdict.growthFloor },
	band,
	openWorkBySeat: shape.openWorkBySeat,
	oldestLiveRows: oldest,
	fleet: seats,
	plan: {
		acknowledgeNotices: { count: shape.notice, ids: items.filter((it) => !["done", "cancelled"].includes(it.status) && classifyRow(it) === "notice").map((it) => it.id) },
		moveRegistrationsToLedger: { count: shape.registration, ids: items.filter((it) => !["done", "cancelled"].includes(it.status) && classifyRow(it) === "registration").map((it) => it.id) },
		verb: "node intent.mjs queue --op queue --action acknowledge-notices --from delegate --apply --confirm",
		note: "this tool plans; pm applies. Queue transitions are pm's ActiveRecord verbs.",
	},
	costMs: Date.now() - t0,
};

if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2));

const line = (s) => console.log(s);
line(`queue pressure — ${DB} — window ${WINDOW_DAYS} d — band ${band.perSeat}/seat × ${band.seats} seats = ${band.limit}`);
line(`  rows ${shape.rows} · live ${shape.live} = work ${shape.work} + notice ${shape.notice} + registration ${shape.registration}`);
line(`  work      ${JSON.stringify(shape.workByStatus)}   (queued ${shape.queuedWork} is the claim lane)`);
line(`  notice    ${JSON.stringify(shape.noticeByStatus)}   — a protocol ack, not work (ROADMAP 39)`);
line(`  reg       ${JSON.stringify(shape.registrationByStatus)}   — ROADMAP ledger copies parked in the queue`);
line(`  ages of live rows: ${Object.entries(ages).map(([k, v]) => `${k}=${v}`).join(" ")}`);
line(`  mint ${burn.minted} (${burn.mintedWork} work, ${burn.mintedNotice} notice) vs close ${burn.closed} (${burn.closedWork} work, ${burn.closedNotice} notice) -> net ${burn.netOpen > 0 ? "+" : ""}${burn.netOpen} (${burn.perDay.minted}/d minted, ${burn.perDay.closed}/d closed, ${burn.perDay.netOpen}/d net): ${burn.verdict}`);
line(`  awaiting operator: ${shape.awaitingOperator} work rows parked on a human answer`);
line(`  open work per seat: ${Object.entries(shape.openWorkBySeat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" ")}`);
line(`  oldest live rows: ${oldest.slice(0, 5).map((r) => `#${r.id} ${r.status}`).join(" | ")}`);
line(`  verdict: ${verdict.fail ? `FAIL — ${verdict.reasons.join(" · ")}` : `inside band (${band.open} open work vs ${band.limit}) and not growing past the fleet (net ${burn.netOpen >= 0 ? "+" : ""}${burn.netOpen} vs a floor of ${verdict.growthFloor})`}`);
line(`  cost: ${report.costMs / 1000} s · host: ${report.host}`);
line(`  plan for pm: ${report.plan.acknowledgeNotices.count} notices to acknowledge, ${report.plan.moveRegistrationsToLedger.count} registrations to move to docs/ROADMAP.md`);
line(`  verb: ${report.plan.verb}  (${report.plan.note})`);

process.exit(verdict.fail ? 1 : 0);
