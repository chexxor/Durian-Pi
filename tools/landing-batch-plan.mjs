#!/usr/bin/env node
// tools/landing-batch-plan.mjs — which unlanded refs can be landed in ONE gated pass.
//
// WHY. `scripts/land.mjs` accepts several branches and gates the suite once. A seat handed
// "50 refs need a landing decision" cannot tell which of them compose; two refs that touch the
// same file can conflict only when merged together, and `git merge-tree --write-tree` cannot be
// chained on a tree object (measured exit 1), so composition is established pairwise and then
// grouped into batches.
//
// TRIGGER (the symptom that loads this tool): the fleet has accumulated refs whose items are
// done but that are not on `main` — i.e. `branch-census` prints
// "prune: clean, unmerged, item terminal (needs a landing entry first)" and a landing pass has to
// be planned.
//
// Exact command (measured): `node tools/landing-batch-plan.mjs --max 12`
// Cost (measured 2026-11-12, Linux Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0, 50 refs / 1225 pairs): **11.9 s** real, exit 0. Bounded by design: every git verb is
// wrapped, output is discarded (the previous probe buffered `merge-tree` stdout into a Buffer and
// OOM'd at 4 GB — `FATAL ERROR: Ineffective mark-compacts near heap limit`).
//
// Exit 0 = a plan was produced. Nonzero = the census or git could not be read.
//
// WHAT IT DOES NOT CLAIM: pairwise-clean is not the same as sequential-clean. A batch built here
// still runs through `scripts/land.mjs`, which is the enforcement chokepoint; the plan is an
// ordering, not a merge.
//
// last_verified: 2026-11-12 by delegate, against HEAD 0e0a4d5f (50 landable refs, 3 batches).

import { spawnSync } from "node:child_process";
import process from "node:process";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const MAX = opt("--max", 12);
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();

const git = (args) => {
	const r = spawnSync("git", args, { cwd: repo, timeout: 20000 });
	return { ok: r.status === 0, out: (r.stdout || "").toString().trim() };
};

// `--refs a b c` bypasses the census, so a demo can drive the batching logic on a fixture repo.
const refArg = (() => {
	const i = argv.indexOf("--refs");
	if (i < 0) return null;
	const out = [];
	for (let k = i + 1; k < argv.length; k++) {
		if (argv[k].startsWith("--")) break; // stop at the next flag; its value is not a ref
		out.push(...argv[k].split(","));
	}
	return out.filter(Boolean);
})();
const censusRaw = refArg ? { status: 0, stdout: JSON.stringify({ needsLanding: refArg.map((ref) => ({ ref })) }) } : spawnSync("node", ["tools/branch-census.mjs", "--json"], {
	cwd: repo,
	timeout: 120000,
	maxBuffer: 64 * 1024 * 1024,
	encoding: "utf8",
});
if (censusRaw.status !== 0 || !censusRaw.stdout) {
	console.log(JSON.stringify({ ok: false, command: "landing-batch-plan", error: "branch-census failed" }));
	process.exit(1);
}
const census = JSON.parse(censusRaw.stdout.slice(censusRaw.stdout.indexOf("{")));
const refs = (census.needsLanding || []).map((r) => r.ref);

// 1. Which files each ref touches — a pair that shares no file cannot conflict.
const files = new Map();
for (const ref of refs) files.set(ref, new Set(git(["diff", "--name-only", "main", ref, "--"]).out.split("\n").filter(Boolean)));
// `--` is mandatory: a ref named `item-3747` is "ambiguous argument: both revision and filename"
// on git 2.56, and without it every pair looks disjoint and the plan silently says "no conflicts".
// (measured 2026-11-12: 1225 pairs became 0 pairs when the `--` was omitted)

// 2. Pairwise merge compatibility, output discarded (the exit code is the answer).
const conflictPairs = [];
let pairs = 0;
for (let i = 0; i < refs.length; i++) {
	for (let k = i + 1; k < refs.length; k++) {
		const a = refs[i], b = refs[k];
		const shared = [...files.get(a)].filter((f) => files.get(b).has(f));
		if (!shared.length) continue;
		pairs++;
		if (!git(["merge-tree", "--write-tree", a, b]).ok) conflictPairs.push({ a, b, shared: shared.slice(0, 4) });
	}
}

const inConflict = new Set(conflictPairs.flatMap((p) => [p.a, p.b]));
const pool = refs.filter((r) => !inConflict.has(r));
const batches = [];
for (let i = 0; i < pool.length; i += MAX) batches.push(pool.slice(i, i + MAX));

console.log(
	JSON.stringify(
		{
			ok: true,
			command: "landing-batch-plan",
			head: git(["rev-parse", "main"]).out,
			measuredAt: new Date().toISOString(),
			refsNeedingLanding: refs.length,
			pairsTested: pairs,
			conflictingPairs: conflictPairs.length,
			conflictPairs: conflictPairs.slice(0, 40),
			batches: batches.map((b) => ({ size: b.length, refs: b, command: `node scripts/land.mjs ${b.join(" ")} --suite` })),
			excludedAsConflicting: [...inConflict],
			totalCommitsAhead: (census.needsLanding || []).reduce((s, r) => s + (r.ahead || 0), 0),
			note: "pairwise-clean is an ordering, not a merge: land each batch through scripts/land.mjs, which is the gated chokepoint.",
			warning: pairs === 0 && refs.length > 1 ? "no pair shared a changed file — check the diff invocation; a silent 0 here has happened (missing `--`)" : null,
		},
		null,
		1
	)
);
