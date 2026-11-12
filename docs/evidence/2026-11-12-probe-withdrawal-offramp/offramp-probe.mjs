import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Edges, compilePersona, registerSeat, RigQueue, Router, Seats, workable } from "../../../src/rig.mjs";
import { selectWakes } from "../../../src/driver.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "offramp-"));
const db = join(dir, "rig.sqlite");
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(await openNodeSqliteStorage(db), { models, registry }, ctx);

await harness.commit(async (tx) => {
  for (const [name, role] of [["pm", "program manager"], ["qa", "independent verifier"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
    await registerSeat(tx, name, c.id, role);
  }
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "pm", maySendTo: ["qa"] }, { from: "qa", maySendTo: ["pm"] }];
}, ctx);

const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const queue = async () => harness.snapshot(RigQueue, undefined, ctx);
const item = async (id) => (await queue()).items.find((i) => i.id === id);

async function call(name, tool, args) {
  faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("done"))]);
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  const pg = await c.entries({}, 80, undefined, ctx);
  const hits = pg.items.filter((e) => String(e.type).toLowerCase().includes("tool"));
  return hits.length ? hits.map((e) => JSON.stringify(e.content ?? e)).join(" | ").slice(0, 600) : JSON.stringify(pg.items).slice(0, 600);
}

console.log("=== 1. register the probe and the row gated on it ===");
console.log("  send probe ->", await call("pm", "send_work", { to: "qa", subject: "PROBE measure the wake window", body: "run the probe and report", tier: "trivial" }));
const P = (await queue()).items.at(-1)?.id;
console.log("  send gated row ->", await call("pm", "send_work", { to: "qa", subject: "LANDING ENTRY gated on the probe", body: "close the entry once the probe reports", blockedBy: [P], tier: "small" }));
const D = (await queue()).items.at(-1)?.id;
console.log("  probe id", P, "gated row id", D, "status", (await item(D)).status, "blockedBy", JSON.stringify((await item(D)).blockedBy));

console.log("=== 2. withdraw the probe ===");
console.log("  cancel_work ->", await call("pm", "cancel_work", { itemId: P, reason: "probe withdrawn: the measurement is no longer wanted" }));
const probe = await item(P);
console.log("  probe now:", probe.status, "| cancelReason:", probe.cancelReason);
const notice = (await queue()).items.find((i) => i.subject.startsWith("CANCELLED " + P));
console.log("  notice to the other party:", notice ? "#" + notice.id + " to=" + notice.to + " status=" + notice.status + " notice=" + notice.notice : "NONE");

console.log("=== 3. state of the gated row ===");
const gated = await item(D);
const items = (await queue()).items;
console.log("  status:", gated.status, "blockedBy:", JSON.stringify(gated.blockedBy), "park:", JSON.stringify(gated.park ?? null));
console.log("  workable(qa):", JSON.stringify(workable(gated, "qa", { items, capabilities: ["verify", "review"] })));
const seats = { qa: { conversationId: roster.qa.conversationId, capabilities: ["verify", "review"] }, pm: { conversationId: roster.pm.conversationId, capabilities: ["route", "plan"] } };
console.log("  selectWakes:", JSON.stringify(selectWakes({ seats, items })));
const skips = [];
selectWakes({ seats, items, onSkip: (n, r) => skips.push([n, r]) });
console.log("  onSkip trace:", JSON.stringify(skips));

console.log("=== 4. can the seat act on it? ===");
console.log("  claim_work oldest-path ->", await call("qa", "claim_work", {}));
console.log("  claim_work by-id ->", await call("qa", "claim_work", { itemId: D }));
console.log("  gated row status after both attempts:", (await item(D)).status);

console.log("=== 5. CLI surface on the same store ===");
const cli = (args) => { const r = spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: ROOT, env: { ...process.env, DURIG_DB: db, DURIG_PI_DB: db }, encoding: "utf8", timeout: 120000 }); return { code: r.status, out: (r.stdout ?? "").slice(0, 500), err: (r.stderr ?? "").slice(0, 200) }; };
const q = cli(["queue", "--id", String(D), "--no-body"]);
console.log("  cli.mjs queue --id", D, "exit", q.code, "->", q.out.replace(/\n\s+/g, " ").slice(0, 300));
const chk = cli(["check", "rig.selfdev.json", "--json"]);
console.log("  cli.mjs check exit", chk.code, "->", (chk.out + chk.err).slice(0, 300));

await harness.close(ctx);
rmSync(dir, { recursive: true, force: true });
