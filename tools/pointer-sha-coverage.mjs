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
//
// COST: 0.3-0.6 s (git log + one file read; no store, no network, no model).
// Run: node tools/pointer-sha-coverage.mjs [--base <sha>] [--file docs/NEXT.md] [--json]
// Exit 0 = every range commit is named (or is the carrier), 1 = holes / out-of-order rows, 2 = usage.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const asJson = argv.includes("--json");
const file = flag("file", "docs/NEXT.md");

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
const commits = git("log", "--reverse", "--format=%h%x09%s", `${base}..HEAD`)
	.split("\n")
	.filter(Boolean)
	.map((line) => {
		const [sha, ...rest] = line.split("\t");
		return { sha, subject: rest.join("\t") };
	});

const text = readFileSync(file, "utf8");
// Rows look like: | `655c44e2` | what shipped |
const rows = [...text.matchAll(/^\|\s*`([0-9a-f]{7,40})`\s*\|/gm)].map((m) => m[1]);
const rowIndex = new Map();
rows.forEach((sha, i) => {
	if (!rowIndex.has(sha)) rowIndex.set(sha, i);
});

const named = (sha) => [...rowIndex.keys()].some((r) => sha.startsWith(r) || r.startsWith(sha));

const missing = commits.filter((c) => !named(c.sha) && !head.startsWith(c.sha));
const carrier = commits.find((c) => head.startsWith(c.sha)) ?? null;

// Order: the sequence of named commits as they appear in the table must be a subsequence of
// the commit order. Compare positions of the commits that ARE named.
const positions = commits
	.map((c, i) => ({ c, i }))
	.filter(({ c }) => named(c.sha))
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
	console.log(`  table rows: ${report.tableRows}`);
	console.log(`  carrier (exempt, cannot name itself): ${report.carrier ?? "(HEAD is not in the range)"}`);
	for (const m of missing) console.log(`  MISSING   ${m.sha}  ${m.subject}`);
	for (const o of outOfOrder) console.log(`  OUT-OF-ORDER  ${o.next} appears before ${o.previous}`);
	for (const f of foreign) console.log(`  NOT-IN-RANGE  ${f} (row names a commit outside ${report.base}); stale row or typo`);
	console.log(ok ? "  verdict: every range commit is named" : `  verdict: ${missing.length} hole(s), ${outOfOrder.length} ordering defect(s)`);
}
process.exit(ok ? 0 : 1);
