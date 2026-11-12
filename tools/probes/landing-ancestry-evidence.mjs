#!/usr/bin/env node
// tools/probes/landing-ancestry-evidence.mjs — #7291: per-row ancestry evidence for the LANDING rows
// the drain audit calls zero-build closable, so pm can close them by a rule instead of one at a time.
//
// WHY THIS EXISTS. tools/queue-drain-audit.mjs answers "is every cited sha in main's rev-list" and
// prints a count plus an id list. A count is not closable evidence: pm needs, per row, WHICH ref the
// row claims, HOW it was proven, and whether the row still carries a gate. Two methods are recorded
// side by side on purpose: `git rev-list refs/heads/main` membership (the audit's method) and
// `git merge-base --is-ancestor <full-sha> refs/heads/main` exit code (the ancestry method). They must
// agree; where they do not, the row is reported as DISAGREE rather than swept.
//
// Guardrails honoured:
//   * ancestry is not landing. A branch TIP that is an ancestor of main proves the commits are in
//     main's history; it does NOT prove a derived artifact named on that tip is merged. Rows naming a
//     branch tip without a sha are classified `branch-ref`, not `landed`.
//   * a row whose gate names another row is not correspondence. Rows with a structured `blockedBy`
//     are EXCLUDED from the closable set and reported separately, along with the state of their gate.
//   * rows that OTHER non-terminal rows gate on are reported too, because closing them changes a gate.
//
// Read-only: one broker-served `cli.mjs queue` read, and git queries. It claims/releases/cancels nothing.
//
// Usage: node tools/probes/landing-ancestry-evidence.mjs [--db ./selfdev.sqlite] [--out <file.json>]
//        [--seat qa] [--main refs/heads/main]
import { execFileSync, spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const DB = opt("db", "./selfdev.sqlite");
const OUT = opt("out", "tools/probes/landing-ancestry-evidence.json");
const MAIN = opt("main", "refs/heads/main");
const TERMINAL = new Set(["done", "cancelled"]);
const LANDING = /\bLANDING (LIST|ENTRY)\b/i;
// the audit's citation rule, stated so the count means something: 7-40 hex chars, must contain both a
// digit and a letter (so words like "deadbeef" and "abcdef" are not mistaken for shas).
const SHA = /\b[0-9a-f]{7,40}\b/g;
const HAS_DIGIT = /[0-9]/;
const HAS_LETTER = /[a-f]/;
// The audit's floor (`must carry a digit AND a letter`) is a HEURISTIC, and it has a blind spot: a
// real 7-char abbreviation made only of digits (e.g. @4357707 in #3673) is dropped, so the row looks
// like it cites nothing. Here every hex candidate is kept and resolution decides: a candidate counts
// only if `git cat-file -t` says it is an object. Both numbers are printed so the difference is
// visible rather than silently changing the count.

const t0 = Date.now();
const note = (m) => process.stderr.write(`[landing-ancestry ${Date.now() - t0}ms] ${m}\n`);

function decodeCliJson(text) {
	const at = text.indexOf("{");
	return JSON.parse(text.slice(at, text.lastIndexOf("}") + 1));
}

// ONE queue read.
const r = spawnSync(process.execPath, ["cli.mjs", "queue"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, DURIG_DB: DB } });
if (r.status !== 0) {
	console.error(`queue read failed: exit ${r.status}: ${r.stderr.slice(0, 300)}`);
	process.exit(1);
}
const items = decodeCliJson(r.stdout).items;
note(`${items.length} rows read`);

const mainTip = execFileSync("git", ["rev-parse", MAIN], { encoding: "utf8" }).trim();
const onMain = new Set(execFileSync("git", ["rev-list", MAIN], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).trim().split("\n"));
note(`main tip ${mainTip.slice(0, 7)}; ${onMain.size} commits reachable from it`);

const landing = items.filter((i) => !TERMINAL.has(i.status) && LANDING.test(i.subject ?? ""));
note(`${landing.length} non-terminal LANDING rows`);

// expand every citation in ONE batch-check, in input order
const cited = {};
const auditFloor = {};
for (const it of landing) {
	const hay = `${it.subject ?? ""} ${it.body ?? ""}`;
	const shas = [...new Set(hay.match(SHA) ?? [])];
	cited[it.id] = shas;
	auditFloor[it.id] = shas.filter((s) => HAS_DIGIT.test(s) && HAS_LETTER.test(s));
}
const allShas = [...new Set(Object.values(cited).flat())];
const batch = execFileSync("git", ["cat-file", "--batch-check"], { input: allShas.join("\n"), encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim().split("\n");
const full = new Map();
const resolves = new Map();
const objType = new Map();
allShas.forEach((s, k) => {
	const line = batch[k] ?? "";
	const ok = /commit|tree|blob/.test(line);
	resolves.set(s, ok);
	full.set(s, ok ? line.split(" ")[0] : null);
	objType.set(s, ok ? line.split(" ")[1] : null);
});
note(`${allShas.length} distinct citations, ${allShas.filter((s) => resolves.get(s)).length} resolve`);

// which rows are gated on others, and which rows are gates for others
const gatedBy = (it) => (it.blockedBy ?? []).map((g) => ({ id: g, status: items.find((x) => x.id === g)?.status ?? "MISSING" }));
const gateTargets = new Set();
for (const it of items) if (!TERMINAL.has(it.status)) for (const g of it.blockedBy ?? []) gateTargets.add(g);

// merge-base ancestry, one spawn per FULL sha (deduplicated, so ~the number of distinct citations)
const ancestorExit = new Map();
const commitSubject = new Map();
for (const s of allShas) {
	const f = full.get(s);
	if (!f) { ancestorExit.set(s, null); continue; }
	const m = spawnSync("git", ["merge-base", "--is-ancestor", f, MAIN], { encoding: "utf8" });
	ancestorExit.set(s, m.status);
	commitSubject.set(s, execFileSync("git", ["log", "-1", "--format=%s", f], { encoding: "utf8" }).trim());
}
note("ancestry measured");

// correspondence, not ancestry: does the cited commit say the thing the row claims it landed? Zero
// shared words (>=4 chars) between the row and every cited commit is a flag for a human read, not a
// verdict: a row "add the D105 rule" and a commit "docs: state the D105 rule" share tokens; a row
// citing an unrelated sha does not.
function sharedWords(it, commitCitations) {
	const rowWords = new Set(((it.subject ?? "") + " " + (it.body ?? "")).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4));
	return commitCitations.reduce((n, p) => n + (p.commitSubject ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && rowWords.has(w)).length, 0);
}

const rows = [];
for (const it of landing) {
	const shas = cited[it.id];
	const perSha = shas.map((s) => ({
		cited: s,
		full: full.get(s),
		resolves: resolves.get(s),
		inMainRevList: resolves.get(s) && onMain.has(full.get(s)),
		objectType: objType.get(s),
		commitSubject: objType.get(s) === "commit" ? commitSubject.get(s) : null,
		mergeBaseIsAncestorOfMain: ancestorExit.get(s),
		ambiguous: resolves.get(s) === false,
		citedIsAbbreviation: s.length === 7,
		countedByAuditFloor: HAS_DIGIT.test(s) && HAS_LETTER.test(s),
	}));
	// A token that does not resolve to an object is NOT a citation - it is a number that looks like
		// one (a date, a row count). Failing a row on it would be a false negative; silently ignoring it
		// would be a blind spot. Both are recorded, and the landing claim rests only on commits.
		const commitCitations = perSha.filter((p) => p.objectType === "commit");
		const nonCitationTokens = perSha.filter((p) => p.objectType !== "commit").map((p) => p.cited);
		const allOnMain = commitCitations.length > 0 && commitCitations.every((p) => p.inMainRevList);
	const agree = commitCitations.length > 0 && commitCitations.every((p) => p.inMainRevList === (p.mergeBaseIsAncestorOfMain === 0));
	const gates = gatedBy(it);
	rows.push({
		id: it.id,
		status: it.status,
		subject: (it.subject ?? "").slice(0, 110),
		from: it.from,
		to: it.to,
		claim: shas.length === 0 ? "no sha cited" : shas.length === 1 ? "single sha" : `${shas.length} shas`,
		branchRefs: [...new Set(((it.subject ?? "") + " " + (it.body ?? "")).match(/\b(item|branch)-[0-9]+\b/g) ?? [])],
		auditFloorOnly: perSha.filter((p) => !p.countedByAuditFloor).map((p) => p.cited),
		commitCitations: commitCitations.map((p) => p.cited),
		nonCitationTokens: nonCitationTokens,
		derivedArtifact: /(manifest|generated|regenerated|mirror|json|report|snapshot|index)/i.test(`${it.subject ?? ""} ${it.body ?? ""}`),
		allCitedAreCommits: perSha.every((p) => p.objectType === "commit"),
		shas: perSha,
		allOnMain,
		methodsAgree: agree,
		gate: gates,
		gatesOthers: gateTargets.has(it.id),
		// second leg, for rows that name a branch and no sha: does that ref's TIP sit in main's
		// history? Ancestor-of-main on a tip proves the commits are in main; it does NOT prove a
		// generated artifact named on that tip was merged. Recorded as a lead, never as a verdict.
		branchRefEvidence: (it.subject ?? "" + " " + (it.body ?? "")).length > 0
			? [...new Set(((it.subject ?? "") + " " + (it.body ?? "")).match(/\b(?:[a-z]+-)?item-[0-9]+\b/g) ?? [])]
				.map((ref) => {
					const tip = spawnSync("git", ["rev-parse", "--verify", ref], { encoding: "utf8" });
					if (tip.status !== 0) return { ref, exists: false };
					const m = spawnSync("git", ["merge-base", "--is-ancestor", tip.stdout.trim(), MAIN], { encoding: "utf8" });
					return { ref, exists: true, tip: tip.stdout.trim().slice(0, 12), tipIsAncestorOfMain: m.status };
				})
			: [],
		closable: allOnMain && agree && gates.length === 0 && !gateTargets.has(it.id),
		sharedWordsWithCommit: sharedWords(it, commitCitations),
	});
}

const closable = rows.filter((x) => x.closable);
const excludedSet = new Map();
for (const x of rows) {
	const reasons = [];
	if (x.allOnMain && x.gate.length > 0) reasons.push("own gate");
	if (x.allOnMain && x.gatesOthers) reasons.push("gates another row");
	if (x.allOnMain && !x.methodsAgree) reasons.push("methods disagree");
	if (!x.shas.length) reasons.push("no sha cited");

	if (reasons.length) excludedSet.set(x.id, { ...x, excludedFor: reasons });
}
const excluded = [...excludedSet.values()];
const deadGate = rows.filter((x) => x.gate.some((g) => g.status === "cancelled"));
const openGate = rows.filter((x) => x.gate.some((g) => g.status !== "done" && g.status !== "cancelled"));

const lean = (r) => ({
	id: r.id,
	status: r.status,
	to: r.to,
	subject: r.subject.slice(0, 90),
	citations: r.shas.filter((p) => p.objectType === "commit").map((p) => ({ cited: p.cited, mergeBaseExit: p.mergeBaseIsAncestorOfMain, inMainRevList: p.inMainRevList, commitSubject: (p.commitSubject ?? "").slice(0, 80) })),
	lookLikeShaButAreNot: r.nonCitationTokens,
	gate: r.gate,
	gatesOthers: r.gatesOthers,
	branchRefs: r.branchRefEvidence.filter((b) => b.exists),
		sharedWordsWithCommit: r.sharedWordsWithCommit,
});
const out = {
	measuredAt: new Date().toISOString(),
	mainTip,
	command: `node tools/probes/landing-ancestry-evidence.mjs --db ${DB}`,
	ancestryCommand: "git merge-base --is-ancestor <full-sha> refs/heads/main  (exit 0 = ancestor of main)",
	counts: {
		landingRows: landing.length,
		shaInMainRevList: rows.filter((x) => x.allOnMain).length,
		closableNoGate: closable.length,
		onMainButHasOwnGate: rows.filter((x) => x.allOnMain && x.gate.length > 0).length,
		onMainButGatesOthers: rows.filter((x) => x.allOnMain && x.gatesOthers).length,
		methodsDisagree: rows.filter((x) => x.allOnMain && !x.methodsAgree).length,
		noShaCited: rows.filter((x) => !x.shas.length).length,
		citedObjectNotCommit: rows.filter((x) => x.allOnMain && !x.allCitedAreCommits).length,
		rowsWithAmbiguousTokens: rows.filter((x) => x.nonCitationTokens.length).length,
		closableWithNoWordOverlap: closable.filter((x) => x.sharedWordsWithCommit === 0).length,
		rowsWithNonShaTokens: rows.filter((x) => x.nonCitationTokens.length).length,
		landingRowsWithDeadGate: deadGate.length,
		rowsRecoverableOnlyByResolvingAllHex: rows.filter((x) => x.auditFloorOnly.length > 0).length,
		auditFloorVariantClosable: rows.filter((x) => { const f = x.shas.filter((p) => p.countedByAuditFloor); return f.length > 0 && f.every((p) => p.inMainRevList); }).length,
	},
	rows: closable.map(lean),
	excluded: excluded.map((r) => ({ id: r.id, status: r.status, subject: r.subject.slice(0, 90), excludedFor: r.excludedFor, gate: r.gate, gatesOthers: r.gatesOthers, commitCitations: r.commitCitations, lookLikeShaButAreNot: r.nonCitationTokens })),
		deadGateRows: deadGate.map((x) => ({ id: x.id, status: x.status, gate: x.gate })),
		rowsWithUnclosedGate: openGate.length,
};
writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
note(`wrote ${OUT}`);

console.log(`LANDING ANCESTRY EVIDENCE (${out.measuredAt}) main tip ${mainTip.slice(0, 7)}`);
console.log(`  LANDING rows non-terminal: ${landing.length}`);
console.log(`  every cited sha in main's rev-list: ${rows.filter((x) => x.allOnMain).length}`);
console.log(`  of those, closable (no gate, not a gate for another row, both methods agree): ${closable.length}`);
console.log(`  excluded (${excluded.length} rows, no double counting): own gate ${out.counts.onMainButHasOwnGate} | gates another row ${out.counts.onMainButGatesOthers} | methods disagree ${out.counts.methodsDisagree} | no sha cited ${out.counts.noShaCited} | cited object not a commit ${out.counts.citedObjectNotCommit}`);
console.log("");
console.log("id  status  shas                                     ownGate  gatesOthers  methodsAgree");
for (const x of closable) {
	console.log(`${String(x.id).padEnd(5)} ${x.status.padEnd(8)} ${x.shas.map((s) => s.cited).join(",").padEnd(42)} ${String(x.gate.length).padEnd(7)} ${String(x.gatesOthers).padEnd(12)} ${x.methodsAgree}`);
}
const floorOnly = rows.filter((x) => { const f = x.shas.filter((p) => p.countedByAuditFloor); return f.length > 0 && f.every((p) => p.inMainRevList) && !x.allOnMain; });
const strictOnly = rows.filter((x) => x.allOnMain && x.shas.some((p) => !p.countedByAuditFloor));
console.log(`  rows the audit's floor counts as landed that the strict check REJECTS: ${floorOnly.length} -> ${floorOnly.map((x) => `#${x.id}`).join(" ")}`);
for (const x of floorOnly) console.log(`    #${x.id} ${x.status} rejected tokens: ${x.shas.filter((p) => !p.inMainRevList).map((p) => `${p.cited}(type=${p.objectType}, merge-base exit ${p.mergeBaseIsAncestorOfMain})`).join(", ")}`);
console.log(`  rows the strict check lands that the floor cannot see (all-digit shas): ${strictOnly.length} -> ${strictOnly.map((x) => `#${x.id}`).join(" ")}`);
const noOverlap = closable.filter((x) => x.sharedWordsWithCommit === 0);
console.log(`  closable rows whose cited commit shares NO word (>=4 chars) with the row - read the body before closing: ${noOverlap.length} -> ${noOverlap.map((x) => `#${x.id}`).join(" ")}`);
console.log("");
console.log("EXCLUDED (do not sweep into the rule):");
for (const x of excluded) {
	console.log(`  #${x.id} ${x.status} [${x.excludedFor.join(", ")}] gate=${x.gate.map((g) => `${g.id}:${g.status}`).join(",") || "-"} gatesOthers=${x.gatesOthers} | ${x.subject.slice(0, 60)}`);
}
console.log("");
console.log(`LANDING rows whose gate names a CANCELLED row (can never close): ${deadGate.length} -> ${deadGate.map((x) => `#${x.id}`).join(" ")}`);
process.exit(0);
