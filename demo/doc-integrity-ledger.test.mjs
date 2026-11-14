// demo/doc-integrity-ledger.test.mjs — #6344: docs/DECISIONS.md is citable only if a D-number names ONE entry.
//
// FAILING-FIRST. Before this row the guard judged nothing about the ledger. On this tree (HEAD `35001c3a`):
//   git show HEAD:tools/doc-integrity-guard.mjs | node -   ->  "VERDICT: 0 hard, 0 soft  ->  exit 0"
// while the same file had `## D91` heading THREE entries, D111-D120 and D258/D259 heading TWO each, six headings
// with no number at all (`## D###`, `## D-<mint>`) and 118 sentences of 80+ characters byte-identical in two
// different entries. Delete check 5 from tools/doc-integrity-guard.mjs and assertion 1 below throws.
//
// Three detections, one tool, per the row: (1) a D-number used by more than one entry -> HARD, naming every line;
// (2) an unnumbered heading -> HARD, because an uncitable entry in the ledger is not a style problem;
// (3) byte-identical body text in two entries -> SOFT, because a legitimate cross-reference repeats text and only
// the ledger owner can tell a duplicate ruling from a pointer to one. "Same text, SAME entry" is deliberately not
// a finding (case 4) — that is the distinction the row asked for.
//
// Run: node demo/doc-integrity-ledger.test.mjs   (exit 0 = pass)

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const GUARD = join(ROOT, "tools", "doc-integrity-guard.mjs");
const LONG = "The cap is enforced at the provider seam because that is the only place the cost is known."; // 80 chars

let failures = 0;
const scratchDirs = [];
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

/** A tree that satisfies every OTHER guard rule, so a non-zero exit can only come from the ledger rule. */
function scratch(ledgerLines) {
	const dir = mkdtempSync(join(tmpdir(), "ledger-guard-"));
	mkdirSync(join(dir, "docs", "runbooks"), { recursive: true });
	writeFileSync(join(dir, "docs", "NEXT.md"), "## NEXT SESSION\nnothing cited here\n");
	writeFileSync(join(dir, "docs", "ROADMAP.md"), "**1. a stub item**\n");
	writeFileSync(join(dir, "docs", "runbooks", "README.md"), "# Runbooks\nno rows yet\n");
	writeFileSync(join(dir, "docs", "DECISIONS.md"), ledgerLines.join("\n") + "\n");
	scratchDirs.push(dir);
	return dir;
}

function run(dir) {
	return spawnSync("node", [GUARD, "--soft"], { cwd: dir, encoding: "utf8", timeout: 20000 });
}

// Line numbers are derived here, never hardcoded, so the assertions test the tool and not my typing.
const lineOf = (lines, pattern) => lines.findIndex((l) => pattern.test(l)) + 1;

console.log("doc-integrity-guard ledger rule (#6344)");

// 1. RED: one number on three entries, a heading with no number, a body duplicated across two entries.
const bad = [
	"# DECISIONS",
	"",
	"## D91 — the first ruling",
	`${LONG}`,
	"",
	"## D91 — a different ruling that happens to share the number",
	`${LONG} A different ending, so the bodies are not identical overall.`,
	"",
	"## D### — a draft that never got minted",
	"Nothing citable here.",
	"",
	"## D92 — a third entry",
	"Some other text entirely, long enough to count as body text for the record.",
];
const d91Lines = bad.map((l, i) => (/^## D91/.test(l) ? i + 1 : 0)).filter(Boolean);
const placeholderLine = lineOf(bad, /^## D###/);
const badRun = run(scratch(bad));
check("a collided D-number exits 1", badRun.status === 1, `exit ${badRun.status}: ${badRun.stdout.trim()}`);
check(
	"the collision names every line that shares the number",
	badRun.stdout.includes(`numbers D91 at lines ${d91Lines.join(", ")}`),
	badRun.stdout,
);
check(
	"the unnumbered heading is a hard finding with its line number",
	badRun.stdout.includes(`HARD LEDGER  docs/DECISIONS.md:${placeholderLine}`) && badRun.stdout.includes("carries no D-number (###)"),
	badRun.stdout,
);
check("the duplicated body is reported as SOFT, not hard", badRun.stdout.includes("SOFT LEDGER") && badRun.stdout.includes(`entries at ${d91Lines[0]} and ${d91Lines[1]}`), badRun.stdout);
check("the header line counts what it found", badRun.stdout.includes("4 headings, 1 D-number collision(s), 1 unnumbered heading(s), 1 duplicate-body pair(s)"), badRun.stdout);

// 2. GREEN: distinct numbers, every heading numbered, nothing repeated between entries.
const good = [
	"# DECISIONS",
	"",
	"## D91 — the first ruling",
	"Body text about the store, phrased once.",
	"",
	"## D92 — the second ruling",
	"Body text about the broker, phrased once.",
	"",
	"## D-93 — numbered by the item that minted it",
	"Body text about worktrees, phrased once.",
];
const goodRun = run(scratch(good));
check("a clean ledger stays green", goodRun.status === 0, `exit ${goodRun.status}: ${goodRun.stdout.trim()}`);
check("the D-<number> form counts as a number, not a placeholder", goodRun.stdout.includes("3 headings, 0 D-number collision(s), 0 unnumbered heading(s), 0 duplicate-body pair(s)"), goodRun.stdout);

// 3. Same text, SAME entry: repetition inside one entry is not a duplicated ruling.
const within = ["# DECISIONS", "", "## D91 — one ruling that repeats itself", LONG, LONG];
const withinRun = run(scratch(within));
check("repetition inside a single entry is not a finding", withinRun.status === 0 && withinRun.stdout.includes("0 duplicate-body pair(s)"), `exit ${withinRun.status}: ${withinRun.stdout.trim()}`);

// 4b. A re-minted number is a DIFFERENT number. The #6352 cleanup disambiguates a collision by suffixing the
//     later entry (D265b), so the ledger keeps every ruling and still cites cleanly. A scan that truncates at
//     the digits would report D265 and D265b as one entry — the guard must not.
const suffixed = [
	"# DECISIONS",
	"",
	"## D265 — the earlier ruling",
	"Body text about the security seat, phrased once.",
	"",
	"## D265b — the later mint that collided and was disambiguated",
	"Body text about work-item lifecycles, phrased once.",
	"",
	"## D265 — the same number used a second time, with no suffix",
	"Another body text, also phrased once.",
];
const suffixRun = run(scratch(suffixed));
check(
	"D265 and D265b are two entries, not one collision",
	!suffixRun.stdout.includes("numbers D265b") && suffixRun.stdout.includes("1 D-number collision(s)"),
	suffixRun.stdout,
);
check(
	"the collision it does report is the un-suffixed repeat, with both lines named",
	suffixRun.stdout.includes("numbers D265 at lines 3, 9"),
	suffixRun.stdout,
);

// 5. Below the length threshold: boilerplate repeats by design and must not be reported.
const boiler = [
	"# DECISIONS",
	"",
	"## D91 — first",
	"Verify (ran; exit codes named). Nothing else.",
	"",
	"## D92 — second",
	"Verify (ran; exit codes named). Something else entirely.",
];
const boilerRun = run(scratch(boiler));
check("short repeated boilerplate is not a duplicate ruling", boilerRun.status === 0 && boilerRun.stdout.includes("0 duplicate-body pair(s)"), `exit ${boilerRun.status}: ${boilerRun.stdout.trim()}`);

// 6. The real ledger: the tool's report must agree with a boundary-aware scan of the same file, and its exit
//    code must follow the file's actual state. The assertion is deliberately derived, not pinned: an earlier
//    version of this file asserted "exit 1 on this tree until #6352 lands", which went RED the moment the
//    ledger was cleaned — a test that hardcodes a tree state is the same defect this runbook warns about.
const realRun = run(ROOT);
const realLines = readFileSync(join(ROOT, "docs", "DECISIONS.md"), "utf8").split(/\r?\n/);
const headings = realLines.map((l, i) => [l.match(/^##\s*D-?([0-9]+[a-z]?|###|<mint>)/), i + 1]).filter(([m]) => m);
const nums = headings.filter(([m]) => /^[0-9]+[a-z]?$/.test(m[1])).map(([m]) => m[1]);
const collided = [...new Set(nums.filter((n) => nums.filter((x) => x === n).length > 1))];
const placeholders = headings.filter(([m]) => !/^[0-9]+[a-z]?$/.test(m[1])).length;
check(
	"every collision a boundary-aware scan finds is reported by the tool",
	collided.every((n) => realRun.stdout.includes(`numbers D${n} at lines`)),
	`scan found: ${collided.join(", ")}; tool said: ${realRun.stdout.split("\n").filter((l) => l.startsWith("HARD LEDGER")).length} ledger findings`,
);
check(
	"the tool's placeholder count equals the scan's",
	placeholders === Number((realRun.stdout.match(/(\d+) unnumbered heading\(s\)/) || [0, 0])[1]),
	`scan: ${placeholders}`,
);
check(
	"the guard is red exactly when the real ledger has collisions or unnumbered headings",
	realRun.status === (collided.length + placeholders > 0 ? 1 : 0),
	`exit ${realRun.status} with ${collided.length} collision(s), ${placeholders} placeholder(s)`,
);

for (const d of scratchDirs) rmSync(d, { recursive: true, force: true });

console.log(`VERDICT: ${failures === 0 ? "PASS" : `${failures} FAILURES`}  →  exit ${failures === 0 ? 0 : 1}`);
process.exit(failures === 0 ? 0 : 1);
