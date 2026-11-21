// demo/mux-namespace.test.mjs — the TWO NAMESPACES: the panes the USER made explicitly, and the panes made
// INDIRECTLY because the user is using Durian-Pi (goal mwpeepwa-spmy34, contracts (9) ISOLATION and (10) OVERRIDE;
// goal tasks `namespace-isolation` + `namespace-override` + `namespace-real`).
//
// WHAT EACH SECTION CLOSES (nothing below this line is prose):
//   1. THE NAME IS DERIVED IN THE CORE, NOT IN A DRIVER — the plugin's namespace is a name THIS file derives from
//      the store/workspace, so a backend swap cannot move the rig's panes into the user's own session by accident,
//      and two workspaces get two different names.
//   2. THE DEFAULT CENSUS — the plugin's OWN session is named, every OTHER row the multiplexer reports is
//      PRESENT, NOT TOUCHED (not enumerated, not captured, not killed), and the census-learned label reaches the
//      driver (plan.sessionTag; the window leg's argv carries the full label, never the bare name).
//   3. EVERY WAY TO LEAK IS REFUSED BY NAME, AND NONE OF THEM PRINTS A PARTIAL CENSUS — --every-session, an
//      --into that names a foreign session while the namespace is still plugin (flag form AND the persistent-knob
//      form), --namespace user with no session named, a namespace outside the closed vocabulary, and a flag that
//      contradicts a persistent knob. Asserted at BOTH levels: the core's own decision and the whole invoke.
//   4. A TEARDOWN IN THE PLUGIN NAMESPACE MUST NAME THE PLUGIN'S OWN SESSION — proven with a SYNTHETIC driver
//      whose sessionName returns a name that does not carry the tag (no real driver can do that, which is why
//      the refusal is pinned against a registry that can).
//   5. THE OVERRIDE IS LOUD — --into names the user's session, the census prints namespace user plus NAMESPACE
//      OVERRIDE and says the plugin's own session was NOT used; the two persistent knobs do the same without a
//      flag and are attributed to the knob that answered.
//   6. THE REAL BACKEND LEG (GNU Screen 5.0.2 IS on this host) — the user's session is created FIRST by a raw
//      argv, the plugin's session is created THROUGH THE SEAM, both are censused together, the user's row is
//      BYTE-IDENTICAL after the plugin acted (proof it was not touched), the plugin's window really is named
//      after the seat, and each session this pin created is killed by its OWN census pid. The pane command runs
//      a SHIM tui.mjs written into the temp workspace, so this proves session creation + census + teardown on the
//      real backend, NOT the rig's attach surface.
//
// HERMETIC: sections 1-5 start no process (the present rows are handed in; the only spawn in them is the presence
// probe, which reads a version line). Section 6 runs this host's GNU Screen and a 30 s-bounded shim in a temp
// dir. The rig's live store is never opened: its mtime and size must not move by a byte.
// Run: node demo/mux-namespace.test.mjs (exit 0 = pass)
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  MUX_NAMESPACE_ENV,
  MUX_NAMESPACE_SESSION_ENV,
  MUX_NAMESPACE_DEFAULT,
  MUX_NAMESPACE_NAMES,
  MUX_NAMESPACE_TAG_PREFIX,
  muxNamespace,
  muxWorkspaceTag,
  muxPlan,
  muxSurfaceDrivers,
  muxSurfaceInvoke,
} from "../tools/mux-surface-core.mjs";
import { muxRunArgv, muxRunPlan, muxListSessions, muxProbeBackends } from "../tools/mux-surface-owner.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const TOOLS = join(ROOT, "tools");
const liveStore = join(ROOT, "selfdev.sqlite");
const liveMtime = statSync(liveStore).mtimeMs;
const liveSize = statSync(liveStore).size;
const tmp = mkdtempSync(join(tmpdir(), "durig-mux-ns-"));

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) return;
  failures += 1;
  process.stdout.write(`FAIL ${label}: ${detail}\n`);
};

// THE HERMETIC WORLD: one workspace, one store that is NEVER created, two sessions already present in the
// multiplexer — the plugin's own, and the user's, which holds a dozen other harnesses.
const w1 = join(tmp, "w1");
mkdirSync(w1);
const store = join(w1, "selfdev.sqlite");
const present = [
  { name: "99097.durian-w1", tag: "durian-w1", panes: 1 },
  { name: "4242.user-watching", tag: "user-watching", panes: 12 },
];
const seats = [{ name: "impl", conversationId: "conv-impl" }, { name: "qa", conversationId: "conv-qa" }];

const t0 = Date.now();
const loaded = await muxSurfaceDrivers();

console.log("\n=== 1. THE NAME IS DERIVED IN THE CORE, NOT IN A DRIVER ===");
const tag = muxWorkspaceTag(store);
check("the plugin's namespace is a NAME THE CORE derives from the store/workspace", tag === `${MUX_NAMESPACE_TAG_PREFIX}w1`, `muxWorkspaceTag -> ${tag}`);
check("a DIFFERENT workspace gets a DIFFERENT name (two rigs cannot collide in one session)", muxWorkspaceTag(join(tmp, "w2", "selfdev.sqlite")) === `${MUX_NAMESPACE_TAG_PREFIX}w2`, `${muxWorkspaceTag(join(tmp, "w2", "selfdev.sqlite"))}`);
check("and the derivation names NO backend (the core is backend-word-free, so a swap cannot move the panes)", ["tmux", "screen", "zellij", "herdr"].every((b) => !readFileSync(join(TOOLS, "mux-surface-core.mjs"), "utf8").includes(b)), "core source has zero backend words");
check("the tag prefix is a core constant, not a driver's string", MUX_NAMESPACE_TAG_PREFIX === "durian-", MUX_NAMESPACE_TAG_PREFIX);

console.log("\n=== 2. THE DEFAULT CENSUS: own session NAMED, foreign row PRESENT NOT TOUCHED ===");
const ns = muxNamespace({ store, cwd: w1, state: { verb: "list" }, env: {}, backend: "screen", drivers: loaded.drivers, present });
check("the DEFAULT namespace is the plugin's own (the two namespaces exist whether or not anything was asked)", ns.ok && ns.namespace === MUX_NAMESPACE_DEFAULT && ns.via === "default (plugin)", `ns ${ns.namespace} via ${ns.via}`);
check("the resolved session is the DERIVED name, spelled by the ACTIVE driver", ns.sessionName === tag && ns.own === tag && ns.tag === tag, `session ${ns.sessionName} own ${ns.own} tag ${ns.tag}`);
check("the row that IS this session is matched on the row's own name half (not on a backend's separator)", ns.censusTarget === "99097.durian-w1", `censusTarget ${JSON.stringify(ns.censusTarget)}`);
check("the OTHER row is reported PRESENT, NOT TOUCHED, with its pane count and touched:false", ns.foreign.length === 1 && ns.foreign[0].name === "4242.user-watching" && ns.foreign[0].panes === 12 && ns.foreign[0].touched === false, JSON.stringify(ns.foreign));
check("and the default note says the user's own sessions are NOT touched (the census prints the namespace it acted in)", /namespace: plugin/.test(ns.note) && /NOT touched/.test(ns.note), ns.note);
const withLabel = muxPlan("list", {}, { session: tag, sessionTag: ns.censusTarget, tag, namespace: ns.namespace, panes: seats.map((s) => ({ seat: s.name, paneName: s.name })), drivers: loaded.drivers, backend: "screen", store });
check("the CENSUS-LEARNED label reaches the driver: the window leg addresses the FULL label, never the bare name", withLabel.ok && withLabel.commands.length === 2 && withLabel.commands[1].argv.join(" ").includes("99097.durian-w1"), withLabel.commands.map((c) => c.argv.join(" ")).join(" || "));
const bare = muxPlan("list", {}, { session: tag, sessionTag: null, tag, namespace: ns.namespace, panes: seats.map((s) => ({ seat: s.name, paneName: s.name })), drivers: loaded.drivers, backend: "screen", store });
check("with NO census label that leg emits NO argv and the plan keeps the GAP (a bare aim can act on the WRONG session)", bare.ok && bare.commands.length === 1 && bare.gaps.length === 1 && bare.gaps[0].action === "list" && bare.gaps[0].pane === "qa", `${bare.commands.length} cmd ${bare.gaps.length} gap ${bare.gaps.map((g) => g.pane).join(",")}`);
check("and the gap says so in words a reader acts on", String(bare.gaps[0]?.note).includes("does not match") && String(bare.gaps[0]?.note).includes("WRONG session"), String(bare.gaps[0]?.note).slice(0, 200));
const emittedNs = [...withLabel.commands, ...bare.commands].flatMap((c) => c.argv);
check("NO argv the plugin namespace emits ever NAMES the foreign session (it is REPORTED, never addressed)", emittedNs.length > 0 && !emittedNs.some((a) => String(a).includes("user-watching")), `${emittedNs.filter((a) => String(a).includes("user-watching")).join(" | ") || "none"} of ${emittedNs.length} tokens`);

console.log("\n=== 3. EVERY LEAK IS REFUSED BY NAME, WITH NO PARTIAL CENSUS (core decision AND whole invoke) ===");
const seams = {
  drivers: async () => loaded, // handed as an ASYNC GETTER here (pin 1 hands an OBJECT) — both shapes must work
  readSeats: async () => seats,
  readRows: async () => [],
  sessions: async () => present,
  cwd: w1,
};
const ask = (text, env = {}) => muxSurfaceInvoke(text, { env, cwd: w1, seams, store });
const leaks = [
  { text: "halt --every-session", state: { verb: "halt", everySession: true }, env: {}, code: "teardown-every-session", why: "a teardown of EVERY session", musts: ["--every-session", "Nothing was killed.", tag] },
  // A bare `--into` DOES move the namespace to user (contract (10) is the opt-in), so this ask is NOT the
  // `namespace-foreign-asked` class — it is the TEARDOWN class: a session-level teardown that does not name a
  // session carrying the plugin's tag is refused even under the override, because ending a session the USER
  // started is exactly the loss the namespace model exists to prevent (the override PLACES panes, it does not
  // grant the right to END a session). Asserted here so a reader sees the two codes and why they differ.
  { text: "halt --into 4242.user-watching", state: { verb: "halt", into: "4242.user-watching" }, env: {}, code: "teardown-foreign", why: "a teardown aimed at a session the plugin does not own, even under the bare --into override", musts: ["4242.user-watching", "Refused BY NAME", "--namespace user"] },
  { text: "list --into 4242.user-watching --namespace plugin", state: { verb: "list", into: "4242.user-watching", namespace: "plugin" }, env: {}, code: "namespace-foreign-asked", why: "the flag form of an ask for a foreign session", musts: ["4242.user-watching", "Refused BY NAME", "To opt in loudly: pass --namespace user"] },
  { text: "list --all", state: { verb: "list", all: true }, env: { [MUX_NAMESPACE_SESSION_ENV]: "4242.user-watching", [MUX_NAMESPACE_ENV]: "plugin" }, code: "namespace-foreign-asked", why: "the PERSISTENT KNOB form of the same ask", musts: [MUX_NAMESPACE_SESSION_ENV, "4242.user-watching", "--namespace user"] },
  { text: "list --all --namespace user", state: { verb: "list", all: true, namespace: "user" }, env: {}, code: "user-namespace-unspecified", why: "the user namespace asked but no session named", musts: ["--into <session>", MUX_NAMESPACE_SESSION_ENV] },
  { text: "list --all --namespace user", state: { verb: "list", all: true, namespace: "user" }, env: { [MUX_NAMESPACE_ENV]: "zzz" }, code: "namespace-not-declared", why: "the knob outside the closed vocabulary", musts: [MUX_NAMESPACE_ENV, "zzz", MUX_NAMESPACE_NAMES.join(", ")] },
  { text: "list --all --namespace user", state: { verb: "list", all: true, namespace: "user" }, env: { [MUX_NAMESPACE_ENV]: "plugin" }, code: "namespace-conflict", why: "a flag that contradicts a persistent knob", musts: ["--namespace user", MUX_NAMESPACE_ENV, "Say one thing"] },
];
for (const leak of leaks) {
  const { text, state, env, code, musts } = leak;
  const core = muxNamespace({ store, cwd: w1, state, env, backend: "screen", drivers: loaded.drivers, present });
  const r = await ask(text, env);
  const body = r.show.map((l) => l.body).join("");
  check(`\`${text}\` ${leak.why} is refused BY NAME by the CORE (code ${code})`, core.ok === false && core.code === code, `${core.code} ${String(core.refusal).slice(0, 160)}`);
  check(`and the whole invoke refuses it too (ok false, exit 1, one error line, NO success line)`, r.ok === false && r.exitCode === 1 && r.show.length === 1 && r.show[0].level === "error", `${r.ok}/${r.exitCode}/${JSON.stringify(r.show).slice(0, 200)}`);
  check(`and the invoke carries the SAME code the core gave (one decision, not two)`, r.namespace?.code === code, `code ${r.namespace?.code} wanted ${code}`);
  check(`and the refusal PRINTS THE NAMESPACE it refused in`, body.includes("namespace"), body.slice(0, 300));
  check(`and it names the ask that WOULD be legal or the legal set`, musts.every((m) => body.includes(m)), `${musts.filter((m) => !body.includes(m)).join(" | ")} missing`);
  check(`and NO partial census was emitted (no session line, no pane line, no argv)`, (r.panes ?? []).length === 0 && !body.includes("mux census —") && r.plan == null, `panes ${(r.panes ?? []).length} plan ${r.plan == null} body ${body.slice(0, 160)}`);
  check(`and NOTHING was read, paneled, captured or killed by that refusal`, /Nothing was|nothing was/.test(body), body.slice(0, 220));
}
check("a refusal that needs NO selector still reaches the teardown class (halt is session-level: no 'needs a selector' door hides it)", (() => {
  const sel = { verb: "halt", into: "4242.user-watching" };
  const nsx = muxNamespace({ store, cwd: w1, state: sel, env: {}, backend: "screen", drivers: loaded.drivers, present });
  return nsx.ok === false && nsx.code === "teardown-foreign" && !String(nsx.refusal).includes("needs a selector");
})(), "halt --into refuses with the TEARDOWN class, not a selector ask");

console.log("\n=== 4. A PLUGIN-NAMESPACE TEARDOWN MUST NAME THE PLUGIN'S OWN SESSION (synthetic driver) ===");
const reg4 = join(tmp, "reg4");
mkdirSync(reg4);
writeFileSync(join(reg4, "mux-driver-shared.mjs"), "export const MUX_DRIVER = { backend: \"shared\", rank: 999, sessionName: () => \"shared-session\", capabilities: new Set([\"halt\", \"kill\"]) };\n");
const shared = await muxSurfaceDrivers({ dir: reg4 });
check("the synthetic driver is registered like any other (a registry entry, not a special case)", shared.names.join(",") === "shared" && shared.active === "shared", `names ${shared.names.join(",")} active ${shared.active}`);
const tf = muxNamespace({ store, cwd: w1, state: { verb: "halt" }, env: {}, backend: "shared", drivers: shared.drivers, present: [] });
check("a plugin-namespace halt whose resolved session does NOT carry the tag is refused BY NAME", tf.ok === false && tf.code === "teardown-foreign", `${tf.code} ${tf.refusal.slice(0, 200)}`);
check("and the refusal names BOTH the tag it demanded and the session it found", String(tf.refusal).includes(`\`${tag}\``) && String(tf.refusal).includes("shared-session"), tf.refusal.slice(0, 300));
check("and it refuses rather than leaving a session running unnamed (Nothing was killed)", String(tf.refusal).includes("nothing was killed"), tf.refusal.slice(0, 300));
check("and the real drivers CANNOT reach that refusal (each sessionName returns the tag), which is why the pin hands a registry that can", ["tmux", "screen", "zellij", "herdr"].every((b) => {
  const d = loaded.drivers.get(b).driver;
  const own = d?.sessionName ? d.sessionName({ cwd: w1, store, tag, namespace: MUX_NAMESPACE_DEFAULT }) : tag;
  return String(own).includes(tag);
}), ["tmux", "screen", "zellij", "herdr"].map((b) => `${b} ${loaded.drivers.get(b).driver?.sessionName ? loaded.drivers.get(b).driver.sessionName({ cwd: w1, store, tag, namespace: MUX_NAMESPACE_DEFAULT }) : tag}`).join(" "));

console.log("\n=== 5. THE OVERRIDE IS LOUD: an explicit ask, and two persistent knobs ===");
const over = muxNamespace({ store, cwd: w1, state: { verb: "open", into: "user-watching" }, env: {}, backend: "screen", drivers: loaded.drivers, present });
check("--into <session> ALONE is the opt-in and moves the namespace to user", over.ok && over.namespace === "user" && over.via === "--into", `ns ${over.namespace} via ${over.via}`);
check("it NAMES the session the plugin is now driving", over.sessionName === "user-watching", `session ${over.sessionName}`);
check("and it says LOUDLY that this is an override and the plugin's own session was NOT used", /NAMESPACE OVERRIDE/.test(over.note) && over.note.includes(`\`${tag}\` was NOT used`), over.note);
check("the census text repeats the override on the line a user reads", /namespace: user/.test(over.note) && over.note.includes("Panes will sit in the session the user is watching"), over.note);
const knob = muxNamespace({ store, cwd: w1, state: { verb: "open" }, env: { [MUX_NAMESPACE_SESSION_ENV]: "user-watching", [MUX_NAMESPACE_ENV]: "user" }, backend: "screen", drivers: loaded.drivers, present });
check("the TWO PERSISTENT KNOBS do the same with NO flag", knob.ok && knob.namespace === "user" && knob.sessionName === "user-watching", `ns ${knob.namespace} session ${knob.sessionName}`);
check("and the answer ATTRIBUTES itself to the knob that answered (a census that cannot say where an override came from is the class this seam refuses)", knob.via === MUX_NAMESPACE_ENV, `via ${knob.via}`);
check("the persistent session knob alone is also honoured and attributed", (() => {
  const only = muxNamespace({ store, cwd: w1, state: { verb: "open" }, env: { [MUX_NAMESPACE_SESSION_ENV]: "user-watching" }, backend: "screen", drivers: loaded.drivers, present });
  return only.ok && only.namespace === "user" && only.sessionName === "user-watching" && only.via === MUX_NAMESPACE_SESSION_ENV;
})(), "DURIAN_PI_MUX_SESSION alone");
// `list`, NOT `open`: an `open` in a store no broker owns is refused on the OWNERSHIP leg (the seam will not
// start a second writer), which is a different door and hides the census. The census line itself is the ask.
const overInvoke = await ask("list --into user-watching --all --backend screen");
const overBody = overInvoke.show.map((l) => l.body).join("");
check("and the whole invoke prints the override on the census line itself", overInvoke.ok && overBody.includes("mux census — namespace user — session user-watching") && overBody.includes("NAMESPACE OVERRIDE"), `${overInvoke.ok} ${overBody.slice(0, 300)}`);
check("and in the override the census LABEL of the user's session reaches the driver (a bare name cannot address the socket)", overInvoke.plan.commands.some((c) => c.argv.includes("4242.user-watching")) && overBody.includes("census label 4242.user-watching"), overBody.slice(0, 500));
check("the PLUGIN's own session becomes the not-used one and is still reported PRESENT, NOT TOUCHED", overInvoke.namespace.foreign.some((f) => f.name === "99097.durian-w1" && f.touched === false) && overBody.includes("foreign session 99097.durian-w1"), overBody.slice(0, 500));
check("and the user's session is NOT reported foreign once it is the target (one session, one owner)", !overInvoke.namespace.foreign.some((f) => f.name === "4242.user-watching"), JSON.stringify(overInvoke.namespace.foreign));

console.log("\n=== 6. THE REAL BACKEND LEG (GNU Screen 5.0.2 measured on this host) ===");
const probed = await muxProbeBackends(loaded.drivers, { timeoutMs: 2000 });
const screenHere = probed.find((p) => p.backend === "screen" && p.present);
let realRan = false;
if (screenHere) {
  realRan = true;
  const real = mkdtempSync(join(tmpdir(), "durig-mux-ns-real-"));
  const rw = join(real, "w1");
  mkdirSync(rw);
  const rstore = join(rw, "selfdev.sqlite");
  // THE SHIM: the pane command the driver spells is node tui.mjs --db <store> --attach --select <seat>, run in
  // the workspace dir. Without a file there, node exits at once and a detached session whose window exits ENDS
  // (screen's own semantics). So this leg proves session creation + census + teardown on the REAL backend, NOT
  // the rig's attach surface. The shim is BOUNDED: it exits at 30 s, so the pin cannot leave an orphan.
  writeFileSync(join(rw, "tui.mjs"), "// SHIM standing in for the rig's TUI (this pin proves session creation + census + teardown, not the attach surface)\nsetTimeout(() => process.exit(0), 30_000);\n");
  const screenDriver = loaded.drivers.get("screen").driver;
  const pre = await muxListSessions(screenDriver, { cwd: rw, session: tag, tag, namespace: MUX_NAMESPACE_DEFAULT, timeoutMs: 5000 });
  const baseline = new Set(pre.sessions.map((r) => r.name));
  check(`the baseline census is honest about this host (whatever a previous pin left, it is not this pin's)`, pre.ran, `${pre.sessions.length} row(s) notes ${pre.notes.join(" | ")}`);
  const userMade = muxRunArgv(["screen", "-c", "/dev/null", "-dmS", "user-watching", "-t", "harness", "sleep", "300"], { cwd: rw, timeoutMs: 5000 });
  check("namespace A first: the USER's own session is created by a RAW argv, before the plugin asks for anything", userMade.ran && userMade.rc === 0, `ran ${userMade.ran} rc ${userMade.rc} ms ${userMade.ms}`);
  const c1 = await muxListSessions(screenDriver, { cwd: rw, session: tag, tag, namespace: MUX_NAMESPACE_DEFAULT, timeoutMs: 5000 });
  const userRow = c1.sessions.find((r) => r.tag === "user-watching");
  check("the census sees the user's session as a row of its OWN (two sockets, two namespaces)", !!userRow && c1.sessions.length === baseline.size + 1, `rows ${c1.sessions.map((r) => r.name).join(",")} baseline ${baseline.size}`);
  const nsReal = muxNamespace({ store: rstore, cwd: rw, state: { verb: "list" }, env: {}, backend: "screen", drivers: loaded.drivers, present: c1.sessions });
  check("and the DEFAULT namespace does NOT aim at it: censusTarget null, the user's row foreign", nsReal.ok && nsReal.namespace === MUX_NAMESPACE_DEFAULT && nsReal.censusTarget === null && nsReal.foreign.some((f) => f.name === userRow?.name && f.touched === false), `censusTarget ${JSON.stringify(nsReal.censusTarget)} foreign ${JSON.stringify(nsReal.foreign)}`);
  check("the bare aim refused the window leg against a REAL binary (no argv for a name screen cannot match)", c1.notes.some((n) => /NO CENSUS LABEL/.test(n)), c1.notes.join(" | ").slice(0, 300));
  const openPlan = muxPlan("open", {}, { session: nsReal.sessionName, sessionTag: nsReal.censusTarget, tag: nsReal.tag, namespace: nsReal.namespace, panes: [{ seat: "impl", paneName: "impl", conversationId: "conv-impl" }], drivers: loaded.drivers, backend: "screen", store: rstore });
  check("namespace B is created THROUGH THE SEAM: one command, detached, the window named after the SEAT, the pane an ATTACHED client of the store", openPlan.ok && openPlan.commands.length === 1 && openPlan.commands[0].argv.slice(0, 5).join(" ") === `screen -c /dev/null -dmS ${tag}` && openPlan.commands[0].argv.slice(7).join(" ") === `node tui.mjs --db ${rstore} --attach --select impl` && openPlan.commands[0].cwd === rw, openPlan.commands.map((c) => c.argv.join(" ")).join(" || "));
  const ranOpen = await muxRunPlan(openPlan, { run: true, timeoutMs: 8000 });
  check("the ONE door ran it (run:true is the ask) and the session came to exist", ranOpen.ran && ranOpen.ok && ranOpen.steps.length === 1 && ranOpen.steps[0].rc === 0, `ran ${ranOpen.ran} ok ${ranOpen.ok} rc ${ranOpen.steps[0]?.rc} ms ${ranOpen.steps[0]?.ms}`);
  check("the pane plane created NO store (a viewport is not a second writer)", existsSync(rstore) === false, `existsSync(${rstore})`);
  const c2 = await muxListSessions(screenDriver, { cwd: rw, session: tag, tag, namespace: MUX_NAMESPACE_DEFAULT, timeoutMs: 5000 });
  const pluginRow = c2.sessions.find((r) => r.tag === tag);
  const userRow2 = c2.sessions.find((r) => r.tag === "user-watching");
  check("TWO rows now: the plugin's own session BESIDE the user's, never inside it", !!pluginRow && !!userRow2 && c2.sessions.length === baseline.size + 2, `rows ${c2.sessions.map((r) => `${r.name}(${r.state})`).join(",")}`);
  check("and the user's row is BYTE-IDENTICAL after the plugin acted (the proof its session was not touched)", JSON.stringify(userRow2) === JSON.stringify(userRow), `${JSON.stringify(userRow)} vs ${JSON.stringify(userRow2)}`);
  const nsReal2 = muxNamespace({ store: rstore, cwd: rw, state: { verb: "list" }, env: {}, backend: "screen", drivers: loaded.drivers, present: c2.sessions });
  check("the census LEARNS the plugin's label and the plan carries it (a bare name cannot address the socket)", nsReal2.ok && nsReal2.censusTarget === pluginRow?.name && nsReal2.foreign.length === c2.sessions.length - 1, `label ${JSON.stringify(nsReal2.censusTarget)} foreign ${nsReal2.foreign.length}`);
  const c3 = await muxListSessions(screenDriver, { cwd: rw, session: pluginRow?.name, tag, namespace: MUX_NAMESPACE_DEFAULT, timeoutMs: 5000 });
  check("aimed AT that label the window leg runs and the plugin's window really is named after the SEAT", c3.panes.some((p) => p.title === "impl"), `panes ${c3.panes.map((p) => `${p.id}(${p.title})`).join(" ")} notes ${c3.notes.join(" | ")}`);
  const mine = [userRow, pluginRow].filter(Boolean);
  const killed = mine.map((r) => {
    try {
      process.kill(Number(r.pid), "SIGTERM");
      return `${r.name} pid ${r.pid} signalled`;
    } catch (err) {
      return `${r.name} pid ${r.pid} -> ${err?.code}`;
    }
  });
  check("each session THIS PIN created is torn down by its OWN census pid (never pkill -f, never -wipe)", mine.length === 2 && killed.every((s) => !/ENOPRO|kill ERETRY|ENOENT/.test(s)), killed.join(" "));
  const c4 = await muxListSessions(screenDriver, { cwd: rw, session: tag, tag, namespace: MUX_NAMESPACE_DEFAULT, timeoutMs: 5000 });
  check("and after teardown NO session this pin created remains (a session the USER started elsewhere is still only reported)", c4.sessions.length === baseline.size && c4.sessions.every((r) => baseline.has(r.name)), `left ${c4.sessions.map((r) => r.name).join(",")} baseline ${[...baseline].join(",")} notes ${c4.notes.join(" | ")}`);
  check("the census says honestly when the sockets are gone (rc 1, No Sockets found)", baseline.size > 0 || c4.notes.some((n) => /census rc 1/.test(n)), c4.notes.join(" | "));
  rmSync(real, { recursive: true, force: true });
  check("and the real temp workspace is removed", !existsSync(real), `existsSync ${existsSync(real)}`);
} else {
  process.stdout.write("REAL-BACKEND LEG SKIPPED (screen NOT on PATH) — the real two-namespace demo is OWED, not claimed\n");
}

rmSync(tmp, { recursive: true, force: true });
check("the rig's live store did not move by a byte", statSync(liveStore).mtimeMs === liveMtime, `mtime ${liveMtime} -> ${statSync(liveStore).mtimeMs}`);
check("and its size is unchanged", statSync(liveStore).size === liveSize, `size ${liveSize} -> ${statSync(liveStore).size}`);

const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  process.stdout.write(`\nMUX-NAMESPACE PASS (${secs}s total${realRan ? ", real GNU Screen leg included" : ", REAL-BACKEND LEG SKIPPED"}; ${MUX_NAMESPACE_TAG_PREFIX}tag derivation in core 4 checks) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — the plugin's namespace is a NAME THE CORE DERIVES from the store (durian-w1 here, durian-w2 for another workspace, the core naming zero backend words), so the DEFAULT census names the plugin's OWN session and reports the user's other session as PRESENT, NOT TOUCHED with its pane count and touched:false, while the census-learned label (99097.durian-w1) is what reaches the driver's window leg — a bare aim emits NO argv and keeps the gap because screen cannot match a bare name. ${leaks.length} leak classes are refused BY NAME at BOTH the core's own decision and the whole invoke: --every-session, an --into that names a foreign session while the namespace is still plugin (the flag form AND the DURIAN_PI_MUX_SESSION form), --namespace user with no session named, the knob outside the closed vocabulary, and a flag contradicting a knob — each with the namespace printed, the legal ask named, and NO partial census (panes 0, no census line). A plugin-namespace halt aimed at a session that does not carry the tag is refused teardown-foreign against a SYNTHETIC driver (no real driver can reach it: each sessionName returns the tag). The override is LOUD: --into names the user's session and the census prints namespace user plus NAMESPACE OVERRIDE and says the plugin's own session was NOT used, and the two persistent knobs do the same with no flag, attributed to the knob that answered.${realRan ? " On THIS host the real leg created the user's own screen session FIRST by a raw argv, created the plugin's session THROUGH the seam (detached, window named after the seat, the pane command an attached client of a store the plane never created), censused BOTH rows, showed the user's row BYTE-IDENTICAL after the plugin acted, ran the window leg only against the census label and found the window named impl, then killed each session by its OWN census pid and re-censused to no rows" : ""}; the rig's live store did not move by a byte (${liveSize} bytes, mtime ${liveMtime})\n`);
  process.exit(0);
}
process.stdout.write(`${failures} FAILURE(S)\n`);
process.exit(1);
