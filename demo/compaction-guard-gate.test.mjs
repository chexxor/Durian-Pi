// demo/compaction-guard-gate.test.mjs — ROADMAP 352 (2/2), #6127: put the guard's 28-check gate
// inside area discovery so the suite actually runs it.
//
// WHY. src/testareas.mjs discovers only `demo/*.test.mjs` (`discoverTests`), so
// `tools/compaction-guard-test.mjs` — the gate that proves the compaction guard cannot itself break
// compaction — is invisible to every suite run, and a seat's `check` can pass with the guard broken.
// This file is WIRING ONLY: it adds no check and widens none. It runs the gate, carries its exit
// code, and proves the wiring is real rather than nominal.
//
// Two failure modes a wrapper can introduce, both asserted against here:
//   1. a pass-through that always exits 0 (a green that measures nothing);
//   2. a hard-coded "28" that drifts from the gate's actual check count.
//
// Run: node demo/compaction-guard-gate.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { areaNames, discoverTests, filesForArea, readManifest, selectTests, validateManifest } from "../src/testareas.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const GATE_REL = "tools/compaction-guard-test.mjs";
const SELF = "demo/compaction-guard-gate.test.mjs";
const GUARD_FILES = ["compaction-guard-test.mjs", "compaction-guard-extension.js", "compaction-guard-core.mjs"];

/** Run the gate in `root` and return its verdict in a form the wrapper can be held to. */
function runGate(root) {
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [join(root, GATE_REL)], {
		cwd: root,
		encoding: "utf8",
		timeout: 30000,
		// The guard appends a log next to its cwd; send it to the scratch so the wrapper leaves no
		// side effects in the tree it is measuring.
		env: { ...process.env, COMPACT_GUARD_LOG: join(scratchRoot, "guard-log.jsonl") },
	});
	const lines = String(r.stdout ?? "").split(/\r?\n/);
	return {
		code: r.status,
		pass: lines.filter((l) => l.startsWith("PASS  ")).map((l) => l.slice(6).split("  — ")[0].trim()),
		fail: lines.filter((l) => l.startsWith("FAIL  ")).map((l) => l.slice(6).split("  — ")[0].trim()),
		verdict: lines.filter((l) => /ALL PASS|FAILURES/.test(l)).join(" | "),
		ms: Date.now() - t0,
		tree: root,
		stderr: String(r.stderr ?? ""),
	};
}

/** How many checks the gate DECLARES — derived from the source, never from a remembered number. */
function declaredChecks(root) {
	return readFileSync(join(root, GATE_REL), "utf8")
		.split(/\r?\n/)
		.filter((l) => /^\s*check\(/.test(l)).length;
}

const scratchRoot = mkdtempSync(join(tmpdir(), "durig-guard-gate-"));

try {
	/* 1. THE FILE IS DISCOVERED, not merely present. Asked of the discovery code itself, which is
	 *    the thing that was broken: a test no runner finds is not wired. */
	const found = discoverTests(ROOT);
	assert.ok(found.includes(SELF), `${SELF} is not in discoverTests() — the wrapper is not wired into the suite`);
	const manifest = readManifest(ROOT);
	const areas = areaNames(manifest).filter((a) => filesForArea(manifest, a).includes(SELF));
	assert.equal(areas.length, 1, `${SELF} must be mapped to exactly one area; found ${areas.length ? areas.join(", ") : "NONE"} — discovery alone does not put it in a runnable set`);
	const coverage = validateManifest(ROOT);
	assert.ok(coverage.ok, `the area manifest does not partition the suite: ${coverage.errors.join("; ")}`);
	// The runner's own selection, not a hand-written list: scripts/test.mjs calls selectTests, so this
	// is the set that actually gets spawned by `--area` and by the pre-landing `--all` gate.
	assert.ok(selectTests(ROOT, { area: areas[0] }).files.includes(SELF), `scripts/test.mjs --area ${areas[0]} would not run ${SELF}`);
	assert.ok(selectTests(ROOT, { all: true }).files.includes(SELF), "the full suite would not run the guard gate");

	/* 2. THE GATE RUNS AND PASSES HERE. */
	const declared = declaredChecks(ROOT);
	assert.equal(declared, 28, `the gate declares ${declared} checks; ROADMAP 352 says 28 — one of them is stale, fix the row and this demo together`);
	const gate = runGate(ROOT);
	assert.equal(gate.code, 0, `guard gate exited ${gate.code}: ${gate.fail.join(", ")}\n${gate.stderr.slice(0, 300)}`);
	assert.equal(gate.fail.length, 0, `the gate reported failures but exited 0: ${gate.fail.join(", ")}`);
	assert.equal(gate.pass.length, declared, `the gate printed ${gate.pass.length} PASS lines but declares ${declared} checks — a check ran silently, or the run stopped early`);
	assert.match(gate.verdict, /ALL PASS/, `the gate's own verdict line is missing: ${gate.verdict}`);
	assert.ok(gate.ms < 5000, `the gate took ${gate.ms} ms; ROADMAP 352 claims ~0.46 s and no model call — a funded call cannot fit that`);

	/* 3. $0 IS DEMONSTRATED, not asserted. Run it with no credential in the environment at all, and
	 *    check the gate and the guard it loads never touch a network module. */
	const bare = spawnSync(process.execPath, [join(ROOT, GATE_REL)], {
		cwd: ROOT,
		env: { PATH: process.env.PATH, COMPACT_GUARD_LOG: join(scratchRoot, "guard-log-bare.jsonl") },
		encoding: "utf8",
		timeout: 30000,
	});
	assert.equal(bare.status, 0, `the gate needs a credential or a network: exit ${bare.status} ${bare.stderr.slice(0, 300)}`);
	const sources = GUARD_FILES.map((f) => readFileSync(join(ROOT, "tools", f), "utf8")).join("\n");
	assert.ok(!/\bfetch\s*\(|node:http|node:https|node:net/.test(sources), "the guard gate reaches the network — it is not a $0 gate and does not belong in the suite");

	/* 4. NON-VACUOUS: break the guard's own logic and the wrapper must say so, naming the check and
	 *    the tree. A wrapper that cannot fail is worse than no wrapper: it manufactures confidence. */
	const broken = mkdtempSync(join(scratchRoot, "broken-guard"));
	mkdirSync(join(broken, "tools"), { recursive: true });
	for (const f of GUARD_FILES) copyFileSync(join(ROOT, "tools", f), join(broken, "tools", f));
	// The guard extension imports @earendil-works/pi-coding-agent, so the copy needs the resolved
	// dependency set. Symlink it in rather than flattening the copy into the repo.
	try {
		symlinkSync(join(ROOT, "node_modules"), join(broken, "node_modules"));
	} catch {
		/* already present or the platform refuses the link; the assertion below still reports the truth */
	}
	const corePath = join(broken, "tools", "compaction-guard-core.mjs");
	const core = readFileSync(corePath, "utf8").replace("pruned: true,", "pruned: false,");
	writeFileSync(corePath, core);
	const caught = runGate(broken);
	assert.equal(caught.code, 1, `a guard whose capSummary does not prune must fail the gate; it exited ${caught.code}`);
	assert.ok(caught.fail.length > 0 && caught.fail.some((n) => /capSummary/i.test(n)), `the gate failed but did not NAME the broken check: ${caught.verdict}`);
	assert.equal(caught.pass.length + caught.fail.length, declared, "the poisoned run silently skipped checks instead of reporting them");

	/* 5. THE REPORT IS LEGIBLE. When it fails, the line a seat sees names the checks and the tree. */
	const report = caught.code === 0 ? "" : `guard gate FAILED in ${caught.tree}: ${caught.fail.join(", ")}`;
	assert.ok(report.includes(caught.tree) && report.includes("capSummary"), `a failure report must name the tree and the failing checks: ${report}`);

	console.log(
		`COMPACTION-GUARD GATE TEST PASS (#6127, ROADMAP 352 2/2): the wrapper is in discoverTests() and mapped to exactly one area ("${areas[0]}"); the 28-check gate runs and passes in ${gate.ms} ms with all 28 checks reported; it exits 0 with no credential in the environment and its sources use no network module; poisoning capSummary makes it exit 1 and name the check and the tree, so the wrapper can actually fail`,
	);
	process.exit(0);
} catch (err) {
	console.error(`FAIL  ${err.message}`);
	process.exit(1);
} finally {
	rmSync(scratchRoot, { recursive: true, force: true });
}
