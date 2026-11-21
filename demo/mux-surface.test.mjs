// demo/mux-surface.test.mjs — the multiplexer PRESENTATION seam on the PI plane: ONE backend-agnostic core,
// TWO registrations (a plain-pi `/mux` in `.pi/extensions/` and, later, `cli.mjs mux`), FOUR drivers spelling one
// backend each as DATA (ROADMAP: the mux seam; goal task `seam` + `seam-tmux`).
//
// WHAT EACH SECTION CLOSES (nothing below this line is prose):
//   1. A SECOND GRAMMAR. A pi command carrying its own flag table accepts `--zork` the moment the two grow apart
//      — the accepted-and-ignored class (#5071). Closed by the registration's argument box being BYTE-IDENTICAL to
//      the core's own `muxSurfaceCompletion`, and by every refusal carrying the core's `known flags:` + `usage`.
//   2. THE NAMESPACE MODEL LIVING IN A DRIVER. A backend swap would then move the plugin's panes into the user's
//      own tmux instance by accident. Closed by the core naming NO backend binary (raw word census 0) while every
//      driver names ONE, and by no driver naming a FOREIGN backend's argv head.
//   3. A SESSION THAT SHELLS OUT. The plugin's only out-of-process leg is `tools/mux-surface-owner.mjs`, reached by
//      `cli.mjs mux` under an explicit `--run` — a presentation command must not be able to reach it. Closed here
//      by `child_process`/`spawn` counts 0 in the core, the registration and every driver.
//   4. THE LOAD ITSELF. `.pi/extensions/mux-surface.js` → `../tools/mux-surface-core.mjs` → `../src/*.mjs` under
//      pi's jiti loader is a hypothesis, not an assumption. Measured on BOTH planes with `errors: []`.
//   5. THE DEFAULT BEING A NAME IN A FILE. Which backend answers when nothing was asked is a driver `rank` fact;
//      the core's `active` is tmux here because its driver ranks 100, and the extension registers ONLY that preset.
//   6. A HALF-SELECTED CENSUS. An unknown seat or a missing selector refuses BY NAME and prints NO census (the
//      fail-open's class).
//
// HERMETIC: the seats and queue rows are handed IN through the core's own read seams, so this pin opens no store.
// The rig's live store must not move by a byte. Run: node demo/mux-surface.test.mjs (exit 0 = pass)
import { existsSync, readFileSync, rmSync, statSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAgentDir, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { createRealHost } from "../src/tui/durable/real-host.mjs";

import muxSurfaceExtension from "../tools/mux-surface-extension.js"; // tracked source; installed by tools/mux-surface-install.mjs
import {
  MUX_COMMAND_NAME,
  MUX_SURFACE_DESCRIPTION,
  MUX_USAGE,
  MUX_VERB_NAMES,
  MUX_FLAG_NAMES,
  MUX_NAMESPACE_NAMES,
  muxSurfaceCompletion,
  muxSurfaceDrivers,
  muxSurfaceInvoke,
  muxKeysText,
  muxRefusalText,
} from "../tools/mux-surface-core.mjs";
import { MUX_BACKEND_ENV } from "../tools/mux-surface-core.mjs";

const BACKENDS = ["tmux", "screen", "zellij", "herdr"]; // the TEST's census list, never the core's decision
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const tmp = mkdtempSync(join(tmpdir(), "durig-mux-surface-"));
const liveStore = join(ROOT, "selfdev.sqlite");
const statOf = (p) => (existsSync(p) ? statSync(p).mtimeMs : null);
const liveStoreBefore = statOf(liveStore);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) return;
  failures += 1;
  process.stdout.write(`FAIL ${label}: ${detail}\n`);
};
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const word = (src, w) => ((src.match(new RegExp(w, "g")) ?? []).length);

console.log("=== 1. THE EXTENSION IS A REGISTRATION, NOT A SCRIPT (awaited: its body loads the registry) ===");
const t0 = Date.now();
const handlers = {};
const shortcuts = {};
const apiStub = {
  registerCommand: (name, def) => { handlers["command:" + name] = def; },
  registerShortcut: (combo, def) => { shortcuts["shortcut:" + combo] = def; },
};
await muxSurfaceExtension(apiStub); // ASYNC default export: unawaiting it leaves /mux-keys and the shortcuts unregistered
const cmd = handlers["command:" + MUX_COMMAND_NAME];
check("the registration completes with no throw", typeof cmd?.handler === "function", `keys ${Object.keys(handlers).join(",")}`);
check("it registers /mux named by the core", !!cmd && typeof cmd.handler === "function", `handlers ${Object.keys(handlers).join(",")}`);
check("it registers the key table command too (the async body got there)", Object.keys(handlers).length === 2 && !!handlers[`command:${MUX_COMMAND_NAME}-keys`], `handlers ${Object.keys(handlers).join(",")}`);
check("no command name is invented outside the core's", Object.keys(handlers).every((k) => k === `command:${MUX_COMMAND_NAME}` || k === `command:${MUX_COMMAND_NAME}-keys`), `handlers ${Object.keys(handlers).join(",")}`);
check("the description IS the core's sentence, not a local one", cmd.description === MUX_SURFACE_DESCRIPTION, `${String(cmd.description).slice(0, 90)} vs ${MUX_SURFACE_DESCRIPTION.slice(0, 90)}`);
check("the argument box is the core's function, byte-for-byte, on every prefix", ["", "li", "list", "--st", "--na", "--zz", "-"].every((p) => JSON.stringify(cmd.getArgumentCompletions(p) ?? null) === JSON.stringify(muxSurfaceCompletion(p) ?? null)), `prefixes 7`);
check("an unknown prefix offers NOTHING rather than everything", cmd.getArgumentCompletions("--zz") === null, String(cmd.getArgumentCompletions("--zz")));
const compVerbs = cmd.getArgumentCompletions("");
check("and it is exactly the core's verbs with their usage", compVerbs && compVerbs.length === MUX_VERB_NAMES.length && compVerbs.every((c) => MUX_VERB_NAMES.includes(c.value)) && JSON.stringify(compVerbs.map((c) => c.value)) === JSON.stringify(MUX_VERB_NAMES), `${JSON.stringify(compVerbs?.map((c) => c.value))}`);
const shortcutKeys = Object.keys(shortcuts);
check("the shortcuts registered are the ACTIVE preset's only", shortcutKeys.length === 8, `shortcuts ${shortcutKeys.length} -> ${shortcutKeys.join(",")}`);
check("every registered shortcut is ctrl+shift+<letter> (no pi default borrowed)", shortcutKeys.every((k) => /^shortcut:ctrl\+shift\+[a-z]$/.test(k)) && !shortcutKeys.some((k) => /ctrl\+shift\+[fgp]$/.test(k)), shortcutKeys.join(","));
check("shortcut descriptions attribute the preset they came from", Object.values(shortcuts).every((s) => /tmux preset/.test(String(s.description))), Object.values(shortcuts).map((s) => s.description).join(" | "));

console.log("\n=== 2. NO PROCESS, NO STORE, INSIDE THE PI PLANE (core + registration + every driver) ===");
const coreSource = readFileSync(join(ROOT, "tools", "mux-surface-core.mjs"), "utf8");
const extSource = readFileSync(join(ROOT, "tools", "mux-surface-extension.js"), "utf8");
const ownerSource = readFileSync(join(ROOT, "tools", "mux-surface-owner.mjs"), "utf8");
const coreStripped = strip(coreSource);
const extStripped = strip(extSource);
for (const forbidden of ["child_process", "spawn", "execSync", "exec(", "fork("]) {
  check(`the registration contains NO ${forbidden} once comments are stripped`, !extStripped.includes(forbidden), "in-process is the point: a session imports the core, it does not shell out");
  check(`the core contains NO ${forbidden}`, !coreStripped.includes(forbidden), "the backend-agnostic half starts nothing");
}
for (const forbidden of ["Harness.open", "openNodeSqliteStorage", "writeIntent", "drainIntentInbox", "commit("]) {
  check(`the core contains NO ${forbidden} (it opens no store and writes no intent)`, !coreStripped.includes(forbidden), "reads go through the rig's readData routing");
}
check("the ONE out-of-process module IS the owner plane (and only it spawns)", /spawnSync\(/.test(ownerSource) && !/spawn/i.test(coreStripped) && !/spawn/i.test(extStripped), "the door the extension cannot reach");
check("the registration does NOT import the owner plane (a presentation command cannot run argv)", !extStripped.includes("mux-surface-owner"), "cli.mjs mux is the plane that may pass --run");
for (const b of BACKENDS) {
  const src = strip(readFileSync(join(ROOT, "tools", `mux-driver-${b}.mjs`), "utf8"));
  for (const forbidden of ["child_process", "spawn", "execSync"]) {
    check(`the ${b} driver contains NO ${forbidden} (a driver is DATA)`, !src.includes(forbidden), "it spells argv, it never runs it");
  }
}

console.log("\n=== 3. THE SEAM: THE CORE NAMES ZERO BACKENDS, EACH DRIVER NAMES EXACTLY ONE ===");
const coreWords = BACKENDS.map((b) => `${b}=${word(coreStripped, b)}`).join(" ");
check("the core source names NO backend binary (raw, comments included)", BACKENDS.every((b) => word(coreSource, b) === 0), `${BACKENDS.map((b) => `${b}=${word(coreSource, b)}`).join(" ")}`);
check("so the NAMESPACE decision and the tag derivation are core-side and backend-word-free", coreSource.includes("muxWorkspaceTag") && coreSource.includes("MUX_NAMESPACE_TAG_PREFIX") && coreSource.includes("foreign"), coreWords);
const registry = await muxSurfaceDrivers({ dir: join(ROOT, "tools"), env: {} });
for (const b of BACKENDS) {
  const d = registry.drivers.get(b)?.driver;
  check(`a driver is registered under its OWN backend name`, !!d && d.backend === b, `drivers ${registry.names.join(",")}`);
  check(`its preset style is its own backend (a style IS a backend word)`, d?.preset?.style === b, `style ${d?.preset?.style}`);
  const heads = [];
  for (const verb of ["list", "open", "attach", "detach", "kill", "capture"]) {
    for (let index = 0; index < 2; index += 1) {
      const made = d.commands?.[verb]?.({ sessionName: "durian-w1", sessionTag: null, tag: "durian-w1", namespace: "plugin", pane: { seat: "impl" }, store: join(tmp, "w1", "selfdev.sqlite"), backend: b, verb, index, total: 2 });
      if (!made) continue;
      if (!made.argv) continue;
      heads.push(String(made.argv[0]));
    }
  }
  check(`the ${b} driver spells NO foreign backend's binary in any argv head`, heads.every((h) => h === b || h === "node"), `${b} heads ${heads.join(",")}`);
  check(`and it does spell its OWN for the session verbs`, heads.includes(b), `${b} heads ${heads.join(",") || "(none emitted: a named gap)"}`);
}
check("the active backend is a driver `rank` fact, not a name in this pin or the core", registry.active === "tmux" && registry.drivers.get("tmux").driver.rank === 100 && JSON.stringify(registry.ranked) === JSON.stringify(["tmux", "screen", "zellij", "herdr"]), `active ${registry.active} ranked ${registry.ranked.join(",")} ranks ${[...registry.drivers].map(([k, v]) => `${k}=${v.driver.rank}`).join(",")}`);
check("the core's own active answer is the same with nothing asked", registry.requested === null && registry.active === registry.ranked[0], `requested ${registry.requested}`);

console.log("\n=== 4. THE LOADED MODULE, ON BOTH PLANES, ERRORS FREE ===");
const loader = new DefaultResourceLoader({ cwd: ROOT, agentDir: getAgentDir() });
await loader.reload();
const discovered = loader.getExtensions();
const rec = discovered.extensions.find((e) => String(e.path).endsWith(".pi/extensions/mux-surface.js"));
const cmdsOf = (r) => (r.commands instanceof Map ? [...r.commands.keys()] : r.commands ?? []);
check("plane 1 (plain pi coding-agent auto-discovery) loads with NO errors", discovered.errors.length === 0, JSON.stringify(discovered.errors.map((e) => String(e.message ?? e))));
check("the installed file is discovered", !!rec, `paths ${discovered.extensions.map((e) => e.path).join(",")}`);
check("its commands carry /mux", !!rec && cmdsOf(rec).includes(MUX_COMMAND_NAME), rec ? cmdsOf(rec).join(",") : "no record");
check("and /mux-keys (so the async body ran under jiti, not only under node)", !!rec && cmdsOf(rec).includes(`${MUX_COMMAND_NAME}-keys`), rec ? cmdsOf(rec).join(",") : "no record");
check("its scope is `project` (the repo's .pi/extensions, not the user's)", !!rec && (rec.sourceInfo?.scope ?? rec.scope) === "project", rec ? String(rec.sourceInfo?.scope ?? rec.scope) : "no record");
check("the discovered /mux carries a handler a session can call", !!rec && typeof rec.commands?.get?.(MUX_COMMAND_NAME)?.handler === "function", rec ? typeof rec.commands?.get?.(MUX_COMMAND_NAME)?.handler : "no record");
check("and its description is the core's through the loader", !!rec && rec.commands?.get?.(MUX_COMMAND_NAME)?.description === MUX_SURFACE_DESCRIPTION, `${String(rec?.commands?.get?.(MUX_COMMAND_NAME)?.description).slice(0, 90)} vs ${MUX_SURFACE_DESCRIPTION.slice(0, 90)}`);
check("the loaded module answers its OWN argument box (the core resolved through jiti)", (() => { const c = rec?.commands?.get?.(MUX_COMMAND_NAME)?.getArgumentCompletions?.("--na"); return Array.isArray(c) && c.length > 0 && c.every((x) => String(x.value).startsWith("--na")); })(), JSON.stringify(rec?.commands?.get?.(MUX_COMMAND_NAME)?.getArgumentCompletions?.("--na")));
const host = await createRealHost({ cwd: ROOT });
const hostExts = host.hostSession.resourceLoader.getExtensions();
check("plane 2 (the durable-TUI host session) loads with NO errors", hostExts.errors.length === 0, JSON.stringify(hostExts.errors.map((e) => String(e.message ?? e))));
const hostRec = hostExts.extensions.find((e) => String(e.path).endsWith(".pi/extensions/mux-surface.js"));
check("plane 2 sees the SAME registration in the same scope", !!hostRec && cmdsOf(hostRec).includes(MUX_COMMAND_NAME) && (hostRec.sourceInfo?.scope ?? hostRec.scope) === "project", hostRec ? `${cmdsOf(hostRec).join(",")} ${hostRec.sourceInfo?.scope ?? hostRec.scope}` : "no record");
check("adding /mux did not disturb the other project extensions", discovered.extensions.filter((e) => String(e.path).startsWith(join(ROOT, ".pi/extensions"))).length >= 3, discovered.extensions.map((e) => e.path).join(","));
process.stdout.write(`  ok   plane 1: projectTrusted=${loader.settingsManager.isProjectTrusted()} errors=0 commands=${cmdsOf(rec).join(",")} scope=project | plane 2: projectTrusted=${host.hostSession.resourceLoader.settingsManager.isProjectTrusted()} errors=0 commands=${hostRec ? cmdsOf(hostRec).join(",") : "-"}\n`);

console.log("\n=== 5. THE GRAMMAR: AN UNDECLARED TOKEN IS REFUSED BY NAME, WITH NO PARTIAL CENSUS ===");
// SEED IN-MEMORY: the pi path opens no store at all, so the store this pin names never exists.
const seats = [
  { name: "impl", conversationId: "conv-impl" },
  { name: "qa", conversationId: "conv-qa" },
];
const presentRows = []; // no census asked here: pin 6 runs the real one
const seams = {
  drivers: registry, // handed as an OBJECT here; pin 6 hands it as an ASYNC GETTER (both shapes must work)
  readSeats: async () => seats,
  readRows: async () => [],
  sessions: async () => presentRows,
};
const ask = async (text) => await muxSurfaceInvoke(text, { env: {}, cwd: ROOT, seams, store: join(tmp, "w1", "selfdev.sqlite") });
const refusals = [
  ["zzz", "unknown verb"],
  ["list --zork", "unknown flag"],
  ["list --status zzz", "value outside the rig's queue vocabulary"],
  ["list --namespace zzz", "value outside the namespace vocabulary"],
  ["open nope-seat", "an undeclared selector (no such seat)"],
  ["open", "needs a selector"],
];
for (const [text, why] of refusals) {
  const r = await ask(text);
  const body = r.show.map((l) => l.body).join("");
  check(`\`${text}\` is REFUSED (ok false, exit 1, an error line)`, r.ok === false && r.exitCode === 1 && r.show.length >= 1 && r.show[0].level === "error", `${r.ok}/${r.exitCode}/${JSON.stringify(r.show).slice(0, 160)}`);
  check(`and its correction names the LEGAL SET it chose from`, body.includes("known flags:") || body.includes("known seats:") || body.includes("known verbs:") || body.includes("no pane census was printed"), body.slice(0, 220));
  check(`and it carries the core's usage line so a session can correct itself`, body.includes(MUX_USAGE) || /no pane census was printed/i.test(body), body.slice(0, 220));
  check(`and it is the core's own refusal text for that class`, !body.includes("mux census —"), body.slice(0, 220));
  check(`and NO pane census was emitted for a half-selected ask`, (r.panes ?? []).length === 0, `panes ${JSON.stringify(r.panes)}`);
  if (why === "unknown verb") check(`an unknown verb names the verb table`, body.includes("known verbs:") && MUX_VERB_NAMES.every((v) => body.includes(v)), body.slice(0, 220));
  if (why === "unknown flag") check(`an unknown flag names the flag table`, body.includes("known flags:") && MUX_FLAG_NAMES.every((f) => body.includes(f)), body.slice(0, 300));
  if (why === "needs a selector") check(`a selector-less ask names every legal selector`, body.includes("--all") && body.includes("--to") && body.includes("--id") && body.includes("--status") && body.includes("--pane"), body.slice(0, 240));
  if (why === "an undeclared selector (no such seat)") check(`an unknown seat prints the ROSTER and says no census was printed`, body.includes("no such seat:") && body.includes("known seats: impl, qa") && body.includes("No pane census was printed."), body.slice(0, 300));
  if (why === "value outside the rig's queue vocabulary") check(`a value outside a closed vocabulary is the same class as an unknown flag`, body.includes("is not in the vocabulary."), body.slice(0, 240));
}
const keys = await ask("keys");
const keysBody = keys.show.map((l) => l.body).join("");
check("`keys` answers (ok, exit 0)", keys.ok === true && keys.exitCode === 0, JSON.stringify(keys.show).slice(0, 120));
check("it names the ACTIVE preset it rendered", keysBody.includes(`active preset: ${registry.active}`), keysBody.slice(0, 200));
check("it prints EVERY registered preset, so a user can choose one", BACKENDS.every((b) => keysBody.includes(`preset ${b}:`)), keysBody.slice(0, 260));
check("it renders pi's own key vocabulary (keyHint/keyText, pi 1.5.2)", keysBody.includes("keyHint()/keyText()"), keysBody.match(/keyHint[^\n]*/)?.[0]);
check("and it states the refuse-by-name rule for what it cannot do", keysBody.includes("REFUSED BY NAME") && keysBody.includes("never forwarded"), keysBody.match(/an action no preset[^\n]*/)?.[0]);
check("every census line attributes the namespace it acted in", keys.show.some((l) => /namespace: plugin/.test(l.body)), keys.show.map((l) => l.body).join(" | ").slice(0, 400));

rmSync(tmp, { recursive: true, force: true });
check("and the rig's live store did not move by a byte for this whole gate", statOf(liveStore) === liveStoreBefore, `selfdev.sqlite mtime ${liveStoreBefore} -> ${statOf(liveStore)}`);
const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  process.stdout.write(`\nMUX-SURFACE PASS (${secs}s total; both loaders ${(((Date.now() - t0)) / 1000).toFixed(2)}s) on Linux / Fedora Linux 45 (Forty Five) / kernel 7.2.15-300.fc45.x86_64 / node v24.22.1 — ONE backend-agnostic core (raw backend-word census ${BACKENDS.map((b) => `${b}=0`).join(" ")}), FOUR drivers each spelling one backend's argv as DATA, /mux + /mux-keys visible in getCommands on BOTH planes (plain pi project auto-discovery AND the durable-TUI host session, errors 0, scope project), the argument box byte-equal to the core's completion on ${7} prefixes, ${refusals.length} argument/selector classes refused BY NAME with the legal set and MUX_USAGE and NO partial census, the plugin starts no process and opens no store, and the active backend is the drivers' rank fact (tmux 100 > screen 90 > zellij 80 > herdr 70)\n`);
  process.exit(0);
}
process.stdout.write(`${failures} FAILURE(S)\n`);
process.exit(1);
