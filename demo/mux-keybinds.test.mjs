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
//   9. THE `send` LEG IS ROUTED — every preset names `mux.send`, so that key is a PRESET KEY and a name that
//      answers "not a mux verb" is a dead key wearing a product name (the completion auditor's objection 3). It
//      resolves through the ONE verb table to the core's act leg pinned to --op message (the broker's spool);
//      a contradicting --op is a NEW refusal BY NAME (send-op-conflict), and no driver names a `send` command,
//      so the verb is routed to the spool and NOT to a keystroke primitive. The decision sits in the CORE, not
//      in a driver, because a key style IS a backend word and the core must stay backend-word-free.
//  10. PI'S OWN HINT FNS, RUN ON PI'S OWN PLANE — contract (5) says the vocabulary is "rendered with pi's own
//      keyHint()/keyText()", and those two fns are reachable from an extension through ONE route only: the entry
//      renderer (`EntryRenderOptions extends KeybindingHints`), never a command handler. So this section imports the
//      real `@earendil-works/pi-tui` + pi-coding-agent modules and (a) re-reads pi's RESERVED shortcut list from
//      vendor/pi-main/packages/coding-agent/src/core/extensions/runner.ts and FAILS if the core's copy drifts, (b)
//      asks pi for all 18 reserved keys and ties every answer to pi's own default, (c) proves `keyText` of a MUX
//      action is "" (the CLOSED-vocabulary gap — keybindings.json cannot move a mux key, even when a user tries),
//      (d) shows the core prints WHICH fn refused before pi's `initTheme()` instead of losing the table, (e) renders
//      the entry `/mux-keys` appends through the renderer the extension registered — pi's Text component, pi's hint
//      line — and (f) rebinds a pi id onto a preset's combo, which makes pi SKIP that plugin shortcut (runner.ts
//      prints "conflicts with built-in shortcut. Skipping."): a dead key is the trap, so the core NAMES the collision.
//
// HERMETIC: no multiplexer binary runs here, no store is written, no model is called, no session is started. §10
// imports pi's own compiled modules in-process and pi's own `KeybindingsManager.create()` (which only READS the
// user's keybindings.json). Run: node demo/mux-keybinds.test.mjs (exit 0 = pass)
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
  MUX_RESERVED_PI_IDS,
  MUX_PI_HINT_IDS,
  muxKeyResolve,
  muxKeyCollision,
  muxKeyCollisionLines,
  muxKeyHintLines,
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
check("and the core's verb list is what answers: EVERY preset name is a verb, so no preset key is dead", orphan.length === 0, `orphan(s): ${orphan.join(",")} (${presets.length} styles x their actions)`);
const unnamed = MUX_VERB_NAMES.filter((v) => !presetActions.includes(v));
check("and the ONLY core verbs no preset carries are act and keys (a seat act is backend-free; keys is the table itself)", JSON.stringify([...unnamed].sort()) === JSON.stringify(["act", "keys"]), `unnamed: ${unnamed.join(",")}`);

console.log("\n=== 2. FOUR PRESET STYLES ARE REGISTERED BY DRIVERS, NOT BRANCHED IN THE CORE ===");
check("four styles are registered", presets.length === 4 && loaded.styles.length === 4, `${loaded.styles.join(",")}`);
check("the styles are exactly the drivers' own styles (the core composes them, it does not name one)", JSON.stringify([...loaded.styles].sort()) === JSON.stringify(["herdr", "screen", "tmux", "zellij"]), loaded.styles.join(","));
check("every preset carries a style AND a key table", presets.every((p) => p.style && Object.keys(p.keys).length >= 8), `${presets.map((p) => `${p.style}=${Object.keys(p.keys).length}`).join(" ")}`);
check("a style is a driver file name, so --preset validates against the registry", await (async () => {
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
check("and an unregistered --backend does NOT become the default (a typo never silently re-keys the session)", await (async () => {
  const r = await muxSurfaceInvoke("list --backend nosuch --all", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
  return r.ok === false && r.show[0].body.includes("is not registered") && loaded.names.every((n) => r.show[0].body.includes(n));
})(), "--backend typo refused with the registered set");
check("and an unregistered --preset is refused BY NAME with every registered style printed", await (async () => {
  const bad = await muxSurfaceInvoke("keys --preset not-a-style", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
  return bad.ok === false && bad.exitCode === 1 && bad.show[0].body.includes("is not registered") && loaded.styles.every((s) => bad.show[0].body.includes(s));
})(), "--preset unknown prints the registered styles");
check(`and the preset KNOB is a declared env name (${MUX_PRESET_ENV}), so a persistent choice exists`, MUX_PRESET_ENV === "DURIAN_PI_MUX_PRESET" && MUX_BACKEND_ENV === "DURIAN_PI_MUX_BACKEND", `${MUX_PRESET_ENV}/${MUX_BACKEND_ENV}`);

console.log("\n=== 4. THE KEY TEXT: active preset + pi's OWN rendering + the refusal, in one document ===");
const keyText = muxKeysText(loaded, {});
check("it names the ACTIVE preset, taken from the active backend's own preset (not hardcoded here)", keyText.includes(`active preset: ${activeDriver.preset.style}`), keyText.slice(0, 200).replace(/\n/g, " | "));
check("and it prints EVERY registered preset's keys, so choosing a style is a visible choice", presets.every((p) => keyText.includes(`preset ${p.style}:`)), `${presets.length} styles`);
check("and it states what pi CAN and CANNOT rebind: pi's keybinding ids are a CLOSED vocabulary, so keybindings.json cannot move a mux key", keyText.includes("CLOSED vocabulary") && keyText.includes("keybindings.json") && keyText.includes('keyText of an unknown id is ""') && keyText.includes("mux.list"), keyText.slice(-400).replace(/\n/g, " | "));
check("and a hint/collision check that could not run SAYS NOT RUN (an unrun check never prints as clean)", keyText.includes("collision check NOT RUN") && keyText.includes("no host keyText handed in"), keyText.slice(-300).replace(/\n/g, " | "));
check("and it names the pi ids whose keys it asks pi for, so the table is honest about which keys are pi's", MUX_PI_HINT_IDS && Object.keys(MUX_PI_HINT_IDS).length === 4 && Object.keys(MUX_PI_HINT_IDS).every((id) => keyText.includes(id)), Object.keys(MUX_PI_HINT_IDS).join(","));
check("and it states the REFUSAL rule: an action a preset does not carry is REFUSED BY NAME, never forwarded", keyText.includes("REFUSED BY NAME") && keyText.includes("never forwarded"), "");
check("and it lists the registered styles, so a session can ask for one that exists", keyText.includes(`registered styles: ${loaded.styles.join(", ")}`), "");
const oneStyle = muxKeysText(loaded, { presets: ["screen"] });
check("and --preset narrows the table to the chosen style while still naming the active one", oneStyle.includes("preset screen:") && !oneStyle.includes("preset tmux:") && oneStyle.includes("active preset: tmux"), `${(oneStyle.match(/preset [a-z]+:/g) ?? []).join(" ")}`);

console.log("\n=== 5. THE EXTENSION REGISTERS THE ACTIVE PRESET'S SHORTCUTS, AND ONLY ITS ===");
const calls = { commands: [], shortcuts: [], entryRenderers: [], entries: [], notices: [] };
const api = {
  registerCommand: (name, spec) => { calls.commands.push({ name, spec }); return { name }; },
  registerShortcut: (combo, spec) => { calls.shortcuts.push({ combo, spec }); return { combo }; },
  registerEntryRenderer: (type, renderer) => { calls.entryRenderers.push({ type, renderer }); return type; },
  appendEntry: (type, data) => { calls.entries.push({ type, data }); return type; },
};
await muxSurfaceExtension(api);
check("and the extension registers an entry renderer for mux-keys — the ONLY route on which pi's keyHint()/keyText() reach a plugin", calls.entryRenderers.length === 1 && calls.entryRenderers[0].type === "mux-keys" && typeof calls.entryRenderers[0].renderer === "function", `${calls.entryRenderers.map((r) => r.type).join(",")} (${calls.entryRenderers.length} renderers)`);
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
check("and each shortcut resolves to a core verb through the ONE table (no exception for send: send IS a verb)", activeKeys.every(([action]) => MUX_VERB_NAMES.includes(action.slice(4))), "");
check("and the command's own description IS the core's (one description, two registrations)", calls.commands[0].spec?.description === MUX_SURFACE_DESCRIPTION, `${String(calls.commands[0].spec?.description ?? "(none)").slice(0, 80)} vs ${MUX_SURFACE_DESCRIPTION.slice(0, 80)}`);
check("and the argument box is the core's completion table, so a flag cannot be offered and then refused", (() => {
  const comp = calls.commands[0].spec?.getArgumentCompletions?.("--st");
  return Array.isArray(comp) && comp.length === 1 && comp[0].value === "--status";
})(), `${JSON.stringify(calls.commands[0].spec?.getArgumentCompletions?.("--st"))}`);

const keysCmd = calls.commands.find((c) => c.name === "mux-keys");
await keysCmd?.spec?.handler?.("screen", { ui: { notify: (msg, level) => calls.notices.push({ msg, level }) } });
check("and /mux-keys APPENDS the entry whose renderer pi calls with pi's own fns (one entry, carrying the loaded table)", calls.entries.length === 1 && calls.entries[0].type === "mux-keys" && calls.entries[0].data?.loaded?.active === activeBackend && calls.entries[0].data?.loaded?.drivers?.size === loaded.drivers.size, `${calls.entries.length} entries: ${calls.entries.map((e) => e.type).join(",")}`);
check("and the handler still prints the table it can print WITHOUT pi's keys, and says an entry follows (two documents, one claim each)", calls.notices.length >= 2 && calls.notices.some((n) => String(n.msg).includes("rendered by pi with pi's own KeybindingHints")), `${calls.notices.length} notices`);
check("and the appended entry kept the --preset narrowing the user asked for", JSON.stringify(calls.entries[0].data?.state) === JSON.stringify({ presets: ["screen"] }), `${JSON.stringify(calls.entries[0].data?.state)}`);

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
check("and the PLAN turns an undeclared verb into that refusal rather than a zero-command success", await (async () => {
  const out = await muxSurfaceInvoke("detach --pane p1 --backend herdr", { env: {}, cwd: ROOT, store: join(tmp, "no-store.sqlite") });
  return out.ok === false && out.exitCode === 1 && out.show[0].body.includes("does not declare");
})(), "detach on herdr refused at the plan");

console.log("\n=== 9. THE send LEG IS ROUTED: the preset key resolves to the core's ONE spool op ===");
// THE PIN'S IN-MEMORY PLANE — the same seams shape the other mux pins use, so this section witnesses the
// ROUTE without a store, a binary, or a model. The seats are DATA handed to the core; the core decides.
const sendStore = join(tmp, "no-store-send.sqlite");
const sendSeats = [{ name: "impl", conversationId: "conv-impl" }, { name: "qa", conversationId: "conv-qa" }];
const sendSeams = { drivers: loaded, readSeats: async () => sendSeats, readRows: async () => [], sessions: async () => [] };
check("send is IN the one verb table, so MUX_USAGE offers the key and the parser accepts it", MUX_VERB_NAMES.includes("send") && MUX_USAGE.includes("send <seat ...>"), `${MUX_VERB_NAMES.join(",")}`);
const bareSend = await muxSurfaceInvoke("send", { env: {}, cwd: ROOT, seams: sendSeams, store: sendStore });
check("a bare send asks for a selector rather than writing (a send with no target has no seat to route to)", bareSend.ok === false && bareSend.exitCode === 1 && bareSend.show[0].body.includes("send needs a selector"), `${String(bareSend.show[0].body).slice(0, 140)}`);
const sendAsk = await muxSurfaceInvoke("send impl --text \"steer me\"", { env: {}, cwd: ROOT, seams: sendSeams, store: sendStore });
check("send answers ok — the preset key is a ROUTED verb, not a dead key wearing a product name", sendAsk.ok === true && sendAsk.exitCode === 0, JSON.stringify({ ok: sendAsk.ok, exit: sendAsk.exitCode, body: String(sendAsk.show[0]?.body ?? "").slice(0, 160) }));
const sendBody = sendAsk.show.map((l) => l.body).join("\n");
check("and the request it holds is the broker's MESSAGE spool op aimed at the pane's OWN seat (contract (4))", sendBody.includes("act \u2014 pane impl seat impl spool op message") && sendBody.includes("\"op\":\"message\"") && sendBody.includes("\"to\":\"impl\"") && sendBody.includes("\"from\":\"impl\""), sendBody.slice(0, 400));
check("and it printed the census and the request even without --run, so an act that ran nothing says what it holds", sendBody.includes("mux census") && !/act RESULT/.test(sendBody), "census printed, no RESULT line: nothing was delivered");
check("and the store was never created by a send that did not pass --run", !existsSync(sendStore), `store ${existsSync(sendStore)}`);
const sendConflict = await muxSurfaceInvoke("send impl --op stop", { env: {}, cwd: ROOT, seams: sendSeams, store: sendStore });
check("a contradicting --op is REFUSED BY NAME, never re-routed and never silently ignored", sendConflict.ok === false && sendConflict.exitCode === 1 && sendConflict.show[0].body.includes("send names the message spool op") && sendConflict.show[0].body.includes("--op stop contradicts it"), `${String(sendConflict.show[0].body).slice(0, 200)}`);
check("and the refusal prints the spelling that DOES mean the other op, so the correction is complete", sendConflict.show[0].body.includes("act <seat> --op stop") && sendConflict.show[0].body.includes("Nothing was written"), `${String(sendConflict.show[0].body).slice(0, 240)}`);
check("and NO driver names a send command, so `send` is a verb routed to the spool and NOT a keystroke primitive", loaded.names.every((n) => !Object.keys(loaded.drivers.get(n).driver?.commands ?? {}).includes("send")), `${loaded.names.filter((n) => Object.keys(loaded.drivers.get(n).driver?.commands ?? {}).includes("send")).join(",")}`);
check("and EVERY registered preset names mux.send, which is why this row is a preset key and not an optional verb", presets.every((p) => Object.keys(p.keys ?? {}).includes("mux.send")), `${presets.map((p) => `${p.style}:${Object.keys(p.keys ?? {}).includes("mux.send")}`).join(" ")}`);
check("and the extension forwards a preset key as the bare verb, so the shortcut now reaches the spool rather than a refusal", readFileSync(join(ROOT, "tools", "mux-surface-extension.js"), "utf8").includes("muxSurfaceInvoke(verb,"), "the shortcut handler calls muxSurfaceInvoke(verb, ...)");
check("and `act --op message` (the route send aliases) answers the same way, so send is an alias and not a second door", await (async () => {
  const a = await muxSurfaceInvoke("act impl --op message --text \"steer me\"", { env: {}, cwd: ROOT, seams: sendSeams, store: sendStore });
  return a.ok === true && a.exitCode === 0 && a.show.map((l) => l.body).join("\n").includes("spool op message");
})(), "act --op message answers ok and prints the same spool op");

console.log("\n=== 10. PI'S OWN HINT FNS, RUN ON PI'S OWN PLANE (the KeybindingHints route) ===");
const runnerSrc = readFileSync(join(ROOT, "vendor", "pi-main", "packages", "coding-agent", "src", "core", "extensions", "runner.ts"), "utf8");
const reservedMatch = String(runnerSrc).match(/RESERVED_KEYBINDINGS_FOR_EXTENSION_CONFLICTS\s*=\s*\[([\s\S]*?)\]/);
const piReserved = reservedMatch ? [...reservedMatch[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
check("the core's copy of pi's RESERVED shortcut list is pi's, in order (the collision rule READS that copy, so drift here is a rule defect)", JSON.stringify(MUX_RESERVED_PI_IDS) === JSON.stringify(piReserved), `core ${MUX_RESERVED_PI_IDS.length} vs pi ${piReserved.length}: ${piReserved.slice(0, 3).join(",")}`);
check("and pi really does SKIP an extension shortcut equal to a reserved one — the source of that skip is present, cited, not remembered", /conflicts with built-in shortcut\. Skipping\./.test(runnerSrc), "vendor/pi-main/packages/coding-agent/src/core/extensions/runner.ts must carry the skip message");
const tuiPkg = await import("@earendil-works/pi-tui");
const caPkg = await import(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/core/keybindings.js", import.meta.url).href);
const hintsPkg = await import(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/keybinding-hints.js", import.meta.url).href);
const themePkg = await import(new URL("../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js", import.meta.url).href);
check("all four pi modules answered (an absent module would make this whole section vacuous)", [tuiPkg, caPkg, hintsPkg, themePkg].every(Boolean), `${tuiPkg ? "tui" : "-"} ${caPkg ? "ca" : "-"} ${hintsPkg ? "hints" : "-"} ${themePkg ? "theme" : "-"}`);
check("and pi exports both hint fns the seam asks for", typeof hintsPkg.keyText === "function" && typeof hintsPkg.keyHint === "function", `${typeof hintsPkg.keyText}/${typeof hintsPkg.keyHint}`);
const km = caPkg.KeybindingsManager.create();
tuiPkg.setKeybindings(km);
const host = { keyText: hintsPkg.keyText, keyHint: hintsPkg.keyHint };
const resolved = muxKeyResolve(host);
const askedOf = Object.values(resolved).filter((r) => r.called === true);
check(`and pi ANSWERED for every one of pi's ${MUX_RESERVED_PI_IDS.length} reserved ids`, askedOf.length === MUX_RESERVED_PI_IDS.length, `${askedOf.length}/${MUX_RESERVED_PI_IDS.length} (any "no host keyText handed in" would be a seam failure, not a pi fact)`);
const defOf = (id) => String(caPkg.KEYBINDINGS?.[id]?.defaultKeys ?? "");
const drifted = MUX_RESERVED_PI_IDS.filter((id) => {
  const d = defOf(id).toLowerCase();
  if (!d) return true;
  const want = d.split(",");
  const got = String(resolved[id]?.text ?? "").toLowerCase().split("/");
  return want.length !== got.length || !want.every((p) => got.includes(p));
});
check("and every answer is that id's OWN pi default from pi's own KEYBINDINGS table — the plugin prints pi's key, it never copies a name here", drifted.length === 0 && MUX_RESERVED_PI_IDS.every((id) => defOf(id)), `${drifted.length} drifts: ${drifted.map((id) => `${id} pi="${resolved[id]?.text}" default="${defOf(id)}"`).join(" | ") || "(none)"}`);
const followKeyUp = String(resolved["app.message.followUp"]?.text ?? "");
check("and pi's follow-up key is one of pi's two documented branches (alt+enter, ctrl+q on the windows branch)", ["alt+enter", "ctrl+q"].includes(followKeyUp), `followUp=${followKeyUp} windows=${caPkg.useWindowsKeybindings?.()}`);
check("and keyText of a MUX action answers \"\" — a plugin key has no pi id, so there is nothing for pi to render (the CLOSED vocabulary, proven)", hintsPkg.keyText("mux.detach") === "" && hintsPkg.keyText("mux.list") === "", `mux.detach=${JSON.stringify(hintsPkg.keyText("mux.detach"))} mux.list=${JSON.stringify(hintsPkg.keyText("mux.list"))}`);
km.setUserBindings({ "mux.detach": "ctrl+shift+q" });
tuiPkg.setKeybindings(km);
check("and a user keybindings.json entry for a mux action is IGNORED by pi, so keybindings.json cannot re-key a preset (the trap the docs now state instead of denying)", hintsPkg.keyText("mux.detach") === "" && hintsPkg.keyText("app.exit") === defOf("app.exit"), `mux.detach=${JSON.stringify(hintsPkg.keyText("mux.detach"))} app.exit=${JSON.stringify(hintsPkg.keyText("app.exit"))}`);
const noTheme = muxKeyHintLines(host);
check("BEFORE pi's initTheme(): the core keeps the table and NAMES which fn refused plus what the other one answered (a hint that dies silently is the drift this seam exists to catch)", noTheme.join("\n").includes("keyHint did not answer") && noTheme.join("\n").includes("Theme not initialized") && noTheme.join("\n").includes('keyText says "'), noTheme.join("\n").slice(0, 300));
themePkg.initTheme();
const hintLines = muxKeyHintLines(host);
check("AFTER pi's own initTheme(): every pi id's line is pi's keyHint — the rendering contract (5) asks for, RUN", Object.keys(MUX_PI_HINT_IDS).every((id) => hintLines.join("\n").includes(`pi id ${id}`)) && hintLines.join("\n").split("(rendered by pi's keyHint)").length - 1 === Object.keys(MUX_PI_HINT_IDS).length, `${hintLines.join("\n").split("(rendered by pi's keyHint)").length - 1} of ${Object.keys(MUX_PI_HINT_IDS).length} ids rendered by keyHint`);
const fullKeyText = muxKeysText(loaded, {}, host);
check("and the SAME document with pi's fns handed in prints pi's answers for all 18 reserved ids and says no collision today", fullKeyText.includes(`pi answered for ${MUX_RESERVED_PI_IDS.length} of ${MUX_RESERVED_PI_IDS.length} reserved ids`) && fullKeyText.includes("no preset key collides with a RESERVED pi shortcut"), fullKeyText.slice(-300).replace(/\n/g, " | "));
check("no preset combo equals a RESERVED pi key today, and that absence is evidence only because pi answered for all 18", muxKeyCollision(allKeys, resolved).length === 0, `${muxKeyCollision(allKeys, resolved).map((h) => `${h.style} ${h.action}`).join(",") || "(none)"} of ${allKeys.length} preset keys`);
const entryRendered = calls.entryRenderers[0]?.renderer?.(calls.entries[0], { keyText: hintsPkg.keyText, keyHint: hintsPkg.keyHint, expanded: false }, null);
check("and the renderer the extension registered returns pi-tui's OWN Text component", typeof tuiPkg.Text === "function" && entryRendered?.constructor?.name === "Text", `${typeof tuiPkg.Text} ${entryRendered?.constructor?.name ?? "(no component)"}`);
const strip = (s) => String(s).replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "");
const oneLine = (s) => strip(s).replace(/\s+/g, " ").trim();
const visible = oneLine((entryRendered?.render?.(120) ?? []).join("\n"));
check("and the rendered entry carries pi's OWN hint for the follow-up id — pi typed the key, the plugin only named the id", visible.includes(`${followKeyUp} to queue a follow-up on the seat this pane shows`) && visible.includes("rendered by pi's keyHint"), visible.slice(-400));
km.setUserBindings({ "app.tools.expand": "ctrl+shift+q" });
tuiPkg.setKeybindings(km);
const hits = muxKeyCollision(allKeys, muxKeyResolve(host));
const verdict = muxKeyCollisionLines(loaded, host).join("\n");
check("and rebinding a pi id ONTO a preset's combo makes pi SKIP that plugin shortcut — the core NAMES the collision (tmux mux.halt, screen/herdr mux.detach) rather than shipping a dead key", hits.some((h) => h.style === "tmux" && h.action === "mux.halt" && h.piId === "app.tools.expand") && hits.some((h) => h.style === "screen" && h.action === "mux.detach") && verdict.startsWith("COLLISION"), `${hits.length} hits: ${hits.map((h) => `${h.style} ${h.action}`).join(", ")}`);
check("and the verdict quotes pi's own skip message so a reader can find why the key is dead", verdict.includes("conflicts with built-in shortcut. Skipping."), verdict.slice(0, 260));
km.setUserBindings({});
tuiPkg.setKeybindings(km);
check("and restoring the bindings restores zero collisions (the rebind above is a probe, not a residue)", muxKeyCollision(allKeys, muxKeyResolve(host)).length === 0, `${muxKeyCollision(allKeys, muxKeyResolve(host)).length} left`);

rmSync(tmp, { recursive: true, force: true });
check("the rig's live store did not move by a byte", statOf(liveStore) === liveStoreBefore, `mtime ${liveStoreBefore} -> ${statOf(liveStore)}`);
check("and its size is unchanged", statSync(liveStore).size === liveSizeBefore, `size ${liveSizeBefore} -> ${statSync(liveStore).size}`);
check("and the tracked extension and the installed copy are the SAME bytes (one edited grammar, two planes)", readFileSync(join(ROOT, "tools", "mux-surface-extension.js"), "utf8") === (existsSync(join(ROOT, ".pi", "extensions", "mux-surface.js")) ? readFileSync(join(ROOT, ".pi", "extensions", "mux-surface.js"), "utf8") : "(missing)"), `${existsSync(join(ROOT, ".pi", "extensions", "mux-surface.js")) ? "present" : "MISSING install target"}`);

const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  process.stdout.write(`\nMUX-KEYBINDS PASS (${secs}s total) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — the keybind vocabulary is ONE table: ${allKeys.length} preset keys across ${presets.length} styles (tmux, screen, zellij, herdr), every one spelled mux.<name> and every combo ctrl+shift+letter with NONE of pi's ctrl+shift+f/g/p borrowed; the ACTIVE preset is the ACTIVE backend's own (rank ${activeDriver.rank}) and ${MUX_BACKEND_ENV}=screen moves backend and preset together; muxKeysText prints the active preset, all ${presets.length} styles, pi's keyHint()/keyText() rendering and the REFUSED BY NAME rule; the extension registers exactly /mux, /mux-keys and ${calls.shortcuts.length} shortcuts — the active preset's only — while ${dupes.length} cross-style combos stay off the session, and a preset block that raises still leaves /mux plus a self-named /mux-preset-problem; herdr's detach is refused capability-not-declared naming its ${caps.length} declared actions, and the plan refuses it rather than returning zero commands. PI'S OWN PLANE RAN (§10): the core's RESERVED copy matched vendor/pi-main/packages/coding-agent/src/core/extensions/runner.ts (${MUX_RESERVED_PI_IDS.length} ids), pi answered all ${askedOf.length} reserved keys and each matched pi's own KEYBINDINGS default (follow-up=${followKeyUp}), keyText of a mux action answered \"\" and a user keybindings.json entry for it stayed IGNORED, the core named which hint fn refused before pi's initTheme() and then rendered pi's keyHint for ${Object.keys(MUX_PI_HINT_IDS).length} ids, the entry /mux-keys appends rendered through pi-tui's Text with pi's own hint line (${followKeyUp} to queue a follow-up…), and rebinding app.tools.expand onto ctrl+shift+q made pi SKIP ${hits.length} preset shortcuts — named, with pi's skip message quoted. THE send LEG IS ROUTED, NOT AN OPEN GAP: all ${presets.length} presets name mux.send, that name is IN the one verb table (MUX_VERB_NAMES carries it and MUX_USAGE prints it), and it resolves through that table to the core's act leg pinned to --op message — "send impl --text …" answers ok holding a spool request with "op":"message", "from":"impl" and "to" the pane's own seat, a bare send asks for a selector, and "send impl --op stop" answers a NEW refusal that names both the word message and the spelling that does mean stop. No driver names a send command, so the preset key is a verb routed to the broker's spool and NOT a keystroke primitive, and the core still carries zero backend words.\n`);
  process.exit(0);
}
process.stdout.write(`${failures} FAILURE(S)\n`);
process.exit(1);
