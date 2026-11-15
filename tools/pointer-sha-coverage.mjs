// tools/pointer-sha-coverage.mjs — does the pointer name every commit it claims to name?
//
// SYMPTOM this answers: an auditor says "the NEXT sha table skips <sha>" or "it is not in order".
// The pointer's table promises "one line per shipped object"; a commit that shipped inside the
// milestone range but is absent from the table is a hole, and a hand-pass over 30 shas misses one
// (measured: two audits in a row found a skipped sha, `5b8e3644` then `0de543ae`).
//
// THE RULE: every commit in `<base>..HEAD` is either a ROW in the table or the commit that carries
// the pointer itself (a file cannot name the commit that contains it — that one is exempt and
// reported by name). Everything else must be a row, and rows must appear in commit order.
// A landing-MERGE row covers the commits that came in with it: `merge: land <branch> onto main`
// names one landing, and the seat commits inside that branch are reachable from its second parent
// and not from main's side. That rule was added 2026-11-14 because a chain-resolved landing of 43
// refs makes a one-row-per-commit pointer impossible inside the 200-line cap of docs/NEXT.md.
//
// COST: 0.3-0.6 s (git log + one file read; no store, no network, no model). Re-measured 2026-11-14
// with the merge-coverage rule: 0.35 s on a 243-commit range.
//
// THE POINTER IS CUT. When docs/NEXT.md hits its 200-line cap its older blocks move VERBATIM to
// docs/NEXT-ARCHIVE.md, so a range that reaches past the cut has no chance of closing if the tool reads
// only the live file (measured 2026-11-14, Linux Fedora 45, node v24.22.1: the default merge-base range
// reported 265 "holes", most of them named in the archive). Archive rows therefore count as named and
// their landing merges count as coverage; the ORDER check still applies to the live pointer only, since
// the archive is a stack of dated blocks, not one table.
// ADDENDUM 2026-11-15 (delegate, queue-backlog tranche): the tool compared an ABBREVIATED sha against
// a Set of FULL shas, with a hardcoded `slice(0, 8)` as the only bridge. git widens `%h` by itself
// (measured on this repo: `git log --format=%h -1 HEAD` -> `9bdcacc2e`, 9 chars, and `git log --format=%h`
// was 8 chars a month ago), so past that threshold every landing-MERGE row stopped covering its branch
// and the tool reported **80 false holes** (exit 1) over a range whose pointer was complete. Fixed in
// place: the range is read as BOTH `%H` and `%h`, membership tests use the full sha, and `%h` is kept
// only for display and for prefix-matching a table row. Verified at `16f70cf8` on Linux, Fedora Linux
// 45 (Forty Five), kernel 7.2.15-300.fc45.x86_64, node v24.22.1: before the fix exit 1 / 80 holes in
// 1.4 s; after, exit 0 (187 range commits, 45 + 201 rows, 0 holes / 0 ordering defects) in 1.4 s.
// Run: node tools/pointer-sha-coverage.mjs [--base <sha>] [--file docs/NEXT.md] [--archive docs/NEXT-ARCHIVE.md] [--json]
// Use --no-archive to ignore the archive. Exit 0 = every range commit is named (or is the carrier),
// 1 = holes / out-of-order rows, 2 = usage.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const asJson = argv.includes("--json");
const file = flag("file", "docs/NEXT.md");
// `--no-archive` ignores the archive; `--archive <path>` points it elsewhere.
const archiveFile = argv.includes("--no-archive") ? null : flag("archive", "docs/NEXT-ARCHIVE.md");

if (!existsSync(file)) {
	console.error(`pointer-sha-coverage: no such pointer file: ${file}`);
	process.exit(2);
}

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();

let base = flag("base", null);
let baseLabel = "--base";
if (!base) {
	try {
		base = git("merge-base", "origin/main", "HEAD");
		baseLabel = "merge-base(origin/main, HEAD)";
	} catch {
		base = git("rev-parse", "HEAD~1");
		baseLabel = "HEAD~1 (no origin/main)";
	}
}

const head = git("rev-parse", "HEAD");
// Oldest-first: the table is ordered "in order" of shipping.
// `%H` AND `%h`: git widens `%h` on its own as objects accumulate, so an abbreviated sha is only ever
// used for display and for prefix-matching a table row; Set membership uses the full sha.
const commits = git("log", "--reverse", "--format=%H%x09%h%x09%s", `${base}..HEAD`)
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const [full, sha, ...rest] = line.split("\t");
		return { full, sha, subject: rest.join("\t") };
	});

const text = readFileSync(file, "utf8");
// Rows look like: | `655c44e2` | what shipped |
const rowShas = (s) => [...s.matchAll(/^\|\s*`([0-9a-f]{7,40})`\s*\|/gm)].map((m) => m[1]);
const rows = rowShas(text);
const rowIndex = new Map();
rows.forEach((sha, i) => {
	if (!rowIndex.has(sha)) rowIndex.set(sha, i);
});

const archiveRows = archiveFile && existsSync(archiveFile) ? rowShas(readFileSync(archiveFile, "utf8")) : [];

// A landing MERGE row covers the commits that came in with it. `merge: land <branch> onto main`
// is one row in a pointer that cannot fit 43 seat commits; the merge's second parent is the
// branch head, so every commit reachable from it but not from the main-side parent shipped inside
// that landing. Measured 2026-11-14: the 2026-11-14 docs landing carried 43 such commits in one
// row. Without this rule, a chain of provable merges makes the pointer physically impossible to
// keep inside its 200-line cap, and the honest alternative (drop rows) is the hole the tool was
// built to catch.
const covered = new Set();
for (const row of [...rows, ...archiveRows]) {
	let full;
	try { full = git("rev-parse", row); } catch { continue; }
	let parents;
	try { parents = git("rev-parse", `${full}^@`).split("\n").filter(Boolean); } catch { continue; }
	if (parents.length < 2) continue;
	const sideBranch = parents.slice(1);
	for (const p of sideBranch) {
		for (const c of git("rev-list", `${full}^1..${p}`).split("\n").filter(Boolean)) {
			covered.add(c); // full shas only — `slice(0, 8)` was the bug: `%h` is now 9 chars here
		}
		covered.add(p);
	}
}

const matches = (list, sha) => list.some((r) => sha.startsWith(r) || r.startsWith(sha));
const namedByRow = (sha) => matches([...rowIndex.keys()], sha) || matches(archiveRows, sha);
const named = (c) => namedByRow(c.sha) || covered.has(c.full);
const coveredOnly = commits.filter((c) => covered.has(c.full) && !namedByRow(c.sha)).length;

const missing = commits.filter((c) => !named(c) && !head.startsWith(c.sha));
const carrier = commits.find((c) => head.startsWith(c.sha)) ?? null;

// Order: the sequence of named commits as they appear in the table must be a subsequence of
// the commit order. Compare positions of the commits that ARE named.
const positions = commits
	.map((c, i) => ({ c, i }))
	.filter(({ c }) => named(c))
	.map(({ c, i }) => ({ sha: c.sha, commitOrder: i, tableOrder: rowIndex.get([...rowIndex.keys()].find((r) => c.sha.startsWith(r) || r.startsWith(c.sha))) }));
const outOfOrder = [];
for (let k = 1; k < positions.length; k += 1) {
	if (positions[k].tableOrder < positions[k - 1].tableOrder) {
		outOfOrder.push({ previous: positions[k - 1].sha, next: positions[k].sha });
	}
}

// Rows naming something outside the range are not holes, but they are worth naming: the table is
// a milestone table, and a row for a sha outside the range is either history or a typo.
const foreign = [...rowIndex.keys()].filter((r) => !commits.some((c) => c.sha.startsWith(r) || r.startsWith(c.sha)) && !head.startsWith(r));

const ok = missing.length === 0 && outOfOrder.length === 0;
const report = {
	tool: "pointer-sha-coverage",
	file,
	archive: archiveRows.length ? archiveFile : null,
	archiveRows: archiveRows.length,
	base: `${base.slice(0, 8)} (${baseLabel})`,
	head: head.slice(0, 8),
	rangeCommits: commits.length,
	tableRows: rows.length,
	carrier: carrier ? carrier.sha : null,
	missing,
	outOfOrder,
	foreign,
	ok,
};

if (asJson) {
	console.log(JSON.stringify(report, null, 1));
} else {
	console.log(`pointer-sha-coverage — ${file}, range ${report.base}..${report.head} (${report.rangeCommits} commits)`);
	console.log(`  table rows: ${report.tableRows} in ${file}${report.archiveRows ? ` + ${report.archiveRows} in ${report.archive}` : ""}`);
	console.log(`  carrier (exempt, cannot name itself): ${report.carrier ?? "(HEAD is not in the range)"}`);
	for (const m of missing) console.log(`  MISSING   ${m.sha}  ${m.subject}`);
	console.log(`  covered: ${coveredOnly} commit(s) inside a landing merge the table already names (a merge row covers its branch)`);
	for (const o of outOfOrder) console.log(`  OUT-OF-ORDER  ${o.next} appears before ${o.previous}`);
	for (const f of foreign) console.log(`  NOT-IN-RANGE  ${f} (row names a commit outside ${report.base}); stale row or typo`);
	console.log(ok ? "  verdict: every range commit is named" : `  verdict: ${missing.length} hole(s), ${outOfOrder.length} ordering defect(s)`);
}
process.exit(ok ? 0 : 1);
