// demo/queue-pi-command.test.mjs — the pi PLANE's /queue is the SAME core `cli.mjs queue` runs (ROADMAP 381, task-4).
//
// WHY THIS EXISTS AND WHAT IT PROVES (nothing below is prose). The operator's ask is a queue a person can view
// and adjust from the landing screen — a regular pi coding-agent session. The contract is specific: ONE backend-
// agnostic command core, IMPORTED (not shelled out) by a plain-pi package under `.pi/extensions/` via
// `registerCommand` + `getArgumentCompletions`, ALSO registered on the durable-TUI plane through the adapter's
// extension path, both visible in `getCommands`. What can go wrong here, and what each section closes:
//
//   1. A SECOND GRAMMAR. A pi command carrying its own flag table accepts `--zork` the moment the two grow
//      apart — the accepted-and-ignored class (#5071), the fail-open's defect class (ROADMAP 228). Closed by
//      BYTE-IDENTITY between the two registrations' refusal bytes for the same request, and by the completion
//      box being the core's function rather than a copy.
//   2. A SESSION THAT SHELLS OUT. `examples/extensions/subagent/index.ts` spawns because a subagent has no
//      in-process surface; here there is one, so the registration (comments stripped) names no process, and
//      the core names no store-opening either — reads go through the rig's `readData` routing.
//   3. THE LOAD ITSELF. The jiti hop is a hypothesis, not an assumption: does
//      `.pi/extensions/queue-surface.js` -> `../../tools/queue-surface-core.mjs` -> `../src/readapi.mjs` ->
//      bare `@earendil-works/pi-durable/...` load with `errors: []`? Measured on BOTH planes, together with
//      the registration's `commands` Map, its `sourceInfo.scope`, and a real call into its argument completion.
//   4. AN ACT THAT CLAIMS TOO MUCH. A session must never print "applied" for something nothing applied: the
//      only write path is the broker's spool, and with no live broker it is REFUSED before the write, by name.
//   5. D19 PER PLANE. The core returns strings plus a machine document; a pi session is a human, so TEXT is
//      the default and `--json` is the ask — observable here, decided never in the core.
//
// HERMETIC: rows are seeded IN-MEMORY through the core's own read seams, so the pi path opens no store at all,
// and the one real seam exercised is `queueManageSpool` over a path no broker owns (the refusal is the point).
// The subprocess in this file is the OTHER registration — the scripted verb whose bytes the pi plane must match
// — never the surface under test. The rig's own live store must not move by a byte for this gate to pass.
//
// Run: node demo/queue-pi-command.test.mjs   (exit 0 = pass)
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAgentDir, DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { createRealHost } from "../src/tui/durable/real-host.mjs";

import queueSurfaceExtension from "../tools/queue-surface-extension.js"; // tracked source; installed by tools/queue-surface-install.mjs
import {
  QUEUE_COMMAND_NAME,
  QUEUE_SURFACE_DESCRIPTION,
  queueSurfaceCompletion,
  queueSurfaceInvoke,
} from "../tools/queue-surface-core.mjs";
import { QUEUE_USAGE, queueRefusalText, queueCommandArgv, queueCommandCompletion } from "../src/queue-command.mjs";
import { MANAGE_INTENT_DIRS, queueManageSpool } from "../src/queue-manage.mjs";
import { QUEUE_VIEW_ROW_CAP } from "../src/readapi.mjs";

const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-queue-pi-"));
const storePath = join(dir, "no-broker.sqlite"); // never opened — the point is that a refusal precedes any write
const inbox = MANAGE_INTENT_DIRS.inbox(storePath);
const liveStore = join(ROOT, "selfdev.sqlite");
const statOf = (p) => (existsSync(p) ? statSync(p).mtimeMs : null);
const liveStoreBefore = statOf(liveStore);

let failures = 0;
const check = (label, ok, detail = "") => {
  if (ok) return;
  failures += 1;
  process.stdout.write(`FAIL ${label}: ${detail}\n`);
};
const spoolFiles = () => (existsSync(inbox) ? readdirSync(inbox).filter((f) => f.endsWith(".json")).length : 0);

const DAY = 86_400_000;
const NOW = Date.now();
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

console.log("=== 1. THE EXTENSION IS A REGISTRATION, NOT A SCRIPT ===");
const handlers = {};
const api = { registerCommand: (name, def) => { handlers["command:" + name] = def; } };
queueSurfaceExtension(api);
const command = handlers["command:" + QUEUE_COMMAND_NAME];
check("registers exactly one command, named by the core", Object.keys(handlers).length === 1 && !!command, `keys ${Object.keys(handlers).join(",")}`);
check("handler is a function (pi drops a registration without one)", typeof command?.handler === "function", `handler ${typeof command?.handler}`);
check("description is the core's, not a local sentence", command.description === QUEUE_SURFACE_DESCRIPTION, String(command.description).slice(0, 80));
const argCompletions = command.getArgumentCompletions("--li");
check("getArgumentCompletions answers from the grammar", Array.isArray(argCompletions) && argCompletions.length > 0, `--li -> ${JSON.stringify(argCompletions)}`);
check("the completion box is the CORE's function, byte-for-byte, on every prefix", ["", "--l", "--sort ", "--manage ", "--status ", "--dir ", "--fields ", "--zz"].every((prefix) => JSON.stringify(command.getArgumentCompletions(prefix) ?? null) === JSON.stringify(queueCommandCompletion(prefix) ?? null)), `prefixes checked 8`);
check("an unknown prefix offers nothing rather than everything", command.getArgumentCompletions("--zz") === null, `${command.getArgumentCompletions("--zz")}`);
check("the core's completion is what the registration delegates to", typeof queueSurfaceCompletion === "function" && JSON.stringify(queueSurfaceCompletion("--so") ?? null) === JSON.stringify(queueCommandCompletion("--so") ?? null), `--so -> ${JSON.stringify(queueSurfaceCompletion("--so"))}`);

console.log("\n=== 2. NO PROCESS, NO STORE, INSIDE THE PI PLANE ===");
const extSource = readFileSync(join(ROOT, "tools", "queue-surface-extension.js"), "utf8");
const coreSource = readFileSync(join(ROOT, "tools", "queue-surface-core.mjs"), "utf8");
const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
for (const forbidden of ["child_process", "spawn", "execSync", "exec(", "fork(", "cli.mjs "]) {
  check(`the pi registration contains NO ${forbidden} once comments are stripped`, !strip(extSource).includes(forbidden), "in-process is the point: a session imports the core, it does not shell out");
}
for (const forbidden of ["child_process", "spawn", "Harness.open", "openNodeSqliteStorage", "new MemoryStorage", "harness.commit", "tx.doc("]) {
  check(`the core contains NO ${forbidden} (it opens no store and starts no process)`, !strip(coreSource).includes(forbidden), "the backend-agnostic half");
}
check("the core DOES import the rig's grammar rather than restating it", coreSource.includes('from "../src/queue-command.mjs"') && extSource.includes("queue-surface-core.mjs"), "one edited table, one file");
check("neither file restates the flag table", !strip(coreSource).includes('"--sort"') && !strip(extSource).includes('"--sort"'), "the only table is src/queue-command.mjs's");

console.log("\n=== 3. THE LOADED MODULE, ON BOTH PLANES, ERRORS FREE ===");
// The chain under test: .pi/extensions/queue-surface.js --`../../tools/...`--> tools/queue-surface-core.mjs
// --`../src/...`--> src/readapi.mjs --bare specifier--> @earendil-works/pi-durable/*.
const t0 = Date.now();
const loader = new DefaultResourceLoader({ cwd: ROOT, agentDir: getAgentDir() });
await loader.reload();
const discovered = loader.getExtensions();
check("plane 1 (plain pi coding-agent, project auto-discovery) loads with NO errors", discovered.errors.length === 0, JSON.stringify(discovered.errors.map((e) => e.message ?? e)));
const rec = discovered.extensions.find((e) => String(e.path).endsWith(".pi/extensions/queue-surface.js"));
const cmdsOf = (r) => (r.commands instanceof Map ? [...r.commands.keys()] : r.commands ?? []);
check("the installed file is discovered", !!rec, `paths ${discovered.extensions.map((e) => e.path).join(",")}`);
check("its commands Map carries the core's command name", !!rec && cmdsOf(rec).includes(QUEUE_COMMAND_NAME), rec ? cmdsOf(rec).join(",") : "no record");
check("its scope is `project` (repo .pi/extensions, not the user's)", !!rec && (rec.sourceInfo?.scope ?? rec.scope) === "project", rec ? String(rec.sourceInfo?.scope ?? rec.scope) : "no record");
check("the discovered def carries a handler, so a session can run it", !!rec && typeof rec.commands?.get?.(QUEUE_COMMAND_NAME)?.handler === "function", rec ? typeof rec.commands?.get?.(QUEUE_COMMAND_NAME)?.handler : "no record");
check("the discovered def's description is the core's", !!rec && rec.commands?.get?.(QUEUE_COMMAND_NAME)?.description === QUEUE_SURFACE_DESCRIPTION, rec ? String(rec.commands?.get?.(QUEUE_COMMAND_NAME)?.description).slice(0, 60) : "no record");
check("the loaded module answers its OWN argument box (the core resolved through jiti)", (() => { const c = rec?.commands?.get?.(QUEUE_COMMAND_NAME)?.getArgumentCompletions?.("--so"); return Array.isArray(c) && c.length > 0 && c.every((x) => String(x.value).startsWith("--sort") || String(x.value).startsWith("--status")); })(), JSON.stringify(rec?.commands?.get?.(QUEUE_COMMAND_NAME)?.getArgumentCompletions?.("--so")));
check("adding /queue did not disturb the other project extension", discovered.extensions.filter((e) => String(e.path).startsWith(join(ROOT, ".pi/extensions"))).length >= 2, discovered.extensions.map((e) => e.path).join(","));
process.stdout.write(`  ok   plane 1: projectTrusted=${loader.settingsManager.isProjectTrusted()} errors=0 commands=${cmdsOf(rec).join(",")} scope=project\n`);

const host = await createRealHost({ cwd: ROOT });
const hostExts = host.hostSession.resourceLoader.getExtensions();
check("plane 2 (the durable-TUI host session) loads with NO errors", hostExts.errors.length === 0, JSON.stringify(hostExts.errors.map((e) => e.message ?? e)));
const hostRec = hostExts.extensions.find((e) => String(e.path).endsWith(".pi/extensions/queue-surface.js"));
check("plane 2 sees the SAME registration in the same scope", !!hostRec && cmdsOf(hostRec).includes(QUEUE_COMMAND_NAME) && (hostRec.sourceInfo?.scope ?? hostRec.scope) === "project", hostRec ? `${cmdsOf(hostRec).join(",")} ${(hostRec.sourceInfo?.scope ?? hostRec.scope)}` : "no record");
process.stdout.write(`  ok   plane 2: projectTrusted=${host.hostSession.resourceLoader.settingsManager.isProjectTrusted()} errors=0 commands=${hostRec ? cmdsOf(hostRec).join(",") : "-"} scope=project  both loaders ${((Date.now() - t0) / 1000).toFixed(2)}s\n`);
check("neither loader touched the rig's live store", statOf(liveStore) === liveStoreBefore, `selfdev.sqlite mtime ${liveStoreBefore} -> ${statOf(liveStore)}`);

// SEED ROWS IN-MEMORY through the core's own read seams — the pi path opens no store, and neither does its gate.
const rows = [
  { id: 4000, from: "pm", to: "impl", subject: "a plain queued row", body: "b".repeat(400), status: "queued", tier: "small", blockedBy: [], transitions: [{ event: "queued", at: iso(3), by: "pm", authority: "pm" }] },
  { id: 4001, from: "pm", to: "impl", subject: "a row being worked right now", body: "b".repeat(400), status: "claimed", tier: "feature", blockedBy: [], transitions: [{ event: "queued", at: iso(2), by: "pm", authority: "pm" }, { event: "claimed", at: iso(1), by: "impl", authority: "seat" }], priority: "now", prioritySet: { at: iso(1), by: "delegate", reason: "operator: land this first", expiresAt: iso(-2), authority: "delegate (operator-authorised)" } },
  { id: 4100, from: "pm", to: "impl", subject: "parked on the operator's answer", body: "b".repeat(400), status: "deferred", deferredTo: "operator", blockedBy: [], transitions: [{ event: "deferred", at: iso(4), by: "pm", authority: "pm" }] },
  { id: 4200, from: "pm", to: "impl", subject: "a finished row", body: "b".repeat(400), status: "done", blockedBy: [], transitions: [{ event: "queued", at: iso(9), by: "pm", authority: "pm" }, { event: "completed", at: iso(8), by: "impl", authority: "seat" }] },
  { id: 4300, from: "pm", to: "devtools", subject: "waiting on a live row", body: "b".repeat(400), status: "held", blockedBy: [4000], transitions: [{ event: "queued", at: iso(5), by: "pm", authority: "pm" }] },
];
let spoolCalls = 0;
const seams = {
  db: "in-memory://queue-pi-command",
  readQueue: async () => rows,
  // no `readCensus` seam on purpose: the core derives the census from the SAME rows the view prints, so a
  // session cannot print a count over rows it did not print.
  spool: (request, opts) => {
    spoolCalls += 1;
    // the REAL seam, pointed at a store no live broker owns.
    return queueManageSpool(storePath, request, { ...opts, requireBroker: true });
  },
};
const invoke = (text) => queueSurfaceInvoke(text, { seams });

console.log("\n=== 4. REFUSALS ARE BYTE-IDENTICAL ON BOTH PLANES (one grammar, two masks) ===");
const cli = (args) => {
  const r = spawnSync(process.execPath, ["cli.mjs", "queue", ...args], {
    cwd: ROOT,
    // A store that does not exist: a refusal that opened a store would fail here, so this doubles as proof
    // that an argument error costs the store NOTHING.
    env: { ...process.env, DURIG_DB: storePath, DURIG_PI_DB: storePath },
    encoding: "utf8",
    timeout: 120000,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const refusals = [
  ["--zork"],
  ["--manage", "park", "--id", "4000", "--reason", "x"],
  ["--reason", "x"],
  ["--list", "--sort", "zzz"],
  ["--limit", "0"],
  ["--manage", "cancel"],
  ["--list", "--with-gates"],
  ["--discuss", "a sentence with spaces", "--to", "pm", "--to", "impl"],
];
for (const args of refusals) {
  const text = args.map((a) => (/[\s"]/.test(a) ? `"${a}"` : a)).join(" ");
  const tok = queueCommandArgv(text);
  check(`one spelling of the request: argv ${JSON.stringify(args)} === tokenized ${JSON.stringify(text)}`, tok.ok && JSON.stringify(tok.argv) === JSON.stringify(args), `tokenized ${JSON.stringify(tok.argv)}`);
  const c = cli(args);
  const p = await invoke(text);
  const piBody = p.show.map((l) => l.body).join("");
  check(`the pi plane REFUSES ${args.join(" ")} (exit ${p.exitCode}, no rows shown)`, p.ok === false && p.exitCode === 1 && p.show.length >= 1, JSON.stringify(p.show).slice(0, 200));
  check(`and its correction is BYTE-IDENTICAL to the CLI's stderr`, piBody === c.stderr, `pi ${JSON.stringify(piBody).slice(0, 200)} vs cli ${JSON.stringify(c.stderr).slice(0, 200)}`);
  check(`that sentence is the core's: it names the flag table and the usage`, piBody.includes("known flags:") && piBody.includes(QUEUE_USAGE), piBody.slice(0, 160));
  check(`the CLI cost the store nothing on the way to that refusal`, c.code === 1 && !existsSync(storePath), `code ${c.code} store exists ${existsSync(storePath)}`);
  check(`and the pi plane never reached the act's seam on an argument error`, spoolCalls === 0, `spoolCalls ${spoolCalls}`);
}
const quote = await invoke('--reason "unterminated');
check("an unterminated quote is refused, not swallowed", quote.ok === false && quote.exitCode === 1 && quote.show[0].level === "error", JSON.stringify(quote.show).slice(0, 200));
check("and it names the fix in the rig's own words", quote.show[0].body.includes("unterminated quote") && quote.show[0].body.includes("--reason sentence needs both quotes"), quote.show[0].body.slice(0, 200));
check("a pi-only refusal still carries the same flag table, so a session can correct itself", quote.show[0].body.includes("known flags:") && quote.show[0].body.includes(QUEUE_USAGE), quote.show[0].body.slice(0, 160));

console.log("\n=== 5. THE VIEW: TEXT IS THE SESSION'S DEFAULT, `--json` IS THE ASK (D19 per plane) ===");
const plain = await invoke("--list --sort priority --limit 3");
const shown = plain.show.map((l) => l.body).join("");
check("--list answers with the human view, not a JSON document", plain.ok && shown.length > 0 && !shown.startsWith("{"), shown.slice(0, 160));
check("the header names the sort the view used", shown.includes("priority") && /sort/i.test(shown), shown.slice(0, 300));
check("rows are attributed (seat and status in the row)", shown.includes("impl") && shown.includes("queued"), shown.slice(0, 400));
check("a terminal row is dropped, not silently missing", plain.run.json.items.every((it) => String(it.id) !== "4200") && plain.run.json.header.droppedTerminal >= 1, `dropped ${plain.run.json?.header?.droppedTerminal} store ${plain.run.json?.header?.storeRows}`);
check("rows carry NO bodies, which is part of why 200 fit", plain.run.json.items.every((it) => !("body" in it)), `row keys ${JSON.stringify(Object.keys(plain.run.json.items[0] ?? {}))}`);
check("the bound is the rig's own cap and the ask honours it", plain.run.json.items.length <= 3 && plain.run.json.items.length <= QUEUE_VIEW_ROW_CAP, `shown ${plain.run.json.items.length} cap ${QUEUE_VIEW_ROW_CAP}`);
check("the census counts over the store, the view prints a slice, and both say so", plain.run.json.rows === rows.length && plain.run.json.items.length <= plain.run.json.rows, `census ${plain.run.json.rows} shown ${plain.run.json.items.length}`);
const asked = await invoke("--list --json --sort age");
let askedDoc = null;
try { askedDoc = JSON.parse(asked.show[0].body); } catch {
  /* not a document — the check below reports it */
}
check("`--json` on a session is the ask that answers with ONE machine document", askedDoc?.command === "queue" && askedDoc?.view === "list", asked.show[0].body.slice(0, 120));
check("and the document is the core's own (same `header`, same `items` as the text view)", askedDoc?.items?.length === asked.run.json?.items?.length && JSON.stringify(askedDoc?.header) === JSON.stringify(asked.run.json?.header), `items ${askedDoc?.items?.length}`);
check("and the level carries the truth: ok is info, a refusal is not", plain.show.every((l) => l.level === "info") && quote.show.every((l) => l.level === "error"), `levels ${plain.show.map((l) => l.level).join(",")} / ${quote.show.map((l) => l.level).join(",")}`);

console.log("\n=== 6. AN ACT: PROPOSE WRITES NOTHING, APPLY IS THE BROKER'S SPOOL OR A REFUSAL ===");
const propose = await invoke('--manage cancel --id 4000 --reason "prerequisite abandoned"');
const ptext = propose.show.map((l) => l.body).join("");
check("a row-scoped cancel PROPOSES and the register says so in words", propose.ok && ptext.includes("NOTHING WAS WRITTEN"), ptext.slice(0, 300));
check("the propose reached no spool", spoolCalls === 0, `spoolCalls ${spoolCalls}`);
check("and no spool file exists on the store it was pointed at", spoolFiles() === 0, `spool files ${spoolFiles()}`);
check("the change register attributes the actor", ptext.includes("delegate"), ptext.slice(0, 400));
check("the propose is machine-checkable too: mode is `propose`, note says nothing written", propose.run.json?.mode === "propose" && propose.run.json?.note === "propose — nothing written", JSON.stringify(propose.run.json).slice(0, 300));
const apply = await invoke('--manage cancel --id 4000 --reason "prerequisite abandoned" --apply');
const atext = apply.show.map((l) => l.body).join("");
check("--apply with NO live broker is REFUSED, not reported as applied", apply.ok === false && apply.exitCode === 1, JSON.stringify(apply.run.json).slice(0, 300));
check("by name, with the rig's own code", atext.includes("no-live-broker") && apply.run.json?.code === "no-live-broker", `${atext.slice(0, 300)} ${JSON.stringify(apply.run.json).slice(0, 200)}`);
check("and NOTHING was written on the way to that refusal", spoolFiles() === 0, `spool files ${spoolFiles()}`);
const handoff = await invoke('--discuss "land this first; split it if it does not fit" --to impl --id 4001');
const htext = handoff.show.map((l) => l.body).join("");
check("a hand-off PROPOSES a sentence naming the row and the seat", handoff.ok && htext.includes("#4001") && htext.includes("impl"), htext.slice(0, 300));
check("and declares no queue action of its own", JSON.stringify(handoff.run.json?.queueActions) === "[]", JSON.stringify(handoff.run.json?.queueActions));
check("the hand-off also wrote nothing (a propose needs no broker)", spoolFiles() === 0, `spool files ${spoolFiles()}`);
const form = await invoke("--human");
check("a form the core does not offer is NAMED as the scripted verb's, not half-rendered", form.ok === false && form.show[0].body.includes("cli.mjs queue") && form.show[0].body.includes("Nothing about the queue was read or changed"), form.show[0].body.slice(0, 300));
check("which means inventing no second row view: the pin's rows do not appear in it", !form.show[0].body.includes("#4000"), form.show[0].body.slice(0, 300));
const lease = await invoke(`--manage priority --id 4000 --priority now --reason "operator: this is what to land" --until "${iso(-1)}"`);
check("a property edit PROPOSES with the expiry the caller gave", lease.ok && lease.run.json?.mode === "propose" && JSON.stringify(lease.run.json?.lease ?? {}).includes(iso(-1).slice(0, 19)), JSON.stringify(lease.run.json).slice(0, 400));

rmSync(dir, { recursive: true, force: true });
const secs = ((Date.now() - t0) / 1000).toFixed(2);
if (failures === 0) {
  console.log(`\nQUEUE-PI-COMMAND PASS (${secs}s total; both loaders ${(((Date.now() - t0) / 1000)).toFixed(2)}s) — ONE core, TWO registrations: the pi /queue refuses the same ${refusals.length + 1} argument classes with BYTE-IDENTICAL correction bytes to \`cli.mjs queue\`, the loaded module answers with the core's completion vocabulary and scope=project on BOTH planes (errors 0), it starts no process and opens no store, TEXT is the session's default with \`--json\` as the ask, a propose writes nothing and an apply without a live broker is refused BEFORE the write (${spoolCalls} spool call(s), ${spoolFiles()} spool file(s)), and the rig's live store did not move (mtime ${liveStoreBefore} unchanged)`);
  process.exit(0);
}
console.log(`${failures} FAILURE(S)`);
process.exit(1);
