// demo/mux-ownership.test.mjs — the OWNERSHIP + PROCESS legs of the multiplexer presentation seam
// (goal mwpeepwa-spmy34, tasks `ownership` + `ownership-interact`; the goal's contracts (3) ATTACH-or-CREATE,
// tmux's own detach semantics, and (6) ONE owner, never a second writer).
//
// WHAT EACH SECTION CLOSES (nothing below this line is prose):
//   1. ATTACH-OR-CREATE IS THE RIG'S RULE, IMPORTED, AND THE RESIDENT OWNER IS A REAL PROCESS. A presentation
//      layer that grew its OWN ownership test would open a second writer beside `tui.mjs`'s — the thing that
//      corrupted this store twice. Closed by the verdict coming from `assessStoreOwnership`/`tuiOpenVerdict` and
//      answering all four legs (attach / create / none-asked / genlock-with-no-session) the same way `tui.mjs`
//      decides, AND by the ATTACH leg being answered by a broker the plugin actually STARTED (a hand-written
//      state file pretending to be a broker would prove nothing about a real pid).
//   2. THE OWNER COMMAND NAMES ITS STORE. MEASURED DEFECT (2026-11-21): `cli.mjs` HAS NO `--db`; an invented one is
//      SILENTLY IGNORED and the verb acts on the CONFIGURED store. Closed by the command being argv + `env`, by
//      every printed command being the ONE copyable string that works (`DURIG_DB=<store> node cli.mjs serve`), and
//      by RUNNING it and reading the `db` field it answers with — the named store, never the rig's own.
//   3. STARTING THE OWNER REFUSES RATHER THAN DOUBLE-STARTS (one store, one writer).
//   4. THE ONE PROCESS DOOR, and the ask that opens it: `--run`. Without it the argv is PRINTED ONLY.
//   5. EVERY CALL IS BOUNDED, and a bound hit is a MEASUREMENT (`timedOut:true` + the number), never an empty success.
//   6. THE OFF SWITCH (`serve --stop`) is idempotent and scoped: run twice on a temp store, and the rig's LIVE store
//      does not move by a byte across the whole gate.
//   7. THROUGH THE SURFACE: the census PRINTS the owner command and the halt argv with its env, so a reader copying
//      the line gets a command that acts on THAT store.
//   8. THE REAL OWNER IS HALTED BY THE RIG'S OWN OFF SWITCH, AND THE CENSUS DROPS. Closed by the stop's own report
//      naming the TEMP store as its `db`, and by the broker state file and the ownership census both going DOWN after
//      it — with `stopped:true` NOT claimed, because signal-0 liveness cannot decide it for an unreaped detached child.
//
// HERMETIC WHERE IT CAN: the seats are handed in through the core's own read seams; the stores this pin names are
// temp dirs under os.tmpdir(). The rig's live store is asserted unmoved at the end.
// Run: node demo/mux-ownership.test.mjs (exit 0 = pass)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { muxOwnershipPlan, muxSurfaceInvoke, muxSurfaceDrivers, muxEnvPrefix, MUX_STORE_ENV, MUX_STORE_ENV_ALIAS } from "../tools/mux-surface-core.mjs";
import { muxRunArgv, muxRunPlan, muxStartOwner, muxStopOwner } from "../tools/mux-surface-owner.mjs";
import { brokerStatePath, readBrokerState } from "../src/broker.mjs";
import { assessStoreOwnership, brokerAlive } from "../src/storeownership.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const CLI = join(ROOT, "cli.mjs");
const liveStore = join(ROOT, "selfdev.sqlite");
const statOf = (p) => (existsSync(p) ? statSync(p).mtimeMs : null);
// Residency is POLLED, not assumed: `cli.mjs serve` writes its state file after it opens the harness.
const sleepMs = (ms) => new Promise((f, t) => setTimeout(f, ms));
const liveStoreBefore = statOf(liveStore);
const tmp = mkdtempSync(join(tmpdir(), "durig-mux-own-"));

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) return;
  failures += 1;
  process.stdout.write(`FAIL ${label}: ${detail}\n`);
};

console.log("=== 1. THE VERDICT IS THE RIG'S OWN RULE, ON ALL FOUR LEGS ===");
const t0 = Date.now();
// A store that does not exist at all: the plugin must neither create it nor invent an owner for it.
const w1 = join(tmp, "w1");
const store = join(w1, "selfdev.sqlite");
const none = muxOwnershipPlan(store, {});
check("nothing owns it and nothing was asked is REFUSED BY NAME", none.ok === false && none.code === "no-owner-and-none-asked", JSON.stringify({ code: none.code, ok: none.ok }));
check("and it names THE STORE it was asked about, not the configured one", none.refusal.includes(store) && none.refusal.includes("Nothing was started"), none.refusal.slice(0, 220));
check("and no store and no workspace directory were created by that refusal", !existsSync(store) && !existsSync(w1), `exists ${existsSync(store)}/${existsSync(w1)}`);
check("so the same rule `tui.mjs` uses answers identically (the rig's own verdict, imported)", (() => {
  const own = assessStoreOwnership(store);
  return own.owned === false && own.genlocks.length === 0 && own.reasons.length === 0;
})(), "assessStoreOwnership says nothing owns it");

const created = muxOwnershipPlan(store, { create: true });
check("an explicit --create answers CREATE, posture detached-owner", created.ok === true && created.action === "create" && created.posture === "detached-owner", JSON.stringify({ action: created.action, posture: created.posture }));
check("and create names the command it would start, still without creating anything", created.reasons.some((r) => r.includes("node cli.mjs serve")) && !existsSync(store), `${created.reasons.join(" | ").slice(0, 200)} exists ${existsSync(store)}`);

// THE RESIDENT OWNER, REAL — NOT CRAFTED. The plugin's own owner plane starts the rig's OWN detached broker
// (`cli.mjs serve`, store named by ENV) on a TEMP store under a bounded `--max-duration`, so the ATTACH leg is
// answered by a process that exists and by the pid THAT PROCESS wrote. A hand-written state file with this pin's
// own pid would have passed the same census while no broker existed — which is the lie this pin refuses.
const w2 = join(tmp, "w2");
mkdirSync(w2, { recursive: true });
const ownedStore = join(w2, "selfdev.sqlite");
const statePath = brokerStatePath(ownedStore);
// The offline plane: no key, no network, no real model (docs/runbooks/slow-loop.md — fauxProvider).
process.env.DURIG_PROVIDER = "faux";
const started = await muxStartOwner(ownedStore, { maxDurationSec: 8, now: Date.now() });
check("a REAL owner start ran and answered a REAL pid (not this pin's)", started.ok === true && Number.isInteger(started.pid) && started.pid > 0 && started.pid !== process.pid, JSON.stringify({ ok: started.ok, pid: started.pid, pin: process.pid }));
check("and it named the TEMP store by ENV in its own env and its printed text, with no invented --db", started.env[MUX_STORE_ENV] === ownedStore && started.env[MUX_STORE_ENV_ALIAS] === ownedStore && started.text.startsWith(`${MUX_STORE_ENV}=${ownedStore}`) && !started.text.includes("--db"), started.text);
check("and the store it was pointed at is NOT the rig's own live store", started.env[MUX_STORE_ENV] === ownedStore && started.env[MUX_STORE_ENV] !== liveStore, `${started.env[MUX_STORE_ENV]} vs ${liveStore}`);
let seen = null;
for (let i = 0; i < 40 && seen === null; i += 1) {
  seen = readBrokerState(ownedStore);
  if (seen === null) await sleepMs(150);
}
check("and the broker's own state file appeared, at the rig's OWN path convention", existsSync(statePath) && statePath === `${ownedStore}.broker.json` && seen !== null, statePath);
check("and that state names THE STARTED PROCESS as live (the rig's own probe, heartbeat inside the window)", seen?.pid === started.pid && brokerAlive(seen, { now: Date.now() }) === true, JSON.stringify(seen));
const attach = muxOwnershipPlan(ownedStore, {});
check("a live broker makes the pane ATTACH (posture readOnly), never OPEN", attach.ok === true && attach.action === "attach" && attach.posture === "readOnly", JSON.stringify({ action: attach.action, posture: attach.posture }));
check("and it names the broker by the REAL pid the start returned — the ONE owner the session lives in", attach.broker?.pid === started.pid && attach.reasons.some((r) => r.includes(`pid ${started.pid}`)), `${attach.broker?.pid} reasons ${attach.reasons.join(" | ")}`);
check("and the rig's own liveness probe agrees (heartbeat inside the window)", brokerAlive(readBrokerState(ownedStore), { now: Date.now() }) === true, "brokerAlive");

const genlock = muxOwnershipPlan(ownedStore, { attach: true });
check("`attach` on a store NO broker drives is the OTHER refusal (no-session-to-attach)", (() => {
  mkdirSync(join(tmp, "w3"), { recursive: true });
  const s = join(tmp, "w3", "selfdev.sqlite");
  const r = muxOwnershipPlan(s, { attach: true });
  return r.ok === false && r.code === "no-session-to-attach" && r.refusal.includes("no session to attach to");
})(), "third store, attach asked, no broker");

// THE STOP LEGS RUN a real `cli.mjs serve --stop`. HAZARD RULE (measured 2026-11-21): a store whose broker state
// names a LIVE pid makes the off switch WAIT for that process to settle before it answers — the wait ceiling is
// `resolveStopGraceMs() + 5_000` (cli.mjs:2372, grace default 5 000 ms, `DURIG_STOP_GRACE_MS` overrides), so an
// unbounded probe there is the 20-minute turn this rig keeps hitting. Section 3b pays that grace ONCE, deliberately,
// with the env-named store and a `timeoutMs` above the measured number. THIS store answers in ~280 ms and creates
// nothing: it is the scoped, idempotent answer this section is about.
const w4 = join(tmp, "w4");
mkdirSync(w4, { recursive: true });
const stopStore = join(w4, "selfdev.sqlite");

console.log("\n=== 2. THE OWNER COMMAND NAMES ITS STORE BY ENV (the measured `cli.mjs` has no --db defect) ===");
check("the core's `start` argv carries NO flag `cli.mjs` does not have", JSON.stringify(none.start) === JSON.stringify(["node", "cli.mjs", "serve"]) && !none.start.includes("--db"), JSON.stringify(none.start));
check("and the store travels as `env`, so the argv cannot act on the wrong store", none.startEnv[MUX_STORE_ENV] === store && none.startEnv[MUX_STORE_ENV_ALIAS] === store, JSON.stringify(none.startEnv));
check("and the printed command is ONE copyable string that works", none.startText.startsWith(`${MUX_STORE_ENV}=${store}`) && none.startText.endsWith(" node cli.mjs serve") && !none.startText.includes("--db"), none.startText);
check("and the core's own env printer produced it", none.startText === `${muxEnvPrefix(none.startEnv)} ${none.start.join(" ")}`, `${none.startText} vs ${muxEnvPrefix(none.startEnv)} ${none.start.join(" ")}`);
// THE PROOF, not the claim: run the owner command with that env against the TEMP store and read the store it says it
// acted on. The rig's own store is 810 MB of live state; naming it in a refusal is fine, ACTING on it is not.
const stop = muxStopOwner(stopStore, { timeoutMs: 5_000 });
const stopDoc = (() => { try { return JSON.parse(String(stop.stdout)); } catch { return null; } })();
check("`serve --stop` with the env names the TEMP store in its own report", stopDoc?.db === stopStore && stopDoc?.command === "serve" && stopDoc?.action === "stop", JSON.stringify(stopDoc ?? stop.reason));
check("and it found no broker there (this pin's crafted state file is not a process), so it stopped nothing", stopDoc?.stopped === false && stopDoc?.reason === "no broker is running", JSON.stringify(stopDoc ?? null));
check("and it ran bounded and rc 0 (ok is the plane's own ran+rc===0 verdict)", stop?.ok === true && stop?.rc === 0 && typeof stop?.ms === "number" && stop.ms < 5_000, `ok ${stop?.ok} rc ${stop?.rc} ms ${stop?.ms}`);
check("and its command is exactly the printed one (no --db anywhere)", JSON.stringify(stop.command) === JSON.stringify([process.execPath, CLI, "serve", "--stop"]) && stop.text.startsWith(`${MUX_STORE_ENV}=${stopStore}`) && !stop.text.includes("--db"), stop.text);

console.log("\n=== 3. STARTING THE OWNER REFUSES RATHER THAN DOUBLE-STARTS ===");
const dry = await muxStartOwner(store, { dryRun: true, now: Date.now() });
check("a DRY RUN names the command, starts nothing, and says so", dry.ok === true && dry.dryRun === true && dry.reason === "DRY RUN — nothing was started", JSON.stringify({ ok: dry.ok, reason: dry.reason }));
check("with no `--db` invented and the store named in its env", JSON.stringify(dry.command) === JSON.stringify([process.execPath, CLI, "serve"]) && dry.env[MUX_STORE_ENV] === store, JSON.stringify(dry.command));
check("and the env is MERGED over the plane's own, so PATH still resolves (a bare backend name must)", dry.env.PATH === process.env.PATH, `${String(dry.env.PATH).slice(0, 60)} vs ${process.env.PATH.slice(0, 60)}`);
check("and the dry run wrote nothing: no store, no state file, no log dir", !existsSync(store) && !existsSync(brokerStatePath(store)) && !existsSync(join(w1, ".spike")), `store ${existsSync(store)} state ${existsSync(brokerStatePath(store))} logs ${existsSync(join(w1, ".spike"))}`);
// The same RESIDENT store from section 1, started a second time. `dryRun: true` so a broken guard cannot answer by
// spawning a second writer; the guard is checked BEFORE the dry-run branch, so a refusal here is the guard's answer.
const again = await muxStartOwner(ownedStore, { dryRun: true, now: Date.now() });
check("a store the broker ALREADY owns REFUSES (a second owner would be a second writer)", again.ok === false && again.code === "owner-already-resident", JSON.stringify({ code: again.code, ok: again.ok }));
check("and the refusal names the REAL pid it found and the state file, so a reader can verify it", again.reason.includes(String(started.pid)) && again.statePath === brokerStatePath(ownedStore), `${again.reason} state ${again.statePath}`);

console.log("\n=== 4. THE ONE DOOR IS AN EXPLICIT ASK (`--run`); WITHOUT IT NOTHING MOVES ===");
const haltPlan = { commands: [{ action: "halt", pane: "-", argv: ["node", "cli.mjs", "serve", "--stop"], env: { [MUX_STORE_ENV]: store } }], panes: [] };
const gate = await muxRunPlan(haltPlan, { run: false });
check("an ask that did not pass --run answers ran:false and SAYS so", gate.ran === false && gate.reason.includes("--run") && gate.steps.length === 0, JSON.stringify({ ran: gate.ran, reason: gate.reason, steps: gate.steps.length }));
const okPlan = { commands: [{ action: "noop", pane: "impl", argv: ["node", "-e", "process.exit(0)"] }], panes: [] };
const ran = await muxRunPlan(okPlan, { run: true, timeoutMs: 5_000 });
check("with --run the door runs, and reports rc and the ms it took", ran.ran === true && ran.ok === true && ran.steps.length === 1 && ran.steps[0].rc === 0 && typeof ran.steps[0].ms === "number", JSON.stringify(ran.steps));
check("and the step attributes the argv to the pane it belongs to", ran.steps[0].pane === "impl" && JSON.stringify(ran.steps[0].argv) === JSON.stringify(["node", "-e", "process.exit(0)"]), JSON.stringify(ran.steps[0]?.argv));

console.log("\n=== 5. EVERY CALL IS BOUNDED, AND A BOUND HIT IS A MEASUREMENT ===");
const bound = muxRunArgv(["sleep", "5"], { timeoutMs: 300 });
check("a command past its bound answers timedOut with the NUMBER, never an rc", bound.timedOut === true && bound.boundMs === 300 && bound.rc === null && bound.ran === true, JSON.stringify({ timedOut: bound.timedOut, boundMs: bound.boundMs, rc: bound.rc, ms: bound.ms }));
check("and the reason states the decision is not settled (partial output is not an answer)", bound.reason.includes("hit the 300 ms bound") && bound.reason.includes("rc not decided"), bound.reason);
const halfPlan = { commands: [{ action: "open", pane: "impl", argv: ["sleep", "5"] }, { action: "open", pane: "qa", argv: ["node", "-e", "process.exit(0)"] }], panes: [] };
const half = await muxRunPlan(halfPlan, { run: true, timeoutMs: 300 });
check("a half-run pane set STOPS the run with ok:false (half a pane set is not a state)", half.ran === true && half.ok === false && half.steps.length === 1 && half.steps[0].timedOut === true, JSON.stringify({ ok: half.ok, steps: half.steps.length, timedOut: half.steps[0]?.timedOut }));
check("and it names which step failed, so the reader knows what was applied", String(half.reason).includes("open pane impl"), half.reason);

console.log("\n=== 6. THE OFF SWITCH IS SCOPED AND IDEMPOTENT (the same store, twice) ===");
const stop2 = muxStopOwner(stopStore, { timeoutMs: 5_000 });
const stop2Doc = (() => { try { return JSON.parse(String(stop2.stdout)); } catch { return null; } })();
check("a second stop on an already-stopped store answers the SAME way (idempotent, not an error)", JSON.stringify(stop2Doc) === JSON.stringify(stopDoc) && stop2.ok === true, `${JSON.stringify(stop2Doc)} vs ${JSON.stringify(stopDoc)}`);
check("and neither stop touched the temp store file itself", !existsSync(stopStore), `exists ${existsSync(stopStore)}`);
check("and neither stop touched the RIG's own broker state", !existsSync(brokerStatePath(liveStore)) || readBrokerState(liveStore) === null, `rig state ${existsSync(brokerStatePath(liveStore))}`);

console.log("\n=== 7. THROUGH THE SURFACE: what a reader sees is the command that acts on THAT store ===");
const registry = await muxSurfaceDrivers({ dir: join(ROOT, "tools"), env: {} });
const seats = [{ name: "impl", conversationId: "conv-impl" }, { name: "qa", conversationId: "conv-qa" }];
const seams = { readSeats: async () => seats, readRows: async () => [], sessions: async () => [], drivers: registry };
const openRefusal = await muxSurfaceInvoke("open --all", { env: {}, cwd: ROOT, seams, store });
check("`open` where nothing owns the store refuses with the START command printed", openRefusal.ok === false && openRefusal.exitCode === 1 && openRefusal.show[0].level === "error" && openRefusal.show[0].body.includes("node cli.mjs serve"), JSON.stringify(openRefusal.show[0].body).slice(0, 240));
check("and it prints the ENV-NAMED form, so the line is copyable against that store", openRefusal.show[0].body.includes(`${MUX_STORE_ENV}=${store}`) && openRefusal.show[0].body.includes("--create"), openRefusal.show[0].body.slice(0, 300));
check("and no pane CENSUS was printed for it and no commands were named (the selection itself runs before the ownership refusal, so panes exist and that is honest)", !openRefusal.show.some((l) => l.body.includes("mux census —")) && !openRefusal.plan, `plan ${openRefusal.plan ? openRefusal.plan.length : 0} census ${openRefusal.show.filter((l) => l.body.includes("mux census —")).length}`);
const haltAsk = await muxSurfaceInvoke("halt", { env: {}, cwd: ROOT, seams, store: ownedStore });
check("the session-level `halt` asks no selector and reaches the plan", haltAsk.ok === true && haltAsk.exitCode === 0 && haltAsk.plan?.commands?.length === 1, JSON.stringify({ ok: haltAsk.ok, cmds: haltAsk.plan?.commands?.length }));
const haltCmd = haltAsk.plan.commands[0];
check("its argv is the rig's own off switch, and its env names THIS store", JSON.stringify(haltCmd.argv) === JSON.stringify(["node", "cli.mjs", "serve", "--stop"]) && haltCmd.env[MUX_STORE_ENV] === ownedStore, JSON.stringify({ argv: haltCmd.argv, env: haltCmd.env }));
check("and the census PRINTS that command with its env, and says nothing was run", haltAsk.show[0].body.includes(`DURIG_DB=${ownedStore} DURIAN_PI_DB=${ownedStore} node cli.mjs serve --stop`) && haltAsk.show[0].body.includes("PRINTED ONLY (nothing was run"), haltAsk.show[0].body.slice(0, 600));
check("and the census still attributes the namespace it acted in", /namespace: plugin/.test(haltAsk.show[0].body), haltAsk.show[0].body.split("\n")[0]);

console.log("\n=== 8. THE REAL OWNER IS HALTED BY THE RIG'S OWN OFF SWITCH, AND THE CENSUS DROPS ===");
// The grace is env-overridable exactly so a demo can prove the decision fast (cli.mjs:2388 `resolveStopGraceMs`,
// `DURIG_STOP_GRACE_MS`, "a non-positive value is honoured (0 disables the bound)"). 0 makes the wait ceiling 5 s,
// and the spawn bound below is still a round step above the guess, never below it.
process.env.DURIG_STOP_GRACE_MS = "0";
const stopReal = muxStopOwner(ownedStore, { timeoutMs: 20_000 });
const stopRealDoc = (() => { try { return JSON.parse(String(stopReal.stdout)); } catch { return null; } })();
check("it ran rc 0 and named the TEMP store as its own `db` (never the configured one)", stopReal.ok === true && stopReal.rc === 0 && stopRealDoc?.db === ownedStore && stopRealDoc?.command === "serve" && stopRealDoc?.action === "stop", `${JSON.stringify(stopRealDoc) ?? ""} | ok ${stopReal.ok} rc ${stopReal.rc}`);
check("and it ran BOUNDED and reported the ms it waited", typeof stopReal.ms === "number" && stopReal.ms > 0 && stopReal.ms < 20_000, `ms ${stopReal?.ms}`);
// `stopped:true` is NOT claimed. The broker is a DETACHED child of THIS process, and liveness here is signal 0
// (`src/storeownership.mjs:22` `pidAlive`: gone means ESRCH), which does not answer ESRCH for a process that has
// exited but not yet been reaped — so the off switch reads the pid as still settling and says so. Measured 2026-11-21:
// `stopped:false` at 10.29 s on the default grace. What IS asserted is the STATE: the owner is gone and the census agrees.
check("and it either stopped it or said exactly why it did not (never a silent maybe)", stopRealDoc?.stopped === true || (stopRealDoc?.stopped === false && String(stopRealDoc?.reason).includes("stop grace")), `${stopRealDoc?.stopped} ${stopRealDoc?.reason}`);
let after = readBrokerState(ownedStore);
for (let i = 0; i < 40 && after !== null; i += 1) {
  await sleepMs(250);
  after = readBrokerState(ownedStore);
}
check("and the broker state file is GONE, so no orphan owner survives the halt", after === null && !existsSync(statePath), `state ${existsSync(statePath)} seen ${JSON.stringify(after)}`);
const down = muxOwnershipPlan(ownedStore, {});
check("and the census reads DOWN for the same store, so a closed pane leaves nothing to silently attach to", down.ok === false && down.code === "no-owner-and-none-asked" && down.refusal.includes(ownedStore), JSON.stringify({ code: down.code, refusal: String(down.refusal).slice(0, 200) }));
check("and halting the real owner left the RIG's own broker state untouched", !existsSync(brokerStatePath(liveStore)) || readBrokerState(liveStore) === null, `rig state ${existsSync(brokerStatePath(liveStore))}`);

rmSync(tmp, { recursive: true, force: true });
check("and the RIG's live store did not move by a byte for this whole gate", statOf(liveStore) === liveStoreBefore, `selfdev.sqlite mtime ${liveStoreBefore} -> ${statOf(liveStore)}`);
check("and its size is unchanged too", statSync(liveStore).size === 810_074_112, `size ${statSync(liveStore).size}`);
const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  process.stdout.write(`\nMUX-OWNERSHIP PASS (${secs}s total) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — the attach-or-create decision is the RIG'S imported rule (tuiOpenVerdict) answering all four legs (ATTACH posture readOnly on a REAL detached broker the plugin's own owner plane started on a temp store, pid ${started.pid}, whose state file and census both name that pid / create posture detached-owner on --create / none-asked REFUSED BY NAME and creating nothing / no-session-to-attach); the owner command names its store by ENV (cli.mjs has NO --db, measured) so the printed DURIG_DB=<store> node cli.mjs serve IS the command that acts on it (running it answered db=<that temp store> in ${stop.ms}ms and stopped NOTHING); starting a SECOND owner on that resident store REFUSED owner-already-resident naming pid ${started.pid} rather than double-starting a second writer; the REAL owner was then halted by the rig's own off switch (rc ${stopReal.rc} after ${stopReal.ms}ms at DURIG_STOP_GRACE_MS=0, its report naming db=${ownedStore}) and the broker state file plus the census went DOWN together (stopped:true is NOT claimed — signal-0 liveness reads an unreaped detached child as still settling, src/storeownership.mjs:22); muxRunPlan runs argv ONLY under --run (ran:false names the ask), every call is BOUNDED (a sleep 5 at 300 ms answered timedOut:true boundMs:300 rc:null and the pane set STOPPED with ok:false naming the step), serve --stop is scoped+idempotent, and the rig's 810,074,112-byte live store did not move by a byte (${secs}s)\n`);
  process.exit(0);
}
process.stdout.write(`${failures} FAILURE(S)\n`);
process.exit(1);
