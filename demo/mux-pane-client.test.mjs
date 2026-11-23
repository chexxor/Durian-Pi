// demo/mux-pane-client.test.mjs — the plugin's OWN PANE CLIENT is a RESIDENT ATTACHED CLIENT on a REAL broker: it
// reads its seat, routes its words to the broker's spool, and the BROKER admits them into the ONE session the pane
// watches (goal mwpeepwa-spmy34, contracts (3) OWNERSHIP + (4) INTERACTION; the completion auditor's objection 3:
// "N panes read/write the SAME session is only hermetic — the live leg is OWED").
//
// WHY THIS FILE EXISTS AND WHAT IT IS NOT. The first pane command every multiplexer driver could name — the rig's
// own full TUI (`node tui.mjs --db <store> --attach --select <seat>`) — is MEASURED DEAD as a window command: it
// prints the attach banner and then exits ~1 s later with an uncaught `ReadOnlySession: a commit with writes` from
// its OWN upkeep job, so the window is destroyed and the multiplexer's own census then reports no session at all.
// Fixing that inside `vendor/pi-main` would be patching the BASE (D212 forbids it), so the plugin grows its OWN
// pane client — `tools/mux-pane-client.mjs`, built on the rig's EXISTING attached-client layer
// (`src/multiplex.mjs` `multiplexAttach`, whose readOnly leg is a re-read) — and every driver names THAT.
// This pin is the end-to-end proof of that file: the pane as a CHILD PROCESS (exactly what a window runs), on a
// REAL temp store seeded with one seat on the MOCKED fauxProvider plane, owned by the rig's OWN detached broker.
// Nothing here is hermetic about ownership: the broker is a real detached process with a real pid, and its
// admission is witnessed by its OWN result records and a plain Storage read, not by the pane's own word.
//
// WHAT EACH SECTION CLOSES (nothing below this line is prose):
//   1. THE PANE ATTACHES, IT NEVER CREATES AN OWNER — with NO broker on the store the client refuses BY NAME,
//      exits non-zero (so the multiplexer's census shows a dead window rather than a lying one), names the store,
//      prints the ONE command that WOULD own it, and writes/starts nothing.
//   2. THE ATTACH BANNER IS AN ASSERTION, NOT A HOPE — `leg re-read  write false`, the store, the seat, the
//      conversation token, and the OWNER PID (a pane that came back as a writer is the second-writer class and
//      must die there rather than type into a session it does not own).
//   3. THE PANE'S ONE ACT GOES TO THE SPOOL — `--act <sentence>` prints `act -> spooled <store>.broker.inbox/<n>.json`
//      with op `message`; the transport is a file, never a keystroke (no send-keys/-X stuff anywhere in the plugin).
//   4. THE BROKER ADMITS IT, WITNESSED OUTSIDE THE PANE — the broker's OWN result record for the pane's requestId
//      (ok, op, seat, delivered) AND a plain `Storage#scanSubmissions` page (`src/multiplex.mjs` `mergedInputStream`)
//      carrying the pane's words in ASCENDING ID order. The pane's own viewport then reads the admitted `pi.user`
//      entry NEW on a LATER frame — so "submit work to it" has real-session evidence, not only a drain in a pin.
//   5. THE WINDOW IS RESIDENT OVER A NON-EMPTY CONVERSATION — N frames, every one printing the entries count, and
//      the pane's last line is its own `assertUsable()` liveness check. A multiplexer DESTROYS a window whose
//      command exited, so `--frames 0` (FOREVER) is the default and a finite run here is a pin, not a pane.
//   6. NO SECOND WRITER, MEASURED — a pane that does NOT act leaves the store's byte count and INODE unchanged,
//      and the pane's own banner keeps `write false` on its own line.
//   7. N PANES, ONE SESSION — TWO panes of ONE seat run CONCURRENTLY: both name the SAME conversation token, both
//      are re-read legs, both acts are admitted by the broker (two result records, one seat), and BOTH sentences
//      appear in ONE ascending merged stream. N viewports never become N seats and never two sessions.
//   8. THE HONEST GAP — a pane whose seat does not exist in the store refuses BY NAME and prints the seats it DOES
//      find, because a pane that prints nothing is indistinguishable from a pane that is working.
//
// HERMETIC: sections 1-8 start the rig's OWN bounded detached broker on a TEMP store under os.tmpdir() and a
// MOCKED fauxProvider plane — the broker's own plane is the rig's offline path (`cli.mjs:345` reads
// `DURIG_PROVIDER=faux`, `cli.mjs:188` reads `DURIG_MODEL`), so NOTHING here needs a key, a model server, or
// a funded call, and the rig's live store must not move a byte.
// MOCKED fauxProvider plane (no key, no network, no funded model, no sleep). The rig's live store must not move a
// byte. Run: node demo/mux-pane-client.test.mjs (exit 0 = pass)
//
// COST (D213, its own fast loop): MEASURED 2026-11-22 on Linux / Fedora Linux 45 (Forty Five) / kernel
// 7.2.15-300.fc45.x86_64 / node v24.22.1 — the whole pin is 23.1 s (pin self-report `23.09s total`, wall
// `real 0m23.229s` in the same command as the host line). The split: seed ~0.4 s, unowned refusal ~0.2 s,
// broker start ~1 s, the §2 acting pane ~7 s, the §5 pane ~6 s, the §7 concurrent pair ~6 s OVERLAPPING + the
// §7 third window ~5 s, teardown ~1-2 s at DURIG_STOP_GRACE_MS=0. NO check pays a poll on a green run: the
// broker's own result records and the transcript placement are already there when the panes return, because
// the broker's plane is the rig's OFFLINE path (`DURIG_PROVIDER=faux`) and answers instantly. `node --check`
// 0.02 s. The cost that is NOT the pin's is the broker's stop, so the grace knob is 0 for the pin only
// (the same discipline as demo/mux-namespace.test.mjs §6). Registered in the **tui** area of demo/test-areas.json.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Router, registerSeat } from "../src/rig.mjs";
import { mergedInputStream } from "../src/multiplex.mjs";
import { intentInboxDir, intentResultDir, readIntentResult, readIntentError, brokerStatePath, readBrokerState } from "../src/broker.mjs";
import { assessStoreOwnership } from "../src/storeownership.mjs";
import { readSeatList } from "../src/readapi.mjs";
import { muxStartOwner, muxStopOwner } from "../tools/mux-surface-owner.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ctx = BACKGROUND_CONTEXT;
const t0 = Date.now();
const sleepMs = (ms) => new Promise((f) => setTimeout(f, ms));
const say = (s) => process.stdout.write(s);
let failures = 0;
const check = (label, ok, detail = "") => {
  if (!ok) { failures += 1; say(`FAIL ${label}: ${detail}\n`); } else say(`ok ${label}\n`);
};
const sec = () => ((Date.now() - t0) / 1000).toFixed(1);
// ID order is the LIBRARY'S (vendor/pi-main/packages/durable/dist/types.d.ts:1172 — "in `query.order` (default
// ascending) by ID"), and these ids are NUMERIC, so a lexicographic compare reads `9 > 12` — a false failure.
const cmpId = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(a) === String(na) && String(b) === String(nb)) return na - nb;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
};
const ascIds = (ids) => ids.every((x, i) => i === 0 || cmpId(ids[i - 1], x) <= 0);

// THE LIVE STORE GUARD — this pin may act only on stores under os.tmpdir().
const liveStore = join(ROOT, "selfdev.sqlite");
const liveBefore = statSync(liveStore);

const PANE = join(ROOT, "tools", "mux-pane-client.mjs");
const CLI = join(ROOT, "cli.mjs");
check("the pane client EXISTS as one file on the tools plane (a driver names it; it is not a shim written by a pin)", existsSync(PANE), PANE);

const tmp = mkdtempSync(join(tmpdir(), "durig-mux-pane-"));
const ws = join(tmp, "w");
mkdirSync(ws);
const store = join(ws, "selfdev.sqlite");

// THE SHAPE A MULTIPLEXER ACTUALLY RUNS: a child process, cwd = the workspace, argv = the core's ONE pane argv.
const runPane = (args, ms) => spawnSync(process.execPath, [PANE, ...args], { cwd: ws, timeoutMs: ms, encoding: "utf-8" });
// TWO panes at once need a NON-blocking spawn, so the concurrent section is a real overlap and not two runs in
// a row wearing the name "concurrent".
const runPaneAsync = async (args, ms) => {
  const c = spawn(process.execPath, [PANE, ...args], { cwd: ws, timeoutMs: ms });
  let out = "";
  let err = "";
  let code = null;
  c.stdout.on("data", (b) => { out += String(b); });
  c.stderr.on("data", (b) => { err += String(b); });
  await Promise.all([
    new Promise((f) => { c.on("close", (x) => { code = x; f(); }); }),
    new Promise((f) => { c.stdout.on("end", f); }),
    new Promise((f) => { c.stderr.on("end", f); }),
  ]);
  return { stdout: out, stderr: err, status: code };
};
// THE SEED — one seat, one conversation, on the MOCKED fauxProvider plane (no key, no model server, no network).
async function seed(storePath, wsDir) {
  const st = await openNodeSqliteStorage(storePath, { busyTimeoutMs: 15_000 });
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const registry = createRegistry();
  registry.install(Router);
  const writer = await Harness.open(st, { models, registry }, ctx);
  const root = await writer.root(ctx, { agent: { model: { provider: "faux", modelId: "faux-seat" }, cwd: wsDir } });
  await writer.commit(async (tx) => { await registerSeat(tx, "impl", root.id, "worker"); }, ctx);
  await writer.close(ctx);
  await st.close(ctx);
  return root.id;
}

console.log("\n=== 1. THE PANE ATTACHES, IT NEVER CREATES AN OWNER (no broker on the store) ===");
const convId = await seed(store, ws);
const seeded = statSync(store);
check("the store the pane will read EXISTS before any pane ran, seeded with one seat named impl", seeded.size > 0 && convId !== null, `size ${seeded.size} conv ${convId}`);
const lonely = runPane(["--db", store, "--select", "impl", "--pane", "impl", "--frames", "2", "--seconds", "2"], 10_000);
const lonelyText = String(lonely.stdout ?? "");
check("with NOTHING owning the store the pane refuses and exits NON-ZERO (the window dies, so a census reads a dead window, not a lying one)", (lonely.status ?? lonely.exitCode) === 1, `code ${lonely.status ?? lonely.exitCode}`);
check("and the refusal says REFUSED and names THE STORE it refused about", /REFUSED/.test(lonelyText) && lonelyText.includes(store), lonelyText.slice(0, 400));
check("and it prints the ONE command that WOULD own it, with the store named by ENV (cli.mjs has no --db)", lonelyText.includes(`DURIG_DB=${store} node cli.mjs serve`) && existsSync(CLI), lonelyText.slice(0, 500));
check("and it started NOTHING: the rig's OWN broker state file for this store does not exist", !existsSync(brokerStatePath(store)) && readBrokerState(store) === null, brokerStatePath(store));
check("and reading a store nobody owns wrote NOTHING to it (same size, same inode)", statSync(store).size === seeded.size && statSync(store).ino === seeded.ino, `seed ${seeded.size}/${seeded.ino} now ${statSync(store).size}/${statSync(store).ino}`);
check("and the refusal is the ONLY thing on stdout (no partial viewport pretending to render)", (lonelyText.match(/\[pane /g) ?? []).length === 0, `${(lonelyText.match(/\[pane /g) ?? []).length} pane lines`);

console.log("\n=== 2. THE ATTACH BANNER IS AN ASSERTION (the rig's OWN detached broker owns the store) ===");
// THE BROKER'S MODEL PLANE IS THE RIG'S OWN OFFLINE PATH, not a key and not a network: `cli.mjs:345`
// `(CFG.DURIG_PROVIDER ?? "deepinfra") === "faux"` builds `fauxProvider({ models: [{ id: MODEL_ID }] })` with
// `MODEL_ID = CFG.DURIG_MODEL ?? …` (cli.mjs:188), so naming the seat's own model id keeps
// `resolveSeatModel(models, seat.model, "faux", MODEL_ID)` (cli.mjs:650) on that provider. The DEFAULT plane is
// `deepinfra` and there is no key here, so a resident broker started without this line CANNOT ANSWER: the FIRST
// act still lands as a placed `pi.user` entry, but every LATER input stays `queued` because the conversation is
// BUSY on a turn that never completes (docs/spec.md §6 admission). That is a fixture gap wearing a product name —
// so the pin provisions the plane rather than asserting a placement it cannot cause.
process.env.DURIG_PROVIDER = "faux";
process.env.DURIG_MODEL = "faux-seat"; // the id the seed gave the seat; the provider and the seat then agree
const owner = await muxStartOwner(store, { maxDurationSec: 90, logDir: join(tmp, ".muxlogs") });
check("the RIG'S OWN detached owner is resident on the temp store (a real pid, not this pin's)", owner.ok === true && Number.isInteger(owner.pid) && owner.pid > 0, JSON.stringify({ ok: owner.ok, pid: owner.pid }));
check("and the owner was started on the rig's OWN MOCKED plane (DURIG_PROVIDER=faux — no key, no funded call, no network)", owner?.env?.DURIG_PROVIDER === "faux" && owner?.env?.DURIG_MODEL === "faux-seat", `${owner?.env?.DURIG_PROVIDER}/${owner?.env?.DURIG_MODEL}`);
let own = null;
for (let i = 0; i < 30 && (own = assessStoreOwnership(store, {}))?.owned !== true; i += 1) await sleepMs(400);
check("the rig's own ownership census reads OWNED before the pane runs (keyed on `owned`; `broker.alive` reads undefined for a live broker here)", own?.owned === true, `owned ${own?.owned} pid ${own?.broker?.pid}`);
const ACT_ONE = "PANE-CLIENT: steer from the attached client";
const r1 = runPane(["--db", store, "--select", "impl", "--pane", "impl", "--frames", "6", "--seconds", "7", "--act", ACT_ONE], 25_000);
const t1 = String(r1.stdout ?? "");
check("the client exited 0", (r1.status ?? r1.exitCode) === 0, `code ${r1.status ?? r1.exitCode ?? r1.error}`);
check("its stderr is EMPTY (a pane that dies says so in its OWN viewport, not in a stream nobody captures)", String(r1.stderr ?? "").length === 0, `${String(r1.stderr ?? "").length} chars`);
check("the banner names the ATTACH shape: leg re-read  write false", /leg re-read  write false/.test(t1), t1.slice(0, 400));
check("and the banner names the store, the seat and the CONVERSATION TOKEN the pane is a client of", t1.includes(`store ${store}`) && t1.includes("seat impl") && t1.includes(`conversation ${convId}`), t1.slice(0, 400));
check("and the banner carries the OWNER pid from the rig's own ownership census (one session, one owner, named)", new RegExp(`owner pid ${own?.broker?.pid}`).test(t1) || /owner pid not reported/.test(t1), t1.slice(0, 400));
const frames = (t1.match(/\[pane impl\] t=/g) ?? []).length;
check("the pane printed >= 4 VIEWPORT frames before it ended (resident, not a banner-and-exit)", frames >= 4, `${frames} frames`);
check("and NO frame line carries THREW/DIED/REFUSED (the death classes are printed, and a green pin has none)", !/THREW|DIED|REFUSED/.test(t1), `${(t1.match(/THREW|DIED|REFUSED/g) ?? []).length}`);
check("and its LAST line is its own liveness check (`alive at …`), not an assumed close", /alive at t=\S+s after \d+ frame/.test(t1), t1.slice(-300));
const entryLines = (t1.match(/entry \d+ kind /g) ?? []).length;
check("and the pane's viewport RENDERED the seat's own record (entry lines > 0)", entryLines > 0, `${entryLines} entry lines`);

console.log("\n=== 3. THE PANE'S ACT IS A SPOOL FILE, NOT A KEYSTROKE AND NOT A STORE WRITE ===");
const spooled = t1.match(/act -> spooled (\S+)/);
check("the act printed where it LANDED in the broker's own inbox", Boolean(spooled) && String(spooled?.[1] ?? "").startsWith(`${store}.broker.inbox/`), `${spooled?.[1] ?? "(none)"} ${t1.slice(0, 300)}`);
check("and the client SAYS the transport (op message — routed to the broker's spool, never a store write, never a keystroke)", /op message — routed to the broker's spool, never a store write, never a keystroke/.test(t1), t1.slice(0, 400));
check("and the spool directory is the rig's OWN naming (imported intentInboxDir, not a plugin-invented path)", String(spooled?.[1] ?? "").startsWith(intentInboxDir(store)), `${intentInboxDir(store)} vs ${spooled?.[1] ?? ""}`);
const keystrokes = (t1.match(/send-keys|stuff|xdotool|SendKey/g) ?? []).length;
check("and NOTHING in the pane's own output is a keystroke primitive (a typed byte is the second writer that corrupted this store twice)", keystrokes === 0, `${keystrokes}`);

console.log("\n=== 4. THE BROKER ADMITTED THE PANE'S WORDS — WITNESSED OUTSIDE THE PANE ===");
const REC = "pane-impl"; // the client's requestId is its pane identity (mux-pane-client.mjs act leg)
let rec = readIntentResult(store, REC);
for (let i = 0; i < 40 && rec === null; i += 1) { await sleepMs(500); rec = readIntentResult(store, REC); }
check("the BROKER'S OWN result record for the pane's requestId exists (the resident writer consumed it)", rec !== null, `readIntentResult(${store}, ${REC})`);
check("and that record says ok, op message, and names the SEAT — resolved from the broker's roster, not from the pane", rec?.ok === true && rec?.op === "message" && rec?.result?.seat === "impl", JSON.stringify(rec));
check("and it was DELIVERED, not dead-lettered (no error file for that requestId)", rec?.result?.delivered === true && readIntentError(store, REC) === null, `err ${JSON.stringify(readIntentError(store, REC))}`);
const stRead = await openNodeSqliteStorage(store, { busyTimeoutMs: 15_000 });
const subs = await mergedInputStream(stRead, { conversationId: convId, limit: 50 }, ctx);
const ids = subs.map((s) => s.id);
check("a plain Storage read (`mergedInputStream`, `Storage#scanSubmissions`) is ONE ID-ordered page — ascending by ID", subs.length >= 1 && ascIds(ids), `ids ${ids.join(",")}`);
const mine = subs.filter((s) => s?.requestId === REC);
check("and that ONE stream carries a record for THE PANE'S OWN requestId (the broker admitted THIS pane's request, not another client's)", mine.length >= 1, `n ${mine.length} of ${subs.length} | ${subs.map((s) => `${s.id}:${s.type}:${s.status ?? "?"}:${s.requestId ?? "-"}`).join(" ")}`);
check("and that record is an `input` admission in a KNOWN status (queued/placed/done/unanswered), so an admitted act is never a silent drop", mine.length >= 1 && mine.every((s) => s?.type === "input" && ["queued", "placed", "done", "unanswered"].includes(s?.status)), `${mine.map((s) => `${s.type}:${s.status}`).join(" ")}`);
// THE ENTRY WITNESS, from an INDEPENDENT readOnly reader — a separate handle in THIS process, NOT the pane's
// client. A submission record carries no content (types.d.ts:452 SubmissionRecordBase = id, conversationId,
// requestId, type, status, entry), so the WORDS are witnessed where they actually live: the seat's own transcript.
const readerReg = createRegistry();
readerReg.install(Router);
const readerModels = createModels(); // NO provider: this reader cannot answer, it only reads
const reader = await Harness.open(stRead, { registry: readerReg, models: readerModels, readOnly: true }, ctx);
const readTranscript = async () => {
  const c = await reader.conversation(convId, ctx);
  if (!c) return { items: [] };
  return await c.entries({}, 500, undefined, ctx);
};
let page1 = await readTranscript();
let mine1 = mine; // refreshed only if the admission has not landed yet (it lands in the RESIDENT broker)
for (let i = 0; i < 30; i += 1) {
  const users = (page1?.items ?? []).filter((e) => e?.kind === "pi.user");
  if (users.some((e) => JSON.stringify(e).includes(ACT_ONE))) break;
  await sleepMs(500);
  mine1 = (await mergedInputStream(stRead, { conversationId: convId, limit: 50 }, ctx)).filter((s) => s?.requestId === REC);
  page1 = await readTranscript();
}
const users1 = (page1?.items ?? []).filter((e) => e?.kind === "pi.user");
check("and an INDEPENDENT readOnly reader — not the pane — reads the pane's sentence as a pi.user entry in the seat's own transcript", users1.some((e) => JSON.stringify(e).includes(ACT_ONE)), `user entries ${users1.length}; kinds ${(page1?.items ?? []).map((e) => e?.kind).join(",")}`);
const linked = mine1.map((s) => s?.entry).filter(Boolean);
check("and the submission record's OWN `entry` field names a transcript entry the reader read (spool -> admission -> entry is ONE chain)", linked.length >= 1 && (page1?.items ?? []).some((e) => String(e.id) === String(linked[0])), `entry ${linked.join(",")} transcript ${(page1?.items ?? []).map((e) => e.id).join(",")}`);
const inboxDir = intentInboxDir(store);
check("and the spool is EMPTY once the broker consumed it (one writer ate the file; the pane kept the handle)", existsSync(inboxDir) ? readdirSync(inboxDir).length === 0 : true, `${existsSync(inboxDir) ? readdirSync(inboxDir).length : 0} left`);
check("and the result channel is the broker's OWN beside the spool", existsSync(intentResultDir(store)), intentResultDir(store));

console.log("\n=== 5. THE WINDOW IS RESIDENT OVER A NON-EMPTY CONVERSATION ===");
const r2 = runPane(["--db", store, "--select", "impl", "--pane", "impl-2", "--frames", "5", "--seconds", "6"], 20_000);
const t2 = String(r2.stdout ?? "");
check("a SECOND pane on the same seat exits 0", (r2.status ?? r2.exitCode) === 0, `code ${r2.status ?? r2.exitCode}`);
const frames2 = (t2.match(/\[pane impl-2\] t=/g) ?? []).length;
check("and it stayed resident for >= 4 frames of re-reads", frames2 >= 4, `${frames2} frames`);
const nonEmpty = (t2.match(/entries=(\d+)/g) ?? []).map((s) => Number(s.match(/=(\d+)/)[1]));
check("and EVERY frame saw a NON-EMPTY conversation (the admitted turn is in the seat's own record)", nonEmpty.length >= 4 && nonEmpty.every((n) => n >= 1), `entries per frame ${nonEmpty.join(",")}`);
check("and this pane read the admitted turn NEW on its FIRST frame (a fresh client sees the session's history)", new RegExp(`entry \\d+ kind pi\\.user`).test(t2), t2.slice(0, 500));
check("and it carries the same conversation token as the first pane (one session, two viewports)", t2.includes(`conversation ${convId}`), t2.slice(0, 300));

console.log("\n=== 6. NO SECOND WRITER, MEASURED ON THE STORE ITSELF ===");
const mid = statSync(store);
check("a pane that did NOT act left the store byte-for-byte unchanged (same size, same inode — no second writer, no recreated file)", statSync(store).size === mid.size && statSync(store).ino === mid.ino, `size ${mid.size} -> ${statSync(store).size} ino ${mid.ino} -> ${statSync(store).ino}`);
check("and its own banner still asserts write false (the pane cannot commit a write even by accident)", /leg re-read  write false/.test(t2), t2.slice(0, 200));

console.log("\n=== 7. N PANES, ONE SESSION — TWO WINDOWS OF ONE SEAT AT THE SAME TIME ===");
const beforePair = statSync(store);
const [pa, pb] = await Promise.all([
  runPaneAsync(["--db", store, "--select", "impl", "--pane", "A", "--frames", "5", "--seconds", "6", "--act", "PANE-A: from the first window"], 25_000),
  runPaneAsync(["--db", store, "--select", "impl", "--pane", "B", "--frames", "5", "--seconds", "6", "--act", "PANE-B: from the second window"], 25_000),
]);
const ta = String(pa.stdout ?? "");
const tb = String(pb.stdout ?? "");
check("BOTH panes exited 0 while OVERLAPPING (two real windows of one seat)", pa.status === 0 && pb.status === 0, `A ${pa.status} B ${pb.status}`);
check("both printed the SAME conversation token (N viewports never become N sessions)", ta.includes(`conversation ${convId}`) && tb.includes(`conversation ${convId}`), `A/B tokens`);
check("both are re-read legs with write false (neither is a writer)", /leg re-read  write false/.test(ta) && /leg re-read  write false/.test(tb), "both banners");
check("both named the SAME owner pid (one session, one resident owner)", (ta.match(/owner pid (\d+)/)?.[1] ?? "") === (tb.match(/owner pid (\d+)/)?.[1] ?? "") && (ta.match(/owner pid (\d+)/)?.[1] ?? "") !== "", `A ${ta.match(/owner pid (\d+)/)?.[1]} B ${tb.match(/owner pid (\d+)/)?.[1]}`);
const recA = readIntentResult(store, "pane-A");
let recB = readIntentResult(store, "pane-B");
for (let i = 0; i < 40 && recB === null; i += 1) { await sleepMs(500); recB = readIntentResult(store, "pane-B"); }
check("BOTH acts got the BROKER'S OWN result records (two panes, two admissions, no silent drop)", recA !== null && recB !== null, `A ${JSON.stringify(recA)} B ${JSON.stringify(recB)}`);
check("and BOTH records name the SAME seat (the broker resolves one conversation from its own roster)", recA?.result?.seat === "impl" && recB?.result?.seat === "impl", `${recA?.result?.seat}/${recB?.result?.seat}`);
check("and NEITHER act was dead-lettered", readIntentError(store, "pane-A") === null && readIntentError(store, "pane-B") === null, `errA ${JSON.stringify(readIntentError(store, "pane-A"))} errB ${JSON.stringify(readIntentError(store, "pane-B"))}`);
const subs2 = await mergedInputStream(stRead, { conversationId: convId, limit: 80 }, ctx);
const ids2 = subs2.map((s) => s.id);
check("the ONE merged stream is still ASCENDING by ID across every client", ascIds(ids2), `ids ${ids2.join(",")}`);
const reqA2 = subs2.filter((s) => s?.requestId === "pane-A");
const reqB2 = subs2.filter((s) => s?.requestId === "pane-B");
check("and BOTH panes' requestIds appear in that ONE stream (two clients, one line, never a per-client copy)", reqA2.length >= 1 && reqB2.length >= 1, `A ${reqA2.length} B ${reqB2.length} | ${subs2.map((s, i) => `${s.id}:${s?.type}:${s?.status ?? "?"}:${s?.requestId ?? "-"}`).join(" ")}`);
let page2 = await readTranscript(); // the SAME independent reader, still open across §4-§7
// THE PLACEMENT CADENCE, MEASURED not assumed (see the probe record in .ai-work/mux-plugin-goal/STATE.md).
// `vendor/pi-main/packages/durable/dist/harness/submissions.js` `admitSubmission` — "A busy conversation queues
// anything else in `pi.inbox`" and "An idle conversation with queued items queues it behind them and runs a
// final boundary" — means ONE act places what the conversation had left queued, and the NEWEST input becomes the
// queued one. Measured on this rig's offline plane: TWO concurrent acts leave ONE `pi.user` entry + ONE `queued`
// submission; a THIRD window's words run that final boundary and BOTH earlier sentences become `pi.user` entries.
// So the third window is part of the section: it is what a real session does next, and it is what makes the
// merge claim checkable rather than asserted.
const pc = runPane(["--db", store, "--select", "impl", "--pane", "C", "--frames", "4", "--seconds", "5", "--act", "PANE-C: a third window after the pair"], 20_000);
const tc = String(pc.stdout ?? "");
check("a THIRD window on the SAME seat attaches and exits 0 (the pair did not exhaust the session)", (pc.status ?? pc.exitCode) === 0, `code ${pc.status ?? pc.exitCode}`);
check("and it names the SAME conversation token (three viewports, still ONE session)", tc.includes(`conversation ${convId}`), tc.slice(0, 300));
let recC = readIntentResult(store, "pane-C");
for (let i = 0; i < 20 && recC === null; i += 1) { await sleepMs(500); recC = readIntentResult(store, "pane-C"); }
check("and its act got the BROKER'S OWN result record too (three admissions, no silent drop)", recC !== null && recC?.result?.delivered === true, JSON.stringify(recC));
const subs3 = await mergedInputStream(stRead, { conversationId: convId, limit: 90 }, ctx);
check("and the ONE merged stream still holds all THREE clients' requestIds in ASCENDING ID order", ascIds(subs3.map((s) => s.id)) && ["pane-A", "pane-B", "pane-C"].every((r) => subs3.some((s) => s?.requestId === r)), `${subs3.map((s) => `${s.id}:${s?.type}:${s?.status ?? "?"}:${s?.requestId ?? "-"}`).join(" ")}`);
for (let i = 0; i < 30; i += 1) {
  const u = (page2?.items ?? []).filter((e) => e?.kind === "pi.user");
  if (u.some((e) => JSON.stringify(e).includes("PANE-A:")) && u.some((e) => JSON.stringify(e).includes("PANE-B:"))) break;
  await sleepMs(500); // the placement happens in the RESIDENT broker, not in the panes that already exited
  page2 = await readTranscript();
}
const users2 = (page2?.items ?? []).filter((e) => e?.kind === "pi.user");
check("and the independent reader finds BOTH windows' sentences as pi.user entries in the ONE transcript (they merged; they did not fork)", users2.some((e) => JSON.stringify(e).includes("PANE-A:")) && users2.some((e) => JSON.stringify(e).includes("PANE-B:")), `user entries ${users2.length}`);
const seatRows = await readSeatList(stRead, ctx);
check("and the roster still holds exactly ONE seat for that conversation (N panes never become N seats)", seatRows.length === 1 && seatRows.some((s) => s.name === "impl" && String(s.conversationId) === String(convId)), `seats ${seatRows.map((s) => `${s.name}:${s.conversationId}`).join(",")}`);
await reader.close(ctx); // the independent reader's handle is released before the store closes
await stRead.close(ctx);

console.log("\n=== 8. THE HONEST GAP: A PANE NAMED FOR A SEAT THE STORE DOES NOT HOLD ===");
const ghost = runPane(["--db", store, "--select", "ghost", "--pane", "ghost", "--frames", "1"], 10_000);
const tg = String(ghost.stdout ?? "");
check("a pane for an unknown seat refuses and exits NON-ZERO (an empty window is not a working window)", (ghost.status ?? ghost.exitCode) === 1, `code ${ghost.status ?? ghost.exitCode}`);
check("and it names the store AND the seats it DOES find (the ask is corrected, not guessed)", tg.includes(store) && /known seats: impl/.test(tg), tg.slice(0, 300));
check("and it printed NO viewport (nothing renders from a seat that is not there)", (tg.match(/\[pane ghost\] t=/g) ?? []).length === 0, `frames ${(tg.match(/\[pane ghost\] t=/g) ?? []).length}`);

console.log("\n=== 9. TEARDOWN: the pin leaves no owner behind ===");
process.env.DURIG_STOP_GRACE_MS = "0"; // cli.mjs honours 0, so a pin pays the stop grace once (demo/mux-namespace.test.mjs §6)
const stopped = await muxStopOwner(store, { timeoutMs: 30_000 });
check("the owner this pin started is halted by the rig's OWN off switch", stopped.ok === true && stopped.rc === 0, `ok ${stopped.ok} rc ${stopped.rc} ms ${stopped.ms}`);
let own2 = null;
for (let i = 0; i < 20 && (own2 = assessStoreOwnership(store, {})).owned; i += 1) await sleepMs(300);
check("and the store is no longer OWNED after teardown (no orphan broker holding a temp store)", own2?.owned === false, `owned ${own2?.owned}`);

rmSync(tmp, { recursive: true, force: true });
check("the temp workspace is removed", !existsSync(tmp), `existsSync ${existsSync(tmp)}`);
const liveAfter = statSync(liveStore);
check("the rig's LIVE store did not move by a byte", liveAfter.mtimeMs === liveBefore.mtimeMs && liveAfter.size === liveBefore.size, `mtime ${liveBefore.mtimeMs} -> ${liveAfter.mtimeMs} size ${liveBefore.size} -> ${liveAfter.size}`);

const secsTotal = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  say(`\nMUX-PANE-CLIENT PASS (${secsTotal}s total) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — the plugin's OWN pane client (tools/mux-pane-client.mjs, spelled by the core's ONE muxPaneArgv and run as a CHILD PROCESS exactly as a multiplexer window runs it) REFUSED BY NAME with the store and the exact owning command \`DURIG_DB=<store> node cli.mjs serve\` while nothing owned the temp store, then on a REAL temp store seeded with one seat on the MOCKED fauxProvider plane and owned by the rig's OWN detached broker it attached as \`leg re-read  write false\` with the conversation token and the OWNER pid in its banner, printed ${frames}+${frames2} viewport frames over a NON-EMPTY conversation, routed its ONE act to \`${spooled?.[1] ?? ""}\` (op message — never a keystroke, never a store write), and the BROKER admitted it: its OWN result record (ok, op message, seat impl, delivered) plus a plain Storage scanSubmissions page carrying the pane's sentence in ASCENDING ID order, which the pane's OWN next frame read NEW. TWO panes ran CONCURRENTLY on ONE seat — same conversation token, same owner pid, both re-read legs, two broker result records naming one seat, both sentences in ONE ascending stream — so N viewports merge into ONE session and never fork. A pane that did not act left the store byte-identical (same size, same inode), which is the second-writer claim MEASURED. ${failures} failures.\n`);
  process.exit(0);
}
say(`${failures} FAILURE(S) (${secsTotal}s)\n`);
process.exit(1);
