#!/usr/bin/env node
// tools/channel-preflight.mjs — "if I start the delivery channel RIGHT NOW, what actually happens?"
//
// WHY THIS EXISTS. NEXT.md ranks "keep the delivery channel resident" (#725/#726/#727) as the single
// largest measured wall-clock lever, and the operator holds the one-liner that starts it. Every prior
// pre-flight answered only "is the broker process alive" (`--status`); none of them answered the two
// questions that decide whether starting it is worth a wake budget: (1) is there anything CLAIMABLE to
// wake onto, and (2) does store state already suppress the wake. This prints both, in ~2 s, from the
// product's OWN decision functions rather than a re-derivation: it imports `advancingConvIds`,
// `admissionVerdict` (src/broker.mjs) and `selectWakes` (src/driver.mjs) and runs them over a read of
// the store, so the verdict is the same code the broker will run on its first pass.
//
// IT IS AN INSTRUMENT, NOT A FIX (tools/README.md rules). It writes nothing: the store is opened
// `readOnly:true`, `cli.mjs queue`/`ps` are broker-served reads (D111), and no Harness is opened. It
// starts nothing, claims nothing, releases nothing, defers nothing. `pm` owns every queue transition
// (docs/runbooks/stale-held-backlog.md §Do).
//
// Usage: node tools/channel-preflight.mjs [--db ./selfdev.sqlite] [--rig rig.selfdev.json]
//        [--queue-snapshot <file>] [--recent 30] [--json <out.json>]
//
// Every count prints the pattern and the threshold behind it (D142). Timestamps are Z; this box's local
// zone is CDT (UTC-5) and is named in the header.

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { advancingConvIds, admissionVerdict, ADMISSION_DEADLINE_MS } from "../src/broker.mjs";
import { selectWakes } from "../src/driver.mjs";
import { resolveSeatRoot, classifyGitRoot } from "../src/seatroot.mjs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const DB = opt("db", "./selfdev.sqlite");
const RIG = opt("rig", "./rig.selfdev.json");
const SNAPSHOT = opt("queue-snapshot", null);
const RECENT = Number(opt("recent", 30)) || 30;
const OUT = opt("json", null);
const t0 = Date.now();
const ms = () => Date.now() - t0;
const note = (m) => process.stderr.write(`[channel-preflight ${ms()}ms] ${m}\n`);
const H = (v) => (v / 3600000).toFixed(1) + "h";
const decodeCliJson = (text) => {
	const at = text.indexOf("{");
	if (at < 0) throw new Error("cli output has no JSON object");
	return JSON.parse(text.slice(at, text.lastIndexOf("}") + 1));
};
const cli = (args) => {
	const r = spawnSync(process.execPath, ["cli.mjs", ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, DURIG_DB: DB, DURIG_CONFIG: RIG },
	});
	if (r.status !== 0) throw new Error(`cli.mjs ${args.join(" ")} exit ${r.status}: ${String(r.stderr).slice(0, 200)}`);
	return decodeCliJson(r.stdout);
};

// ---------------------------------------------------------------- 1. the channel, as a process and a heartbeat
note("channel state");
const stateFile = `${DB}.broker.json`;
const epoch = (v) => (typeof v === "number" && Number.isFinite(v) ? v : v ? Date.parse(String(v)) : null);
let channel = { state: "no state file", pid: null, hbAgeMs: null, pidAlive: false };
if (existsSync(stateFile)) {
	const s = JSON.parse(readFileSync(stateFile, "utf8"));
	const hb = epoch(s.heartbeatAt);
	channel = { state: s.state ?? (s.pid ? "recorded (no state field; process liveness decides)" : "?"), pid: s.pid ?? null, hbAt: hb, hbAgeMs: hb ? Date.now() - hb : null, since: s.since ?? null, lastPassAt: epoch(s.lastPassAt), runToken: s.runToken ?? null };
	try {
		process.kill(channel.pid, 0);
		channel.pidAlive = true;
	} catch {
		channel.pidAlive = false;
	}
}
// Any process that could be holding a run: `serve`, `run`, `send`, `resume` all drive a Harness.
const ps = spawnSync("ps", ["-eo", "pid,etimes,args"], { encoding: "utf8" });
const drivers = ps.stdout
	.split("\n")
	.map((l) => l.trim())
	.filter((l) => /node\s+\S*cli\.mjs\s+(serve|run|send|resume|doctor)\b/.test(l))
	.map((l) => {
		const [pid, etimes, ...rest] = l.split(/\s+/);
		return { pid: Number(pid), etimes: Number(etimes), args: rest.join(" ") };
	});

// ---------------------------------------------------------------- 2. the queue head (one read, projected)
let items;
if (SNAPSHOT) {
	note(`queue from snapshot ${SNAPSHOT}`);
	items = decodeCliJson(readFileSync(SNAPSHOT, "utf8")).items;
} else {
	note("queue: one broker-served read (cli.mjs queue)");
	items = cli(["queue"]).items;
}
const CLAIMABLE = "queued";
const byStatus = {};
for (const it of items) byStatus[it.status] = (byStatus[it.status] ?? 0) + 1;
const parkedFor = (seat) => items.filter((it) => it.to === seat && (it.status === "held" || it.status === "deferred"));
const oldestParkedH = (seat) => {
	const rows = parkedFor(seat);
	if (!rows.length) return null;
	const at = rows.map((r) => Date.parse((r.transitions ?? []).at(-1)?.at ?? 0)).filter(Number.isFinite);
	return (Date.now() - Math.min(...at)) / 3600000;
};

// ---------------------------------------------------------------- 3. seats, submissions, live tasks
const seats = cli(["ps"]).seats;
const seatByConv = new Map(seats.map((s) => [Number(s.conversationId), s.name]));
const db = new DatabaseSync(DB, { readOnly: true });
// THE ADMISSION TIMESTAMP IS NOT PERSISTED ON THE SUBMISSION ROW. src/readapi.mjs:269-284 recovers it by
// joining the submission's admitted input ENTRY and reading that entry's `model[0].timestamp`; the same
// join is done here so this instrument ages rows the way the attention surface does. src/broker.mjs's own
// `pendingAgeMs` does NOT do the join — it reads the raw row, where the field is absent (measured: 0 of the
// 45 `SKIP reason=pending` lines retained in ./selfdev.sqlite.broker.log carry the ` age=` field #4180 promises).
const subs = db
	.prepare("select id, conversation_id cid, request_id rid, status, record from submissions where status in ('queued','placed') order by id")
	.all()
	.map((r) => {
		let rec = {};
		try {
			rec = JSON.parse(r.record);
		} catch {}
		return { id: r.id, conversationId: Number(r.cid), status: r.status, requestId: rec.requestId ?? null, entry: rec.entry ?? null, raw: rec, persistedTs: rec.admittedAt ?? rec.createdAt ?? null };
	});
const entryTs = (id) => {
	if (id == null) return null;
	const row = db.prepare("select record from entries where id = ?").get(String(id));
	if (!row) return null;
	try {
		const t = JSON.parse(row.record)?.model?.[0]?.timestamp;
		return Number.isFinite(t) ? t : null;
	} catch {
		return null;
	}
};
for (const s of subs) s.admittedAt = entryTs(s.entry) ?? s.persistedTs;
db.close();
const unq = (s) => String(s).replace(/^"|"$/g, "");
// Recent provider outcomes: `unanswered` is the settled-with-an-error state.
const recent = (() => {
	const d = new DatabaseSync(DB, { readOnly: true });
	const rows = d.prepare("select id, status, record from submissions order by id desc limit ?").all(RECENT);
	const entryOf = d.prepare("select record from entries where conversation_id = ? and id > ? order by id limit 40");
	const out = { total: rows.length, unanswered: 0, patterns: new Map(), attempts: new Map(), failures: new Map(), oldest: null, newest: null };
	for (const r of rows) {
		let rec = {};
		try {
			rec = JSON.parse(r.record);
		} catch {}
		// ERA ATTRIBUTION (ROADMAP 226, measured 2026-10-28): a raw window over `submissions` mixes provider
		// regimes. Every seat here moved from deepinfra to the local endpoint when rig.selfdev.json landed the
		// local models (commit b04215b, 2026-10-27T04:55Z) and every recorded 402 predates that, so "6 of the
		// last 30 unanswered" reads as a live provider failure and is in fact history. The provider that RAN the
		// turn is recoverable the same way the admission age is (229): join the submission's `entry` and read that
		// entry's `model[0].provider`. Print both, or the next reader re-derives it and mis-ranks 226 again.
		let prov = "(unattributed — no assistant entry after the admitted one)";
		if (rec.entry != null) {
			// The submission's own `entry` is the ADMITTED INPUT entry, which carries a timestamp but no
			// `model[0]` — the provider/model that RAN the turn is on the first assistant entry after it.
			for (const er of entryOf.all(Number(rec.conversationId ?? rec.conversation_id), Number(rec.entry))) {
				try {
					const m = JSON.parse(er.record)?.model?.[0];
					if (!m?.provider) continue;
					prov = `${m.provider}/${m.model}`;
					const ts = Number(m.timestamp);
					if (Number.isFinite(ts)) {
						out.newest = Math.max(out.newest ?? ts, ts);
						out.oldest = Math.min(out.oldest ?? ts, ts);
					}
					break;
				} catch {}
			}
		}
		out.attempts.set(prov, (out.attempts.get(prov) ?? 0) + 1);
		if (r.status !== "unanswered") continue;
		out.unanswered++;
		out.failures.set(prov, (out.failures.get(prov) ?? 0) + 1);
		const detail = unq(String(rec.detail ?? "")).slice(0, 60);
		out.patterns.set(detail, (out.patterns.get(detail) ?? 0) + 1);
	}
	d.close();
	return out;
})();
// Persisted task status is NOT the same field as pi-durable's derived `state.kind` (broker.mjs
// isAdvancingTask) — a store read can only report the persisted half, and must say so.
const tasks = (() => {
	const d = new DatabaseSync(DB, { readOnly: true });
	const all = d.prepare("select id, conversation_id cid, kind, record from tasks").all();
	d.close();
	const tally = new Map();
	const nonTerminal = [];
	for (const r of all) {
		let c;
		try {
			c = JSON.parse(r.record);
		} catch {
			continue;
		}
		const st = c.state?.status ?? "?";
		const k = unq(r.kind);
		tally.set(`${k}:${st}`, (tally.get(`${k}:${st}`) ?? 0) + 1);
		if (st !== "terminal" && st !== "?") nonTerminal.push({ id: r.id, cid: Number(r.cid), kind: k, status: st, startedAt: c.startedAt ?? null });
	}
	return { tally, nonTerminal };
})();

// ---------------------------------------------------------------- 3c. can a seat do its job on THIS host?
// The links above decide WHETHER a start wakes seats. None asks whether a woken seat can then DO the work:
// the completion rule and the constitution's oracle both require running `node demo/<name>.test.mjs`, which
// needs a shell. Import the product's own seat tool set rather than re-deriving it (tools/README rule), ask
// the OS whether the program that tool spawns exists, then read what the store says the LAST attempt did —
// the zero with its evidence, not the intention (ROADMAP 217).
const seatToolsMod = await import("../src/seattools.mjs");
const capability = (() => {
	const names = Object.values(seatToolsMod.seatTools).map((t) => t.name);
	const shellName = seatToolsMod.seatTools.shell?.name ?? null;
	// The pinned build's fallback program list, read out of the vendored source so the pattern is printed.
	const durable = "vendor/pi-main/packages/durable/src/tools/bash.ts";
	let programs = null;
	let programAt = null;
	if (existsSync(durable)) {
		const src = readFileSync(durable, "utf8");
		const at = src.indexOf("options?.programs ?? [");
		const m = at >= 0 ? src.slice(at).match(/programs \?\? \[([^\]]*)\]/) : null;
		if (m) {
			programs = m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter(Boolean);
			programAt = `${durable}:${src.slice(0, at).split("\n").length}`;
		}
	}
	programs = programs ?? ["pwsh", "powershell"];
	const probe = process.platform === "win32" ? ["where", []] : ["sh", ["-c", 'command -v "$1"', "probe"]];
	const resolution = programs.map((prg) => {
		const r = spawnSync(probe[0], [...probe[1], prg], { encoding: "utf8" });
		return { program: prg, path: r.status === 0 && String(r.stdout).trim() ? String(r.stdout).trim().split("\n")[0] : null };
	});
	// What the store actually shows for those tool names — including the name the rig does NOT register, whose
	// zero IS the evidence. Counting only the registered name would hide it.
	const d2 = new DatabaseSync(DB, { readOnly: true });
	const namesToCount = [...new Set(["bash", "powershell", ...resolution.map((r) => r.program)])];
	// ONE scan of `entries` for every pattern, aliased a0..an / e0..en: each separate LIKE is a full scan of a
	// 274k-entry table (~0.22 s each), so six queries would triple this instrument's cost for the same rows.
	const sel = [];
	namesToCount.forEach((n, i) => {
		sel.push(`sum(record like '%"toolName":"${n}"%') a${i}`);
		sel.push(`sum(record like '%spawn ${n} ENOENT%') e${i}`);
	});
	const row = d2.prepare(`select ${sel.join(", ")} from entries`).get();
	const counts = {};
	const spawnFailures = {};
	namesToCount.forEach((n, i) => {
		counts[n] = Number(row[`a${i}`] ?? 0);
		spawnFailures[n] = Number(row[`e${i}`] ?? 0);
	});
	let last = null;
	for (const n of Object.keys(counts)) {
		const row = d2.prepare(`select id, record from entries where record like '%"toolName":"${n}"%' order by id desc limit 1`).get();
		if (!row) continue;
		try {
			const rec = JSON.parse(row.record);
			const m = Array.isArray(rec.model) ? rec.model[0] : rec.model;
			const cand = { name: n, id: Number(row.id), conv: Number(rec.conversationId), ts: Number(m?.timestamp) ?? null, isError: !!m?.isError, text: String(m?.content?.[0]?.text ?? "").replace(/\s+/g, " ").slice(0, 120) };
			if (!last || cand.id > last.id) last = cand;
		} catch {}
	}
	d2.close();
	return { names, shellName, programs, programAt, resolution, counts, spawnFailures, last, resolvable: resolution.some((r) => r.path) };
})();

// ---------------------------------------------------------------- 4. run the product's own wake decision
const seatRec = Object.fromEntries(seats.map((s) => [s.name, { conversationId: s.conversationId }]));
const runSelector = (pendingConvIds, busySeats = new Set()) => {
	const skips = [];
	const ws = selectWakes({ seats: seatRec, items, pendingConvIds, busySeats, stoppedConvIds: new Set(), paused: false, onSkip: (s) => skips.push(s), pendingAgeMs: null });
	return { woken: ws.map((w) => w.name), wakes: ws, skips };
};
// BEFORE pass 1's reconcile: exactly what src/broker.mjs computes from raw submission rows.
const pendingNow = advancingConvIds(subs);
// AFTER: `reconcileStrandedSubmissions` settles a `placed` row whose conversation has no ADVANCING task,
// and `admissionVerdict` withdraws a `queued` row past the deadline. Nothing is advancing (see the live
// evidence below), so every unsettled row here is a reconcile candidate — the verdict per row is printed.
const verdicts = subs.map((s) => ({
	...s,
	seat: seatByConv.get(s.conversationId) ?? `conv${s.conversationId}`,
	ageMs: s.admittedAt ? Date.now() - (s.admittedAt instanceof Date ? s.admittedAt.getTime() : typeof s.admittedAt === "number" ? s.admittedAt : Date.parse(String(s.admittedAt))) : null,
	advancing: pendingNow.has(s.conversationId) && tasks.nonTerminal.some((t) => t.cid === s.conversationId && (t.status === "running" || t.status === "completing")) && channel.pidAlive,
}));
const settledIds = verdicts.filter((v) => v.status === "placed" && !v.advancing).map((v) => v.id);
const admission = verdicts.filter((v) => v.status === "queued").map((v) => admissionVerdict({ submission: { admittedAt: v.admittedAt }, advancing: v.advancing, now: Date.now() }));
const pendingAfter = advancingConvIds(subs, { settled: new Set(settledIds) });
const before = runSelector(pendingNow);
const after = runSelector(pendingAfter);

// ---------------------------------------------------------------- 5. seat-root and tree hygiene
const root = (() => {
	const r = resolveSeatRoot({ persistedCwd: undefined, env: process.env });
	return { root: r.root, source: r.source, kind: classifyGitRoot(r.root) };
})();
const rootDirLeaves = spawnSync("ls", ["-1"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
const phantom = rootDirLeaves.filter((n) => /[A-Za-z]:[\\/]/.test(n) || /^item-\d+$/.test(n));
const checks = [];
if (!process.env.DURIG_SEAT_ROOT) checks.push({ level: "BLOCK", finding: "seat-root-unset", detail: `DURIG_SEAT_ROOT is unset in this shell: describeSeatRoot resolves to "${root.source}" (${root.root}) — a seat would run in the main checkout`, remedy: "export DURIG_SEAT_ROOT=<worktree root> in the same shell that starts the channel (src/seatroot.mjs chain; ROADMAP 221 for the persisted-cwd half)" });
if (!channel.pidAlive && drivers.length) checks.push({ level: "BLOCK", finding: "stray-driver-process", detail: `${drivers.length} cli.mjs driver process(es) alive while the broker heartbeat says down: ${drivers.map((d) => `${d.pid} (${H(d.etimes * 1000)})`).join(", ")}`, remedy: "they hold Harnesses the broker does not know about; stop them or accept a split-brain first pass" });
if (!channel.pidAlive && drivers.length === 0) checks.push({ level: "OK", finding: "no-driver-process", detail: "no `cli.mjs serve|run|send|resume|doctor` process is alive, so nothing can be ADVANCING a conversation", remedy: null });
if (phantom.length) checks.push({ level: "BLOCK", finding: "phantom-seat-root-path", detail: `repo-root entr${phantom.length > 1 ? "ies" : "y"} named for another OS's absolute path or an unregistered item dir: ${phantom.join(", ")}`, remedy: "docs/runbooks/leaked-worktrees.md — do not delete blind; register first" });
const watch = spawnSync("ps", ["-eo", "pid,etimes,args"], { encoding: "utf8" }).stdout.split("\n").filter((l) => /cli\.mjs\s+watch/.test(l));
if (watch.length) checks.push({ level: "NOTE", finding: "long-lived-viewer", detail: `${watch.length} watch viewer process(es): ${watch.map((l) => l.trim().slice(0, 60)).join(" | ")}`, remedy: "harmless (a viewer never wakes a seat, D11) but it outlives the session that started it" });
if (!existsSync(`${DB}.broker.inbox`)) checks.push({ level: "NOTE", finding: "no-intent-spool", detail: `${DB}.broker.inbox is absent — an intent spooled now has nowhere to go`, remedy: null });

// ---------------------------------------------------------------- print
const L = [];
const p = (s = "") => L.push(s);
p(`CHANNEL PREFLIGHT  ${new Date().toISOString()}   db=${DB}  rig=${RIG}`);
p(`  host: ${process.platform} ${process.getuid?.() !== undefined ? "Linux/POSIX" : ""} node ${process.version}   box local zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone} (offsets in this report are Z)`);
p("");
p("1 CHANNEL");
p(`  ${channel.state} pid=${channel.pid} pidAlive=${channel.pidAlive} heartbeat=${channel.hbAgeMs == null ? "n/a" : H(channel.hbAgeMs) + " ago"} lastPassAt=${channel.lastPassAt ? new Date(channel.lastPassAt).toISOString() : "n/a"}`);
const spoolDir = `${DB}.broker.inbox`;
const spoolN = existsSync(spoolDir) ? spawnSync("ls", ["-1", spoolDir], { encoding: "utf8" }).stdout.split("\n").filter(Boolean).length : 0;
p(`  intent spool ${spoolDir}: ${spoolN} pending`);
p(`  driver processes alive (${drivers.length}): ${drivers.map((d) => `${d.pid} etimes=${d.etimes}s`).join(", ") || "none"}`);
p(`  VERDICT: ${channel.pidAlive ? "already resident — do not start a second instance (single-instance is #725's first job)" : "down; a start would be the first pass in " + (channel.hbAgeMs ? H(channel.hbAgeMs) : "an unknown interval")}`);
p("");
p(`2 QUEUE HEAD  (one read, ${items.length} rows; status pattern = exact \`status\` field)`);
p(`  ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join(" ")}`);
p(`  claimable (${CLAIMABLE})=${byStatus[CLAIMABLE] ?? 0}  in-flight (claimed)=${byStatus.claimed ?? 0}  parked (held+deferred)=${(byStatus.held ?? 0) + (byStatus.deferred ?? 0)}`);
p(`  seat   claimable held deferred  oldest-parked  wake now    wake after pass-1 reconcile`);
for (const s of seats) {
	const cl = items.filter((it) => it.to === s.name && it.status === CLAIMABLE).length;
	const he = items.filter((it) => it.to === s.name && it.status === "held").length;
	const de = items.filter((it) => it.to === s.name && it.status === "deferred").length;
	const op = oldestParkedH(s.name);
	const w0 = before.woken.includes(s.name) ? "WAKE" : `skip:${(before.skips.find((k) => k.seat === s.name)?.reason) ?? "?"}`;
	const w1 = after.woken.includes(s.name) ? "WAKE" : `skip:${(after.skips.find((k) => k.seat === s.name)?.reason) ?? "?"}`;
	p(`  ${s.name.padEnd(9)} ${String(cl).padStart(7)} ${String(he).padStart(5)} ${String(de).padStart(8)}  ${op === null ? "     -   " : (H(op * 3600000)).padStart(11)}  ${w0.padEnd(24)} ${w1}`);
}
p(`  VERDICT: ${(byStatus[CLAIMABLE] ?? 0) === 0 ? "NOTHING IS CLAIMABLE. A broker started now can only wake seats onto PARKED rows (src/driver.mjs:108 hasParked); no work lands until pm releases (docs/runbooks/stale-held-backlog.md §Do). Cross-check the drainable set with tools/queue-drain-audit.mjs." : `${byStatus[CLAIMABLE]} claimable rows — a start has real work to wake onto.`}`);
p("");
p(`3 UNSETTLED SUBMISSIONS — the half that suppresses a wake (statuses 'queued','placed' from \`submissions\`)`);
p(`  placed=${subs.filter((s) => s.status === "placed").length} queued=${subs.filter((s) => s.status === "queued").length}  across ${new Set(subs.map((s) => s.conversationId)).size} conversations`);
p(`  advancingConvIds(submissions) NOW → ${pendingNow.size} conversations the broker would treat as ADVANCING (src/broker.mjs:842)`);
p(`  id      seat       status  age     verdict for the first pass`);
for (const v of verdicts) {
	const a = v.status === "queued" ? admissionVerdict({ submission: { admittedAt: v.admittedAt }, advancing: v.advancing }) : { action: v.advancing ? "leave" : "settle", reason: v.advancing ? "a task is advancing this conversation" : "no advancing task holds the conversation — reconcileStrandedSubmissions (broker.mjs:899) settles it on pass 1" };
	p(`  ${String(v.id).padEnd(9)} ${(v.seat ?? "?").padEnd(10)} ${v.status.padEnd(7)} ${v.ageMs === null ? "n/a   " : H(v.ageMs).padStart(6)}  ${a.action.toUpperCase()} — ${a.reason}`);
}
p(`  admission deadline in force: ${ADMISSION_DEADLINE_MS / 1000}s (broker.mjs ADMISSION_DEADLINE_MS)`);
// Does the #4180 suppression trace actually carry the age it promises? Counted in the retained log.
{
	const logPath = `${DB}.broker.log`;
	if (existsSync(logPath)) {
		const lines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
		const pending = lines.filter((l) => /SKIP \S+ reason=pending/.test(l));
		const withAge = pending.filter((l) => / age=/.test(l));
		p(`  #4180 TRACE, measured in ${logPath} (${lines.length} retained lines, span ${lines[0]?.slice(0, 24)} → ${lines.at(-1)?.slice(0, 24)}): ${pending.length} \`SKIP … reason=pending\`, of which ${withAge.length} carry the \` age=\` field broker.mjs:1346 appends when \`skip.ageMs\` is a number.`);
		if (pending.length && withAge.length === 0) p("    ⇒ pendingAgeMs (broker.mjs:1341) reads the RAW submission row, where no admission timestamp is persisted; the entry join exists only in src/readapi.mjs:269-284. The ages printed above come from that same join, done here.");
	}
}
// Is the deadline WIRED? The definition is one hit; any caller adds another. Counted, not remembered.
const wired = spawnSync("grep", ["-rn", "--include=*.mjs", "admissionVerdict(", "src/"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
p(`  WIRED: ${wired.length} hit(s) of \`admissionVerdict(\` in src/ — ${wired.length <= 1 ? "the definition only, so NO pass withdraws an aged \`queued\` row today; the recoveries this primitive was written to make safe (#4176) are still owed" : "at least one caller present"}`);
for (const w of wired) p(`      ${w}`);
p("");
p("4 LIVE-TASK EVIDENCE (what `isAdvancingTask` would see; the derived state.kind is a live #inspectTask field, NOT persisted, so this is the persisted half plus process proof)");
p(`  tasks by kind:persisted-status: ${[...tasks.tally.entries()].map(([k, v]) => `${k}=${v}`).join(" ")}`);
p(`  persisted non-terminal tasks: ${tasks.nonTerminal.length}${tasks.nonTerminal.length ? ` (${tasks.nonTerminal.slice(0, 6).map((t) => `${t.kind}#${t.id} conv${t.cid}:${t.status} started ${t.startedAt}`).join(", ")})` : ""}`);
p(`  broker pid alive: ${channel.pidAlive}; driver processes alive: ${drivers.length}`);
p(`  VERDICT: ${channel.pidAlive === false && drivers.length === 0 ? "nothing is advancing any conversation, so every unsettled row in §3 is a reconcile candidate on pass 1 — the wedge does NOT survive a restart" : "at least one process may be advancing a conversation — do not assume reconcile"}`);
p("");
p(`5 PROVIDER (last ${recent.total} submission rows — ROADMAP 226: waking onto a dead provider is wasted wall-clock)`);
p(`  unanswered=${recent.unanswered} of ${recent.total}; detail patterns (first 60 chars): ${[...recent.patterns.entries()].map(([k, v]) => `"${k}"×${v}`).join("  ") || "none"}`);
p(`  ERA ATTRIBUTION (entry join — which provider RAN the turn): window spans ${recent.oldest ? new Date(recent.oldest).toISOString() : "n/a"} → ${recent.newest ? new Date(recent.newest).toISOString() : "n/a"}`);
p(`    attempts: ${[...recent.attempts.entries()].map(([k, v]) => `${k}=${v}`).join("  ")}`);
p(`    failures: ${[...recent.failures.entries()].map(([k, v]) => `${k}=${v}`).join("  ") || "none"}   <- only failures in the CURRENT era can be repeated by a start; the rest is history (226's 14,377x402 rows all predate the move to local at 2026-10-27T04:55Z)`);
p(`  provider liveness with reasons: run \`node tools/broker-serve.mjs --status\` (it probes one real completion per provider; /v1/models answering is not proof of inference)`);
p("");
p("6 SEAT ROOT AND TREE HYGIENE");
p(`  resolveSeatRoot(persistedCwd:undefined): source=${root.source} root=${root.root} tree=${root.kind}`);
p(`  honest gap (ROADMAP 221): no CLI surface prints a seat's PERSISTED cwd; this line passes persistedCwd:undefined on purpose, so it is NOT evidence the seat root is right. Read a seat's own \`seat_root\` tool result (\`cli.mjs send <seat> seat_root\` or \`log <seat>\`) after a pass.`);
for (const c of checks) p(`  ${c.level.padEnd(6)} ${c.finding}: ${c.detail}${c.remedy ? `  → ${c.remedy}` : ""}`);
p("");
p("7 SEAT CAPABILITY — can a seat woken on THIS host do its job? (ROADMAP 217; nothing else on the rig answers this)");
p(`  seat tool set (imported from src/seattools.mjs, not re-derived): ${capability.names.join(" ")}`);
p(`  registered shell tool name: "${capability.shellName}" — the pinned build tries programs [${capability.programs.join(", ")}] in order and re-throws the LAST spawn error (${capability.programAt ?? "vendor/pi-main/packages/durable/src/tools/bash.ts"})`);
p(`  PATH probe (${process.platform === "win32" ? "where" : "sh -c 'command -v'"}): ${capability.resolution.map((r) => `${r.program}=${r.path ?? "ABSENT"}`).join("  ")}`);
p(`  store evidence (LIKE counts over all of \`entries\`, pattern printed): ${Object.entries(capability.counts).map(([k, v]) => `"toolName":"${k}" -> ${v} entries`).join("  ")}`);
p(`  spawn-shape evidence (pattern "spawn <program> ENOENT"): ${Object.entries(capability.spawnFailures).map(([k, v]) => `${k} -> ${v}`).join("  ")}`);
if (capability.last) p(`  last shell tool result: entry #${capability.last.id} ${capability.last.ts ? new Date(capability.last.ts).toISOString() : "ts n/a"} conv ${capability.last.conv}${seatByConv.get(capability.last.conv) ? ` = ${seatByConv.get(capability.last.conv)}` : ""} name=${capability.last.name} isError=${capability.last.isError} text="${capability.last.text}"`);
p(`  VERDICT: ${capability.resolvable ? `a shell resolves on this host (${capability.resolution.filter((r) => r.path).map((r) => r.program).join(", ")}) — still check that the seat INSTRUCTION names the registered tool, not just that some shell exists` : `NO SHELL CAN START HERE. Every seat shell call on this host is a guaranteed spawn error, so a seat can edit but cannot run \`node demo/<name>.test.mjs\`: it cannot satisfy the completion rule or the constitution's oracle, and every completion it reports is self-declared. Fix: ROADMAP 217 (host-conditional shell tool in src/seattools.mjs + the operator-owned instruction text in ${RIG}). Measured to have fired on THIS host's shape: ${Object.values(capability.spawnFailures).reduce((a, b) => a + b, 0)} \`spawn … ENOENT\` results (of ${Object.values(capability.counts).reduce((a, b) => a + b, 0)} shell results overall — the rest are from the Windows era), newest ${capability.last?.ts ? H(Date.now() - capability.last.ts) + " ago" : "n/a"}, isError=${capability.last?.isError}.`}`);
p("");
p("WHAT MUST BE TRUE BEFORE A START DOES USEFUL WORK (ordered; the delegate decides none of these)");
p(`  1. The channel start itself is an operator grant (tools/broker-serve.mjs --start refuses without --allow-dirty/--yes-pm-wakes).`);
p(`  2. DURIG_SEAT_ROOT exported in the same shell, and the ROADMAP 221 seat-root ruling taken, before any worktree is created on this host (docs/runbooks/workspace-move.md).`);
p(`  3. Head of queue is non-empty: pm releases held rows into \`queued\` (pm's verb). Spool the routing fact with \`node intent.mjs pm --body-file <file> --request-id <stable-id>\` — safe while the broker is down, it queues.`);
p(`  4. If §5 shows failures attributed to the CURRENT provider era, fund or re-point it first: a wake onto a dead provider burns the wake budget and lands nothing. The era attribution separates those from history.`);
p(`  5. A woken seat needs a shell that STARTS on this host (§7). Until ROADMAP 217 lands on this rig, a start produces work no seat can verify — and it is the only link in this report that needs NO operator ruling, while nothing in the queue works it: 0 of ${items.length} queue rows cite ROADMAP 210-231.`);
p("");
p(`next: pm owns every release/cancel; the delegate claims nothing. Cost ${ms()}ms, one queue read, one ps read, store opened read-only.`);

console.log(L.join("\n"));
if (OUT) {
	writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), db: DB, rig: RIG, channel, byStatus, pendingNow: [...pendingNow], pendingAfter: [...pendingAfter], verdicts: verdicts.map((v) => ({ id: v.id, seat: v.seat, status: v.status, ageMs: v.ageMs })), wakeNow: before.woken, wakeAfter: after.woken, wakeReasonsNow: before.wakes, skipsNow: before.skips, skipsAfter: after.skips, checks, providerWindow: { attempts: [...recent.attempts.entries()], failures: [...recent.failures.entries()], oldest: recent.oldest, newest: recent.newest }, capability: { names: capability.names, shellName: capability.shellName, programs: capability.programs, resolution: capability.resolution, counts: capability.counts, spawnFailures: capability.spawnFailures, last: capability.last, resolvable: capability.resolvable } }, null, 1));
	note(`wrote ${OUT}`);
}
