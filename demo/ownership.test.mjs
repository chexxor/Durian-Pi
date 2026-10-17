// demo/ownership.test.mjs — prove the artifact-ownership rule (ROADMAP 46 / item #714).
//
// ROADMAP 46: a decision-rights / ownership grid not enforced by `check` is prose
// and goes stale. The rule reads an OPTIONAL rig-spec `ownership` block keyed to
// the docs-ownership artifact classes and fails when a class names an owner seat
// the rig does not declare. Advocate's #848 ruling fixes the three semantics this
// demo pins:
//   - "live" = NAMED IN THE RIG SPEC, not registered in the store (spec-vs-store
//     drift is store-missing-seat/stray-seat's job; keeping it spec-only keeps
//     checkup pure and the D25 skip-with-reason symmetry intact);
//   - block ABSENT => SKIPPED with a stated reason (a bare rig is legitimately
//     silent about ownership), never a silent pass;
//   - block PRESENT => every owner seat must be declared, else an ERROR naming the
//     seat(s) and class(es).
// Run: node demo/ownership.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { auditRig } from "../src/checkup.mjs";

const durigDir = join(dirname(fileURLToPath(import.meta.url)), "..");

const SPEC = {
	version: 2,
	seats: [
		{ name: "alpha", role: "Implementer (author)", capabilities: ["implement", "code"], model: "faux/a" },
		{ name: "verifier", role: "Independent verifier", capabilities: ["verify"], model: "faux/b" },
	],
	edges: [
		{ from: "alpha", maySendTo: ["verifier"] },
		{ from: "verifier", maySendTo: ["alpha"] },
	],
	constitutionInline: "# constitution\n",
};

/** A rig audit with the given ownership block (undefined = no block at all). */
const audit = (ownership) =>
	auditRig({
		rig: "rig.json",
		spec: ownership === undefined ? { ...SPEC } : { ...SPEC, ownership },
		specConstitution: SPEC.constitutionInline,
		stored: { reason: "read", text: SPEC.constitutionInline },
		storedSeats: ["alpha", "verifier"],
		modelsBySeat: { alpha: "faux/a", verifier: "faux/b" },
	});
const has = (r, id) => (r.findings ?? []).some((f) => f.id === id);
const status = (r, id) => (r.checks ?? []).find((c) => c.id === id)?.status;
const why = (r, id) => (r.checks ?? []).find((c) => c.id === id)?.why;

/* 1. a ghost owner seat FAILS, naming the seat AND the class */
const ghost = audit({ "src-tools-harness": ["alpha", "ghost"], verification: ["verifier"] });
assert.ok(has(ghost, "ownership-seat-missing"), "a class naming an undeclared seat fails");
const finding = ghost.findings.find((f) => f.id === "ownership-seat-missing");
assert.equal(finding.severity, "error", "an undeclared owner seat is an error");
assert.match(finding.subject, /ghost \(class src-tools-harness\)/, "the subject names the seat and the class");
assert.equal(status(ghost, "ownership-seat-missing"), "fail");
console.log("  ok   ghost owner seat FAILS, naming seat + class");

/* 2. a valid block PASSES */
const good = audit({ "src-tools-harness": ["alpha"], verification: ["verifier"] });
assert.ok(!has(good, "ownership-seat-missing"), "every declared owner passes");
assert.equal(status(good, "ownership-seat-missing"), "pass");
console.log("  ok   a valid block PASSES");

/* 3. no block => SKIPPED with a stated reason (never a silent pass) */
const none = audit(undefined);
assert.equal(status(none, "ownership-seat-missing"), "skipped", "an absent block is skipped");
assert.ok(why(none, "ownership-seat-missing"), "and states why");
assert.ok(!has(none, "ownership-seat-missing"), "and reports no finding it cannot ground");
console.log("  ok   no block => SKIPPED with a reason");

/* 4. a malformed block is an error, not a crash */
const malformed = audit("alpha");
assert.ok(has(malformed, "ownership-seat-missing"), "a non-object block is reported, not swallowed");
console.log("  ok   a malformed block is reported");

/* 5. the CURRENT rig passes: every owner in rig.selfdev.json is a declared seat */
const selfdev = JSON.parse(readFileSync(join(durigDir, "rig.selfdev.json"), "utf8"));
assert.ok(selfdev.ownership && typeof selfdev.ownership === "object", "rig.selfdev.json carries an ownership block");
const declared = new Set(selfdev.seats.map((s) => s.name));
const owners = Object.values(selfdev.ownership).flat();
assert.ok(owners.length >= 5, "the docs-ownership classes are all present");
for (const owner of owners) assert.ok(declared.has(owner), `owner "${owner}" is a declared seat in rig.selfdev.json`);
const selfdevAudit = auditRig({
	rig: "rig.selfdev.json",
	spec: { seats: selfdev.seats.map((s) => ({ name: s.name, role: s.role, capabilities: s.capabilities })), edges: selfdev.edges, ownership: selfdev.ownership },
	specConstitution: undefined,
	stored: { reason: "absent" },
	modelsBySeat: {},
});
assert.equal(status(selfdevAudit, "ownership-seat-missing"), "pass", "the current rig passes the ownership rule");
console.log("  ok   the current rig (rig.selfdev.json) passes");

console.log("\nOWNERSHIP TEST PASS (ghost fails, valid passes, absent skipped, malformed reported, current rig passes)");
