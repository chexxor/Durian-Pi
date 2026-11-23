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
//      THIS PROVES ARGV BYTES AND DISPATCH ONLY, NOT TMUX'S PANE SEMANTICS (tmux is NOT on the distro PATH
//      here; a tmux 3.5a SELF-BUILT FROM SOURCE is reachable through a PATH shim and its pane semantics are
//      MEASURED in docs/runbooks/pi-inside-tmux.md — this shim leg still proves argv bytes and dispatch only).
//   7. A `;`-SEPARATED PATH still RESOLVES in the seam's own scanner (a native-Windows host's PATH form), and an
//      absent binary still reads absent under that same PATH (the fix did not make missing look present).
//   8. A BROKEN DRIVER IS REPORTED, not silently absent — loadErrors names the file and the backend stays
//      unregistered; an empty registry makes the active backend null, it does not invent one.
//   9. THE CAPABILITY TABLE IS PER DRIVER — three of four declare detach, herdr does not, and the refusal names
//      both. NO driver names an `act` command and NO emitted argv anywhere is a terminal input primitive.
//  10. A DRIVER THAT CANNOT NAME AN ASK SAYS SO — tmux session names may not contain `.` or `:`, so a user-namespace
//      session named `4242.user-watching` gets a note and NO argv, and the whole ask becomes a refusal BY NAME
//      rather than a silent rename that would aim at a different session.
//  11. THE PLATFORM TABLE — D131 says LINUX AND WINDOWS ARE BOTH OPERATING PLATFORMS, so a backend that is not on
//      THIS box is not automatically unavailable: it is available on the other one. Each driver declares a `platform`
//      table (a linux row and a windows row) and the CORE decides from it — refuse the ask, or probe the OS's own
//      binary — never from a name in the core (the core's backend-word census is re-measured HERE, after the verdict
//      code went in, so a later edit that bolts a backend name in is CAUGHT). The Windows half is HERMETIC: `os` is a
//      fact HANDED IN (`muxPlan` reads `state.os`, `muxProbeBackends` takes `os:`), so a Windows verdict is a RUN on
//      the box that cannot boot Windows, and every such row reads `advertised-elsewhere` + quote + URL + fetch date,
//      never `observed`.
//
// HERMETIC: the only processes this pin starts are (a) this host's GNU Screen probe, and (b) a shim script in a
// temp dir. A WINDOWS census starts NOTHING at all (a refused row is not probed, an absent route short-circuits at ms
// 0), so the Windows half of this pin is a hermetic run on Linux. No real multiplexer session is created and the rig's
// live store is never read.
// Run: node demo/mux-drivers.test.mjs (exit 0 = pass)
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";

import {
  muxCapability,
  muxPlatformVerdict,
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
check("the OPEN command CREATES THE SESSION DETACHED and carries the pane's OWN client (tmux's own detach semantics)", openPlan.commands[0].argv.slice(0, 4).join(" ") === "tmux new-session -d -s" && openPlan.commands[0].argv.some((a) => a.includes("mux-pane-client.mjs")) && openPlan.commands[0].argv.includes("--pane"), openPlan.commands[0].argv.join(" "));
check("and the pane command is the core's ONE pane argv (<execPath> <abs mux-pane-client.mjs> --db <store> --select <seat> --pane <name>), never a keystroke and never the rig's full TUI", openPlan.commands[0].argv.slice(-8).join(" ") === `${process.execPath} ${join(TOOLS, "mux-pane-client.mjs")} --db ${store} --select impl --pane impl`, openPlan.commands[0].argv.join(" "));
const run = await muxRunPlan(openPlan, { run: true, timeoutMs: 2000 });
check("the ONE door ran it and reported rc 0 (run:true is the ask; the core cannot reach this door)", run.ran === true && run.ok === true && run.steps.length === 1 && run.steps[0].rc === 0, `ran ${run.ran} ok ${run.ok} steps ${run.steps.length}`);
const step = run.steps[0];
check("the process received the driver's EXACT argv bytes (step argv === plan argv, element for element)", JSON.stringify(step.argv) === JSON.stringify(openPlan.commands[0].argv), `${step.argv.length} args vs ${openPlan.commands[0].argv.length}`);
check("and the shim echoes them back UNMODIFIED and QUOTED-INTACT (argv[0] is the EXECUTABLE resolved through PATH, so the 17 remaining tokens must each be one line)", step.stdout.split("\n").slice(1).join("\u0001") === openPlan.commands[0].argv.slice(1).map((a) => `ARGV ${a}`).join("\u0001"), `${step.stdout.split("\n").slice(1).length} echoed vs ${openPlan.commands[0].argv.length - 1} argument tokens (argv[0] resolved by the seam)`);
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

console.log("\n=== 11. THE PLATFORM TABLE: a WINDOWS ask gets a REGISTERED verdict, not a guess (D131) ===");
const coreNow = readFileSync(join(TOOLS, "mux-surface-core.mjs"), "utf8");
check("the core is STILL backend-word-free AFTER the platform verdict went in (the decision is a driver fact, not a name in the core)", backends.every((b) => !new RegExp(b, "i").test(coreNow)), backends.filter((b) => new RegExp(b, "i").test(coreNow)).join(",") || "none in core");
check("the Windows verdict is REGISTERED IN CODE, not prose: a verdict function, a `platform-refused` code, and a named zero-argv verb set", coreNow.includes("export function muxPlatformVerdict") && coreNow.includes('"platform-refused"') && coreNow.includes("NO_ARGV_VERBS"), "one of the three is gone from the core");
const osRows = Object.fromEntries(backends.map((b) => [b, loaded.drivers.get(b).driver?.platform ?? {}]));
check("all four drivers declare a platform table with BOTH a linux row and a windows row (the facts live WITH the driver)", backends.every((b) => osRows[b].linux && osRows[b].windows), backends.map((b) => b + " " + Object.keys(osRows[b]).join("/")).join(" "));
const vOf = Object.fromEntries(backends.map((b) => [b, { windows: muxPlatformVerdict(b, "windows", { drivers: loaded.drivers }), linux: muxPlatformVerdict(b, "linux", { drivers: loaded.drivers }) }]));
const w = (b) => vOf[b].windows;
const l = (b) => vOf[b].linux;
check("tmux on WINDOWS: allowed, and the binary this OS probes is `psmux` — NOT the driver's own `tmux` (probing tmux on a Windows host is the false gap this seam refuses)", w("tmux").ok === true && w("tmux").argvAllowed === true && w("tmux").binary === "psmux", "ok " + w("tmux").ok + " argvAllowed " + w("tmux").argvAllowed + " binary " + w("tmux").binary);
check("and its status is `advertised-elsewhere` (this rig's host is Linux, so NOTHING on this box observed a Windows binary)", w("tmux").status === "advertised-elsewhere" && /advertised-elsewhere, not observed/.test(w("tmux").note), "status " + w("tmux").status);
check("and the verdict carries the FETCHED quote, its URL and its fetch date, plus what it does NOT do (no WSL/Cygwin/MSYS2 borrowed)", /native Windows terminal multiplexer/.test(w("tmux").note) && /psmux\/psmux\/master\/README\.md/.test(w("tmux").note) && /fetched 2026-11-22/.test(w("tmux").note) && /without WSL, Cygwin, or MSYS2/i.test(w("tmux").note), "tmux windows note " + w("tmux").note.slice(0, 120));
check("and the WINDOWS PANE-IDENTITY deviation is registered, not discovered at runtime: `pane_current_command` is an IMAGE name, not a service identity; identity is window/pane NAME by stable id + `pane_start_command` + `pane_dead`/`pane_pid`, and `pane_title` needs `allow-set-title` (OFF by default)", (() => { const s = w("tmux").row?.identity ?? ""; return /pane_current_command/.test(s) && /not a service identity/.test(s) && /pane_start_command/.test(s) && /pane_dead/.test(s) && /pane_pid/.test(s) && /allow-set-title/.test(s) && /IMAGE name/.test(s); })(), (w("tmux").row?.identity ?? "NO identity field").slice(0, 200));
check("and the WINDOWS NAMESPACE fact is registered too: `-L` isolates, a bare kill-server ends only the DEFAULT namespace, and psmux's all-namespaces sweep is REFUSED BY NAME and never emitted", (() => { const s = w("tmux").row?.namespace ?? ""; return /-L/.test(s) && /ends only the DEFAULT namespace/.test(s) && /kill-server -a/.test(s) && /REFUSED BY NAME/.test(s); })(), (w("tmux").row?.namespace ?? "NO namespace field").slice(0, 200));
check("zellij on WINDOWS: allowed, the binary NAME stays `zellij` (the `.exe` is an extension a Windows PATH resolves), and the route names the official build with its URL and fetch date", w("zellij").ok === true && w("zellij").binary === "zellij" && w("zellij").status === "advertised-elsewhere" && /zellij\.exe/.test(w("zellij").note) && /installation\.html fetched 2026-11-22/.test(w("zellij").note), "zellij windows " + w("zellij").binary + " " + w("zellij").status);
check("herdr on WINDOWS: allowed, but its OWN note names the FOUR things that do NOT work there, so the plugin must not plan them", w("herdr").ok === true && w("herdr").binary === "herdr" && /terminal attach/.test(w("herdr").note) && /foreground process groups/.test(w("herdr").note) && /windows-beta/.test(w("herdr").note) && /fetched 2026-11-22/.test(w("herdr").note), "herdr windows " + w("herdr").binary);
check("GNU screen on WINDOWS: REFUSED BY THE DRIVER — ok:false, argvAllowed:false, binary:null, code `platform-refused` (no binary is invented for a backend that has no native Windows build in any fetched copy)", w("screen").ok === false && w("screen").argvAllowed === false && w("screen").binary === null && w("screen").code === "platform-refused", "ok " + w("screen").ok + " argvAllowed " + w("screen").argvAllowed + " binary " + w("screen").binary + " code " + w("screen").code);
check("and the refusal says WHY with its ground (only Cygwin routes were found; those are FORBIDDEN under D131 native host OS only) and names its fetch date", /never wsl, cygwin, msys2/.test(w("screen").refusal) && /native host OS only/i.test(w("screen").refusal) && /fetched 2026-11-22/.test(w("screen").refusal) && /UNVERIFIED-AND-REFUSED/.test(w("screen").refusal), w("screen").refusal.slice(0, 260));
check("and it substitutes NO route the driver did not declare, and names D131 so the reader knows why nothing ran", /substitutes NO route/.test(w("screen").refusal) && w("screen").refusal.includes("D131"), w("screen").refusal.slice(-200));
check("the four LINUX verdicts are this box's own facts: tmux/screen `measured`, zellij/herdr `absent`, all argvAllowed", ["tmux", "screen"].every((b) => l(b).ok && l(b).status === "measured") && ["zellij", "herdr"].every((b) => l(b).ok && l(b).status === "absent") && backends.every((b) => l(b).argvAllowed), backends.map((b) => b + " " + l(b).code).join(" "));
check("an UNDECLARED platform is neither refused nor invented: darwin answers `platform-row-not-declared` with argvAllowed and NO binary, and the note prints the rows the driver DID declare", (() => { const d = muxPlatformVerdict("tmux", "darwin", { drivers: loaded.drivers }); return d.ok === true && d.code === "platform-row-not-declared" && d.argvAllowed === true && d.binary === null && /declared: linux, windows/.test(d.note); })(), muxPlatformVerdict("tmux", "darwin", { drivers: loaded.drivers }).code);
const winAim = (verb) => muxPlan(verb, { os: "windows" }, { tag: "durian-w1", namespace: "plugin", panes: [{ seat: "impl", paneName: "impl", conversationId: "c-impl" }], drivers: loaded.drivers, backend: "screen", store });
const argvVerbs = ["list", "open", "attach", "detach", "kill", "capture", "halt"];
check("a WINDOWS screen ask emits ZERO commands for every verb that needs a multiplexer command (list/open/attach/detach/kill/capture/halt) — the refusal is not a half-plan", argvVerbs.every((v) => { const p = winAim(v); return p.ok === false && p.code === "platform-refused" && p.commands.length === 0; }), argvVerbs.map((v) => v + " " + winAim(v).code + " cmds " + winAim(v).commands.length).join(" "));
check("and the refusal names the PLATFORM and the BACKEND, so a reader knows WHICH ask was refused and WHERE", (() => { const p = winAim("open"); return String(p.refusal).includes("windows") && String(p.refusal).includes("screen") && p.platform?.os === "windows" && p.platform?.verdict?.code === "platform-refused"; })(), winAim("open").refusal.slice(0, 160));
check("but the BACKEND-FREE verbs still answer ok on a refused platform (an act is the broker's spool op, NOT a multiplexer command): act/send/keys ok with ZERO commands", ["act", "send", "keys"].every((v) => { const p = winAim(v); return p.ok === true && p.commands.length === 0; }), ["act", "send", "keys"].map((v) => v + " ok " + winAim(v).ok + " cmds " + winAim(v).commands.length).join(" "));
const winEmitted = [];
for (const b of backends) for (const v of [...MUX_VERB_NAMES]) { const p = muxPlan(v, { os: "windows" }, { tag: "durian-w1", namespace: "plugin", panes: [{ seat: "impl", paneName: "impl", conversationId: "c-impl" }], drivers: loaded.drivers, backend: b, store }); for (const c of p.commands) winEmitted.push(...c.argv); }
check("across WINDOWS aims at ALL FOUR backends and every verb, NO emitted token is a server-wide kill (that would end the USER's own namespaces, namespace A)", !winEmitted.some((a) => /kill-server|kill-all-sessions/.test(a)), winEmitted.filter((a) => /kill-server|kill-all-sessions/.test(a)).join(",") || "none of " + winEmitted.length + " tokens");
check("and NO emitted token on a WINDOWS aim is a terminal INPUT PRIMITIVE either (the no-second-writer rule holds on the other platform too)", !winEmitted.some((a) => INPUT_PRIMITIVES.includes(a) || /send-keys|send-text|write-chars|sendKeys|paste|loadkeys/.test(a)), winEmitted.filter((a) => INPUT_PRIMITIVES.includes(a) || /send-keys|send-text|write-chars|sendKeys|paste|loadkeys/.test(a)).join(",") || "none of " + winEmitted.length + " tokens");
const winProbe = await muxProbeBackends(loaded.drivers, { timeoutMs: 2000, os: "windows" });
const wp = Object.fromEntries(winProbe.map((p) => [p.backend, p]));
check("a WINDOWS census answers for ALL FOUR registered backends and says which OS it answered for (the census never shrinks to the ones that are here)", winProbe.length === 4 && winProbe.every((p) => p.os === "windows"), winProbe.map((p) => p.backend + " os " + p.os).join(" "));
check("the OWNER plane probes the OS's OWN route, not the driver's: a WINDOWS tmux census looks for `psmux`", wp.tmux.platformBinary === "psmux" && wp.tmux.present === false && wp.tmux.os === "windows", "platformBinary " + wp.tmux.platformBinary + " present " + wp.tmux.present);
check("and it prints the NOT-RUN answer BYTE-EXACT plus the route BESIDE it, naming the name it looked for", String(wp.tmux.reason).startsWith("binary NOT on PATH => NOT-RUN") && String(wp.tmux.reason).includes("psmux") && wp.tmux.ms === 0 && wp.tmux.versionLine === null, JSON.stringify(wp.tmux.reason).slice(0, 140));
check("a REFUSED row is NOT probed: WINDOWS screen answers `platform-refused` at ms 0 with NO version line and NO binary looked for", wp.screen.platformBinary === null && wp.screen.ms === 0 && wp.screen.versionLine === null && String(wp.screen.reason).startsWith("platform-refused") && wp.screen.platformStatus === "refused", "ms " + wp.screen.ms + " binary " + wp.screen.platformBinary + " status " + wp.screen.platformStatus);
check("every WINDOWS-probe record says `advertised-elsewhere` or `refused`, never `observed`/`measured` (this box cannot observe a Windows binary)", winProbe.every((p) => p.platformStatus === "advertised-elsewhere" || p.platformStatus === "refused"), winProbe.map((p) => p.backend + " " + p.platformStatus).join(" "));
const linProbe = await muxProbeBackends(loaded.drivers, { timeoutMs: 2000, os: "linux" });
check("an INJECTED linux aim answers exactly as this box's own census does: every record's platformBinary is the driver's own probe[0] and its os is linux", linProbe.length === 4 && linProbe.every((p) => { const d = loaded.drivers.get(p.backend).driver; return p.platformBinary === d.probe[0] && p.os === "linux" && p.platformStatus === osRows[p.backend].linux?.status; }), linProbe.map((p) => p.backend + " " + p.platformBinary + " " + p.platformStatus + " os " + p.os).join(" "));
check("and the linux census still answers screen PRESENT with its OWN version line under an injected os (the os param did not move an existing answer)", (() => { const s = linProbe.find((p) => p.backend === "screen"); return s.present === true && String(s.versionLine).includes("Screen version 5.0.2") && s.reason === "ran"; })(), JSON.stringify(linProbe.find((p) => p.backend === "screen").versionLine));

rmSync(tmp, { recursive: true, force: true });
check("the rig's live store did not move by a byte", statSync(liveStore).mtimeMs === liveMtime, `mtime ${liveMtime} -> ${statSync(liveStore).mtimeMs}`);
check("and its size is unchanged", statSync(liveStore).size === liveSize, `size ${liveSize} -> ${statSync(liveStore).size}`);

const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  process.stdout.write(`\nMUX-DRIVERS PASS (${secs}s total) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — the driver registry is DISCOVERED (4 mux-driver-*.mjs files, keyed by each driver's OWN backend field, the core's source naming ZERO backend words) and the default backend is a DRIVER FACT: ranks 100/90/80/70 rank tmux,screen,zellij,herdr while filename order would have said herdr, and an added temp driver with rank 150 BECOMES the active backend with no core edit. ${MUX_BACKEND_ENV} moves the active backend and its preset style together; an unregistered ask stays recorded as requested and does not become the backend. The presence census on THIS host answers screen PRESENT with its own version line and tmux/zellij/herdr registered-but-NOT-RUN at ms 0 WITHOUT spawning and with NO invented version line; a shim that sleeps 30 s answers with the 250 ms BOUND instead of hanging the pin, and the census still names all 4 backends. The HERMETIC TMUX SHIM received the tmux driver's EXACT argv bytes — new-session -d -s plus the pane's own attached client (<execPath> <abs tools/mux-pane-client.mjs> --db <store> --select impl --pane impl, the core's muxPaneArgv, NOT the rig's full TUI), all 17 argument tokens echoed back one-per-line with argv[0] resolved through PATH, the -F census format string surviving as ONE argument, run in the driver's own cwd, rc 0 — which proves ARGV BYTES AND DISPATCH ONLY, NOT tmux pane semantics (tmux is NOT on the distro PATH on this host; a tmux 3.5a SELF-BUILT FROM SOURCE is, via the PATH shim, and its pane semantics are measured in docs/runbooks/pi-inside-tmux.md — this shim leg still proves argv bytes and dispatch only). A semicolon-separated PATH resolves in the seam's own scanner (the native-Windows form, D131) while an absent binary still reads absent under it. A broken driver is reported in loadErrors BY PATH and its backend stays unregistered; an empty registry makes the active backend null rather than inventing one. The capability table is PER DRIVER (herdr declares 7 and omits detach, refused capability-not-declared), NO driver names an act command, NO emitted argv is a terminal input primitive, and an act ask plans ok with ZERO backend commands for all four backends. tmux refuses to rename a user-namespace session whose name contains a dot — a NAMED GAP with no argv, not a session the user did not ask for. THE PLATFORM TABLE (D131: Linux AND Windows are both operating platforms) is a DRIVER fact read by a backend-word-free core: all four drivers declare a linux row AND a windows row, and the core's backend-word census is re-measured HERE, AFTER the verdict code went in, still ZERO. On WINDOWS the tmux vocabulary is psmux (advertised-elsewhere, quoted, URL, fetched 2026-11-22, NEVER RUN here since this rig's host is Linux) and the owner plane looks for psmux, NOT the driver's own tmux, printing the route BESIDE the byte-exact NOT-RUN answer; zellij keeps the binary NAME zellij with an official .exe route; herdr is allowed but its OWN note names the four things that do NOT work there (herdr terminal attach, live server handoff, Unix fd handoff, Unix foreground process groups) and admits the page is windows-beta; GNU screen is REFUSED BY NAME with binary:null and argvAllowed:false and ZERO commands for list/open/attach/detach/kill/capture/halt, and it substitutes NO route the driver did not declare (wsl, cygwin and msys2 are forbidden under D131 native host OS only) — while act/send/keys still answer ok with ZERO commands because they are the broker's spool, not a multiplexer command. Across WINDOWS aims at all four backends and all ten verbs, NO emitted token is a server-wide kill and NONE is a terminal input primitive. The psmux deviations a reader must know before believing a Windows pane census are registered in the driver, not discovered at runtime: pane_current_command is an IMAGE name and NOT a service identity, identity is the window/pane NAME addressed by stable id plus pane_start_command plus pane_dead and pane_pid, pane_title needs allow-set-title (OFF by default), -L isolates namespaces so a bare kill-server ends only the DEFAULT one and psmux's all-namespaces sweep is refused, and a backslash is never doubled. An UNDECLARED platform (darwin) is neither refused nor invented: platform-row-not-declared with argvAllowed and NO binary, its note printing the rows the driver DID declare.\n`);
  process.exit(0);
}
process.stdout.write(`${failures} FAILURE(S)\n`);
process.exit(1);
