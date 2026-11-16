// tools/registration-ledger-gap-test.mjs — the registration -> ROADMAP ledger pass is MEASURED, not guessed.
//
// WHY THIS FILE EXISTS. The queue carries 171 live `registration` rows (2026-11-15 census) and the goal says a
// registration row should end up in the `docs/ROADMAP.md` ledger — but nobody had measured how much ledger work
// that is. Two shapes make a hand answer wrong, and both are pinned here. (1) the classification: `cli.mjs queue
// --json --no-body` prints rows WITHOUT the `registration` flag (its keys are id/from/to/subject/optimizedVia/
// status/transitions/resultSummary), so a hand pattern-match sees 180 of the 1,200 live rows while the ONE
// predicate over the flag-bearing read says 171 — a 9-row drift that reads as truth. (2) a notice's subject
// contains registration words (`CANCELLED #1088: ROADMAP 92 (BACKLOG — hold, do not start)`), so a pattern-only
// census double-counts the same row in two buckets (src/queueclass.mjs:25-27 measures 19 such rows).
//
// FAILING-FIRST (docs/failing-first-recipe.md METHOD 1, order of operations, no git revert): this file was
// written BEFORE the tool existed, and every spawn below then exits with "Cannot find module". Recorded red and
// green numbers are in the header of tools/registration-ledger-gap.mjs and in the commit that shipped it.
//
// Store-free by construction: every case drives the tool with `--fixture=<rows.json> --ledger=<fake ledger>`,
// so the test costs milliseconds and never reads ./selfdev.sqlite (the same mocked plane as the tranche's other
// red-first demos — a store read in a demo is a different lane with a declared cost).
//
// RED FIRST, leg 2 (2026-11-16 — SELFDEV pitfall 428's last hand reader): this tool took ONLY the `=` form for
// its paths and REFUSED the space form at a bespoke exit 4 no other tool speaks, and routed a bare `--json` to
// stdout while saying it had. Stage the PRE-change tools/ and drive THIS test at it —
//   mkdir -p .spike/pc-red5 && git archive HEAD tools scripts src cli.mjs | tar -x -C .spike/pc-red5
//   node tools/registration-ledger-gap-test.mjs --tool "$(pwd)/.spike/pc-red5/tools/registration-ledger-gap.mjs"
//   -> **exit 1, 18 ok / 7 FAIL in 0.35 s** (`.spike/pc-red-led2.out`, host Linux / Fedora Linux 45 (Forty Five) /
//      kernel 7.2.15-300.fc45.x86_64 / node v24.22.1, read in the SAME command): case 6 witnesses the space form
//      exiting **4** and printing NOTHING, a bare `--json` printing the report on stdout at exit 1, `--zzz=1` printing
//      a green-shaped verdict, and `--quiet=1` inventing a truthiness. GREEN at this tree: **25 ok / 0 FAIL / exit 0
//      in 0.4 s**. The stage must carry `src/` as well as `tools/` — this tool imports `../src/queueclass.mjs` by a
//      path RELATIVE TO ITSELF, so a tools/-only stage fails `Cannot find module`, which is the red evidence, not a bug.
//      Two traps this file's own legs had to be corrected for, both of the same class: its `check(condition, label,
//      detail)` takes the condition FIRST (the OPPOSITE order from tools/pointer-sha-coverage-test.mjs), and Node 24's
//      spawnSync result names the exit `status` (`exitCode` is undefined there — `Object.keys` measured `status,
//      signal,output,pid,stdout,stderr`), so a leg reading only `exitCode` compares `undefined === 2` and passes
//      forever. `code(r)` below is the one accessor every leg uses.
//
// Run: node tools/registration-ledger-gap-test.mjs  (exit 0 = pass)
//      node tools/registration-ledger-gap-test.mjs --tool <path>  (drives a STAGE of the tool — the red-first leg)

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const targv = process.argv.slice(2);
// The `--tool` seam: a pre-change STAGE of tools/ (unpacked into .spike/) is drivable against the same fixtures,
// so the legs below fail on the defect instead of being asserted. The stage must carry src/ too — this tool imports
// ../src/queueclass.mjs by a path RELATIVE TO ITSELF, and `git archive HEAD tools scripts src cli.mjs` provides it.
const TOOL = (() => {
	const given = targv.includes("--tool") ? targv[targv.indexOf("--tool") + 1] : "tools/registration-ledger-gap.mjs";
	return given.startsWith("/") || /^[A-Za-z]:[\\\/]/.test(given) ? given : join(process.cwd(), given);
})();

const dir = mkdtempSync(`${tmpdir()}/reggap-`);
let ok = 0;
const fails = [];

function fixture(name, items) {
	const p = `${dir}/${name}.json`;
	writeFileSync(p, JSON.stringify({ items }));
	return p;
}
function ledger(name, text) {
	const p = `${dir}/${name}.md`;
	writeFileSync(p, text);
	return p;
}

function run(rows, led) {
	return runWith(rows, led, [`--fixture=${rows}`, `--ledger=${led}`, "--json", `${dir}/out.json`], `${dir}/out.json`);
}
function runWith(rows, led, args, outPath) {
	const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8" });
	let parsed = null;
	try { parsed = JSON.parse(spawnRead(outPath)); } catch { /* the FAIL lines name it */ }
	return { code: r?.exitCode ?? r?.status, out: r?.stdout ?? "", err: r?.stderr ?? "", json: parsed };
}
function spawnRead(p) {
	try { return readFileSync(p, "utf8"); } catch { return ""; }
}

function code(r) {
	// Node 24's spawnSync result names the exit `status` (`exitCode` is undefined there — measured at this window's
	// run: Object.keys(spawnSync(...)) = status,signal,output,pid,stdout,stderr), so a leg that reads only `exitCode`
	// compares undefined to 2 and passes NOTHING. One accessor for every leg in this file.
	return r?.exitCode ?? r?.status;
}
function check(cond, why, detail = "") {
	if (cond) ok++;
	else fails.push(`${why}${detail ? ` — ${String(detail).slice(0, 400)}` : ""}`);
}

// --- case 1: a clean ledger. Two live registration rows name items the ledger already carries.
{
	const rows = fixture("clean", [
		{ id: 10, status: "held", registration: true, subject: "ROADMAP 90 NORMALIZE (TRIGGER-GATED — DO NOT START): style pass" },
		{ id: 11, status: "queued", registration: true, subject: "REGISTER ROADMAP row 368 (docs-only): a vocabulary row" },
		{ id: 12, status: "done", registration: true, subject: "ROADMAP 999 CLOSED: a terminal registration, never live" },
		{ id: 13, status: "queued", subject: "implement the thing" },
		{ id: 14, status: "queued", notice: true, subject: "CANCELLED #1088: ROADMAP 92 (BACKLOG — hold, do not start) by pm" },
		{ id: 15, status: "held", subject: "BACKLOG — hold, do not start: parked operator intent naming nothing" },
	]);
	const led = ledger("clean", "**90. normalize style\n**368. vocabulary row\n");
	const r = run(rows, led);
	check(r.code === 0, `clean ledger exits 0; got ${r.code}`);
	check(r.json?.counts?.registration === 3, `registration count 3 (rows 10/11 flagged, row 15 by the pattern fallback); got ${JSON.stringify(r.json?.counts)}`);
	check(r.json?.counts?.notice === 1, `the CANCELLED row is a NOTICE, not a second registration; got ${JSON.stringify(r.json?.counts)}`);
	check((r.json?.missingFromLedger ?? []).length === 0, "no item is missing from the ledger");
	check((r.json?.counts?.terminalRegistration ?? 0) === 1, "the terminal registration is excluded from live counts");
}

// --- case 2: a real gap. A live registration names an item the ledger does not carry.
{
	const rows = fixture("gap", [
		{ id: 20, status: "queued", registration: true, subject: "REGISTER ROADMAP 777 (docs-only): the pass must write it" },
		{ id: 21, status: "held", registration: true, subject: "ROADMAP 90 already in the ledger" },
		{ id: 22, status: "done", registration: true, subject: "ROADMAP 778 terminal so not the pass's job" },
		{ id: 23, status: "queued", registration: true, subject: "ROADMAP 779 also missing" },
	]);
	const led = ledger("gap2", "**90. style\n");
	const r = run(rows, led);
	check(r.code === 1, `a ledger gap exits 1; got ${r.code}`);
	const miss = (r.json?.missingFromLedger ?? []).map((x) => x.item).sort();
	check(JSON.stringify(miss) === JSON.stringify([777, 779]), `the gap names 777 and 779 and not 778; got ${JSON.stringify(miss)}`);
	check((r.json?.duplicates ?? []).length === 0, "one name per item is not a duplicate");
}

// --- case 3: duplicates the pass would write twice (a ledger copy collapsing).
{
	const rows = fixture("dup", [
		{ id: 30, status: "held", registration: true, subject: "ROADMAP 90 first copy" },
		{ id: 31, status: "deferred", registration: true, subject: "ROADMAP 90 second copy" },
		{ id: 32, status: "queued", registration: true, subject: "ROADMAP 90 third copy" },
		{ id: 33, status: "queued", registration: true, subject: "ROADMAP 126 x" },
		{ id: 34, status: "queued", registration: true, subject: "ROADMAP 126 y" },
	]);
	const led = ledger("dup", "**90. style\n**126. other\n");
	const r = run(rows, led);
	const dup = (r.json?.duplicates ?? []).map((x) => `${x.item}x${x.count}`).join(" ");
	check(r.code === 0, "duplicates alone are not a ledger gap (exit 0) but they ARE reported");
	check(dup === "90x3 126x2", `duplicates reported as 90x3 and 126x2; got ${JSON.stringify(dup)}`);
}

// --- case 4: the cheap-read trap. Rows printed WITHOUT the `registration` flag must be classified by the
// ONE predicate's pattern fallback, and the fallback must be LOUD, never silent.
{
	const rows = fixture("flagless", [
		{ id: 40, status: "held", subject: "ROADMAP 90 NORMALIZE (TRIGGER-GATED — DO NOT START): no flag in this read" },
		{ id: 41, status: "queued", notice: true, subject: "CANCELLED #9: ROADMAP 90 (BACKLOG — hold, do not start)" },
		{ id: 42, status: "held", subject: "implement the thing: no marker here at all" },
		{ id: 43, status: "queued", subject: "REGISTERED (backlog — hold, do not start): naming no item at all" },
	]);
	const led = ledger("flagless", "**90. style\n");
	const r = run(rows, led);
	check(r.code === 0, "a flagless fixture still decides");
	check(r.json?.counts?.registration === 2, "pattern fallback counts 2 registrations (90 + the itemless REGISTERED)");
	check(r.json?.counts?.notice === 1, "the flag-bearing notice is NOT double-counted even without a registration flag");
	check(/flagless/.test(r.out), "the read that lacks the flag says so (flagless count printed, never silent)");
}

// --- case 5: the tool states its own cost, its host-free denominator, and the row ids behind every number.
{
	const rows = fixture("ids", [{ id: 50, status: "queued", registration: true, subject: "REGISTER ROADMAP 800 missing" }]);
	const led = ledger("ids", "**1. nothing relevant\n");
	const r = run(rows, led);
	check(r.code === 1, "a gap in a one-row fixture still exits 1");
	check((r.json?.missingFromLedger ?? []).every((x) => typeof x.rowId === "number"), "the gap names the ROW id, so pm can act on it");
	check(/DENOMINATOR/i.test(r.out), "the names-not-foreign-keys caveat prints");
}

// --- case 6: ONE option reader (tools/argv-contract.mjs). SELFDEV pitfall 426's class again, on the tool that
// refused its own alternative spelling at a bespoke exit 4: a session that types `--fixture <path>` got a verdict
// of 4 that no other instrument speaks, and a caller that asked for `--json` with no path got a document glued
// onto a report it was not asked for. The migration imports the shared reader, so both spellings are ONE option
// and every bad call refuses BY NAME at exit 2.
{
	const rows = fixture("forms", [
		{ id: 60, status: "queued", registration: true, subject: "REGISTER ROADMAP 812 missing from the ledger" },
	]);
	const led = ledger("forms", "**1. nothing relevant\n");
	const eqPath = `${dir}/out-eq.json`;
	const rEq = runWith(rows, led, [`--fixture=${rows}`, `--ledger=${led}`, "--json", eqPath], eqPath);
	check(rEq.code === 1, "the `=` form still decides on a gap (exit 1)", `code=${rEq.code} err=${rEq.err.slice(0, 160)}`);
	const spPath = `${dir}/out-sp.json`;
	const rSp = runWith(rows, led, ["--fixture", rows, "--ledger", led, "--json", spPath], spPath);
	check(
		rSp.code === rEq.code,
		"the SPACE form is ONE option with the `=` form (same exit)",
		`space=${rSp.code} eq=${rEq.code} err=${rSp.err.slice(0, 160)}`,
	);
	check(
		JSON.stringify(rSp.json) === JSON.stringify(rEq.json) && rSp.json?.counts?.registration === 1,
		"and prints the same report",
		`${JSON.stringify(rSp.json)} vs ${JSON.stringify(rEq.json)}`,
	);
	const bare = spawnSync(process.execPath, [TOOL, `--fixture=${rows}`, `--ledger=${led}`, "--json"], { encoding: "utf8" });
	check(
		code(bare) === 2,
		"a bare `--json` REFUSES by name (exit 2) instead of routing stdout",
		`exit=${code(bare)} stdout=${String(bare.stdout).slice(0, 120)} stderr=${String(bare.stderr).slice(0, 200)}`,
	);
	check(
		String(bare.stderr).includes("REFUSED cause:"),
		"the refusal names its cause",
		String(bare.stderr).slice(0, 200),
	);
	const unknown = spawnSync(process.execPath, [TOOL, "--zzz=1", `--fixture=${rows}`, `--ledger=${led}`, "--json", eqPath], { encoding: "utf8" });
	check(
		code(unknown) === 2,
		"an option this tool does not take REFUSES (exit 2), not a green verdict",
		`exit=${code(unknown)}`,
	);
	check(
		String(unknown.stderr).includes("unknown option --zzz"),
		"and it names the option by name",
		String(unknown.stderr).slice(0, 200),
	);
	check(
		code(spawnSync(process.execPath, [TOOL, "--quiet=1", `--fixture=${rows}`, `--ledger=${led}`], { encoding: "utf8" })) === 2,
		"--quiet is a FLAG: giving it a value REFUSES",
		"a tool that invents a truthiness for a flag has no measured verdict",
	);
}

rmSync(dir, { recursive: true, force: true });

console.log(`${ok} ok, ${fails.length} FAIL`);
for (const f of fails) console.log(`  FAIL ${f}`);
if (fails.length === 0) console.log("REGISTRATION LEDGER GAP TEST PASS");
process.exit(fails.length === 0 ? 0 : 1);
