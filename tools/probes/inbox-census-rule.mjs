#!/usr/bin/env node
/*
 * inbox-census-rule.mjs — the gate for wiring the stranded-inbox census into `check` (#6294 -> #6392).
 *
   The census tool exists; `check` never calls it. That is the whole gap, and it is testable without
   a store: `auditRig` already takes resolved inputs from the caller (`citations`, `sharedTreeBranch`)
   and never opens a store itself. So the rule's contract is a PARAMETER, and this probe passes one.

   Four things a census rule can get wrong, each asserted here:
     A  it does not fire at all (an instrument nobody runs);
     B  it fires on a fresh broker with nothing in the spool (a rule that cries on a clean start is
        a rule people mute);
     C  it reports the broker's own tallies instead of the spool FILES - the counters are the numbers
        that lie, and a census that reads them is diagnosing its own source;
     D  it cannot tell "the sink is unusable" (inbox/.error is a FILE, not a directory) from "the
        drain left residue", because those need different remedies.

   Run: node tools/probes/inbox-census-rule.mjs   (exit 1 while the rule is missing)
*/
import { auditRig } from "../../src/checkup.mjs";

const minimalRig = { rig: { seats: [{ name: "impl" }] }, spec: { edges: [] }, stored: null, queueItems: [] };
const finding = (out, kind) => (out.findings ?? []).find((f) => f.type === kind || f.kind === kind || f.id === kind);

const rows = [];
const check = (label, ok, detail = "") => rows.push({ label, ok, detail });

// A: the pathological spool the rig actually sat on: 9 intents, 0 results, last pass 6.3 hours ago.
const pathological = {
  inboxCount: 9, errorCount: 0, resultCount: 0, stuckSink: false,
  oldestAgeS: 22731, lastPassAt: "2026-11-10T16:00:00.000Z", brokerResident: true, exitResidue: null,
};
const outA = auditRig({ ...minimalRig, inboxCensus: pathological });
const fA = finding(outA, "stranded-inbox");
const ruleExists = Boolean(fA);
check("A the census produces a finding when the spool has 9 stranded intents and no results", ruleExists,
	fA ? fA.why : `no stranded-inbox finding; findings present: ${(outA.findings ?? []).map((f) => f.type ?? f.id).join(", ") || "none"}`);
if (fA) {
	check("A the finding names the COUNT, not a feeling", String(fA.subject ?? fA.detail ?? "").includes("9"), fA.subject ?? fA.detail ?? "");
	check("A the finding carries a remedy", Boolean(fA.remedy ?? fA.fix), JSON.stringify(fA));
}

// B: a fresh broker - nothing ran yet, nothing in the spool. A finding here teaches people to mute
//    the rule. NOTE: this guard is only meaningful once the rule exists; an absent rule trivially
//    "passes" every negative assertion, so it is scored as a failure until A is green.
const fresh = {
  inboxCount: 0, errorCount: 0, resultCount: 0, stuckSink: false,
  oldestAgeS: null, lastPassAt: null, brokerResident: true, exitResidue: null,
};
const outB = auditRig({ ...minimalRig, inboxCensus: fresh });
check("B a fresh, empty spool is not a finding", ruleExists && !finding(outB, "stranded-inbox"),
	finding(outB, "stranded-inbox")?.why ?? (ruleExists ? "" : "the rule does not exist yet, so this guard is untested"));

// C: the broker says it swept everything; the files say otherwise. The census must read the files.
const lyingCounters = {
  inboxCount: 4, errorCount: 0, resultCount: 0, stuckSink: false,
  oldestAgeS: 3600, lastPassAt: "2026-11-10T22:00:00.000Z", brokerResident: true, exitResidue: null,
  brokerCounters: { swept: 99, drained: 99, stranded: 0 },
};
const outC = auditRig({ ...minimalRig, inboxCensus: lyingCounters });
const fC = finding(outC, "stranded-inbox");
check("C the finding counts the files (4), not the broker's tally (0 stranded)", Boolean(fC) && String(fC.subject ?? fC.detail ?? "").includes("4"),
	fC ? fC.subject ?? fC.detail ?? "" : "no finding at all");

// D: a stuck sink - the dead-letter path is a FILE, so nothing can be written to it.
const stuckSink = {
  inboxCount: 3, errorCount: 0, resultCount: 0, stuckSink: true,
  oldestAgeS: null, lastPassAt: "2026-11-10T22:50:00.000Z", brokerResident: true, exitResidue: null,
};
const outD = auditRig({ ...minimalRig, inboxCensus: stuckSink });
check("D an unusable dead-letter sink is reported, and reported as the CAUSE (not just a count)",
	Boolean(finding(outD, "dead-letter-sink-unusable")),
	(outD.findings ?? []).map((f) => f.type ?? f.id).join(", ") || "no findings");

// E: a healthy broker with an intent in flight between passes. A rule that fires on any non-empty
//    spool cries on normal operation, and a crying rule gets muted - which is worse than no rule.
const inFlight = {
  inboxCount: 1, errorCount: 0, resultCount: 0, stuckSink: false,
  oldestAgeS: 3, lastPassAt: "2026-11-10T22:59:57.000Z", brokerResident: true, exitResidue: null,
};
const outE = auditRig({ ...minimalRig, inboxCensus: inFlight });
check("E an intent 3 seconds old with a pass 3 seconds ago is not a finding", ruleExists && !finding(outE, "stranded-inbox"),
	finding(outE, "stranded-inbox")?.why ?? (ruleExists ? "" : "the rule does not exist yet, so this guard is untested"));

for (const r of rows) console.log(`  ${r.ok ? "PASS" : "FAIL"}  ${r.label}${r.ok ? "" : `  -- ${r.detail}`}`);
const failures = rows.filter((r) => !r.ok).length;
console.log(`${rows.length} assertions; ${failures} measured failure(s).`);
process.exit(failures ? 1 : 0);
