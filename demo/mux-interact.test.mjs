// demo/mux-interact.test.mjs — a PANE reads and interacts with its seat THROUGH THE SPOOL, never a second writer
// (goal mwpeepwa-spmy34, tasks `ownership-interact` + `keybinds-refusals`; the goal's contract (4): "every pane is
// an ATTACHED CLIENT of its seat that can read AND interact with that seat by ROUTING through the broker's existing
// spool ops, never a second writer").
//
// WHAT EACH SECTION CLOSES (nothing below this line is prose):
//   1. EVERY spool op answers BY NAME — the ones a pane's identity may apply carry a request, the ones the spool
//      gates to the operator/delegate plane refuse with the CODE the spool itself answered.
//   2. THE SPOOL'S OWN AUTHORITY DECIDES (imported authorizeSpoolRequest, applied verbatim) — this plugin does not
//      restate an op table that can drift, and it does not launder identity.
//   3. CROSS-SEAT: a pane acting on a seat it is NOT refuses BY NAME (not-operator). A pane may only be its own seat.
//   4. AN OP THE BROKER DOES NOT CARRY is refused BEFORE anything is written (op-not-carried at the core; the
//      SURFACE refuses the same typo one class earlier as value-not-in-vocabulary — both name the known set).
//   5. THROUGH THE SURFACE: /mux act PRINTS the request it would send and writes NOTHING without --run.
//   6. THE REAL SPOOL LEG: the act lands as a FILE in the broker's OWN inbox (`intentInboxDir`), the store file is
//      never created or written — that is the one-writer claim, checked, not claimed.
//   7. NO INPUT PRIMITIVE ANYWHERE: not one argv any driver emits types into a pane (a send-keys/stuff leg would
//      be the second writer that corrupted this store twice). Scanned over EMITTED ARGV, not over comments.
//   8. THE DRAIN LEG, END TO END: TWO PANES ON ONE SEAT. The acts are admitted by the broker's OWN drain
//      (`drainIntentInbox`), each answered by the broker's OWN result record (its requestId, ok, op, seat), and
//      BOTH panes' words land in ONE conversation — N panes read/write the SAME session, never N seats, never N
//      drivers. Seam cost measured 2026-11-21 on Linux / Fedora Linux 45 / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1:
//      §8 is 0.03 s of the pin's 0.04 s (wall 0.18 s) — faux plane, MemoryStorage, no network, no key, no sleep.
//
// HERMETIC: seats are handed in through the core's read seams; the store named is a temp dir under os.tmpdir().
// The rig's live store must not move by a byte. Run: node demo/mux-interact.test.mjs (exit 0 = pass)
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  muxActRequest,
  muxSurfaceInvoke,
  muxSurfaceDrivers,
  muxRefusalText,
  MUX_USAGE,
} from "../tools/mux-surface-core.mjs";
import {
  SPOOL_OPS,
  authorizeSpoolRequest,
  writeIntent,
  readIntentFiles,
  pendingIntentCensus,
  intentInboxDir,
  intentResultDir,
  readIntentResult,
  readIntentError,
  drainIntentInbox,
  OPERATOR,
  DELEGATE,
} from "../src/broker.mjs";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { Router, Seats, compilePersona, registerSeat } from "../src/rig.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const tmp = mkdtempSync(join(tmpdir(), "durig-mux-act-"));
const liveStore = join(ROOT, "selfdev.sqlite");
const statOf = (p) => (existsSync(p) ? statSync(p).mtimeMs : null);
const liveStoreBefore = statOf(liveStore);
const liveSizeBefore = statSync(liveStore).size;

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) return;
  failures += 1;
  process.stdout.write(`FAIL ${label}: ${detail}\n`);
};

// A pane is a VIEWPORT that knows ONE seat: the pane is named after that seat. That identity is all it gets.
const selfPane = { paneName: "impl", seat: "impl", conversationId: "conv-impl" };
const OTHER = "qa";
// What the CORE considers seat-routed (its own set, restated here ONLY to know which requests carry a `to`).
const SEAT_ROUTED = new Set(["stop", "reset", "compact", "pause", "unpause", "configure", "queue", "input", "message"]);
const tmpStore = join(tmp, "w0", "selfdev.sqlite");

console.log("=== 1. EVERY SPOOL OP ANSWERS BY NAME ===");
const t0 = Date.now();
const expected = {
  // what the spool's own sets say a pane (which is neither the operator nor the delegate) may apply, and the CODE
  // it answers with. BUILT FROM the imported sets, so a future spool op inherits the door instead of this list.
  message: "content-op",
  read: "content-op",
  input: "content-op",
  stop: "self-target",
  reset: "self-target",
  compact: "self-target",
};
const gated = { pause: "not-operator", unpause: "not-operator", configure: "not-operator", queue: "not-operator-plane" };
check("the test's op census IS the broker's own SPOOL_OPS (no second vocabulary here)", JSON.stringify([...SPOOL_OPS].sort()) === JSON.stringify([...Object.keys(expected), ...Object.keys(gated)].sort()), SPOOL_OPS.join(","));
for (const op of SPOOL_OPS) {
  const a = muxActRequest(selfPane, { op, text: (op === "message" ? "steer me" : null) });
  const wantAllowed = expected[op] !== undefined;
  check(`\`${op}\` answers ${wantAllowed ? "ADMITTED" : "REFUSED BY NAME"}`, wantAllowed ? a.ok === true : a.ok === false && !!a.code, JSON.stringify({ ok: a.ok, code: a.code }).slice(0, 120));
  if (wantAllowed) {
    check(`and the code it carries is the SPOOL'S own (${expected[op]})`, a.authorized?.code === expected[op], `${a.authorized?.code} vs ${expected[op]}`);
    check(`and the request names the PANE as its from, so a reader can attribute it`, a.request.from === "impl", JSON.stringify(a.request));
    if (SEAT_ROUTED.has(op)) check(`and a seat-routed op names the pane's OWN seat as to (self-target, never another seat)`, a.request.to === "impl", JSON.stringify(a.request));
    if (op === "input") check(`and \`input\` carries the pane's conversation token, which is what the spool needs`, a.request.conversation === "conv-impl", JSON.stringify(a.request));
    if (op === "message") check(`and \`message\` carries the sentence, so the act is the whole ask`, a.request.content === "steer me", JSON.stringify(a.request));
  } else {
    check(`and the refusal names the code AND the op, so a session can correct itself`, a.refusal.includes(gated[op]) && a.refusal.includes(op), a.refusal.slice(0, 240));
    check(`and nothing was written for a refused op`, !existsSync(`${tmpStore}.broker.inbox`) && !existsSync(tmpStore), "the refusal is before any write");
  }
}

console.log("\n=== 2. THE SPOOL'S OWN AUTHORITY DECIDES, NOT A RESTATED LIST ===");
const direct = authorizeSpoolRequest({ op: "pause", from: "impl" }, { op: "pause" });
const viaCore = muxActRequest(selfPane, { op: "pause" });
check("the core's answer and the spool's own answer agree on the same code", direct?.code === viaCore?.code && viaCore?.code === "not-operator", `${direct?.code} / ${viaCore?.code}`);
check("and the gate's own detail is carried, so the reader sees WHO may apply it", viaCore.refusal.includes(OPERATOR) || viaCore.refusal.includes("operator"), viaCore.refusal.slice(0, 300));
check("and the plugin never claims an identity it does not have (from is a pane, so OPERATOR/DELEGATE are unreachable here)", !SPOOL_OPS.some((op) => muxActRequest(selfPane, { op }).ok === true && gated[op]), `${OPERATOR}/${DELEGATE} are not pane names`);

console.log("\n=== 3. A PANE ACTING ON A SEAT IT IS NOT IS REFUSED (no cross-seat from a pane) ===");
const crossPane = { paneName: "impl", seat: OTHER, conversationId: "conv-other" };
const x = muxActRequest(crossPane, { op: "stop" });
check("stop aimed at another seat is REFUSED (not-operator)", x.ok === false && x.code === "not-operator", JSON.stringify({ ok: x.ok, code: x.code }));
check("and the refusal names both the target and the pane, so it is attributable", x.refusal.includes(`"qa"`) && x.refusal.includes("impl"), x.refusal.slice(0, 300));
check("and the same op aimed at the pane's OWN seat is admitted (the only thing a pane may do)", (() => { const a = muxActRequest(selfPane, { op: "stop" }); return a.ok === true && a.authorized?.code === "self-target"; })(), "self-target");

console.log("\n=== 4. AN OP THE BROKER DOES NOT CARRY IS REFUSED BEFORE ANY WRITE ===");
const bogus = muxActRequest(selfPane, { op: "teleport" });
check("an op the broker does not carry is refused (op-not-carried)", bogus.ok === false && bogus.code === "op-not-carried", JSON.stringify({ ok: bogus.ok, code: bogus.code }));
check("and it prints the ops the broker DOES carry", SPOOL_OPS.every((o) => bogus.refusal.includes(o)), bogus.refusal.slice(0, 400));
const registry = await muxSurfaceDrivers({ dir: join(ROOT, "tools"), env: {} });
const seats = [{ name: "impl", conversationId: "conv-impl" }, { name: "qa", conversationId: "conv-qa" }];
const store = join(tmp, "w1", "selfdev.sqlite");
const seams = { drivers: registry, readSeats: async () => seats, readRows: async () => [], sessions: async () => [] };
const surfaceBogus = await muxSurfaceInvoke("act impl --op teleport", { env: {}, cwd: ROOT, seams, store });
check("the SAME typo through the SURFACE refuses one class earlier (a value outside a closed vocabulary)", surfaceBogus.ok === false && surfaceBogus.exitCode === 1 && surfaceBogus.show[0].body.includes("is not in the vocabulary."), JSON.stringify(surfaceBogus.show[0].body).slice(0, 220));
check("and it names the known ops too, so the correction is complete", SPOOL_OPS.every((o) => surfaceBogus.show[0].body.includes(o)), surfaceBogus.show[0].body.slice(0, 400));
check("and no pane census was printed for it", !surfaceBogus.show.some((l) => l.body.includes("mux census —")), "no fail-open census");

console.log("\n=== 5. THROUGH THE SURFACE: the request is PRINTED, nothing is written ===");
const actAsk = await muxSurfaceInvoke("act impl --op message --text \"steer me\"", { env: {}, cwd: ROOT, seams, store });
check("`act <seat> --op message --text ...` answers ok (the act itself is the spool's, not a pane write)", actAsk.ok === true && actAsk.exitCode === 0, JSON.stringify({ ok: actAsk.ok, exit: actAsk.exitCode }));
const actBody = actAsk.show.map((l) => l.body).join("\n");
check("and it PRINTS the spool request it is holding, attributed to the pane and the seat", actBody.includes("act — pane impl seat impl spool op message") && actBody.includes("\"op\":\"message\"") && actBody.includes("\"from\":\"impl\""), actBody.slice(0, 400));
check("and it says the ask did not pass --run, so nothing moved", !/act RESULT/.test(actBody), "no RESULT line: nothing was delivered");
check("and NOTHING was written to any inbox for it", !existsSync(intentInboxDir(store)) && readIntentFiles(store).length === 0, JSON.stringify(readIntentFiles(store)));
check("and the store itself was never created by an act", !existsSync(store), `store ${existsSync(store)}`);

console.log("\n=== 6. THE REAL SPOOL LEG: a FILE in the broker's inbox, never a write to the store ===");
const admitted = muxActRequest(selfPane, { op: "message", text: "hello from the pane" });
const written = writeIntent(store, { ...admitted.request, conversation: "conv-impl", createdAt: new Date().toISOString() });
const inbox = readIntentFiles(store);
const census = pendingIntentCensus(store, { now: Date.now() });
check("the act lands as ONE file in the broker's OWN inbox", existsSync(written) && inbox.length === 1 && String(written).startsWith(intentInboxDir(store)), `${written} inbox ${inbox.length}`);
check("and the broker's own census sees it pending (mutations, not reads)", census.count === 1 && census.mutations === 1 && census.reads === 0, JSON.stringify(census));
check("and reading it back is the SAME request (atomic write, no half-doc)", (() => { const p = JSON.parse(readFileSync(inbox[0], "utf8")); return p.op === "message" && p.from === "impl" && p.to === "impl" && p.content === "hello from the pane"; })(), inbox[0]);
check("and the STORE file still does not exist — an intent is a FILE, the store is opened by its ONE owner", !existsSync(store), `store ${existsSync(store)}`);
check("and no dead-letter was produced beside it", !existsSync(`${store}.broker.inbox.error`), "error dir absent");

console.log("\n=== 7. NO INPUT PRIMITIVE IN ANY EMITTED ARGV (a pane is never typed into) ===");
const verbs = ["list", "open", "attach", "detach", "kill", "capture", "halt"];
const INPUT = /^(send-keys|stuff|paste|paste-file|write-chars|send-text)$/;
const shapes = [
  { index: 0, total: 1, pane: { seat: "impl", paneName: "impl" } },
  { index: 1, total: 2, pane: { seat: "qa", paneName: "qa" } },
  { index: 0, total: 0, pane: null },
];
const seen = [];
const notes = [];
for (const [name, rec] of registry.drivers) {
  const d = rec.driver;
  check(`the ${name} driver names NO \`act\` command (an act is backend-free: the broker's spool)`, !Object.keys(d?.commands ?? {}).includes("act"), `${name} commands ${Object.keys(d?.commands ?? {}).join(",")}`);
  for (const verb of verbs) {
    for (const shape of shapes) {
      const made = d.commands?.[verb]?.({ sessionName: "durian-w1", sessionTag: "9001.durian-w1", tag: "durian-w1", namespace: "plugin", pane: shape.pane, store, backend: name, verb, index: shape.index, total: shape.total });
      if (!made) continue;
      if (!made.argv) { notes.push(`${name} ${verb} -> NO argv (a named gap)`); continue; }
      seen.push({ backend: name, verb, argv: made.argv });
    }
  }
}
const flat = seen.flatMap((s) => s.argv.map(String));
check("not one token in ANY emitted argv is an input primitive", !flat.some((t) => INPUT.test(t)) && !flat.some((t) => /send-keys|stuff|paste|write-chars|send-text/.test(t)), `${flat.length} tokens scanned; ${seen.length} argvs`);
check("so every pane action is VIEWPORT-only (list/open/attach/detach/kill/capture/halt)", seen.every((s) => !["act"].includes(s.verb)), `${seen.length} named commands across 4 backends x 7 verbs x 3 shapes`);
check("and a backend that cannot name an ask emits NO argv rather than a plausible one", notes.length >= 4 && notes.every((n) => n.includes("NO argv")), `${notes.length} gaps: ${notes.slice(0, 4).join(" | ")}`);

console.log("\n=== 8. TWO PANES, ONE SEAT: THE BROKER'S OWN DRAIN AND ITS OWN RECORD ANSWER ===");
const t8 = Date.now();
const pctx = BACKGROUND_CONTEXT;
const fauxP = fauxProvider({ models: [{ id: "faux-seat" }] });
fauxP.setResponses(Array.from({ length: 8 }, () => fauxAssistantMessage("acknowledged, no tool call")));
const modelsP = createModels();
modelsP.setProvider(fauxP.provider);
const regP = createRegistry();
regP.install(Router);
const memStorage = new MemoryStorage();
const harness = await Harness.open(memStorage, { models: modelsP, registry: regP }, pctx);
let convId = null;
await harness.commit(async (tx) => {
  const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role: "worker" }) });
  await registerSeat(tx, "impl", c.id, "worker");
  convId = c.id;
}, pctx);
check("ONE seat owns ONE conversation token (the session every pane of that seat attaches to)", convId !== null, `conv ${convId}`);
const spoolStore = join(tmp, "w8", "selfdev.sqlite");
const pA = { paneName: "impl-1", seat: "impl", conversationId: convId };
const pB = { paneName: "impl-2", seat: "impl", conversationId: convId };
check("two panes of one seat hold the SAME conversation token (one session, two viewports)", pA.conversationId === pB.conversationId && pA.conversationId === convId, `${pA.conversationId}/${pB.conversationId}`);
const rA = muxActRequest(pA, { op: "message", text: "PANE-ONE: steer from the first viewport" });
const rB = muxActRequest(pB, { op: "message", text: "PANE-TWO: steer from the second viewport" });
check("BOTH acts are admitted at the core: two `from`, ONE `to`, no second vocabulary", rA.ok && rB.ok && rA.request.to === "impl" && rB.request.to === "impl" && rA.request.from === "impl-1" && rB.request.from === "impl-2" && rA.admitted === "content-op" && rB.admitted === "content-op", `${rA.request.from}->${rA.request.to} / ${rB.request.from}->${rB.request.to}`);
check("and the request carries the SEAT NAME only, never a conversation token the pane could stale-cache", !!("conversation" in rA.request) === false && !!("conversation" in rB.request) === false, `request keys ${Object.keys(rA.request).join(",")}`);
const fA = writeIntent(spoolStore, { ...rA.request, requestId: "pane-1", createdAt: new Date().toISOString() });
const fB = writeIntent(spoolStore, { ...rB.request, requestId: "pane-2", createdAt: new Date().toISOString() });
check("both acts land as files in the broker's OWN inbox before any admission", readIntentFiles(spoolStore).length === 2, `${readIntentFiles(spoolStore).length} files`);
const drained = await drainIntentInbox(harness, memStorage, { dbPath: spoolStore, context: pctx });
check("the broker admits BOTH through its OWN drain (delivered 2, nothing dead-lettered)", drained?.delivered === 2 && drained?.deadLettered === 0 && drained?.duplicates === 0, JSON.stringify(drained));
check("and the spool is EMPTY after the drain (one writer consumed both files)", readIntentFiles(spoolStore).length === 0, `${readIntentFiles(spoolStore).length}`);
const recA = readIntentResult(spoolStore, "pane-1");
const recB = readIntentResult(spoolStore, "pane-2");
check("each pane's act is answered by the BROKER'S OWN record (its requestId, ok, op, seat)", recA?.requestId === "pane-1" && recA?.ok === true && recA?.op === "message" && recB?.requestId === "pane-2" && recB?.ok === true && recB?.op === "message", `${JSON.stringify(recA)} ${JSON.stringify(recB)}`);
check("and both records name the SAME seat — one conversation resolved from the broker's OWN roster, not from the panes", recA?.result?.seat === "impl" && recB?.result?.seat === "impl" && recA?.result?.delivered === true && recB?.result?.delivered === true, `${recA?.result?.seat}/${recB?.result?.seat}`);
check("and neither act was dead-lettered", readIntentError(spoolStore, "pane-1") === null && readIntentError(spoolStore, "pane-2") === null, `${readIntentError(spoolStore, "pane-1")}/${readIntentError(spoolStore, "pane-2")}`);
check("and the records live in the broker's OWN result channel beside the spool", existsSync(intentResultDir(spoolStore)), intentResultDir(spoolStore));
await harness.waitForIdle(pctx);
const conv = await harness.conversation(convId, pctx);
const page = await conv.entries({}, 500, undefined, pctx);
const bodies = page.items.map((e) => JSON.stringify(e));
check("the seat's conversation carries BOTH panes' words (the same session read and written by two viewports)", bodies.some((s) => s.includes("PANE-ONE")) && bodies.some((s) => s.includes("PANE-TWO")), `entries ${page.items.length}`);
check("and BOTH arrived as user turns in that ONE conversation (two deliveries, one inbox, one session)", page.items.filter((e) => e.kind === "pi.user" && /PANE-(ONE|TWO)/.test(JSON.stringify(e))).length === 2, `user turns ${page.items.filter((e) => e.kind === "pi.user").length}`);
const roster = (await harness.snapshot(Seats, undefined, pctx))?.seats ?? {};
check("and the roster still holds exactly ONE seat for that conversation (N panes never N seats)", Object.keys(roster).length === 1 && roster.impl?.conversationId === convId, `seats ${Object.keys(roster).join(",")}`);
check("and the store FILE was never created by any of this (the spool is the transport)", !existsSync(spoolStore), `${existsSync(spoolStore)}`);
try {
  await harness.close(pctx);
} catch (err) {
  check("the faux plane closed cleanly", false, `harness close: ${err?.message ?? err}`);
}
const secs8 = ((Date.now() - t8) / 1000).toFixed(2);

rmSync(tmp, { recursive: true, force: true });
check("and the rig's live store did not move by a byte for this whole gate", statOf(liveStore) === liveStoreBefore, `selfdev.sqlite mtime ${liveStoreBefore} -> ${statOf(liveStore)}`);
check("and its size is unchanged", statSync(liveStore).size === liveSizeBefore, `size ${liveSizeBefore} -> ${statSync(liveStore).size}`);
check("and the spool gate never saw the operator's own inbox touched", !existsSync(`${liveStore}.broker.inbox`) || readIntentFiles(liveStore).length === 0, `rig inbox files ${readIntentFiles(liveStore).length}`);
const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  process.stdout.write(`\nMUX-INTERACT PASS (${secs}s total) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — a pane is an ATTACHED CLIENT, not a writer: all ${SPOOL_OPS.length} broker spool ops answer BY NAME through the IMPORTED authorizeSpoolRequest (admitted with the spool's own codes content-op/self-target; pause,unpause,configure refused not-operator and queue refused not-operator-plane because a pane is neither ${OPERATOR} nor ${DELEGATE}); a pane aimed at ANOTHER seat is refused not-operator while the same op on its OWN seat is admitted self-target; an op the broker does not carry is refused op-not-carried at the core and value-not-in-vocabulary at the surface, each printing the full known set and NO partial census; /mux act PRINTS the request and writes NOTHING (inbox files 0 without --run); the real spool leg lands ONE FILE in <store>.broker.inbox (pendingIntentCensus count 1 mutations 1) while the store file is never created — one writer, not two; and not one token among ${flat.length} argv tokens the four drivers emit is an input primitive (no send-keys, no stuff), with ${notes.length} named gaps emitting NO argv instead of a plausible command. §8 then ran the DRAIN LEG END TO END (${secs8}s of the ${secs}s, on the hermetic faux/MemoryStorage plane): two panes impl-1/impl-2 of ONE seat both admitted at the core with the spool's own content-op, each carrying only the SEAT NAME (never a conversation token), both landed as spool files, drainIntentInbox delivered ${JSON.stringify(drained)}, the broker's OWN result records answered each by its own requestId/op/ok/seat and named the SAME seat, neither was dead-lettered, the seat's conversation carries BOTH panes' words, and the roster still holds exactly ONE seat — N panes read/write the SAME session through the broker's record, never N drivers. The rig's ${liveSizeBefore}-byte live store did not move by a byte.\n`);
  process.exit(0);
}
process.stdout.write(`${failures} FAILURE(S)\n`);
process.exit(1);
