// Canonical skill-root mirror check (S4) — the enforced check that keeps
// `skills/` a byte-identical mirror of `.agents/skills/` whenever a mirror is kept.
//
// Lead ruling (2026-10-18): `.agents/skills/` is the canonical root (the pi runtime
// loads it, so it is the single source of truth). `skills/` is NOT a second source
// of truth: keep it ONLY as a mirror while something references it, and a kept mirror
// MUST be byte-identical to `.agents/skills/` — enforced by this check. If nothing
// references a `skills/` entry, remove it.
//
// The check is structural, not name-hardcoded: for every skill name present in BOTH
// roots, the SKILL.md bodies must be byte-identical. It does not decide WHICH mirror
// to keep or whether to remove a `skills/` entry — those are the S1/D103 sequencing
// (canonical `.agents/skills/driving-durian-pi` and `delegating-to-durian-pi` per the
// ruling). It only catches drift when a mirror IS kept.
//
// Run: node demo/skill-mirror-check.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRoot = join(root, ".agents", "skills");
const mirrorRoot = join(root, "skills");

function listSkills(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
		.map((d) => d.name)
		.filter((n) => n !== "tui-design"); // tui-design is documented as single-copy (S2/S8)
}

const canonical = listSkills(canonicalRoot);
const mirror = listSkills(mirrorRoot);

// S1 (#2356) has LANDED: the two `durig` skills are now the distinct, uniquely-named
// `.agents/skills/driving-durian-pi` and `.agents/skills/delegating-to-durian-pi`, and the
// `skills/durig` duplicate is gone. The pre-S1 `durig` exclusion is therefore removed, so this
// check now applies to EVERY overlapping name.
// For every skill name that appears in BOTH roots, the bodies must be byte-identical.
const overlapping = canonical.filter((n) => mirror.includes(n));
const failures = [];

for (const name of overlapping) {
	const a = readFileSync(join(canonicalRoot, name, "SKILL.md"));
	const b = readFileSync(join(mirrorRoot, name, "SKILL.md"));
	if (!a.equals(b)) {
		failures.push(name);
	}
}

assert.equal(
	failures.length,
	0,
	`mirror drift: skills/ must be byte-identical to .agents/skills/ for overlapping entries — drifted: ${failures.join(", ")}`,
);

// Rule documentation: a hand-maintained duplicate without this check is forbidden.
assert.ok(
	existsSync(join(root, "docs", "skills", "ADMISSION.md")),
	"S4 rule documented in docs/skills/ADMISSION.md",
);

console.log(
	`SKILL-MIRROR OK: canonical=${canonical.join(",") || "(none)"} mirror=${mirror.join(",") || "(none)"} ` +
		`overlapping=${overlapping.join(",") || "(none)"} drifted=0`,
);
console.log("SKILL MIRROR CHECK TEST PASS");
process.exit(0);
