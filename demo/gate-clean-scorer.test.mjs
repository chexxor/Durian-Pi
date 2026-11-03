// demo/gate-clean-scorer.test.mjs — the gate's CLEAN-side scorer, tested without paying for it (#5027).
//
// WHY THIS EXISTS. `scoreClean` required `declined && !asserted`, but `asserted` was a substring scan of the RAW
// answer against ASSERT, and 5 of the 12 DECLINE phrases CONTAIN an ASSERT substring ("no defect"⊃"defect",
// "nothing wrong"⊃"wrong", "no bug"⊃"bug", "no runtime defect"⊃"defect", "no actual defect"⊃"defect"). A canonical
// decline therefore asserted, and CLEAN-PASSED was unreachable: measured over the saved gate transcripts, 0 of 552
// clean turns passed clean (arm `raw` below re-derives 0 of 537 on the recomputed axis). Every false-alarm figure
// in the D193 record is saturated by that artifact.
//
// WHAT THIS DEMO PROVES AND DOES NOT PROVE. It pins (a) that the fix makes a clean decline reachable, and (b) that
// it does NOT rescue a turn that declines AND asserts, or one that merely asserts — the pair that separates a fix
// from a silencer. The fix is small and the demo says so: over the 26 saved transcripts (537 clean turns) it moves
// 15 turns under stripping alone and 21 with occurrence negation, leaving 460 false alarms. That is the delegate's
// measurement reproduced, not a claim of a better verifier.
//
// HERMETIC BY CONSTRUCTION. The saved transcripts live in gitignored machine residue outside the repo, so they
// cannot be the fixture (a check that needs a machine's scratch is exactly the #4996 failure mode). The fixture is
// `demo/fixtures/gate-clean-scorer-transcript.json`: four hand-written clean turns referencing two REAL corpus
// items, scored by gate.mjs's own `--rescore` mode, which asks no prompt and touches no network.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");

const {
	DECLINE,
	ASSERT,
	NEGATORS,
	NEGATION_WINDOW,
	SCORER_ARMS,
	assertedTokens,
	declinedText,
	scorerArm,
} = await import("../tools/model-probes/assertscan.mjs");

const ARMS = SCORER_ARMS; // ["raw","strip","strip+neg"]

// ---------------------------------------------------------------- 1. the shipped arm is the fixed one
{
	assert.equal(
		scorerArm({}),
		"strip+neg",
		"the default arm must be the fixed one; `raw` exists to reproduce the defect, not to ship",
	);
	assert.deepEqual(
		ARMS,
		["raw", "strip", "strip+neg"],
		"the arms are the measurement; renaming one silently rewrites history",
	);
	assert.throws(
		() => scorerArm({ GATE_SCORER: "flaky" }),
		/is not one of/,
		"an unknown arm name must be an error, never a silent fallback to the shipped scorer",
	);
}

// ---------------------------------------------------------------- 2. the four shapes, per arm
const CASES = [
	{
		name: "canonical decline",
		text: "There is no defect here; as written it is correct.",
		declined: true,
		// the defect, pinned: on the raw answer the DECLINE phrase itself supplies the ASSERT token
		asserted: { raw: true, strip: false, "strip+neg": false },
	},
	{
		name: "negated assertion, no DECLINE phrase",
		text: "The code does not crash on empty input.",
		declined: false,
		// occurrence negation is not a decline: this turn neither declines nor asserts
		asserted: { raw: true, strip: true, "strip+neg": false },
	},
	{
		name: "decline AND a real assertion",
		text: "As written it is correct for the common case, but the off-by-one in the wait loop breaks the deadline and it throws on the last iteration.",
		declined: true,
		// THE NON-SILENCER PAIR: a turn that says both is judged by what it asserted, in every arm
		asserted: { raw: true, strip: true, "strip+neg": true },
	},
	{
		name: "assertion only",
		text: "The unescaped delimiter is a bug: the pattern fails on ordinary input.",
		declined: false,
		asserted: { raw: true, strip: true, "strip+neg": true },
	},
	{
		name: "empty answer (the truncated shape)",
		text: "",
		declined: false,
		asserted: { raw: false, strip: false, "strip+neg": false },
	},
];
const shapeTally = [];
for (const c of CASES) {
	assert.equal(declinedText(c.text), c.declined, `${c.name}: decline half wrong`);
	for (const arm of ARMS) {
		const hits = assertedTokens(c.text, { arm });
		assert.equal(
			hits.length > 0,
			c.asserted[arm],
			`${c.name} under arm ${arm}: expected asserted=${c.asserted[arm]}, got tokens ${JSON.stringify(hits)}`,
		);
		shapeTally.push(`${c.name}/${arm}:${hits.length > 0 ? "ASSERT" : "clean"}`);
	}
}

// ---------------------------------------------------------------- 3. end-to-end through the REAL scorer
// gate.mjs has no import guard, so the only hermetic way to reach scoreClean is its own re-score mode.
{
	const fixture = path.join(HERE, "fixtures", "gate-clean-scorer-transcript.json");
	const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "durig-5027-"));
	try {
		execFileSync(
			process.execPath,
			[
				path.join("tools", "model-probes", "gate.mjs"),
				"fixture://no-network",
				"fixture-no-prompt",
				"5027-fixture",
				"--rescore",
				fixture,
				"--out",
				path.join(tmp, "rescored"),
			],
			{
				cwd: ROOT,
				stdio: "pipe",
			},
		);
	} catch (err) {
		assert.fail(
			`gate.mjs --rescore on the fixture failed: ${String(err?.stderr ?? err).slice(0, 400)}`,
		);
	}
	const scored = JSON.parse(fs.readFileSync(path.join(tmp, "rescored.rescored.json"), "utf8"));
	fs.rmSync(tmp, { recursive: true, force: true });
	assert.equal(
		scored.scorerArm,
		"strip+neg",
		"the transcript must record which arm produced its verdicts",
	);
	const verdicts = scored.run.map((r) => `${r.cond}:${r.score?.verdict ?? "UNJUDGED"}`);
	assert.deepEqual(
		verdicts,
		[
			"clean-neutral:CLEAN-PASSED", // canonical decline: reachable at last
			"clean-neutral:FALSE-ALARM", // decline + real assertion: NOT rescued
			"clean-neutral:FALSE-ALARM", // assertion only: NOT rescued
			"clean-neutral:TRUNCATED-EMPTY", // an empty answer is never credited as a pass
		],
		`the shipped scorer judged the four fixture shapes as: ${JSON.stringify(verdicts)}`,
	);
	// the audit trail: the FALSE-ALARMs must say WHICH tokens asserted them
	const assertedTurns = scored.run.filter((r) => r.score?.verdict === "FALSE-ALARM");
	for (const r of assertedTurns)
		assert.ok(
			Array.isArray(r.score.assertionTokens) && r.score.assertionTokens.length,
			`FALSE-ALARM ${r.id} carries no assertionTokens — the verdict is unauditable`,
		);
}

// ---------------------------------------------------------------- 4. class locks
{
	const gate = fs.readFileSync(path.join(ROOT, "tools", "model-probes", "gate.mjs"), "utf8");
	assert.ok(
		!/const DECLINE = \[/.test(gate) && !/const ASSERT = \[/.test(gate),
		"gate.mjs must not redeclare DECLINE/ASSERT: two copies of the lists is how the subsumption went unnoticed for 24 runs",
	);
	assert.ok(
		/from "\.\/assertscan\.mjs"/.test(gate),
		"gate.mjs must ask the module, so the probe and this demo cannot drift",
	);
	// no control here may read machine residue: the transcripts are gitignored, and a demo that depended on them
	// would be green on one machine and red in every scratch worktree (the #4996 failure mode, twice)
	const self = fs.readFileSync(fileURLToPath(import.meta.url), "utf8");
	const RESIDUE = [".", "spi", "ke"].join(""); // spelled out so this lock's own text cannot trip it
	assert.ok(
		!self.includes(RESIDUE + "/"),
		"this demo must not read the scratch directory; the fixture lives in demo/fixtures",
	);
	assert.ok(
		NEGATION_WINDOW > 0 && NEGATORS.length >= 6,
		"occurrence negation needs a window and a negator set",
	);
	// the lists must stay disjoint-by-construction: nothing may claim they are
	const overlap = DECLINE.filter((d) => ASSERT.some((a) => d.includes(a)));
	assert.ok(
		overlap.length >= 5,
		`the fixture's premise is that DECLINE and ASSERT overlap; found only ${overlap.length} — if the lists changed, this demo and its numbers need re-measuring, not editing`,
	);
}

console.log(
	`GATE CLEAN-SCORER PASS (arms ${ARMS.join("|")}; default ${scorerArm({})}; ${CASES.length} shapes × ${ARMS.length} arms pinned: ${shapeTally.join(" ")}; end-to-end verdicts CLEAN-PASSED/FALSE-ALARM/FALSE-ALARM/TRUNCATED-EMPTY; ${DECLINE.filter((d) => ASSERT.some((a) => d.includes(a))).length} DECLINE phrases contain an ASSERT substring)`,
);
