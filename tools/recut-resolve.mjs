#!/usr/bin/env node
// tools/recut-resolve.mjs — resolve the conflict markers a replay leaves behind by RULE, and
// print the rule used for every block so a reviewer can disagree.
//
// WHY. tools/ref-recut.mjs replays a ref's diff onto main; the 2026-11-14 pass found 158 conflict
// blocks still marked after that replay. Most are not judgement: two seats added two different
// things at the same place, or one side carries the other's text plus an addendum. A rule that
// keeps BOTH sides loses nothing, and tools/merge-containment-proof.mjs is the check that says so.
// What a rule cannot prove stays marked — never side-picked (rule R-B #3270).
//
// TRIGGER: after tools/ref-recut.mjs reports NEEDS-HUMAN on a *-recut branch.
//
// Exact command:
//   node tools/recut-resolve.mjs --worktree .spike/recut-item-3570 [--commit] [--json .spike/x.json]
// Cost: measured 2026-11-14, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node v24.22.1,
// git 2.56.0 — one `node --check` per .mjs and one JSON.parse per .json; see `elapsed_s`.
//
// RULES (each decision is printed with its rule name):
//   R1 IDENTICAL      both sides identical -> keep main.
//   R2 SUPERSET       one side contains every line of the other -> keep the superset (no loss).
//   R3 PROV-UNION     both sides are runbook frontmatter keys -> union the "; " segments of each
//                     key; last_verified keeps the LATER date (chain-resolve rule 9).
//   R4 PARAM-UNION    both sides are one line, the same function, differing only inside an object
//                     parameter `{ a, b }` -> union the parameter names. Must pass node --check.
//   R6 IMPORT-UNION   every line on both sides is `import {…} from "mod"` -> one line per module
//                     with the union of the name lists. Two import lines for the same module are a
//                     redeclaration: node refuses them, so the union is the only lossless merge.
//   R5 BOTH           everything else: main's lines then the ref's lines, exact duplicates dropped.
//                     Refused for code when the union repeats the same statement (two `settings:`
//                     keys parse, but the later silently wins - a loss dressed as a union).
// A resolved file must parse (node --check / JSON.parse); otherwise the markers are restored.
// Exit 0 = no markers left and every touched file parses; 1 = at least one file needs a human.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const argv = process.argv.slice(2);
const wt = argv.includes("--worktree") ? argv[argv.indexOf("--worktree") + 1] : null;
const commit = argv.includes("--commit");
const jsonOut = argv.find((f) => f.startsWith("--json="))?.split("=")[1] ?? null;
if (!wt) { console.error("recut-resolve: need --worktree <path>"); process.exit(2); }

const git = (cwd, a) => {
	const r = spawnSync("git", a, { cwd, encoding: "utf8" });
	return { ok: r.status === 0, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
};
const PROV_KEYS = ["last_verified", "verified_by", "evidence", "owner", "status", "symptom", "related", "milestone", "source", "updated", "note"];
const provLine = (l) => {
	const m = /^\s*([a-z_]+):\s*(.*)$/.exec(l);
	return m && PROV_KEYS.includes(m[1]);
};
const segs = (v) => String(v).split("; ").map((s) => s.trim()).filter(Boolean);
const IMPORT_RE = /^\s*import\s+\{([^}]*)\}\s+from\s+(['"])([^'"]+)\2\s*;?\s*$/;

function importUnion(lines) {
	if (!lines.length || !lines.every((l) => IMPORT_RE.test(l))) return null;
	const byMod = new Map();
	for (const l of lines) {
		const m = IMPORT_RE.exec(l);
	 if (!byMod.has(m[3])) byMod.set(m[3], { indent: /^\s*/.exec(l)[0], names: [] });
		for (const n of m[1].split(",").map((s) => s.trim()).filter(Boolean)) {
			if (!byMod.get(m[3]).names.includes(n)) byMod.get(m[3]).names.push(n);
		}
	}
	return [...byMod.entries()].map(([mod, v]) => `${v.indent}import { ${v.names.join(", ")} } from "${mod}"`);
}

// A union that repeats the same statement parses but lets the later one win silently.
function dupStatement(lines) {
	const seen = new Set();
	for (const l of lines) {
		const t = l.trim();
		if (!t || t.startsWith("//") || t.startsWith("*")) continue;
		if (!/^(const|let|var|function|return)\b|^[A-Za-z_$][\w$]*:|\.\.\./.test(t)) continue;
		if (seen.has(t)) return true;
		seen.add(t);
	}
		return false;
}

function resolveBlock(ours, theirs, isCode) {
	if (ours.join("\n") === theirs.join("\n")) return { rule: "R1 IDENTICAL", lines: ours };
	const iu = importUnion([...ours, ...theirs]);
	if (iu) return { rule: "R6 IMPORT-UNION", lines: iu };
	const oSet = new Set(ours.map((l) => l.trim()));
	const tSet = new Set(theirs.map((l) => l.trim()));
	if ([...oSet].every((l) => tSet.has(l))) return { rule: "R2 SUPERSET(ref)", lines: theirs };
	if ([...tSet].every((l) => oSet.has(l))) return { rule: "R2 SUPERSET(main)", lines: ours };
	if (ours.length && theirs.length && ours.every(provLine) && theirs.every(provLine)) {
		const keys = new Map();
		for (const side of [ours, theirs]) {
			for (const l of side) {
				const m = /^(\s*)([a-z_]+):\s*(.*)$/.exec(l);
				if (!m) continue;
				if (!keys.has(m[2])) keys.set(m[2], { indent: m[1], segs: segs(m[3]) });
				else for (const s of segs(m[3])) if (!keys.get(m[2]).segs.includes(s)) keys.get(m[2]).segs.push(s);
			}
		}
		const lines = [...keys.entries()].map(([k, v]) => `${v.indent}${k}: ${k === "last_verified" ? (v.segs.filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s)).sort().pop() ?? v.segs.join("; ")) : v.segs.join("; ")}`);
		return { rule: "R3 PROV-UNION", lines };
	}
	if (ours.length === 1 && theirs.length === 1) {
		const m1 = /^(\s*)(\w+ )?function (\w+)\((.*)\)(.*)$/.exec(ours[0]);
		const m2 = /^(\s*)(\w+ )?function (\w+)\((.*)\)(.*)$/.exec(theirs[0]);
		if (m1 && m2 && m1[3] === m2[3]) {
			const oa = /\{([^}]*)\}/.exec(m1[4]);
			const ob = /\{([^}]*)\}/.exec(m2[4]);
			if (oa && ob) {
				const names = [...new Set([...oa[1], ...ob[1]].flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean))];
				const params = m1[4].replace(/\{[^}]*\}/, `{${names.join(", ")}}`);
				return { rule: "R4 PARAM-UNION", lines: [`${m1[1]}${m1[2]}function ${m1[3]}(${params})${m1[5]}`] };
			}
		}
	}
	const seen = new Set();
	const union = [...ours, ...theirs].filter((l) => {
		const t = l.trim();
		if (!t) return true;
		if (seen.has(t)) return false;
		seen.add(t);
		return true;
	});
	if (isCode && dupStatement(union)) return { rule: "R5 BOTH-REFUSED(duplicate statement)", lines: null };
	return { rule: "R5 BOTH", lines: union };
}

const files = [...new Set(git(wt, ["diff", "--name-only"]).out.split("\n").filter(Boolean))];
const report = [];
const t0 = Date.now();

for (const f of files) {
	const p = join(wt, f);
	let text;
	try { text = readFileSync(p, "utf8"); } catch { continue; }
	if (!/^<<<<<<< /m.test(text)) continue;
	const isCode = /\.(mjs|js|json)$/.test(f);

	const lines = text.split("\n");
	const out = [];
	const decisions = [];
	let i = 0;
	let refused = 0;
	while (i < lines.length) {
		if (lines[i].startsWith("<<<<<<<")) {
			const ours = [];
			const theirs = [];
			i++;
			while (i < lines.length && !lines[i].startsWith("=======")) { ours.push(lines[i]); i++; }
			i++;
			while (i < lines.length && !lines[i].startsWith(">>>>>>>")) { theirs.push(lines[i]); i++; }
			i++;
			const d = resolveBlock(ours, theirs, isCode);
			if (!d.lines) {
				refused++;
				out.push("<<<<<<< ours", ...ours, "=======", ...theirs, ">>>>>>> theirs");
			 decisions.push({ rule: d.rule, ours: ours.length, theirs: theirs.length });
			 continue;
			}
		 decisions.push({ rule: d.rule, ours: ours.length, theirs: theirs.length });
		 out.push(...d.lines);
		 continue;
		}
		out.push(lines[i]);
		i++;
	}

	const resolved = out.join("\n");
	writeFileSync(p, resolved);

	let valid = true;
	let why = "";
	if (/\.(mjs|js)$/.test(f)) {
		const c = spawnSync(process.execPath, ["--check", p], { encoding: "utf8" });
		if (c.status !== 0) { valid = false; why = (c.stderr || "").split("\n").slice(0, 3).join(" | "); }
	}
	if (/\.json$/.test(f)) {
		try { JSON.parse(resolved); } catch (e) { valid = false; why = e.message; }
	}
	if (!valid || refused) {
		writeFileSync(p, text); // a rule that does not parse is not a resolution: put the markers back
		report.push({ file: f, status: "JUDGEMENT", decisions, why: why || `${refused} block(s) the rules refused` });
	} else {
		report.push({ file: f, status: "RESOLVED", decisions });
	}
}

if (commit) {
	// Count markers in the FILES this run touched — never a whole-tree grep: the worktree carries a
	// node_modules symlink and a grep over it is both slow and irrelevant to this decision.
	const still = report.filter((r) => r.status === "JUDGEMENT").length;
	if (still === 0) git(wt, ["commit", "-q", "-m", "recut-resolve: conflict blocks unioned by rule (R1-R6); see tools/recut-resolve.mjs"]);
}

const judgement = report.filter((r) => r.status === "JUDGEMENT").length;
const rep = { tool: "recut-resolve", worktree: wt, files: report.length, resolved: report.length - judgement, judgement, elapsed_s: ((Date.now() - t0) / 1000).toFixed(1), rows: report };
if (jsonOut) writeFileSync(resolve(process.cwd(), jsonOut), JSON.stringify(rep, null, 1));
for (const r of rep.rows) console.log(`${r.status} ${r.file} [${r.decisions.map((d) => d.rule).join(", ")}]${r.why ? " " + r.why : ""}`);
console.log(`recut-resolve: ${rep.resolved} file(s) resolved by rule, ${rep.judgement} left marked for a human, ${rep.elapsed_s} s`);
process.exit(judgement === 0 ? 0 : 1);
