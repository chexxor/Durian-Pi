#!/usr/bin/env node
// tools/conflict-hunk-shape.mjs — for every ref that conflicts with `main`, show the SHAPE of each
// conflict hunk, and therefore what resolving it actually costs.
//
// WHY. "40 refs conflict with main" is not a plan. tools/conflict-resolvability.mjs answers
// "can a rule merge this ref?" at PATH granularity; it cannot answer "how much of the ref is
// genuinely different from what main already has?". A ref whose only conflict is one sentence with
// a stale number, and a ref that rewrites eight predicates in src/rig.mjs, both read as "decision"
// — and they are not the same job. This tool runs the real 3-way merge git would do and classifies
// every hunk, so a re-cut can be sequenced by cost instead of by ref id.
//
// TRIGGER: the census reports `N conflict` and someone is asked "which of these can be merged
// without an author?". Re-run after every landing bin (pitfall 330).
//
// Exact command:
//   node tools/conflict-hunk-shape.mjs --refs item-3570,item-6101 --json .spike/hunk-shape.json
//   node tools/conflict-hunk-shape.mjs --brief            # one line per conflicting ref
//   node tools/conflict-hunk-shape.mjs --refs item-6177 --with-text --json .spike/packet.json
// Cost: measured 2026-11-14, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0 — 40 refs in the `elapsed_s` field it prints (~2 s). READ-ONLY: no branch moves, no
// worktree is created, no store is opened; the trees `git merge-tree --write-tree` materialises are
// unreachable and collected by gc.
//
// Exit 0 = census produced. 2 = bad arguments.
//
// THE CLASSES (A, C, D mirror tools/chain-resolve.mjs's union rules; U, F, G, E are the additions):
//   A EMPTY_MAIN   main's side of the hunk is empty -> the ref only adds. Union is lossless.
//   B EMPTY_REF    the ref's side is empty -> main already deleted that region. Nothing to do.
//   C SUPERSET_REF every main-side line is also on the ref side -> take the ref, nothing lost.
//   D SUPERSET_MAIN every ref-side line is already on main -> the change is already landed.
//   I IMPORT_UNION both sides are ONE `import { ... } from "mod"` line for the SAME module, with
//                  different name lists. The union of the names is the only merge that loses no
//                  symbol; tools/chain-resolve.mjs rule 8 applies it and then PROVES every name is
//                  exported by that module in the merged tree, so it cannot land a dangling import.
//   P PROVENANCE   both sides are runbook frontmatter keys only (last_verified / verified_by /
//                  evidence / owner / status / symptom / related / milestone / source). The values
//                  are bookkeeping, not a decision: chain-resolve rule 9 unions the values and keeps
//                  the later `last_verified`. Nothing is dropped, so it is mechanical.
//   U BOTH_ADD     both sides add lines at the same anchor and neither rewrites a base line: an
//                  append-only ledger collision. tools/chain-resolve.mjs rule 1 unions it; nothing
//                  is dropped, so it is mechanical.
//   F STALE_VALUE  the two sides are the SAME sentence after normalising numbers/dates/shas/D
//                  numbers; main's is the live one. Taking main loses wording, not a fact.
//   G PARAPHRASE   >= 90% of the ref side's content words are already on main's side. Same claim,
//                  different words. A human must pick one; nothing mechanical proves equality.
//   E SEMANTIC     neither side contains the other. Two seats decided differently at the same place.
//                  docs/runbooks/branch-cleanup.md Step 0b/0d: that is an author re-cut.
//
// A ref is verdict `mechanical` only when it has no E and no G. That is the bar this rig can merge at.

import { spawnSync } from "node:child_process";
import process from "node:process";
import fs from "node:fs";
import { pathToFileURL } from "node:url";

// Guard so the demo test can import the rules without running the census (tools/seat-turn-shape.mjs
// uses the same idiom).

const argv = process.argv.slice(2);
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const BASE = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "refs/heads/main";
const outJson = argv.includes("--json") ? argv[argv.indexOf("--json") + 1] : null;
const brief = argv.includes("--brief");
const refsArg = argv.includes("--refs") ? argv[argv.indexOf("--refs") + 1].split(",").filter(Boolean) : null;
const withText = argv.includes("--with-text");

const STOP = new Set(["this", "that", "with", "from", "have", "been", "were", "which", "their", "there", "would", "could", "should", "about", "because", "nothing", "something", "where", "when", "what", "while", "into", "only", "also", "more", "than", "over", "under", "after", "before", "without", "within", "another", "other", "same", "both", "either", "neither", "some", "each", "such", "using", "used", "must", "need", "needs", "done", "must"]);

function git(args) {
	const r = spawnSync("git", args, { cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
	return { ok: r.status === 0, status: r.status, out: r.stdout || "", err: r.stderr || "" };
}

/** Normalise away the things that change when a doc is re-measured, not re-decided. */
export function normalise(line) {
	return String(line ?? "")
		.toLowerCase()
		.replace(/\b(20\d\d-\d\d-\d\d|\d\d:\d\d(:\d\d)?)\b/g, "<date>")
		.replace(/\b[0-9a-f]{6,40}\b/g, "<sha>")
		.replace(/\bD\d+\b/g, "D#")
		.replace(/\d+/g, "<n>")
		.replace(/\s+/g, " ")
		.trim();
}

/** Content words: long enough to be a claim, not punctuation or a stop word. */
export function words(text) {
	return (String(text ?? "").toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !STOP.has(w));
}

/** Is this line a rewrite of some base line, rather than a fresh addition? A ledger row or a
 * paragraph the seat wrote from scratch shares almost no words with any single base line; a
 * reworded line shares most of its words with exactly one. */
export function rewritesBase(line, baseLines) {
	const w = words(line);
	if (!w.length) return false;
	const set = new Set(w);
	for (const b of baseLines) {
		const bw = words(b);
		if (!bw.length) continue;
		const shared = bw.filter((x) => set.has(x)).length;
		if (shared / Math.min(w.length, bw.length) >= 0.5) return true;
	}
	return false;
}

const IMPORT_RE = /^import\s+\{([^}]*)\}\s+from\s+(['"])([^'"]+)\2\s*;?\s*$/;
const FRONT_KEYS = ["last_verified", "verified_by", "evidence", "owner", "status", "symptom", "related", "milestone", "source", "updated"];

/** Both sides are exactly one import statement for the same module? Then the lossless merge is the
 * union of the name lists - and nothing else can be, since each side names a symbol the other omits. */
export function importUnion(mainLines, refLines) {
	if (mainLines.length !== 1 || refLines.length !== 1) return null;
	const a = IMPORT_RE.exec(mainLines[0]), b = IMPORT_RE.exec(refLines[0]);
	if (!a || !b || a[3] !== b[3]) return null;
	const names = [];
	for (const s of [a[1], b[1]]) for (const n of s.split(",").map((x) => x.trim()).filter(Boolean)) if (!names.includes(n)) names.push(n);
	return { names, specifier: a[3] };
}

/** Is every line of this side a runbook frontmatter key? (A wrapped value is NOT a key, so a
 * multi-line evidence block does not qualify - the rule is deliberately narrow.) */
export function isProvenance(lines) {
	const nonEmpty = lines.map((l) => l.trim()).filter(Boolean);
	if (!nonEmpty.length) return false;
	return nonEmpty.every((l) => FRONT_KEYS.some((k) => l.startsWith(k + ":")));
}

/** Classify ONE conflict hunk, given its two sides and the base version of the file.
 * The hunk is reduced to what is *only* on each side; lines on both sides are shared context and
 * cannot be the disagreement. */
export function classifyHunk(mainSide, refSide, baseLines = []) {
	const m = mainSide.map((l) => l.trim());
	const r = refSide.map((l) => l.trim());
	const mLines = m.filter(Boolean), rLines = r.filter(Boolean);
	if (!mLines.length) return { cls: "A", note: "main's side is empty - the ref only adds" };
	if (!rLines.length) return { cls: "B", note: "the ref's side is empty - main already removed it" };
	const mset = new Set(mLines), rset = new Set(rLines);
	const mOnly = mLines.filter((l) => !rset.has(l));
	const rOnly = rLines.filter((l) => !mset.has(l));
	if (!mOnly.length) return { cls: "C", note: "the ref side contains every main line - take the ref, nothing is lost" };
	if (!rOnly.length) return { cls: "D", note: "main already contains every ref line - the change is already landed" };
	const imp = importUnion(mLines, rLines);
	if (imp) return { cls: "I", names: imp.names, specifier: imp.specifier, note: "same import, different name lists - the union is provable" };
	if (isProvenance(mLines) && isProvenance(rLines)) return { cls: "P", note: "frontmatter bookkeeping on both sides - values can be unioned" };
	const baseSet = new Set(baseLines.map((l) => l.trim()));
	if (baseLines.length &&
		!mOnly.some((l) => baseSet.has(l) || rewritesBase(l, baseLines)) &&
		!rOnly.some((l) => baseSet.has(l) || rewritesBase(l, baseLines)))
		return { cls: "U", note: "both sides only append at the same anchor - a ledger collision, unionable" };
	if (normalise(mainSide.join("\n")) === normalise(refSide.join("\n")))
		return { cls: "F", note: "same sentence, a different number/date/sha - main's is the live one" };
	const rw = words(rOnly.join(" "));
	const mw = new Set(words(mOnly.join(" ")));
	const overlap = rw.length ? rw.filter((w) => mw.has(w)).length / rw.length : 1;
	if (overlap >= 0.9) return { cls: "G", overlap: Number(overlap.toFixed(2)), note: "the same claim in different words" };
	return { cls: "E", overlap: Number(overlap.toFixed(2)), note: "two different decisions at the same place" };
}

/** Split git's conflict markers out of a merged blob. */
export function hunksFromMerged(mergedText, path, baseLines = []) {
	const hunks = [];
	let inside = false, buf = [];
	for (const line of String(mergedText ?? "").split("\n")) {
		if (line.startsWith("<<<<<<<")) { inside = true; buf = []; continue; }
		if (line.startsWith("=======") && inside) { buf.push("\u0000SPLIT\u0000"); continue; }
		if (line.startsWith(">>>>>>>") && inside) {
			inside = false;
			const i = buf.indexOf("\u0000SPLIT\u0000");
			const main = buf.slice(0, i), ref = buf.slice(i + 1);
			hunks.push({ path, ...classifyHunk(main, ref, baseLines), main, ref });
			continue;
		}
		if (inside) buf.push(line);
	}
	return hunks;
}

export function census(refs, { gitRun = git } = {}) {
	const t0 = Date.now();
	const rows = [];
	for (const name of refs) {
		const refname = name.startsWith("refs/") ? name : `refs/heads/${name}`;
		const mt = gitRun(["merge-tree", "--write-tree", BASE, refname]);
		if (mt.status === 0) { rows.push({ ref: name, clean: true, hunks: [] }); continue; }
		const lines = mt.out.split("\n");
		const tree = lines[0];
		const paths = [];
		for (const l of lines.slice(1)) {
			const m = l.match(/^\d+ [0-9a-f]+ \d\t(\S+)$/);
			if (m && !paths.includes(m[1])) paths.push(m[1]);
		}
		const hunks = [];
		for (const p of paths) {
			const merged = gitRun(["cat-file", "blob", `${tree}:${p}`]);
			if (!merged.ok) continue;
			const base = gitRun(["merge-base", BASE, refname]).out.trim();
			const baseBlob = gitRun(["cat-file", "blob", `${base}:${p}`]);
			hunks.push(...hunksFromMerged(merged.out, p, baseBlob.ok ? baseBlob.out.split("\n") : []));
		}
		const cls = hunks.reduce((a, h) => (a[h.cls] = (a[h.cls] || 0) + 1, a), {});
		const provable = (cls.A || 0) + (cls.B || 0) + (cls.C || 0) + (cls.D || 0) + (cls.U || 0) + (cls.I || 0) + (cls.P || 0);
		rows.push({
			ref: name,
			clean: false,
			paths: paths.length,
			hunks: hunks.length,
			cls,
			semantic: cls.E || 0,
			wording: (cls.G || 0) + (cls.F || 0),
			mechanical: provable,
			verdict: cls.E ? "semantic" : cls.G ? "wording-only" : "mechanical",
			unionable: !cls.E && !cls.G,
			...(withText ? { hunks } : {}),
		});
	}
	return {
		head: gitRun(["rev-parse", BASE]).out.trim(),
		refs: refs.length,
		elapsed_s: ((Date.now() - t0) / 1000).toFixed(1),
		host: `${process.platform} node ${process.version}`,
		rows,
	};
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
if (refsArg === null && !brief) {
	console.error("need --refs <a,b,c> (omit only with --brief, which censuses every head)");
	process.exit(2);
}
const refs = refsArg ?? git(["for-each-ref", "--format=%(refname)", "refs/heads/"]).out
	.split("\n").filter(Boolean).map((r) => r.replace("refs/heads/", "")).filter((r) => r !== BASE.replace("refs/heads/", ""));
const result = census(refs);
if (outJson) fs.writeFileSync(outJson, JSON.stringify(result, null, 1));
if (brief) {
	for (const r of result.rows) {
		if (r.clean) continue;
		console.log(`${r.ref}\t${r.verdict}\tpaths=${r.paths} hunks=${r.hunks} E=${r.cls.E || 0} G=${r.cls.G || 0} F=${r.cls.F || 0} U=${r.cls.U || 0} I=${r.cls.I || 0} P=${r.cls.P || 0} A/B/C/D=${(r.cls.A||0)+(r.cls.B||0)+(r.cls.C||0)+(r.cls.D||0)}`);
	}
} else {
	console.log(JSON.stringify({
		head: result.head, refs: result.refs, elapsed_s: result.elapsed_s, host: result.host,
		tally: result.rows.reduce((a, r) => (a[r.clean ? "clean" : r.verdict] = (a[r.clean ? "clean" : r.verdict] || 0) + 1, a), {}),
		rows: result.rows.map(({ examples, ...rest }) => rest),
	}, null, 1));
}
}
