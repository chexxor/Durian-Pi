import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Edges, compilePersona, registerSeat, RigQueue, Router, Seats, workable, isNoticeItem } from "../../../src/rig.mjs";
import { selectWakes } from "../../../src/driver.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = process.cwd();
const dir = mkdtempSync(join(tmpdir(), "offramp2-"));
const db = join(dir, "rig.sqlite");
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(await openNodeSqliteStorage(db), { models, registry }, ctx);
await harness.commit(async (tx) => {
  for (const [name, role] of [["pm", "program manager"], ["qa", "independent verifier"], ["impl", "implementation engineer"]]) {
    const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
    await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
    await registerSeat(tx, name, c.id, role);
  }
  const ed = await tx.doc(Edges);
  ed.edges = [{ from: "pm", maySendTo: ["qa", "impl"] }, { from: "qa", maySendTo: ["pm"] }, { from: "impl", maySendTo: ["pm"] }];
}, ctx);
const roster = (await harness.snapshot(Seats, undefined, ctx)).seats;
const queue = async () => harness.snapshot(RigQueue, undefined, ctx);
const item = async (id) => (await queue()).items.find((i) => i.id === id);
async function call(name, tool, args) {
  faux.setResponses([fauxAssistantMessage([fauxToolCall(tool, args)], { stopReason: "toolUse" }), fauxAssistantMessage(fauxText("done"))]);
  const c = await harness.conversation(roster[name].conversationId, ctx);
  await (await c.submit({ type: "input", content: "go" }, ctx)).wait(ctx);
  const pg = await c.entries({}, 80, undefined, ctx);
  for (const e of pg.items) {
    const t = e.model?.[0];
    if (t?.role === "toolResult") return String(t.content?.[0]?.text ?? "").slice(0, 300);
  }
  return "(no tool result found)";
}

console.log("setup: probe (pm->qa), gated row (pm->impl, blockedBy probe)");
console.log(" ", await call("pm", "send_work", { to: "qa", subject: "PROBE wake-window measurement", body: "run it", tier: "trivial" }));
const P = (await queue()).items.at(-1)?.id;
console.log(" ", await call("pm", "send_work", { to: "impl", subject: "LANDING ENTRY gated on the probe", body: "close it after the probe", blockedBy: [P], tier: "small" }));
const D = (await queue()).items.at(-1)?.id;
console.log("withdraw: ", await call("pm", "cancel_work", { itemId: P, reason: "probe withdrawn" }));

const items = (await queue()).items;
const gated = await item(D);
console.log("A. gated row: status", gated.status, "park", JSON.stringify(gated.park ?? null), "workable(impl)", JSON.stringify(workable(gated, "impl", { items, capabilities: ["implement", "code"] })));
const seats = { qa: { conversationId: roster.qa.conversationId, capabilities: ["verify", "review"] }, impl: { conversationId: roster.impl.conversationId, capabilities: ["implement", "code"] } };
const skips = [];
const wakes = selectWakes({ seats, items, onSkip: (o) => skips.push(o) });
console.log("B. wakes with the CANCELLED notice present:", JSON.stringify(wakes), "skips:", JSON.stringify(skips));
const noNotice = items.filter((i) => !isNoticeItem(i));
const wakes2 = selectWakes({ seats, items: noNotice, onSkip: (o) => skips.push(o) });
console.log("C. wakes with the notice removed:", JSON.stringify(wakes2), "skips:", JSON.stringify(skips));
console.log("D. oldest-path claim as impl:", await call("impl", "claim_work", {}));
console.log("E. by-id claim as impl on the dead-gated row:", await call("impl", "claim_work", { itemId: D }));
console.log("   row status now:", (await item(D)).status);
console.log("F. complete it anyway:", await call("impl", "complete_work", { itemId: D, resultSummary: "closed without resolving the gate" }));
console.log("   row status now:", (await item(D)).status);
const grep = spawnSync("grep", ["-n", "blockedBy", "src/rig.mjs"], { cwd: ROOT, encoding: "utf8" }).stdout.split("\n");
console.log("G. write paths that assign blockedBy:", grep.filter((l) => l.includes("item.blockedBy =") || l.includes("blockedBy: null") || l.includes("blockedBy =")).join(" ; ") || "NONE");

const chk = spawnSync(process.execPath, ["cli.mjs", "check", "rig.selfdev.json", "--json"], { cwd: ROOT, env: { ...process.env, DURIG_DB: db, DURIG_PI_DB: db }, encoding: "utf8", timeout: 120000 });
const findings = JSON.parse(chk.stdout || "{}").findings || [];
console.log("H. cli.mjs check exit", chk.status, "findings:", findings.length, "| gate-related:", findings.filter((f) => String(f.id).includes("gate") || String(f.detail).includes("gate")).map((f) => f.id + ": " + f.detail).join(" | ") || "NONE");
await harness.close(ctx);
rmSync(dir, { recursive: true, force: true });
