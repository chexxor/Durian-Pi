// demo/doc-count-drift.test.mjs — #6155: a doc may state a COUNT only of a set the code DECLARES,
// and the declaration wins.
//
// FAILING-FIRST. Before the rule existed, `RULES` had no counterpart in `docs/WORKFLOWS.md`, so
// `check` could not see that "eight rules" was 14 rules short of the declaration: the assertion
// `drifted.findings.some(f => f.id === "doc-count-drift")` below throws on the unfixed tree, and the
// real-doc assertion at the end is RED while WORKFLOWS.md still says "eight".
//
// The closed set of outcomes this pins: (a) a claim whose number matches → no finding; (b) a claim
// whose number disagrees → a fix-now finding naming both numbers; (c) a claim that is not a number →
// a finding, because nobody can re-check it; (d) no data supplied → UNKNOWN, never a false pass.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { auditRig, DECLARED_COUNTS, RULES } from "../src/checkup.mjs";
import { parseDocCountClaims, readDocCountClaims } from "../src/doccounts.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

const spec = () => ({
  seats: [
    { name: "alpha", instructions: "do things", capabilities: ["implement"] },
    { name: "verifier", instructions: "check things", capabilities: ["verify"] },
  ],
  edges: [{ from: "alpha", to: "verifier" }, { from: "verifier", to: "alpha" }],
  models: { alpha: "faux/model-a", verifier: "faux/model-b" },
});

const ids = (audit) => audit.findings.map((f) => f.id);
let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

// ─── 1. The reader sees the claim, and the numeral, whatever its spelling ───
const parsed = parseDocCountClaims(
  "Capability: `check` (eight rules) and `metrics` (six measures); also `check` (23 rules); also `check` (a few rules).",
  "docs/TEST.md",
);
check("every claim shape is extracted", parsed.length === 4, JSON.stringify(parsed.map((c) => [c.set, c.noun, c.claimed])));
check(
  "spelled numbers parse",
  parsed[0].claimed === 8 && parsed[1].claimed === 6,
  JSON.stringify(parsed.slice(0, 2)),
);
check("digits parse", parsed[2].claimed === 23, JSON.stringify(parsed[2]));
check("a non-number claim is claimed=null, not silently skipped", parsed[3].claimed === null, JSON.stringify(parsed[3]));
check("the line number is reported", parsed[0].line === 1 && parsed[3].line === 1, JSON.stringify(parsed.map((c) => c.line)));

// ─── 2. RED: the doc's number disagrees with the declaration ───
const drifted = auditRig({
  rig: "example.rig.json",
  spec: spec(),
  specConstitution: "the constitution",
  stored: { reason: "absent" },
  modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
  sharedTreeBranch: "main",
  docCounts: parseDocCountClaims("`check` (eight rules)", "docs/WORKFLOWS.md"),
});
check("a wrong count is a finding", ids(drifted).includes("doc-count-drift"), ids(drifted).join(", "));
check(
  "the finding names BOTH numbers and where the truth lives",
  drifted.findings.find((f) => f.id === "doc-count-drift")?.detail.includes("claims check has 8 rules") &&
    drifted.findings.find((f) => f.id === "doc-count-drift")?.detail.includes(String(RULES.length)),
  drifted.findings.find((f) => f.id === "doc-count-drift")?.detail,
);
check("the fix points at the declaration, not at the prose", drifted.findings.find((f) => f.id === "doc-count-drift")?.fix.includes("RULES"));
check("the rule is fix-now, so a drifted doc is reported but does not fail the rig", drifted.findings.find((f) => f.id === "doc-count-drift")?.severity === "fix-now");

// ─── 3. GREEN: the correct number, stated as a number ───
const clean = auditRig({
  rig: "example.rig.json",
  spec: spec(),
  specConstitution: "the constitution",
  stored: { reason: "absent" },
  modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
  sharedTreeBranch: "main",
  docCounts: parseDocCountClaims(`\`check\` (${RULES.length} rules), \`metrics\` (${DECLARED_COUNTS.measures} measures)`, "docs/WORKFLOWS.md"),
});
check("a matching count produces no finding", !ids(clean).includes("doc-count-drift"), ids(clean).join(", "));
check("the rule RUNS (pass) when the docs were read and nothing disagreed", clean.checks.find((c) => c.id === "doc-count-drift")?.status === "pass", JSON.stringify(clean.checks.find((c) => c.id === "doc-count-drift")));

// ─── 4. No data is not a pass: it is UNKNOWN ───
const noData = auditRig({
  rig: "example.rig.json",
  spec: spec(),
  specConstitution: "the constitution",
  stored: { reason: "absent" },
  modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
  sharedTreeBranch: "main",
});
check("a doc-count rule with no doc data reports UNKNOWN, not pass", noData.checks.find((c) => c.id === "doc-count-drift")?.status === "unknown", JSON.stringify(noData.checks.find((c) => c.id === "doc-count-drift")));

// ─── 5. A non-numeric claim is itself a defect ───
const vague = auditRig({
  rig: "example.rig.json",
  spec: spec(),
  specConstitution: "the constitution",
  stored: { reason: "absent" },
  modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
  sharedTreeBranch: "main",
  docCounts: parseDocCountClaims("`check` (a few rules)", "docs/WORKFLOWS.md"),
});
check("“a few rules” is reported, because nobody can re-check it", vague.findings.some((f) => f.id === "doc-count-drift" && f.detail.includes("not a number")));

// ─── 6. THE REAL DOCS: the recurrence gate ───
const realClaims = readDocCountClaims({ root: ROOT, dir: "docs" });
check("docs/ were read (null would mean the read failed)", Array.isArray(realClaims), `readDocCountClaims returned ${realClaims === null ? "null" : realClaims.length}`);
check(
  "every count this rig's docs state about a declared set matches the declaration",
  realClaims.every((c) => c.claimed === DECLARED_COUNTS[c.noun]),
  JSON.stringify(realClaims.filter((c) => c.claimed !== DECLARED_COUNTS[c.noun])),
);
check(
  "WORKFLOWS.md carries the derivable count, not a bare assertion",
  /RULES/.test(readFileSync(join(ROOT, "docs/WORKFLOWS.md"), "utf8").split("\n")[292] ?? ""),
  "line 293 does not name the declaring export",
);

// ─── 7. The report prints the declared counts, so the number is derivable at the point of use ───
const rendered = auditRig({
  rig: "example.rig.json",
  spec: spec(),
  specConstitution: "the constitution",
  stored: { reason: "absent" },
  modelsBySeat: { alpha: "faux/model-a", verifier: "faux/model-b" },
  sharedTreeBranch: "main",
  docCounts: realClaims,
});
const { formatCheck } = await import("../src/checkup.mjs");
const text = formatCheck(drifted, { rigDisplay: "example.rig.json", seats: 2, storeReason: "absent" });
check("the rendered report states what the code declares", text.includes(`${DECLARED_COUNTS.rules} rules (src/checkup.mjs RULES)`), text.split("\n")[2]);
check("and the drifted doc is visible in it", text.includes("doc-count-drift"));
check("the clean rig's render is finding-free for this rule", !formatCheck(clean, { seats: 2 }).includes("doc-count-drift"));

if (failures > 0) {
  console.log(`DOC-COUNT-DRIFT TEST FAIL (${failures} assertion(s) red)`);
  process.exit(1);
}
console.log(`DOC-COUNT-DRIFT TEST PASS (${RULES.length} rules declared, ${DECLARED_COUNTS.measures} measures, ${realClaims.length} doc claims read, all consistent)`);
