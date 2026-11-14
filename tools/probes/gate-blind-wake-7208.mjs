// tools/probes/gate-blind-wake-7208.mjs — falsifiers for the gate-blind wake design (#7205/#7206/#7207).
// Pure: no store, no harness, no git. Exit 0 = every claim below reproduced. Exit 1 = one did not.
// Run: node tools/probes/gate-blind-wake-7208.mjs
import { deadGateIds, workable } from "../../src/rig.mjs";
import { parkGateIds, parkOf } from "../../src/queue-lifecycle.mjs";
import { parkedSignature, selectWakes, WAKE_CONTENT_PARKED } from "../../src/driver.mjs";
import { WakeScheduler } from "../../src/scheduler.mjs";

const fails = [];
function check(name, cond, detail) {
  if (cond) console.log(`PASS ${name} :: ${detail}`);
  else { fails.push(name); console.log(`FAIL ${name} :: ${detail}`); }
}

/* ── 1. The two gate surfaces disagree: `deadGateIds` sees only `blockedBy`. ───────────────
   A row parked through the structured `block.constraints` field (#6150, slice M1a) has no
   `blockedBy`, so the helper the signature is proposed to use reports NO dead gate, while the
   park classifier reports the gate. If the wake signature is derived from `deadGateIds`, these
   rows stay invisible to the wake predicate. */
const structuredParked = {
  id: 101, from: "pm", to: "impl", status: "held",
  block: { source: "declared", reason: "dependency", resolver: "pm", constraints: [{ kind: "queue", ref: "#100" }] },
};
const gateCancelled = { id: 100, from: "pm", to: "impl", status: "cancelled" };
const items1 = [gateCancelled, structuredParked];
check(
  "1-deadGateIds-blind-to-structured-gate",
  deadGateIds(structuredParked, items1).length === 0 && parkGateIds(structuredParked).length === 1,
  `deadGateIds=${JSON.stringify(deadGateIds(structuredParked, items1))} parkGateIds=${JSON.stringify(parkGateIds(structuredParked))}`,
);
check(
  "1-park-class-says-gated-work-anyway",
  parkOf(structuredParked, { statusOf: (id) => (id === 100 ? "cancelled" : "absent") }).class === "gated-work",
  `parkOf class=${parkOf(structuredParked, { statusOf: (id) => (id === 100 ? "cancelled" : "absent") }).class}`,
);

/* ── 2. The parked SET does not move when a gate dies, so the dedup suppresses the wake. ────
   Same shape as the pm-grounded probe (row 101 held, gate 100), in-process. */
const legacy = [
  { id: 100, from: "pm", to: "impl", status: "queued", blockedBy: [] },
  { id: 101, from: "pm", to: "impl", status: "held", blockedBy: [100] },
];
const before = parkedSignature(legacy, "impl");
const after = parkedSignature(legacy.map((it) => (it.id === 100 ? { ...it, status: "cancelled" } : it)), "impl");
check("2-signature-unchanged-on-gate-cancel", before === after, `before=${before} after=${after}`);
check(
  "2-no-queued-verdict-for-a-held-row",
  workable(legacy[1], "impl", { items: legacy.map((it) => (it.id === 100 ? { ...it, status: "cancelled" } : it)), capabilities: [] }).reason === "not-queued:held",
  `workable(held row) reason=${workable(legacy[1], "impl", { items: legacy, capabilities: [] }).reason}`,
);

/* ── 3. THE BUG #7205 WOULD INHERIT: the signature is CONSUMED on a pass that issues no wake.
   `parkedChanged()` records the new signature at line 176 of src/driver.mjs, BEFORE the
   pending/busy guards at 189-195. A seat whose run is in flight when the gate dies has its
   new signature recorded and the wake suppressed; every later pass reads "unchanged" and
   skips with `parked-deduped`. The strand is never reported. */
const sched = new WakeScheduler({ minIntervalMs: 0, now: () => 0 });
const seats = { impl: { conversationId: 7, capabilities: [] } };
const stranded = legacy.map((it) => (it.id === 100 ? { ...it, status: "cancelled" } : it));
const skips1 = [];
const wakes1 = selectWakes({ seats, items: stranded, pendingConvIds: new Set([7]), parkedChanged: (seat, sig) => sched.parkedChanged(seat, sig), onSkip: (s) => { skips1.push(s); console.log(`   skip ${s.seat} reason=${s.reason}`); } });
check(
  "3-signature-recorded-while-wake-suppressed",
  wakes1.length === 0 && sched.parkedSignatureOf("impl") === after,
  `wakes=${wakes1.length} recorded=${sched.parkedSignatureOf("impl")} expected=${after}`,
);
const skips2 = [];
const wakes2 = selectWakes({ seats, items: stranded, pendingConvIds: new Set(), parkedChanged: (seat, sig) => sched.parkedChanged(seat, sig), onSkip: (s) => { skips2.push(s); console.log(`   skip ${s.seat} reason=${s.reason}`); } });
check(
  "3-strand-never-told-after-the-run-finishes",
  wakes2.length === 0 && skips2.some((s) => s.reason === "parked-deduped"),
  `wakes=${wakes2.length} skips=${JSON.stringify(skips2)}`,
);

/* ── 4. What a coarse gate bucket does. `open` / `closed` / `dead`, derived from BOTH surfaces.
   Shows the fix fires exactly once on death and NOT on ordinary gate progress. */
function gateBucket(item, items) {
  const ids = parkGateIds(item);
  if (!ids.length) return "none";
  const statuses = ids.map((id) => items.find((it) => it.id === id)?.status ?? "absent");
  if (statuses.some((s) => s === "cancelled")) return "dead";
  if (statuses.every((s) => s === "done")) return "closed";
  return "open";
}
function sigWithBucket(items, seat) {
  return (items ?? [])
    .filter((it) => it.to === seat && (it.status === "held" || it.status === "deferred"))
    .map((it) => `${it.id}:${it.status}:${gateBucket(it, items)}`)
    .sort()
    .join(",");
}
const progress = [
  { id: 100, from: "pm", to: "impl", status: "queued", blockedBy: [] },
  { id: 101, from: "pm", to: "impl", status: "held", blockedBy: [100] },
];
const claimedGate = progress.map((it) => (it.id === 100 ? { ...it, status: "claimed" } : it));
const doneGate = progress.map((it) => (it.id === 100 ? { ...it, status: "done" } : it));
const deadGate = progress.map((it) => (it.id === 100 ? { ...it, status: "cancelled" } : it));
check("4-bucket-stable-across-queued-to-claimed", sigWithBucket(progress, "impl") === sigWithBucket(claimedGate, "impl"), `${sigWithBucket(progress, "impl")} vs ${sigWithBucket(claimedGate, "impl")}`);
check("4-bucket-changes-on-done", sigWithBucket(claimedGate, "impl") !== sigWithBucket(doneGate, "impl"), `${sigWithBucket(claimedGate, "impl")} vs ${sigWithBucket(doneGate, "impl")}`);
check("4-bucket-changes-on-cancel", sigWithBucket(doneGate, "impl") !== sigWithBucket(deadGate, "impl"), `${sigWithBucket(doneGate, "impl")} vs ${sigWithBucket(deadGate, "impl")}`);
check(
  "4-structured-gate-detected-by-bucket",
  sigWithBucket([gateCancelled, structuredParked], "impl") === "101:held:dead",
  `bucket sig=${sigWithBucket([gateCancelled, structuredParked], "impl")}`,
);

/* ── 5. The wake body is a constant; ids cannot go in it. ───────────────────────────────── */
check("5-wake-body-is-a-constant-string", typeof WAKE_CONTENT_PARKED === "string" && !WAKE_CONTENT_PARKED.includes("{") && !WAKE_CONTENT_PARKED.includes("$"), `body="${WAKE_CONTENT_PARKED}"`);
check("5-queue-line-prints-dead-gate-for-queued-only",
  (deadGateIds({ id: 101, status: "queued", blockedBy: [100] }, [gateCancelled]).length === 1),
  "queueItemLine renders DEAD-GATE from deadGateIds, i.e. blockedBy only (same blind spot as finding 1)");

console.log(fails.length ? `\n${fails.length} FAILURES: ${fails.join(", ")}` : "\nALL CHECKS PASSED");
process.exit(fails.length ? 1 : 0);
