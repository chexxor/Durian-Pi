// demo/runbook-frontmatter.test.mjs — ROADMAP 82: mandatory runbook front-matter +
// `_template.md` conformity, enforced by a `check` rule (`runbook-front-matter`).
//
// docs/runbooks/README.md makes the header block mandatory ("so a seat, a human, or a
// `check` rule can retrieve it and refuse on a mismatch before reading the body") and
// `_template.md` fixes the skeleton. Before this rule, a runbook with no header (or a
// header missing `precondition`) was indistinguishable from a conformant one: nothing
// read the block, so nothing could refuse. This test drives `auditRig` — which stays
// PURE, taking the caller's plain data (ROADMAP 81a's input surface) — with CRAFTED
// runbook data and no store.
//
// FAILING-FIRST: before the rule existed, `runbook-front-matter` was not in RULES and
// auditRig ignored the header's keys, so the assertions here fail.
//
// Run: node demo/runbook-frontmatter.test.mjs  (exit 0 = pass)

import assert from "node:assert/strict";

import {
	RULES,
	RUNBOOK_FRONT_MATTER_KEYS,
	RUNBOOK_PRECONDITIONS,
	RUNBOOK_TEMPLATE_SECTIONS,
	auditRig,
	runbookFrontMatterProblems,
} from "../src/checkup.mjs";

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

// A COMPLETE front-matter block, mirroring docs/runbooks/_template.md.
const fm = (over = {}) => ({
	runbook: "ok",
	symptom: "something is wrong",
	writes: false,
	precondition: "read-only",
	last_verified: "2026-10-16",
	verified_by: "impl",
	evidence: "demo/runbook-frontmatter.test.mjs",
	check_rule: null,
	...over,
});

// A body carrying the fixed skeleton, so the section half is judged too.
const body = RUNBOOK_TEMPLATE_SECTIONS.map((h) => `## ${h}\n<text>`).join("\n\n");
const ok = (over = {}) => ({ file: "docs/runbooks/ok.md", frontMatter: fm(over), body, changedNamedFiles: [] });

/* ---------------------------------- the rule exists --------------------------------- */

const byId = new Map(RULES.map((r) => [r.id, r]));
assert.ok(byId.has("runbook-front-matter"), "the runbook-front-matter rule exists");
assert.equal(
	byId.get("runbook-front-matter").severity,
	"fix-now",
	"a malformed header is fix-now: the procedure is unreadable, not wrong (unlike runbook-stale, an error)",
);

/* ------------------- a CONFORMANT runbook is silent (no false positive) ------------------- */

const clean = audit([ok()]);
assert.deepEqual(ids(clean), [], `a conformant runbook has no findings; got ${ids(clean).join(", ")}`);
assert.equal(
	clean.checks.find((c) => c.id === "runbook-front-matter").status,
	"pass",
	"the rule passes on a conformant runbook",
);

/* ---------------------------- the header block is mandatory ---------------------------- */

const noBlock = audit([{ file: "docs/runbooks/bare.md", frontMatter: null, changedNamedFiles: [] }]);
assert.ok(ids(noBlock).includes("runbook-front-matter"), "a runbook with no header block is reported");
assert.match(
	noBlock.findings.find((f) => f.id === "runbook-front-matter").detail,
	/no front-matter block/,
	"the finding says the block is missing",
);

const missingKey = audit([{ file: "docs/runbooks/ok.md", frontMatter: fm({ precondition: undefined }), changedNamedFiles: [] }]);
const missingKeyFinding = missingKey.findings.find((f) => f.id === "runbook-front-matter");
assert.ok(missingKeyFinding, "a missing mandatory key is reported");
assert.match(missingKeyFinding.detail, /missing key `precondition`/, "the finding names the missing key");

/* ------------------------------ malformed values are named ------------------------------ */

const malformed = runbookFrontMatterProblems({
	file: "docs/runbooks/ok.md",
	frontMatter: fm({ runbook: "not-the-stem", writes: "yes", precondition: "sometimes", last_verified: "soon" }),
});
assert.ok(malformed.some((p) => /does not mirror the filename stem/.test(p)), `stem mismatch reported; got ${malformed.join(" | ")}`);
assert.ok(malformed.some((p) => /writes: must be true or false/.test(p)), "a non-boolean writes is reported");
assert.ok(malformed.some((p) => /precondition: must be one of/.test(p)), "an illegal precondition is reported");
assert.ok(malformed.some((p) => /last_verified: must be a YYYY-MM-DD/.test(p)), "an unparseable last_verified is reported");
assert.equal(malformed.length, 4, `exactly the four defects are reported; got ${malformed.length}`);

// The legal precondition set and the mandatory key set are the README's, not invented here.
assert.deepEqual(RUNBOOK_PRECONDITIONS, ["broker-stopped", "read-only", "none"], "the precondition vocabulary");
assert.ok(RUNBOOK_FRONT_MATTER_KEYS.includes("check_rule"), "check_rule is a mandatory KEY (its value may be null)");
assert.ok(
	!runbookFrontMatterProblems({ file: "docs/runbooks/ok.md", frontMatter: fm({ check_rule: null }) }).length,
	"check_rule: null conforms — the key is required, the value is optional",
);

/* ------------------------------- the skeleton is enforced ------------------------------- */

const noSection = audit([
	{ file: "docs/runbooks/ok.md", frontMatter: fm(), body: "## When to use\n<text>\n## Verify\n<text>", changedNamedFiles: [] },
]);
const sectionFinding = noSection.findings.find((f) => f.id === "runbook-front-matter");
assert.ok(sectionFinding, "a body missing skeleton sections is reported");
assert.match(sectionFinding.detail, /missing `## Impact` section/, "the finding names a missing section");

// A bare "Diagnose" heading conforms (the template's parenthetical is not the point).
assert.ok(
	!runbookFrontMatterProblems({
		file: "docs/runbooks/ok.md",
		frontMatter: fm(),
		body: RUNBOOK_TEMPLATE_SECTIONS.map((h) => `## ${h === "Diagnose (read-only)" ? "Diagnose" : h}\n<text>`).join("\n\n"),
	}).length,
	"a bare `## Diagnose` heading conforms",
);

// `_template.md` is EXEMPT: it carries placeholders by design.
assert.deepEqual(
	runbookFrontMatterProblems({ file: "docs/runbooks/_template.md", frontMatter: { runbook: "<filename-stem>" }, body: "## When to use" }),
	[],
	"_template.md is exempt from conformity",
);

/* ------------------- severity: a header defect never fails a run by itself ------------------- */

assert.equal(noBlock.summary.error, 0, "runbook-front-matter is fix-now, so it adds no error");
assert.equal(noBlock.pass, true, "a fix-now finding does not fail the audit");
assert.equal(noBlock.exitCode, 0, "…so `check` still exits 0");

/* ------------------------- legible silence: no data, no false pass ------------------------- */

const none = audit(undefined);
const noneCheck = none.checks.find((c) => c.id === "runbook-front-matter");
assert.equal(noneCheck.status, "skipped", "without runbook data the rule is SKIPPED, never a pass");
assert.ok(noneCheck.why, "the skip says why");

console.log(
	"RUNBOOK FRONT-MATTER TEST PASS (mandatory keys + stem mirror + value shapes + skeleton enforced; _template exempt; fix-now; skipped without data)",
);
process.exit(0);
