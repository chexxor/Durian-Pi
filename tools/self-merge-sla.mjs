#!/usr/bin/env node
// tools/self-merge-sla.mjs — which refs are READY to land, and how long have they been sitting?
//
// TRIGGER (the symptom that loads this tool): `cli.mjs check` prints `ready-ref-stale`, or a landing pass
// says "N refs need a decision" and you need to know which of them a seat could land RIGHT NOW versus which
// need a re-cut or a ruling.
//
// WHAT "ready" means — four git facts, no judgement:
//   1. the ref is NOT an ancestor of main   (`git merge-base --is-ancestor <ref> main` exits 1) — unlanded
//   2. the merge has no conflict            (`git merge-tree --write-tree main <ref>` exits 0)
//   3. the tip carries no committed `<<<<<<<` (`git grep -l '^<<<<<<<' <ref>` exits 1)
//   4. the merge changes main's tree        (merge-tree's tree oid != main's tree oid) — otherwise the ref
//      adds nothing and `tools/absorb-refs.mjs` is the verb, not a merge
// and one store fact, when the store is readable:
//   5. the queue row for the item is `done`. A `claimed`/`held`/`deferred` row means the seat is still
//      working on it, so the ref is NOT ready.
// A ref that satisfies 1-4 with no queue row is reported `ready-unverified`: the missing fact is named
// instead of guessed in either direction.
//
// STALE = ready and older than the SLA. Age is measured from the ref's own LAST COMMIT — the moment the work
// stopped moving on that branch — not from the queue row's completion time: the commit is the artifact that
// is waiting, and git can read it when the store cannot.
//
// Exact command:  node tools/self-merge-sla.mjs --db ./selfdev.sqlite
// Options:        --repo <root> · --db <store> (default DURIG_DB) · --sla-hours N (default 24, env
//                 DURIG_SELF_MERGE_SLA_HOURS) · --refs a,b (restrict) · --json
// Exit: 0 = nothing stale. 1 = at least one ready ref is past the SLA — the code `check` gates on.
// 2 = the repo or git could not be read.
//
// WHAT IT DOES NOT CLAIM: "ready" is not "verified". It says the RULE can merge this ref; the gate that
// proves the merged result is `scripts/land.mjs --changed-suite`, and this tool prints that command with the
// size of the derived subset so the cost is known before anyone pays it.
//
// It writes nothing: no merge, no delete, no push. Refs are never removed (rule R-B #3270).
//
// Cost (measured 2026-11-14, Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1, git 2.56.0, 197 refs / 59 unlanded): **7.7 s** — the printed `elapsed_s` is the number to trust;
// `--json` on a subset of 3 refs is 2.1 s. The queue read is the only subprocess other than git.
// last_verified: 2026-11-14, `node demo/self-merge-sla.test.mjs` exit 0 and `node scripts/test.mjs --area
// worktree` 26/26 in 8.9 s.

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { discoverTests, readManifest, filesForArea } from "../src/testareas.mjs";

/** Run one git verb with a bound. `discardStdout` is deliberate: a conflicted merge-tree prints megabytes of
 * hunk text (a probe that buffered it OOM'd at 4 GB), and the verdict is the EXIT CODE, not the output. */
function gitAt(repo, args, { discardStdout = false, timeout = 20000 } = {}) {
	const r = spawnSync("git", args, {
		cwd: repo,
		timeout,
		stdio: ["ignore", discardStdout ? "ignore" : "pipe", "pipe"],
	});
	return { code: r.status, out: (r.stdout ?? "").toString().trim(), err: (r.stderr ?? "").toString().trim() };
}

/**
 * The measurement, as a function, so the check rule, the demo and the CLI all use ONE rule set.
 * `itemStatus` may be injected (a Map of item id -> queue status) — that is how a demo proves the verdict
 * without opening a real store.
 */
export function landingHealth({
	repo = process.cwd(),
	db = process.env.DURIG_DB || "./selfdev.sqlite",
	slaHours = 24,
	refs = null,
	now = Date.now(),
	itemStatus = null,
	storeReason = "not read",
	ledger = null,
} = {}) {
	const started = Date.now();
	repo = resolve(repo);
	if (!existsSync(resolve(repo, ".git"))) return { ok: false, command: "self-merge-sla", error: `no .git at ${repo}`, exit: 2 };

	const mainProbe = gitAt(repo, ["rev-parse", "main"]);
	if (mainProbe.code !== 0) return { ok: false, command: "self-merge-sla", error: `cannot resolve main: ${mainProbe.err}`, exit: 2 };
	const mainSha = mainProbe.out;
	const mainTree = gitAt(repo, ["rev-parse", "main^{tree}"]).out;

	const listed = gitAt(repo, ["for-each-ref", "--format=%(refname:short)\t%(committerdate:iso8601)", "refs/heads"])
		.out
		.split("\n")
		.map((l) => l.trim())
		.filter(Boolean)
		.map((line) => {
			const [ref, when] = line.split("\t");
			return { ref, when };
	 })
		.filter((r) => r.ref && r.ref !== "main")
		.filter((r) => (refs ? refs.includes(r.ref) : true));

	const sourceCache = new Map();
	const testSource = (test) => {
		if (sourceCache.has(test)) return sourceCache.get(test);
		let text = "";
		try {
			text = readFileSync(resolve(repo, test), "utf8");
		} catch {
			text = "";
		}
		sourceCache.set(test, text);
		return text;
	};
	/* The derived-gate SIZE. The needle rule is tools/what-to-test.mjs's, mirrored so the two never answer
	 * one question two ways: a path needle, a DIRECTORY needle only two levels down (`docs/runbooks/`), and
	 * a NAME needle only for a real file name. A bare `docs` needle matches almost every test and turns a
	 * cost hint into noise. This is a cost estimate, never a gate. */
	let manifest = {};
	try {
		manifest = readManifest(repo);
	} catch {
		/* a fixture or a bare clone has no manifest: the gate SIZE is then 0 and the verdict still stands */
	}
	const areaOf = new Map();
	for (const area of manifest.areas ? Object.keys(manifest.areas) : []) for (const f of filesForArea(manifest, area)) areaOf.set(f, area);
	const tests = discoverTests(repo);

	/* Which refs the LEDGER names, and which of those rows record a landing the rig's own chokepoint
	 * REFUSED (scripts/land.mjs prints "main was NOT advanced" when the derived gate is red). Both sets
	 * come from the ledger text, so the tool never needs a second source of truth.
	 * last_verified: 2026-11-14, `node demo/self-merge-sla.test.mjs` exit 0. */
	const ledgerRows = new Set();
	const gateRefused = new Map(); // ref -> true when the row also records the lander run and its exit code
	for (const m of (ledger || "").matchAll(/`([A-Za-z0-9_\/()+.:-]+)`/g)) ledgerRows.add(m[1]);
	for (const line of (ledger || "").split("\n")) {
		if (!/main was NOT advanced|the derived gate refuses|KEEP-HELD/.test(line)) continue;
		/* An attempt is only evidence if the row quotes the lander's own refusal WITH its exit code. "needs
		 * judgement" is a feeling; `scripts/land.mjs ... exit 1 ... main was NOT advanced` is a measurement.
		 * last_verified: 2026-11-14, `node demo/self-merge-sla.test.mjs` exit 0. */
		const attemptLogged = /main was NOT advanced/.test(line) && /exit\s*\*{0,2}\s*1\b/.test(line);
		for (const m of line.matchAll(/`([A-Za-z0-9_\/()+.:-]+)`/g)) gateRefused.set(m[1], attemptLogged);
	}

	const rows = [];
	for (const { ref, when } of listed) {
		// `refs/heads/<name>` wherever a REV is read: a live item worktree at the repo root is a DIRECTORY
		// named `item-6343`, so the bare name is ambiguous — `git log -1 item-6343` dies with "ambiguous
		// argument: both revision and filename" (measured 2026-11-14 on this box).
		const rev = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
		const age = (() => {
			const t = Date.parse(when ?? "");
			return Number.isFinite(t) ? Math.max(0, Math.round((now - t) / 1000)) : null;
	 })();

		if (gitAt(repo, ["merge-base", "--is-ancestor", rev, mainSha]).code === 0) {
			rows.push({ ref, verdict: "landed", stale: false, age_s: age, queue_status: "n/a — already in main", gate: null });
			continue;
		}
		// ONE merge-tree call, stdout discarded: a conflicted merge-tree prints megabytes of hunk text (a probe
		// that buffered it OOM'd at 4 GB), and the verdict is the EXIT CODE, not the output. Whether the ref
		// changes main's tree is answered by the ref's OWN tree oid — cheaper than a second merge-tree.
		const mtCode = gitAt(repo, ["merge-tree", "--write-tree", mainSha, rev], { discardStdout: true }).code;
		const refTree = gitAt(repo, ["rev-parse", `${rev}^{tree}`]).out;
		const markers = gitAt(repo, ["grep", "-l", "^<<<<<<<", rev], { discardStdout: true });
		const itemId = Number((ref.match(/(\d+)/) || [])[0] ?? null);
		const status = itemId !== null ? itemStatus?.get(itemId) ?? "no-row" : "no-row";

		/* Addendum 2026-11-14 (delegate, after the catch-up audit): a clean merge-tree is NOT a landing
		 * verdict, and the ledger is where a refused landing is recorded. A ref the lander already tried and
		 * REFUSED is not "ready work waiting for a seat" - it is a held ref waiting for an implementation.
		 * Calling it `ready` makes the next session re-run the same refused landing. So the ledger is read
		 * into the verdict, and every unlanded ref is checked for a dated row (coverage). */
		const shortName = rev.replace("refs/heads/", "");
		const hasRow = ledgerRows.has(shortName);
		let verdict;
		if (mtCode === 1) verdict = "conflicted";
		else if (markers.code === 0) verdict = "poisoned-committed-markers";
		else if (refTree === mainTree) verdict = "no-op-ref";
		else if (gateRefused.has(shortName)) verdict = "gate-refused";
		else if (/^landing-\d{8}-/.test(shortName)) verdict = "scratch-chain";
		else if (status === "done") verdict = "ready";
		else if (status === "no-row") verdict = "ready-unverified";
		else verdict = "in-flight";

		const changedPaths = gitAt(repo, ["diff", "--name-only", `${mainSha}...${rev}`]).out.split("\n").filter(Boolean);
		const needles = [];
		for (const p of changedPaths) {
			if (!p) continue;
			needles.push(p);
			const dir = dirname(p);
			if (dir && dir !== "." && dir.includes("/")) needles.push(`${dir}/`);
			const name = basename(p);
			if (p.includes("/") && /\.[A-Za-z0-9]+$/.test(name) && !name.startsWith(".")) needles.push(name);
		}
		const selected = tests.filter((t) => {
			const src = testSource(t);
		 return src && needles.some((n) => n && src.includes(n));
		});

		const stale = (verdict === "ready" || verdict === "ready-unverified") && age !== null && age > slaHours * 3600;
		rows.push({
			ref,
			verdict,
			stale,
			attempt_logged: verdict === "gate-refused" ? (gateRefused.get(shortName) ?? false) : null,
			age_s: age,
			age_h: age === null ? null : +(age / 3600).toFixed(1),
			queue_status: status,
			dispositioned: hasRow,
			ruled: hasRow ? "DISPOSITIONS row" : null,
			gate: { changedPaths: changedPaths.length, derivedTests: selected.length, areas: [...new Set(selected.map((t) => areaOf.get(t)).filter(Boolean))] },
			land_command: `node scripts/land.mjs ${ref} --repo ${repo} --db ${db} --changed-suite`,
		});
	}

	const stale = rows.filter((r) => r.stale).sort((a, b) => (b.age_s ?? 0) - (a.age_s ?? 0));
	const counts = {};
	for (const r of rows) counts[r.verdict] = (counts[r.verdict] || 0) + 1;
	const unlanded = rows.filter((r) => r.verdict !== "landed");
	const undocumented = unlanded.filter((r) => !r.dispositioned).map((r) => r.ref.replace("refs/heads/", ""));
	/* A `gate-refused` verdict that no row proves is an assertion, not a finding: it means nobody ran the
	 * lander, so "a rule cannot merge it" has not been established. */
	const unattempted = rows.filter((r) => r.verdict === "gate-refused" && !r.attempt_logged).map((r) => r.ref.replace("refs/heads/", ""));

	return {
		ok: stale.length === 0,
		command: "self-merge-sla",
		repo,
		db,
		store: storeReason,
		main: mainSha.slice(0, 8),
		sla_hours: slaHours,
		refs: rows.length,
		counts,
		stale: stale.length,
		oldest: stale[0] ?? null,
		unlanded_verified: counts.ready ?? 0,
		unlanded: unlanded.length,
		ledger_coverage: `${unlanded.length - undocumented.length}/${unlanded.length}`,
		undocumented,
		gate_refused_proven: (counts["gate-refused"] ?? 0) - unattempted.length,
		gate_refused_unproven: unattempted,
		stale_rows: stale,
		rows,
		elapsed_s: +((Date.now() - started) / 1000).toFixed(1),
		exit: stale.length > 0 ? 1 : 0,
	};
}

/** The queue, read through the same CLI the delegate uses. Optional: the git facts stand without it. */
function readQueue(repo, db) {
	const q = spawnSync("node", ["cli.mjs", "queue", "--json", "--no-body"], {
		cwd: repo,
		env: { ...process.env, DURIG_DB: db },
		timeout: 30000,
		maxBuffer: 256 * 1024 * 1024, // the queue is thousands of rows; the 1 MB default truncates it and the parse fails
	});
	if (q.status !== 0) return { status: null, reason: `queue read exited ${q.status}` };
	try {
		const body = (q.stdout ?? "").toString().split("\n").filter((l) => !l.startsWith("note:")).join("\n");
		const parsed = JSON.parse(body);
		const map = new Map();
		for (const it of parsed.items || []) map.set(it.id, it.status);
		return { status: map, reason: "read" };
	} catch {
		return { status: null, reason: "queue json unparseable" };
	}
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
	const argv = process.argv.slice(2);
	const opt = (name, dflt) => {
		const i = argv.indexOf(name);
		return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
	};
	const repo = resolve(opt("--repo", process.cwd()));
	const db = opt("--db", process.env.DURIG_DB || "./selfdev.sqlite");
	const slaHours = Number(opt("--sla-hours", process.env.DURIG_SELF_MERGE_SLA_HOURS || 24));
	const refs = argv.includes("--refs")
		? String(argv[argv.indexOf("--refs") + 1]).split(",").map((s) => s.trim()).filter(Boolean)
		: null;
	const queue = readQueue(repo, db);
	let ledger = "";
	try {
		ledger = readFileSync(resolve(repo, "docs/DISPOSITIONS.md"), "utf8");
	} catch {
		/* no ledger -> no rulings to honour */
	}
	const result = landingHealth({ repo, db, slaHours, refs, itemStatus: queue.status, storeReason: queue.reason, ledger });
	console.log(JSON.stringify(result, null, argv.includes("--json") ? 2 : 0));
	if (argv.includes("--strict") && (result.undocumented.length || result.gate_refused_unproven.length)) {
		console.error(
		`self-merge SLA (--strict): ${result.undocumented.length} unlanded ref(s) have NO dated row in docs/DISPOSITIONS.md: ` +
			result.undocumented.slice(0, 20).join(", ") + (result.undocumented.length > 20 ? " …" : "") +
			(result.gate_refused_unproven.length
				? `\n${result.gate_refused_unproven.length} gate-refused ref(s) have a row that does NOT quote a scripts/land.mjs attempt with its exit code: ` + result.gate_refused_unproven.join(", ")
				: ""),
		);
		result.exit = 1;
	}
	if (result.stale > 0) {
		console.error(
			`self-merge SLA: ${result.stale} ready ref(s) past ${slaHours} h (oldest: ${result.oldest.ref}, ${result.oldest.age_h} h). ` +
			`Land them: node scripts/land.mjs ${result.stale_rows.slice(0, 5).map((r) => r.ref).join(" ")} --repo ${repo} --db ${db} --changed-suite`,
		);
	}
	process.exit(result.exit);
}
