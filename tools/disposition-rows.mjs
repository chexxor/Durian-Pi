#!/usr/bin/env node
// tools/disposition-rows.mjs — turn "this ref cannot merge losslessly" into a DISPOSITIONS row plus a
// retrievable residue patch, so a held ref is never lost and never re-litigated.
//
// WHY. tools/merge-containment-proof.mjs says a ref loses N lines against main. The rig's rule (R-B
// #3270) forbids deleting the ref, and docs/DISPOSITIONS.md is the append-only home for the decision.
// A row that only says "held" is re-derived by the next inventory and the re-derivation drifts. This tool
// writes the decision WITH the verbatim hunk and the patch that would land it, so the next seat has the
// material, not a summary.
//
// TRIGGER: a ref is refused by tools/chain-resolve.mjs or leaves `<<<<<<<` markers after
// tools/ref-recut.mjs, and you are closing the window's branch census.
//
// Exact command:
//   node tools/disposition-rows.mjs --refs item-5301,item-6101 --out docs/DISPOSITIONS.md --evidence-dir docs/evidence/2026-11-14-recut-residue
//   (--dry-run prints the rows without writing anything)
// Cost: measured 2026-11-14, Linux, Fedora Linux 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node
// v24.22.1, git 2.56.0 — 19 refs in 1.4 s (one containment proof, one git diff per path).
// Exit 0 on success; 1 if any ref actually merged losslessly (then it is NOT a disposition, it is a landing).
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

const argv = process.argv.slice(2);
const repo = argv.includes("--repo") ? argv[argv.indexOf("--repo") + 1] : process.cwd();
const refs = (argv.includes("--refs") ? argv[argv.indexOf("--refs") + 1] : "").split(",").filter(Boolean);
const outFile = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : null;
const evidenceDir = argv.includes("--evidence-dir") ? argv[argv.indexOf("--evidence-dir") + 1] : "docs/evidence/recut-residue";
const main = argv.includes("--main") ? argv[argv.indexOf("--main") + 1] : "refs/heads/main";
const dry = argv.includes("--dry-run");
if (!refs.length) { console.error("disposition-rows: need --refs a,b,c"); process.exit(2); }

const git = (a) => { const r = spawnSync("git", a, { cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 }); return { ok: r.status === 0, status: r.status, out: (r.stdout || "").trim() }; };
const date = new Date().toISOString().slice(0, 10);
const t0 = Date.now();
if (!dry) mkdirSync(join(repo, evidenceDir), { recursive: true });

const rows = [];
const rowSig = [];
let misclassified = 0;
for (const ref of refs) {
	const refname = ref.startsWith("refs/") ? ref : `refs/heads/${ref}`;
	const pr = spawnSync("node", [join(repo, "tools", "merge-containment-proof.mjs"), "--branch", main, "--refs", refname, "--all-lost"], { cwd: repo, encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
	let pj;
	try { pj = JSON.parse(pr.stdout); } catch { rows.push(`| **CANNOT CLASSIFY** | \`${refname}\` | the containment proof did not run: ${(pr.err || pr.stdout).slice(0, 120)} |`); misclassified++; continue; }
	const r = pj.rows[0];
	if (!r.lost || !r.lost.length) { rows.push(`| **NOT A DISPOSITION — mergeable** | \`${refname}\` | containment 0 loss; this ref should be landed or absorbed, not dispositioned |`); misclassified++; continue; }
	const totalLost = r.lost.reduce((s, l) => s + (l.count || 1), 0);
	const base = git(["merge-base", main, refname]).out;
	const patchPaths = r.lost.map((l) => l.path);
	const patch = r.lost.map((l) => {
	 const d = git(["diff", "--no-color", base, refname, "--", l.path]).out;
	 return `--- ${l.path} (${l.count} line(s) of the ref not present in ${main}) ---\n${d}`;
	}).join("\n");
	const file = `${evidenceDir}/${ref.replace(/^refs\/heads\//, "")}-residue.txt`;
	if (!dry) writeFileSync(join(repo, file), `Ref ${refname} — residue not in ${main} (${git(["rev-parse", "--short", main]).out}) at ${date}.\nMerge base ${base}. Lost lines: ${totalLost} across ${r.lost.length} path(s).\nThe verbatim hunk of every path that lost lines follows. Re-cut with:\n  node tools/ref-recut.mjs --ref ${refname} && node tools/recut-resolve.mjs --worktree .spike/recut-${ref.replace(/^refs\/heads\//, "")}\n\n${patch}\n`);
	const firstLine = (r.lost[0].sample || [""])[0];
	const sig = git(["diff", "--no-color", base, refname]).out;
	const mt = git(["merge-tree", "--write-tree", main, refname]).status;
	const dupOf = rowSig.find((x) => x.sig === sig && x.ref !== refname);
	const codePaths = r.lost.filter((l) => /\.(mjs|js|json|ts)$/.test(l.path)).length;
	const state = dupOf
		? "HELD — DUPLICATE ref"
		: codePaths === 0 ? "HELD — residue is prose only (append the residue, no code to judgement)" : "HELD — re-cut needs a seat's judgement";
	rows.push(`| **${state}** | \`${refname}\` | ${totalLost} added line(s) across ${r.lost.length} path(s) are not in \`${git(["rev-parse", "--short", main]).out}\`; \`git merge-tree --write-tree ${main} ${refname}\` exit ${mt}${dupOf ? "; byte-equivalent diff to " + dupOf.ref + " — resolve once" : ""}; verbatim residue in \`${file}\`; first missing line: ${JSON.stringify(firstLine.slice(0, 100))} |`);
	rowSig.push({ ref: refname, sig });
}
const block = `\n## ${date} — the re-cut pass (delegate, goal mwg3lsdp-waokdl)\n\n**Decision rule used:** a ref is landed when its content merges and the derived gate is green; absorbed when every line it added is already in main verbatim (\`tools/absorb-refs.mjs\`, tree unchanged, ref kept); otherwise it is HELD with its verbatim residue recorded, never deleted (R-B #3270).\n\n| state | refs | evidence |\n|---|---|---|\n${rows.join("\n")}\n`;
if (dry) console.log(block);
else { writeFileSync(join(repo, outFile || "docs/DISPOSITIONS.md"), readAppend(outFile), "utf8"); console.log(`disposition-rows: ${rows.length} row(s) appended to ${outFile}; residue in ${evidenceDir}/; ${((Date.now() - t0) / 1000).toFixed(1)} s`); }
function readAppend(f) {
	const p = join(repo, f);
	return (existsSync(p) ? readFileSync(p, "utf8") : "") + block;
}
process.exit(misclassified ? 1 : 0);
