// demo/doc-integrity-env-name.test.mjs — #6335: env-name fidelity is a machine rule, not a memory.
//
// WHY THIS EXISTS. `DURIAN_PI_DB` is the store selector from before the #5911 rename. It is not just
// old: the CLI ignores it, so a command carrying it RUNS, opens ./rig.sqlite, and reports a normal
// result. Measured in this tree (worktree item-6335 off 35001c3a, 2026-11-11):
//   DURIG_DB=./probe-durig.sqlite node cli.mjs status      -> "db": ".../probe-durig.sqlite"
//   DURIAN_PI_DB=./probe-dead.sqlite node cli.mjs status   -> "db": ".../rig.sqlite"
// The #5911 sweep was a one-off text fix, so by the time this row was minted five live docs already
// carried the dead name again as an instruction: docs/QUICKSTART.md, docs/runbooks/attach-a-gate.md
// (twice) and docs/runbooks/verifier-leg-unfunded.md.
//
// FAILING-FIRST. Run this file on the tree BEFORE the rule: the guard exits 0 with "found 0 dead-name
// command(s)" even though the scratch fixture below contains a stale command — the assertion
// `red.status === 1` throws. Run it after the rule and before the doc fixes and it goes RED on the
// five real lines (exit 1, five "HARD ENV NAME" findings), which is the sweep the row asked for.
//
// The exception is the point of the second case, not an escape hatch: scripts/clockin.mjs really does
// resolve `process.env.DURIAN_PI_DB || process.env.DURIG_DB || "./selfdev.sqlite"`, so the same command
// shape aimed at clockin is correct. A rule that reds a correct line trains people to ignore the rule.
//
// Run: node demo/doc-integrity-env-name.test.mjs   (exit 0 = pass)

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const GUARD = join(ROOT, "tools", "doc-integrity-guard.mjs");

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
	}
}

/** A scratch tree that satisfies every OTHER guard rule, so a non-zero exit can only come from the env rule. */
function scratchTree(docBody) {
	const dir = mkdtempSync(join(tmpdir(), "envname-guard-")); // scratch in the temp dir, never in the item worktree
	mkdirSync(join(dir, "docs", "runbooks"), { recursive: true });
	writeFileSync(join(dir, "docs", "NEXT.md"), "## NEXT SESSION\nnothing cited here\n");
	writeFileSync(join(dir, "docs", "ROADMAP.md"), "**1. a stub item**\n");
	writeFileSync(join(dir, "docs", "runbooks", "README.md"), "# Runbooks\nno rows yet\n");
	writeFileSync(join(dir, "docs", "STATUS.md"), docBody);
	return dir;
}

function runGuard(dir) {
	return spawnSync("node", [GUARD], { cwd: dir, encoding: "utf8", timeout: 20000 });
}

console.log("doc-integrity-guard env-name rule (#6335)");

// 1. RED: a command-shaped line using the superseded store selector, aimed at an entry point that ignores it.
const stale = scratchTree("DURIAN_PI_DB=./selfdev.sqlite node cli.mjs status\n");
const red = runGuard(stale);
check("a stale store-selector command exits 1", red.status === 1, `exit ${red.status}: ${red.stdout.trim()}`);
check("the finding names the file and line", red.stdout.includes("HARD ENV NAME  docs/STATUS.md:1"), red.stdout);
check("the finding says which name is live", red.stdout.includes("The CLI resolves DURIG_DB only"), red.stdout);

// 2. GREEN on the exception: identical shape, the entry point that genuinely honours the name.
const clockin = scratchTree("DURIAN_PI_DB=./selfdev.sqlite node scripts/clockin.mjs --budget 5\n");
const green = runGuard(clockin);
check("the clockin line does NOT go red", green.status === 0, `exit ${green.status}: ${green.stdout.trim()}`);
check("the guard counts zero dead-name commands there", green.stdout.includes("found 0 dead-name command(s)"), green.stdout);

// 3. GREEN on the live name: the rule must not flag correct usage, or the sweep it protects is invisible.
const correct = scratchTree("DURIG_DB=./selfdev.sqlite node cli.mjs status\n");
const live = runGuard(correct);
check("the live name is never flagged", live.status === 0, `exit ${live.status}: ${live.stdout.trim()}`);

// 4. An outcome-reporting line is evidence about the dead name, not an instruction to use it. Without this
//    exemption the runbooks' own proof lines flag and the guard cries wolf.
const proof = scratchTree("`DURIAN_PI_DB=./nope-a.sqlite node cli.mjs status` → \"db\": \"./rig.sqlite\" (exit 1, cause no_store)\n");
const proofRun = runGuard(proof);
check("a line reporting what the dead name does is exempt", proofRun.status === 0, `exit ${proofRun.status}: ${proofRun.stdout.trim()}`);

// 5. The real tree: no live doc carries a stale command-shaped store selector.
const real = runGuard(ROOT);
check("no live doc in this tree carries the dead name in a command", !real.stdout.includes("HARD ENV NAME"), real.stdout);

// 6. The rule is not vacuous: the live instruction surfaces do use the live name, and the guard saw them.
const liveCommands = ["README.md", "AGENTS.md", "docs/QUICKSTART.md", "docs/STATUS.md", "docs/FEATURES.md", "docs/TUI-TESTING.md", "docs/DELEGATE-CLOCKIN.md", "docs/SELFDEV.md"].reduce((n, rel) => {
	const text = readFileSync(join(ROOT, rel), "utf8");
	return n + text.split(/\r?\n/).filter((l) => /\bDURIG_DB\s*=\s*[^\s|;)]+\s+(?:node|bash|sh|pwsh|powershell)\b/.test(l)).length;
}, 0);
check("the sweep the guard protects is present (>=15 live DURIG_DB commands)", liveCommands >= 15, `found ${liveCommands}`);

// 7. Self-lock: the exception is named in the tool, so the next editor cannot "simplify" it away.
const guardSrc = readFileSync(GUARD, "utf8");
check("the tool names the entry point that honours the dead name", /HONOURS_DEAD_NAME\s*=\s*\/clockin/i.test(guardSrc), guardSrc.slice(0, 0));
check("the tool states why docs/NEXT-ARCHIVE.md and docs/ROADMAP.md are out of scope", guardSrc.includes("docs/ROADMAP.md too"), "");

rmSync(stale, { recursive: true, force: true });
rmSync(clockin, { recursive: true, force: true });
rmSync(correct, { recursive: true, force: true });
rmSync(proof, { recursive: true, force: true });

console.log(`VERDICT: ${failures === 0 ? "PASS" : `${failures} FAILURES`}  →  exit ${failures === 0 ? 0 : 1}`);
process.exit(failures === 0 ? 0 : 1);
