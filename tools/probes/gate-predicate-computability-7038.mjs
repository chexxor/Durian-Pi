#!/usr/bin/env node
/*
 * #7038 - is the gate-authority predicate COMPUTABLE as written? (architect review of lead #6530
 * and pm's four corrections #7034.) Six checks, each with a PASS/FAIL line and an exit code.
 *   Falsifier: exit 1 while (a) the spec names a field the store does not have, (b) the VIEW grants
 *   standing a party does not have, (c) mint accepts references it says it refuses, (d) a stranded
 *   gate has no removal path, (e) the existing verbs test authority before state.
 * Tree: this worktree (branch item-7038); pi-durable resolved from the lockfile = 1.3.0, NOT the
 * seat root's 1.5.1. Run: node tools/probes/gate-predicate-computability-7038.mjs
 */
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Edges, RigQueue, Router, Seats, cancelItem, compilePersona, enqueueItem, registerSeat, workable } from "../../src/rig.mjs";
import { effectiveBlock } from "../../src/queue-lifecycle.mjs";
import { readFileSync } from "node:fs";

const failures = [];
const check = (cond, msg) => {
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${msg}`);
  if (!cond) failures.push(msg);
};
const measured = (msg) => console.log(`  MEASURED  ${msg}`);

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels(); models.setProvider(faux.provider);
const registry = createRegistry(); registry.install(Router);
const harness = await Harness.open(new MemoryStorage(), { models, registry }, ctx);

let authoredId, legacyId, danglingId, selfId, terminalTargetId, gatedOnTerminalId;
await harness.commit(async (tx) => {
  for (const [n, r] of [["pm", "program manager"], ["lead", "lead"], ["impl", "implementation engineer"], ["devtools", "tooling engineer"], ["qa", "verification engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: r }) });
    await registerSeat(tx, n, c.id, r);
  }
  const seats = await tx.doc(Seats);
  seats.seats.pm.capabilities = [];            // coordinator
  seats.seats.impl.capabilities = ["implement"];
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "lead", maySendTo: ["impl", "devtools"] }, { from: "pm", maySendTo: ["impl", "devtools", "qa"] }];

  // 1. a row with an AUTHORED block (resolver named), and a legacy held row with none
  authoredId = await enqueueItem(tx, "lead", "impl", "authored park", "body", null, false, null, false, null, null, { reason: "manual", resolver: "impl" });
  legacyId = await enqueueItem(tx, "lead", "impl", "legacy park, never claimed", "body", null, false, null, true);

  // 2. references mint says it refuses
  danglingId = await enqueueItem(tx, "lead", "impl", "gate on an id that does not exist", "body", null, false, null, false, [9999]);
  selfId = await enqueueItem(tx, "lead", "impl", "self gate", "body", null, false, null, false, [danglingId + 1]); // its own id
  terminalTargetId = await enqueueItem(tx, "lead", "impl", "terminal target", "body");
  await cancelItem(tx, { item: (await tx.doc(RigQueue)).items.find((i) => i.id === terminalTargetId), me: "lead", reason: "cancelled target" });
  gatedOnTerminalId = await enqueueItem(tx, "lead", "impl", "gate on a cancelled row", "body", null, false, null, false, [terminalTargetId]);
}, ctx);

const items = () => harness.snapshot(RigQueue, undefined, ctx);
const row = async (id) => (await items()).items.find((i) => i.id === id);

console.log("--- 1. the field the spec names does not exist on a stored row");
const authored = await row(authoredId);
measured(`row ${authoredId} keys: ${Object.keys(authored).join(", ")}`);
check(authored.authoredBlock === undefined, "lead's predicate reads `row.authoredBlock`; that field is never written - the authored field is `block` (so the spec text is not computable as written)");
check(authored.block?.resolver === "impl", "the authored resolver IS reachable as row.block.resolver - the fix is the accessor name, not the rule");

console.log("--- 2. the VIEW grants standing the record cannot show");
const legacy = await row(legacyId);
measured(`legacy row ${legacyId}: status=${legacy.status} from=${legacy.from} to=${legacy.to} authored block=${JSON.stringify(legacy.block ?? null)}`);
measured(`effectiveBlock(legacy) = ${JSON.stringify(effectiveBlock(legacy))}`);
check(effectiveBlock(legacy).resolver === "pm", "the view synthesizes resolver \"pm\" for a never-claimed held row - pm is not a party (from=lead, to=impl), so pm gains gate standing on the view");
check((legacy.block ?? null) === null, "the authored field for that row is empty: any standing derived from the view is invented");

console.log("--- 3. mint accepts references it says it refuses");
const dangling = await row(danglingId);
const self = await row(selfId);
const gatedTerminal = await row(gatedOnTerminalId);
measured(`dangling row ${danglingId}: blockedBy=${JSON.stringify(dangling.blockedBy)} (target #9999 absent from the queue)`);
measured(`self row ${selfId}: blockedBy=${JSON.stringify(self.blockedBy)} (its own id is ${selfId})`);
measured(`row ${gatedOnTerminalId}: blockedBy=${JSON.stringify(gatedTerminal.blockedBy)}, target status=${(await row(terminalTargetId)).status}`);
check(Array.isArray(dangling.blockedBy) && dangling.blockedBy.length === 1, "mint ACCEPTED a reference to an id that does not exist - normalizeBlockedBy (src/rig.mjs:434) checks shape only");
check(self.blockedBy?.[0] === selfId, "mint ACCEPTED a self-gate");
check(gatedTerminal.blockedBy?.length === 1, "mint ACCEPTED a gate on a row that is already terminal-cancelled - the laundering path exists at mint, before any edit verb");

console.log("--- 4. a stranded gate has no exit");
const rigSrc = readFileSync("src/rig.mjs", "utf8");
const removalSites = [...rigSrc.matchAll(/\.blockedBy\s*=\s*(?:null|\[\])|blockedBy:\s*null/g)];
check(removalSites.length === 0, `no path clears a gate (${removalSites.length} removal sites in src/rig.mjs): the only exit for a stranded gate is cancel_work on the dependent`);
const stranded = await workable(dangling, "impl", { items: (await items()).items, capabilities: ["implement"] });
measured(`workable(row gated on #9999) = ${JSON.stringify(stranded)}`);
check(stranded.workable === false, "the row gated on the non-existent id is permanently unworkable - not \"satisfied\": never satisfiable");

console.log("--- 5. authority is tested before state in the verbs that already exist");
const verbOrder = (name) => {
  const start = rigSrc.indexOf(`name: "${name}"`);
  const body = rigSrc.slice(start, start + 1600);
  const auth = body.search(/item\.to !== me|item\.from !== me/);
  const state = body.search(/isTerminalItem|item\.status !==|not a row you can park|already /);
  return { auth, state, order: auth >= 0 && (state < 0 || auth < state) ? "AUTHORITY first" : "STATE first" };
};
for (const v of ["cancel_work", "revise_work", "hold_work"]) {
  const o = verbOrder(v);
  measured(`${v}: authority check at +${o.auth}, state check at +${o.state} -> ${o.order}`);
  check(o.order === "AUTHORITY first", `${v} tests AUTHORITY before STATE - pm's correction 4 is right about the direction, and the new verb must do terminality first`);
}

console.log("\n=== FALSIFIER ===");
console.log(failures.length ? `RED (${failures.length} finding(s)) - the predicate is not computable as written` : "GREEN (authored accessor, validated references, terminality first)");
await harness.close();
process.exit(failures.length ? 1 : 0);
