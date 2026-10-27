#!/usr/bin/env node
// scripts/test.mjs — run the demo suite: all of it, or one functional area (#1558).
//
// The suite is one flat directory (`demo/*.test.mjs`). The FULL suite is the
// pre-landing / QA gate; a developer normally needs only their own functional
// area, which is far cheaper. The area -> file mapping is data
// (`demo/test-areas.json`), and `demo/test-areas.test.mjs` is the check rule
// that fails when it rots — so a new test file cannot land unmapped.
//
//   node scripts/test.mjs --area broker   run one functional area
//   node scripts/test.mjs --all           the whole suite (the gate; the default)
//   node scripts/test.mjs                 the whole suite (default)
//   node scripts/test.mjs --list          list areas and counts, run nothing
//   node scripts/test.mjs                    runs 8 at once by default (276.8s serial -> ~41s here; see
//                                        DEFAULT_JOBS for why 8, and not 1, and not every core)
//   node scripts/test.mjs --json          one JSON document instead of lines
//
// Exit: 0 all selected tests pass; 1 at least one failed; 2 usage/selection error.
import { spawn } from "node:child_process";
import { availableParallelism, cpus } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { areaNames, discoverTests, filesForArea, readManifest, selectTests, validateManifest } from "../src/testareas.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The default concurrency — why it is not 1, and why it is not every core.
 *
 * Measured on this box (2026-10-27, 237 tests): 276.8s serially, 41.0s at 8 jobs, 25.8s at 16 — a 6.7x win for
 * doing nothing differently except running them at once. The demos spend most of their time WAITING (broker
 * heartbeats, wake paths, cooperative stops), so they overlap almost for free. The capability already existed
 * behind a flag nobody passed, and a capability nobody passes is not a capability — so the fast path is now the
 * default, and `demo/test-runner-concurrency.test.mjs` pins it against a future edit quietly setting it back.
 *
 * CAPPED AT 8 rather than `availableParallelism()` (16 here) because this machine is not a CI box: it also
 * serves two models and runs up to two live seats, and every demo spawns real broker/subprocess trees. At 16
 * the suite is ~15s faster and turns itself into a load generator against the rig it is testing — which is how a
 * timing-sensitive suite starts flaking under exactly the conditions that matter. `--jobs N` still raises it.
 */
export const DEFAULT_JOBS = Math.min(8, Math.max(1, typeof availableParallelism === "function" ? availableParallelism() : cpus().length));
/** A demo that hangs must not hold a slot forever. Slowest observed demo is ~17s serially, so this is generous
 * headroom for contention while still BOUNDING the run: a suite that never returns is worse than one that fails. */
export const DEFAULT_TIMEOUT_MS = 120_000;

const USAGE = `usages:
  node scripts/test.mjs --area <name>   run one functional area (see --list)
  node scripts/test.mjs --all           run the whole suite (the pre-landing/QA gate; the default)
  node scripts/test.mjs --list          list areas and their test counts, run nothing
  node scripts/test.mjs --jobs <n>      run up to <n> tests concurrently (default ${DEFAULT_JOBS}; this box measured 276.8s serial vs 41.0s at 8)
  node scripts/test.mjs --timeout <ms>  per-test bound (default ${DEFAULT_TIMEOUT_MS}); a hung test is a FAIL, never a hang
  node scripts/test.mjs --json          emit one JSON document instead of per-test lines`;

class UsageError extends Error {}

function parseArgs(argv) {
	const opts = { area: null, all: false, list: false, jobs: DEFAULT_JOBS, timeoutMs: DEFAULT_TIMEOUT_MS, json: false };
	for (let i = 0; i < argv.length; i++) {
		const a = argv[i];
		if (a === "--area") {
			opts.area = argv[++i];
			if (opts.area === undefined) throw new UsageError("--area needs a name");
		} else if (a === "--all") opts.all = true;
		else if (a === "--list") opts.list = true;
		else if (a === "--json") opts.json = true;
		else if (a === "--jobs") {
			opts.jobs = Number(argv[++i]);
			// Rejected rather than coerced: under a permissive check `--jobs 0` means "no workers" and the run
			// either hangs or quietly runs nothing, and `--jobs two` would silently mean serial.
			if (!Number.isInteger(opts.jobs) || opts.jobs < 1) throw new UsageError("--jobs needs a positive integer");
		}
		else if (a === "--timeout") {
			opts.timeoutMs = Number(argv[++i]);
			if (!Number.isInteger(opts.timeoutMs) || opts.timeoutMs < 1) throw new UsageError("--timeout needs a positive integer of milliseconds");
		} else if (a === "--help" || a === "-h") opts.help = true;
		else throw new UsageError(`unknown argument: ${a}`);
	}
	return opts;
}

/**
 * Run one test file in the repo root; never throws — a spawn failure or a TIMEOUT is a FAIL.
 *
 * The timeout exists BECAUSE of concurrency. Serially a hung test costs one slot and you watch it happen; with
 * 8 slots it quietly eats an eighth of the capacity and the suite simply never exits, which reads as "the tests
 * are slow" rather than as the one defect it actually is.
 */
function runOne(file, timeoutMs) {
	return new Promise((res) => {
		const t0 = Date.now();
		// DETACHED ON POSIX so the whole tree can be signalled: a demo that spawns a broker leaves that broker
		// running if only the direct child is killed, and a leaked broker then contends with the next run. On
		// Windows reaping a tree as a unit needs a Job Object (src/job-object.mjs does that for the rig) and the
		// runner owns none, so the direct kill is the best available — stated, not assumed away.
		const detached = process.platform !== "win32";
		const child = spawn(process.execPath, [file], { cwd: ROOT, detached });
		let out = "";
		let timedOut = false;
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		const timer = setTimeout(() => {
			timedOut = true;
			try {
				if (detached) process.kill(-child.pid, "SIGKILL");
				else child.kill("SIGKILL");
			} catch {
				try {
					child.kill("SIGKILL");
				} catch {
					/* already gone */
				}
			}
		}, timeoutMs);
		child.on("error", (e) => {
			clearTimeout(timer);
			res({ file, ok: false, code: null, ms: Date.now() - t0, output: String(e) });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			const ms = Date.now() - t0;
			if (timedOut) res({ file, ok: false, code, ms, timedOut: true, output: `${out}\nTIMED OUT after ${timeoutMs}ms (killed)` });
			else res({ file, ok: code === 0, code, ms, output: out });
		});
	});
}

/** Bounded-concurrency run; each result prints as it lands, in completion order. */
async function runAll(files, jobs, timeoutMs) {
	const results = new Array(files.length);
	let next = 0;
	async function worker() {
		for (;;) {
			const i = next++;
			if (i >= files.length) return;
			const r = await runOne(files[i], timeoutMs);
			results[i] = r;
			process.stdout.write(`${r.ok ? "PASS" : r.timedOut ? "TIMEOUT" : "FAIL"} ${files[i]} (${(r.ms / 1000).toFixed(1)}s)\n`);
			if (!r.ok) {
				const tail = r.output.trim().split("\n").slice(-8).join("\n");
				if (tail) process.stderr.write(`--- ${files[i]} (exit ${r.code}) ---\n${tail}\n`);
			}
		}
	}
	await Promise.all(Array.from({ length: Math.min(jobs, files.length) }, worker));
	return results;
}

async function main(argv) {
	const opts = parseArgs(argv);
	if (opts.help) {
		process.stdout.write(`${USAGE}\n`);
		return 0;
	}

	// The coverage check runs on every invocation: a rotated manifest is reported
	// (and, on the full suite, fails the run) even when a subset was selected.
	const coverage = validateManifest(ROOT);

	if (opts.list) {
		const manifest = readManifest(ROOT);
		const rows = areaNames(manifest).map((area) => ({ area, count: filesForArea(manifest, area).length }));
		if (opts.json) {
			process.stdout.write(`${JSON.stringify({ ok: coverage.ok, areas: rows, coverage: coverage.errors }, null, 2)}\n`);
		} else {
			for (const r of rows) process.stdout.write(`${r.area.padEnd(12)} ${String(r.count).padStart(3)}\n`);
			process.stdout.write(`\n${discoverTests(ROOT).length} tests on disk; manifest ${coverage.ok ? "covers all of them" : "ROTATED — " + coverage.errors.join("; ")}\n`);
		}
		return coverage.ok ? 0 : 1;
	}

	let sel;
	try {
		sel = selectTests(ROOT, { area: opts.area, all: opts.all });
	} catch (e) {
		throw new UsageError(e.message);
	}
	if (sel.files.length === 0) throw new UsageError("no tests selected");

	const label = sel.area ? `area "${sel.area}"` : "the full suite";
	process.stdout.write(`running ${sel.files.length} test(s) in ${label} (jobs=${opts.jobs}, timeout=${opts.timeoutMs}ms)\n`);
	const started = Date.now();
	const results = await runAll(sel.files, opts.jobs, opts.timeoutMs);
	const failed = results.filter((r) => !r.ok);
	const timedOut = results.filter((r) => r.timedOut);
	// Durations get reported because "the suite is slow" is only actionable once you know WHICH tests are.
	const slowest = [...results].sort((a, b) => b.ms - a.ms).slice(0, 5).map((r) => ({ file: r.file, ms: r.ms }));
	const summary = {
		ok: failed.length === 0,
		area: sel.area,
		total: results.length,
		passed: results.length - failed.length,
		failed: failed.map((r) => r.file),
		timedOut: timedOut.map((r) => r.file),
		jobs: opts.jobs,
		slowest,
		ms: Date.now() - started,
		coverage: coverage.errors,
	};

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	} else {
		process.stdout.write(`\n${summary.passed}/${summary.total} passed in ${(summary.ms / 1000).toFixed(1)}s\n`);
		if (failed.length) process.stdout.write(`FAILED: ${failed.map((r) => r.file).join(", ")}\n`);
		if (timedOut.length) process.stdout.write(`TIMED OUT: ${timedOut.map((r) => r.file).join(", ")}\n`);
		if (slowest.length) process.stdout.write(`slowest: ${slowest.map((s) => `${s.file} ${(s.ms / 1000).toFixed(1)}s`).join(", ")}\n`);
		if (!coverage.ok) process.stdout.write(`manifest coverage ROTATED: ${coverage.errors.join("; ")}\n`);
	}
	// The full suite is the gate: a rotated manifest fails it. A subset run reports
	// coverage but is judged only on the tests it selected.
	const coverageFailsGate = !sel.area && !coverage.ok;
	return failed.length || coverageFailsGate ? 1 : 0;
}

main(process.argv.slice(2)).then(
	(code) => {
		process.exitCode = code;
	},
	(e) => {
		if (e instanceof UsageError) process.stderr.write(`${e.message}\n${USAGE}\n`);
		else process.stderr.write(`${e?.stack ?? e}\n`);
		process.exitCode = 2;
	},
);
