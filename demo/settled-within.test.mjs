// #4355 — `settledWithin` must REPORT the bound rather than merely stop waiting.
//
// The helper it sits beside (`settleWithin`) returns nothing and swallows the outcome, so a caller cannot
// learn that the bound FIRED. The abort escalation has to branch on exactly that, and inferring it from
// elapsed time is a race that is wrong under load.
import { settledWithin } from "../src/broker.mjs";

let failures = 0;
const check = (label, ok, detail = "") => {
	if (ok) console.log(`  ok   ${label}`);
	else {
		failures++;
		console.log(`  FAIL ${label} -- ${detail}`);
	}
};

console.log("\n=== 1. A PROMISE THAT SETTLES IN TIME -> settled:true ===");
const fast = await settledWithin(new Promise((r) => setTimeout(() => r("value"), 5)), 500);
check("reports settled", fast.settled === true, JSON.stringify(fast));
check("reports no error", fast.error === null, JSON.stringify(fast));
check("is not flagged as a missing grace", fast.noGrace === false, JSON.stringify(fast));

console.log("\n=== 2. A PROMISE THAT NEVER SETTLES -> settled:false, after roughly ms ===");
const t0 = Date.now();
const never = await settledWithin(new Promise(() => {}), 60);
const elapsed = Date.now() - t0;
check("reports NOT settled", never.settled === false, JSON.stringify(never));
check("returned after roughly ms, not later", elapsed >= 50 && elapsed < 400, `elapsed=${elapsed}ms`);
check("the bound firing is NOT a missing grace", never.noGrace === false, JSON.stringify(never));

console.log("\n=== 3. A REJECTION IN TIME IS *SETTLED*, AND THE REASON IS REPORTED ===");
const boom = new Error("run failed");
const rejected = await settledWithin(Promise.reject(boom), 500);
check("a rejection SETTLED (it did not time out)", rejected.settled === true, JSON.stringify(rejected));
check("the rejection reason is reported, not swallowed", rejected.error === boom, String(rejected.error));

console.log("\n=== 4. ms <= 0 IS EXPLICIT: NO WAIT IS NOT AN EXPIRED WAIT ===");
const noGrace = await settledWithin(new Promise((r) => setTimeout(r, 5)), 0);
check("zero grace does not wait", noGrace.settled === false, JSON.stringify(noGrace));
check("...and says so with noGrace", noGrace.noGrace === true, JSON.stringify(noGrace));
const negative = await settledWithin(Promise.resolve(1), -1);
check("a negative grace behaves the same and is marked", negative.settled === false && negative.noGrace === true, JSON.stringify(negative));

console.log("\n=== 5. THE CALLER CAN BRANCH ON IT (the assertion that catches the class) ===");
// A helper returning a boolean nobody branches on proves nothing. This models the drain's next step:
// escalate ONLY when the bound fired, and close cleanly when it settled — including when it settled badly.
const drain = async (work, graceMs) => {
	const outcome = await settledWithin(work, graceMs);
	if (outcome.noGrace) return { action: "no-grace", aborted: [] };
	if (!outcome.settled) return { action: "escalate", aborted: ["conv-1"] };
	if (outcome.error) return { action: "close-with-error", aborted: [] };
	return { action: "close", aborted: [] };
};
const finished = await drain(Promise.resolve("done"), 200);
const hung = await drain(new Promise(() => {}), 40);
const failed = await drain(Promise.reject(new Error("x")), 200);
const ungraced = await drain(new Promise(() => {}), 0);
check("a settled run CLOSES and aborts nothing", finished.action === "close" && finished.aborted.length === 0, JSON.stringify(finished));
check("a HUNG run ESCALATES and names the conversation", hung.action === "escalate" && hung.aborted.length === 1, JSON.stringify(hung));
check("a run that settled with an ERROR does NOT escalate (it already finished)", failed.action === "close-with-error", JSON.stringify(failed));
check("a missing grace is its own branch, not an escalation", ungraced.action === "no-grace", JSON.stringify(ungraced));

console.log(failures === 0 ? "\nPASS — the bound is reported, a rejection counts as settled, and the caller branches on it" : `\nFAIL — ${failures}`);
process.exit(failures === 0 ? 0 : 1);
