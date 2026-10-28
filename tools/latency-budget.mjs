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
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const arg = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 ? argv[i + 1] : dflt;
};
const DB = arg("db", "./selfdev.sqlite");
const TOP = Number(arg("top", 12));
const JSONOUT = argv.includes("--json");
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
const spanLo = Math.min(...gens.map((g) => g.s));
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
P(`  store span: ${new Date(spanLo).toISOString()} -> ${new Date(spanHi).toISOString()} = ${H(spanHi - spanLo)} of elapsed rig time`);
P(`  DURIG_MAX_CONCURRENT_SEATS: durig.config.json=${JSON.stringify(capFor("durig.config.json"))} durig.config.default.json=${JSON.stringify(capFor("durig.config.default.json"))} (precedence and merge: src/config.mjs loadConfig)`);

P(`\n1. ITEM LATENCY (from \`cli.mjs status\` transitions; ${items.length} rows, ${done.length} done, ${nonterm.length} non-terminal)`);
const totWait = sum(done, (x) => x.wait),
	totWork = sum(done, (x) => x.work),
	totHeld = sum(done, (x) => x.held),
	totAll = sum(done, (x) => x.total);
P(`  queue->done across all done items: ${H(totAll)} (median ${MIN(pct(done.map((x) => x.total), 0.5))}, p95 ${H(pct(done.map((x) => x.total), 0.95))}, max ${H(Math.max(...done.map((x) => x.total)))})`);
for (const [k, v] of [["WAIT  claimable, unclaimed", totWait], ["WORK  claimed->done", totWork], ["HELD  claimed->held", totHeld]]) P(`  ${k.padEnd(26)} ${H(v).padStart(8)}  = ${(100 * v / totAll).toFixed(1)}% of item latency`);
const re = done.filter((x) => x.claims > 1);
P(`  re-claimed done rows: ${re.length} (${(100 * re.length / done.length).toFixed(1)}%) hold ${(100 * sum(re, (x) => x.total) / totAll).toFixed(1)}% of item latency; median ${H(pct(re.map((x) => x.total), 0.5))} vs single-claim median ${MIN(pct(done.filter((x) => x.claims <= 1).map((x) => x.total), 0.5))}`);
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
	P(`    ${String(lo / 1000).padStart(4)}s-${hi === Infinity ? "inf" : String(hi / 1000) + "s"}: n=${String(a.length).padStart(6)} (${(100 * a.length / gens.length).toFixed(2)}% of runs)  ${H(sum(a, (x) => x.d)).padStart(8)} (${(100 * sum(a, (x) => x.d) / gsum).toFixed(1)}% of busy time)`);
}
P(`  LONG TAIL (>=10 min): ${long.length} generations hold ${H(sum(long, (x) => x.d))} = ${(100 * sum(long, (x) => x.d) / gsum).toFixed(1)}% of generation busy time`);
P(`    "events the conversation produced inside its own window" is the discriminator between WORK and IN FLIGHT:`);
for (const g of long.slice(0, TOP)) P(`      gen #${g.id} seat=${(seatNames.get(g.cid) || g.cid).padEnd(10)} ${MIN(g.d).padStart(9)} events=${String(inWindow(g.cid, g.s, g.e)).padStart(3)} outcome=${g.outcome} ${g.err}`);
const modelD = toolTasks.filter((t) => t.callKind === "model").map((x) => x.d);
const realToolD = toolTasks.filter((t) => t.callKind !== "model").map((x) => x.d);
P(`  model-call latency (n=${modelD.length}): p50 ${D(pct(modelD, 0.5))} p95 ${D(pct(modelD, 0.95))} p99 ${D(pct(modelD, 0.99))} max ${D(Math.max(...modelD))}`);
P(`  real tool-call latency (n=${realToolD.length}): p50 ${D(pct(realToolD, 0.5))} p95 ${D(pct(realToolD, 0.95))} p99 ${D(pct(realToolD, 0.99))} max ${D(Math.max(...realToolD))}`);
P(`  compaction latency: n=${compactions.length} p50 ${D(pct(compactions.map((x) => x.d), 0.5))} p95 ${D(pct(compactions.map((x) => x.d), 0.95))} max ${D(Math.max(...compactions.map((x) => x.d)))}`);

P(`\n3. PROVIDER WASTE (generations that ended without a completed outcome)`);
for (const [k, v] of [...errs].sort((a, b) => b[1].n - a[1].n).slice(0, TOP)) P(`  n=${String(v.n).padStart(6)}  ${H(v.d).padStart(8)} busy  ${k}`);
const errN = sum([...errs.values()], (v) => v.n),
	errD = sum([...errs.values()], (v) => v.d);
P(`  total: ${errN} of ${gens.length} generations (${(100 * errN / gens.length).toFixed(1)}%) ended in an error, holding ${H(errD)} = ${(100 * errD / gsum).toFixed(1)}% of generation busy time`);

P(`\n4. CONTEXT AND PREFILL (assistant usage rows in entries)`);
P(`  assistant turns ${turns}; fresh input tokens ${tokFresh}; cacheRead tokens ${tokCache}; cache hit ${(100 * tokCache / (tokCache + tokFresh)).toFixed(1)}%; output tokens ${tokOut}`);
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
			span: [spanLo, spanHi],
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
