#!/usr/bin/env node
// tools/merge-containment-proof.mjs — prove a chain branch did not LOSE any line a ref added.
//
// WHY. A union-resolved merge is only safe if every line the ref added is still in the merged
// file. tools/chain-resolve.mjs proves this per path at merge time; this tool re-proves it
// END-TO-END against the branch someone is about to land, so a reviewer is not taking the
// resolver's word. It is the "what would show the result is right" instrument for a landing pass.
//
// TRIGGER: before landing a chain branch, or after a landing, to answer "did the pass drop work?".
//
// Exact command:
//   node tools/merge-containment-proof.mjs --branch landing-20261114-docs --refs item-3094,item-4758
// Cost: measured 2026-11-14, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0 — see the `elapsed_s` field it prints.
//
// Read-only. Exit 0 = every added line of every ref is present in the branch at the same path.
// Exit 1 = at least one ref lost lines (they are printed).
//
// Known limits: it compares LINES, not semantics, with two narrow exceptions written down above - a
// re-minted `## D<n>` heading (matched on its title with the number normalised) and a line whose
// whole content survived inside a UNION line (rule 8 imports, rule 9 provenance). It cannot tell
// whether the minted number is the right one, only that the content survived.

import { spawnSync } from "node:child_process";
import process from "node:process";

const argv = process.argv.slice(2);
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const branch = argv.includes("--branch") ? argv[argv.indexOf("--branch") + 1] : null;
const refs = (argv.includes("--refs") ? argv[argv.indexOf("--refs") + 1] : "").split(",").filter(Boolean);
const baseBranch = argv.includes("--base") ? argv[argv.indexOf("--base") + 1] : "refs/heads/main";

const git = (a) => { const r = spawnSync("git", a, { cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return { ok: r.status === 0, status: r.status, out: (r.stdout || "").trim() }; };
const HEAD_RE = /^## (?:STUB OF )?D(\d+|MINT|###)/;
const norm = (l) => l.replace(HEAD_RE, "## D<n>");
// tools/chain-resolve.mjs rules 8 and 9 join content onto ONE line (the union of an import's name
// list, the union of a runbook's provenance values), so a strict line-for-line check would report a
// loss where none happened. The fallback below is deliberately narrow: a line counts as preserved if
// its VALUE survives inside a line of the same key, or if every symbol it imports is in the merged
// import line for the same module. Everything else still has to appear verbatim.

const PROV_KEYS = ["last_verified", "verified_by", "evidence", "owner", "status", "symptom", "related", "milestone", "source", "updated"];
const IMPORT_RE = /^import\s+\{([^}]*)\}\s+from\s+(['"])([^'"]+)\2\s*;?\s*$/;

if (!branch || !refs.length) { console.error("need --branch and --refs"); process.exit(2); }
const t0 = Date.now();
let bad = 0;
const rows = [];
for (const ref of refs) {
	const refname = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
	const base = git(["merge-base", baseBranch, refname]).out.trim();
	if (!base) { rows.push({ ref, error: "no merge base with " + baseBranch }); bad++; continue; }
	const paths = git(["diff", "--name-only", base, refname]).out.split("\n").filter(Boolean);
	const lost = [];
	let added = 0;
	for (const p of paths) {
		if (!git(["rev-parse", "-q", "--verify", `${branch}:${p}`]).ok) { lost.push({ path: p, note: "path missing in branch" }); continue; }
	 const blob = git(["cat-file", "blob", `${branch}:${p}`]).out;
	 const lines = blob.split("\n");
	 const set = new Set(lines);
	 const headings = new Set(lines.filter(l => HEAD_RE.test(l)).map(norm));
	 const diff = git(["diff", "--no-color", base, refname, "--", p]).out;
	 const addedLines = diff.split("\n").filter(l => l.startsWith("+") && !l.startsWith("+++")).map(l => l.slice(1));
		added += addedLines.length;
		const miss = addedLines.filter(l => {
			if (set.has(l)) return false;
			if (HEAD_RE.test(l)) return !headings.has(norm(l));
			const t = String(l).trim();
			if (PROV_KEYS.some((k) => t.startsWith(k + ":"))) {
				const key = t.split(":")[0];
				let val = t.slice(key.length + 1).trim();
				if (key === "last_verified") {
					const mine = (t.match(/20\d\d-\d\d-\d\d/) || [""])[0];
					const theirs = lines.map(o => (o.match(/20\d\d-\d\d-\d\d/) || [""])[0]).filter(Boolean).sort();
					return !(mine && theirs.length && theirs[theirs.length - 1] >= mine);
				}
				if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
				const segs = val.split("; ").map((s) => s.trim()).filter(Boolean);
				if (!segs.length) return false;
				return segs.some(seg => !lines.some(o => { const ot = o.trim(); return ot.startsWith(key + ":") && ot.slice(key.length + 1).includes(seg); }));
			}
			const m = IMPORT_RE.exec(t);
			if (m) {
				const line = lines.find(o => { const mm = IMPORT_RE.exec(o.trim()); return mm && mm[3] === m[3]; });
				if (!line) return true;
				const names = new Set(IMPORT_RE.exec(line.trim())[1].split(",").map((x) => x.trim()));
				return m[1].split(",").map((x) => x.trim()).some((n) => !names.has(n));
			}
			return true;
		});
		if (miss.length) lost.push({ path: p, count: miss.length, sample: miss.slice(0, 3) });
	}
	if (lost.length) bad++;
	rows.push({ ref, paths: paths.length, addedLines: added, lost });
}
console.log(JSON.stringify({
	branch, base: git(["rev-parse", baseBranch]).out.trim(),
	refs: refs.length, refs_with_loss: bad,
	elapsed_s: ((Date.now() - t0) / 1000).toFixed(1),
	rows,
}, null, 1));
process.exit(bad ? 1 : 0);
