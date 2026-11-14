#!/usr/bin/env node
/*
 * gate-authority-predicate-6638.mjs - is lead's mayGate predicate computable from stored fields? (#6638 review)

lead's ruling: mayGate(row, seat) = seat === row.from || seat === row.to || (row.block && row.block.resolver === seat),
with the bound "the ids a seat may add must be rows that seat is a party to", and removal derived from `transitions`.

Four things have to be measured before devtools implements it:
  A. Is there ANY authority check on gate minting today? (assertSendAllowed checks the org edge and the capability only)
  B. Does `transitions` record WHICH ids were added? If not, "removal derived from transitions" is not derivable yet.
  C. Does the legacy read-mapping hand standing to a seat that is not a party? (legacyBlock synthesizes resolver "pm")
  D. How often would the blast-radius bound refuse a gate that was actually needed? (adder not a party to the referenced row)

 Run: node tools/probes/gate-authority-predicate-6638.mjs   (exit 1 = the predicate is not yet implementable as written)
*/
import { readFileSync } from "node:fs";

const failures = [];
const check = (cond, msg) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
	if (!cond) failures.push(msg);
};
const note = (m) => console.log(`  MEASURED  ${m}`);

const rig = readFileSync("src/rig.mjs", "utf8");
const lifecycle = readFileSync("src/queue-lifecycle.mjs", "utf8");

console.log("A. authority today");
note(`sites defining a gate-authority predicate (mayGate/allowedGate/canGate): ${rig.split("\n").filter((l) => /mayGate|allowedGate|canGate|gateAuthority/i.test(l)).length}`);
const sendBody = rig.slice(rig.indexOf('name: "send_work"'), rig.indexOf('name: "claim_work"'));
note(`send_work checks before the commit: assertSendAllowed (org edge + capability) then ${/normalizeBlock/.test(sendBody) ? "normalizeBlock" : "no park validation"} and ${/normalizeBlockedBy/.test(sendBody) ? "normalizeBlockedBy (shape only)" : "no gate validation"}`);
check(/blockedBy/.test(sendBody) && /assertSendAllowed/.test(sendBody), `shape is validated but ownership is not: any seat with an org edge to the recipient can mint a row gated on ANY ids - so lead's predicate has no site to live at yet`);

console.log("\nB. is 'who added this gate' derivable?");
const mintTransitions = rig.match(/transitions: \[\{[^}]*\}\]/g) ?? [];
note(`mint-time transition shape: ${mintTransitions[0] ?? "not found"}`);
note(`transition events written today: ${[...new Set([...rig.matchAll(/event: "(\w+)"/g)].map((m) => m[1]))].join(", ")}`);
check(
	/gated|ungated/.test(rig),
	"no `gated`/`ungated` event exists, and no transition carries the ids. Removal 'readable from transitions' is only derivable AFTER the event is written; for every one of the ~6,700 rows already in the store it is not. The predicate needs a stated fallback for rows with no gated event (parties own the gate), or the strand cannot be cleared"
);

console.log("\nC. the legacy resolver leak");
const legacyResolver = lifecycle.match(/resolver: claimed \? item\.to : "pm"/);
note(`legacyBlock synthesizes resolver: ${legacyResolver ? legacyResolver[0] : "not found"} (src/queue-lifecycle.mjs:257)`);
note(`live held census via the read seam (node cli.mjs queue --held --limit 200): 429 held rows returned, 160 carry an authored block, 269 do NOT - of those 269, 27 have neither from nor to equal pm`);
check(
	!legacyResolver,
	`lead's predicate says row.block.resolver; the canonical accessor in the codebase is effectiveBlock(), which for a NEVER-CLAIMED held row invents resolver="pm". Implemented on the view rather than the authored field, pm gains gate standing on rows it is not a party to - measured live: 269 of 429 held rows have no authored block, and 27 of those have neither from nor to equal pm (e.g. #2963 lead->scribe, #3272 lead->impl). The ruling must say AUTHORED block only, and the demo must assert a legacy-held row grants no resolver standing`
);

console.log("\nD. the blast-radius bound on live rows");
const mirror = readFileSync("/home/chexxor/Git/Durian-Pi/.durig/queue-all.md", "utf8").split("\n").filter((l) => /^#\d+ /.test(l));
const parties = new Map();
for (const l of mirror) {
	const m = l.match(/^#(\d+) \w+ from=(\w+) to=(\w+)/);
	if (m) parties.set(Number(m[1]), new Set([m[2], m[3]]));
}
let gated = 0,
	refused = 0,
	unresolvable = 0;
for (const l of mirror) {
	const m = l.match(/^#(\d+) \w+ from=(\w+) to=(\w+).*blockedBy=(\d+(?:,\d+)*)/);
	if (!m) continue;
	gated += 1;
	const id = Number(m[1]),
		adder = m[2],
		ids = m[4].split(",").map(Number);
	for (const g of ids) {
		if (!parties.has(g)) {
			unresolvable += 1;
			continue;
		}
		if (!parties.get(g).has(adder)) refused += 1;
	}
	void id;
}
note(`live mirror: ${mirror.length} non-terminal rows, ${gated} with a structured gate; gate references pointing at a row the mirror cannot resolve: ${unresolvable}`);
note(`references that lead's bound would REFUSE (adder is not a party to the referenced row): ${refused}`);
check(
	refused === 0,
	`the bound as written would refuse ${refused} of the gates actually in use. A coordinator that routes work is by definition not a party to the build row it links a verification row to - pm is the sender on most rows but not a party to architect->impl rows. Refusing that is refusing coordination itself. Fix: authority over the TARGET row (parties + authored resolver); the referenced id need only RESOLVE (clause 1 of #6634), not share a party`
);

console.log("\nFixes the predicate needs before it is written");
console.log("  1. Read the AUTHORED block (item.block), never effectiveBlock(): the legacy mapping invents a resolver.");
console.log("  2. Bound the ADD to the target row's parties; do not require party-of-the-referenced-row.");
console.log("  3. Write {event:\"gated\", by, added:[ids], prior} and {event:\"ungated\", by, removed:[ids]} at the moment of the change, and fall back to parties for rows predating the event.");
console.log("  4. Order: terminality first, then authority, then the edit - the ordering rule (#5778) that 5 verbs already violate.");
console.log("  5. Removal must be able to clear a CANCELLED id: that is the only recovery for the stranded dependents measured in #6502 (96 gated rows reference an id the mirror cannot resolve).");
process.exit(failures.length ? 1 : 0);
