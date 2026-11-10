// demo/clockin-guard.test.mjs — ROADMAP 352 (1/2) #6125: clock-in prints the compaction guard's
// state, names the tree that state was measured in, and never installs anything.
//
// FAILING-FIRST. Before #6125 there was no guard line in the digest at all: the delegate measured
// `grep -ic guard scripts/clockin.mjs` → 0 on main while `node tools/compaction-guard-install.mjs
// --check` on the same host exited 0 reporting UP TO DATE. The guard lives in `.pi/extensions/`,
// which is gitignored (`.gitignore:15`), so it is host-local and invisible: "not installed" and
// "installed" look identical to a seat. A probe that can only ever say "fine" is a green that
// measures nothing, so this file drives the probe against REAL files in scratch trees and asserts the
// distinct states the tool can actually produce — plus that the probe leaves them exactly as found.
//
// Run: node demo/clockin-guard.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	DIGEST_BUDGET_BYTES,
	GUARD_PROBE_BOUND_MS,
	GUARD_TOOL,
	guardStatus,
	renderDigest,
} from "../scripts/clockin.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const scratchRoot = mkdtempSync(join(tmpdir(), "durig-guard-"));

// A scratch repo containing the guard tool and its two sources, but no `.pi/` — i.e. an unguarded tree.
function scratchTree(name, { withTool = true } = {}) {
	const t = mkdtempSync(join(scratchRoot, name));
	if (withTool) {
		mkdirSync(join(t, "tools"), { recursive: true });
		for (const f of [
			"compaction-guard-install.mjs",
			"compaction-guard-extension.js",
			"compaction-guard-core.mjs",
		]) copyFileSync(join(ROOT, "tools", f), join(t, "tools", f));
	}
	return t;
}

// An injected spawn: every state the probe can meet, without touching a filesystem.
const fakeSpawn = (stdout, exitCode, code, stderr = "") => (_file, _args) => {
	if (exitCode !== 0 || code) {
		throw Object.assign(new Error(`fake exit ${exitCode}`), { exitCode, code, stdout, stderr });
	}
	return stdout;
};

try {
	/* 1. CLASSIFICATION. Each real output shape maps to a distinct, truthful status — and none of
	 *    them collapse into "ok" or into an empty string. */
	const cases = [
		["UP TO DATE  .pi/extensions/compaction-guard.js (+ .pi/extensions/compaction-guard-core.mjs)", 0, null, "", "UP TO DATE"],
		["STALE  .pi/extensions/compaction-guard.js differs from tools/compaction-guard-extension.js (10 vs 20 bytes)", 1, null, "", "STALE"],
		["NOT INSTALLED  .pi/extensions/compaction-guard.js does not exist", 1, null, "", "NOT INSTALLED"],
		["", 1, null, "FAIL  source missing: tools/compaction-guard-extension.js", "SOURCE MISSING"],
		["", 1, null, "Error: Cannot find module '/repo/tools/compaction-guard-install.mjs'", "PROBE MISSING"],
		["", 1, "ETIMEDOUT", "", "PROBE TIMED OUT"],
		["", 1, "ENOENT", "", "PROBE MISSING"],
		["", 2, null, "", "UNKNOWN"],
	];
	for (const [stdout, exitCode, code, stderr, expected] of cases) {
		const g = guardStatus({ root: ROOT, spawn: fakeSpawn(stdout, exitCode, code, stderr), now: () => 0 });
		assert.equal(g.status, expected, `probe output ${JSON.stringify(stdout || "")} classified as ${g.status}, expected ${expected}`);
		assert.ok(g.status && g.status.length > 0, "a status is never empty — an empty status reads as 'no problem'");
		assert.equal(g.ms, 0, "the injected clock makes the probe's own cost provable, not guessed");
	}

	/* 2. THE DEGRADE PATH prints something. A state that never ran the probe must print NOT PROBED,
	 *    not nothing: silence about a host-local file is indistinguishable from "guarded". */
	const unprobed = renderDigest({
		pointer: { lines: ["## NEXT SESSION (test)"], start: 1, end: 1, fileLines: 3, archive: null },
		seats: 1,
		attention: [],
		broker: { detail: "UP pid=1" },
		items: [],
		counts: {},
		git: null,
		runbooks: null,
		config: { provider: "faux", model: "m", local: null, maxSeats: 4 },
		localEndpoint: "x",
		selfdevLines: 1,
		selfdevHeadings: [],
		ms: 1,
	});
	assert.match(unprobed, /^guard: NOT PROBED/m, "an unprobed state says so instead of going silent");

	/* 3. THE REAL TOOL, against real files, in three distinct states, in one scratch tree. */
	const t = scratchTree("states");
	const dest = join(t, ".pi", "extensions", "compaction-guard.js");

	const absent = guardStatus({ root: t });
	assert.equal(absent.status, "NOT INSTALLED", `no .pi/ must report NOT INSTALLED, got ${absent.status}`);
	assert.equal(absent.exit, 1, "the tool's own exit code is carried through, not flattened to 0");
	assert.ok(absent.ms < GUARD_PROBE_BOUND_MS, `the probe took ${absent.ms} ms, over the ${GUARD_PROBE_BOUND_MS} ms contract`);

	// Install it the way a host does, then the probe must agree it is current.
	const install = spawnSync(process.execPath, ["tools/compaction-guard-install.mjs"], { cwd: t, encoding: "utf8" });
	assert.equal(install.status, 0, `install into the scratch tree failed: ${install.stderr.slice(0, 200)}`);
	const current = guardStatus({ root: t });
	assert.equal(current.status, "UP TO DATE", `after install the probe said ${current.status}`);
	assert.equal(current.exit, 0, "an up-to-date guard exits 0");

	// Tamper with the installed copy: the probe must say STALE, and must NOT repair it.
	writeFileSync(dest, readFileSync(dest, "utf8") + "\n// drifted\n");
	const stale = guardStatus({ root: t });
	assert.equal(stale.status, "STALE", `a drifted extension must report STALE, got ${stale.status}`);
	assert.ok(readFileSync(dest, "utf8").endsWith("// drifted\n"), "the probe REPORTS; it never installs or refreshes (the contract says report only)");
	assert.ok(!readFileSync(join(ROOT, "tools", "compaction-guard-extension.js"), "utf8").includes("// drifted"), "the probe did not touch the tracked source");

	// Remove it entirely: the state flips back, it does not become "unknown".
	rmSync(join(t, ".pi"), { recursive: true, force: true });
	assert.equal(guardStatus({ root: t }).status, "NOT INSTALLED", "deletion is reported as NOT INSTALLED");

	// The tool itself missing: reported as a failure of the probe, not as an absent guard.
	const noTool = guardStatus({ root: scratchTree("no-tool", { withTool: false }) });
	assert.equal(noTool.status, "PROBE MISSING", `missing tool reported as ${noTool.status}`);

	/* 4. END-TO-END: the real clock-in prints the line, agrees with the tool run independently in the
	 *    same tree, and stays inside its byte budget with the line added. Store is a fixture, never
	 *    the live rig store. */
	const starter = JSON.parse(readFileSync(join(ROOT, "rig.starter.json"), "utf8"));
	const rigPath = join(scratchRoot, "guard.rig.json");
	writeFileSync(rigPath, JSON.stringify(starter));
	const db = join(scratchRoot, "guard.sqlite");
	const up = spawnSync(process.execPath, ["cli.mjs", "up", rigPath, "--no-serve"], {
		cwd: ROOT,
		env: { ...process.env, DURIG_DB: db, DURIG_PI_DB: db, DURIG_PROVIDER: "faux" },
		encoding: "utf8",
		timeout: 120000,
	});
	assert.equal(up.status, 0, `fixture rig up failed: ${up.stderr.slice(0, 300)}`);

	const digest = spawnSync(process.execPath, ["scripts/clockin.mjs", "--db", db, "--no-git"], {
		cwd: ROOT,
		env: { ...process.env, DURIG_DB: db, DURIG_PI_DB: db },
		encoding: "utf8",
		timeout: 120000,
	});
	assert.equal(digest.status, 0, `clock-in failed: ${digest.stderr.slice(0, 300)}`);
	const guardLine = (digest.stdout.split(/\r?\n/).find((l) => l.startsWith("guard:")) || "");
	assert.ok(guardLine, "clock-in printed NO guard line at all");
	assert.match(guardLine, /^guard: (UP TO DATE|STALE|NOT INSTALLED|SOURCE MISSING|PROBE TIMED OUT|PROBE MISSING|UNKNOWN)  /, `the guard line names a state: ${guardLine}`);
	assert.match(guardLine, /probe \d+ ms \(bound \d+ ms\)/, `the line carries its own measured cost: ${guardLine}`);
	assert.match(guardLine, /tree .+$/, `the line names the tree it was measured in: ${guardLine}`);

	// CROSS-CHECK: the digest's status equals the tool's own verdict in the same tree. One source,
	// not two that can disagree.
	const tool = spawnSync(process.execPath, [GUARD_TOOL, "--check"], { cwd: ROOT, encoding: "utf8", timeout: 10000 });
	const expected = tool.status === 0 ? "UP TO DATE" : /^NOT INSTALLED/.test(tool.stdout) ? "NOT INSTALLED" : /^STALE/.test(tool.stdout) ? "STALE" : "UNKNOWN";
	assert.ok(guardLine.startsWith(`guard: ${expected}`), `digest says "${guardLine}" but the tool itself says ${expected} (exit ${tool.status})`);

	assert.ok(Buffer.byteLength(digest.stdout, "utf8") <= DIGEST_BUDGET_BYTES, `the digest is ${Buffer.byteLength(digest.stdout, "utf8")} B against the ${DIGEST_BUDGET_BYTES} B budget`);

	/* 5. REPORT-ONLY, PROVEN. The probe ran against a tree with no guard; the guard file must still
	 *    not exist afterwards. "Report only; do not install" is a contract, so it is asserted, not promised. */
	const untouched = scratchTree("report-only");
	guardStatus({ root: untouched });
	assert.equal(existsSync(join(untouched, ".pi", "extensions", "compaction-guard.js")), false, "clock-in must NOT install the guard it is reporting on");

	console.log(
		"CLOCKIN GUARD TEST PASS (ROADMAP 352 1/2, #6125): eight output shapes classify into seven distinct states (UP TO DATE, STALE, NOT INSTALLED, SOURCE MISSING, PROBE MISSING, PROBE TIMED OUT, UNKNOWN) and none of them render as silence; the real probe distinguishes NOT INSTALLED / UP TO DATE / STALE in one scratch tree and leaves a drifted file drifted; clock-in prints the line, names the tree and its own measured probe cost, and agrees with the tool run independently in the same tree; the probe never installs; the digest stays inside its 20,000 B budget",
	);
	process.exit(0);
} catch (err) {
	console.error(`FAIL  ${err.message}`);
	process.exit(1);
} finally {
	rmSync(scratchRoot, { recursive: true, force: true });
}
