#!/usr/bin/env node
// tools/harness-usage-census.mjs — how often past sessions actually used each instrument, vs re-deriving it by hand.
//
// WHY THIS EXISTS. The operator's question on 2026-10-28 was: "are the tools and skills you build for yourself ever used
// again?" That is measurable, because the host harness persists every session it runs in this working directory
// (`~/.pi/agent/sessions/<encoded cwd>/*.jsonl`, one entry per message/tool call). Nobody had read those files in any
// durian-pi session. Measured here: 87 sessions, 11,586 `bash` calls, and **2,086 of them (18%) are one-off measurement
// code** (`node -e`, `sqlite3`, `node:sqlite`, `DatabaseSync`) — re-deriving answers a tracked script already gives.
// Instruments named in `docs/NEXT.md`'s baseline are reused across sessions (suite 21 sessions, `clockin` 13,
// `broker-serve` 8); freshly created ones die after 1–2 sessions. That is the cost this tool exists to make visible:
// an instrument that is never re-run is a cost, not an asset. See docs/reviews/pi-harness-usage-audit-2026-10-28.md.
//
// IT IS A READ. It opens every transcript read-only, writes nothing, mutates nothing.
//
// BOUNDS (each prints, because an uncounted cap is how a silent miss comes back — docs/SELFDEV.md, D142):
//   * only files ending in `.jsonl` directly inside the named directories (no recursion, no whole-filesystem search);
//   * per-session tool-name counts are capped at --top (default 12) and say when they were cut.
//
// usage:
//   node tools/harness-usage-census.mjs <session-dir> [<session-dir> ...]        # totals + per-instrument spread
//   node tools/harness-usage-census.mjs <dir> --tools a,b,c                      # restrict the instrument list
//   node tools/harness-usage-census.mjs <dir> --sessions                         # per-session table, oldest first
//   node tools/harness-usage-census.mjs <dir> --top 30                           # widen the tool-name table
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const argv = process.argv.slice(2);
const flag = (name) => {
	const i = argv.indexOf(`--${name}`);
	if (i < 0) return null;
	argv.splice(i, 1);
	return true;
};
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	if (i < 0) return dflt;
	const v = argv[i + 1];
	argv.splice(i, 2);
	return v;
};

const dirs = argv.filter((a) => !a.startsWith("--"));
if (!dirs.length) {
	console.error("usage: node tools/harness-usage-census.mjs <session-dir> [<session-dir> ...] [--tools a,b] [--sessions] [--top N]");
	process.exit(2);
}

// The instrument list is deliberately over-broad: it is the delegate's own toolbelt for this rig. Anything not present
// simply counts 0, which is itself the finding.
let TOOLS = (opt("tools", "") || "").split(",").filter(Boolean);
if (!TOOLS.length) {
	TOOLS = [
		"cli.mjs", "scripts/suite.mjs", "scripts/clockin.mjs", "intent.mjs", "demo/", "staging.mjs",
		"tools/channel-preflight.mjs", "tools/broker-serve.mjs", "tools/broker-read.mjs", "tools/queue-drain-audit.mjs",
		"tools/latency-budget.mjs", "tools/instrument-provenance.mjs", "tools/what-to-test.mjs",
		"tools/edit-failure-rate.mjs", "tools/vendor-pins.mjs", "tools/competitor-brief.mjs", "tools/mirror-constitution.mjs",
		"model-probes/", "docs/NEXT.md", "docs/DECISIONS.md", "docs/ROADMAP.md", "docs/runbooks", ".agents/skills", ".spike/",
	];
}
const ADHOC = [/\bnode\s+-e\b/, /\bsqlite3\b/, /node:sqlite/, /better-sqlite3/, /new Database\(/, /DatabaseSync/, /\bgrep\b.*selfdev\.sqlite/, /\bcat\b.*selfdev\.sqlite/];
const top = Number(opt("top", "12"));
const wantSessions = flag("sessions");

const per = new Map(); // session file -> {ts, calls, tools:{}, adhoc, names:{}}
let files = 0, skipped = 0, bytes = 0;

for (const dir of dirs) {
	let names;
	try {
		names = readdirSync(dir);
	} catch (e) {
		console.error(`SKIP ${dir}: ${e.code ?? e.message}`);
		skipped++;
		continue;
	}
	for (const f of names.filter((n) => n.endsWith(".jsonl")).sort()) {
		const p = join(dir, f);
		bytes += statSync(p).size;
		files++;
		const o = { ts: (f.match(/^(\d{4}-\d\d-\d\d)T(\d\d-\d\d)/) ?? [, "", ""]).slice(1).join(" "), calls: 0, tools: {}, adhoc: 0, names: {} };
		per.set(`${f.slice(0, 20)} @${dir.split("/").pop().slice(-24)}`, o);
		for (const line of readFileSync(p, "utf8").split("\n").filter(Boolean)) {
			let e;
			try { e = JSON.parse(line); } catch { continue; }
			const c = e.message?.content;
			if (e.message?.role !== "assistant" || !Array.isArray(c)) continue;
			for (const x of c) {
				if (x?.type !== "toolCall") continue;
				o.names[x.name] = (o.names[x.name] ?? 0) + 1;
				const cmd = String(x.arguments?.command ?? "");
				const target = x.name === "bash" ? cmd : `${x.arguments?.path ?? ""} ${cmd}`;
				if (cmd) o.calls++;
				for (const t of TOOLS) if (target.includes(t)) o.tools[t] = (o.tools[t] ?? 0) + 1;
				if (cmd && ADHOC.some((re) => re.test(cmd))) o.adhoc++;
			}
		}
	}
}

const tot = { adhoc: 0, calls: 0 };
const spread = new Map(); // tool -> {calls, sessions:Set}
const nameTot = {};
for (const o of per.values()) {
	tot.adhoc += o.adhoc;
	tot.calls += o.calls;
	for (const [k, v] of Object.entries(o.names)) nameTot[k] = (nameTot[k] ?? 0) + v;
	for (const [k, v] of Object.entries(o.tools)) {
		const s = spread.get(k) ?? { calls: 0, sessions: new Set() };
		s.calls += v;
		s.sessions.add(k === "" ? 0 : 1);
		spread.set(k, s);
	}
}
// second pass for session spread (a Set keyed on session file)
spread.clear();
for (const [sess, o] of per) {
	for (const k of Object.keys(o.tools)) {
		const s = spread.get(k) ?? { calls: 0, sessions: new Set() };
		s.calls += o.tools[k];
		s.sessions.add(sess);
		spread.set(k, s);
	}
}

console.log(`## HARNESS USAGE CENSUS  (read-only)`);
console.log(`sessions=${per.size} from ${dirs.length} dir(s) (${files} transcript files, ${bytes} B, skipped ${skipped} unreadable dir(s))`);
console.log(`tool calls=${tot.calls}  of which AD-HOC MEASUREMENT=${tot.adhoc} (${((tot.adhoc / Math.max(1, tot.calls)) * 100).toFixed(1)}%) — one-off measurement code, the re-derivation tax`);

console.log(`\n## per-instrument reuse (the question: does it survive a session boundary?)`);
console.log(`${"pattern".padEnd(24)} ${"calls".padStart(6)} ${"sessions".padStart(9)}   share-of-sessions`);
const rows = [...spread.entries()].sort((a, b) => b[1].calls - a[1].calls);
for (const [k, v] of rows) {
	console.log(`${k.padEnd(24)} ${String(v.calls).padStart(6)} ${String(v.sessions.size).padStart(9)}   ${((v.sessions.size / Math.max(1, per.size)) * 100).toFixed(0)}%`);
}
const never = TOOLS.filter((t) => !spread.has(t));
if (never.length) console.log(`never used in any session: ${never.join(", ")}`);

const names = Object.entries(nameTot).sort((a, b) => b[1] - a[1]);
console.log(`\n## tool names called (showing ${Math.min(top, names.length)} of ${names.length})`);
for (const [n, c] of names.slice(0, top)) console.log(`  ${String(c).padStart(6)}  ${n}`);

if (wantSessions) {
	console.log(`\n## per-session (oldest first; adhoc = one-off measurement calls)`);
	console.log(`${"session".padEnd(32)} ${"calls".padStart(6)} ${"adhoc".padStart(6)}  ${TOOLS.map((t) => t.replace(/^(tools|scripts|docs)\//, "").slice(0, 10).padStart(11)).join("")}`);
	for (const [sess, o] of [...per.entries()].sort((a, b) => a[1].ts.localeCompare(b[1].ts))) {
		console.log(`${sess.padEnd(32)} ${String(o.calls).padStart(6)} ${String(o.adhoc).padStart(6)}  ${TOOLS.map((t) => String(o.tools[t] ?? "").padStart(11)).join("")}`);
	}
}
