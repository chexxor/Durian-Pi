// demo/skill-names.test.mjs — S1: one name per skill, and the canonical skill names are
// `driving-durian-pi` (CLI) and `delegating-to-durian-pi` (external delegate).
//
// D103 renames the product `durig` -> `durian-pi`; the W3/#2260 lead ruling fixes the S1 skill
// NAMES (`skills/durig/` and `.agents/skills/durig/` must not both stay `durig`). A skill is
// loaded BY NAME, so two skills claiming `durig` make the loaded skill ambiguous. The rename gives
// each skill a unique name that matches its directory, both canonical in `.agents/skills/`.
//
// Failing-first: before the rename the two skills were both `name: durig` and lived in
// `skills/durig/` + `.agents/skills/durig/` (RED).
// Run: node demo/skill-names.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const canonicalRoot = join(root, ".agents", "skills");
const mirrorRoot = join(root, "skills");

/** Every skill dir (a directory holding SKILL.md) under `dir`. */
function listSkills(dir) {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
		.map((d) => d.name);
}

/** The `name:` frontmatter field of a skill. */
function skillName(dir, entry) {
	const text = readFileSync(join(dir, entry, "SKILL.md"), "utf8");
	const m = /^name:\s*(.+)$/m.exec(text);
	return m ? m[1].trim() : null;
}

const canonical = listSkills(canonicalRoot);
const mirror = listSkills(mirrorRoot);

// (1) The two S1 names exist in the CANONICAL root, and the frontmatter matches the directory.
for (const name of ["driving-durian-pi", "delegating-to-durian-pi"]) {
	assert.ok(canonical.includes(name), `canonical skill \`${name}\` exists in .agents/skills/`);
	assert.equal(skillName(canonicalRoot, name), name, `${name}/SKILL.md frontmatter name matches its directory`);
}
// The CLI skill MOVED to the canonical root; no `durig` skill remains anywhere.
assert.ok(!canonical.includes("durig"), "no canonical skill is still named `durig`");
assert.ok(!mirror.includes("durig"), "no `skills/durig` mirror remains");
assert.ok(!existsSync(join(root, "skills", "durig")), "skills/durig/ is gone");

// (2) S1: one name may name only one skill — across BOTH roots.
const byName = new Map();
for (const dir of [canonicalRoot, mirrorRoot]) {
	for (const entry of listSkills(dir)) {
		const name = skillName(dir, entry);
		assert.ok(name, `${entry}/SKILL.md carries a name`);
		assert.equal(name, entry, `skill name matches its directory (${entry} -> ${name})`);
		assert.ok(!byName.has(name), `name \`${name}\` is claimed by only one skill (also ${byName.get(name)})`);
		byName.set(name, join(dir, entry));
	}
}

console.log(
	`SKILL-NAMES OK: canonical=${canonical.join(",") || "(none)"} mirror=${mirror.join(",") || "(none)"} ` +
		`unique=${[...byName.keys()].join(",")}`,
);
console.log("SKILL NAMES TEST PASS");
process.exit(0);
