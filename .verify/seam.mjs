// .verify/seam.mjs — independent re-check of #5741: does the parked wake converge, and does release still wake?
import { selectWakes } from "../src/driver.mjs";
import { WakeScheduler } from "../src/scheduler.mjs";
const sched = new WakeScheduler({ wakeSpacingMs: 4000, wakeMaxPerSeat: 3, maxConcurrent: 2, now: () => 0 });
const seats = { parkseat: { conversationId: "c1" } };
function pass(items) {
  const woke = [], parked = [], skipped = [];
  const cands = selectWakes({
    seats, items, pendingConvIds: new Set(), stoppedConvIds: new Set(),
    parkedChanged: (s, sig) => sched.parkedChanged(s, sig),
    onWoke: (n) => woke.push(n), onParked: (e) => parked.push(e), onSkip: (e) => skipped.push(e),
  });
  return { woke: cands.map((c) => c.name), parked, skipped, candCount: cands.length };
}
const held = [{ id: 1, to: "parkseat", status: "held", from: "pm" }];
const r1 = pass(held);
const r2 = pass(held);
const r3 = pass(held);
console.log("pass1 (held, first time): woke", r1.woke, "parked", r1.parked, "skip", r2.skipped.length ? "" : "");
console.log("pass2 (same held set):    woke", r2.woke, "parked", r2.parked, "skip", r2.skipped);
console.log("pass3 (same held set):    woke", r3.woke, "parked", r3.parked);
const released = [{ id: 1, to: "parkseat", status: "queued", from: "pm" }];
const r4 = pass(released);
console.log("pass4 (released to queued): woke", r4.woke, "parked", r4.parked);
const added = [{ id: 1, to: "parkseat", status: "held", from: "pm" }, { id: 2, to: "parkseat", status: "deferred", from: "qa" }];
const r5 = pass(added);
console.log("pass5 (parked SET changed, new deferred row): woke", r5.woke, "parked", r5.parked);
const parkedSig = (items) => items.filter(i => i.to === "parkseat" && (i.status === "held" || i.status === "deferred")).map(i => `${i.id}:${i.status}`).sort().join(",");
console.log("signature after release:", parkedSig(released) === "" ? "(empty)" : parkedSig(released), "-> scheduler.parkedSignatureOf(parkseat) =", sched.parkedSignatureOf("parkseat"));
