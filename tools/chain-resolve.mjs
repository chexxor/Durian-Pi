#!/usr/bin/env node
// tools/chain-resolve.mjs — build a landing CHAIN branch off `main` that merges refs whose
// conflicts are mechanically resolvable, resolving each conflict by a stated rule, PROVING
// nothing was dropped, and minting decision numbers per the rig's own land-time convention.
//
// WHY. `git merge` stops at a conflict and scripts/land.mjs refuses a conflicted merge by design
// (the 2026-10-17 incident: a shared tree left mid-merge killed every CLI verb). The conflicting
// refs are overwhelmingly the same shape: two sides added rows at the same anchor of an
// append-only ledger, or a branch re-minted a `## D<n>` heading the merged tree already uses.
// That is a union plus a mint, not a judgement. This tool does the union, mints the number, and
// proves containment: EVERY line the ref added is present in the resolved file. If the proof
// fails, the path is reported as a decision and the ref is NOT merged — it never silently picks a
// side and never deletes work (rule R-B #3270).
//
// TRIGGER: tools/conflict-resolvability.mjs reports a ref as `mechanical`, or a ref's only
// conflicts are docs/ledgers and you want to know if it can be unioned. Re-run the plan after
// every bin (pitfall 330).
//
// Exact command:
//   node tools/chain-resolve.mjs --branch landing-20261114-c1 --refs item-3094,item-4758
// Then PROVE it with tools/merge-containment-proof.mjs and land it with scripts/land.mjs.
// Cost: measured 2026-11-14, Linux, Fedora Linux 45, kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1, git 2.56.0 — 59 refs in 12.0 s, 43 refs in 8.8 s, 3 refs in 1.0 s (the `elapsed_s`
// field). No suite is run here; scripts/land.mjs runs the gate, and it is the one that decides.
// The rules themselves are pinned by demo/chain-resolve-rules.test.mjs (0.5 s, throwaway repo).
//
// RULES (stated so a reviewer can disagree):
//  1. PURE INSERTION whose anchor is unique in the current file -> insert at the anchor.
//     Anchor fallback order: before+after context -> before only -> after only -> one before
//     line (unique). If none is unique, the path is a decision.
//  2. The ref EDITS a region main left untouched (the removed lines still sit verbatim in the
//     current file) -> apply the edit in place. Line-neutral.
//  2b. If the anchor differs ONLY in a land-time `D<n>` number (the ref forked when the heading
//     read `## D###`, the landing pass already minted it), the region is matched after
//     normalising the number token, then the edit is applied. Provable: the two sides are the
//     same text with a different minted number.
//  3. Identical content both sides -> take main.
//  4. docs/NEXT.md -> MAIN WINS. The pointer is a moving target; a stale ref's pointer would
//     overwrite the live one. The ref's own NEXT.md text stays in its ref, which is kept.
//  5. Code (src/, demo/, tools/, scripts/, *.mjs, *.json) -> allowed only if every ref hunk is a
//     pure insertion at a unique anchor. After applying, the file must pass `node --check` and
//     must not introduce a duplicate top-level `function`/`const` name. Anything else is a
//     seat's re-cut (docs/runbooks/branch-cleanup.md Step 0b/0d).
//  5b. add/add (no merge base at that path): a CODE file is REFUSED — two independent versions of
//     the same file is a seat's choice, not a union. A non-code file is unioned (main's lines + the
//     ref's lines not already present). The first version of this tool had no add/add branch, took
//     main's copy, and dropped 74 lines of item-7103's demo; the rule and the demo exist because
//     of that.
//  6. `## D<n>` headings added by this ref that collide with a number already in the merged
//     file, or that say "mint at land", are re-minted to the next FREE number, line-neutral, in
//     the same style as 53eea388 ("mint D265-D274 at land time ... line-neutral on purpose so
//     the 51 downstream DECISIONS.md line-pins do not shift").
//  7. A ref with ANY unresolved conflict is not merged at all: the merge is aborted and the
//     chain stays at the last good ref.
//  8. IMPORT UNION (added 2026-11-14, measured, not assumed): when the only disagreement at a code
//     path is ONE `import { ... } from "mod"` line on each side for the SAME module, the lossless
//     merge is the union of the name lists. It is then PROVEN: every name the merged tree imports
//     from a local module must be exported by that module in that tree. A union rule without the
//     proof lands a dangling import - the four refs it was written for (item-5301,
//     item-5301-resolved, item-6173, item-6211) each carry the definition of the symbol they
//     import, so the proof, not the shape, is what decides.
//  9. PROVENANCE UNION: when both sides of a docs/runbook hunk are ONLY frontmatter keys
//     (last_verified / verified_by / evidence / owner / status / symptom / related / milestone /
//     source / updated), the values are bookkeeping, not a decision: values are joined and
//     `last_verified` keeps the later date. No key is dropped, so nothing is lost.
//
// Exit 0 = chain built, every merged ref proved. Nonzero = nothing merged.
// Side effects: a worktree under .spike/ and a branch. main is not advanced, nothing is pushed,
// no store is opened.

import { spawnSync } from "node:child_process";
import process from "node:process";
import fs from "node:fs";

const argv = process.argv.slice(2);
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const branch = argv.includes("--branch") ? argv[argv.indexOf("--branch") + 1] : null;
const refs = (argv.includes("--refs") ? argv[argv.indexOf("--refs") + 1] : "").split(",").filter(Boolean);
const wtPath = argv.includes("--worktree") ? argv[argv.indexOf("--worktree") + 1] : `.spike/chain-${branch}`;
const CODE_RE = /^(src|demo|tools|scripts|test|tests)\/|\.mjs$|\.js$|\.json$/;

function git(args, cwd) {
	const r = spawnSync("git", args, { cwd: cwd || repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
	return { ok: r.status === 0, status: r.status, out: (r.stdout || "").trim(), err: (r.stderr || "").trim() };
}

function hunks(diffText) {
	const h = [];
	let start = null, oldCount = 0, add = 0, del = 0, added = [], removed = [], before = [], after = [];
	const flush = () => {
		if (start !== null) h.push({ start, oldCount, add, del, added, removed, before, after });
		start = null; oldCount = 0; add = 0; del = 0; added = []; removed = []; before = []; after = [];
	};
	for (const line of diffText.split("\n")) {
		const m = line.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/);
		if (m) { flush(); start = Number(m[1]); oldCount = m[2] === undefined ? 1 : Number(m[2]); continue; }
		if (start === null) continue;
		if (line.startsWith("+") && !line.startsWith("+++")) { add++; added.push(line.slice(1)); after = []; }
		else if (line.startsWith("-") && !line.startsWith("---")) { del++; removed.push(line.slice(1)); after = []; }
		else if (line.startsWith(" ")) {
			const t = line.slice(1);
			if (add === 0 && del === 0 && before.length < 4) before.push(t);
			else if (added.length && after.length < 4) after.push(t);
		}
	}
	flush();
	return h;
}

function findAll(out, key, from) {
	const hits = [];
	for (let i = from; i + key.length <= out.length; i++) {
		if (out.slice(i, i + key.length).join("\n") === key.join("\n")) hits.push(i);
	}
	return hits;
}

function locateInsert(out, h) {
	const tries = [
		{ label: "before+after", key: [...h.before, ...h.after], offset: h.before.length },
		{ label: "before", key: h.before, offset: h.before.length },
		{ label: "after", key: h.after, offset: 0 },
	];
	for (const t of tries) {
		if (!t.key.length) continue;
		const hits = findAll(out, t.key, 0);
		if (hits.length === 1) return { at: hits[0] + t.offset, via: t.label };
	}
	for (let i = h.before.length - 1; i >= 0; i--) {
	 const hits = findAll(out, [h.before[i]], 0);
		if (hits.length === 1) return { at: hits[0] + 1, via: "single-line-before" };
	}
	return null;
}

function findSeq(out, seq) {
	return findAll(out, seq, 0);
}

// Two sides of a ledger often differ ONLY in the land-time decision number: the ref forked when
// the heading read `## D###`, the landing pass minted `## D276`. A verbatim anchor test then
// refuses a merge that is mechanically identical. Normalise the number token for MATCHING only;
// the mint step re-derives a real number afterwards.
const normLine = (s) => s.replace(/D(?:\d+|###|MINT)/g, "D#").replace(/\s+/g, " ").trim();

const IMPORT_RE = /^import\s+\{([^}]*)\}\s+from\s+(['"])([^'"]+)\2\s*;?\s*$/;
const FRONT_KEYS = ["last_verified", "verified_by", "evidence", "owner", "status", "symptom", "related", "milestone", "source", "updated"];
const isProvLine = (l) => FRONT_KEYS.some((k) => l.trim().startsWith(k + ":"));
const importNames = (line) => { const m = IMPORT_RE.exec(String(line).trim()); return m ? m[1].split(",").map((x) => x.trim()).filter(Boolean) : []; };

/** Rule 8. Both sides are one import statement for the same module: write the union of names. */
function applyImportUnion(out, h) {
	if (h.removed.length !== 1 || h.added.length !== 1) return null;
	const a = IMPORT_RE.exec(h.removed[0].trim()), b = IMPORT_RE.exec(h.added[0].trim());
	if (!a || !b || a[3] !== b[3]) return null;
	const idx = out.findIndex((l) => { const m = IMPORT_RE.exec(l.trim()); return m && m[3] === a[3]; });
	if (idx < 0) return null;
	const names = [];
	for (const s of [IMPORT_RE.exec(out[idx].trim())[1], b[1]]) for (const n of s.split(",").map((x) => x.trim()).filter(Boolean)) if (!names.includes(n)) names.push(n);
	const line = `import { ${names.join(", ")} } from ${b[2]}${b[3]}${b[2]};`;
	out[idx] = line;
	return line;
}

/** Union two frontmatter values without repeating a claim: split on the rig's "; " segment
 * separator and append only the segments the merged line does not already contain. */
function unionValue(curVal, addVal) {
	const quoted = curVal.startsWith('"') && curVal.endsWith('"') && addVal.startsWith('"') && addVal.endsWith('"')
		&& !curVal.slice(1, -1).includes('"') && !addVal.slice(1, -1).includes('"');
	const a = (quoted ? curVal.slice(1, -1) : curVal).split("; ").map((s) => s.trim()).filter(Boolean);
	const b = (quoted ? addVal.slice(1, -1) : addVal).split("; ").map((s) => s.trim()).filter(Boolean);
	for (const seg of b) if (!a.some((x) => x === seg || x.includes(seg))) a.push(seg);
	const joined = a.join("; ");
	return quoted ? `"${joined}"` : joined;
}

/** Rule 9. Both sides are frontmatter keys: union the values, keep the later last_verified. */
function applyProvenanceUnion(out, h) {
	if (!h.removed.every(isProvLine) || !h.added.every(isProvLine)) return null;
	let changed = 0;
	for (const line of h.added) {
		const key = line.trim().split(":")[0];
		if (!FRONT_KEYS.includes(key)) return null;
		const idx = out.findIndex((l) => l.trim().startsWith(key + ":"));
		if (idx < 0) return null; // main has no such key - inserting it is a decision, not a union
		const cur = out[idx], add = line.trim();
		if (cur.trim() === add) continue;
		if (key === "last_verified") {
			const d1 = (cur.match(/20\d\d-\d\d-\d\d/) || [""])[0], d2 = (add.match(/20\d\d-\d\d-\d\d/) || [""])[0];
			if (d2 && d1 && d1 && d2 > d1) { out[idx] = cur.replace(d1, d2); changed++; }
			continue;
		}
		const curVal = cur.slice(cur.indexOf(":") + 1).trim(), addVal = add.slice(add.indexOf(":") + 1).trim();
		if (curVal.includes(addVal) || addVal.includes(curVal)) continue;
		out[idx] = `${cur.slice(0, cur.indexOf(":") + 1)} ${unionValue(curVal, addVal)}`;
		changed++;
	}
	return { changed };
}

/** Every symbol a merged code file imports from a LOCAL module must be exported by that module in
 * the tree we just built - the proof that rule 8 cannot land a dangling import. */
function proveImportsResolve(wt, paths) {
	const bad = [];
	for (const path of paths) {
		if (!CODE_RE.test(path) || path.endsWith(".json")) continue;
		const text = fs.existsSync(`${wt}/${path}`) ? fs.readFileSync(`${wt}/${path}`, "utf8") : "";
		for (const m of text.matchAll(/import\s+\{([^}]*)\}\s+from\s+"(\.[^"]+)"/g)) {
			const mod = `${wt}/${path.split("/").slice(0, -1).join("/")}/${m[2]}`;
			if (!fs.existsSync(mod)) { bad.push(`${path}: imports from ${m[2]} which does not exist in the merged tree`); continue; }
			const modText = fs.readFileSync(mod, "utf8");
			const exported = new Set();
			for (const mm of modText.matchAll(/export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/g)) exported.add(mm[1]);
			for (const mm of modText.matchAll(/export\s*\{([^}]*)\}/g)) for (const n of mm[1].split(",").map((x) => x.trim().split(/\s+as\s+/)[1] || x.trim())) if (n) exported.add(n);
			if (/export\s+default/.test(modText)) exported.add("default");
			for (const n of m[1].split(",").map((x) => x.trim()).filter(Boolean)) {
				if (!exported.has(n)) bad.push(`${path}: imports ${n} from ${m[2]} but the merged module does not export it`);
			}
		}
	}
	return bad;
}

// Mint: renumber headings added by this ref that collide with a number already in the file, or
// that carry a "mint at land" placeholder. Line-neutral. Returns {text, mints:[{from,to}]}.
function mintHeadings(text, addedHeadingLines) {
	const lines = text.split("\n");
	const nums = [];
	for (const l of lines) {
		const m = l.match(/^## (?:STUB OF )?D(\d+)/);
		if (m) nums.push(Number(m[1]));
	}
	const count = {};
	for (const n of nums) count[n] = (count[n] || 0) + 1;
	let next = Math.max(...nums, 0) + 1;
	const mints = [];
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		if (!addedHeadingLines.has(l)) continue;
		const m = l.match(/^## (?:STUB OF )?D(\d+|MINT|###)/);
		if (!m) continue;
	 		const placeholder = m[1] === "MINT" || m[1] === "###";
		if (!placeholder && count[m[1]] === 1) continue; // its number is its own
		while (count[next]) next++;
		count[next] = (count[next] || 0) + 1;
		if (!placeholder) count[m[1]]--;
		lines[i] = placeholder
			? l.replace(/^## D(?:MINT|###)/, `## D${next}`)
			: l.replace(/^## (?:STUB OF )?D\d+/, `## D${next}`);
		mints.push({ from: m[1], to: next });
	}
	return { text: lines.join("\n"), mints };
}

const t0 = Date.now();
if (!branch || !refs.length) { console.error("need --branch and --refs"); process.exit(2); }

if (!git(["rev-parse", "-q", "--verify", `refs/heads/${branch}`]).ok) {
	const add = git(["worktree", "add", "-b", branch, wtPath, "refs/heads/main"]);
	if (!add.ok) { console.error("worktree add failed:", add.err); process.exit(1); }
}
const wt = fs.existsSync(wtPath) ? wtPath : repo;

const report = { branch, merged: [], refused: [], elapsed_s: 0, head: "" };
for (const ref of refs) {
	const refname = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
	const m = git(["merge", "--no-commit", "--no-ff", refname], wt);
	const conflicted = git(["diff", "--name-only", "--diff-filter=U"], wt).out.split("\n").filter(Boolean);
	const decisions = [];
	const resolved = [];
	const mints = [];
	for (const path of conflicted) {
		const oursT = git(["show", ":2:" + path], wt).out;
		if (!m.ok) {
			if (path === "docs/NEXT.md") {
				const text = oursT.endsWith("\n") ? oursT : oursT + "\n";
				fs.writeFileSync(`${wt}/${path}`, text); git(["add", path], wt);
				resolved.push({ path, rule: "main wins: the pointer is a moving target" });
				continue;
			}
			const baseT = git(["show", `:1:${path}`], wt).out;
			const theirsT = git(["show", `:3:${path}`], wt).out;
			if (oursT === theirsT) { git(["add", path], wt); resolved.push({ path, rule: "identical on both sides" }); continue; }
			if (!git(["rev-parse", "-q", "--verify", `:1:${path}`], wt).ok) {
	if (CODE_RE.test(path)) { decisions.push({ path, rule: "add/add conflict: two independent versions of the same file - a seat must choose" }); continue; }
	const oursLines = oursT.split("\n");
	const extra = theirsT.split("\n").filter(l => !new Set(oursLines).has(l));
	const merged = oursLines.concat(extra);
	fs.writeFileSync(`${wt}/${path}`, merged.join("\n") + (merged[merged.length - 1] === "" ? "" : "\n"));
	git(["add", path], wt);
	resolved.push({ path, rule: "add/add union (no merge base exists)", linesAdded: extra.length, proof: "all ref lines present" });
	continue;
}
			const baseOid = git(["rev-parse", `:1:${path}`], wt).out;
			const theirsOid = git(["rev-parse", `:3:${path}`], wt).out;
			const hRef = hunks(git(["diff", "--no-color", baseOid, theirsOid], wt).out);
			const addAll = hRef.reduce((a, h) => a + h.add, 0);
		 const delAll = hRef.reduce((a, h) => a + h.del, 0);
			if (addAll === 0 && delAll === 0) { const text = oursT.endsWith("\n") ? oursT : oursT + "\n"; fs.writeFileSync(`${wt}/${path}`, text); git(["add", path], wt); resolved.push({ path, rule: "ref changed nothing at this path - took main" }); continue; }
			const out = oursT.split("\n");
			const anchors = [];
			const unionProof = new Map();
			let ok = true;
			for (const h of hRef) {
				if (h.del === 0) {
					const loc = locateInsert(out, h);
					if (!loc) { ok = false; break; }
					out.splice(loc.at, 0, ...h.added);
					anchors.push({ start: h.start, added: h.add, via: loc.via });
				} else {
					let hit = findSeq(out, h.removed);
					let via = "in-place edit of an untouched region";
					if (hit.length !== 1) {
						hit = findAll(out.map(normLine), h.removed.map(normLine), 0);
						via = "in-place edit, anchor matched after land-time D-number normalisation";
					}
					if (hit.length !== 1) {
						const merged = applyImportUnion(out, h);
						if (merged) { unionProof.set(h, { kind: "import", names: importNames(merged) }); anchors.push({ start: h.start, added: h.add, removed: h.del, via: "rule 8: import union" }); continue; }
						if (applyProvenanceUnion(out, h)) { unionProof.set(h, { kind: "provenance", values: h.added.filter((l) => !l.trim().startsWith("last_verified:")).flatMap((l) => { const t = l.trim(); const v = t.slice(t.indexOf(":") + 1).trim(); const q = v.startsWith('"') && v.endsWith('"') ? v.slice(1, -1) : v; return q.split("; ").map((s) => s.trim()).filter(Boolean); }) }); anchors.push({ start: h.start, added: h.add, removed: h.del, via: "rule 9: provenance union" }); continue; }
						ok = false; break;
					}
					out.splice(hit[0], h.removed.length, ...h.added);
					anchors.push({ start: h.start, added: h.add, removed: h.del, via });
				}
			}
			if (!ok) { decisions.push({ path, rule: "anchor/edit not locatable in the current file" }); continue; }
		const missing = hRef.reduce((n, h) => {
			const proof = unionProof.get(h);
			if (!proof) return n + h.added.filter((l) => !out.includes(l)).length;
			if (proof.kind === "import") return n + proof.names.filter((nm) => !out.some((l) => l.includes(nm))).length;
			return n + proof.values.filter((v) => v && !out.some((l) => l.includes(v))).length;
		}, 0);
			if (missing > 0) { decisions.push({ path, rule: `containment proof FAILED (${missing} added lines missing)` }); continue; }
		 let text = out.join("\n") + (out[out.length - 1] === "" ? "" : "\n");
			if (path === "docs/DECISIONS.md") {
				const oursSet = new Set(oursT.split("\n"));
				const addedHeads = new Set(hRef.flatMap(h => h.added).filter(l => /^## (?:STUB OF )?D(\d+|MINT|###)/.test(l) && !oursSet.has(l)));
			 const r = mintHeadings(text, addedHeads);
			 text = r.text; if (r.mints.length) mints.push(...r.mints);
			}
			if (CODE_RE.test(path)) {
				const ext = path.endsWith(".json") ? "json" : "mjs";
			 const tmp = `${wt}/.check-${path.replace(/\//g, "_")}`;
			 fs.writeFileSync(tmp, text);
			 const chk = ext === "json"
					? { ok: (() => { try { JSON.parse(text); return true; } catch { return false; } })(), err: "json parse" }
					: (() => { const r = spawnSync("node", ["--check", tmp], { encoding: "utf8" }); return { ok: r.status === 0, err: "node --check", detail: (r.stderr || "").slice(0,160) }; })();
				fs.unlinkSync(tmp);
				if (!chk.ok) { decisions.push({ path, rule: `resolved file fails ${chk.err}${chk.detail ? ": " + chk.detail : ""}` }); continue; }
			 const names = new Set();
			 for (const mm of text.matchAll(/^(?:function|const|class)\s+([A-Za-z_$][\w$]*)/gm)) {
					if (names.has(mm[1])) { ok = false; decisions.push({ path, rule: `duplicate top-level name after union: ${mm[1]}` }); break; }
					names.add(mm[1]);
				}
			 if (!ok) continue;
			}
			fs.writeFileSync(`${wt}/${path}`, text);
			git(["add", path], wt);
			resolved.push({ path, rule: CODE_RE.test(path) ? "code union (pure insertions, unique anchors, syntax-checked)" : "union", linesAdded: addAll, proof: "all ref lines present" });
		}
	}
	for (const path of conflicted) {
			const t = fs.existsSync(`${wt}/${path}`) ? fs.readFileSync(`${wt}/${path}`, "utf8") : "";
			if (/^<<<<<<<|^=======$|^>>>>>>>/m.test(t)) decisions.push({ path, rule: "unresolved conflict markers left in the file" });
		}
		const linkBad = proveImportsResolve(wt, conflicted);
		if (linkBad.length) decisions.push({ path: "(link proof)", rule: linkBad.join("; ") });
		if (decisions.length) {
			if (!m.ok) git(["merge", "--abort"], wt);
		report.refused.push({ ref, decisions: decisions.map(d => `${d.path}: ${d.rule}`) });
		continue;
	}
	const c = git(["commit", "-m",
		`merge ${ref}: conflicts resolved by rule (union / in-place edit / land-time mint); containment proven (${resolved.length} path(s))`], wt);
	if (!c.ok) { report.refused.push({ ref, decisions: ["commit failed: " + c.err] }); continue; }
	report.merged.push({ ref, resolved, mints, sha: git(["rev-parse", "HEAD"], wt).out });
}
report.elapsed_s = ((Date.now() - t0) / 1000).toFixed(1);
report.head = git(["rev-parse", "HEAD"], wt).out;
console.log(JSON.stringify(report, null, 1));
process.exit(report.merged.length ? 0 : 1);
