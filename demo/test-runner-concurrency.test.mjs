// The suite runner must actually RUN CONCURRENTLY, and a hung test must not hang the suite.
//
// WHY THIS EXISTS (2026-10-27, operator request: "the tests take too long... they are running multiple times
// per session"). `scripts/test.mjs` already supported `--jobs <n>`, and it measured a 6.7x difference on this
// box - 237 tests in 276.8s serially vs 41.0s at 8 and 25.8s at 16 - but the DEFAULT was 1, and NOTHING in the
// suite asserted that anyone was getting the faster path. A capability nobody passes is not a capability. So
// this test pins the default itself, not just the flag: a future edit that flips `jobs` back to 1 (or a
// refactor that quietly ignores the value) fails here instead of costing every session four and a half minutes.
//
// The second half matters just as much for a concurrent suite: `runOne` had NO TIMEOUT. Serially, a hung test
// costs one slot and you notice; with 8 slots a hung test silently steals one-eighth of your capacity, and a
// suite that never returns is worse than a suite that fails. So a timeout must BOUND the run and report FAIL
// with the reason, never a clean pass.
//
// It runs against a TEMP root with fixture test files, never the real suite: fast, and it cannot disturb the
// gate it is checking.
// Run: node demo/test-runner-concurrency.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..");

const root = mkdtempSync(join(tmpdir(), "durig-runner-"));
mkdirSync(join(root, "demo"), { recursive: true });
mkdirSync(join(root, "scripts"), { recursive: true });
mkdirSync(join(root, "src"), { recursive: true });
try {
	// The runner anchors discovery to its OWN location (ROOT is derived from import.meta.url), which is the
	// right behaviour for a gate — it must not depend on the caller's cwd. To exercise it against fixtures
	// without polluting the real suite, give the fixtures their own copy of the runner and the one module it
	// imports. Two files, both copied verbatim, so what is under test is the real code path.
	copyFileSync(join(ROOT, "scripts", "test.mjs"), join(root, "scripts", "test.mjs"));
	copyFileSync(join(ROOT, "src", "testareas.mjs"), join(root, "src", "testareas.mjs"));
	const localRunner = join(root, "scripts", "test.mjs");
	// FIXTURES: three tests that sleep ~1.5s each. Serial they cost >= 4.5s of sleep; concurrent they cost
	// ~1.5s. The wall clock is the assertion - not a count of workers, which would pass even if the workers
	// were arranged wrong.
	const sleepFile = (name, ms) =>
		`import { setTimeout as sleep } from "node:timers/promises";\nawait sleep(${ms});\nconsole.log("${name} PASS");\n`;
	for (const n of ["a", "b", "c"]) writeFileSync(join(root, "demo", `slow-${n}.test.mjs`), sleepFile(`slow-${n}`, 1500));
	// A test that HANGS: it must be bounded, and it must be reported as a failure.
	writeFileSync(join(root, "demo", "hang.test.mjs"), "await new Promise(() => {});\n");
	// A test that FAILS, so concurrency is proven not to swallow failures.
	writeFileSync(join(root, "demo", "bad.test.mjs"), 'throw new Error("seeded failure");\n');
	// The manifest must name every fixture, because the runner's own coverage rule reads it. TWO AREAS on
	// purpose: the timing assertions need a set that is expected to PASS, while the timeout and failure
	// assertions need the seeded bad ones. Mixing them means every "this run should be clean" assertion is
	// false for a reason that has nothing to do with what is under test (that mistake was caught by this test
	// failing on its own fixture, which is the point of writing fixtures at all).
	writeFileSync(
		join(root, "demo", "test-areas.json"),
		`${JSON.stringify(
			{
				areas: {
					green: ["demo/slow-a.test.mjs", "demo/slow-b.test.mjs", "demo/slow-c.test.mjs"],
					mixed: ["demo/hang.test.mjs", "demo/bad.test.mjs"],
				},
			},
			null,
			1,
		)}\n`,
	);

	const run = (area, args) => spawnSync(process.execPath, [localRunner, "--area", area, ...args], { cwd: root, encoding: "utf8", timeout: 120_000 });

	// 1. THE DEFAULT IS CONCURRENT. Measured on the real suite: 276.8s serial vs 41.0s at 8 jobs. Three
	//    1.5s fixtures must therefore land in well under their serial sum of 4.5s.
	// Time it ourselves: `spawnSync` reports no wall clock, and the wall clock IS the assertion here.
	const timed = (area, args) => {
		const t0 = Date.now();
		const r = run(area, args);
		return { ...r, wallMs: Date.now() - t0 };
	};
	const concurrent = timed("green", []);
	assert.equal(concurrent.status, 0, `the default run over passing fixtures failed: ${concurrent.stderr?.slice(0, 300)}`);
	assert.ok(
		concurrent.wallMs < 4000,
		`three 1.5s tests with no --jobs flag took ${concurrent.wallMs}ms; the serial sum is 4500ms, so the default is NOT running concurrently (stdout: ${concurrent.stdout?.slice(0, 200)})`,
	);

	// 2. Serial still works and is still SLOWER - the flag is honoured in both directions, and the gap is the
	//    proof that the concurrency is real rather than a miscount.
	const serial = timed("green", ["--jobs", "1"]);
	assert.equal(serial.status, 0, `--jobs 1 run failed: ${serial.stderr?.slice(0, 300)}`);
	assert.ok(
		serial.wallMs >= 4500,
		`--jobs 1 took ${serial.wallMs}ms for three 1.5s tests; serial execution must cost at least their sum`,
	);
	assert.ok(concurrent.wallMs < serial.wallMs, "the default must beat --jobs 1 on wall clock, or it is not concurrency");

	// 3. A HUNG TEST IS BOUNDED AND REPORTED, not awaited forever. Before this change `runOne` had no
	//    timeout at all, so one hung test kept the whole suite open.
	const bounded = timed("mixed", ["--jobs", "4", "--timeout", "2000"]);
	assert.notEqual(bounded.status, 0, "a hung test must fail the run, not complete it");
	assert.match(bounded.stdout ?? "", /hang\.test\.mjs/, "the hung file must be named in the report");
	assert.match(`${bounded.stdout ?? ""}${bounded.stderr ?? ""}`, /timed out|timeout/i, "and the reason must say WHY it failed");
	assert.ok(bounded.wallMs < 20_000, `a 2s timeout left the run at ${bounded.wallMs}ms; the bound is not being enforced`);

	// 4. Concurrency must not SWALLOW a genuine failure: the seeded failure has to surface with its message.
	const failing = run("mixed", ["--jobs", "4", "--timeout", "2000"]);
	assert.notEqual(failing.status, 0, "a failing test must still fail the run under concurrency");
	assert.match(`${failing.stdout ?? ""}${failing.stderr ?? ""}`, /seeded failure/, "and its output must still reach the operator");

	// 5. The runner must SAY what it is doing, so a slow suite is diagnosable rather than mysterious: the
	//    job count appears in the header it already prints.
	assert.match(concurrent.stdout ?? "", /jobs=\d+/, "the header must name the concurrency actually used");

	// 6. The default must be BOUNDED, not `os.cpus()`. On this 16-core box the full suite took 25.8s at 16
	//    jobs, but the same box is also hosting two served models and up to two live seats, and every demo
	//    spawns real broker/subprocess trees. An unbounded default turns the test suite into a load generator
	//    against the rig it is testing, which is exactly how a timing-sensitive suite starts flaking.
	const help = spawnSync(process.execPath, [localRunner, "--help"], { cwd: root, encoding: "utf8" });
	assert.match(help.stdout, /--jobs/, "--jobs must be documented");
	const header = (concurrent.stdout ?? "").match(/jobs=(\d+)/)?.[1];
	assert.ok(header, "the header must report the job count");
	assert.ok(Number(header) <= 8, `the default concurrency is ${header}; it must stay <= 8 so the suite cannot starve the rig`);

	// 7. --jobs must stay a real number with a real check: a bad value is a USAGE error (exit 2), not a
	//    silently-ignored flag that quietly returns to serial.
	for (const bad of ["0", "-1", "two", ""]) {
		const r = run("green", ["--jobs", bad, "--timeout", "2000"]);
		assert.equal(r.status, 2, `--jobs ${JSON.stringify(bad)} must be a usage error, got exit ${r.status}`);
	}
} finally {
	rmSync(root, { recursive: true, force: true });
}

console.log("TEST-RUNNER-CONCURRENCY TEST PASS");
process.exit(0);
