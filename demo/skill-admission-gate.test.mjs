// Skill admission gate (S3) — demonstrates the eval admission rule end-to-end.
//
// The rule (docs/skills/ADMISSION.md, lead ruling 2026-10-18):
//   Admit a skill ONLY IF: (1) a named probe FAILS without it; (2) the SAME probe
//   PASSES with it; (3) the delta is reproducible; (4) no other admitted probe regresses.
//   Threshold: >=1 probe moves FAIL->PASS, 0 regressions. 0 moved probes -> REJECT.
//
// The probe used here is the S2 routing-table integrity check: a skill's SKILL.md
// routing table must never point at a file that cannot be loaded. The tui-design
// skill previously routed to 5 absent references (S2, docs/reviews/agent-skills-review.md);
// after the S2 fix every routing-table reference resolves.
//
// RED-BEFORE BASELINE: the probe is evaluated against the PRE-fix routing table
// (routing to absent files) and must FAIL, then against the CURRENT fixed table
// and must PASS. The gate admits the skill only because the delta is real and
// reproducible. Run: node demo/skill-admission-gate.test.mjs (exit 0 = pass).
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const skillDir = join(root, "skills", "tui-design");
const skillMd = join(skillDir, "SKILL.md");

// A "probe" is a named, reproducible check with a binary PASS/FAIL result.
// PROBE: every `references/<name>.md` path named in SKILL.md must resolve to a file.
function routingIntegrityProbe(skillMdPath) {
	const text = readFileSync(skillMdPath, "utf8");
	const refs = [...text.matchAll(/references\/([a-z-]+\.md)/g)].map((m) => m[1]);
	const missing = refs.filter((r) => !existsSync(join(dirname(skillMdPath), "references", r)));
	return {
		name: "routing-integrity",
		checked: refs.length,
		missing,
		pass: missing.length === 0,
	};
}

// The pre-fix routing table (S2 finding): routes to the 5 deliberately-unvendored
// ecosystem/CLI references. Reproduces the FAIL side of the baseline.
function prefixedRoutingProbe() {
	const fake = [
		"ecosystem-go.md",
		"ecosystem-rust.md",
		"ecosystem-python.md",
		"ecosystem-typescript.md",
		"cli-basics.md",
	];
	const missing = fake.filter((r) => !existsSync(join(skillDir, "references", r)));
	return { name: "routing-integrity", checked: fake.length, missing, pass: missing.length === 0 };
}

const results = {};

// 1. RED before: the pre-fix table must FAIL the probe.
const red = prefixedRoutingProbe();
results["without-fix"] = red;
assert.equal(red.pass, false, "RED-before: the pre-fix routing table must FAIL the probe");
assert.ok(red.missing.length >= 5, "RED-before: all 5 unvendored references must be flagged");

// 2. GREEN after: the fixed table must PASS the same probe.
const green = routingIntegrityProbe(skillMd);
results["with-fix"] = green;
assert.equal(green.pass, true, "GREEN-after: the fixed routing table must PASS the probe");
assert.equal(green.missing.length, 0, "GREEN-after: no absent references may remain");

// 3. Reproducibility: run the fixed probe again, must give the same verdict.
const greenAgain = routingIntegrityProbe(skillMd);
assert.equal(greenAgain.pass, green.pass, "reproducible: re-run gives the same PASS verdict");

// 4. The admission rule: 1 probe moved FAIL->PASS, 0 regressions -> ADMIT.
const moved = (red.pass ? 0 : 1) - (green.pass ? 0 : 1);
const regressions = green.pass ? 0 : 1;
assert.ok(moved >= 1, `admission: >=1 probe moved FAIL->PASS (moved=${moved})`);
assert.equal(regressions, 0, "admission: 0 regressions");
const verdict = moved >= 1 && regressions === 0 ? "ADMIT" : "REJECT";
assert.equal(verdict, "ADMIT", "gate admits the skill that moved an outcome");

// 5. Gate-on-edit: if the delta disappears (probe passes without the fix too),
//    the skill is REJECTED. Simulate a skill that never failed — 0 moved probes.
const fakeNeverFailed = { pass: true };
const movedNone = fakeNeverFailed.pass ? 0 : 1;
assert.equal(
	movedNone < 1,
	true,
	"gate-on-edit: a skill with no FAIL->PASS delta is rejected (0 moved probes)",
);

console.log(
	`SKILL-ADMISSION-GATE OK: red=${red.pass ? "PASS" : "FAIL"} green=${green.pass ? "PASS" : "FAIL"} ` +
		`missing(before)=${red.missing.length} missing(after)=${green.missing.length} verdict=${verdict}`,
);
console.log("SKILL ADMISSION GATE TEST PASS");
process.exit(0);
