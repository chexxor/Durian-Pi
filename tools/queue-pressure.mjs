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
//   6. "is the mint-time fan-out budget BITING?" — `mintGate` (src/rig.mjs) refuses a mint and `recordMintRefusal`
//      records it, so the count of refusals in the window, by kind (burst / lineage / duplicate), on which seat,
//      and the newest one, is printed here. A refusal with no read path is a cap that gets quietly raised
//      (#3486 written-and-never-read, ROADMAP 272 inert-default): the ledger is bounded at MINT_REFUSAL_LEDGER_CAP
//      events by the WRITER, so when it is full this line says the total is a FLOOR, not a count.
//   7. `--price-budget` — "is the budget PRICED, or is it an outage?" A recorded refusal says the gate fired;
//      it never says whether the cap that fired is sized to the fleet. Replay the mints THIS STORE recorded
//      inside the window through the shipped rules (`mintGate`'s precedence: duplicate, then burst, then lineage;
//      notices and parked rows exempt) and count what each rule WOULD have refused. Measured 2026-11-15 on this
//      rig: the burst cap (100/seat/7 d) would have refused 506 of 1,153 real work mints (43.9%) — WINDOW-RELATIVE,
//      the pair slides by the MINUTE (two calls minutes apart read 519/1,147 then 516/1,144, and 523/1,153 in an
//      earlier window: see docs/runbooks/session-start-cost.md §35); at this fleet's
//      fan-out rate 100 is not a pathological-fan-out stop, it is a halt on real work; the lineage rule refused
//      6 (0.5%), i.e. it is priced. A cap nobody can price is the same class of lie as a limit nobody reads.
//
// Exact command (the cost is printed at the end):
//   DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs
//   node tools/queue-pressure.mjs --db ./selfdev.sqlite --window-days 7 --band-per-seat 10 [--json out.json]
//   node tools/queue-pressure.mjs --snapshot .spike/queue-raw.json   # a `cli.mjs queue --json --no-body` capture, ~0.5 s
//   DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs --price-budget   # + the budget back-test: 3.3 s, and
//      a SECOND bounded read (`cli.mjs queue --json`, bodies, ~32 MB) because the whole-document form carries no
//      mintRefusals census; `--mint-burst-cap <n>` prices a candidate cap and prints it as an OVERRIDE.
//
// Exit code: 0 when open work is inside the band AND the window is not growing past the fleet; 1 otherwise. A
// window "growing past the fleet" means it net-grew by at least ONE FULL FLEET BAND (src/queueclass.mjs
// pressureVerdict) — a net +4 on a two-seat rig is a Tuesday, not a crisis. That is the gate — "the backlog is
// growing" becomes a measured verdict that fails, not prose — and `check`'s queue-pressure rule reads the SAME
// function, so the two cannot disagree. The mint-refusal line does NOT change this verdict: a refusal is the gate
// WORKING (it stopped a mint), not pressure; only a saturated ledger changes what the number means (FLOOR vs count).
//
// Measured cost, re-run before quoting: 1.3-2.0 s against the live store (the queue read is the whole cost; the
// `mintRefusals` census adds ~436 B to that read, not a second read); 0.5-0.9 s against a snapshot capture;
// 2.6-3.4 s with `--price-budget` (the bodies-carrying read is 1.3 s / ~32 MB of it). Host it was first measured
// on: Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0. `last_verified:
// 2026-11-15` by
// `DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs` (exit 1 — the store IS out of band, which is the
// point: a 0 would mean the gate found nothing to say) and by
// `node demo/queue-pressure.test.mjs` (exit 0 / 67 checks / 7.8 s, `.err` 0 bytes — the demo grew from 43 checks
// when the mint-refusal read path landed (55) and again for the budget back-test (67); nothing pinned before was
// dropped) and by `DURIG_DB=./selfdev.sqlite node tools/queue-pressure.mjs --price-budget` (exit 1, 3.3 s).

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { ageBuckets, classifyRow, pressureVerdict, queueShape, mintRefusalCensus, bandVerdict, isNoticeItem, isTerminalRow, mintedBySeat, NORMALIZE_SUBJECT, lineageOf } from "../src/queueclass.mjs";
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
const CAP = opt("mint-burst-cap", undefined) === undefined ? settings.mintBurstCap : Number(opt("mint-burst-cap"));
const CAP_OVERRIDE = opt("mint-burst-cap", undefined) !== undefined;
// `--mint-burst-cap` exists for the back-test: pricing a knob means ASKING what a different cap would have
// refused, and the knob itself is the operator's to raise (src/config.mjs) — so the tool states the rig's own
// cap and says when the run overrode it, rather than pretending an override is the fleet's setting.
// `--price-budget` asks the OTHER question about the same knobs: not "did the gate bite" (the ledger above)
// but "is the cap sized to this fleet". It is a COUNTERFACTUAL over the mints the store recorded, so it never
// changes the exit code — the verdict stays the band/growth verdict, and a priced budget is not pressure.
const PRICE = argv.includes("--price-budget");

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
		return { form: "snapshot", ms: 0, payload: snap };
	}
	const r = spawnSync(process.execPath, ["cli.mjs", "queue", "--json", "--no-body"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, DURIG_DB: DB },
	});
	if (r.status !== 0) throw new Error(`cli.mjs queue failed: ${String(r.stderr || "").slice(0, 400)}`);
	return { form: "no-body", ms: 0, payload: decodeCliJson(r.stdout) };
}

// THE BODIES READ — only `--price-budget` pays it. `cli.mjs queue --json` with no other flag is the whole-document
// form, deliberately unchanged bytes (#5016: `{ok, command, items}`), so it carries NO `mintRefusals` census; the
// `--no-body` read above is the one that does. Two bounded reads, each named, rather than a second spelling of the
// base view — the cost is printed with the rest.
function readBodies() {
	const tR = Date.now();
	const r = spawnSync(process.execPath, ["cli.mjs", "queue", "--json"], {
		encoding: "utf8",
		maxBuffer: 256 * 1024 * 1024,
		env: { ...process.env, DURIG_DB: DB },
	});
	if (r.status !== 0) throw new Error(`cli.mjs queue --json (bodies) failed: ${String(r.stderr || "").slice(0, 400)}`);
	return { ms: Date.now() - tR, bytes: r.stdout.length, items: decodeCliJson(r.stdout).items };
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

const read = readRows();
const payload = read.payload;
// The back-test reads row TEXT, so it wants the bodies; the census (`mintRefusals`) only exists on the
// `--no-body` form. `--price-budget` takes the row set from the bodies read when it paid one, and says so.
const bodies = PRICE && !SNAPSHOT ? readBodies() : null;
const items = bodies ? bodies.items : payload.items;
const bodiesRead = items.some((it) => String(it?.body ?? "") !== "");
// THE FAN-OUT BUDGET, from the SAME read as the rows: `cli.mjs queue --json --no-body` carries `mintRefusals`
// — the CENSUS src/queueclass.mjs derives. A plain ARRAY is the RAW ledger (an older view, or a capture taken
// from `readQueueMintRefusals`), so it goes through the SAME function; a missing key means the read path is not
// in this build, which is stated rather than scored as "zero refusals" (UNKNOWN is not NONE, #3539).
const refusals = (() => {
	const raw = payload.mintRefusals;
	if (Array.isArray(raw)) return mintRefusalCensus(raw, { windowDays: WINDOW_DAYS });
	if (raw && typeof raw === "object") {
		const c = { ...raw };
		if (c.windowDays !== WINDOW_DAYS) c.windowMismatch = `${c.windowDays} d (the view's census) vs ${WINDOW_DAYS} d (this run)`;
		return c;
	}
	return null;
})();
const shape = queueShape(items);
const seats = readSeats();
const verdict = pressureVerdict(shape, items, { perSeat: BAND, seats: seats.length, windowDays: WINDOW_DAYS });
const { band, burn } = verdict;
const ages = ageBuckets(items.filter((it) => !["done", "cancelled"].includes(it.status)));
// THE BUDGET BACK-TEST — the counterfactual, on the delegate plane, over the SHIPPED predicates.
// Precedence mirrors `mintGate` (src/rig.mjs): duplicate, then burst, then lineage. A mint the replay refuses
// creates no row, so the per-seat burst counter only counts mints the replay ALLOWED — that is the honest
// counterfactual ("if the gate had been armed all window"), not a count of rows that exist. Two approximations
// are stated rather than hidden: a duplicate whose twin sits OUTSIDE the window is not counted (a lower bound),
// and a row that is still `held` now is read as "was minted parked", which is what the mint gate exempted.
function priceBudget(rows) {
	const firstQueued = (it) => (it.transitions ?? []).find((t) => t.event === "queued")?.at ?? null;
	const cut = Date.now() - WINDOW_DAYS * 86400000;
	const minted = rows
		.filter((it) => {
			const at = firstQueued(it);
			return at && Date.parse(at) >= cut;
		})
		.map((it) => ({ it, at: Date.parse(firstQueued(it)) }))
		.sort((a, b) => a.at - b.at);
	const band = seats.length > 0 ? bandVerdict(queueShape(rows), { perSeat: BAND, seats: seats.length }) : null;
	const armed = {};
	const seenSubject = new Map();
	const out = {
		windowDays: WINDOW_DAYS,
		cap: CAP,
		capOverride: CAP_OVERRIDE,
		rigCap: settings.mintBurstCap,
		work: 0,
		exempt: { notice: 0, held: 0 },
		refused: { burst: 0, lineage: 0, duplicate: 0 },
		allowed: 0,
		bySeat: {},
		perSeatWindow: mintedBySeat(rows, { windowDays: WINDOW_DAYS }) ?? {},
		bodiesRead,
	};
	for (const { it } of minted) {
		if (isNoticeItem(it)) {
			out.exempt.notice += 1;
			continue;
		}
		if (it.status === "held") out.exempt.held += 1;
		out.work += 1;
		const seat = it.to ?? "?";
		const key = `${seat}\u0000${NORMALIZE_SUBJECT(it.subject ?? "")}`;
		const dupOf = seenSubject.get(key);
		armed[seat] = armed[seat] ?? 0;
		let verdict = "allowed";
		if (dupOf && !isTerminalRow(it) && !isTerminalRow(dupOf)) verdict = "duplicate";
		else if (armed[seat] >= CAP) verdict = "burst";
		else if (band && !band.inside && !lineageOf(it)) verdict = "lineage";
		if (verdict === "allowed") {
			out.allowed += 1;
			armed[seat] += 1;
			seenSubject.set(key, it);
		} else {
			out.refused[verdict] += 1;
		}
		const b = (out.bySeat[seat] ??= { allowed: 0, burst: 0, lineage: 0, duplicate: 0 });
		b[verdict] += 1;
	}
	out.refusedTotal = out.refused.burst + out.refused.lineage + out.refused.duplicate;
	out.share = out.work ? Math.round((out.refusedTotal / out.work) * 1000) / 10 : 0;
	out.bandArmed = band ? !band.inside : null;
	out.perSeatWindowSorted = Object.entries(out.perSeatWindow).sort((a, b) => b[1] - a[1]);
	out.busiestSeat = out.perSeatWindowSorted[0] ?? null;
	out.seatsAtOrOverCap = out.perSeatWindowSorted.filter(([, n]) => n >= CAP).map(([s, n]) => `${s}=${n}`);
	out.lineageMeasuredOver = bodiesRead ? "subject+body" : "SUBJECT TEXT ONLY (bodies omitted by this capture)";
	return out;
}
const price = PRICE ? priceBudget(items) : null;

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
	read: {
		form: read.form,
		bodiesRead: bodies ? `second read (cli.mjs queue --json, ${bodies.ms} ms, ${(bodies.bytes / 1048576).toFixed(1)} MB)` : `the capture/store read above (bodies ${bodiesRead ? "present" : "OMITTED"})`,
	},
	mintRefusals: refusals,
	mintBudgetPrice: price,
	mintRefusalPlan: refusals
		? {
				inWindow: refusals.inWindow,
				byKind: refusals.inWindowByKind,
				busiestSeat: Object.entries(refusals.bySeat).sort((a, b) => b[1] - a[1])[0] ?? null,
				note: "the gate REFUSED these mints; nothing to retire. If the refusals are the whole story, the fleet is being asked for too much fan-out — the knobs are DURIG_MINT_BURST_CAP / DURIG_BAND_PER_SEAT / DURIG_PRESSURE_WINDOW_DAYS, and the operator owns raising them.",
			}
		: { inWindow: null, note: "the queue view carried no mintRefusals field — the read path is missing on this build" },
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
line(`  mint refusals: ${refusals ? `${refusals.inWindow} in ${refusals.windowDays} d (burst ${refusals.inWindowByKind.burst}, lineage ${refusals.inWindowByKind.lineage}, duplicate ${refusals.inWindowByKind.duplicate}) of ${refusals.ledger} on the ledger${refusals.saturated ? ` — BOUNDED at ${refusals.cap}, so the total is a FLOOR not a count` : ""}${refusals.newest ? `; newest ${refusals.newest.at} ${refusals.newest.kind} ${refusals.newest.by ?? "?"}->${refusals.newest.to ?? "?"}` : ""}${refusals.windowMismatch ? ` (window ${refusals.windowMismatch})` : ""}` : `NOT MEASURED — the queue view carried no mintRefusals field, so the fan-out budget's record has no read path in this build (src/readapi.mjs readQueueCensus)`}`);
if (price) {
	line(`  mint-budget PRICE (counterfactual — what the caps WOULD have refused among the mints this store recorded; the line above is what it DID refuse):`);
	line(`    work mints in the ${price.windowDays} d window replayed: ${price.work} (exempt: ${price.exempt.notice} notice, ${price.exempt.held} parked) · read: ${PRICE && !SNAPSHOT ? `bodies INCLUDED — a second bounded read (cli.mjs queue --json, ${bodies.ms} ms, ${(bodies.bytes / 1048576).toFixed(1)} MB); the mintRefusals census came from the --no-body read above` : `bodies ${price.bodiesRead ? "present in the capture" : "OMITTED — the lineage leg was measured over SUBJECT TEXT ONLY (a bound, not the number)"}`}`);
	line(`    would have refused ${price.refusedTotal} of ${price.work} (${price.share}%): burst ${price.refused.burst}, lineage ${price.refused.lineage}, duplicate ${price.refused.duplicate} · allowed ${price.allowed}`);
	line(`    mints per seat inside the window (the shipped mintedBySeat): ${price.perSeatWindowSorted.map(([s, n]) => `${s}=${n}`).join(" ")} · at/over the ${price.cap} cap: ${price.seatsAtOrOverCap.length ? price.seatsAtOrOverCap.join(" ") : "none"}`);
	line(`    knob reading: the rig's DURIG_MINT_BURST_CAP is ${settings.mintBurstCap}${CAP_OVERRIDE ? ` (this run priced ${CAP} as an OVERRIDE for the back-test, not the fleet's setting)` : ""} vs busiest seat's window fan-out ${price.busiestSeat ? `${price.busiestSeat[0]}=${price.busiestSeat[1]}` : "?"} — a cap BELOW that number stops real work, not pathological fan-out; the band ${band.perSeat}/seat is the CHECK signal and is a different knob. Raising either is the operator's (src/config.mjs).`);
	line(`    the lineage rule was ARMED (band ${band.open} open vs ${band.limit}) and refused ${price.refused.lineage} of ${price.work} real mints; no roster means NOT MEASURED, not unarmed`);
}
line(`  verdict: ${verdict.fail ? `FAIL — ${verdict.reasons.join(" · ")}` : `inside band (${band.open} open work vs ${band.limit}) and not growing past the fleet (net ${burn.netOpen >= 0 ? "+" : ""}${burn.netOpen} vs a floor of ${verdict.growthFloor})`}`);
line(`  cost: ${report.costMs / 1000} s · host: ${report.host}`);
line(`  plan for pm: ${report.plan.acknowledgeNotices.count} notices to acknowledge, ${report.plan.moveRegistrationsToLedger.count} registrations to move to docs/ROADMAP.md`);
line(`  verb: ${report.plan.verb}  (${report.plan.note})`);

process.exit(verdict.fail ? 1 : 0);
