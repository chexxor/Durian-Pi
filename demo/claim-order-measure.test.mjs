// demo/claim-order-measure.test.mjs — the claim-order instrument has TEETH (#7272).
//
// WHY THIS DEMO EXISTS. `tools/claim-order.mjs` answers "which row does a claim actually take, and
// what did it pass over?". A tool that only prints numbers is not evidence: if its ordering were
// re-derived inside the tool instead of calling the claim path, it would drift from the real claim
// and every routing decision made from it would be wrong (#6112: a rule kept in two places is a
// rule that drifts). So the demo pins the four cases a coordinator needs to read correctly:
//   1. the seat override beats the team value, and the report NAMES the source;
//   2. a live lease reorders the claim - and the instrument reports the row the naive
//      "oldest queued row" reading would have picked, so the disagreement is visible;
//   3. a lease on a GATED row is NOT claimable while the gate is open, and is honoured once it
//      closes (deferred, not dead);
//   4. a LAPSED lease ranks neutral - it does not stay urgent in one view and neutral in another.
//
// Deterministic: `now` is injected, so the lease expiry never depends on when the suite runs.
import { spawnSync } from "node:child_process";
import { resolveStrategy } from "../src/workstrategy.mjs";
import { claimOrderReport } from "../tools/claim-order.mjs";

const now = Date.parse("2026-11-12T12:00:00.000Z");
const lease = (ms) => new Date(now + ms).toISOString();
const row = (id, extra = {}) => ({ id, from: "pm", to: "impl", subject: `row ${id}`, status: "queued", ...extra });

function fixture() {
	return [
		row(10), // oldest, unleased
		row(20, { priority: "now", prioritySet: { expiresAt: lease(86400000), by: "pm" }, blockedBy: [40] }), // leased but gated
		row(30, { priority: "now", prioritySet: { expiresAt: lease(86400000), by: "pm" } }), // leased and claimable
		row(40, { to: "scribe", status: "claimed" }),
		row(50, { priority: "now", prioritySet: { expiresAt: lease(-1000), by: "pm" } }), // lease has lapsed
		row(51), // newer than 50, unleased
	];
}

let failures = 0;
function check(name, condition, detail) {
	if (condition) {
		console.log(`PASS ${name}`);
		return;
	}
	failures += 1;
	console.log(`FAIL ${name} - ${detail}`);
}

const items = fixture();

// 1. Precedence, and the honesty of the source string.
const seatWins = resolveStrategy({ seatStrategy: "oldest_first", teamStrategy: "priority_first" });
check("seat override beats team", seatWins.strategy === "oldest_first" && seatWins.source === "seat", `got ${JSON.stringify(seatWins)}`);

const report = claimOrderReport(items, "impl", { seatStrategy: "priority_first", teamStrategy: null, capabilities: ["implement"], now });

// 2. THE DISAGREEMENT, MADE VISIBLE. The naive reading (oldest queued row) says #10; the claim
//    path with a live lease says #20. If the instrument did not actually reorder, this assertion
//    fails - it is the control that gives the tool its teeth.
check("a live lease reorders the claim", report.taken === 30, `taken=${report.taken}`);
check("the naive oldest-first answer is different", report.takenWouldBeUnderOldestFirst === 10, `oldest-first leg said ${report.takenWouldBeUnderOldestFirst}`);
check("the instrument reports the reorder as a reorder", report.reorders === "yes", `reorders=${report.reorders}`);
check("insertion head is still #10", report.headByInsertion[0] === 10, JSON.stringify(report.headByInsertion));
check("claim-order head is the leased #20 - sorting is not claimability", report.headByStrategy[0].id === 20, JSON.stringify(report.headByStrategy));
check("the gated lease is passed over with the claim path's own reason",
	report.passedOver.some((s) => s.id === 20 && s.reason === "gate-open:#40(claimed)"), JSON.stringify(report.passedOver));
check("the ungated lease wins over the gated one", report.headByStrategy[1].id === 30, JSON.stringify(report.headByStrategy));

// 3. The gate closes: the SAME row is now taken, so the lease was deferred rather than dropped.
const gateClosed = items.map((it) => (it.id === 40 ? { ...it, status: "done" } : it));
const after = claimOrderReport(gateClosed, "impl", { seatStrategy: "priority_first", capabilities: ["implement"], now });
check("once the gate closes the deferred lease is honoured", after.taken === 20, `taken=${after.taken}`);

// 4. A lapsed lease ranks neutral: the unleased older row wins, and the report says so.
const lapsedFixture = [row(49), row(50, { priority: "now", prioritySet: { expiresAt: lease(-1), by: "pm" } })];
const lapsed = claimOrderReport(lapsedFixture, "impl", { seatStrategy: "priority_first", capabilities: ["implement"], now });
check("a lapsed lease does not reorder", lapsed.taken === 49, `taken=${lapsed.taken}`);
check("the instrument counts the lapse", lapsed.leases.declared === 1 && lapsed.leases.lapsed === 1, JSON.stringify(lapsed.leases));

// 5. A cancelled prerequisite is a dropped prerequisite: the row is still not claimable, and the
//    reason names it, so a coordinator does not read it as a stuck gate.
const cancelled = [row(30, { priority: "now", prioritySet: { expiresAt: lease(86400000), by: "pm" }, blockedBy: [40] }), row(40, { to: "scribe", status: "cancelled" })];
const cancelledReport = claimOrderReport(cancelled, "impl", { seatStrategy: "priority_first", capabilities: ["implement"], now });
check("a cancelled gate is named, not guessed",
	cancelledReport.taken === null && cancelledReport.passedOver.some((s) => s.id === 30 && s.reason === "gate-cancelled:#40"), JSON.stringify(cancelledReport.passedOver));

// 6. A seat with no leases at all: `priority_first` orders exactly like `oldest_first` - the
//    instrument must not invent a reorder where none exists.
const plain = [row(11), row(12), row(13)];
const plainReport = claimOrderReport(plain, "impl", { teamStrategy: "priority_first", capabilities: ["implement"], now });
check("an unprioritised queue does not reorder", plainReport.reorders === "no" && plainReport.taken === 11, JSON.stringify({ taken: plainReport.taken, reorders: plainReport.reorders }));

// 7. THE CLI WIRING, end to end: a real process, a piped dump, a printed line. The function being
//    correct is not the same as the tool printing it.
const run = spawnSync(process.execPath, ["tools/claim-order.mjs", "--stdin", "--seat=impl=priority_first"], { encoding: "utf8", input: JSON.stringify({ items }) });
check("the tool runs and prints the claim it measured",
	run.status === 0 && run.stdout.includes("a claim takes") && run.stdout.includes("#30") && run.stdout.includes("oldest_first would take") && run.stdout.includes("#10"),
	`exit=${run.status} stdout=${run.stdout.slice(0, 300)} stderr=${run.stderr.slice(0, 200)}`);

console.log(failures === 0 ? "CLAIM-ORDER INSTRUMENT: 13 checks pass" : `CLAIM-ORDER INSTRUMENT: ${failures} failures`);
process.exit(failures === 0 ? 0 : 1);
