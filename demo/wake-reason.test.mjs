// #4607 — THE FOUR-STATE WAKE FIXTURE. Committed, because a measurement in a completion expires.
//
// THE PREDICATE WAS ALREADY RIGHT in #4557 (`hasQueued || hasStalledClaim`); what was missing is that the WAKE
// did not say WHICH, so one fixed string described two situations and lied about one. #4607 adds the third
// situation — PARKED rows and nothing claimable — which previously said NOTHING at all.
//
// If a future reader simplifies the predicate back to a single condition, or drops the `reason`, these fail.
import { selectWakes, WAKE_CONTENT, WAKE_CONTENT_STALLED, WAKE_CONTENT_PARKED } from "../src/driver.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures++;
		console.log(`  FAIL ${label} -- ${detail}`);
	}
};

const seat = "worker";
const convId = 7;
const base = () => ({
	seats: { [seat]: { conversationId: convId } },
	pendingConvIds: new Set(),
	busySeats: new Set(),
	stoppedConvIds: new Set(),
	onSkip: () => {},
});

console.log("\n=== STATE 1: QUEUED WORK -> the wake offers claim_work ===");
const q = selectWakes({ ...base(), items: [{ id: 1, to: seat, status: "queued", subject: "s" }] });
check("a queued item wakes the seat", q.length === 1, JSON.stringify(q));
check("reason is `queued`", q[0]?.reason === "queued", JSON.stringify(q[0]));
check("body is WAKE_CONTENT (the claim offer)", WAKE_CONTENT.includes("claim_work"));

console.log("\n=== STATE 2: STALLED CLAIM -> the wake offers resume_work ===");
const st = selectWakes({ ...base(), items: [{ id: 2, to: seat, status: "claimed", subject: "s" }] });
check("a stalled claim wakes the seat", st.length === 1, JSON.stringify(st));
check("reason is `stalled-claim`", st[0]?.reason === "stalled-claim", JSON.stringify(st[0]));
check("body is WAKE_CONTENT_STALLED", WAKE_CONTENT_STALLED.includes("resume_work"));
check("and it does NOT start with the claim offer", !WAKE_CONTENT_STALLED.startsWith("You have queued work"));

console.log("\n=== STATE 3: PARKED ROWS, NOTHING CLAIMABLE -> the wake NAMES the parked state ===");
// #4607: this state used to say NOTHING, which leaves the seat polling. It now gets its own fixed body.
const pk = selectWakes({ ...base(), items: [{ id: 3, to: seat, status: "held", subject: "s" }] });
check("a held-only seat IS woken (it is not silence any more)", pk.length === 1, JSON.stringify(pk));
check("reason is `parked`", pk[0]?.reason === "parked", JSON.stringify(pk[0]));
check("body is WAKE_CONTENT_PARKED", WAKE_CONTENT_PARKED.includes("parked rows"));
check(
	"...and it says there is NOTHING CLAIMABLE, so the seat does not call claim_work",
	WAKE_CONTENT_PARKED.includes("nothing claimable"),
	WAKE_CONTENT_PARKED,
);
check(
	"...and it does NOT advertise claim_work as an offer",
	!WAKE_CONTENT_PARKED.startsWith("You have queued work"),
	WAKE_CONTENT_PARKED,
);
check(
	"AND IT CARRIES NO ID AND NO OWNER — ROADMAP 33 forbids per-item text",
	!/#\d/.test(WAKE_CONTENT_PARKED) && !/pm|qa|impl|worker|devtools/.test(WAKE_CONTENT_PARKED),
	WAKE_CONTENT_PARKED,
);

console.log("\n=== STATE 4: A DEFERRED ROW IS ALSO PARKED ===");
const df = selectWakes({ ...base(), items: [{ id: 4, to: seat, status: "deferred", subject: "s" }] });
check("a deferred row counts as parked", df[0]?.reason === "parked", JSON.stringify(df[0]));

console.log("\n=== AND ROWS ADDRESSED ELSEWHERE WAKE NOBODY ===");
for (const status of ["queued", "claimed", "held", "deferred"]) {
	const other = selectWakes({ ...base(), items: [{ id: 9, to: "someone-else", status, subject: "s" }] });
	check(`a ${status} row addressed elsewhere does not wake this seat`, other.length === 0, JSON.stringify(other));
}

console.log("\n=== AND NOTHING AT ALL -> still no wake (the honest zero) ===");
const none = selectWakes({ ...base(), items: [] });
check("an empty queue wakes nobody", none.length === 0, JSON.stringify(none));

console.log("\n=== THE THREE BODIES ARE DISTINCT CONSTANTS ===");
check("claim / stalled / parked are three different strings",
	new Set([WAKE_CONTENT, WAKE_CONTENT_STALLED, WAKE_CONTENT_PARKED]).size === 3);

console.log(failures === 0 ? "\nPASS — four states, four distinct outcomes, and the reason travels with the wake" : `\nFAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
