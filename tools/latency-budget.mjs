#!/usr/bin/env node
// Delegate instrument — where this rig's WALL-CLOCK actually goes.
//
// Why this exists: every prior session reasoned about "the loop is slow" from prose (model tok/s, the
// 5-minute degeneration bound, the 41 s suite). None of that was measured against the two currencies the
// rig really spends: (1) ITEM latency — the time a queue row spends waiting, worked, and held, which is
// persisted in `queueItems[].transitions`; and (2) MACHINE time — the duration of every generation, tool
// call and compaction, which is persisted in `tasks.record.startedAt/endedAt`. This prints both, with the
// thresholds it counted, because a count with no pattern is not evidence (D142).
//
// Read-only. It opens the store `readOnly:true` and runs `cli.mjs status` (a viewer: viewers never wake a
// seat, D11). It quotes no message body.
//
//   node tools/latency-budget.mjs --db ./selfdev.sqlite [--rig rig.selfdev.json] [--top 12] [--json]
//
// COST (measured 2026-11-16 on Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0 — host read in the SAME command as the numbers): **9.6 s** over the LIVE store (94,584 generations,
// 76,006 tool tasks, 2,810 compactions, 686 KB of report) and **0.5 s** over an empty store. No store WRITE, no
// network, no model, $0. Re-measure rather than quote.
//
// A STORE WITH NOTHING TO COUNT PRINTS n/a, NOT A CRASH AND NOT A NUMBER (the rule this change added).
// Two shapes reach that state, and both are named rather than printed as a zero:
//   (a) no `pi.generation` entries — an empty or fresh store. Before the guard this died: `Math.min(...[])` is
//     Infinity, and `new Date(Infinity).toISOString()` threw `RangeError: Invalid time value` (measured exit 1,
//     0 B of stdout, 772 B of stack, `timeout 60 node tools/latency-budget.mjs --db .spike/empty-gen.sqlite`);
//   (b) no DONE rows among the rows `cli.mjs status` CARRIES — the view is BOUNDED (200 rows here, all non-terminal),
//     so the whole ITEM half of the report is blind EVEN ON THE LIVE STORE, and before the guard every share there
//     printed `NaN%` and every max printed `-Infinityh`, which reads as "the rig spends no time on items".
// Now: every rate prints `n/a (denominator is 0)` or `n/a (n=0)`, two `SANITY:` lines name WHICH half is blind and
// where the data actually is, `--json` carries `span: null` and `measurable: { generations, doneRows }`, and the
// exit code stays 0 — "this store has no data" is a measurement OF the store, not a failure of the instrument.
// Pinned by demo/latency-budget-no-data.test.mjs (the `toolchain` area): RED against the pre-change tool reads
// 4 ok / **14 FAIL** (`.spike/lb-red-1.out`, the live store's `NaN%` among them), GREEN at this tree reads
// **18 checks / 0 FAIL, 15.5 s** (`.spike/lb-green-2.out` — ~10 s of it is the live-store leg).
//
// last_verified: 2026-11-16 — the demo above is the gate; the LIVE run re-read here is exit 0 in 9.6 s with
// `store span: 2026-10-11T20:22:56.500Z -> 2026-11-15T08:28:46.902Z = 828.1h` and model-call p50 31ms p95 8.1s
// p99 1.6m max 2.0h (`.spike/lb-live-1.out`). The machine half of the live report still agrees with
// `docs/runbooks/slow-loop.md`; the ITEM half is now KNOWN BLIND on a bounded view and says so — a session that
// needs item latency reads the store's `queueItems[].transitions` (or `cli.mjs queue --json`, ~22 MB) itself.
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parseOpts } from "./argv-contract.mjs";

const argv = process.argv.slice(2);
// ONE reader for the tools/ plane (tools/argv-contract.mjs): the four-line reader this replaces made
// `--json=<path>` and `--zzz=1` SILENT — the report printed, the exit code did not move, and the reader asked for
// a file that never appeared (SELFDEV pitfall 426).
const o = parseOpts(argv, {
	value: ["db", "top"],
	bool: ["json"],
	numeric: ["top"],
	usage: "--db <path> · --top <n> · --json",
});
const arg = (name, dflt) => o.get(name, dflt);
const DB = arg("db", "./selfdev.sqlite");
const TOP = arg("top", 12);
const JSONOUT = o.has("json");
const t0 = Date.now();

// ---------- currency 1: the item, from the rig's own read (never from a delta-encoded SQL probe) ----------
// `queue`/`status` append a trailing `note:` line, so raw JSON.parse on stdout dies (SELFDEV pitfall).
const out = execFileSync(process.execPath, ["cli.mjs", "status"], { env: { ...process.env, DURIG_DB: DB }, encoding: "utf8", maxBuffer: 1 << 28 });
const status = JSON.parse(out.replace(/\nnote:[\s\S]*$/, ""));
const ms = (s) => new Date(s).getTime();
const pct = (a, p) => {
	const s = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
	return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const sum = (a, f) => a.reduce((s, x) => s + f(x), 0);
const H = (v) => (v / 3600000).toFixed(1) + "h";
const MIN = (v) => (v / 60000).toFixed(1) + "m";
// one formatter that scales, so a p99 of 128 s never prints as "0.0h"
const D = (v) => (v < 1000 ? v + "ms" : v < 60000 ? (v / 1000).toFixed(1) + "s" : v < 3600000 ? (v / 60000).toFixed(1) + "m" : (v / 3600000).toFixed(1) + "h");
// A RATE WITH NO DENOMINATOR IS NOT A MEASUREMENT. `NaN%` and `-Infinityh` are numbers on the page, and a
// reader of a wall-clock budget reads them as "the rig spent no time" — the same false-measurement shape as
// pitfall 429's silence, one level down. These helpers name the empty case instead, so a store with no
// generations, no DONE rows or no usage rows says what it CANNOT claim.
const R = (num, den, dp = 1) => den > 0 ? `${(100 * num / den).toFixed(dp)}%` : "n/a (denominator is 0)";
const MAXH = (a) => a.length ? H(Math.max(...a)) : "n/a (n=0)";
const LAT = (a) => a.length ? `p50 ${D(pct(a, 0.5))} p95 ${D(pct(a, 0.95))} p99 ${D(pct(a, 0.99))} max ${D(Math.max(...a))}` : "n/a (n=0)";

const items = [];
for (const it of status.queueItems || []) {
	const tr = it.transitions || [];
	if (!tr.length) continue;
	const ev = tr.map((t) => ({ e: t.event, t: ms(t.at) }));
	let wait = 0,
		work = 0,
		held = 0,
		claims = 0;
	for (let i = 1; i < ev.length; i++) {
		const dt = ev[i].t - ev[i - 1].t;
		const prev = ev[i - 1].e;
		if (prev === "queued" || prev === "released" || prev === "deferred") wait += dt;
		else if (prev === "claimed") work += dt;
		else if (prev === "held") held += dt;
		if (ev[i].e === "claimed") claims++;
	}
	items.push({ id: it.id, to: it.to, status: it.status, wait, work, held, claims, total: ev[ev.length - 1].t - ev[0].t, last: ev[ev.length - 1].t, first: ev[0].t });
}
const done = items.filter((r) => r.status === "done");
const nonterm = items.filter((r) => r.status !== "done" && r.status !== "cancelled");

// ---------- currency 2: the machine, from the store's own timestamps ----------
const db = new DatabaseSync(DB, { readOnly: true });
const unq = (s) => String(s).replace(/^"|"$/g, ""); // stored enum strings carry embedded quotes
const gens = [];
const toolTasks = [];
const compactions = [];
for (const r of db.prepare("select id, conversation_id cid, kind, record from tasks").all()) {
	let c;
	try {
		c = JSON.parse(r.record);
	} catch {
		continue;
	}
	if (!c.startedAt || !c.endedAt) continue;
	const k = unq(r.kind);
	const rec = { id: r.id, cid: Number(r.cid), s: c.startedAt, e: c.endedAt, d: c.endedAt - c.startedAt, outcome: c.state?.outcome?.status || c.state?.status || "?", err: (c.state?.outcome?.error?.message || "").slice(0, 70), owner: c.owner ?? null, callKind: unq(c.input?.kind || "?") };
	if (k === "pi.generation") gens.push(rec);
	else if (k === "pi.tool") toolTasks.push(rec);
	else if (k === "pi.compaction") compactions.push(rec);
}
// entries: tool-result durations by name, plus every assistant turn's token usage, plus event timestamps
// (used to ask whether a long generation was WORK or just IN FLIGHT).
const toolNames = new Map();
const convTimes = new Map();
let tokFresh = 0,
	tokCache = 0,
	tokOut = 0,
	turns = 0,
	over150k = 0,
	maxPrompt = 0;
for (const r of db.prepare("select conversation_id cid, record from entries").all()) {
	const s = r.record;
	for (const m of s.matchAll(/"timestamp":(\d{10,})/g)) {
		const cid = Number(r.cid);
		let a = convTimes.get(cid);
		if (!a) convTimes.set(cid, (a = []));
		a.push(Number(m[1]));
	}
	if (!s.includes('"usage"') && !s.includes('"toolName"')) continue;
	let rec;
	try {
		rec = JSON.parse(s);
	} catch {
		continue;
	}
	for (const m of rec.model || []) {
		if (m?.role === "toolResult") {
			const nm = unq(m.toolName || "?");
			let t = toolNames.get(nm);
			if (!t) toolNames.set(nm, (t = { n: 0, err: 0, d: [] }));
			t.n++;
			if (m.isError) t.err++;
			if (typeof m.durationMs === "number") t.d.push(m.durationMs);
		} else if (m?.role === "assistant" && m.usage) {
			turns++;
			tokFresh += m.usage.input || 0;
			tokCache += m.usage.cacheRead || 0;
			tokOut += m.usage.output || 0;
			const prompt = (m.usage.input || 0) + (m.usage.cacheRead || 0);
			if (prompt > 150000) over150k++;
			if (prompt > maxPrompt) maxPrompt = prompt;
		}
	}
}
for (const a of convTimes.values()) a.sort((x, y) => x - y);
const inWindow = (cid, s, e) => {
	const a = convTimes.get(cid);
	if (!a) return 0;
	return bisect(a, e + 1) - bisect(a, s);
};
function bisect(a, x) {
	let lo = 0,
		hi = a.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (a[mid] < x) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}
// concurrency of generations: how much WALL-CLOCK time was spent at N generations in flight
const ev = [];
for (const g of gens) {
	ev.push([g.s, 1]);
	ev.push([g.e, -1]);
}
ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
let cur = 0;
const timeAt = new Map();
let prev = ev.length ? ev[0][0] : 0;
let maxConc = 0;
for (const [t, d] of ev) {
	if (t > prev) timeAt.set(cur, (timeAt.get(cur) || 0) + (t - prev));
	prev = t;
	cur += d;
	if (cur > maxConc) maxConc = cur;
}
const gsum = sum(gens, (x) => x.d);
const buckets = [
	[0, 5000],
	[5000, 15000],
	[15000, 30000],
	[30000, 60000],
	[60000, 120000],
	[120000, 300000],
	[300000, 600000],
	[600000, Infinity],
];
const errs = new Map();
for (const g of gens) {
	if (g.outcome === "completed") continue;
	const k = g.err || g.outcome;
	let e = errs.get(k);
	if (!e) errs.set(k, (e = { n: 0, d: 0 }));
	e.n++;
	e.d += g.d;
}
const long = gens.filter((g) => g.d >= 600000).sort((a, b) => b.d - a.d);
const spanLo = gens.length ? Math.min(...gens.map((g) => g.s)) : null;
const spanHi = Math.max(...gens.map((g) => g.e));
const seatNames = new Map((status.seats || []).map((s) => [s.conversationId, s.name]));

// ---------- config cap, read from the two config files (precedence: src/config.mjs) ----------
const capFor = (f) => {
	try {
		return JSON.parse(readFileSync(f, "utf8")).DURIG_MAX_CONCURRENT_SEATS;
	} catch {
		return null;
	}
};

const report = [];
const P = (s) => report.push(s);
const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + "s";
P(`WALL-CLOCK BUDGET  ${new Date().toISOString()}  store=${DB}  cost=${elapsed()}`);
P(`  thresholds/patterns used: transition events queued|released|deferred->claimed = WAIT, claimed->done = WORK, claimed->held = HELD;`);
P(`    task kinds ${'"pi.generation" | "pi.tool" | "pi.compaction"'} (stored WITH quotes); durationMs = endedAt-startedAt;`);
P(`    long tail = a generation of >= ${600000} ms; prompt tokens = usage.input + usage.cacheRead; cap source = durig.config{.default}.json`);
P(`  store span: ${gens.length ? `${new Date(spanLo).toISOString()} -> ${new Date(spanHi).toISOString()} = ${H(spanHi - spanLo)} of elapsed rig time` : `no "pi.generation" entries in ${DB} — nothing to span; the MACHINE sections below print n/a rather than crashing`}`);
P(`  SANITY: gens=${gens.length} toolTasks=${toolTasks.length} compactions=${compactions.length} — a store with 0 tasks answers NOTHING about the machine half, so read the n/a lines as "no data", never as "the rig is fast"`);
P(`  DURIG_MAX_CONCURRENT_SEATS: durig.config.json=${JSON.stringify(capFor("durig.config.json"))} durig.config.default.json=${JSON.stringify(capFor("durig.config.default.json"))} (precedence and merge: src/config.mjs loadConfig)`);

P(`\n1. ITEM LATENCY (from \`cli.mjs status\` transitions; ${items.length} rows, ${done.length} done, ${nonterm.length} non-terminal)`);
if (!done.length) P(`  SANITY: 0 DONE rows among the ${items.length} rows \`cli.mjs status\` CARRIES (the view is bounded — it carried 200 non-terminal rows here and no terminal one), so the item-latency half of this report is blind on a bounded view; the store's own \`queueItems[].transitions\` hold the done rows, reachable at ~22 MB via \`cli.mjs queue --json\`. Say so rather than print a zero and a share with no denominator as if the rig were idle`);
const totWait = sum(done, (x) => x.wait),
	totWork = sum(done, (x) => x.work),
	totHeld = sum(done, (x) => x.held),
	totAll = sum(done, (x) => x.total);
P(`  queue->done across all done items: ${H(totAll)} (median ${MIN(pct(done.map((x) => x.total), 0.5))}, p95 ${H(pct(done.map((x) => x.total), 0.95))}, max ${MAXH(done.map((x) => x.total))})`);
for (const [k, v] of [["WAIT  claimable, unclaimed", totWait], ["WORK  claimed->done", totWork], ["HELD  claimed->held", totHeld]]) P(`  ${k.padEnd(26)} ${H(v).padStart(8)}  = ${R(v, totAll)} of item latency`);
const re = done.filter((x) => x.claims > 1);
P(`  re-claimed done rows: ${re.length} (${R(re.length, done.length)} hold ${R(sum(re, (x) => x.total), totAll)} of item latency; median ${H(pct(re.map((x) => x.total), 0.5))} vs single-claim median ${MIN(pct(done.filter((x) => x.claims <= 1).map((x) => x.total), 0.5))}`);
for (const st of ["held", "deferred", "claimed", "queued"]) {
	const a = nonterm.filter((r) => r.status === st).map((r) => Date.now() - r.last);
	if (a.length) P(`  parked ${st}: n=${a.length} since-last-transition median=${H(pct(a, 0.5))} max=${H(Math.max(...a))}`);
}
const byDay = new Map();
for (const it of status.queueItems || []) {
	const tr = it.transitions || [];
	const dIdx = tr.findIndex((t) => t.event === "done");
	if (dIdx < 1) continue;
	const k = new Date(ms(tr[dIdx].at)).toISOString().slice(0, 10);
	let w = 0;
	for (let i = 1; i <= dIdx; i++) if ((tr[i - 1].event === "queued" || tr[i - 1].event === "released" || tr[i - 1].event === "deferred") && tr[i].event === "claimed") w += ms(tr[i].at) - ms(tr[i - 1].at);
	let g = byDay.get(k);
	if (!g) byDay.set(k, (g = { n: 0, w: [] }));
	g.n++;
	g.w.push(w);
}
P(`  done-per-day with claim-wait p50 (the throughput/latency curve; empty day = nothing landed):`);
for (const [k, g] of [...byDay].sort()) P(`    ${k}  done=${String(g.n).padStart(4)}  claim-wait p50=${MIN(pct(g.w, 0.5)).padStart(8)} p95=${H(pct(g.w, 0.95))}`);

P(`\n2. MACHINE WALL-CLOCK (tasks table; ${gens.length} generations, ${toolTasks.length} tool tasks, ${compactions.length} compactions)`);
P(`  generation busy time ${H(gsum)}; model-call time ${H(sum(toolTasks.filter((t) => t.callKind === "model"), (x) => x.d))}; tool-call time ${H(sum(toolTasks.filter((t) => t.callKind !== "model"), (x) => x.d))}; compaction ${H(sum(compactions, (x) => x.d))}`);
P(`  wall-clock time by concurrent generations (max in flight ${maxConc}; 0 = the channel was down or idle):`);
for (const [n, v] of [...timeAt].sort((a, b) => a[0] - b[0])) if (v > 60000) P(`    ${n} in flight: ${H(v)}`);
P(`  generation duration buckets (n, share of generation busy time):`);
for (const [lo, hi] of buckets) {
	const a = gens.filter((g) => g.d >= lo && g.d < hi);
	P(`    ${String(lo / 1000).padStart(4)}s-${hi === Infinity ? "inf" : String(hi / 1000) + "s"}: n=${String(a.length).padStart(6)} (${R(a.length, gens.length, 2)} of runs)  ${H(sum(a, (x) => x.d)).padStart(8)} (${R(sum(a, (x) => x.d), gsum)} of busy time)`);
}
P(`  LONG TAIL (>=10 min): ${long.length} generations hold ${H(sum(long, (x) => x.d))} = ${R(sum(long, (x) => x.d), gsum)} of generation busy time`);
P(`    "events the conversation produced inside its own window" is the discriminator between WORK and IN FLIGHT:`);
for (const g of long.slice(0, TOP)) P(`      gen #${g.id} seat=${(seatNames.get(g.cid) || g.cid).padEnd(10)} ${MIN(g.d).padStart(9)} events=${String(inWindow(g.cid, g.s, g.e)).padStart(3)} outcome=${g.outcome} ${g.err}`);
const modelD = toolTasks.filter((t) => t.callKind === "model").map((x) => x.d);
const realToolD = toolTasks.filter((t) => t.callKind !== "model").map((x) => x.d);
P(`  model-call latency (n=${modelD.length}): ${LAT(modelD)}`);
P(`  real tool-call latency (n=${realToolD.length}): ${LAT(realToolD)}`);
P(`  compaction latency: n=${compactions.length} ${LAT(compactions.map((x) => x.d))}`);

P(`\n3. PROVIDER WASTE (generations that ended without a completed outcome)`);
for (const [k, v] of [...errs].sort((a, b) => b[1].n - a[1].n).slice(0, TOP)) P(`  n=${String(v.n).padStart(6)}  ${H(v.d).padStart(8)} busy  ${k}`);
const errN = sum([...errs.values()], (v) => v.n),
	errD = sum([...errs.values()], (v) => v.d);
P(`  total: ${errN} of ${gens.length} generations (${R(errN, gens.length)}) ended in an error, holding ${H(errD)} = ${R(errD, gsum)} of generation busy time`);

P(`\n4. CONTEXT AND PREFILL (assistant usage rows in entries)`);
P(`  assistant turns ${turns}; fresh input tokens ${tokFresh}; cacheRead tokens ${tokCache}; cache hit ${R(tokCache, tokCache + tokFresh)}; output tokens ${tokOut}`);
P(`  prompts over 150,000 tokens: ${over150k}; largest prompt ${maxPrompt} tokens (declared window per seat: see \`cli.mjs status\` .context.window)`);

P(`\n5. TOOL TIME (entry toolResult durationMs, printed WITH the zeros that made 217 findable)`);
const tn = [...toolNames].map(([name, t]) => ({ name, n: t.n, err: t.err, busy: sum(t.d, (x) => x), p95: pct(t.d, 0.95), max: Math.max(0, ...t.d) }));
for (const t of [...tn].sort((a, b) => b.n - a.n).slice(0, TOP)) P(`  ${String(t.name).slice(0, 26).padEnd(26)} n=${String(t.n).padStart(6)} err=${String(t.err).padStart(5)} (${(100 * t.err / t.n).toFixed(2)}%) busy=${H(t.busy).padStart(7)} p95=${String(t.p95).padStart(7)}ms max=${(t.max / 1000).toFixed(0)}s`);
for (const probe of ["bash", "powershell", "shell"]) {
	const t = toolNames.get(probe);
	P(`  presence probe ${probe}: ${t ? `n=${t.n}` : "0 — this tool never appears in the store"}`);
}

P(`\nnext: rank by measured hours, not by intuition; see docs/reviews/wallclock-budget-<date>.md for the ranking this feeds.`);
P(`run in ${elapsed()} (read-only)`);

if (JSONOUT)
	console.log(
		JSON.stringify({
			span: spanLo === null ? null : [spanLo, spanHi],
			measurable: { generations: gens.length > 0, doneRows: done.length > 0 },
			items: { rows: items.length, done: done.length, nonterm: nonterm.length, waitMs: totWait, workMs: totWork, heldMs: totHeld, totalMs: totAll },
			generations: gens.length,
			generationBusyMs: gsum,
			modelBusyMs: sum(toolTasks.filter((t) => t.callKind === "model"), (x) => x.d),
			toolBusyMs: sum(toolTasks.filter((t) => t.callKind !== "model"), (x) => x.d),
			compactionBusyMs: sum(compactions, (x) => x.d),
			longTail: long.map((g) => ({ id: g.id, seat: seatNames.get(g.cid) || g.cid, ms: g.d, events: inWindow(g.cid, g.s, g.e), outcome: g.outcome, err: g.err })),
			maxConcurrent: maxConc,
			errorGenerations: errN,
			errorBusyMs: errD,
			tokens: { fresh: tokFresh, cache: tokCache, out: tokOut, over150k, maxPrompt },
		})
	);
else console.log(report.join("\n"));
db.close();
