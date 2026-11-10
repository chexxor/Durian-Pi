// demo/compaction-acceptance-gate.test.mjs — #6128: the N18 compaction-acceptance instrument is a GATE,
// not a document sitting under docs/evidence/.
//
// WHY THIS EXISTS: `src/testareas.mjs` discovers only `demo/*.test.mjs`, so an instrument that lives in
// docs/evidence/ is invisible to every seat's `check` no matter how good its measurement is. The
// instrument (docs/evidence/2026-11-08-context-window/compaction-acceptance.mjs) drives compactions on a
// SNAPSHOT copy of a store and counts what the harness actually wrote. This wrapper runs it, carries its
// exit code, and asserts BOTH halves of the claim.
//
// THE CONTROL IS THE POINT. "100 compactions, 0 truncated summaries" is only meaningful if the
// instrument can prove it is able to count a non-zero. So this demo runs three tranches:
//   armed   (continuity extension installed)  -> 100 compactions, summaries placed, 0 truncated
//   control (no extension, canned reply with stopReason=length) -> reproduces a NON-ZERO truncation
//   inverse control (no extension, clean stopReason=stop)       -> 0 truncated, so the instrument's
//       own verdict FAILS and this wrapper reports it. Without that third run the control could be a
//         constant the instrument prints regardless of what happened.
// Measured on the live rig store (seat root, 2026-11-10, pi-durable 1.5.1): armed --target 100 -> 100
// tasks, 0 truncated, exit 0, 27.9 s; control --target 12 --stopReason length -> 10 truncated, exit 0.
//
// RED BEFORE: on HEAD, selectTests(root,{all:true}) returns 282 files and none of them invoke the
// instrument; the 28-check gate added by #6127 was the only compaction guard inside the suite.
//
// $0: every spawn runs with PATH plus store paths only - no credential in the environment - and the
// instrument's own source contains no network module. The "model" is the in-process faux provider.
//
// Run: node demo/compaction-acceptance-gate.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { areaNames, discoverTests, filesForArea, readManifest, selectTests, validateManifest } from "../src/testareas.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const INSTRUMENT = "docs/evidence/2026-11-08-context-window/compaction-acceptance.mjs";
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
		encoding: "utf8",
		timeout: 120000,
	});
	return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "", ms: Date.now() - t0 };
}

/** Pull the numbers the instrument prints out of its own stdout, so the assertions are about what it
 * measured rather than about its exit code. */
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

	// 2. A STORE THIS DEMO BUILT — never the live rig store. The instrument snapshots whatever it is
	//    given and writes only to the snapshot, but a gate must not depend on a rig being running.
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

	// 3. DEPTH FIRST. A compaction only has a cut when the conversation exceeds keepRecentTokens
	//    (20000 in the rig's own policy). A brand-new seat conversation has none, so the armed tranche
	//    would "place 0 summaries and truncate 0" — a zero that measures nothing. This seed run gives
	//    the seats real history, and it must itself place summaries or the depth is fake.
	const seed = runInstrument(["--db", baseDb, "--copyDir", join(dir, "seed"), "--target", "120", "--mode", "armed"]);
	assert.equal(seed.code, 0, `seed run failed: ${seed.err.slice(0, 300)}`);
	const seedN = numbers(seed.out);
	assert.ok(seedN.markers > 0, `seed placed no summaries (${seed.out.slice(0, 400)}) — the tranche had no cut to make`);
	const seededDb = join(dir, "seed", "acceptance-snapshot.sqlite");
	assert.ok(existsSync(seededDb), "the seed snapshot was not written");

	// 4. THE ARMED TRANCH: 100 compactions, every one placing a summary, none truncated, and no
	//    summariser request at all (the extension supplies the summary, so the harness never builds one).
	const armed = runInstrument(["--db", seededDb, "--copyDir", join(dir, "armed"), "--target", "100", "--mode", "armed"]);
	assert.equal(armed.code, 0, `armed tranche failed (exit ${armed.code}): ${armed.err.slice(0, 300)}`);
	const a = numbers(armed.out);
	assert.equal(a.verdict, "PASS", `instrument verdict ${a.verdict}: ${armed.out.slice(-300)}`);
	assert.ok(a.completed >= 100, `armed tranche completed only ${a.completed} compaction tasks, not 100`);
	assert.ok(a.markers >= 100, `armed tranche placed ${a.markers} summaries for 100 compactions — the zero is not measuring anything`);
	assert.equal(a.truncated, 0, `armed tranche truncated ${a.truncated} summaries — the milestone claim is 0`);
	assert.equal(a.summariserRequests, 0, `armed tranche issued ${a.summariserRequests} summariser requests; the extension should short-circuit them`);
	assert.ok(a.noteBacked + a.digestBacked === a.markers, "every placed summary must be accounted for by a path");

	// 5. THE NEGATIVE CONTROL. Same instrument, extension absent, canned reply with stopReason=length:
	//    the harness's own truncation branch fires and the counter counts it. This is what makes the
	//    armed 0 a measurement rather than an absence.
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
	assert.equal(control.code, 0, `negative control failed (exit ${control.code}): ${control.err.slice(0, 300)}`);
	const c = numbers(control.out);
	assert.ok(c.truncated > 0, `negative control reproduced NO truncation (${control.out.slice(-300)}) — the instrument cannot count a non-zero, so the armed 0 proves nothing`);
	assert.equal(c.truncated, c.summariserRequests, `control counted ${c.truncated} truncations for ${c.summariserRequests} summariser requests — the count is not tied to real requests`);
	assert.equal(c.growthTurns, 12, `control ran ${c.growthTurns} growth turns, not the 12 measured`);

	// 6. THE COUNTER IS NOT A CONSTANT. Identical control tranche, canned reply with a clean stopReason
	//    instead of `length`: nothing is truncated, so the instrument's own verdict is FAIL and this
	//    wrapper reports the failure. A gate that cannot go red is not a gate.
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
	assert.equal(clean.code, 1, `clean-stop control exited ${clean.code}; the instrument must FAIL when nothing is truncated: ${clean.out.slice(-300)}`);
	assert.equal(numbers(clean.out).truncated, 0, "the clean-stop control should have produced no truncation");

	// 7. $0: no credential, no network.
	for (const [name, env] of [["up", { PATH: process.env.PATH, DURIG_DB: baseDb, DURIG_PI_DB: baseDb, DURIG_PROVIDER: "faux" }], ["seed", { PATH: process.env.PATH }]]) {
		assert.equal(credentialish(env).length, 0, `${name} ran with credentials in the environment: ${credentialish(env).join(", ")}`);
	}
	const source = readFileSync(join(ROOT, INSTRUMENT), "utf8");
	assert.ok(!/fetch\(|node:http|node:https|node:net|require\("http/.test(source), "the instrument reaches the network — the $0 claim is false");
	const total = seed.ms + armed.ms + control.ms + clean.ms;
	assert.ok(total < 60000, `the gate took ${total} ms — it must stay inside the suite budget (measured 27.9 s against the live store)`);

	console.log(
		`COMPACTION-ACCEPTANCE GATE TEST PASS (#6128): the instrument is in discoverTests() and mapped to exactly one area ("${areas[0]}"); armed 100 compactions placed ${a.markers} summaries with 0 truncated and 0 summariser requests; the negative control reproduced ${c.truncated} truncations (== its ${c.summariserRequests} summariser requests); the clean-stop control exits 1, so the counter is not a constant; all four tranches ran with PATH only and no network module in the instrument; ${total} ms total on a fixture store this demo built`,
	);
} finally {
	rmSync(dir, { recursive: true, force: true });
}
