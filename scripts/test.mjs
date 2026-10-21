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
//   node scripts/test.mjs --jobs 4        run up to 4 tests at once (default 1)
//   node scripts/test.mjs --json          one JSON document instead of lines
//
// Exit: 0 all selected tests pass; 1 at least one failed; 2 usage/selection error.
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { areaNames, discoverTests, filesForArea, readManifest, selectTests, validateManifest } from "../src/testareas.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const USAGE = `usages:
  node scripts/test.mjs --area <name>   run one functional area (see --list)
  node scripts/test.mjs --all           run the whole suite (the pre-landing/QA gate; the default)
  node scripts/test.mjs --list          list areas and their test counts, run nothing
  node scripts/test.mjs --jobs <n>      run up to <n> tests concurrently (default 1)
  node scripts/test.mjs --json          emit one JSON document instead of per-test lines`;

class UsageError extends Error {}

function parseArgs(argv) {
	const opts = { area: null, all: false, list: false, jobs: 1, json: false };
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
			if (!Number.isInteger(opts.jobs) || opts.jobs < 1) throw new UsageError("--jobs needs a positive integer");
		} else if (a === "--help" || a === "-h") opts.help = true;
		else throw new UsageError(`unknown argument: ${a}`);
	}
	return opts;
}

/** Run one test file in the repo root; never throws — a spawn failure is a FAIL. */
function runOne(file) {
	return new Promise((res) => {
		const child = spawn(process.execPath, [file], { cwd: ROOT });
		let out = "";
		child.stdout.on("data", (d) => (out += d));
		child.stderr.on("data", (d) => (out += d));
		child.on("error", (e) => res({ file, ok: false, code: null, output: String(e) }));
		child.on("close", (code) => res({ file, ok: code === 0, code, output: out }));
	});
}

/** Bounded-concurrency run; each result prints as it lands, in completion order. */
async function runAll(files, jobs) {
	const results = new Array(files.length);
	let next = 0;
	async function worker() {
		for (;;) {
			const i = next++;
			if (i >= files.length) return;
			const r = await runOne(files[i]);
			results[i] = r;
			process.stdout.write(`${r.ok ? "PASS" : "FAIL"} ${files[i]}\n`);
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
	process.stdout.write(`running ${sel.files.length} test(s) in ${label} (jobs=${opts.jobs})\n`);
	const started = Date.now();
	const results = await runAll(sel.files, opts.jobs);
	const failed = results.filter((r) => !r.ok);
	const summary = {
		ok: failed.length === 0,
		area: sel.area,
		total: results.length,
		passed: results.length - failed.length,
		failed: failed.map((r) => r.file),
		ms: Date.now() - started,
		coverage: coverage.errors,
	};

	if (opts.json) {
		process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
	} else {
		process.stdout.write(`\n${summary.passed}/${summary.total} passed in ${(summary.ms / 1000).toFixed(1)}s\n`);
		if (failed.length) process.stdout.write(`FAILED: ${failed.map((r) => r.file).join(", ")}\n`);
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
