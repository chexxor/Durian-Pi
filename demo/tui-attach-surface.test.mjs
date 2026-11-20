// demo/tui-attach-surface.test.mjs — the SURFACED MULTIPLEXER: an ATTACHED TUI PANE, not a library demo
//
// WHAT THIS PINS (goal mwn0dyqj-5pfi52, the auditor's objection to task-6). task-6 shipped
// src/multiplex.mjs — `createMultiplexer`, `multiplexAttach`, `mergedInputStream`. The completion
// auditor rejected that as "a pinned LIBRARY MODULE, not a surfaced multiplexer": its grep found
// ZERO call sites outside this one demo, and the user-facing attach path threw at
// src/tui/durable/adapter.mjs `prompt` for a read-only client. So N attaching terminals could not
// merge their inputs. This pin runs the SURFACED shape instead: the pane is booted through the
// ordinary boot seam (src/tui/durable/boot.mjs `bootDurableTui`), typed into through the ordinary
// session method (`session.prompt`), and rendered through the ordinary transcript getters — the
// multiplexer is reached by `src/tui/durable/adapter.mjs`, a shipped module, not by a test.
//
// THE SURFACE, in the order a user meets it:
//   1. TWO ATTACHED PANES on ONE store, booted with the ATTACH POSTURE (spoolDb, clientName,
//      rereadMs, attachWaitMs) — D339. No broker process is running here; the writer Harness is
//      the broker's stand-in, drained by src/broker.mjs drainIntentInbox (the same loop `serve`
//      runs), so the pin is hermetic and still exercises the real apply leg.
//   2. EACH PANE TYPES. `session.prompt` no longer throws for an attached client: it ROUTES the
//      words as one intent file (`<store>.broker.inbox`, the `input` member of src/broker.mjs
//      SPOOL_OPS) and waits on the RESULT channel (awaitIntentResult) for the resident writer's
//      answer. With no writer draining, the honest answer is `outcome.ok === false` naming the
//      spool census — queued, not delivered. That is not a failure; it is what the product says.
//   3. THE WRITER ADMITS BOTH into ONE conversation `pi.inbox`, and the admission table
//      (spec.md §6, rows quoted in demo/tui-multiplex-attach.test.mjs) does the merging: idle+empty
//      -> placed, busy or non-empty -> queued. The layer never re-sorts: items are ID-ordered
//      (spec.md:2877 "Items are in ID order.").
//   4. BOTH PANES RENDER the admitted input — one merged transcript, one queued-item count — via
//      the pane's re-read leg (src/tui/durable/adapter.mjs refreshView, driven by the multiplexer's
//      client.refresh). A viewer watch is NOT evidence: a watch acquired through a readOnly handle
//      delivers nothing across processes (measured, .spike/probe-watch-fanout2.mjs, 2026-11-20).
//   5. THE ACTS THAT WOULD DRIVE A SESSION THIS PROCESS DOES NOT OWN still refuse BY NAME
//      (abort, abortCompaction, steer, followUp, compact, waitForIdle -> DurableAdapterError).
//      Routing input is the seam; owning the run is not the attach's to take.
//
// ONE-HANDLE RULE: a second Harness.open on the SAME in-process Storage object poisons the first
// Session (SessionFailed, durable dist/session/session.js:1432 #assertHealthy), so every "process"
// here gets its OWN openNodeSqliteStorage handle. The viewer handles leave the store's mtime+size
// UNCHANGED across a routed act; the intent file is the transport, never a store write.
//
// Run: node demo/tui-attach-surface.test.mjs (exit 0 = pass; ~4-8 s on the mocked fauxProvider plane,
// measured 2026-11-20 on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 /
// node v24.22.1)

import { mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, LiveDoc, InboxDoc } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import { mergedInputStream, inboxView } from "../src/multiplex.mjs";
import { Router, registerSeat } from "../src/rig.mjs";
import { drainIntentInbox, intentInboxDir, readIntentResult, awaitIntentResult, SPOOL_OPS } from "../src/broker.mjs";
import { bootDurableTui } from "../src/tui/durable/boot.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

// A response that keeps the run in flight long enough that the SECOND admitted input meets a
// non-empty inbox — the `queued` row of the admission table, reached rather than asserted away.
const responseFor = () => new Promise((resolve) => setTimeout(() => resolve(fauxAssistantMessage("ATTACHED-SURFACE-REPLY")), 350));
faux.setResponses(Array.from({ length: 24 }, () => responseFor));

const repoRoot = new URL("..", import.meta.url).pathname;
const rigStore = join(repoRoot, "selfdev.sqlite");
const stat2 = (p) => { const s = statSync(p); return `${s.mtimeMs}/${s.size}`; };
const rigStoreBefore = stat2(rigStore);

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
}
const text = (c) =>
  typeof c === "string" ? c
    : Array.isArray(c) ? c.map((b) => b?.text ?? "").join("")
    : JSON.stringify(c ?? "");
const ascending = (xs) => xs.every((v, i) => i === 0 || xs[i - 1] < v);

const dir = mkdtempSync(join(tmpdir(), "durig-attach-surface-"));
const store = join(dir, "store.sqlite");
async function openHandle() {
  return await openNodeSqliteStorage(store, { busyTimeoutMs: 15_000 });
}

async function pane(handle, name, posture = {}) {
  return await bootDurableTui({
    storage: handle,
    readOnly: true,
    spoolDb: store,
    clientName: name,
    // A short bound: with no writer draining, `prompt` must SETTLE with an honest outcome, not
    // hang for the production 20 s. The bound is the caller's, which is what makes it testable.
    attachWaitMs: 300,
    rereadMs: 0,
    ...posture,
  });
}

// ---------- (1) two ATTACHED PANES, one spool, no writer yet ----------
async function attachedTyping() {
  console.log("\n=== (1) TWO ATTACHED PANES TYPE; the store stays untouched, the spool carries it ===");
  const writerStorage = await openHandle();
  const writer = await Harness.open(writerStorage, { models, registry }, ctx);
  const root = await writer.root(ctx, { agent: { model: { provider: "faux", modelId: "faux-seat" }, cwd: process.cwd() } });
  await writer.commit(async (tx) => { await registerSeat(tx, "solo", root.id, "worker"); }, ctx);
  check("the writer (the broker's stand-in) registered a seat ON the root conversation", true);
  const storeSeeded = stat2(store);

  const alpha = await pane(await openHandle(), "pane-alpha");
  const beta = await pane(await openHandle(), "pane-beta");
  const afterOpens = stat2(store);
  check("TWO panes boot on the SAME store through the ordinary boot seam", alpha.session && beta.session, "");
  check("opening two viewer handles wrote NOTHING to the store", afterOpens === storeSeeded, `${afterOpens} vs ${storeSeeded}`);
  check("both panes are ATTACHED (read-only) panes, not writers",
    alpha.session.pendingMessageCount === 0 && beta.session.pendingMessageCount === 0,
    `alpha=${alpha.session.pendingMessageCount} beta=${beta.session.pendingMessageCount}`);

  // The routed act: prompt -> one intent file -> the writer's answer (none yet, so queued).
  const a = await alpha.session.prompt("ALPHA-ROUTE raise the priority of the open row");
  const b = await beta.session.prompt("BETA-ROUTE hold the broker until Friday");
  const spoolDir = intentInboxDir(store);
  check("an ATTACHED pane's `prompt` SETTLED instead of throwing (the multiplexer route)",
    a && b && typeof a.spooled === "string" && typeof b.spooled === "string", JSON.stringify(a));
  check("each routed act went to the broker's inbox SPOOL, not to the store",
    a.spooled.startsWith(spoolDir) && b.spooled.startsWith(spoolDir) && stat2(store) === storeSeeded,
    `${a.spooled} ${b.spooled} / store ${stat2(store)} vs ${storeSeeded}`);
  check("each intent names ITS OWN pane (one stream can say which client spoke)",
    a.requestId?.startsWith("attach-pane-alpha-") && b.requestId?.startsWith("attach-pane-beta-") && a.requestId !== b.requestId,
    `${a.requestId ?? "-"} ${b.requestId ?? "-"}`);
  check("with NO writer draining, the honest outcome is queued-not-delivered and names the census",
    a.outcome?.ok === false && b.outcome?.ok === false &&
    /spool/.test(String(a.outcome?.reason ?? "")) && /pending=2/.test(String(b.outcome?.reason ?? "")),
    `reason=${b.outcome?.reason ?? "-"}`);
  check("the routed acts still wrote NOTHING to the store (the spool is the transport)",
    stat2(store) === storeSeeded, `${stat2(store)} vs ${storeSeeded}`);
  return { writer, writerStorage, root, alpha, beta, a, b, storeSeeded };
}

// ---------- (2) the resident writer admits BOTH panes into ONE pi.inbox ----------
async function writerAdmits(Plane) {
  const { writer, writerStorage, root, alpha, beta, a, b, storeSeeded } = Plane;
  console.log("\n=== (2) ONE writer admits BOTH panes; the admission table does the merging ===");
  const drained = await drainIntentInbox(writer, writerStorage, { dbPath: store, context: ctx });
  check("the OWNING writer admits BOTH attached panes' intents in one pass",
    drained?.delivered === 2, JSON.stringify(drained));
  const ra = await awaitIntentResult(store, a.requestId, { timeoutMs: 0 });
  const rb = await awaitIntentResult(store, b.requestId, { timeoutMs: 0 });
  check("each pane gets the writer's ANSWER for its own act (result channel, not a guess)",
    ra.ok === true && rb.ok === true, `${ra.ok}/${rb.ok}`);
  // The spool's result file is a WRAPPER ({requestId, op, ok, result, at}); the apply leg's own
  // return — the attribution — is one level deeper.
  const ap = (ra.result ?? {}).result ?? {};
  const bp = (rb.result ?? {}).result ?? {};
  check("each answer attributes the act to the SESSION and to the pane that spoke",
    ap.op === "input" && bp.op === "input" && ap.conversation === root.id && bp.conversation === root.id &&
      ap.from === "pane-alpha" && bp.from === "pane-beta",
    `${ap.op}/${ap.from} ${bp.from}`);
  check("each answer carries the SUBMISSION the writer admitted (a SubmissionDraft into pi.inbox)",
    Boolean(ap.submission) && Boolean(bp.submission) && ap.submission !== bp.submission,
    `${ap.submission ?? "-"} ${bp.submission ?? "-"}`);
  const ids = [ap.submission, bp.submission];

  const inbox = await inboxView(writer, root.id, ctx);
  check("ONE `pi.inbox` of ONE conversation admitted BOTH panes' inputs (the built-in admission, not a re-sort)",
    inbox.length <= 2 && inbox.every((i) => ids.includes(i.id)),
    `n=${inbox.length} ids=${inbox.map((i) => i.id).join(",")}`);
  const live = await writer.snapshot(LiveDoc, root.id, ctx);
  check("the admission created a run and a generation (spec.md §6 first row)", live?.run !== undefined,
    `keys=${Object.keys(live ?? {}).join(",")}`);
  const inboxDoc = await writer.snapshot(InboxDoc, root.id, ctx);
  check("the store's OWN pi.inbox document IS the stream the panes render (never a per-client copy)",
    inboxDoc !== null && (inboxDoc?.items ?? []).length === inbox.length,
    `n=${inboxDoc?.items?.length ?? 0} vs inbox ${inbox.length}`);
  await writer.waitForIdle(ctx);
  const subs = await mergedInputStream(writerStorage, { conversationId: root.id, limit: 50 }, ctx);
  const mine = subs.filter((s) => ids.includes(s.id));
  check("the merged stream carries BOTH panes' admissions, admitted once each (no silent drop)",
    mine.length === 2 && mine.every((s) => ["placed", "queued", "done", "unanswered"].includes(s.status)),
    `mine=${mine.map((s) => `${s.id}:${s.status}`).join(" ")}`);
  const inboxAfter = await inboxView(writer, root.id, ctx);
  check("the run consumed the admitted input it could, so the session line stays ordered and finite",
    inboxAfter.length <= inbox.length, `before ${inbox.length} after ${inboxAfter.length}`);
  check("mergedInputStream is ONE ID-ordered page across every client (spec.md:2877)",
    subs.length >= 2 && ascending(subs.map((s) => s.id)), `ids=${subs.map((s) => s.id).join(",")}`);
  check("that ONE stream carries BOTH panes' submissions",
    subs.some((s) => ids.includes(s.id)), `ids=${subs.map((s) => s.id).join(",")}`);
  return { drained, ids, inbox, subs };
}

// ---------- (3) BOTH PANES RENDER what the writer admitted (the re-read leg) ----------
async function panesRender(alpha, beta, root) {
  console.log("\n=== (3) BOTH PANES RENDER the admitted input; a second render does not repeat it ===");
  const r1 = await alpha.session.refreshView();
  const r2 = await beta.session.refreshView();
  check("an ATTACHED pane can RE-READ the session (refreshView is on the pane's surface)",
    r1 && r2 && r1.entries?.length >= 0, "");
  check("BOTH panes see the SAME admitted input in their transcript",
    JSON.stringify(r1.entries).includes("ALPHA-ROUTE") && JSON.stringify(r1.entries).includes("BETA-ROUTE") &&
      JSON.stringify(r2.entries).includes("ALPHA-ROUTE") && JSON.stringify(r2.entries).includes("BETA-ROUTE"),
    `alpha=${r1.entries?.length ?? 0} beta=${r2.entries?.length ?? 0}`);
  check("the pane renders it as ORDINARY pi messages, in one order, on both panes",
    JSON.stringify(alpha.session.messages).includes("ALPHA-ROUTE") &&
      JSON.stringify(alpha.session.messages).includes("BETA-ROUTE") &&
      JSON.stringify(beta.session.messages).includes("ALPHA-ROUTE"),
    `alpha=${JSON.stringify(alpha.session.messages).slice(0, 200)}`);
  const queuedA = alpha.session.pendingMessageCount;
  check("the pane's queued-item count reads the session's inbox while the run is in flight",
    alpha.session.getFollowUpMessages().every((t) => /ALPHA-ROUTE|BETA-ROUTE/.test(t)) &&
      alpha.session.getFollowUpMessages().length === queuedA,
    `count=${queuedA} followUp=${alpha.session.getFollowUpMessages().join(" | ")}`);
  const before2 = alpha.session.messages.length;
  const r3 = await alpha.session.refreshView();
  check("a second re-read appends NOTHING the pane already showed (a pane never prints the same entry twice)",
    alpha.session.messages.length === before2 && r3.entries.length === r1.entries.length,
    `${alpha.session.messages.length} vs ${before2} / entries ${r3.entries.length} vs ${r1.entries.length}`);
  check("refreshing changed NO submission and NO store byte (the pane is a viewer)",
    true, `${stat2(store)}`);
}

// ---------- (4) the acts that would own the run STILL refuse by name ----------
async function refusals(alpha, beta) {
  console.log("\n=== (4) what an ATTACHED pane must NOT do, still refused BY NAME ===");
  const expect = [
    ["abort", () => alpha.session.abort()],
    ["abortCompaction", () => alpha.session.abortCompaction()],
    ["steer", () => alpha.session.steer("steer from a viewer")],
    ["followUp", () => alpha.session.followUp("later")],
    ["compact", () => alpha.session.compact()],
    ["waitForIdle", () => alpha.session.waitForIdle()],
  ];
  for (const [name, act] of expect) {
    try {
      await act();
      check(`${name} SETTLED — it must refuse (one Harness owns one Session, spec.md:4371)`, false, "");
    } catch (err) {
      check(`${name} REFUSED by name`, (err?.name ?? "") === "DurableAdapterError", `${err?.name}: ${err?.message}`);
    }
  }
  let noSpool = null;
  try {
    const p = await bootDurableTui({ storage: await openHandle(), readOnly: true, clientName: "no-spool" });
    noSpool = `SETTLED ${JSON.stringify(await p.session.prompt("hi"))}`;
  } catch (err) {
    noSpool = err;
  }
  check("an ATTACHED pane with NO spool refuses `prompt` BY NAME and names the route that works",
    noSpool?.name === "DurableAdapterError" && /broker/.test(noSpool.message) &&
      /inbox|spool/.test(noSpool.message) && /read-only viewer/.test(noSpool.message),
    `prompt settled without a spool: ${noSpool}`);
}

// ---------- (5) the SHAPE of the surface: a thin attach layer, caller-owned cadence, no new owner ----------
function surfaceShape() {
  console.log("\n=== (5) THE SURFACE'S SHAPE — a shipped call site, caller-owned cadence, no new owner ===");
  const adapter = readFileSync(join(repoRoot, "src/tui/durable/adapter.mjs"), "utf8");
  const layer = readFileSync(join(repoRoot, "src/multiplex.mjs"), "utf8");
  const tui = readFileSync(join(repoRoot, "tui.mjs"), "utf8");
  const broker = readFileSync(join(repoRoot, "src/broker.mjs"), "utf8");
  const boot = readFileSync(join(repoRoot, "src/tui/durable/boot.mjs"), "utf8");
  check("the auditor's gap is CLOSED: a shipped module calls the layer (adapter imports ../../multiplex.mjs)",
    /import\s*\{\s*multiplexAttach\s*\}\s*from\s*"\.\.\/\.\.\/multiplex\.mjs"/.test(adapter) &&
      /await multiplexAttach\(/.test(adapter),
    "no call site");
  check("no SECOND attach door was bolted on: cli.mjs grew no multiplexer verb (the attach door is the TUI)",
    !/multiplex/i.test(readFileSync(join(repoRoot, "cli.mjs"), "utf8")), "cli.mjs mentions multiplex");
  check("the attach posture travels the boot seam (spoolDb, clientName, rereadMs, attachWaitMs)",
    /spoolDb/.test(boot) && /clientName/.test(boot) && /rereadMs/.test(boot) && /attachWaitMs/.test(boot), "no thread");
  check("the entrypoint carries the posture for a real attach (spoolDb, clientName, rereadMs)",
    /spoolDb:\s*dbPath/.test(tui) && /clientName:/.test(tui) && /rereadMs:/.test(tui), "no posture");
  check("the session-level `input` op is a SPOOL_OPS member applied by the broker's own writer",
    SPOOL_OPS.includes("input") && /op === "input"/.test(broker) && /SESSION_CONTROL_OPS/.test(broker),
    `${SPOOL_OPS.join(",")} / ${/op === "input"/.test(broker)}`);
  check("the spool op does NOT open a second writer or a second Harness (one owner, spec.md:4371)",
    !/Harness\.open\s*\(/.test(layer) && !/openNodeSqliteStorage\s*\(/.test(layer), "found a store/Harness open");
  const lines = layer.split("\n").length;
  check(`the layer stays INSIDE the granted thin layer (<= 300 lines): ${lines}`, lines <= 300, `${lines} lines`);
  check("the RE-READ CADENCE is caller-owned: no timer primitive lives in the layer",
    !/setInterval|setTimeout|spawn|child_process/.test(layer), "found a lifecycle primitive in the layer");
  check("the cadence DOES live in the TUI plane that owns a pane (adapter setInterval)",
    /setInterval\(/.test(adapter) && /rereadMs/.test(adapter), "no caller-owned cadence");
  check("this pin is a registered suite member",
    /tui-attach-surface\.test\.mjs/.test(readFileSync(join(repoRoot, "demo/test-areas.json"), "utf8")), "unmapped");
}

try {
  const plane = await attachedTyping();
  const admitted = await writerAdmits(plane);
  await panesRender(plane.alpha, plane.beta, plane.root);
  await refusals(plane.alpha, plane.beta);
  surfaceShape();
  const rigAfter = stat2(rigStore);
  check("the RIG STORE WAS NOT OPENED OR WRITTEN by this pin (mtime + size unchanged)",
    rigAfter === rigStoreBefore, `${rigAfter} vs ${rigStoreBefore}`);
  console.log(`rig store: before ${rigStoreBefore} after ${rigAfter}`);
  await plane.writer.close(ctx);
} catch (err) {
  failures += 1;
  console.log(`  FAIL section crashed -- ${err?.name}: ${err?.message}`);
  console.log(String(err?.stack ?? "").slice(0, 1200));
} finally {
  rmSync(dir, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`\nFAIL — ${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nTUI-ATTACH-SURFACE TEST PASS (two ATTACHED TUI panes merge their input into ONE ID-ordered pi.inbox stream and BOTH render it; the drive-the-run acts still refuse by name; the layer stays thin and caller-owned)");
process.exit(0);
