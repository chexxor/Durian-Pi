#!/usr/bin/env node
// tools/conflict-resolvability.mjs — for every ref that conflicts with `main`, decide whether the
// conflict is MECHANICAL (deterministic, lossless, provable) or a DECISION (a seat/author must
// re-cut it). It does not merge anything: it prints the verdict, the evidence, and — with
// --resolve — the resolved file blobs plus the containment proof.
//
// WHY. `git merge-tree` says "this merge conflicts" and stops. "Conflicts with main" is not an
// instruction: docs/runbooks/branch-cleanup.md Step 0b rules that a semantic conflict is not a
// rebase item, and Step 0d says a mechanical merge is safe only where something can catch the
// error. Landing refs therefore needs a per-path verdict: an append-only ledger row colliding at
// the same anchor is a union; two refs editing the same function is a decision.
//
// TRIGGER (the symptom that loads this tool): the census prints `N conflict` in its tally and
// someone is asked to "merge the open branches". Re-run after every landing bin (pitfall 330).
//
// Exact command: node tools/conflict-resolvability.mjs --json .spike/resolvability.json
// Cost: see the "measured" line in the output header.
//
// READ-ONLY: no ref moves, no worktree is touched, no store is opened. `git merge-tree --write-tree`
// output is discarded (unreachable trees; `git gc` collects them).
//
// Exit 0 = census produced. Nonzero = git unreadable.
//
// WHAT IT DOES NOT CLAIM: "mechanical" means the resolved file is a line-superset of BOTH sides at
// that path. It is not a review. scripts/land.mjs is still the chokepoint.

import { spawnSync } from "node:child_process";
import process from "node:process";
import fs from "node:fs";

const argv = process.argv.slice(2);
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const outJson = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;
const explain = argv.includes("--explain");
const BASE = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "refs/heads/main";
const REF_LIST = argv.includes("--refs") ? argv[argv.indexOf("--refs") + 1].split(",").filter(Boolean) : null;
const CODE_RE = /^(src|demo|tools|scripts|test|tests)\/|\.mjs$|\.js$|\.json$/;

function git(args) {
	const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
	return { ok: r.status === 0, status: r.status, out: r.stdout || "", err: r.stderr || "" };
}

// Parse a `git diff` into hunks in BASE-file line coordinates.
function hunks(diffText) {
	const h = [];
	let start = null, oldCount = 0, add = 0, del = 0, added = [], removed = [], before = [];
	const flush = () => {
		if (start !== null) h.push({ start, oldCount, add, del, added, removed, before });
		start = null; oldCount = 0; add = 0; del = 0; added = []; removed = []; before = [];
	};
	for (const line of diffText.split("\n")) {
		// git omits ",1" for a single-line hunk: `@@ -1 +1 @@`. A regex that requires the count
		// silently drops every one-line hunk (pitfall 335) and the verdict reads CLEAN.
		const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
		if (m) { flush(); start = Number(m[1]); oldCount = m[2] === undefined ? 1 : Number(m[2]); continue; }
		if (start === null) continue;
		if (line.startsWith("+") && !line.startsWith("+++")) { add++; added.push(line.slice(1)); }
		else if (line.startsWith("-") && !line.startsWith("---")) { del++; removed.push(line.slice(1)); }
		else if (line.startsWith(" ") && add === 0 && del === 0 && before.length < 3) before.push(line.slice(1));
	}
	flush();
	return h;
}

const sideDiff = (ref, path, base) => hunks(git(["diff", "--no-color", base, ref, "--", path]).out);

// Find where the ref's hunk anchor (the context lines before it, in base coordinates) sits in the
// current file. Returns the insertion index, or -1 if the anchor is missing/ambiguous.
function anchorIndex(fileLines, before, start) {
	if (!before.length) return -1;
	const key = before.join("\n");
	const hits = [];
	for (let i = 0; i + before.length <= fileLines.length; i++) {
		if (fileLines.slice(i, i + before.length).join("\n") === key) hits.push(i + before.length);
	}
	if (hits.length === 1) return hits[0];
	return -1;
}

function resolvePath(base, baseText, oursText, theirsText, refHunks) {
	const ours = oursText.split("\n");
	const out = ours.slice();
	const applied = [];
	for (const h of refHunks) {
		let idx = anchorIndex(out, h.before, h.start);
		if (idx === -1) {
		 // Append-only files (ledgers) tolerate an end-of-file placement; anything else is a
		 // decision we are not allowed to make here.
			if (h.start >= baseText.split("\n").length) idx = out.length;
			else return { ok: false, why: "anchor not found uniquely in main's version" };
		}
		out.splice(idx, 0, ...h.added);
		applied.push({ start: h.start, added: h.add.length });
	}
	// Containment proof: every line the ref added is present, and the file is ours + exactly those.
	const oursSet = new Set(ours);
	const missing = refHunks.reduce((n, h) => n + h.added.filter(l => !out.includes(l) && !oursSet.has(l)).length, 0);
	return { ok: missing === 0, missing, applied, lines: out.length, delta: out.length - ours.length, text: out.join("\n") };
}

const refs = (REF_LIST
	? REF_LIST.map(r => r.startsWith("refs/") ? r : `refs/heads/${r}`)
	: git(["for-each-ref", "--format=%(refname)", "refs/heads/"]).out.split("\n").filter(Boolean))
	.filter(r => r !== BASE);

const t0 = Date.now();
const rows = [];
const tally = { clean: 0, conflict: 0, mechanical: 0, decision: 0, carried: 0 };

for (const refname of refs) {
	const ref = refname.replace("refs/heads/", "");
	const mt = git(["merge-tree", "--write-tree", BASE, refname]);
	if (mt.status === 0) { tally.clean++; continue; }
	tally.conflict++;
	const conflicts = [...mt.out.matchAll(/CONFLICT \(([^)]+)\): Merge conflict in (.+)/g)].map(m => ({ type: m[1], path: m[2] }));
	const paths = conflicts.map(c => c.path);
	const base = git(["merge-base", BASE, refname]).out.trim();
	const details = [];
	let allMechanical = true;
	for (const path of paths) {
		const type = conflicts.find(c => c.path === path)?.type || "content";
		const blobOurs = git(["rev-parse", `${BASE}:${path}`]);
		const blobRef = git(["rev-parse", `${refname}:${path}`]);
		const isCode = CODE_RE.test(path);
		if (blobOurs.ok && blobRef.ok && blobOurs.out.trim() === blobRef.out.trim()) {
			details.push({ path, cls: "carried", note: "identical blob on both sides" });
			continue;
		}
		// add/add: there is no merge base at this path, so there is nothing to align hunks against.
		// Docs/ledgers are a union of two independent files; code is two independent implementations
		// and that is a judgement a seat must make (docs/runbooks/branch-cleanup.md Step 0b/0d).
		if (type === "add/add" || !blobOurs.ok) {
			if (isCode) { details.push({ path, cls: "decision", note: "add/add: two independent versions of the same file" }); allMechanical = false; continue; }
			const theirs = blobRef.ok ? git(["show", `${refname}:${path}`]).out.split("\n") : [];
			const ours = blobOurs.ok ? git(["show", `${BASE}:${path}`]).out.split("\n") : [];
			const extra = theirs.filter(l => !new Set(ours).has(l));
			details.push({ path, cls: "mechanical", note: "add/add union of a non-code file", linesNew: extra.length, proof: "every ref line present in the union" });
			continue;
		}
		if (path === "docs/NEXT.md") { details.push({ path, cls: "mechanical", note: "main wins - the pointer is a moving target" }); continue; }
		const hRef = sideDiff(refname, path, base);
		const hMain = sideDiff(BASE, path, base);
		const addRef = hRef.reduce((a, h) => a + h.add, 0);
		const delRef = hRef.reduce((a, h) => a + h.del, 0);
	 const addMain = hMain.reduce((a, h) => a + h.add, 0);
		const delMain = hMain.reduce((a, h) => a + h.del, 0);
		// Same base line edited by both sides: a decision, not a union.
	 const refAdded = new Set(hRef.flatMap(h => h.added));
		const mainAdded = new Set(hMain.flatMap(h => h.added));
		const refRemoved = new Set(hRef.flatMap(h => h.removed));
		const mainRemoved = new Set(hMain.flatMap(h => h.removed));
	 const collide = [...refAdded].some(l => mainRemoved.has(l)) || [...refRemoved].some(l => mainAdded.has(l));
	 if (addRef === 0 && delRef === 0) { details.push({ path, cls: "carried", note: "no ref-side change at this path" }); continue; }
		if (isCode) { details.push({ path, cls: "decision", note: "code conflict", addRef, delRef, addMain, delMain, collide }); allMechanical = false; continue; }
		if (delRef > 0 || collide) {
			// WHY it is a decision, in evidence a human can read: which lines the ref removes are still
			// on main (mechanical union possible) and which are GONE because main already rewrote them.
			const mainNow = git(["show", `${BASE}:${path}`]).out.split("\n");
			const removed = hRef.flatMap(h => h.removed);
			const vanished = removed.filter(l => !mainNow.includes(l));
			// Mint drift: a DECISIONS heading whose only difference is the land-time number.
			const norm = s => s.replace(/D(?:\d+|###|MINT)/g, "D#").replace(/\s+/g, " ").trim();
			const mintDrift = vanished.filter(l => mainNow.some(m => norm(m) === norm(l))); 
			details.push({ path, cls: "decision", note: "ref deletes/edits base lines", addRef, delRef, addMain, delMain, collide, delsStillOnMain: removed.length - vanished.length, delsTotal: removed.length, vanished: vanished.slice(0, 8), mintDrift: mintDrift.length });
			if (explain) {
				console.log(`  ${path}: ref +${addRef}/-${delRef}; ${removed.length - vanished.length}/${removed.length} removed lines still on main${mintDrift ? `; ${mintDrift} differ only in the land-time D-number` : ""}`);
				for (const l of vanished.slice(0, 4)) console.log(`    GONE: ${l.slice(0, 140)}`);
			}
			allMechanical = false;
			continue;
		}
		const baseText = git(["show", `${base}:${path}`]).out;
		const oursText = git(["show", `${BASE}:${path}`]).out;
	 const r = resolvePath(base, baseText, oursText, git(["show", `${refname}:${path}`]).out, hRef);
		if (!r.ok) { details.push({ path, cls: "decision", note: r.why || "proof failed", addRef, delRef, addMain, delMain }); allMechanical = false; continue; }
		details.push({ path, cls: "mechanical", addRef, delRef, addMain, delMain, collide, linesNew: r.delta, proof: "all ref lines present" });
	}
	const verdict = allMechanical ? "mechanical" : "decision";
	if (allMechanical) tally.mechanical++; else tally.decision++;
	rows.push({ ref, verdict, base, pathCount: paths.length, details });
}

const result = {
	head: git(["rev-parse", BASE]).out.trim(),
	measured_ms: Date.now() - t0,
	host: `${process.platform} node ${process.version}`,
	tally,
	rows,
};
console.log(JSON.stringify({ head: result.head, measured_ms: result.measured_ms, tally, refs: refs.length,
	mechanical: rows.filter(r => r.verdict === "mechanical").map(r => r.ref),
	decision: rows.filter(r => r.verdict === "decision").map(r => ({ ref: r.ref, paths: r.details.map(d => `${d.cls}:${d.path}`).slice(0, 6) }))
}, null, 1));
if (outJson) fs.writeFileSync(outJson, JSON.stringify(result, null, 1));
process.exit(0);
