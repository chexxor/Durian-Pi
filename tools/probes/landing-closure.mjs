// tools/probes/landing-closure.mjs — measure whether a LANDING row is genuinely done (#4378).
//
// THE RULE this enforces: a landing row may be closed only when BOTH facts hold —
//   1. ANCESTRY: `git merge-base --is-ancestor <sha> <tree>` exits 0
//   2. CONTENT: every line that commit ADDED is present in `<tree>:<file>`
// Ancestry alone is the #4035 mistake: a merge can carry a commit while the change is
// absent from the tree (dropped in resolution, squashed away, or reverted).
//
// Run:
//   node tools/probes/landing-closure.mjs [tree] [rows.json]
// rows.json = [{id, subject, body}, ...] — the sha candidates are read from the text.
// Reads the repo; writes nothing. Exit 0 always (the table is the output).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const TREE = process.argv[2] || "main";
const ROWS_FILE = process.argv[3] || "landing-rows.json";

function git(args) {
	try {
		return execFileSync("git", args, { encoding: "utf8" });
	} catch {
		return null; // git's own failure is the measurement (unresolvable sha, absent file)
	}
}

function resolves(sha) {
	const out = git(["rev-parse", "--verify", `${sha}^{commit}`]);
	return out ? out.trim() : null;
}

function isAncestor(sha) {
	try {
		execFileSync("git", ["merge-base", "--is-ancestor", sha, TREE], { stdio: "pipe" });
		return true;
	} catch {
		return false;
	}
}

// Lines the commit added, grouped by the file they were added to.
function addedLines(sha) {
	const diff = git(["show", "--format=", "--no-color", sha]);
	if (diff === null) return {};
	const perFile = {};
	let file = null;
	for (const line of diff.split("\n")) {
		if (line.startsWith("diff --git ")) {
			const m = line.match(/ b\/(.+)$/);
		 file = m ? m[1] : null;
		 continue;
		}
		if (line.startsWith("+++ ")) {
			const target = line.slice(4).trim();
			if (target !== "/dev/null") file = target.replace(/^b\//, "");
			continue;
		}
		if (file && line.startsWith("+") && !line.startsWith("+++")) {
		 const text = line.slice(1);
		 if (text.trim().length >= 4) (perFile[file] ||= []).push(text);
		}
	}
	return perFile;
}

function contentProbe(sha) {
	const perFile = addedLines(sha);
	let total = 0;
	let matched = 0;
	const missing = [];
	for (const [file, lines] of Object.entries(perFile)) {
		const treeFile = git(["show", `${TREE}:${file}`]);
		if (treeFile === null) {
			total += lines.length;
			missing.push(`${file}: absent from ${TREE}`);
			continue;
		}
		const set = new Set(treeFile.split("\n"));
		for (const line of lines) {
			total += 1;
			if (set.has(line)) matched += 1;
			else missing.push(`${file}: ${line.trim().slice(0, 70)}`);
		}
	}
	return { total, matched, missing };
}

const rows = JSON.parse(readFileSync(ROWS_FILE, "utf8"));
const closable = [];
for (const row of rows) {
	const text = `${row.subject} ${row.body || ""}`;
	const candidates = [...new Set(text.match(/(?<![A-Za-z0-9_])[0-9a-f]{7,40}(?![A-Za-z0-9_])/g) || [])];
	const measured = [];
	for (const sha of candidates) {
		const full = resolves(sha);
		if (!full) {
			measured.push({ sha, resolves: false });
			continue;
		}
		const ancestor = isAncestor(full);
		const content = contentProbe(full);
		measured.push({ sha, full: full.slice(0, 10), ancestor, added: content.total, matched: content.matched, missing: content.missing.slice(0, 5) });
		if (ancestor && content.total > 0 && content.matched === content.total) closable.push({ id: row.id, sha: full.slice(0, 10), added: content.total });
	}
	console.log(`#${row.id} ${closable.some((c) => c.id === row.id) ? "CLOSE" : "KEEP"} :: ${row.subject.slice(0, 70)}`);
	for (const m of measured) {
		console.log(`   ${m.sha} resolves=${m.resolves !== false} ancestor=${m.ancestor ?? "?"} content=${m.matched ?? 0}/${m.added ?? 0}${m.missing ? " missing: " + m.missing.join(" | ") : ""}`);
	}
}
console.log(`closable (${closable.length}): ${closable.map((c) => `#${c.id} @${c.sha} ${c.added}/${c.added}`).join(", ")}`);
