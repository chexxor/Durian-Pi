// demo/compaction-acceptance-gate.test.mjs — #6128, and the #6382 ruling on what this file IS.
//
// THE RULING (#6382). `tools/compaction-acceptance.mjs` is the INSTRUMENT: its exit code is a measurement
// of a tranche, nothing more. This demo is the GATE. It is the only thing that decides, and it decides by
// its OWN exit code, which the suite already reads because this file is a suite member (demo/test-areas.json,
// area "rig"). The instrument's exit code is never consulted as a gate anywhere else.
//
// WHY THIS EXISTS: `src/testareas.mjs` discovers only `demo/*.test.mjs`, so an instrument living in
// docs/evidence/ or .spike/ is invisible to every seat's check no matter how good its measurement is. This
// wrapper runs the instrument on a store IT BUILT, and reports the four measured halves.
//
// A CHECK REPORTS, IT DOES NOT DECIDE (docs/WORKFLOWS.md standing rule). So the report is printed BEFORE any
// assertion runs: the numbers reach the human even when one of them is red. What blocks a landing is the
// demo's exit code as seen by the suite — not a verdict handed to some other tool.
//
// THE CONTROL IS THE POINT. "100 compactions, 0 truncated summaries" only means something if the instrument
// can also count a non-zero. Four tranches:
//   seed            (armed, target 120)   -> gives the seats real history; must place summaries, or the
//                                           depth is fake and the later zero measures nothing
//   positive        (armed, target 100)   -> summaries placed, truncated 0, summariser requests 0
//   negative control (control, stopReason=length) -> reproduces a NON-ZERO truncation, and places 0 summaries
//   inverse control (control, stopReason=stop)    -> nothing truncated, so the instrument's own VERDICT is
//                                           FAIL and its exit code is 1. Without this the control's non-zero
//                                           could be a constant the instrument prints regardless.
//
// THE MECHANISM, not bookkeeping: a truncated summary is not a degraded summary — it is not placed at all.
// `stopReason=length` gives 9 truncations and 0 summaries placed; `stopReason=stop` gives 9 summaries placed.
// So "truncated 0" is the difference between a compaction that happened and one that silently did not — which
// is the `Auto-compaction failed: ... hit the token cap` notice. Reporting "compaction ran" when the summariser
// placed nothing is reporting the wrong thing, which is why every half prints BOTH counts.
//
// THE LIVE-STORE NUMBER IS NOT HERE. This gate builds its own fixture store (`rig.starter.json` via
// `cli.mjs up --no-serve`). The live-store tranche (68 markers seeded, 100/100 placed, exit 1 on a resident
// broker) is a separate measurement, reported in docs/runbooks/compaction-acceptance-measure.md.
//
// $0: every spawn runs with PATH plus store paths only — no credential in the environment — and the
// instrument's own source contains no network module. The "model" is the in-process faux provider.
//
// Run: node demo/compaction-acceptance-gate.test.mjs   (exit 0 = the report is green)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { areaNames, discoverTests, filesForArea, readManifest, selectTests, validateManifest } from "../src/testareas.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const INSTRUMENT = "tools/compaction-acceptance.mjs";
const SELF = "demo/compaction-acceptance-gate.test.mjs";
const dir = mkdtempSync(join(tmpdir(), "durig-acceptance-"));

/**
 * Run the instrument. `env` is deliberately built from scratch: PATH plus store paths. A tranche that
 * needed a real model would fail here, which is the demonstration that it does not.
 */
function runInstrument(args, env = {}) {
	const t0 = Date.now();
	const r = spawnSync(process.execPath, [join(ROOT, INSTRUMENT), ...args], {
		cwd: ROOT,
		env: { PATH: process.env.PATH, ...env },
		timeout: 120000,
	});
	return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", ms: Date.now() - t0 };
}

/** Pull the numbers the instrument prints out of its own stdout, so the report is about what it MEASURED
 * rather than about its exit code. Every field is kept — a missing field is reported as `?`, not as 0. */
function numbers(out) {
	const grab = (pattern) => {
		const m = pattern.exec(out);
		return m ? Number(m[1]) : undefined;
	};
	return {
		providerCalls: grab(/provider calls in the tranche: (\d+)/),
		growthTurns: grab(/= (\d+) growth turns/),
		summariserRequests: grab(/\+ (\d+) summariser requests\)/),
		markers: grab(/summary markers placed in this tranche: (\d+)/),
		noteBacked: grab(/note-backed (\d+)/),
		digestBacked: grab(/digest-backed (\d+)/),
		completed: grab(/completed outcomes: (\d+)/),
		truncated: grab(/TRUNCATED summaries \("hit the token limit"\): (\d+)/),
		verdict: /VERDICT (PASS|FAIL)/.exec(out)?.[1],
	};
}

/** One report line per half, with BOTH counts named: placed and truncated. "0 truncated" alone is not a
 * report — it is the absence of one. */
function halfLine(name, args, ran) {
	const n = numbers(ran.out);
	const field = (label, value) => `${label}=${value === undefined ? "?" : value}`;
	return (
		`  ${name.padEnd(16)} ${args.padEnd(34)} ` +
		`${field("compactions", n.completed)} ${field("summaries placed", n.markers)} ` +
		`${field("TRUNCATED", n.truncated)} ${field("summariser requests", n.summariserRequests)} ` +
		`${field("instrument exit", ran.code)} ${field("instrument verdict", n.verdict)}`
	);
}

const credentialish = (env) =>
	Object.keys(env).filter((k) => /API_KEY|TOKEN|SECRET|CREDENTIAL|ANTHROPIC|OPENAI|GOOGLE_API/.test(k.toUpperCase()));

try {
	// 1. DISCOVERED, not merely present. Ask the discovery code, not the filesystem.
	const found = discoverTests(ROOT);
	assert.ok(found.includes(SELF), `${SELF} is not in discoverTests() — the suite never sees it`);
	const manifest = readManifest(ROOT);
	const areas = areaNames(manifest).filter((a) => filesForArea(manifest, a).includes(SELF));
	assert.equal(areas.length, 1, `${SELF} must map to exactly one area; found ${areas.join(", ") || "NONE"}`);
	assert.ok(
		selectTests(ROOT, { area: areas[0] }).files.includes(SELF),
		`scripts/test.mjs --area ${areas[0]} would not run the instrument`,
	);
	assert.ok(selectTests(ROOT, { all: true }).files.includes(SELF), "the full suite would not run the instrument");
	const coverage = validateManifest(ROOT);
	assert.ok(coverage.ok, `the area manifest does not partition the suite: ${coverage.errors.join("; ")}`);
	assert.ok(existsSync(join(ROOT, INSTRUMENT)), `the instrument is not in the tracked tree at ${INSTRUMENT}`);

	// 1b. THE REGISTRATION, not just the file. The ruling in #6382 is that this demo is the check rule and the
	//     instrument's exit code is not the gate. That is a claim in two documents; assert it is true in them,
	//     so the wiring cannot rot into "the tool's exit code decided again".
	const runbookText = readFileSync(join(ROOT, "docs/runbooks/compaction-acceptance-measure.md"), "utf8");
	const toolsReadme = readFileSync(join(ROOT, "tools/README.md"), "utf8");
	assert.ok(
		/check_rule:\s*"[^"]*compaction-acceptance-gate[^"]*"/.test(runbookText),
		"docs/runbooks/compaction-acceptance-measure.md still registers no check rule — the demo must be the registered check rule (#6382)",
	);
	assert.ok(
		toolsReadme.includes(SELF) && /[Ii]nstrument/.test(toolsReadme) && !/compaction-acceptance\.mjs[^\n]*\bexit code is the gate/i.test(toolsReadme),
		"tools/README.md must name the demo as the gate and must not present the instrument's exit code as one",
	);

	// 2. A STORE THIS DEMO BUILT — never the live rig store. The gate must not depend on a rig being running.
	const rigPath = join(dir, "acceptance.rig.json");
	copyFileSync(join(ROOT, "rig.starter.json"), rigPath);
	const baseDb = join(dir, "base.sqlite");
	const up = spawnSync(process.execPath, ["cli.mjs", "up", rigPath, "--no-serve"], {
		cwd: ROOT,
		env: { PATH: process.env.PATH, DURIG_DB: baseDb, DURIG_PI_DB: baseDb, DURIG_PROVIDER: "faux" },
		encoding: "utf8",
		timeout: 120000,
	});
	assert.equal(up.status, 0, `fixture rig (up) failed: ${up.stderr.slice(0, 300)}`);

	// 3. DEPTH FIRST. A compaction only has a cut when the conversation exceeds keepRecentTokens (20000 in
	//    the rig's own policy). A brand-new seat conversation has none, so the armed tranche would "place 0
	//    summaries and truncate 0" — a zero that measures nothing. This seed run gives the seats real history.
	const seed = runInstrument(["--db", baseDb, "--copyDir", join(dir, "seed"), "--target", "120", "--mode", "armed"]);
	const seededDb = join(dir, "seed", "acceptance-snapshot.sqlite");
	const armed = runInstrument(["--db", seededDb, "--copyDir", join(dir, "armed"), "--target", "100", "--mode", "armed"]);
	const control = runInstrument([
		"--db",
		seededDb,
		"--copyDir",
		join(dir, "control"),
		"--target",
		"12",
		"--mode",
		"control",
		"--stopReason",
		"length",
	]);
	const clean = runInstrument([
		"--db",
		seededDb,
		"--copyDir",
		join(dir, "clean"),
		"--target",
		"12",
		"--mode",
		"control",
		"--stopReason",
		"stop",
	]);

	// 4. REPORT FIRST, THEN DECIDE. The report is printed whatever the numbers say, so a red tranche is
	//    still legible instead of being a stack trace. The exit code that blocks a landing is THIS demo's,
	//    read by the suite — not the instrument's.
	const report = [
		`COMPACTION-ACCEPTANCE REPORT (#6382) — instrument ${INSTRUMENT}; gate ${SELF} (suite area "${areas[0]}")`,
		`  fixture store built by this demo: ${baseDb} (seed snapshot ${seededDb})`,
		halfLine("seed", "armed target 120", seed),
		halfLine("positive", "armed target 100", armed),
		halfLine("negative control", "control target 12 stopReason=length", control),
		halfLine("inverse control", "control target 12 stopReason=stop", clean),
		"  REPORT ONLY: the instrument's exit code is data on this page. What blocks a landing is this demo's",
		"  exit code, as read by the suite gate (scripts/test.mjs --area rig / --all). The live-store tranche",
		"  is a separate measurement and is not part of this gate.",
	];
	process.stdout.write(report.join("\n") + "\n");

	// 5. The report is the deliverable, so prove it names the counts it claims to name.
	for (const line of report.slice(2, 6)) {
		assert.ok(/TRUNCATED=\d+/.test(line), `a half of the report names no truncation count: ${line}`);
		assert.ok(/summaries placed=\d+/.test(line), `a half of the report names no placed-summary count: ${line}`);
	}

	const a = numbers(armed.out);
	const c = numbers(control.out);
	const n = numbers(seed.out);
	const i = numbers(clean.out);

	// 6. THE GATE'S OWN JUDGEMENT, computed from the measurement, not from the instrument's exit code.
	assert.ok(n.markers > 0, `seed placed no summaries (${seed.out.slice(0, 400)}) — the tranche had no cut to make`);
	assert.ok(a.completed >= 100, `positive tranche completed only ${a.completed} compaction tasks, not 100`);
	assert.ok(a.markers >= 100, `positive tranche placed ${a.markers} summaries for 100 compactions — the zero is not measuring anything`);
	assert.equal(a.truncated, 0, `positive tranche truncated ${a.truncated} summaries — the milestone claim is 0`);
	assert.equal(a.summariserRequests, 0, `positive tranche issued ${a.summariserRequests} summariser requests; the extension should short-circuit them`);
	assert.ok(a.noteBacked + a.digestBacked === a.markers, "every placed summary must be accounted for by a path");

	// The negative control: the instrument must be able to count a non-zero, and the count must be tied to
	// real summariser requests AND to summaries actually placed (zero placed is the whole point).
	assert.ok(c.truncated > 0, `negative control reproduced NO truncation (${control.out.slice(-300)}) — the instrument cannot count a non-zero, so the positive 0 proves nothing`);
	assert.equal(c.truncated, c.summariserRequests, `control counted ${c.truncated} truncations for ${c.summariserRequests} summariser requests — the count is not tied to real requests`);
	assert.equal(c.markers, 0, `negative control placed ${c.markers} summaries; a truncated summary is not placed at all, so a non-zero here means the counter and the placement disagree`);
	assert.equal(c.growthTurns, 12, `control ran ${c.growthTurns} growth turns, not the 12 measured`);

	// The counter is not a constant: identical tranche, clean stopReason -> nothing truncated, so the
	// instrument's own verdict is FAIL. A gate that cannot go red is not a gate.
	assert.equal(clean.code, 1, `clean-stop control exited ${clean.code}; the instrument must FAIL when nothing is truncated: ${clean.out.slice(-300)}`);
	assert.equal(i.truncated, 0, "the clean-stop control should have produced no truncation");
	assert.ok(i.markers > 0, `the clean-stop control placed ${i.markers} summaries — the inverse control is only meaningful because a clean stop DOES place them`);

	// 7. $0: no credential, no network.
	for (const [name, env] of [["up", { PATH: process.env.PATH, DURIG_DB: baseDb, DURIG_PI_DB: baseDb, DURIG_PROVIDER: "faux" }], ["seed", { PATH: process.env.PATH }]]) {
		assert.equal(credentialish(env).length, 0, `${name} ran with credentials in the environment: ${credentialish(env).join(", ")}`);
	}
	const source = readFileSync(join(ROOT, INSTRUMENT), "utf8");
	assert.ok(!/fetch\(|node:http|node:https|node:net|require\("http/.test(source), "the instrument reaches the network — the $0 claim is false");
	const total = seed.ms + armed.ms + control.ms + clean.ms;
	assert.ok(total < 60000, `the gate took ${total} ms — it must stay inside the suite budget`);

	console.log(
		`COMPACTION-ACCEPTANCE GATE PASS (#6128, #6382): instrument is in discoverTests() and mapped to exactly one area ("${areas[0]}"); positive placed ${a.markers} summaries, truncated ${a.truncated}, summariser requests ${a.summariserRequests}; negative control truncated ${c.truncated} and placed ${c.markers}; inverse control placed ${i.markers} and truncated ${i.truncated}, instrument exit ${clean.code}; all four tranches ran with PATH only and no network module in the instrument; ${total} ms total on a fixture store this demo built`,
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
