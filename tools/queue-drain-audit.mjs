#!/usr/bin/env node
// tools/queue-drain-audit.mjs — the held-backlog drain audit, in ONE process.
//
// WHY THIS EXISTS (docs/reviews/held-drain-audit-2026-10-28.md, D142): the same audit run by hand cost
// ~4 minutes of wall clock and died twice on its own instruments — a 21 MB queue snapshot re-parsed
// five times, and ~250 per-sha `git merge-base` spawns. It also produced a WRONG number first, because
// the citation pattern was never stated (D142's rule: publish the regex with the count). This module
// fixes both: one queue read, ONE `cat-file --batch-check` for every citation, ONE `rev-list` for
// reachability, and the extractor floor printed next to every count it produced.
//
// IT IS AN INSTRUMENT, NOT A FIX. It reads the store and git and prints plain values. It claims,
// releases, cancels, routes or transitions nothing — those are `pm`'s ActiveRecord transitions
// (docs/runbooks/stale-held-backlog.md §Do). Its job is to make the routing fact cheap enough that it
// gets re-measured rather than remembered.
//
// Usage:
//   node tools/queue-drain-audit.mjs [--db ./selfdev.sqlite] [--snapshot <file>]
//        [--floor 7] [--other-store <path-to-.git>] [--json <out.json>]
//
// Read-only: `queue` is broker-served (D111); no second writing Harness is opened.

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const argv = process.argv.slice(2);
const opt = (name, dflt) => {
	const i = argv.indexOf(`--${name}`);
	return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : dflt;
};
const flags = new Set(argv.filter((a) => a.startsWith("--") && !argv[argv.indexOf(a) + 1]));
void flags;
const DB = opt("db", "./selfdev.sqlite");
const FLOOR = Math.max(4, Number(opt("floor", 7)) || 7);
const OTHER = opt("other-store", null);
const SNAPSHOT = opt("snapshot", null);
const OUT = opt("json", null);
const TERMINAL = new Set(["done", "cancelled"]);

const t0 = Date.now();
const ms = () => Date.now() - t0;
const note = (m) => process.stderr.write(`[queue-drain-audit ${ms()}ms] ${m}\n`);

// ---------------------------------------------------------------- queue read (exactly ONE read)
// `cli.mjs queue` appends a trailing `note: N measure(s)…` line, so a whole-file JSON.parse dies with
// "Extra data". raw_decode equivalent: parse from the first `{` and stop at the matching end.
function decodeCliJson(text) {
	const at = text.indexOf("{");
	if (at < 0) throw new Error("queue output has no JSON object");
	return JSON.parse(text.slice(at, text.lastIndexOf("}") + 1));
}

let items;
if (SNAPSHOT) {
	note(`reading snapshot ${SNAPSHOT}`);
	items = decodeCliJson(readFileSync(SNAPSHOT, "utf8")).items;
} else {
	note(`reading queue from ${DB} (one broker-served read)`);
	const r = spawnSync(process.execPath, ["cli.mjs", "queue"], {
		encoding: "utf8",
		maxBuffer: 64 * 1024 * 1024,
		env: { ...process.env, DURIG_DB: DB },
	});
	if (r.status !== 0) throw new Error(`cli.mjs queue failed: ${r.stderr?.slice(0, 400)}`);
	items = decodeCliJson(r.stdout).items;
}
note(`${items.length} rows`);

// -------------------------------------------------------------------- citation extraction
// The floor is the whole lesson: src/citation.mjs uses {8,40} and so NEVER sees a 7-char citation,
// which is git's default short-sha abbreviation and what this rig's `@02f1a36` landing convention
// writes (D142: floor 8 -> 4 non-terminal rows; floor 7 -> 39). Keep the digit-AND-letter guard the
// shipped extractor uses, or every date in the queue becomes a "citation".
const CITED = new RegExp(`\\b[0-9a-f]{${FLOOR},40}\\b`, "g");
function citations(text) {
	const out = [];
	for (const m of String(text ?? "").matchAll(CITED)) {
		const s = m[0];
		if (!/[0-9]/.test(s) || !/[a-f]/.test(s)) continue;
		if (!out.includes(s)) out.push(s);
	}
	return out;
}

const perRow = new Map(items.map((i) => [i.id, citations(`${i.subject ?? ""}\n${i.body ?? ""}`)]));
const allShas = [...new Set([...perRow.values()].flat())];
note(`${allShas.length} distinct citations at floor ${FLOOR}`);

// ------------------------------------------------- resolution: ONE batch-check, ONE rev-list, ONE -S pass
const batch = execFileSync("git", ["cat-file", "--batch-check"], {
	input: allShas.join("\n"),
	encoding: "utf8",
	maxBuffer: 32 * 1024 * 1024,
}).trim().split("\n");
// batch-check answers in INPUT ORDER and prints the FULL object name, so this one process also
// supplies the expansion every later set-membership test needs — no per-sha `rev-parse`.
const full = new Map();
const resolves = new Map();
allShas.forEach((s, k) => {
	const line = batch[k] ?? "";
	const ok = /commit|tree|blob/.test(line);
	resolves.set(s, ok);
	full.set(s, ok ? line.split(" ")[0] : null);
});
note("batch-check done");

// Reachability, PROVEN over every namespace. `git branch -a --contains` walks only refs/heads and
// refs/remotes, so it cannot see refs/recovered/* or refs/archived/* — the namespaces this rig uses for
// recovery. Membership in a rev-list over every ref tip answers the question actually asked.
const tips = execFileSync("git", ["for-each-ref", "--format=%(objectname)"], { encoding: "utf8" })
	.trim().split("\n").filter(Boolean);
const reachable = new Set(
	execFileSync("git", ["rev-list", ...tips], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
		.trim().split("\n"),
);
// `reachable from some ref` is NOT `landed`: a sha on an unmerged branch is reachable. Landing rows
// need main specifically, so ask main with its own rev-list rather than blending the two questions.
const onMain = new Set(
	execFileSync("git", ["rev-list", "refs/heads/main"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 })
		.trim().split("\n"),
);
note(`rev-list over ${tips.length} ref tips -> ${reachable.size} reachable; main -> ${onMain.size}`);

const status = new Map(items.map((i) => [i.id, i.status]));
const bad = (id) => perRow.get(id).filter((s) => !resolves.get(s));
const nonTerm = items.filter((i) => !TERMINAL.has(i.status));
const landed = (s) => resolves.get(s) && onMain.has(full.get(s));

// -------------------------------------------------------------------------- classification
const LANDING = /\bLANDING (LIST|ENTRY)\b/i;
const hist = {};
for (const i of items) hist[i.status] = (hist[i.status] ?? 0) + 1;

const landing = nonTerm.filter((i) => LANDING.test(i.subject ?? ""));
const landingDone = landing.filter((i) => {
	const shas = perRow.get(i.id);
	return shas.length > 0 && shas.every(landed);
});
const unresolvableRows = nonTerm.filter((i) => bad(i.id).length > 0);
const unresolvableShas = [...new Set(unresolvableRows.flatMap((i) => bad(i.id)))];

// gate prose (docs/WORK-ITEM-LIFECYCLE.md §7) — a LEAD, never proof
const GATE = /(GATED|release when|gated on|SEQUENCE AFTER|behind|prerequisite)/i;
const REF = /#(\d{1,4})/g;
const orphan = nonTerm.filter((i) => {
	const hay = `${i.subject ?? ""} ${i.body ?? ""}`;
	if (!GATE.test(hay)) return false;
	const cited = [...new Set((hay.match(REF) ?? []).map((x) => Number(x.slice(1))))].filter(
		(r) => status.has(r) && r !== i.id,
	);
	return cited.length > 0 && cited.every((r) => TERMINAL.has(status.get(r)));
});
const danglingRefs = nonTerm.filter((i) => {
	const hay = `${i.subject ?? ""} ${i.body ?? ""}`;
	if (!GATE.test(hay)) return false;
	return ![...new Set((hay.match(REF) ?? []).map((x) => Number(x.slice(1))))].some(
		(r) => status.has(r) && r !== i.id,
	);
});

// ----------------------------------------------- the other store (a moved workspace, read read-only)
let other = null;
if (OTHER) {
	const have = [];
	for (const s of unresolvableShas) {
		const r = spawnSync("git", ["--git-dir", OTHER, "cat-file", "-t", s], { encoding: "utf8" });
		if (r.status === 0) have.push({ sha: s, type: r.stdout.trim() });
	}
	const otherTips = execFileSync("git", ["--git-dir", OTHER, "for-each-ref", "--format=%(objectname)"], {
		encoding: "utf8",
	}).trim().split("\n").filter(Boolean);
	const otherReach = new Set(
		execFileSync("git", ["--git-dir", OTHER, "rev-list", ...otherTips], {
			encoding: "utf8", maxBuffer: 256 * 1024 * 1024,
		}).trim().split("\n"),
	);
	const reachFull = have.map((h) => ({
		...h,
		full: execFileSync("git", ["--git-dir", OTHER, "rev-parse", `${h.sha}^{commit}`], { encoding: "utf8" }).trim(),
	}));
	other = {
		store: OTHER,
		citedUnresolvableHere: unresolvableShas.length,
		presentThere: have.length,
		refReachableThere: reachFull.filter((h) => otherReach.has(h.full)).length,
		danglingThere: reachFull.filter((h) => !otherReach.has(h.full)).map((h) => h.sha),
		absentBoth: unresolvableShas.filter((s) => !have.some((h) => h.sha === s)),
	};
	note(`other store probed`);
}

// ---------------------------------------------------------------------------- report
const r = {
	method: {
		extractor: `\\b[0-9a-f]{${FLOOR},40}\\b + must carry a digit AND a letter`,
		floor: FLOOR,
		note: "src/citation.mjs ships {8,40}; it is blind to 7-char citations (D142). Compare floors before quoting a count.",
		queueReads: 1, batchChecks: 1, revLists: 2 + (OTHER ? 2 : 0),
	},
	at: new Date().toISOString(),
	rows: items.length,
	histogram: hist,
	heldLanding: landing.length,
	heldLandingAlreadyOnMain: landingDone.length,
	heldLandingIds: landingDone.map((i) => i.id),
	nonTerminalWithUnresolvableCitation: unresolvableRows.length,
	unresolvableShas: unresolvableShas.length,
	unresolvableShaList: unresolvableShas,
	orphanCandidates: orphan.length,
	gateProseWithNoResolvableId: danglingRefs.length,
	otherStore: other,
	ms: ms(),
};
if (OUT) writeFileSync(OUT, JSON.stringify(r, null, 1));

const pct = ((landingDone.length / Math.max(1, nonTerm.filter((i) => i.status === "held").length)) * 100).toFixed(0);
process.stdout.write(
	[
		`HELD-DRAIN AUDIT  (${r.at})  ${items.length} rows in ${r.ms} ms`,
		`  method: ${r.method.extractor}`,
		`  histogram: ${Object.entries(hist).map(([k, v]) => `${k} ${v}`).join(" · ")}`,
		`  held LANDING rows: ${landing.length} — ${landingDone.length} already fully on main (${pct}% of held = zero-build closable)`,
		`  non-terminal rows with an unresolvable citation: ${unresolvableRows.length} (${unresolvableShas.length} shas)`,
		`  orphan candidates (all cited gates terminal — a LEAD, read the body): ${orphan.length}`,
		`  gate prose citing no resolvable id (route to pm as \`manual\`): ${danglingRefs.length}`,
		other
			? `  other store ${OTHER}: ${other.presentThere}/${other.citedUnresolvableHere} present, ${other.refReachableThere} ref-reachable, ${other.danglingThere.length} dangling, ${other.absentBoth.length} absent from both`
			: `  other store: not probed (pass --other-store <path/.git> on a moved workspace)`,
		"",
		`next: pm owns every release/cancel; the delegate claims nothing.`,
	].join("\n") + "\n",
);
