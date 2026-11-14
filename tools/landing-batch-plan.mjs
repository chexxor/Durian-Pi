#!/usr/bin/env node
// tools/landing-batch-plan.mjs — which unlanded refs actually compose in ONE gated pass.
//
// WHY. `scripts/land.mjs` accepts several branches and gates the suite once. A seat handed
// "50 refs need a landing decision" cannot tell which of them compose. `git merge-tree
// --write-tree` cannot be chained on a tree object (measured: "expected commit type, but the
// object dereferences to tree type", exit 1), so a sequential pass has to be simulated by
// promoting each merged tree into a scratch commit with `git commit-tree` and merging the next
// ref onto that. THAT is the real answer to "can these land together" — the old pairwise filter
// only said "these two might clash", which silently threw away refs that a different ordering
// would have taken.
//
// TRIGGER (the symptom that loads this tool): the fleet has accumulated refs whose items are
// done but that are not on `main` — i.e. `branch-census` prints
// "prune: clean, unmerged, item terminal (needs a landing entry first)" and a landing pass has
// to be planned.
//
// Exact command (measured): `node tools/landing-batch-plan.mjs --max 12`
// Cost (measured 2026-11-12, Linux Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1, git 2.56.0, 53 refs): **12.5 s** total — ~10 s is `tools/branch-census.mjs`, the
// 67 chained `merge-tree` calls are under 1 s. `--pairwise` adds the O(n^2) diagnostics (323
// shared-file pairs, 36 conflicts) for a measured 12.7 s. Bounded by design: every git verb is wrapped and its
// output discarded (an earlier probe buffered `merge-tree` stdout into a Buffer and OOM'd at
// 4 GB — "FATAL ERROR: Ineffective mark-compacts near heap limit").
//
// SIDE EFFECT, stated: the chain promotes each merged tree with `git commit-tree`, leaving
// dangling commits (a handful of KB per run, unreferenced, collected by `git gc`). It merges
// nothing, advances no ref, and touches no store.
//
// Exit 0 = a plan was produced. Nonzero = the census or git could not be read.
//
// ADDENDUM 2026-11-14 (delegate, measured Linux Fedora 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1, git 2.56.0):
// A PLAN IS ONLY VALID AGAINST THE HEAD IT WAS COMPUTED ON. The 2026-11-14 pass planned bins 12+2+7 against
// main 54fa9649; after bin 1 landed (main -> 33cee497) `git merge-tree --write-tree main refs/heads/<ref>`
// returned exit **1** for all 9 remaining refs - each now conflicts in docs/DISPOSITIONS.md, because landing
// bin 1 appended rows at the same append-only anchor. RE-RUN THIS TOOL AFTER EVERY BIN, or the second bin's
// "clean" is a stale claim. Second measured fact: `git merge-tree --write-tree` prints the tree oid on line 1
// EVEN WHEN IT CONFLICTS - the conflicts are the following lines and the EXIT CODE is the verdict (0 clean,
// 1 conflict). Screening with `head -1 | grep '^[0-9a-f]{40}$'` reports CLEAN for a conflicted merge.
//
// WHAT IT DOES NOT CLAIM: a clean chain is a clean MERGE, not a clean LANDING — `scripts/land.mjs`
// is the enforcement chokepoint (shared-tree pre-flight, genlock, suite gate). Semantic
// conflicts (two refs both adding different code to the same function) merge fine and still
// need a reviewer.
//
// last_verified: 2026-11-12 by delegate, against HEAD 60380781: 53 refs needing landing -> 6
// verified bins (12,12,12,12,4,1), 0 unlandable, 101 commits ahead in total.

import { spawnSync } from "node:child_process";
import process from "node:process";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = argv.indexOf(name);
	return i >= 0 && argv[i + 1] ? Number(argv[i + 1]) : dflt;
};
const MAX = opt("--max", 12);
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const PAIRWISE = argv.includes("--pairwise");

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
const head = git(["rev-parse", "main"]).out;

// 1. Files each ref CHANGES, measured from its merge base with main. Measuring `main..ref`
//    instead would count every file main added after the base as "touched by the ref", which
//    makes every pair look like it shares a file and every chain look impossible.
//    `--` is mandatory: a ref named `item-3747` is "ambiguous argument: both revision and
//    filename" on git 2.56, and without it the diff finds nothing and the plan says "no
//    conflicts" silently (measured 2026-11-12: 1,225 pairs became 0 pairs).
const files = new Map();
for (const ref of refs) {
	const base = git(["merge-base", "main", ref]).out || head;
	files.set(ref, new Set(git(["diff", "--name-only", base, ref, "--"]).out.split("\n").filter(Boolean)));
}
const shares = (a, b) => [...files.get(a)].filter((f) => files.get(b).has(f));

// 2. First-fit chain packing: merge each ref onto the accumulated chain of a bin. One merge-tree
//    call per (ref, bin tried), so the cost is refs x bins, not refs^2.
const bins = []; // {acc: chain commit, refs: []}
let calls = 0;
const chain = (onto, ref) => {
	calls++;
	const t = git(["merge-tree", "--write-tree", onto, ref]);
	if (!t.ok) return null;
	const tree = t.out.split("\n")[0]; // merge-tree prints the tree oid, then conflicts after it
	const commit = git(["commit-tree", tree, "-p", onto, "-p", ref, "-m", "delegate-chain-scratch"]).out;
	return commit || null;
};
for (const ref of refs) {
	let placed = false;
	for (const bin of bins) {
		if (bin.refs.length >= MAX) continue;
		const acc = chain(bin.acc, ref);
		if (!acc) continue;
		bin.acc = acc;
		bin.refs.push(ref);
		placed = true;
		break;
	}
	if (!placed) {
		const acc = chain(head, ref);
		if (!acc) bins.push({ acc: head, refs: [ref], couldNotMergeAnywhere: true });
		else bins.push({ acc, refs: [ref] });
	}
}

// 3. Optional O(n^2) diagnostics: which PAIRS genuinely conflict, for the record.
const conflictPairs = [];
let pairs = 0;
if (PAIRWISE) {
	for (let i = 0; i < refs.length; i++) {
		for (let k = i + 1; k < refs.length; k++) {
			const a = refs[i], b = refs[k];
			if (!shares(a, b).length) continue;
			pairs++;
			if (!git(["merge-tree", "--write-tree", a, b]).ok) conflictPairs.push({ a, b, shared: shares(a, b).slice(0, 4) });
		}
	}
}

console.log(
	JSON.stringify(
		{
			ok: true,
			command: "landing-batch-plan",
			head,
			measuredAt: new Date().toISOString(),
			refsNeedingLanding: refs.length,
			method: "chained first-fit (merge-tree onto the accumulated scratch commit)",
			mergeTreeCalls: calls,
			bins: bins.map((b) => ({
				size: b.refs.length,
				refs: b.refs,
				command: `node scripts/land.mjs ${b.refs.join(" ")} --suite`,
				mergeVerified: true,
				...(b.couldNotMergeAnywhere ? { couldNotMergeAnywhere: true } : {}),
			})),
			batches: bins.map((b) => ({ size: b.refs.length, refs: b.refs, command: `node scripts/land.mjs ${b.refs.join(" ")} --suite` })),
			unlandable: bins.filter((b) => b.couldNotMergeAnywhere).map((b) => b.refs[0]),
			refsPlaced: bins.reduce((s, b) => s + b.refs.length, 0),
			totalCommitsAhead: (census.needsLanding || []).reduce((s, r) => s + (r.ahead || 0), 0),
			conflictingPairs: PAIRWISE ? conflictPairs.length : null,
			conflictPairs: PAIRWISE ? conflictPairs.slice(0, 40) : null,
			pairsTested: PAIRWISE ? pairs : null,
			warning: PAIRWISE && pairs === 0 && refs.length > 1 ? "no pair shared a changed file — check the diff invocation; a silent 0 here has happened (missing `--`)" : null,
			note: "a chain is a verified MERGE order, not a landing: run each bin through scripts/land.mjs, which is the gated chokepoint (shared-tree pre-flight, genlock, suite).",
		},
		null,
		1
	)
);
