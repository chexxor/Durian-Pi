// demo/mux-drivers.test.mjs — the DRIVER REGISTRY and the PRESENCE census (goal mwpeepwa-spmy34, tasks `drivers`
// + `drivers-zellij` + `drivers-screen` + `drivers-herdr` + `drivers-windows`; the goal's contracts (1) "ONE
// backend-agnostic core + a per-backend driver registry", (7) "a backend whose binary is not on this host is
// registered and NOT-RUN, never silently assumed", and D131 "Linux and Windows are both operating platforms").
//
// WHAT EACH SECTION CLOSES (nothing below this line is prose):
//   1. THE REGISTRY IS DISCOVERED, NOT LISTED — the core reads the table from the filesystem and keys it by each
//      driver's OWN backend field. A driver added to tools/ is a registration, and a core that LISTED the four
//      backends could not have been extended by a stranger.
//   2. THE DEFAULT BACKEND IS A DRIVER FACT (`rank`) — proven by a temp registry whose extra driver has the
//      highest rank: the winner moves WITHOUT editing the core. Alphabetical discovery order is not a shipping
//      decision and the pin says which order each of `names`, `styles` and `ranked` is in.
//   3. THE KNOB — DURIAN_PI_MUX_BACKEND overrides the active backend; an unregistered ask does NOT silently
//      become the backend (the rank winner still answers and `requested` is kept so the refusal can name it).
//   4. THE PRESENCE CENSUS ON THIS HOST — screen answers with its version line; tmux/zellij/herdr answer
//      "binary NOT on PATH => NOT-RUN" at ms 0 WITHOUT spawning, i.e. no version was invented for a backend that
//      is not here.
//   5. A HANGING BINARY IS A MEASUREMENT, not a hung pin — the shim sleeps 30 s, the probe bound answers.
//   6. THE HERMETIC TMUX SHIM — a real process receives the driver's EXACT argv bytes and reports them back.
//      THIS PROVES ARGV BYTES AND DISPATCH ONLY, NOT TMUX'S PANE SEMANTICS (tmux is absent on this host).
//   7. A `;`-SEPARATED PATH still RESOLVES in the seam's own scanner (a native-Windows host's PATH form), and an
//      absent binary still reads absent under that same PATH (the fix did not make missing look present).
//   8. A BROKEN DRIVER IS REPORTED, not silently absent — loadErrors names the file and the backend stays
//      unregistered; an empty registry makes the active backend null, it does not invent one.
//   9. THE CAPABILITY TABLE IS PER DRIVER — three of four declare detach, herdr does not, and the refusal names
//      both. NO driver names an `act` command and NO emitted argv anywhere is a terminal input primitive.
//  10. A DRIVER THAT CANNOT NAME AN ASK SAYS SO — tmux session names may not contain `.` or `:`, so a user-namespace
//      session named `4242.user-watching` gets a note and NO argv, and the whole ask becomes a refusal BY NAME
//      rather than a silent rename that would aim at a different session.
//
// HERMETIC: the only processes this pin starts are (a) this host's GNU Screen probe, and (b) a shim script in a
// temp dir. No real multiplexer session is created and the rig's live store is never read.
// Run: node demo/mux-drivers.test.mjs (exit 0 = pass)
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

import {
  muxCapability,
  muxPlan,
  muxSurfaceDrivers,
  MUX_BACKEND_ENV,
  MUX_VERB_NAMES,
} from "../tools/mux-surface-core.mjs";
import { muxProbeBackends, muxRunPlan, muxRunArgv } from "../tools/mux-surface-owner.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TOOLS = join(ROOT, "tools");
const liveStore = join(ROOT, "selfdev.sqlite");
const liveMtime = statSync(liveStore).mtimeMs;
const liveSize = statSync(liveStore).size;
const tmp = mkdtempSync(join(tmpdir(), "durig-mux-drivers-"));
const PATH0 = process.env.PATH;

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) return;
  failures += 1;
  process.stdout.write(`FAIL ${label}: ${detail}\n`);
};

console.log("=== 1. THE REGISTRY IS DISCOVERED, NOT LISTED ===");
const t0 = Date.now();
const coreSource = readFileSync(join(TOOLS, "mux-surface-core.mjs"), "utf8");
const backends = ["tmux", "screen", "zellij", "herdr"];
check("the core's own source names ZERO backend words (the core is backend-agnostic, measured)", backends.every((b) => !new RegExp(b, "i").test(coreSource)), `${backends.filter((b) => new RegExp(b, "i").test(coreSource)).join(",") || "none"} in core`);
check("the registry is discovered by a FILE PATTERN, not a list", coreSource.includes("mux-driver-[a-z]") && !coreSource.includes('const MUX_DRIVER_FILES'), "pattern + no file list");
const onDisk = readdirSync(TOOLS).filter((n) => /^mux-driver-[a-z][a-z0-9-]*\.mjs$/.test(n)).sort();
check(`the table holds exactly ${backends.length} drivers (${onDisk.join(", ")})`, onDisk.length === 4, `${onDisk.join(", ")}`);
const loaded = await muxSurfaceDrivers();
check("and the core's own discovery agrees with the filesystem", loaded.census.files === onDisk.length, `${loaded.census.files}`);
check("keyed by each driver's OWN backend field, not by the filename order", loaded.names.slice().sort().join(",") === onDisk.map((n) => basename(n).replace(/^mux-driver-|\.mjs$/g, "")).join(","), `keys ${loaded.names.slice().sort().join(",")} files ${onDisk.join(",")}`);
check("and every key's driver lives in the file named after it (a swap is a file, not an edit)", loaded.names.every((n) => basename(loaded.drivers.get(n).path) === `mux-driver-${n}.mjs`), loaded.names.map((n) => `${n} -> ${basename(loaded.drivers.get(n).path)}`).join(" "));
check("and the core holds a Map, so registration order cannot be confused with a lookup", loaded.drivers instanceof Map && loaded.drivers.size === 4, `Map size ${loaded.drivers.size}`);

console.log("\n=== 2. THE DEFAULT BACKEND IS A DRIVER FACT (rank), NOT A NAME IN THE CORE ===");
const ranks = Object.fromEntries(loaded.names.map((n) => [n, loaded.drivers.get(n).driver?.rank]));
check("each driver declares its own rank (the shipping order lives with the driver)", backends.every((b) => Number.isFinite(ranks[b])), `${JSON.stringify(ranks)}`);
check("ranked = tmux,screen,zellij,herdr by 100/90/80/70", loaded.ranked.join(",") === "tmux,screen,zellij,herdr", `${loaded.ranked.join(",")}`);
check("names/styles are FILENAME order (herdr,screen,tmux,zellij) — alphabetical order is NOT the default", loaded.names.slice().sort().join(",") === "herdr,screen,tmux,zellij" && loaded.styles.slice().sort().join(",") === "herdr,screen,tmux,zellij", `names ${loaded.names.join(",")} styles ${loaded.styles.join(",")}`);
check("nothing asked => the rank winner is active (tmux, rank 100)", loaded.requested === null && loaded.active === "tmux", `active ${loaded.active} requested ${loaded.requested}`);
// The proof that the default is a REGISTRATION fact: a temp registry with a 5th driver whose rank wins.
const reg1 = join(tmp, "reg1");
mkdirSync(reg1);
for (const f of onDisk) writeFileSync(join(reg1, f), readFileSync(join(TOOLS, f), "utf8"));
writeFileSync(join(reg1, "mux-driver-zzrank.mjs"), "export const MUX_DRIVER = { backend: \"zzrank\", rank: 150, preset: { style: \"zzrank\", keys: {} } };\n");
const reg1loaded = await muxSurfaceDrivers({ dir: reg1 });
check("an ADDED driver is registered with no core edit (5 files => 5 backends)", reg1loaded.census.files === 5 && reg1loaded.names.length === 5, `${reg1loaded.census.files}/${reg1loaded.names.length}`);
check("and the ACTIVE backend moved to it because its rank won (not because of filename order — zzrank sorts after the four real drivers only by luck of the winner)", reg1loaded.active === "zzrank" && reg1loaded.ranked[0] === "zzrank", `active ${reg1loaded.active} ranked ${reg1loaded.ranked.join(",")}`);
check("and the four real drivers' order is unchanged inside it", reg1loaded.ranked.join(",").endsWith("tmux,screen,zellij,herdr"), reg1loaded.ranked.join(","));
check("and a core that LISTED the default would have said tmux here; it does not (no backend word in the core at all)", !backends.some((b) => new RegExp(b, "i").test(coreSource)), "core has zero backend words");

console.log("\n=== 3. THE BACKEND KNOB: an unregistered ask does not become the backend ===");
const knb = await muxSurfaceDrivers({ env: { [MUX_BACKEND_ENV]: "screen" } });
check(`${MUX_BACKEND_ENV}=screen moves the ACTIVE backend (and with it the preset style)`, knb.requested === "screen" && knb.active === "screen" && knb.drivers.size === 4, `requested ${knb.requested} active ${knb.active} drivers ${knb.drivers.size}`);
check("the preset style follows the same backend (one knob, not two knobs to disagree)", knb.drivers.get(knb.active).driver?.preset?.style === knb.active, `style ${knb.drivers.get(knb.active).driver?.preset?.style}`);
const bad = await muxSurfaceDrivers({ env: { [MUX_BACKEND_ENV]: "nosuch" } });
check("an UNREGISTERED ask is kept as `requested` and does NOT become the backend", bad.requested === "nosuch" && bad.active === "tmux" && !bad.names.includes("nosuch"), `requested ${bad.requested} active ${bad.active}`);
check("and the plan refuses an unregistered backend BY NAME, printing the registered set", (() => {
  const r = muxPlan("list", {}, { drivers: loaded.drivers, backend: "nosuch" });
  return r.ok === false && r.code === "backend-not-registered" && backends.every((b) => r.refusal.includes(b));
})(), "backend-not-registered names the 4 registered");

console.log("\n=== 4. THE PRESENCE CENSUS ON THIS HOST: registered vs NOT-RUN ===");
const probed = await muxProbeBackends(loaded.drivers, { timeoutMs: 2000 });
const byBackend = Object.fromEntries(probed.map((p) => [p.backend, p]));
const here = Object.fromEntries(loaded.names.map((n) => [n, byBackend[n]]));
check("every registered backend gets an answer (a census that lists fewer than registered is a silent absence)", probed.length === loaded.names.length, `probed ${probed.length} registered ${loaded.names.length}`);
check("screen is PRESENT and answers with its OWN version line (not an invented one)", here.screen.present === true && String(here.screen.versionLine).includes("Screen version 5.0.2"), `versionLine ${JSON.stringify(here.screen.versionLine)}`);
check("tmux/zellij/herdr are registered and NOT-RUN: present:false, ms 0, NO version line invented", backends.filter((b) => b !== "screen").every((b) => here[b].present === false && here[b].ms === 0 && here[b].versionLine === null && here[b].reason === "binary NOT on PATH => NOT-RUN"), backends.filter((b) => b !== "screen").map((b) => `${b} ${JSON.stringify(here[b].reason)} ms ${here[b].ms}`).join(" "));
check("the NOT-RUN answer came WITHOUT spawning (ms 0 is the proof the probe short-circuited)", backends.filter((b) => b !== "screen").every((b) => here[b].ms === 0), backends.filter((b) => b !== "screen").map((b) => `${b} ms ${here[b].ms}`).join(" "));
check("the probe carries the driver's rank through, so presence and shipping order stay separate facts", probed.every((p) => p.rank === ranks[p.backend]), probed.map((p) => `${p.backend} ${p.rank}`).join(" "));
check("screen's version line is the FIRST line of its stdout only (the parse is not the plane inventing text)", String(here.screen.versionLine).split("\n").length === 1, JSON.stringify(here.screen.versionLine));

console.log("\n=== 5. A HANGING BINARY IS A MEASUREMENT, NOT A PIN THAT HANGS ===");
const binSlow = join(tmp, "bin-slow");
mkdirSync(binSlow);
writeFileSync(join(binSlow, "tmux"), "#!/bin/sh\nsleep 30\n");
chmodSync(join(binSlow, "tmux"), 0o755);
process.env.PATH = `${binSlow}:${PATH0}`;
const slowProbed = await muxProbeBackends(loaded.drivers, { timeoutMs: 250 });
const slowTmux = slowProbed.find((p) => p.backend === "tmux");
check("a tmux that sleeps 30 s answers with the BOUND, not with a hang (measured ms ~250)", slowTmux.present === false && String(slowTmux.reason).includes("bound") && slowTmux.ms >= 250 && slowTmux.ms < 30_000, `ms ${slowTmux.ms} reason ${JSON.stringify(slowTmux.reason)}`);
check("and the bound answer is DIFFERENT from the absent answer (a hung binary is not reported as absent)", slowTmux.reason !== "binary NOT on PATH => NOT-RUN" && slowTmux.reason !== "ran", JSON.stringify(slowTmux.reason));
check("and the bound carries its number (boundMs + timedOut are the measurement a reader acts on)", slowTmux.timedOut === true && slowTmux.boundMs === 250, `boundMs ${slowTmux.boundMs} timedOut ${slowTmux.timedOut} reason ${JSON.stringify(slowTmux.reason)}`);
check("and the other backends were still censused after the slow one (one slow binary does not eat the census)", slowProbed.length === 4, `${slowProbed.length}`);
process.env.PATH = PATH0;

console.log("\n=== 6. THE HERMETIC TMUX SHIM: the driver's EXACT argv bytes reach a real process ===");
const bin = join(tmp, "bin");
mkdirSync(bin);
writeFileSync(join(bin, "tmux"), "#!/bin/sh\nprintf 'HERMETIC-SHIM (not tmux)\\n'\nfor a in \"$@\"; do printf 'ARGV %s\\n' \"$a\"; done\nexit 0\n");
chmodSync(join(bin, "tmux"), 0o755);
process.env.PATH = `${bin}:${PATH0}`;
const shimmed = await muxProbeBackends(loaded.drivers, { timeoutMs: 2000 });
const shimTmux = shimmed.find((p) => p.backend === "tmux");
check("with a SHIM on PATH, tmux reads PRESENT and the version line is the SHIM's (so a real binary never ran)", shimTmux.present === true && String(shimTmux.versionLine) === "HERMETIC-SHIM (not tmux)", `versionLine ${JSON.stringify(shimTmux.versionLine)} ms ${shimTmux.ms}`);
check("and the shim's presence came from the seam's PATH scan (the driver named the probe argv, the plane ran it)", shimTmux.reason === "ran", JSON.stringify(shimTmux.reason));
const w1 = join(tmp, "w1");
mkdirSync(w1);
const store = join(w1, "selfdev.sqlite");
const listPlan = muxPlan("list", {}, { tag: "durian-w1", namespace: "plugin", panes: [], drivers: loaded.drivers, backend: "tmux", store });
const openPlan = muxPlan("open", {}, { tag: "durian-w1", namespace: "plugin", panes: [{ seat: "impl", paneName: "impl", conversationId: "c-impl" }], drivers: loaded.drivers, backend: "tmux", store });
check("the LIST ask names ONE census command and the OPEN ask names one pane command (no ask runs two)", listPlan.ok && listPlan.commands.length === 1 && openPlan.ok && openPlan.commands.length === 1, `list ${listPlan.commands.length} open ${openPlan.commands.length}`);
check("the OPEN command CREATES THE SESSION DETACHED and carries the pane's rig-attach (tmux's own detach semantics)", openPlan.commands[0].argv.slice(0, 4).join(" ") === "tmux new-session -d -s" && openPlan.commands[0].argv.includes("tui.mjs") && openPlan.commands[0].argv.includes("--attach"), openPlan.commands[0].argv.join(" "));
check("and the pane command is the RIG's attach surface (node tui.mjs --db <store> --attach --select <seat>), never a keystroke", openPlan.commands[0].argv.slice(-7).join(" ") === `node tui.mjs --db ${store} --attach --select impl`, openPlan.commands[0].argv.join(" "));
const run = await muxRunPlan(openPlan, { run: true, timeoutMs: 2000 });
check("the ONE door ran it and reported rc 0 (run:true is the ask; the core cannot reach this door)", run.ran === true && run.ok === true && run.steps.length === 1 && run.steps[0].rc === 0, `ran ${run.ran} ok ${run.ok} steps ${run.steps.length}`);
const step = run.steps[0];
check("the process received the driver's EXACT argv bytes (step argv === plan argv, element for element)", JSON.stringify(step.argv) === JSON.stringify(openPlan.commands[0].argv), `${step.argv.length} args vs ${openPlan.commands[0].argv.length}`);
check("and the shim echoes them back UNMODIFIED and QUOTED-INTACT (argv[0] is the EXECUTABLE resolved through PATH, so the 16 remaining tokens must each be one line)", step.stdout.split("\n").slice(1).join("\u0001") === openPlan.commands[0].argv.slice(1).map((a) => `ARGV ${a}`).join("\u0001"), `${step.stdout.split("\n").slice(1).length} echoed vs ${openPlan.commands[0].argv.length - 1} argument tokens (argv[0] resolved by the seam)`);
const listRun = await muxRunPlan(listPlan, { run: true, timeoutMs: 2000 });
check("the sessions-census argv ran too and its FORMAT string survived as ONE arg (a broken quote would split it)", listRun.ok === true && listRun.steps[0].stdout.includes("ARGV #{session_name} #{session_windows} #{?session_attached,attached,detached}"), `${listRun.ok} ms ${listRun.steps[0].ms} ${JSON.stringify(listRun.steps[0].stdout).slice(0, 200)}`);
check("and the run happened in the workspace dir the driver chose (cwd is the driver's, not the pin's)", openPlan.commands[0].cwd === w1 && step.stdout.includes("ARGV"), `cwd ${openPlan.commands[0].cwd} w1 ${w1}`);
check("HONEST SCOPE: the shim echoed argv; it implemented NO multiplexer semantics, so this proves ARGV BYTES AND DISPATCH ONLY", step.stdout.startsWith("HERMETIC-SHIM"), "the shim, not a backend, ran");
process.env.PATH = PATH0;
check("PATH restored after the shim (no other pin can see it)", process.env.PATH === PATH0, `PATH0 ${PATH0} now ${process.env.PATH}`);

console.log("\n=== 7. A `;`-SEPARATED PATH RESOLVES (a native-Windows host's PATH form, D131) ===");
process.env.PATH = "/usr/bin;/usr/bin;/definitely-not-a-directory";
const semi = await muxProbeBackends(loaded.drivers, { timeoutMs: 2000 });
const semiScreen = semi.find((p) => p.backend === "screen");
const semiTmux = semi.find((p) => p.backend === "tmux");
check("the seam's own scanner reads a `;`-separated PATH as PATH (screen no longer reads NOT-on-PATH)", String(semiScreen.reason) !== "binary NOT on PATH => NOT-RUN", `reason ${JSON.stringify(semiScreen.reason)}`);
check("and an ABSENT binary still reads absent under the same `;` PATH (the fix did not make missing look present)", semiTmux.reason === "binary NOT on PATH => NOT-RUN" && semiTmux.ms === 0, `tmux ${JSON.stringify(semiTmux.reason)} ms ${semiTmux.ms}`);
process.env.PATH = PATH0;
const after = await muxProbeBackends(loaded.drivers, { timeoutMs: 2000 });
check("and with PATH restored the census reads exactly as in section 4 (the mutation left nothing behind)", after.length === 4 && after.filter((p) => p.present).map((p) => p.backend).join(",") === "screen", after.map((p) => `${p.backend} present ${p.present}`).join(" "));

console.log("\n=== 8. A BROKEN DRIVER IS REPORTED, not silently absent ===");
const reg2 = join(tmp, "reg2");
mkdirSync(reg2);
for (const f of onDisk) writeFileSync(join(reg2, f), readFileSync(join(TOOLS, f), "utf8"));
writeFileSync(join(reg2, "mux-driver-bad.mjs"), "export const NOT_THE_DRIVER = { backend: \"broken\" };\n");
const reg2loaded = await muxSurfaceDrivers({ dir: reg2 });
check("a file that matches the pattern but exports no MUX_DRIVER lands in loadErrors BY PATH", reg2loaded.loadErrors.length === 1 && String(reg2loaded.loadErrors[0].path).includes("mux-driver-bad.mjs"), JSON.stringify(reg2loaded.loadErrors));
check("and its backend is NOT registered (a half-loaded driver cannot act), while the 4 real ones still are", !reg2loaded.names.includes("broken") && reg2loaded.names.length === 4 && reg2loaded.active === "tmux", `names ${reg2loaded.names.join(",")} active ${reg2loaded.active}`);
const reg3 = join(tmp, "reg3");
mkdirSync(reg3);
writeFileSync(join(reg3, "mux-driver-bad.mjs"), "throw new Error(\"driver that will not load\");\n");
const reg3loaded = await muxSurfaceDrivers({ dir: reg3 });
check("a driver that THROWS on load is named in loadErrors with the error text (not swallowed by the catch's absence)", reg3loaded.loadErrors.length === 1 && String(reg3loaded.loadErrors[0].error).includes("driver that will not load"), JSON.stringify(reg3loaded.loadErrors));
check("and an EMPTY registry makes the active backend null — the core invents no backend", reg3loaded.names.length === 0 && reg3loaded.active === null && reg3loaded.ranked.length === 0, `active ${JSON.stringify(reg3loaded.active)}`);
check("and a null active backend still answers the census honestly (no driver => backend-not-registered, not a success)", (() => {
  const r = muxPlan("list", {}, { drivers: reg3loaded.drivers, backend: null });
  return r.ok === false && r.code === "backend-not-registered" && r.refusal.includes("(none registered)".slice(0, 6));
})(), "no driver => refusal");

console.log("\n=== 9. THE CAPABILITY TABLE IS PER DRIVER, and NO driver can type into a pane ===");
const verbs = [...MUX_VERB_NAMES, "act"];
const table = {};
for (const b of backends) table[b] = verbs.filter((v) => muxCapability(b, v, { drivers: loaded.drivers }).ok);
check("three of four drivers declare detach; HERDR does not (the refusal is a fact of that driver, not of the core)", backends.filter((b) => table[b].includes("detach")).sort().join(",") === "screen,tmux,zellij" && !table.herdr.includes("detach"), Object.entries(table).map(([k, v]) => `${k}:${v.length}`).join(" "));
check("every driver declares act (the plugin CAN act in every backend's namespace — via the spool, not via a key)", backends.every((b) => table[b].includes("act")), Object.entries(table).map(([k, v]) => `${k} ${v.includes("act")}`).join(" "));
check("herdr's declared set is 7 and the refusal prints exactly it", (() => {
  const caps = loaded.drivers.get("herdr").driver.capabilities;
  const r = muxCapability("herdr", "detach", { drivers: loaded.drivers });
  const list = caps instanceof Set ? [...caps] : [...(caps ?? [])];
  return list.length === 7 && !list.includes("detach") && list.every((c) => r.refusal.includes(c)) && r.code === "capability-not-declared";
})(), `herdr declared ${Object.entries(loaded.drivers.get("herdr").driver.capabilities).length}`);
const emitted = [];
for (const b of backends) {
  for (const v of verbs) {
    const p = muxPlan(v, {}, { tag: "durian-w1", namespace: "plugin", panes: [{ seat: "impl", paneName: "impl", conversationId: "c-impl" }], drivers: loaded.drivers, backend: b, store });
    for (const c of p.commands) emitted.push(...c.argv);
  }
}
const INPUT_PRIMITIVES = ["send-keys", "send-text", "write-chars", "paste", "loadkeys", "sendKeys"];
check("NO argv this registry can emit is a terminal INPUT PRIMITIVE (no second writer into a seat)", emitted.length > 0 && !emitted.some((a) => INPUT_PRIMITIVES.includes(a)), `${emitted.filter((a) => INPUT_PRIMITIVES.includes(a)).join(",") || "none"} of ${emitted.length} tokens`);
check("and NO driver names an act COMMAND (an act is the broker's spool op, so a backend-free verb needs no argv)", backends.every((b) => !Object.keys(loaded.drivers.get(b).driver?.commands ?? {}).includes("act")), backends.map((b) => `${b} ${Object.keys(loaded.drivers.get(b).driver?.commands ?? {}).join("|")}`).join(" "));
check("and the act ask plans ok with ZERO backend commands for all four backends (it is not a refusal, it is a different plane)", backends.every((b) => {
  const p = muxPlan("act", {}, { tag: "durian-w1", namespace: "plugin", panes: [{ seat: "impl", paneName: "impl" }], drivers: loaded.drivers, backend: b, store });
  return p.ok === true && p.commands.length === 0;
}), backends.map((b) => {
  const p = muxPlan("act", {}, { tag: "durian-w1", namespace: "plugin", panes: [{ seat: "impl", paneName: "impl" }], drivers: loaded.drivers, backend: b, store });
  return `${b} ok ${p.ok} cmds ${p.commands.length}`;
}).join(" "));
check("every driver names a docs file that EXISTS (a path:line citation to a missing doc reads as verified, so it is checked)", backends.every((b) => existsSync(join(ROOT, loaded.drivers.get(b).driver?.docs ?? "/nonexistent"))), backends.map((b) => `${b} ${loaded.drivers.get(b).driver?.docs} ${existsSync(join(ROOT, loaded.drivers.get(b).driver?.docs ?? "/nonexistent"))}`).join(" "));

console.log("\n=== 10. A DRIVER THAT CANNOT NAME AN ASK REFUSES RATHER THAN RENAME ===");
const gap = muxPlan("open", {}, { session: "4242.user-watching", tag: "user-watching", namespace: "user", panes: [{ seat: "impl", paneName: "impl" }], drivers: loaded.drivers, backend: "tmux", store });
check("tmux CANNOT address a user-namespace session named with a `.` => NO argv and a NAMED GAP", gap.ok === false && gap.code === "backend-cannot-name-ask" && gap.commands.length === 0 && gap.gaps.length === 1, `${gap.code} cmds ${gap.commands.length} gaps ${gap.gaps.length}`);
check("the gap text names the session the user asked for, so the reader knows WHAT was refused", String(gap.refusal).includes("4242.user-watching"), String(gap.refusal).slice(0, 200));
check("and it refuses to RENAME it (a rewrite would aim at a different session), saying so", String(gap.refusal).includes("does not rename a session to get close"), String(gap.refusal).slice(0, 240));
check("and the same ask in the PLUGIN namespace plans fine (the gap is about the name the USER gave, not about tmux)", (() => {
  const ok = muxPlan("open", {}, { tag: "durian-w1", namespace: "plugin", panes: [{ seat: "impl", paneName: "impl" }], drivers: loaded.drivers, backend: "tmux", store });
  return ok.ok === true && ok.commands.length === 1;
})(), "plugin-namespace open plans 1 command");

rmSync(tmp, { recursive: true, force: true });
check("the rig's live store did not move by a byte", statSync(liveStore).mtimeMs === liveMtime, `mtime ${liveMtime} -> ${statSync(liveStore).mtimeMs}`);
check("and its size is unchanged", statSync(liveStore).size === liveSize, `size ${liveSize} -> ${statSync(liveStore).size}`);

const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  process.stdout.write(`\nMUX-DRIVERS PASS (${secs}s total) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — the driver registry is DISCOVERED (4 mux-driver-*.mjs files, keyed by each driver's OWN backend field, the core's source naming ZERO backend words) and the default backend is a DRIVER FACT: ranks 100/90/80/70 rank tmux,screen,zellij,herdr while filename order would have said herdr, and an added temp driver with rank 150 BECOMES the active backend with no core edit. ${MUX_BACKEND_ENV} moves the active backend and its preset style together; an unregistered ask stays recorded as requested and does not become the backend. The presence census on THIS host answers screen PRESENT with its own version line and tmux/zellij/herdr registered-but-NOT-RUN at ms 0 WITHOUT spawning and with NO invented version line; a shim that sleeps 30 s answers with the 250 ms BOUND instead of hanging the pin, and the census still names all 4 backends. The HERMETIC TMUX SHIM received the tmux driver's EXACT argv bytes — new-session -d -s plus the pane's node tui.mjs --db <store> --attach --select impl, all 16 argument tokens echoed back one-per-line with argv[0] resolved through PATH, the -F census format string surviving as ONE argument, run in the driver's own cwd, rc 0 — which proves ARGV BYTES AND DISPATCH ONLY, NOT tmux pane semantics (tmux is absent on this host). A semicolon-separated PATH resolves in the seam's own scanner (the native-Windows form, D131) while an absent binary still reads absent under it. A broken driver is reported in loadErrors BY PATH and its backend stays unregistered; an empty registry makes the active backend null rather than inventing one. The capability table is PER DRIVER (herdr declares 7 and omits detach, refused capability-not-declared), NO driver names an act command, NO emitted argv is a terminal input primitive, and an act ask plans ok with ZERO backend commands for all four backends. tmux refuses to rename a user-namespace session whose name contains a dot — a NAMED GAP with no argv, not a session the user did not ask for.\n`);
  process.exit(0);
}
process.stdout.write(`${failures} FAILURE(S)\n`);
process.exit(1);
