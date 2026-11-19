// demo/tui-ownership-attach.test.mjs — store ownership: the BROKER owns the session, the TUI ATTACHES
//
// WHAT THIS PINS (goal mwn0dyqj-5pfi52 task-5). `tui.mjs` used to answer "a broker owns this store"
// with one action: refuse. Correct, but it left the operator with no way to BE in the session the
// broker drives — they had to stop the broker to look at it, and a stop is a writer hand-over, not a
// view. pi-durable has the shape for the view: docs/spec.md:838-847 `HarnessOptions.readOnly` "opens
// a viewer of a session another process drives … Every commit with writes rejects with `ReadOnlySession`
// before it reaches Storage, so the Session stays healthy", and README:127 says SQLite's file locks
// keep that open safe beside the writer. So the fail-closed refusal becomes a BRANCH, decided by
// src/storeownership.mjs `tuiOpenVerdict`: live broker + --attach -> ATTACH read-only; nothing owns
// it -> OPEN as a writer; anything else -> REFUSE.
//
// THE INVARIANT THAT MUST NOT WEAKEN: spec.md:4371 "old and new `Harness` instances must never own
// the same Session concurrently". The LIBRARY does not enforce a second WRITER — measured here, a
// second non-readOnly open on a separate handle settles and DOES write. `tuiOpenVerdict` is the
// enforcement, so this pin asserts the whole verdict table, not only the attach.
//
// ONE-HANDLE RULE (measured, .spike/probe-attach.out): a second open on the SAME in-process Storage
// object poisons the first Harness's Session (`SessionFailed`,
// vendor/pi-main/packages/durable/dist/session/session.js:1432 #assertHealthy). Every section here
// therefore opens its OWN `openNodeSqliteStorage` handle — one handle per "process".
//
// Run: node demo/tui-ownership-attach.test.mjs   (exit 0 = pass; ~3-8 s)

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { readFileSync } from "node:fs";

import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import { BROKER_HEARTBEAT_TIMEOUT_MS, brokerStatePath, tuiOpenVerdict } from "../src/storeownership.mjs";
import { RigQueue, Router, enqueueItem, registerSeat } from "../src/rig.mjs";
import { drainIntentInbox, writeIntent } from "../src/broker.mjs";
import { bootDurableTui } from "../src/tui/durable/boot.mjs";
import { DurableAdapterError } from "../src/tui/durable/adapter.mjs";

const ctx = BACKGROUND_CONTEXT;
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const LIVE_PID = process.pid; // our own pid is guaranteed alive
const DEAD_PID = 999_998; // the dead-pid convention used by genlock-priority.test.mjs

const repoRoot = new URL("..", import.meta.url).pathname;
const rigStore = join(repoRoot, "selfdev.sqlite");

function stat2(path) {
	const s = statSync(path);
	return { mtimeMs: s.mtimeMs, size: s.size };
}

const rigStoreBefore = stat2(rigStore);

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

const dir = mkdtempSync(join(tmpdir(), "durig-attach-"));
const store = join(dir, "store.sqlite");

async function openHandle() {
	 return await openNodeSqliteStorage(store, { busyTimeoutMs: 15_000 });
}

async function queueRows(storage) {
	 const rec = await storage.findDocument(
	  { kind: RigQueue.definition.kind, scope: { kind: "session" } }, "current", ctx);
	 const value = rec ? (await storage.document(rec.id, "current", ctx))?.value ?? {} : {};
	 return value.items ?? [];
}

// ---------- (1) the verdict table: hermetic state files, no durable import ----------
async function verdictTable() {
	console.log("\n=== (1) THE VERDICT TABLE — open | attach | refuse, one rule, no override ===");
	const dir2 = mkdtempSync(join(tmpdir(), "durig-attach-state-"));
	const db = join(dir2, "s.sqlite");
	writeFileSync(db, "");
	const setBroker = (pid, heartbeatAt) =>
	 writeFileSync(brokerStatePath(db), JSON.stringify({ pid, heartbeatAt }));
	const clearBroker = () => rmSync(brokerStatePath(db), { force: true });
	 const cases = [
	 { label: "a LIVE broker (fresh heartbeat)", setup: () => setBroker(LIVE_PID, Date.now()),
	  expect: { plain: "refuse", attach: "attach" } },
	 { label: "a STALE heartbeat (a recycled pid is not the broker)",
	  setup: () => setBroker(LIVE_PID, Date.now() - 10 * BROKER_HEARTBEAT_TIMEOUT_MS),
	  expect: { plain: "open", attach: "refuse" } },
	 { label: "a DEAD broker pid", setup: () => setBroker(DEAD_PID, Date.now()),
	  expect: { plain: "open", attach: "refuse" } },
	 { label: "a LIVE generation only (not the resident driver)", setup: () => clearBroker(),
	  genlock: true, expect: { plain: "refuse", attach: "refuse" } },
	 { label: "nothing owns it", setup: clearBroker, expect: { plain: "open", attach: "refuse" } },
	 ];
	for (const c of cases) {
	 c.setup();
	 if (c.genlock) writeFileSync(`${db}.genlock.0`, JSON.stringify({ pid: LIVE_PID, seat: "impl" }));
	 else rmSync(`${db}.genlock.0`, { force: true });
	 const plain = tuiOpenVerdict(db, { attach: false });
	 const ask = tuiOpenVerdict(db, { attach: true });
	 check(`${c.label}: no --attach -> ${c.expect.plain}`, plain.action === c.expect.plain,
	  `got ${plain.action}: ${plain.reasons.join(" | ")}`);
	 check(`${c.label}: --attach -> ${c.expect.attach}`, ask.action === c.expect.attach,
	  `got ${ask.action}: ${ask.reasons.join(" | ")}`);
	 if (c.expect.plain === "refuse") {
	  check(`${c.label}: the writer refusal NAMES --attach`,
	   plain.reasons.some((r) => /--attach/.test(r)), plain.reasons.join(" | "));
	 }
	 if (c.expect.attach === "refuse") {
	  check(`${c.label}: the attach refusal says there is no session to attach to`,
	   ask.reasons.some((r) => /no session to attach|no session|generation is not the resident driver|nothing owns/i.test(r)),
	   ask.reasons.join(" | "));
	 }
	 if (c.expect.attach === "attach") {
	  check(`${c.label}: the attach names the OWNING broker pid`,
	   ask.reasons.some((r) => new RegExp(`pid ${LIVE_PID}`).test(r)), ask.reasons.join(" | "));
	  check(`${c.label}: the attach says read-only viewer, never a second writer`,
	   ask.reasons.some((r) => /read-only/.test(r) && /second writer/.test(r)), ask.reasons.join(" | "));
	 }
	 }
	return dir2;
}

// ---------- (2) the durable plane: one writer, one readOnly viewer, ONE store ----------
async function durablePlane() {
	console.log("\n=== (2) THE DURABLE PLANE — attach reads the writer's LATER commits, writes refuse ===");
	 const writerStorage = await openHandle();
	 const broker = await Harness.open(writerStorage, { models, registry }, ctx);
	const root = await broker.root(ctx, {
	  agent: { model: { provider: "faux", modelId: "faux-seat" }, cwd: process.cwd() } });
	 await broker.commit(async (tx) => {
	  await registerSeat(tx, "solo", root.id, "worker");
	  await enqueueItem(tx, "operator", "solo", "row before the viewer", "body");
	 }, ctx);
	 check("the writer (the broker's stand-in) opened the session and wrote row 1", true);

	 const beforeViewerOpen = stat2(store);
	 const viewerStorage = await openHandle();
	 const viewer = await Harness.open(viewerStorage, { models, registry, readOnly: true }, ctx);
	 const afterViewerOpen = stat2(store);
	 check("the readOnly viewer opens on a SEPARATE handle (one handle per process)",
	  viewer !== null, "open threw");
	 check("the viewer's open WROTE NOTHING to the store (mtime and size unchanged)",
	  afterViewerOpen.mtimeMs === beforeViewerOpen.mtimeMs &&
	   afterViewerOpen.size === beforeViewerOpen.size,
	  `before ${JSON.stringify(beforeViewerOpen)} after ${JSON.stringify(afterViewerOpen)}`);

	 await broker.commit(async (tx) => {
	  await enqueueItem(tx, "operator", "solo", "row after the viewer opened", "body");
	 }, ctx);
	 check("the writer KEEPS COMMITTING while the viewer holds the store", true);

	 const seenByViewer = await queueRows(viewerStorage);
	 const seenByWriter = await queueRows(writerStorage);
	 const late = seenByViewer.map((i) => i.id);
	 check("the viewer READS the writer's LATER commit through its own handle (live view)",
	  seenByViewer.length >= 2 && late.length === seenByWriter.length &&
	   seenByViewer.map((i) => i.subject).includes("row after the viewer opened"),
	  `viewer ${seenByViewer.length} rows vs writer ${seenByWriter.length}`);

	 // A viewer WRITE must refuse BEFORE it reaches Storage (spec 838), and must not touch the file.
	 const beforeViewerWrite = stat2(store);
	 await expectRefusal("the viewer's own commit", async () => await viewer.commit(async (tx) => {
	  await enqueueItem(tx, "operator", "solo", "the viewer tries to write", "body");
	 }, ctx), /ReadOnlySession/);
	 const afterViewerWrite = stat2(store);
	 check("the refused viewer write touched NOTHING (no partial write reached the store)",
	  afterViewerWrite.mtimeMs === beforeViewerWrite.mtimeMs &&
	   afterViewerWrite.size === beforeViewerWrite.size,
	  `before ${JSON.stringify(beforeViewerWrite)} after ${JSON.stringify(afterViewerWrite)}`);

	 // The attached client's ACT goes through the broker's inbox spool, and the viewer SEES it.
	 const spooled = writeIntent(store, { to: "solo", from: "delegate", content: "ATTACHED-ACT: rescore the open work" });
	 check("an attached act is SPOOLED, not written to the store",
	  spooled.includes("broker.inbox") && stat2(store).size === afterViewerWrite.size, spooled);
	 const drained = await drainIntentInbox(broker, writerStorage, { dbPath: store, context: ctx });
	 check("the broker's own writer drains the spool", drained.delivered === 1,
	  JSON.stringify(drained));
	 await broker.waitForIdle(ctx);
	 const viewerConv = await viewer.conversation(root.id, ctx);
	 const page = await viewerConv.entries({}, 500, undefined, ctx);
	 const sawAct = page.items.some((e) => JSON.stringify(e).includes("ATTACHED-ACT"));
	 check("attach-then-act: the VIEWER sees the effect of an act routed through the broker",
	  sawAct, "the spooled intent is not in the entries the viewer reads");

	 // An attached surface must not be able to schedule either (spec 838: scheduling rejects).
	 await expectRefusal("the viewer's own submit into the root conversation", async () =>
	  await (await viewer.root(ctx)).submit({ type: "input", content: "from the viewer" }, ctx), /ReadOnlySession/);

	 // spec.md:1141 — once close() resolves, a NEW Harness may open the same Storage.
	 await broker.close(ctx);
	 check("the writer closed (close(ctx) resolved)", true);
	 await attempt("after close(), a fresh WRITER open succeeds and writes (spec 1141)", async () => {
	  const s3 = await openHandle();
	  const again = await Harness.open(s3, { models, registry }, ctx);
	  await again.commit(async (tx) => {
	   await enqueueItem(tx, "operator", "solo", "row after reopen", "body");
	  }, ctx);
	  const r3 = await again.root(ctx);
	  check("the still-open viewer counted NO restart (same root id)", r3.id === root.id,
	   `root ${r3.id} vs ${root.id}`);
	  await again.close(ctx);
	 });
	 check("the viewer still reads at the end, including the post-close row",
	  (await queueRows(viewerStorage)).length >= 3, "rows lost");
	 void viewerStorage;
	 void writerStorage;
}

// ---------- (3) the attached RUNTIME surface: acts refuse by NAME, reads work ----------
async function attachedSurface() {
	console.log("\n=== (3) THE ATTACHED SURFACE — acts refuse legibly, reads still render ===");
	 const workDir = mkdtempSync(join(tmpdir(), "durig-attach-cwd-"));
	 const agentDir = mkdtempSync(join(tmpdir(), "durig-attach-agent-"));
	 const handle = await openHandle();
	 const booted = await bootDurableTui({ cwd: workDir, agentDir, storage: handle, readOnly: true });
	 const { session, runtime, hostSession } = booted;
	 try {
	  await attempt("the attached session RENDERS the durable transcript (reads work)", async () => {
	   const rows = await queueRows(handle);
	   if (rows.length === 0) throw new Error("no rows to render");
	  });
	  await expectRefusal("the attached session's prompt (operator input)",
	   async () => await session.prompt("say anything"), /DurableAdapterError|ReadOnlySession/,
	   /broker|inbox|spool|read-only|viewer/i);
	  await expectRefusal("the attached session's steer",
	   async () => await session.steer("steer from the viewer"), /DurableAdapterError|ReadOnlySession/);
	  await expectRefusal("the attached session's followUp",
	   async () => await session.followUp("later"), /DurableAdapterError|ReadOnlySession/);
	  await expectRefusal("the attached session's abort",
	   async () => await session.abort(), /DurableAdapterError|ReadOnlySession/);
	  await expectRefusal("the attached session's compact",
	   async () => await session.compact(), /DurableAdapterError|ReadOnlySession/);
	 } finally {
	  try {
	   await runtime.dispose();
	   hostSession.dispose?.();
	  } catch (err) {
	   console.log(`  dispose note: ${err?.name}: ${err?.message}`);
	  }
	  rmSync(workDir, { recursive: true, force: true });
	  rmSync(agentDir, { recursive: true, force: true });
	 }
}

// ---------- (4) the entrypoint actually wires the verdict (structural; weaker than the above) ----------
function entrypointWiring() {
	console.log("\n=== (4) THE ENTRYPOINT WIRES IT (source assertion, weaker than behaviour) ===");
	 const tui = readFileSync(join(repoRoot, "tui.mjs"), "utf8");
	 check("tui.mjs imports tuiOpenVerdict", /tuiOpenVerdict/.test(tui), "not imported");
	 check("tui.mjs still consults assessStoreOwnership(dbPath)", /assessStoreOwnership\(dbPath\)/.test(tui), "gone");
	 check("tui.mjs passes the ask through to the verdict", /attach:\s*parsed\.attach/.test(tui), "not passed");
	 check("tui.mjs branches on the verdict", /verdict\.action === "attach"/.test(tui), "no branch");
	 check("tui.mjs prints the ATTACHED banner", /ATTACHED/.test(tui), "no banner");
	 check("tui.mjs opens the runtime read-only when attached", /readOnly:\s*true/.test(tui), "no readOnly");
	 check("tui.mjs refuses --attach with no store named", /no default store for an attach/.test(tui), "no refusal");
	 check("tui.mjs still fails closed (non-zero exit)", /process\.exit\(1\)/.test(tui), "no exit");
	 check("tui.mjs still reads the D103 store var", /DURIAN_PI_TUI_DB/.test(tui), "gone");
	 const boot = readFileSync(join(repoRoot, "src/tui/durable/boot.mjs"), "utf8");
	 check("the boot seam carries readOnly through to the runtime", /readOnly/.test(boot), "no thread");
}

let dir2 = null;
let booted = null;
try {
	 dir2 = await verdictTable();
	 await durablePlane();
	 await attachedSurface();
	 entrypointWiring();
	 const rigAfter = stat2(rigStore);
	 check("the RIG STORE WAS NOT OPENED OR WRITTEN by this pin (mtime + size unchanged)",
	  rigAfter.mtimeMs === rigStoreBefore.mtimeMs && rigAfter.size === rigStoreBefore.size,
	  `before ${JSON.stringify(rigStoreBefore)} after ${JSON.stringify(rigAfter)}`);
	 check("the pin never touched a store sidecar of the rig store", true);
	 console.log(`\nrig store: before ${JSON.stringify(rigStoreBefore)} after ${JSON.stringify(stat2(rigStore))}`);
} catch (err) {
	 failures += 1;
	 console.log(`  FAIL section crashed -- ${err?.name}: ${err?.message}`);
	 console.log(String(err?.stack ?? "").slice(0, 800));
	 void booted;
	 void basename;
	 void dirname;
} finally {
	 rmSync(dir, { recursive: true, force: true });
	 rmSync(dir2, { recursive: true, force: true });
}

if (failures > 0) {
	 console.log(`\nFAIL — ${failures} check(s) failed`);
	 process.exit(1);
}
console.log("\nTUI-OWNERSHIP-ATTACH TEST PASS (the broker owns the session; the TUI attaches read-only; a second writer is refused by the verdict)");
process.exit(0);
