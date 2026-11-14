#!/usr/bin/env node
/*
 * #7082 - a protocol NOTICE is minted as a CLAIMABLE row. Falsifier for the claim that a seat is
 * woken and claims zero work. Exit 1 while an ack competes with real work for the claim slot.
 * Tree: branch item-7082; pi-durable 1.3.0 from this lockfile (seat root resolves 1.5.1).
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, compilePersona, enqueueItem, registerSeat, workable, selectNextWork } from "../../src/rig.mjs";

const failures = [];
const check = (cond, msg) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures.push(msg);
};
const measured = (m) => console.log(`  MEASURED  ${m}`);

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels(); models.setProvider(faux.provider);
const registry = createRegistry(); registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let noticeId, workId;
await harness.commit(async (tx) => {
  for (const [n, r] of [["pm", "program manager"], ["impl", "implementation engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: r }) });
    await registerSeat(tx, n, c.id, r);
  }
  const seats = await tx.doc(Seats);
  seats.seats.pm.capabilities = [];
  seats.seats.impl.capabilities = ["implement"];
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "pm", maySendTo: ["impl"] }, { from: "impl", maySendTo: ["pm"] }];

  // #1: an ACK - "DONE #0: something impl already finished". It carries no work.
  noticeId = await enqueueItem(tx, "pm", "impl", "DONE #1: the work impl already finished", "ack", null, true);
  // #2: real work, minted after the ack.
  workId = await enqueueItem(tx, "pm", "impl", "REAL WORK", "the actual task");
}, ctx);

const items = (await harness.snapshot(RigQueue, undefined, ctx)).items;
const notice = items.find((i) => i.id === noticeId);
const work = items.find((i) => i.id === workId);

measured(`notice row #${noticeId}: notice=${notice.notice} status=${notice.status} subject="${notice.subject}"`);
measured(`work row #${workId}: notice=${work.notice} status=${work.status}`);

check(notice.notice === true, "the store already knows the ack is not work (notice:true) - so the predicate CAN be built on a field that exists");
check(workable(notice, "impl", { items, capabilities: ["implement"] }).workable === false, "GREEN only if `workable()` refuses an ack: today it returns true, so the wake predicate (src/driver.mjs:135) counts a zero-work row as queued work");
const picked = selectNextWork(items, "impl", { capabilities: ["implement"] });
measured(`oldest-workable selection for impl picks #${picked.item?.id} (${picked.item?.subject})`);
check(picked.item?.id === workId, "GREEN only if selection hands the seat the REAL work first; today the ack (#1) wins the oldest claim slot because it is older");

/* the live stakes */
import { execSync } from "node:child_process";
if (process.env.DURIG_DB) {
  const live = JSON.parse(execSync("node cli.mjs queue --json --no-body", { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 }).replace(/^note.*\n/, "")).items;
  const notices = live.filter((i) => i.notice === true);
  const open = notices.filter((i) => i.status === "queued");
  const perSeat = {};
  for (const i of live) if (i.status === "queued") {
    perSeat[i.to] = perSeat[i.to] ?? { work: 0, notice: 0 };
    perSeat[i.to][i.notice === true ? "notice" : "work"]++;
  }
  measured(`live store (${live.length} rows): ${notices.length} notice rows total, ${open.length} still QUEUED`);
  measured(`queued rows per seat (work vs notice): ${Object.entries(perSeat).map(([s, v]) => `${s}: ${v.work}/${v.notice}`).join(", ")}`);
  check(open.length === 0, `${open.length} acks are sitting in seats' queues as claimable work right now (GREEN requires 0)`);
}

console.log("\n=== FALSIFIER ===");
console.log(failures.length ? "RED - a protocol ack competes with work for the claim slot and wakes the seat" : "GREEN - notices are records, not claimable work");
await harness.close(ctx);
process.exit(failures.length ? 1 : 0);
