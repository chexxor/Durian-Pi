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
// IT IS A READ. It opens no store write verb, mutates no store, and mutates no git state. It DOES
// write exactly one artifact: a greppable snapshot of the deferred-row ids (DEFERRED_LIST_FILE,
// gitignored) - the bytes that used to sit inline and grew without bound move to a file a session
// greps instead of reading whole. Nothing else is written. If it disagrees with the store, the store
// is right and this file is wrong.
//
// usage:
//   node scripts/clockin.mjs                 # digest of DURIG_PI_DB / DURIG_DB (default ./selfdev.sqlite)
//   node scripts/clockin.mjs --db <path>     # a specific store
//   node scripts/clockin.mjs --json          # the sections as one JSON document
//   node scripts/clockin.mjs --no-git        # skip the branch/worktree debt walk
//   node scripts/clockin.mjs --base <ref>    # what to measure landing debt AGAINST (default: main)
//   node scripts/clockin.mjs --no-runbooks   # skip the runbook staleness probe
//   node scripts/clockin.mjs --budget <B>    # lower the byte budget (diagnostic/test: makes the cap bite
//                                            # on demand instead of only when the store has grown)
//   node scripts/clockin.mjs --deferred-file <path>  # where the deferred-id snapshot goes
//
// exit codes: 0 = digest printed and inside its byte budget; 1 = printed but OVER budget (the cap is
// a gate, not a comment - ROADMAP 213); 2 = bad usage.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The live file is read WHOLE by every session that follows it, so its length is a cost every later
// session pays. demo/next-pointer.test.mjs caps docs/NEXT.md at the same number.
export const POINTER_CAP_LINES = 200;
// The digest's own budget. Above this it has started reproducing the dumps it exists to avoid.
export const DIGEST_BUDGET_BYTES = 20000;

// The deferred backlog is the term that was unbounded: measured at 7a1b80e2, ONE inline list of every
// deferred row was 15,244 B of a 29,046 B digest (52%), and the row count went 174 -> 207 -> 376 inside
// two windows because supervisor escalations defer rows. So the inline half is bounded by SEATS, a
// design constant, never by rows: DEFERRED_INLINE_HEAD ids per seat, and at most DEFERRED_INLINE_MAX
// entries printed no matter how many seats exist. Two per seat because a seat works its own backlog
// oldest-first (the same order the broker claims in), so the oldest two are the rows it can act on; the
// rest stay addressable by id in the snapshot file. Below DEFERRED_INLINE_MAX total rows the list is
// still printed whole - indirection costs more than it saves on a small backlog.
export const DEFERRED_INLINE_HEAD = 2;
export const DEFERRED_INLINE_MAX = 24;
// The full id list goes HERE: gitignored, grepped, never read whole by a session. Moving those bytes
// into a doc (NEXT.md, SELFDEV.md) would re-create the cost this file exists to remove.
export const DEFERRED_LIST_FILE = resolve(".durig", "clockin-deferred.txt");
// Distinct seats printed in the per-seat count line before the remainder is aggregated (seats are a
// small fixed set; the cap is paranoia, and paranoia is what keeps a bounded thing bounded).
export const DEFERRED_SEAT_MAX = 20;

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

/**
 * The QUEUE section's deferred backlog, AGGREGATED rather than shortened (#5398).
 * Row count + per-seat counts + the ids a session can act on (lowest ids per seat), and a pointer to
 * the snapshot file holding every id. Pure: `listFile` is passed in, nothing is written here.
 * Body-free like the rest of the digest - subjects are sliced, `body` never appears.
 */
export function deferredTerm(items, listFile = null) {
	const rows = (items || []).filter((i) => i.status === "deferred");
	if (!rows.length) return "";
	const bySeat = new Map();
	for (const r of rows) {
		const seat = String(r.to ?? "?");
		if (!bySeat.has(seat)) bySeat.set(seat, []);
		bySeat.get(seat).push(r);
	}
	for (const list of bySeat.values()) list.sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
	const seats = [...bySeat.entries()].sort(
		(a, b) => b[1].length - a[1].length || String(a[0]).localeCompare(String(b[0])),
	);
	const shown = seats.slice(0, DEFERRED_SEAT_MAX);
	const line = (i) => `#${i.id} (${i.to}) ${String(i.subject || "").slice(0, 55)}`;
	const out = [
		`deferred (awaiting the operator): ${rows.length} rows across ${seats.length} seat(s): ` +
			shown.map(([seat, list]) => `${seat}=${list.length}`).join(" ") +
			(seats.length > shown.length ? ` +${seats.length - shown.length} more seat(s)` : ""),
	];
	if (rows.length <= DEFERRED_INLINE_MAX) {
		const all = [...rows].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
		out.push(`  rows: ${all.map(line).join(" · ")}`);
		return out.join("\n");
	}
	const head = [];
	for (const [, list] of seats) {
		for (const r of list.slice(0, DEFERRED_INLINE_HEAD)) {
			if (head.length >= DEFERRED_INLINE_MAX) break;
			head.push(line(r));
		}
	}
	out.push(`  act next (lowest ${DEFERRED_INLINE_HEAD} id(s) per seat): ${head.join(" · ")}`);
	out.push(
		listFile
			? `  all ${rows.length} ids: ${listFile} — grep it by seat or id; do NOT read it whole (it is a snapshot of this clock-in)`
			: `  all ${rows.length} ids NOT written to a file this run — the per-seat counts above are the inline view`,
	);
	return out.join("\n");
}

/**
 * The snapshot the digest points at: one line per deferred row, `#id<TAB>seat<TAB>deferredTo<TAB>
 * subject`, sorted by id. A snapshot, so the header says when it was taken; subjects are truncated
 * because this file is for GREPPING ids, not for reading bodies.
 */
export function writeDeferredList(rows, file = DEFERRED_LIST_FILE, db = "") {
	const sorted = [...rows].sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
	const text =
		[
			`# deferred rows (awaiting the operator) — ${sorted.length} rows, written by scripts/clockin.mjs at ${new Date().toISOString()}`,
			`# store: ${db || "unknown"}. THIS IS A SNAPSHOT: it goes stale as soon as the store moves.`,
			// The pattern is printed with LITERAL backslashes, not with real tabs: a header line containing a
			// real tab matches the very grep it documents, so `grep -c -P "\t<seat>\t"` over-counted by one
			// (measured on the live store: 365 deferred rows, devtools counted 89 in the digest, 90 by grep).
			`# columns: #id <TAB> seat <TAB> deferredTo <TAB> subject(truncated)`,
			`# grep it by seat: grep -c -P "\\tdevtools\\t" ${file}  (header lines carry no real tab, so the count is exact)`,
			...sorted.map(
				(r) =>
					`#${r.id}\t${r.to ?? "?"}\t${r.deferredTo ?? "?"}\t${String(r.subject ?? "").replace(/[\t\r\n]+/g, " ").slice(0, 120)}`,
			),
		].join("\n") + "\n";
	try {
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, text);
		return file;
	} catch (err) {
		console.error(
			`clockin: could not write the deferred id list to ${file}: ${err?.message ?? err} — the digest still prints, with counts only`,
		);
		return null;
	}
}

/**
 * Does the cap bite? Over budget is a FAILURE, not a comment (ROADMAP 213: "a surface that only warns
 * degrades silently, and the next session pays the token bill"). Kept separate from main() so the
 * verdict is assertable without a 376-row store.
 */
export function budgetVerdict(text, budget = DIGEST_BUDGET_BYTES) {
	const bytes = Buffer.byteLength(text, "utf8");
	return {
		bytes,
		budget,
		ok: bytes <= budget,
		message: `clockin: digest is ${bytes} B, over its ${budget} B budget — a digest that grows into the dumps it exists to avoid has failed at its job`,
	};
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
	const deferred = deferredTerm(s.items, s.deferredFile || null);
	if (deferred) say(deferred);
	if (s.git) {
		const head = s.git.head ? `${s.git.head.state}${s.git.head.at ? `@${s.git.head.at}` : ""}` : "?";
		const baseTag = s.git.baseSha
			? `base=${s.git.base}@${s.git.baseSha.slice(0, 8)}`
			: `base=${s.git.base} UNRESOLVED`;
		say(
			`\n## GIT  refs=${s.git.refs} worktrees=${s.git.worktrees === null ? "?" : s.git.worktrees} unmerged=${s.git.debt.length} ${baseTag} head=${head}${s.git.probeFailures ? ` rev-list-failures=${s.git.probeFailures}` : ""}`,
		);
		if (s.git.skipped) say(`RANGE NOT COMPUTED: ${s.git.skipped}`);
		if (s.git.listError) say(`BRANCH LIST: ${s.git.listError}`);
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
		base: "main",
		budget: DIGEST_BUDGET_BYTES,
		deferredFile: DEFERRED_LIST_FILE,
	};
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--db") opts.db = argv[++i];
		else if (a === "--base") opts.base = argv[++i];
		else if (a === "--json") opts.json = true;
		else if (a === "--no-git") opts.git = false;
		else if (a === "--no-runbooks") opts.runbooks = false;
		else if (a === "--budget") opts.budget = Number(argv[++i]);
		else if (a === "--deferred-file") opts.deferredFile = resolve(String(argv[++i] || ""));
		else if (a === "--help" || a === "-h") {
			console.log(
				"usage: node scripts/clockin.mjs [--db <path>] [--base <ref>] [--json] [--no-git] [--no-runbooks] [--budget <B>] [--deferred-file <path>]\n" +
					"Read-only cold-start digest: pointer, rig verdict, queue counts, broker liveness,\n" +
					"unmerged-branch debt (against --base, default main; skipped with a reason if it cannot\n" +
					"resolve), runbook staleness, provider config, read map. Never row bodies. The deferred\n" +
					"backlog is printed as counts + the oldest ids per seat, with every id in a grep-able\n" +
					"snapshot file whose path the digest names. exit 0 = inside budget, 1 = over budget, 2 = bad usage.",
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

/**
 * Landing debt: which local branches carry commits the base ref does not, joined to their queue row's status.
 *
 * WHY THIS SHAPE, with the fatal that produced it (#4985, measured 2026-11-02). The first version listed
 * branches with `git branch --format=%(refname:short)` and interpolated the NAME into a range. In a DETACHED
 * worktree — which is exactly the tree `scripts/land.mjs --changed-suite` creates (`.land-scratch-<pid>` at
 * land.mjs:483-497) — git 2.56.0 emits a literal `(no branch)` entry for the detached HEAD, so the digest ran
 * `git rev-list --count main..(no branch)` → `fatal: ambiguous argument` → clockin exit 1 → the landing gate
 * stopped mid-suite. Measured in a detached scratch worktree at `43e26dcc`:
 *   `git branch --format='%(refname:short)'` → 15 lines, one of them `(no branch)`
 *   `git rev-list --count 'main..(no branch)'` → exit 128
 * Three rules come out of it, and the function is built to them:
 *   1. the branch list comes from the REFS (`for-each-ref refs/heads/`), never from a listing that decorates
 *      HEAD's state — a HEAD state is not a branch;
 *   2. every operand of a git range is a RESOLVED sha, obtained in one listing call — no name ever reaches a
 *      range, so no name can be unresolvable there;
 *   3. when the BASE itself cannot be resolved (a clone whose base is not `main`), the section is SKIPPED and
 *      SAYS so. A crash stops the landing gate; `unmerged=0` would be a lie. Both are worse than a stated skip.
 *
 * @param {object} o
 * @param {Array<{id:string|number,status:string}>} [o.items]  queue rows, to join a branch to its row's status
 * @param {string} [o.base="main"]                             named ref to measure debt against
 * @param {(args:string[])=>string} [o.git]                    injectable git runner (the demo captures argv)
 */
export function branchDebt({ items = [], base = "main", git = gitSafe } = {}) {
	const head = headState(git);
	const baseSha = resolveRef(base, git);
	// ONE call for every local branch: sha + short name, namespace-pinned to refs/heads/, so a detached HEAD
	// cannot appear (it is not a ref under refs/heads/) and so every tip is already a sha.
	let branches = [];
	let listError = null;
	try {
		branches = git(["for-each-ref", "--format=%(objectname) %(refname:short)", "refs/heads/"])
			.split("\n")
			.map((line) => line.match(/^([0-9a-f]{40}) (.+)$/))
			.filter(Boolean)
			.map(([, sha, name]) => ({ sha, name }));
	} catch (e) {
		listError = `branch listing failed: ${e.message}`;
	}
	let worktrees = null;
	try {
		worktrees = git(["worktree", "list", "--porcelain"]).split("\n").filter((l) => l.startsWith("worktree ")).length;
	} catch {
		worktrees = null; // printed as `worktrees=?`; a listing failure must not kill the digest (#4985 rule 3)
	}
	const statusOf = new Map((items || []).map((i) => [String(i.id), i.status]));
	const debt = [];
	let probeFailures = 0;
	if (baseSha) {
		for (const { sha, name } of branches.slice(0, 60)) {
			if (name === base || sha === baseSha) continue;
			let ahead = 0;
			try {
				ahead = Number(git(["rev-list", "--count", `${baseSha}..${sha}`]));
			} catch {
				probeFailures++; // one bad range is a row that reads `?`, not a digest that dies
				continue;
			}
			if (!ahead) continue;
			const id = (name.match(/(\d+)/) || [])[1];
			debt.push(`${name} +${ahead} [#${id || "-"} ${statusOf.get(id) || "no-row"}]`);
		}
	}
	return {
		base,
		baseSha,
		head,
		refs: branches.length,
		worktrees,
		debt,
		probeFailures,
		listError,
		skipped:
			baseSha === null
				? `the base ref "${base}" does not resolve to a commit in this tree — the unmerged range was NOT computed (pass --base <ref>)`
				: null,
	};
}

/** `git rev-parse --verify --quiet <ref>^{commit}`, or null. An unresolved ref must never reach a range. */
function resolveRef(ref, git) {
	if (!/^[A-Za-z0-9._/-]{1,200}$/.test(ref)) return null; // a name git would read as a pathspec/range is not a ref
	try {
		const sha = git(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
		return /^[0-9a-f]{7,40}$/.test(sha) ? sha : null;
	} catch {
		return null;
	}
}

/** Is HEAD a branch here, or detached? A landing scratch is detached, and the digest should SAY which tree it measured. */
function headState(git) {
	try {
		const name = git(["symbolic-ref", "-q", "--short", "HEAD"]);
		if (name) return { state: "branch", at: name };
	} catch {
		/* detached (git exits 1 quietly) — fall through */
	}
	try {
		return { state: "detached", at: git(["rev-parse", "--short", "HEAD"]) };
	} catch {
		return { state: "unknown", at: "?" };
	}
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
			opts.git ? gitSafe(["rev-parse", "--short", opts.base]) : null, // --no-git means "no git calls", so no staleness check either. #4985: the base is a NAMED ref the caller chose, not a hardcoded `main` — this call is inside try/catch, but a marker compared against the wrong ref is a stale-vs-fresh lie.
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
		git: opts.git ? branchDebt({ items: status.queueItems, base: opts.base }) : null,
		runbooks: opts.runbooks ? staleRunbooks({}) : null,
		config: {
			provider: config.DURIG_PROVIDER,
			model: config.DURIG_MODEL,
			local: config.DURIG_LOCAL_BASE_URL,
			maxSeats: config.DURIG_MAX_CONCURRENT_SEATS,
		},
		localEndpoint: await probeLocal(),
		// The deferred backlog moves its ids OUT of the digest and INTO a grep-able snapshot when the
		// backlog is big enough that inlining costs more than the indirection. Decided here, in the half
		// that touches the disk; `deferredTerm` stays pure.
		deferredFile:
			opts.deferredFile &&
			(status.queueItems || []).filter((i) => i.status === "deferred").length > DEFERRED_INLINE_MAX
				? writeDeferredList(
						(status.queueItems || []).filter((i) => i.status === "deferred"),
						opts.deferredFile,
						db,
					)
				: null,
		selfdevLines: selfdevLines.length,
		selfdevHeadings: selfdevLines
			.map((l, i) => [i + 1, l])
			.filter(([, l]) => /^## /.test(l))
			.map(([n, l]) => `${l.slice(3, 52)}@${n}`),
		suiteMarker: marker,
		ms: Date.now() - t0,
	};
	const text = renderDigest(state);
	if (opts.json) {
		console.log(JSON.stringify({ ...state, text }, null, 1));
	} else {
		console.log(text);
	}
	// The cap is a GATE (ROADMAP 213). The digest still prints — a session that ran clock-in must see
	// why it failed — but the exit code says the tool stopped doing its job, so the landing gate and a
	// human running `clockin.mjs | wc -c` both hear about it.
	const verdict = budgetVerdict(text, opts.budget);
	if (!verdict.ok) console.error(verdict.message);
	return verdict.ok ? 0 : 1;
}

// The CLI half runs only when this file is the entry point, so demo/clockin-digest.test.mjs can
// import the pure functions without executing a store read.
if (fileURLToPath(import.meta.url) === resolve(process.argv[1] || "")) {
	main().then((code) => process.exit(code ?? 0));
}
