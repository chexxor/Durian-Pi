#!/usr/bin/env node
// scripts/clockin.mjs — the cold-start digest: ONE read-only call that replaces the whole
// clock-in ritual (D126; documented in docs/DELEGATE-CLOCKIN.md; the permanent form of the
// `.spike/delegate/clockin.mjs` prototype).
//
// WHY THIS EXISTS, with the numbers that justify it (measured on this repo, 2026-10-25):
//   docs/NEXT.md before its split   394,106 B / 4,724 lines  ~99,000 tok, and it overflowed a
//                                   50 KB / 2,000-line read cap into EIGHT chunked reads
//   docs/SELFDEV.md                  57,589 B /   749 lines  ~14,400 tok
//   cli.mjs status                22,740,436 B                ~5,700,000 tok if it ever reaches
//                                   21,168,982 B (queue)        a session, which is 100x the ritual
// Reading the docs "as the runbook says" cost ~113,000 tokens before any work started. This prints
// the same decision-relevant state in ONE tool call, under 20 KB, and it is deliberately bounded:
// it prints counts, ids and one-line reasons — NEVER queue row bodies, because bodies are the
// entire reason those verbs are tens of megabytes.
//
// IT IS A READ. It opens no write verb, mutates no store, and writes nothing outside its own
// process. If it disagrees with the store, the store is right and this file is wrong.
//
// usage:
//   node scripts/clockin.mjs                 # digest of DURIG_PI_DB / DURIG_DB (default ./selfdev.sqlite)
//   node scripts/clockin.mjs --db <path>     # a specific store
//   node scripts/clockin.mjs --json          # the sections as one JSON document
//   node scripts/clockin.mjs --no-git        # skip the branch/worktree debt walk
//   node scripts/clockin.mjs --no-runbooks   # skip the runbook staleness probe

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The live file is read WHOLE by every session that follows it, so its length is a cost every later
// session pays. demo/next-pointer.test.mjs caps docs/NEXT.md at the same number.
export const POINTER_CAP_LINES = 200;
// The digest's own budget. Above this it has started reproducing the dumps it exists to avoid.
export const DIGEST_BUDGET_BYTES = 20000;

/** The first `## NEXT SESSION` section of a NEXT.md-style file, verbatim. Nothing else. */
export function pointerSection(text) {
	const lines = text.split(/\r?\n/);
	const at = lines.findIndex((l) => /^## NEXT SESSION\b/.test(l));
	if (at < 0) return { lines: [], start: -1, end: -1, fileLines: lines.length };
	const next = lines.findIndex((l, i) => i > at && /^## /.test(l));
	const end = next < 0 ? lines.length : next;
	return { lines: lines.slice(at, end), start: at + 1, end, fileLines: lines.length };
}

/**
 * Is the broker actually running? A `*.broker.json` file is NOT proof: the state file names a PID,
 * and PIDs get recycled. On 2026-10-25 the state file named pid 14784, which `tasklist` showed was
 * `svchost.exe` — a session that trusted the file would have reported a running rig.
 *
 * @param {object} o
 * @param {string} o.stateFile        path to `<db>.broker.json`
 * @param {(pid:number)=>boolean} [o.probe]  liveness probe (default: tasklist on Windows, signal 0 elsewhere)
 * @param {number} [o.now]
 */
export function brokerLiveness({ stateFile, probe = pidAlive, now = Date.now() }) {
	if (!existsSync(stateFile))
		return { state: "NO STATE FILE", detail: `${stateFile} does not exist` };
	let s;
	try {
		s = JSON.parse(readFileSync(stateFile, "utf8"));
	} catch (e) {
		return { state: "UNREADABLE", detail: `${stateFile}: ${e.message}` };
	}
	const alive = Number.isInteger(s.pid) && probe(s.pid);
	const ageMin = Number.isFinite(s.lastPassAt) ? Math.round((now - s.lastPassAt) / 60000) : null;
	return {
		state: alive ? "UP" : "DOWN",
		pid: s.pid,
		since: s.since ?? null,
		lastPassAt: Number.isFinite(s.lastPassAt) ? new Date(s.lastPassAt).toISOString() : null,
		ageMin,
		detail: `${alive ? "UP" : "DOWN"} pid=${s.pid} lastPassAt=${
			Number.isFinite(s.lastPassAt) ? new Date(s.lastPassAt).toISOString() : "?"
		} age=${ageMin === null ? "?" : ageMin} min`,
	};
}

/** Is this PID live AND still a node process? The name check is what catches a recycled PID. */
export function pidAlive(pid) {
	if (!Number.isInteger(pid) || pid <= 0) return false;
	if (process.platform === "win32") {
		try {
			const out = execFileSync("tasklist", ["/FI", `PID eq ${pid}`, "/NH"], {
				encoding: "utf8",
				stdio: ["ignore", "pipe", "ignore"],
				timeout: 8000,
			});
			return /\bnode\.exe\b/i.test(out);
		} catch {
			return false;
		}
	}
	try {
		process.kill(pid, 0);
		return true;
	} catch (e) {
		return e && e.code === "EPERM";
	}
}

/** Status counts by row status. Bodies are never part of this. */
export function queueCounts(items) {
	const counts = {};
	for (const it of items || []) counts[it.status] = (counts[it.status] || 0) + 1;
	return counts;
}

/** Runbook staleness: a dated `last_verified` older than a git change to a file the runbook names. */
export function staleRunbooks({ root = process.cwd() }) {
	const dir = resolve(root, "docs/runbooks");
	if (!existsSync(dir)) return { dated: 0, stale: [], probeFailures: 0 };
	const rows = [];
	let probeFailures = 0;
	const names = readdirSync(dir)
		.filter((n) => n.endsWith(".md") && n !== "_template.md" && n !== "README.md")
		.sort();
	for (const f of names) {
		const text = readFileSync(resolve(dir, f), "utf8");
		const fm = text.match(/^---\s*\n([\s\S]*?)\n---/);
		if (!fm) continue;
		// Frontmatter is read with a regex, not a YAML parse: the one key this probe needs is scalar,
		// and a dependency-free read keeps this tool usable from a bare checkout.
		const lv = (fm[1].match(/^last_verified:\s*"?([0-9]{4}-[0-9]{2}-[0-9]{2})"?/m) || [])[1];
		if (!lv) continue;
		const changed = [];
		for (const p of new Set(
			text.slice(fm[0].length).match(/(?:src|docs|scripts|demo)\/[\w./-]+\.\w+/g) || [],
		)) {
			if (!existsSync(resolve(root, p))) continue;
			try {
				const out = execFileSync(
					"git",
					["-C", root, "log", "--format=%H", `--since=${lv}`, "--", p],
					{
						encoding: "utf8",
						stdio: ["ignore", "pipe", "ignore"],
						timeout: 10000,
					},
				).trim();
				if (out) changed.push(p);
			} catch {
				probeFailures += 1; // a failed probe is NOT "not stale"
			}
		}
		rows.push({ file: f, last: lv, changed });
	}
	return { dated: rows.length, stale: rows.filter((r) => r.changed.length > 0), probeFailures };
}

/** Render the digest from already-read state. Pure: nothing here touches git, the store, or the network. */
/**
 * The suite marker is written by whoever last ran the suite, and the shapes used so far disagree: the .spike
 * prototype wrote `{pass,total,at,sha}`, the later marker writes `{suite,main,measured_at}`. A reader that assumes
 * one shape prints "last suite: undefined/undefined at undefined", which is worse than printing nothing because it
 * reads like a result. Accept either, and say out loud when the marker describes a different main.
 */
export function suiteMarker(jsonText, currentMain = null) {
	let m;
	try {
		m = JSON.parse(jsonText);
	} catch {
		return "last suite: marker is not readable JSON — re-run node scripts/test.mjs";
	}
	const result =
		m.result ??
		(m.pass !== undefined && m.total !== undefined ? `${m.pass}/${m.total}` : undefined) ??
		(typeof m.suite === "string" ? m.suite : undefined) ??
		"no result field in the marker";
	const at = m.at ?? m.measured_at ?? "time unknown";
	const main = m.main ?? m.sha ?? "main unknown";
	const same =
		main === "main unknown" ||
		currentMain === null ||
		currentMain.startsWith(main) ||
		main.startsWith(currentMain);
	// The marker's `note` is scratch prose written by whoever ran the suite; the digest carries a line, not the file.
	const note = typeof m.note === "string" ? m.note.slice(0, 200) : "no note";
	return `last suite: ${result} at ${at} (main ${main}${same ? "" : ` — STALE: main is now ${currentMain}`}) — ${note}`;
}

export function renderDigest(s) {
	const out = [];
	const say = (...a) => out.push(a.join(" "));
	say(
		`## POINTER (docs/NEXT.md lines ${s.pointer.start}-${s.pointer.end} of ${s.pointer.fileLines}; cap ${POINTER_CAP_LINES})`,
	);
	say(s.pointer.lines.join("\n"));
	say("\n## RIG");
	const fails = {};
	for (const a of s.attention || [])
		if (a.kind === "last_run_failed") fails[a.seat] = String(a.detail || "").slice(0, 70);
	const parked = {};
	for (const a of s.attention || [])
		if (a.kind === "deferred_awaiting_answer") parked[a.seat] = a.detail;
	say(`seats: ${s.seats}  attention: ${(s.attention || []).length}`);
	say(`last_run_failed: ${JSON.stringify(fails)}`);
	if (Object.keys(parked).length) say(`deferred_awaiting_answer: ${JSON.stringify(parked)}`);
	say(`broker: ${s.broker.detail}`);
	say(`\n## QUEUE  ${(s.items || []).length} rows ${JSON.stringify(s.counts)}`);
	const human = (s.items || [])
		.filter((i) => i.status === "deferred")
		.map((i) => `#${i.id} (${i.to}) ${String(i.subject || "").slice(0, 55)}`);
	if (human.length) say(`deferred (awaiting the operator): ${human.join(" · ")}`);
	if (s.git) {
		say(`\n## GIT  refs=${s.git.refs} worktrees=${s.git.worktrees} unmerged=${s.git.debt.length}`);
		if (s.git.debt.length) say(s.git.debt.join(" · "));
	}
	if (s.runbooks) {
		say(
			`\n## RUNBOOKS  dated ${s.runbooks.dated} | stale ${s.runbooks.stale.length} | probe failures ${s.runbooks.probeFailures}`,
		);
		if (s.runbooks.stale.length) say(`stale: ${s.runbooks.stale.map((r) => r.file).join(" ")}`);
	}
	say(
		`\n## PROVIDER  ${s.config.provider} model=${s.config.model} local=${s.config.local || "NOT SET"} maxseats=${s.config.maxSeats}`,
	);
	say(`local endpoint: ${s.localEndpoint}`);
	say(`\n## READ MAP`);
	say(
		`SELFDEV (${s.selfdevLines} lines, headings below) — read the section you need, not the file.`,
	);
	say(s.selfdevHeadings.join(" · "));
	say(`ROADMAP — never read whole; grep the item number.`);
	say(s.suiteMarker || "last suite: no marker written yet");
	say(`\n## COST  ${s.ms} ms, ${out.join("\n").length} B printed`);
	return out.join("\n");
}

/* ------------------------------- the CLI half ------------------------------- */

function parseArgs(argv) {
	const opts = {
		db: process.env.DURIAN_PI_DB || process.env.DURIG_DB || "./selfdev.sqlite",
		json: false,
		git: true,
		runbooks: true,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--db") opts.db = argv[++i];
		else if (a === "--json") opts.json = true;
		else if (a === "--no-git") opts.git = false;
		else if (a === "--no-runbooks") opts.runbooks = false;
		else if (a === "--help" || a === "-h") {
			console.log(
				"usage: node scripts/clockin.mjs [--db <path>] [--json] [--no-git] [--no-runbooks]\n" +
					"Read-only cold-start digest: pointer, rig verdict, queue counts, broker liveness,\n" +
					"unmerged-branch debt, runbook staleness, provider config, read map. Never row bodies.",
			);
			process.exit(0);
		} else {
			console.error(`clockin: unknown argument ${a}`);
			process.exit(2);
		}
	}
	return opts;
}

function runCli(args, db) {
	// execFileSync, not a shell pipe: the 22 MB status document is parsed IN this process, so it never
	// reaches a session. The CLI appends a trailing `note:` line, so the JSON is taken up to the last `}`.
	const out = execFileSync(process.execPath, ["cli.mjs", ...args], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		stdio: ["ignore", "pipe", "ignore"],
		env: { ...process.env, DURIG_PI_DB: db, DURIG_DB: db },
	});
	return JSON.parse(out.slice(0, out.lastIndexOf("}") + 1));
}

// Git calls here are read-only and bounded: a hung git call would turn a 6 s clock-in into a stall, so every one
// carries a timeout and drops stderr (a "not a git repository" line is not digest material).
function gitSafe(args) {
	return execFileSync("git", args, {
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
		timeout: 15000,
		maxBuffer: 8 * 1024 * 1024,
	}).trim();
}

function branchDebt(db, items) {
	const git = gitSafe;
	const branches = git(["branch", "--format=%(refname:short)"])
		.split("\n")
		.filter((b) => b && b !== "main");
	const statusOf = new Map((items || []).map((i) => [String(i.id), i.status]));
	const debt = [];
	for (const b of branches.slice(0, 60)) {
		const ahead = Number(git(["rev-list", "--count", `main..${b}`]));
		if (!ahead) continue;
		const id = (b.match(/(\d+)/) || [])[1];
		debt.push(`${b} +${ahead} [#${id || "-"} ${statusOf.get(id) || "no-row"}]`);
	}
	return {
		refs: branches.length + 1,
		worktrees: git(["worktree", "list"]).split("\n").length,
		debt,
	};
}

async function probeLocal() {
	const port = process.env.STRATA_PORT || 8080;
	try {
		const r = await fetch(`http://127.0.0.1:${port}/v1/models`, {
			signal: AbortSignal.timeout(4000),
		});
		const j = await r.json();
		return (
			(j.data || [])
				.map((m) => `${m.id} ${m.status?.value || "?"} ctx=${m.meta?.n_ctx || "?"}`)
				.join(", ") || "empty"
		);
	} catch (e) {
		return `DOWN (${e.message})`;
	}
}

export async function main(argv = process.argv.slice(2)) {
	const t0 = Date.now();
	const opts = parseArgs(argv);
	const db = resolve(opts.db);
	const status = runCli(["status"], db);
	const config = runCli(["config"], db); // cli.mjs config puts DURIG_* at the TOP level
	const nextText = readFileSync(resolve("docs/NEXT.md"), "utf8");
	const selfdevText = readFileSync(resolve("docs/SELFDEV.md"), "utf8");
	const selfdevLines = selfdevText.split(/\r?\n/);
	let marker = null;
	try {
		marker = suiteMarker(
			readFileSync(resolve(".spike/delegate/suite-marker.json"), "utf8"),
			opts.git ? gitSafe(["rev-parse", "--short", "main"]) : null, // --no-git means "no git calls", so no staleness check either
		);
	} catch {
		marker = null;
	}
	const state = {
		pointer: pointerSection(nextText),
		seats: (status.seats || []).length,
		attention: status.attention || [],
		broker: brokerLiveness({ stateFile: `${db}.broker.json` }),
		items: status.queueItems || [],
		counts: queueCounts(status.queueItems),
		git: opts.git ? branchDebt(db, status.queueItems) : null,
		runbooks: opts.runbooks ? staleRunbooks({}) : null,
		config: {
			provider: config.DURIG_PROVIDER,
			model: config.DURIG_MODEL,
			local: config.DURIG_LOCAL_BASE_URL,
			maxSeats: config.DURIG_MAX_CONCURRENT_SEATS,
		},
		localEndpoint: await probeLocal(),
		selfdevLines: selfdevLines.length,
		selfdevHeadings: selfdevLines
			.map((l, i) => [i + 1, l])
			.filter(([, l]) => /^## /.test(l))
			.map(([n, l]) => `${l.slice(3, 52)}@${n}`),
		suiteMarker: marker,
		ms: Date.now() - t0,
	};
	const text = renderDigest(state);
	if (Buffer.byteLength(text, "utf8") > DIGEST_BUDGET_BYTES) {
		console.error(
			`clockin: digest is ${Buffer.byteLength(text, "utf8")} B, over its ${DIGEST_BUDGET_BYTES} B budget — a digest that grows into the dumps it exists to avoid has failed at its job`,
		);
	}
	if (opts.json) {
		console.log(JSON.stringify({ ...state, text }, null, 1));
	} else {
		console.log(text);
	}
	return 0;
}

// The CLI half runs only when this file is the entry point, so demo/clockin-digest.test.mjs can
// import the pure functions without executing a store read.
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || "")) {
	main().then((code) => process.exit(code ?? 0));
}
