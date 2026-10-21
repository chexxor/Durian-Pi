// demo/runbook-rules.test.mjs — ROADMAP 81a: the runbook check rules.
//
// `check` now judges docs/runbooks/* health: `runbook-unverified` (fix-now) when a
// runbook's Verify step has never run, and `runbook-stale` (error) when it was verified
// before a file it NAMES changed. auditRig stays PURE — the caller reads the files and
// passes plain data — so this test drives it with CRAFTED runbook data and no store.
//
// FAILING-FIRST: before the rules existed, `runbook-stale`/`runbook-unverified` were not
// in RULES and auditRig ignored runbook data, so the assertions here fail.
//
// Run: node demo/runbook-rules.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import { RULES, auditRig, formatCheck } from "../src/checkup.mjs";

// A rig whose OTHER rules all pass, so any finding below is a runbook finding.
const spec = {
	seats: [
		{ name: "alpha", role: "author", capabilities: ["implement"] },
		{ name: "verifier", role: "independent verifier", capabilities: ["verify"] },
	],
	edges: [
		{ from: "alpha", maySendTo: ["verifier"] },
		{ from: "verifier", maySendTo: ["alpha"] },
	],
};
const CONSTITUTION = "shared norms";
const base = {
	rig: "rig.json",
	spec,
	specConstitution: CONSTITUTION,
	stored: { reason: "read", text: CONSTITUTION },
	storedSeats: ["alpha", "verifier"],
	modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
};
const audit = (runbooks) => auditRig({ ...base, runbooks });
const ids = (r) => r.findings.map((f) => f.id);

// A COMPLETE front-matter block (ROADMAP 82 enforces the mandatory keys), so these
// fixtures exercise the stale/unverified rules rather than the conformity rule; each
// fixture's `runbook:` mirrors its filename stem, which conformity also requires.
const fm = (over = {}) => ({
	runbook: "ok",
	symptom: "something is wrong",
	writes: false,
	precondition: "read-only",
	last_verified: "2026-10-16",
	verified_by: "impl",
	evidence: "demo/runbook-rules.test.mjs",
	check_rule: null,
	...over,
});

// The two rules exist with the ROADMAP-81 severities.
const byId = new Map(RULES.map((r) => [r.id, r]));
assert.equal(byId.get("runbook-stale")?.severity, "error", "runbook-stale is an error");
assert.equal(byId.get("runbook-unverified")?.severity, "fix-now", "runbook-unverified is fix-now");

// 1. A STALE runbook: verified, but a file it names changed since -> error, fails check.
const stale = audit([
	{
		file: "docs/runbooks/broker-safe-change.md",
		frontMatter: fm({ runbook: "broker-safe-change", last_verified: "2026-01-01" }),
		changedNamedFiles: ["src/broker.mjs"],
	},
]);
assert.ok(ids(stale).includes("runbook-stale"), `stale runbook reported; got ${ids(stale).join(", ")}`);
const staleFinding = stale.findings.find((f) => f.id === "runbook-stale");
assert.equal(staleFinding.severity, "error");
assert.match(staleFinding.detail, /src\/broker\.mjs/, "the finding names the changed file");
assert.equal(stale.summary.error, 1, "the stale runbook is the only error");
assert.equal(stale.pass, false, "an error finding fails the audit");
assert.equal(stale.exitCode, 1);

// 2. An UNVERIFIED runbook: Verify never ran -> fix-now, does NOT fail a run.
const unverified = audit([
	{ file: "docs/runbooks/new.md", frontMatter: fm({ runbook: "new", last_verified: "unverified" }), changedNamedFiles: [] },
]);
assert.ok(ids(unverified).includes("runbook-unverified"), `unverified runbook reported; got ${ids(unverified).join(", ")}`);
assert.equal(unverified.findings.find((f) => f.id === "runbook-unverified").severity, "fix-now");
assert.equal(unverified.summary.error, 0, "fix-now never adds an error");
assert.equal(unverified.pass, true, "a fix-now finding never fails a run");
assert.equal(unverified.exitCode, 0);
// an absent last_verified is also "never ran"
const missing = audit([{ file: "docs/runbooks/no-front-matter.md", frontMatter: null }]);
assert.ok(ids(missing).includes("runbook-unverified"), "an absent last_verified is treated as never-run");

// 3. A HEALTHY runbook: verified, nothing it names changed -> no finding.
const healthy = audit([{ file: "docs/runbooks/ok.md", frontMatter: fm(), changedNamedFiles: [] }]);
assert.deepEqual(ids(healthy), [], `a healthy runbook has no findings; got ${ids(healthy).join(", ")}`);
assert.ok(
	healthy.checks.filter((c) => c.id.startsWith("runbook-")).every((c) => c.status === "pass"),
	"every runbook rule passes on a healthy runbook",
);

// 4. A MIXED set: the healthy one is silent, the other two are reported once each.
const mixed = audit([
	{ file: "docs/runbooks/ok.md", frontMatter: fm(), changedNamedFiles: [] },
	{
		file: "docs/runbooks/stale.md",
		frontMatter: fm({ runbook: "stale", last_verified: "2026-01-01" }),
		changedNamedFiles: ["src/a.mjs", "src/b.mjs"],
	},
	{
		file: "docs/runbooks/unverified.md",
		frontMatter: fm({ runbook: "unverified", last_verified: "unverified" }),
		changedNamedFiles: [],
	},
]);
assert.equal(mixed.summary.error, 1, "one stale error");
assert.equal(mixed.summary["fix-now"], 1, "one unverified fix-now");
assert.ok(!mixed.findings.some((f) => f.subject === "docs/runbooks/ok.md"), "the healthy runbook is not reported");

// 5. Legible silence: no runbook data supplied -> both rules SKIPPED with a reason, never a false pass.
const none = audit(undefined);
const noneChecks = new Map(none.checks.map((c) => [c.id, c]));
assert.equal(noneChecks.get("runbook-stale").status, "skipped", "runbook-stale is skipped without data");
assert.equal(noneChecks.get("runbook-unverified").status, "skipped", "runbook-unverified is skipped without data");
assert.ok(noneChecks.get("runbook-stale").why, "the skip says why");
assert.equal(none.summary.error, 0, "no false error without data");

// 6. An explicitly EMPTY runbook set is a PASS (the caller read the dir and found none).
const empty = audit([]);
assert.ok(
	empty.checks.filter((c) => c.id.startsWith("runbook-")).every((c) => c.status === "pass"),
	"an empty runbook set passes",
);
assert.deepEqual(ids(empty), []);

// 7. The human render shows the runbook findings with their severities.
const rendered = formatCheck(mixed, { rigDisplay: "rig.json", color: false, seats: 2, storeReason: "read" });
assert.match(rendered, /runbook-stale/, "the render names runbook-stale");
assert.match(rendered, /runbook-unverified/, "the render names runbook-unverified");

console.log("RUNBOOK RULES TEST PASS (stale=error, unverified=fix-now, healthy silent, legible silence)");
process.exit(0);
