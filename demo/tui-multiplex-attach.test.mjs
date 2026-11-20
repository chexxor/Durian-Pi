// demo/tui-multiplex-attach.test.mjs — the MULTIPLEXER: N clients, ONE merged inbox, ONE broadcast
//
// WHAT THIS PINS (goal mwn0dyqj-5pfi52 task-6, src/multiplex.mjs). task-5 made the durable TUI a
// read-only ATTACH to the session the broker owns. That is only half of a tmux-like multiplexer:
// several clients must be attached at once, each typing, each seeing, and NO client allowed to
// become a second owner. This pin runs that shape hermetically — two attached clients, one store,
// one writer Harness, the mocked fauxProvider plane — and asserts the four pi-durable admission
// legs, the ONE ID-ordered merged input stream, and that BOTH clients receive the SAME broadcast.
//
// THE ADMISSION TABLE, quoted from vendor/pi-main/packages/durable/docs/spec.md §6 (header
// :2912 "Admission and terminal transitions:", rows :2916 / :2922 / :2928, `whenIdle` note :2936):
//   | input, idle with empty inbox | `placed`, with user entry | create run and generation |
//   | input or other write, busy or non-empty inbox | `queued` | append inbox item |
//   | withdraw queued item | `unanswered`, reason `aborted` | remove inbox item |
//   | input with `whenIdle: "reject"`, idle | none | reject with `ConversationIdle` |
// And the merged-stream contract, spec.md:2877: "Items are in ID order." — that sentence IS the
// product's "N clients, one ordered stream", so this layer never re-sorts (src/multiplex.mjs
// mergedInputStream reads Storage#scanSubmissions, types.d.ts:1172, in the same default order).
//
// THE TWO BROADCAST LEGS, measured before this pin was written (.spike/probe-watch-fanout2.mjs,
// 2026-11-20, Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1):
//   FANOUT-ON-OWNING-HANDLE WORKS — spec §9.1 "start() installs the sole serialized asynchronous
//     listener", so one Chord WatchHandle feeds ONE listener: N clients = N watch ACQUISITIONS on
//     the session-owning Harness, and each client's listener gets the same event sequence.
//   VIEWER-WATCH-BROADCAST IS DEAD — a watch acquired through a readOnly Harness on a SEPARATE
//     handle receives ZERO commits (spec.md:2054-2057 "the Session's own observers see each held
//     commit"; :838-840 a readOnly open "loads live tasks as committed, reconciles nothing"). What
//     DOES cross is a READ, so an attached client's leg is a RE-READ and `leg` says which.
//
// ONE-HANDLE RULE: a second open on the SAME in-process Storage object poisons the first Harness
// (SessionFailed, durable dist/session/session.js:1432 #assertHealthy), so every "process" here
// gets its own openNodeSqliteStorage handle. Run: node demo/tui-multiplex-attach.test.mjs (exit 0
// = pass; ~2-4 s on the faux plane)

import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, LiveDoc, ConversationIdle } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import { SUBSCRIBE, createMultiplexer, multiplexAttach, mergedInputStream, inboxView, isConversationIdle } from "../src/multiplex.mjs";
import { Router, registerSeat } from "../src/rig.mjs";
import { drainIntentInbox, intentInboxDir } from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

// A response that keeps RUNNING long enough that a second and third input arrive WHILE it is in
// flight — that is the only way to reach the `queued` row of the admission table.
const responseFor = (_context, _options, _state, _model) =>
  new Promise((resolve) => setTimeout(() => resolve(fauxAssistantMessage("MULTIPLEX-REPLY")), 350));
faux.setResponses(Array.from({ length: 24 }, () => responseFor));

const repoRoot = new URL("..", import.meta.url).pathname;
const rigStore = join(repoRoot, "selfdev.sqlite");
const rigStoreBefore = (() => { const s = statSync(rigStore); return `${s.mtimeMs}/${s.size}`; })();

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}

async function attempt(label, fn) {
  try {
    await fn();
    check(label, true);
  } catch (err) {
    check(label, false, `${err?.name ?? "Error"}: ${err?.message}`);
  }
}

async function expectRefusal(label, fn, nameRe, messageRe = /.*/) {
  try {
    await fn();
    check(label, false, "SETTLED — the operation that must be refused was allowed");
  } catch (err) {
    const name = err?.name ?? "Error";
    const message = err?.message ?? "";
    check(`${label} REFUSED by name`, nameRe.test(name) && messageRe.test(message),
      `${name}: ${message} — wanted name ${nameRe}, message ${messageRe}`);
  }
}

// inbox `content` is a UserInput (a string or a content-block array, spec.md:2862-2874); flatten
// it so a pin can name WHICH client's words landed in which slot of the merged stream.
const text = (c) =>
  typeof c === "string" ? c
    : Array.isArray(c) ? c.map((b) => b?.text ?? "").join("")
    : JSON.stringify(c);
const types = (ev) => ev.map((e) => e.type).join(",");

const dir = mkdtempSync(join(tmpdir(), "durig-multiplex-"));
const store = join(dir, "store.sqlite");
const stat2 = (p) => { const s = statSync(p); return `${s.mtimeMs}/${s.size}`; };

async function openHandle() {
  return await openNodeSqliteStorage(store, { busyTimeoutMs: 15_000 });
}

const ascending = (xs) => xs.every((v, i) => i === 0 || xs[i - 1] < v);

// ---------- (1) TWO clients on ONE session: the four admission legs + ONE broadcast ----------
async function multiplexerPlane() {
  console.log("\n=== (1) TWO CLIENTS, ONE STORE, ONE WRITER — the admission table, then the fan-out ===");
  const writerStorage = await openHandle();
  const writer = await Harness.open(writerStorage, { models, registry }, ctx);
  const root = await writer.root(ctx, {
    agent: { model: { provider: "faux", modelId: "faux-seat" }, cwd: process.cwd() },
  });
  await writer.commit(async (tx) => { await registerSeat(tx, "solo", root.id, "worker"); }, ctx);
  check("the writer (the broker's stand-in) registered a seat ON the root conversation", true);

  const mux = createMultiplexer();
  const a = await multiplexAttach(writer, root.id, { client: "alpha", docs: ["live", "inbox"], context: ctx });
  const b = await multiplexAttach(writer, root.id, { client: "beta", docs: ["live", "inbox"], context: ctx });
  mux.attach(a); mux.attach(b);

  check("TWO clients attach to ONE session at ONE conversation token", a.id === "alpha" && b.id === "beta", `${a.id} ${b.id}`);
  check("both owner legs are WATCH subscriptions on SUBSCRIBE tokens",
    a.leg === "watch" && b.leg === "watch" &&
    a.watches.map((w) => w.name).join(",") === "live,inbox" &&
    Object.keys(SUBSCRIBE).join(",") === "live,inbox",
    `alpha=${a.leg}/${a.watches.map((w) => w.name).join(",")} tokens=${Object.keys(SUBSCRIBE).join(",")}`);

  // ROW: `input, idle with empty inbox | placed, with user entry | create run and generation`
  const inbox0 = await inboxView(writer, root.id, ctx);
  check("the inbox starts EMPTY (the idle row's precondition)", inbox0.length === 0, `n=${inbox0.length}`);
  const first = await a.act("ALPHA-1 show me the open rows");
  const firstRec = await first.status(ctx);
  check(`idle + empty inbox -> ${firstRec.status} (row spec.md:2916)`, firstRec.status === "placed", firstRec.status);
  check("  placed WITH a user entry", Boolean(firstRec.entry), `entry=${firstRec.entry ?? "-"}`);
  const live1 = await writer.snapshot(LiveDoc, root.id, ctx);
  check("  the admission created a run and a generation (pi.live.run is set)", live1?.run !== undefined,
    `keys=${Object.keys(live1 ?? {}).join(",")}`);

  // ROW: `input or other write, busy or non-empty inbox | queued | append inbox item`
  const second = await b.act("BETA-2 rescore the open rows");
  const third = await a.act("ALPHA-3 hold the broker until Friday");
  const s2 = await second.status(ctx);
  const s3 = await third.status(ctx);
  check(`busy -> ${s2.status} and ${s3.status} (row spec.md:2922)`, s2.status === "queued" && s3.status === "queued",
    `${s2.status}/${s3.status}`);
  const inbox = await inboxView(writer, root.id, ctx);
  check("pi.inbox holds BOTH queued items, from BOTH clients", inbox.length === 2, `n=${inbox.length}`);
  check("ONE ID-ordered stream across the clients (spec.md:2877 \"Items are in ID order.\")",
    ascending(inbox.map((i) => i.id)) && inbox.every((i) => [second.id, third.id].includes(i.id)),
    `ids=${inbox.map((i) => i.id).join(",")} wanted=${second.id},${third.id}`);
  check("the merged stream carries each client's own words in that ID order",
    text(inbox[0].content).includes("BETA-2") && text(inbox[1].content).includes("ALPHA-3"),
    `contents=${inbox.map((i) => text(i.content)).join(" | ")}`);
  check("the layer did not re-sort: the stream is the built-in pi.inbox (kind pi.inbox)",
    inbox.every((i) => i.mode === "followUp"), `modes=${inbox.map((i) => i.mode).join(",")}`);

  // ROW: `withdraw queued item | unanswered, reason aborted | remove inbox item`
  const withdrawal = await second.abort(ctx);
  const afterAbort = await second.status(ctx);
  check(`Submission.abort() withdraws the still-queued item -> ${withdrawal}`, withdrawal === "aborted", withdrawal);
  check("  the record settles unanswered with reason aborted (spec.md:2928)",
    afterAbort.status === "unanswered" && afterAbort.reason === "aborted",
    `${afterAbort.status}/${afterAbort.reason ?? "-"}`);
  const inboxAfter = await inboxView(writer, root.id, ctx);
  check("  the inbox item is REMOVED (the one stream lost exactly that client's input)",
    inboxAfter.length === 1 && inboxAfter[0].id === third.id,
    `ids=${inboxAfter.map((i) => i.id).join(",")}`);

  // the run answers, then the conversation is idle
  const settled = await first.wait(ctx);
  check("the run answered the placed input (done)", settled.status === "done", `${settled.status}`);
  await writer.waitForIdle(ctx);

  // ROW: `input with whenIdle: "reject", idle | none | reject with ConversationIdle`
  const inboxBeforeReject = await inboxView(writer, root.id, ctx);
  let idleErr = null;
  try {
    const r = await b.act("BETA-4 never start a run", { whenIdle: "reject" });
    check("whenIdle:\"reject\" while idle SETTLED (it must not)", false, `id=${r?.id}`);
  } catch (err) {
    idleErr = err;
    check(`whenIdle:"reject" while idle REFUSES with ${ConversationIdle.name} BY NAME`,
      idleErr?.name === ConversationIdle.name, `${idleErr?.name}: ${idleErr?.message}`);
    check("the layer classifies its own refusal (isConversationIdle)", isConversationIdle(idleErr), "");
    const inboxAfterReject = await inboxView(writer, root.id, ctx);
    check("  the refusal writes NO inbox item (nothing queued, no run started)",
      inboxAfterReject.length === inboxBeforeReject.length, `${inboxAfterReject.length} vs ${inboxBeforeReject.length}`);
  }

  // THE BROADCAST: fan-out on the OWNING handle (spec §9.1: one listener per WatchHandle)
  await writer.waitForIdle(ctx);
  await new Promise((k) => setTimeout(k, 60));
  const liveA = a.events.filter((e) => e.via === "live");
  const liveB = b.events.filter((e) => e.via === "live");
  check("BOTH attached clients received a broadcast", liveA.length > 0 && liveB.length > 0,
    `alpha=${liveA.length} beta=${liveB.length}`);
  check("BOTH received the SAME output sequence (N watches, one Session line)",
    types(liveA) === types(liveB), `alpha=${types(liveA)} beta=${types(liveB)}`);
  for (const t of ["run_start", "turn_start", "message_start", "run_end"]) {
    check(`  the broadcast contains ${t} (the rig's own livewatch shapes)`, types(liveA).includes(t), types(liveA));
  }
  const inboxA = a.events.filter((e) => e.via === "inbox");
  const inboxB = b.events.filter((e) => e.via === "inbox");
  check("BOTH panes showed the SAME queued items, in the same order (one stream, N readers)",
    inboxA.map((e) => e.id) .join(",") === inboxB.map((e) => e.id).join(",") && inboxA.length >= 2,
    `alpha=${inboxA.map((e) => e.id).join(",")} beta=${inboxB.map((e) => e.id).join(",")}`);

  // THE MERGED STREAM, as the library sees it (a Storage read, not a per-client view)
  const subs = await mergedInputStream(writerStorage, { conversationId: root.id, limit: 50 }, ctx);
  check("mergedInputStream is ONE page of submission records across every client", subs.length >= 3, `n=${subs.length}`);
  check("the merged stream is ID-ordered (types.d.ts:1172, default ascending)",
    ascending(subs.map((s) => s.id)), `ids=${subs.map((s) => s.id).join(",")}`);
  check("every client's own input is in that ONE stream",
    subs.some((s) => s.id === first.id) && subs.some((s) => s.id === second.id) && subs.some((s) => s.id === third.id),
    `ids=${subs.map((s) => s.id).join(",")}`);
  console.log(`  merged stream: ${subs.map((s) => `${s.id}:${s.status}`).join(" ")}`);

  check("the client registry lists both panes and holds no session of its own",
    mux.clients().join(",") === "alpha,beta" && mux.list().length === 2, mux.clients().join(","));

  await attachedPlane(writer, root.id, writerStorage);
  await writer.close(ctx);
  check("the writer closed with close(ctx) (a fresh Harness could now open)", true);
}

// ---------- (2) the ATTACHED (readOnly) client: re-read leg, routed act, honest refusal ----------
async function attachedPlane(writer, conversationId, writerStorage) {
  console.log("\n=== (2) THE ATTACHED CLIENT — a re-read pane, a routed act, a refusal that names the fix ===");
  const viewerStorage = await openHandle();
  const viewer = await Harness.open(viewerStorage, { models, registry, readOnly: true }, ctx);
  const beforeOpen = stat2(store);
  check("the viewer opens on a SEPARATE handle (one handle per process)", viewer !== null, "open threw");

  const g = await multiplexAttach(viewer, conversationId, { client: "gamma", readOnly: true, docs: ["live", "inbox"], context: ctx });
  check("an attached client's leg is named RE-READ, not watch", g.leg === "re-read", g.leg);
  let routeErr = null;
  try {
    const r = await g.act("GAMMA-1 say anything");
    check("an ATTACHED client's act on the session's own conversation SETTLED (it must not)", false, JSON.stringify(r));
  } catch (err) {
    routeErr = err;
    check("an ATTACHED client's act REFUSES rather than being dropped", true, "");
    check("  the refusal NAMES the fix (a seat, or a session-level SPOOL_OPS op)",
      /SPOOL_OPS/.test(routeErr?.message ?? "") && /seat/.test(routeErr?.message ?? ""),
      routeErr?.message);
  }
  check("the refused act wrote NOTHING (store mtime+size unchanged)", stat2(store) === beforeOpen, `${stat2(store)}`);

  // the seat route EXISTS today: the client's intent goes to the broker's inbox spool.
  const d = await multiplexAttach(viewer, conversationId, { client: "delta", readOnly: true, seat: "solo", dbPath: store, docs: ["live"], context: ctx });
  const spooled = await d.act("DELTA-SPOOLED raise the priority of the open row", { requestId: "delta-1" });
  check("an attached client's act goes to the broker's SPOOL, not to the store",
    typeof spooled?.spooled === "string" && spooled.spooled.startsWith(intentInboxDir(store)) && stat2(store) === beforeOpen,
    JSON.stringify(spooled));
  const drained = await drainIntentInbox(writer, writerStorage, { dbPath: store, context: ctx });
  check("the OWNING writer admits the spooled act into the one stream", drained?.delivered === 1, JSON.stringify(drained));
  await writer.waitForIdle(ctx);

  const seen1 = await d.refresh();
  const entryEvents1 = d.events.filter((e) => e.type === "entry").length;
  check("re-read: the attached client SEES the routed act land in the transcript",
    seen1.entries.some((e) => JSON.stringify(e).includes("DELTA-SPOOLED")), `entries=${seen1.entries.length}`);
  const again = await d.refresh();
  check("a second refresh() re-delivers NOTHING (a pane never prints the same entry twice)",
    d.events.filter((e) => e.type === "entry").length === entryEvents1 && again.entries.length === seen1.entries.length,
    `events=${d.events.filter((e) => e.type === "entry").length} vs ${entryEvents1}`);
  check("the viewer's OWN watch delivered no live events, so its leg is the re-read",
    d.events.filter((e) => e.via === "live").length === 0 && d.events.filter((e) => e.type === "entry").length > 0,
    `live=${d.events.filter((e) => e.via === "live").length} entry=${d.events.filter((e) => e.type === "entry").length}`);

  await g.detach();
  await d.detach();
  check("detach() stops a client's watches without throwing", true, "");
  // MEASURED: closing a handle FLUSHES the bytes already committed (the store went 4096 B ->
  // 163840 B across a readOnly close, .spike/probe-attach-close.mjs), so file size is NOT the
  // evidence that an attach wrote. The session line is: the same submissions, the same statuses.
  const lineBefore = (await mergedInputStream(writerStorage, { conversationId, limit: 50 }, ctx))
    .map((s) => `${s.id}:${s.status}`).join(" ");
  await viewer.close(ctx);
  const lineAfter = (await mergedInputStream(writerStorage, { conversationId, limit: 50 }, ctx))
    .map((s) => `${s.id}:${s.status}`).join(" ");
  check("closing the ATTACHED client changed NO submission (the attach stays read-only)",
    lineBefore === lineAfter, `before ${lineBefore} after ${lineAfter}`);
}

// ---------- (3) the shape of the layer itself: thin, no lifecycle, no second owner ----------
function layerShape() {
  console.log("\n=== (3) THE LAYER'S SHAPE — thin, caller-owned, no process, no second owner ===");
  const src = readFileSync(join(repoRoot, "src/multiplex.mjs"), "utf8");
  const lines = src.split("\n").length;
  check("the layer opens NO store (the caller hands it the handle it already holds)",
    !/openNodeSqliteStorage\s*\(/.test(src), "found a store open");
  check("the layer opens NO second Harness on the session (spec.md:4371 one owner)",
    !/Harness\.open\s*\(/.test(src), "found a Harness.open");
  check("the layer starts NO process and keeps NO timer (no new lifecycle)",
    !/spawn|setInterval|setTimeout|child_process/.test(src), "found a lifecycle primitive");
  check("the layer keeps no session state of its own (the registry is caller-owned)",
    !/^\s*(let|var)\s/m.test(src.split("export function createMultiplexer")[0], "m") &&
    !/^\s*(let|var)\s/m.test(src.split("export function mergedInputStream")[0], "m"),
    "module-level mutable state");
  check(`the new module is INSIDE the granted thin layer (<= 300 lines): ${lines}`, lines <= 300, `${lines} lines`);
  const areas = readFileSync(join(repoRoot, "demo/test-areas.json"), "utf8");
  check("this pin is a registered suite member", /tui-multiplex-attach\.test\.mjs/.test(areas), "not in test-areas.json");
}

// ---------- runner ----------
try {
  await multiplexerPlane();
  layerShape();
  const rigAfter = stat2(rigStore);
  check("the RIG STORE WAS NOT OPENED OR WRITTEN by this pin (mtime + size unchanged)",
    rigAfter === rigStoreBefore, `${rigAfter} vs ${rigStoreBefore}`);
  console.log(`rig store: before ${rigStoreBefore} after ${rigAfter}`);
} catch (err) {
  failures += 1;
  console.log(`  FAIL section crashed -- ${err?.name}: ${err?.message}`);
  console.log(String(err?.stack ?? "").slice(0, 900));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\nFAIL — ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nTUI-MULTIPLEX-ATTACH TEST PASS (two clients attached: the four pi.inbox admission legs, ONE ID-ordered merged stream, ONE identical broadcast to both, an attached act routed or refused by name)");
process.exit(0);
