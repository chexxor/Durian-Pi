// demo/admission-deadline.test.mjs — ROADMAP 37(c): how old is "too old to still be admitting" (#4176)
//
// WHY THIS IS A CORRECTNESS REQUIREMENT RATHER THAN A NEXT STEP: a reconciler extended to settle `queued`
// submissions on the next pass WOULD CANCEL A SUBMISSION THAT IS LEGITIMATELY STILL BEING ADMITTED —
// worse than the bug it fixes. What separates "still being admitted" from "stuck" is TIME, and nothing in
// the tree defined how much. This pins that definition.
//
// THE CONTROL IS THE POINT: a submission admitted SECONDS ago must NOT be withdrawn. Without that
// assertion the deadline is a race against the admission path, not a fix.
//
// TESTABLE WITHOUT A PROVIDER: a submission with an old admission timestamp and no advancing task is a
// PURE decision over store state. The 429 is how the outage HAPPENED, not how it is tested.
//
// Run: node demo/admission-deadline.test.mjs   (exit 0 = pass)

import { ADMISSION_DEADLINE_MS, admissionVerdict } from "../src/broker.mjs";

let failures = 0;
function check(label, ok, detail = "") {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures += 1;
		console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
	}
}
const NOW = 1_800_000_000_000;
const row = (ageMs, status = "queued") => ({ id: 181515, conversationId: 42, status, admittedAt: NOW - ageMs });

try {
	console.log("\n=== THE CONTROL FIRST: a SECONDS-OLD admission must NOT be withdrawn ===");
	{
		const fresh = admissionVerdict({ submission: row(2_000), now: NOW });
		check("2s old -> NOT expired", fresh.expired === false, JSON.stringify(fresh));
		check("2s old -> the action is LEAVE, not withdraw", fresh.action === "leave", JSON.stringify(fresh));
		check("...and the reason says how old it is", /2s/.test(fresh.reason ?? ""), fresh.reason);
		const nearMiss = admissionVerdict({ submission: row(ADMISSION_DEADLINE_MS - 1_000), now: NOW });
		check("just under the deadline -> still NOT expired", nearMiss.expired === false, JSON.stringify(nearMiss));
	}

	console.log("\n=== THE CASE IT EXISTS FOR: an hours-old admission with nothing advancing it ===");
	{
		const stale = admissionVerdict({ submission: row(36_000_000), now: NOW });
		check("10h old -> EXPIRED", stale.expired === true, JSON.stringify(stale));
		check("10h old -> the action is WITHDRAW (a record survives, unlike settle)", stale.action === "withdraw", JSON.stringify(stale));
		check("the reason states the age AND why it is too old", /36000s/.test(stale.reason ?? "") && /too old/.test(stale.reason ?? ""), stale.reason);
		const boundary = admissionVerdict({ submission: row(ADMISSION_DEADLINE_MS), now: NOW });
		check("exactly at the deadline -> expired (the boundary is inclusive)", boundary.expired === true, JSON.stringify(boundary));
	}

	console.log("\n=== AN ADVANCING CONVERSATION IS NEVER STUCK, HOWEVER OLD THE ROW LOOKS ===");
	{
		const busy = admissionVerdict({ submission: row(36_000_000), advancing: true, now: NOW });
		check("advancing beats age", busy.expired === false && busy.action === "leave", JSON.stringify(busy));
		check("...and says why (the age of the record is not the age of the work)", /advancing/.test(busy.reason ?? ""), busy.reason);
	}

	console.log("\n=== WHEN IT CANNOT JUDGE, IT DOES NOT ACT ===");
	{
		const noStamp = admissionVerdict({ submission: { id: 1, conversationId: 42, status: "queued" }, now: NOW });
		check("no admission timestamp -> NOT expired", noStamp.expired === false, JSON.stringify(noStamp));
		check("...and the action is NONE, not withdraw (never act on a guess)", noStamp.action === "none", JSON.stringify(noStamp));
		check("...and it says why", /cannot judge age/.test(noStamp.reason ?? ""), noStamp.reason);
		const noRow = admissionVerdict({ submission: null, now: NOW });
		check("no submission -> NONE", noRow.action === "none", JSON.stringify(noRow));
		const iso = admissionVerdict({ submission: { admittedAt: new Date(NOW - 36_000_000).toISOString() }, now: NOW });
		check("an ISO timestamp is accepted as well as an epoch", iso.expired === true, JSON.stringify(iso));
	}

	console.log("\n=== THE THRESHOLD IS NAMED AND JUSTIFIED ===");
	{
		check("the deadline is exported, not hidden in a comparison", typeof ADMISSION_DEADLINE_MS === "number", String(ADMISSION_DEADLINE_MS));
		check("it is minutes, not seconds (an admission is seconds; a stall was hours)", ADMISSION_DEADLINE_MS >= 60_000, String(ADMISSION_DEADLINE_MS));
		const custom = admissionVerdict({ submission: row(10_000), now: NOW, deadlineMs: 5_000 });
		check("a caller can pass its own deadline", custom.expired === true, JSON.stringify(custom));
	}

	console.log("\n=== WHAT IS STILL OPEN, named rather than implied ===");
	console.log("  The reconciler does NOT yet consult admissionVerdict, and the periodic sweep is not built.");
	console.log("  Both are now SAFE to build because the primitive exists; neither is built here.");
	console.log("  AND ONE FACT I DID NOT ESTABLISH: the real submission row's timestamp FIELD NAME. The verdict");
	console.log("  accepts admittedAt / createdAt / at and refuses to act when none is present, so the wiring");
	console.log("  must confirm which field pi-durable actually writes rather than assume one of them.");

	console.log(
		failures === 0
			? "\nPASS — the deadline distinguishes a seconds-old admission from a stuck one, never acts on an advancing conversation, and refuses to guess when it cannot judge the age"
			: `\nFAIL — ${failures} check(s) failed`,
	);
} catch (err) {
	console.error("ERROR:", err?.message?.slice(0, 600));
	failures += 1;
}

process.exit(failures === 0 ? 0 : 1);
