#!/usr/bin/env node
/*
 * gate-verb-decomposition-gaps.mjs — what pm's #6473 decomposition (#6508-#6515) does NOT cover.

 Question: `gate_work` is being minted as a verb that ADDS a gate to an existing row. Every verb that
 changes a gate changes workability. The predicate that reads it is `workable()` (src/rig.mjs:319) -
 the SAME predicate claim selection and wake selection use (#2673, #2712). So: what gate graphs can a
 purely additive verb create that the predicate cannot escape, and who is left holding the exit?

 Everything here is run against the real exported functions in src/rig.mjs plus a source scan of the
 write surface. No harness, no store, no model.

 Run: node tools/probes/gate-verb-decomposition-gaps.mjs   (exit 1 when a gap is present - it is)
*/
import { readFileSync } from "node:fs";
import { normalizeBlockedBy, workable, deadGateId, isTerminalItem } from "../../../src/rig.mjs";

const fails = [];
// A gap is PRESENT when the condition holds; the probe is RED while any gap is open and
// turns GREEN when the verb closes it. Read "GAP" as "the build row must fix this".
const gap = (cond, msg) => {
	console.log(`  ${cond ? "GAP" : "CLOSED"}  ${msg}`);
	if (cond) fails.push(msg);
};
const measured = (msg) => console.log(`  MEASURED  ${msg}`);

const row = (id, status, blockedBy) => ({
	id, status, from: "pm", to: "impl", subject: `row ${id}`,
	blockedBy: normalizeBlockedBy(blockedBy),
});

console.log("A. SELF-GATE - an additive verb can make a row unworkable forever with no exit");
const self = row(700, "queued", [700]);
const v = workable(self, "impl", { items: [self] });
measured(`blockedBy=[700] on row 700 normalized to ${JSON.stringify(self.blockedBy)}; workable=${v.workable} reason=${v.reason}`);
gap(self.blockedBy?.length === 1, "normalizeBlockedBy ACCEPTS a self-referencing gate id (shape check only) - gate_work must reject it at write time");

console.log("\nB. CANCELLED PARENT - the gate can never be met; does any verb clear it?");
const dead = row(701, "cancelled", null);
const child = row(702, "queued", [701]);
measured(`workable(child)=${workable(child, "impl", { items: [child, dead] }).reason}; deadGateId=${deadGateId(child, [child, dead])}`);
const src = readFileSync(new URL("../../../src/rig.mjs", import.meta.url).pathname, "utf8");
const removalSites = src
	.split("\n")
	.filter((l) => /item\.blockedBy\s*=\s*(null|\[\])|delete\s+item\.blockedBy/.test(l));
measured(`assignment sites that CLEAR blockedBy: ${removalSites.length} -> ${JSON.stringify(removalSites)}`);
gap(removalSites.length === 0, "there is NO code path that removes a gate once written (0 removal sites) - #6508 is the only exit and it does not exist yet");

console.log("\nC. WHO CAN UNBLOCK IT - cancel is terminal and party-scoped; release refuses on a dead gate");
const childDeadGate = row(703, "held", [701]);
measured(`release is refused for a held row whose gate names a cancelled row: deadGateId=${deadGateId(childDeadGate, [childDeadGate, dead])} -> the row can be neither released nor gate-cleared`);
gap(deadGateId(childDeadGate, [childDeadGate, dead]) === 701, "the parked row with a dead gate has exactly two exits: cancel (party-scoped, terminal), or a gate-removal verb that does not exist yet");

console.log("\nD. LONG CYCLE - the #6512 check in the routing only tests a 2-cycle");
const a = row(710, "queued", [711]);
const b = row(711, "queued", [712]);
const c = row(712, "queued", [710]);
const set = [a, b, c];
const verdicts = set.map((it) => workable(it, "impl", { items: set }));
measured(`A<->B->C->A: ${verdicts.map((x) => x.reason).join(", ")}`);
gap(verdicts.every((x) => !x.workable), "a 3-cycle makes ALL three rows permanently unworkable - the predicate has no tie-break, and the #6512 check as routed only tests a 2-cycle");
gap(verdicts[0].reason === "gate-open:#711(queued)", "the reason a seat reads names the PARENT id, not the cycle: it says 'wait on 711' while 711 says 'wait on 712' - nobody sees the ring");

console.log("\nE. ORDERING OF VERBS (the #6510/#6511 invariant) - measured on the current source");
const verbs = {
	hold_work: { auth: /if \(item\.to !== me\)\n/, state: /if \(item\.status !== "claimed" && item\.status !== "queued"\)/ },
	revise_work: { auth: /if \(item\.to !== me && item\.from !== me\)\n/, state: /if \(item\.status !== "queued"\)/ },
	cancel_work: { auth: /if \(item\.to !== me && item\.from !== me\)\n/, state: /if \(isTerminalItem\(item\)\)/ },
};
for (const [name, re] of Object.entries(verbs)) {
	const body = src.slice(src.indexOf(`name: "${name}"`), src.indexOf(`name: "${name}"`) + 3000);
	const ai = body.search(re.auth);
	const si = body.search(re.state);
	measured(`${name}: authority test at offset ${ai}, state test at offset ${si}`);
	gap(ai < si, `${name} decides AUTHORITY before it establishes the row's STATE (#6511)`);
}

console.log("\nRESULT: " + (fails.length ? `RED - ${fails.length} gap(s) the decomposition does not close` : "GREEN"));
for (const f of fails) console.log(`  - ${f}`);
process.exit(fails.length ? 1 : 0);
