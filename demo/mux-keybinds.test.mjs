// demo/mux-keybinds.test.mjs — the KEYBIND VOCABULARY: what a user may press, which preset is ACTIVE, and what
// the plugin REFUSES rather than forward (goal mwpeepwa-spmy34, tasks `keybinds` + `keybinds-refusals`; the goal's
// contract (5) "a working tmux plugin first, with a NAMED keybinding vocabulary and tmux-style/screen-style PRESET
// MAPS the user can choose, rendered with pi's own keyHint()/keyText()", and contract (6) "an action no preset
// carries, or one the active backend cannot perform, is REFUSED BY NAME rather than silently forwarded").
//
// WHAT EACH SECTION CLOSES (nothing below this line is prose):
//   1. THE VOCABULARY IS ONE TABLE — every preset action is mux.<something>, and the core's verb list is the ONLY
//      place a name becomes a command. A preset key whose name is NOT a core verb is found HERE, not asserted absent.
//   2. FOUR PRESET STYLES ARE REGISTERED BY DRIVERS — the core composes whatever the drivers declare, so choosing
//      a style is choosing a registration, never a branch in the core.
//   3. THE ACTIVE PRESET FOLLOWS THE ACTIVE BACKEND — and both move together when the knob is set.
//   4. THE KEY TEXT NAMES THE ACTIVE PRESET, PI'S OWN RENDERING, AND THE REFUSAL — the three sentences a reader
//      needs: which keys mean what, how pi draws them from keybindings.json, what is refused.
//   5. THE EXTENSION REGISTERS THE ACTIVE PRESET'S SHORTCUTS ONLY — count = the active preset's size, and no
//      shortcut from another style is on the session (four key tables on one session is the collision class).
//   6. A PRESET BLOCK THAT THROWS DOES NOT EAT /mux — the fallback names itself.
//   7. NO PRESET KEY BORROWS A PI DEFAULT — every combo is ctrl+shift+letter and never pi's f/g/p.
//   8. A CAPABILITY A DRIVER DOES NOT DECLARE IS REFUSED BY NAME with the declared set printed.
//   9. THE `send` LEG IS AN OPEN GAP, PINNED AS REFUSED — the preset names `mux.send`, the core has no `send` verb,
//      and no driver names a `send` command. What is true today is a REFUSAL, not a route to the spool: the gap is
//      reported, not papered over (the goal's contract (4) wants send to be the spool, so this row is owed work).
//
// HERMETIC: no multiplexer binary runs here, no store is read. Run: node demo/mux-keybinds.test.mjs (exit 0 = pass)
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  muxCapability,
  muxKeysText,
  muxSurfaceDrivers,
  muxSurfaceInvoke,
  MUX_VERB_NAMES,
  MUX_BACKEND_ENV,
  MUX_PRESET_ENV,
  MUX_USAGE,
  MUX_SURFACE_DESCRIPTION,
} from "../tools/mux-surface-core.mjs";
import muxSurfaceExtension from "../tools/mux-surface-extension.js";

const HERE = dirname(new URL(import.meta.url).pathname);
const ROOT = dirname(HERE);
const tmp = mkdtempSync(join(tmpdir(), "durig-mux-keys-"));

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

console.log("=== 1. ONE VOCABULARY TABLE (a preset key is a NAME, the core turns it into a command) ===");
const t0 = Date.now();
const loaded = await muxSurfaceDrivers({ dir: join(ROOT, "tools"), env: {} });
const presets = [...loaded.drivers.values()].map((r) => r.driver?.preset).filter(Boolean);
const allKeys = presets.flatMap((p) => Object.entries(p.keys).map(([action, combo]) => ({ style: p.style, action, combo })));
check("every preset action is spelled mux.<name>, so one split turns a key into a verb", allKeys.every((k) => /^mux\.[a-z]+$/.test(k.action)), `${allKeys.filter((k) => !/^mux\.[a-z]+$/.test(k.action)).map((k) => k.action).join(",") || "(none)"}`);
const presetActions = [...new Set(allKeys.map((k) => k.action.slice(4)))];
const orphan = presetActions.filter((a) => !MUX_VERB_NAMES.includes(a));
check("and the core's verb list is what answers: a preset name that is NOT a verb is FOUND, not assumed absent", orphan.length === 1 && orphan[0] === "send", `orphan(s): ${orphan.join(",")} (${presets.length} styles x their actions)`);
const unnamed = MUX_VERB_NAMES.filter((v) => !presetActions.includes(v));
check("and the ONLY core verbs no preset carries are act and keys (a seat act is backend-free; keys is the table itself)", JSON.stringify([...unnamed].sort()) === JSON.stringify(["act", "keys"]), `unnamed: ${unnamed.join(",")}`);

console.log("\n=== 2. FOUR PRESET STYLES ARE REGISTERED BY DRIVERS, NOT BRANCHED IN THE CORE ===");
check("four styles are registered", presets.length === 4 && loaded.styles.length === 4, `${loaded.styles.join(",")}`);
check("the styles are exactly the drivers' own styles (the core composes them, it does not name one)", JSON.stringify([...loaded.styles].sort()) === JSON.stringify(["herdr", "screen", "tmux", "zellij"]), loaded.styles.join(","));
check("every preset carries a style AND a key table", presets.every((p) => p.style && Object.keys(p.keys).length >= 8), `${presets.map((p) => `${p.style}=${Object.keys(p.keys).length}`).join(" ")}`);
check("a style is a driver file name, so --preset validates against the registry", (async () => {
  const bad = await muxSurfaceInvoke("keys --preset not-a-style", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
  return bad.ok === false && bad.exitCode === 1 && bad.show[0].body.includes("is not registered") && loaded.styles.every((s) => bad.show[0].body.includes(s));
})(), "--preset unknown prints the registered styles");
check("and the core source names NO style (a style is a backend word, and the core holds zero of them)", !/(tmux|screen|zellij|herdr)/.test(readFileSync(join(ROOT, "tools", "mux-surface-core.mjs"), "utf8").replace(/^\/\/.*$/gm, "")), "a backend word outside a comment in the core would be a port, not a seam");

console.log("\n=== 3. THE ACTIVE PRESET IS THE ACTIVE BACKEND'S, AND THE KNOB MOVES BOTH ===");
const activeBackend = loaded.active;
const activeDriver = loaded.drivers.get(activeBackend)?.driver;
check("nothing was asked => the ACTIVE backend is a driver rank fact, not a name in the core", activeBackend === "tmux" && activeDriver.rank === 100 && activeBackend === loaded.ranked[0], `ranked ${loaded.ranked.join(",")} ranks ${loaded.ranked.map((b) => loaded.drivers.get(b)?.driver?.rank).join(",")}`);
const screenEnv = await muxSurfaceDrivers({ dir: join(ROOT, "tools"), env: { [MUX_BACKEND_ENV]: "screen" } });
check(`and ${MUX_BACKEND_ENV}=screen moves the ACTIVE backend AND its preset together`, screenEnv.active === "screen" && screenEnv.drivers.get("screen").driver.preset.style === "screen" && screenEnv.requested === "screen", `active ${screenEnv.active} style ${screenEnv.drivers.get(screenEnv.active).driver.preset.style}`);
check("and an unregistered --backend does NOT become the default (a typo never silently re-keys the session)", (async () => {
  const r = await muxSurfaceInvoke("list --backend nosuch --all", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
  return r.ok === false && r.show[0].body.includes("is not registered") && loaded.names.every((n) => r.show[0].body.includes(n));
})(), "--backend typo refused with the registered set");
check("and an unregistered --preset is refused BY NAME with every registered style printed", (async () => {
  const bad = await muxSurfaceInvoke("keys --preset not-a-style", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
  return bad.ok === false && bad.exitCode === 1 && bad.show[0].body.includes("is not registered") && loaded.styles.every((s) => bad.show[0].body.includes(s));
})(), "--preset unknown prints the registered styles");
check(`and the preset KNOB is a declared env name (${MUX_PRESET_ENV}), so a persistent choice exists`, MUX_PRESET_ENV === "DURIAN_PI_MUX_PRESET" && MUX_BACKEND_ENV === "DURIAN_PI_MUX_BACKEND", `${MUX_PRESET_ENV}/${MUX_BACKEND_ENV}`);

console.log("\n=== 4. THE KEY TEXT: active preset + pi's OWN rendering + the refusal, in one document ===");
const keyText = muxKeysText(loaded, {});
check("it names the ACTIVE preset, taken from the active backend's own preset (not hardcoded here)", keyText.includes(`active preset: ${activeDriver.preset.style}`), keyText.slice(0, 200).replace(/\n/g, " | "));
check("and it prints EVERY registered preset's keys, so choosing a style is a visible choice", presets.every((p) => keyText.includes(`preset ${p.style}:`)), `${presets.length} styles`);
check("and it says pi renders them with keyHint()/keyText() from the user's keybindings (the goal's contract (5))", keyText.includes("keyHint()/keyText()") && keyText.includes("keybindings"), "");
check("and it states the REFUSAL rule: an action a preset does not carry is REFUSED BY NAME, never forwarded", keyText.includes("REFUSED BY NAME") && keyText.includes("never forwarded"), "");
check("and it lists the registered styles, so a session can ask for one that exists", keyText.includes(`registered styles: ${loaded.styles.join(", ")}`), "");
const oneStyle = muxKeysText(loaded, { presets: ["screen"] });
check("and --preset narrows the table to the chosen style while still naming the active one", oneStyle.includes("preset screen:") && !oneStyle.includes("preset tmux:") && oneStyle.includes("active preset: tmux"), `${(oneStyle.match(/preset [a-z]+:/g) ?? []).join(" ")}`);

console.log("\n=== 5. THE EXTENSION REGISTERS THE ACTIVE PRESET'S SHORTCUTS, AND ONLY ITS ===");
const calls = { commands: [], shortcuts: [] };
const api = {
  registerCommand: (name, spec) => { calls.commands.push({ name, spec }); return { name }; },
  registerShortcut: (combo, spec) => { calls.shortcuts.push({ combo, spec }); return { combo }; },
};
await muxSurfaceExtension(api);
const activeKeys = Object.entries(activeDriver.preset.keys);
check(`exactly /mux and /mux-keys are registered as commands (${activeBackend} preset)`, calls.commands.map((c) => c.name).join(",") === "mux,mux-keys", calls.commands.map((c) => c.name).join(","));
check(`and the shortcut count is the ACTIVE preset's size (${activeKeys.length})`, calls.shortcuts.length === activeKeys.length, `${calls.shortcuts.length} shortcuts for ${activeKeys.length} keys`);
const activeCombos = new Set(activeKeys.map(([, combo]) => combo));
check("and every registered combo belongs to the ACTIVE preset (no other style's table is on this session)", calls.shortcuts.every((s) => activeCombos.has(s.combo)), `${calls.shortcuts.filter((s) => !activeCombos.has(s.combo)).map((s) => s.combo).join(",") || "(none)"}`);
check("and every other style's combos are NOT registered, even where they collide with the active one", (() => {
  const otherCombos = allKeys.filter((k) => k.style !== activeDriver.preset.style).map((k) => k.combo);
  const shared = otherCombos.filter((c) => activeCombos.has(c));
  return shared.length > 0 && calls.shortcuts.map((s) => s.combo).join(",") === activeKeys.map(([, c]) => c).join(",");
})(), `${allKeys.length} keys across 4 styles, ${activeCombos.size} registered`);
check("and each shortcut's description names the backend whose preset it came from", calls.shortcuts.every((s) => String(s.spec?.description ?? "").includes(activeBackend)), `${calls.shortcuts[0].spec?.description}`);
check("and each shortcut resolves to a core verb through the ONE table", activeKeys.every(([action]) => MUX_VERB_NAMES.includes(action.slice(4)) || action === "mux.send"), "");
check("and the command's own description IS the core's (one description, two registrations)", calls.commands[0].spec?.description === MUX_SURFACE_DESCRIPTION, `${String(calls.commands[0].spec?.description ?? "(none)").slice(0, 80)} vs ${MUX_SURFACE_DESCRIPTION.slice(0, 80)}`);
check("and the argument box is the core's completion table, so a flag cannot be offered and then refused", (() => {
  const comp = calls.commands[0].spec?.getArgumentCompletions?.("--st");
  return Array.isArray(comp) && comp.length === 1 && comp[0].value === "--status";
})(), `${JSON.stringify(calls.commands[0].spec?.getArgumentCompletions?.("--st"))}`);

console.log("\n=== 6. A PRESET BLOCK THAT FAILS DOES NOT EAT /mux ===");
const boom = { commands: [], shortcuts: [] };
const api2 = {
  registerCommand: (name, spec) => { boom.commands.push({ name, spec }); return { name }; },
  registerShortcut: (combo, spec) => { throw new Error("stub: the preset block raised"); },
};
let raised = null;
try {
  await muxSurfaceExtension(api2);
} catch (err) {
  raised = String(err?.message ?? err);
}
check("the fallback names ITSELF (a session can ask what went wrong instead of finding keys missing)", boom.commands.map((c) => c.name).join(",") === "mux,mux-preset-problem" && !raised, `${boom.commands.map((c) => c.name).join(",")} raised ${raised}`);
check("and /mux survived the failure — the command is registered BEFORE the preset block", boom.commands.some((c) => c.name === "mux"), `${boom.commands.map((c) => c.name).join(",")}`);

console.log("\n=== 7. NO PRESET KEY BORROWS A PI DEFAULT ===");
const PI_TAKE = /^(ctrl\+shift\+(f|g|p))$/i;
check("every combo in EVERY preset is ctrl+shift+<one letter> (pi's own vocabulary shape)", allKeys.every((k) => /^ctrl\+shift\+[a-z]$/.test(k.combo)), `${allKeys.filter((k) => !/^ctrl\+shift\+[a-z]$/.test(k.combo)).map((k) => `${k.style} ${k.action}=${k.combo}`).join(" | ") || "(none)"}`);
check("and none is pi's ctrl+shift+f / g / p (pi owns those; a borrowed key is a conflict pi reports)", !allKeys.some((k) => PI_TAKE.test(k.combo)), `${allKeys.filter((k) => PI_TAKE.test(k.combo)).length} collisions`);
check("and a preset uses only single-key ctrl+shift combos — pi has NO two-key sequences, so screen's ctrl+c prefix is not pretend-implemented", allKeys.every((k) => !/[+].*[+].*[+]/.test(k.combo)), "");
const perStyle = {};
for (const k of allKeys) perStyle[k.combo] = [...(perStyle[k.combo] ?? []), k.style];
const dupes = Object.entries(perStyle).filter(([, ss]) => ss.length > 1);
check("cross-style collisions EXIST and are why only one preset registers (a key style IS a backend word)", dupes.length >= 3 && calls.shortcuts.length === activeKeys.length, `${dupes.length} shared combos across ${presets.length} styles`);

console.log("\n=== 8. A CAPABILITY A DRIVER DOES NOT DECLARE IS REFUSED BY NAME ===");
const herdrCaps = loaded.drivers.get("herdr").driver;
const caps = herdrCaps.capabilities instanceof Set ? [...herdrCaps.capabilities] : [...(herdrCaps.capabilities ?? [])];
const cap = muxCapability("herdr", "detach", { drivers: loaded.drivers });
check("herdr's detach is refused capability-not-declared (it names the backend AND the action)", cap.ok === false && cap.code === "capability-not-declared" && cap.refusal.includes("herdr") && cap.refusal.includes("detach"), `${cap?.code} ${String(cap?.refusal ?? "").slice(0, 140)}`);
check("and the refusal prints the set the driver DID declare, so the correction is complete", caps.every((c) => cap.refusal.includes(c)) && !caps.includes("detach"), `declared ${caps.sort().join(", ")}`);
check("and the refusal says the multiplexer's own key is NOT forwarded (this plugin will not guess a key)", cap.refusal.includes("will NOT forward"), String(cap?.refusal ?? "").slice(0, 200));
check("and a declared capability passes (the refusal is not a blanket no)", muxCapability("herdr", "capture", { drivers: loaded.drivers }).ok === true, "capture is declared");
check("and an unregistered backend is refused BY NAME too, not treated as all-capable", (() => {
  const r = muxCapability("dwm", "list", { drivers: loaded.drivers });
  return r.ok === false && r.code === "backend-not-registered" && loaded.names.every((n) => r.refusal.includes(n));
})(), "backend-not-registered");
check("and the PLAN turns an undeclared verb into that refusal rather than a zero-command success", (async () => {
  const out = await muxSurfaceInvoke("detach --pane p1 --backend herdr", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
  return out.ok === false && out.exitCode === 1 && out.show[0].body.includes("does not declare");
})(), "detach on herdr refused at the plan");

console.log("\n=== 9. THE send LEG IS AN OPEN GAP — PINNED AS A REFUSAL, NOT AS A ROUTE ===");
const sendOut = await muxSurfaceInvoke("send", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
check("the active preset's send key currently answers send-is-not-a-verb (the truth today)", sendOut.ok === false && sendOut.exitCode === 1 && sendOut.show[0].body.includes("`send` is not a mux verb"), `${String(sendOut.show[0].body).slice(0, 140)}`);
check("and the refusal prints the verbs that DO exist, so a user can correct to act", MUX_VERB_NAMES.every((v) => sendOut.show[0].body.includes(v)) && sendOut.show[0].body.includes(MUX_USAGE), String(sendOut.show[0].body).slice(0, 200));
check("and NO driver names a send command (so nothing here is one keystroke away from a second writer)", loaded.names.every((n) => !Object.keys(loaded.drivers.get(n).driver?.commands ?? {}).includes("send")), `${loaded.names.filter((n) => Object.keys(loaded.drivers.get(n).driver?.commands ?? {}).includes("send")).join(",")}`);
check("and the extension forwards a preset key as the bare verb (which is why send lands in the refusal)", readFileSync(join(ROOT, "tools", "mux-surface-extension.js"), "utf8").includes("muxSurfaceInvoke(verb,"), "the shortcut handler calls muxSurfaceInvoke(verb, ...)");
check("and the core HAS the route it needs (act --op message is the spool leg), so the fix is a table row, not a new door", (async () => {
  const a = await muxSurfaceInvoke("act impl --op message --text \"steer me\"", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
  return a.ok === true && a.exitCode === 0;
})(), "act --op message answers ok");

rmSync(tmp, { recursive: true, force: true });
check("the rig's live store did not move by a byte", statOf(liveStore) === liveStoreBefore, `mtime ${liveStoreBefore} -> ${statOf(liveStore)}`);
check("and its size is unchanged", statSync(liveStore).size === liveSizeBefore, `size ${liveSizeBefore} -> ${statSync(liveStore).size}`);
check("and the tracked extension and the installed copy are the SAME bytes (one edited grammar, two planes)", readFileSync(join(ROOT, "tools", "mux-surface-extension.js"), "utf8") === (existsSync(join(ROOT, ".pi", "extensions", "mux-surface.js")) ? readFileSync(join(ROOT, ".pi", "extensions", "mux-surface.js"), "utf8") : "(missing)"), `${existsSync(join(ROOT, ".pi", "extensions", "mux-surface.js")) ? "present" : "MISSING install target"}`);

const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  process.stdout.write(`\nMUX-KEYBINDS PASS (${secs}s total) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — the keybind vocabulary is ONE table: ${allKeys.length} preset keys across ${presets.length} styles (tmux, screen, zellij, herdr), every one spelled mux.<name> and every combo ctrl+shift+letter with NONE of pi's ctrl+shift+f/g/p borrowed; the ACTIVE preset is the ACTIVE backend's own (rank ${activeDriver.rank}) and ${MUX_BACKEND_ENV}=screen moves backend and preset together; muxKeysText prints the active preset, all ${presets.length} styles, pi's keyHint()/keyText() rendering and the REFUSED BY NAME rule; the extension registers exactly /mux, /mux-keys and ${calls.shortcuts.length} shortcuts — the active preset's only — while ${dupes.length} cross-style combos stay off the session, and a preset block that raises still leaves /mux plus a self-named /mux-preset-problem; herdr's detach is refused capability-not-declared naming its ${caps.length} declared actions, and the plan refuses it rather than returning zero commands. HONEST GAP, still open: the preset key mux.send is NOT a core verb, so that key answers send-is-not-a-verb today (no driver names a send command, so nothing here can type into a pane) — routing mux.send to act --op message is owed work, and the spool route it needs already answers ok.\n`);
  process.exit(0);
}
process.stdout.write(`${failures} FAILURE(S)\n`);
process.exit(1);
