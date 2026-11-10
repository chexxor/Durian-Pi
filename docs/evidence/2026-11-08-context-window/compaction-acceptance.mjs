// .spike/compaction-acceptance.mjs — the N18 acceptance measurement (ROADMAP 331:
// "truncated summaries drop to zero over 100 compactions").
//
// WHY this exists: the milestone gate counts NATURAL compactions in the live store, and only 1 has
// happened since the continuity extension was armed. 100 natural seat compactions cannot happen in one
// session, so this driver drives 100 compactions on a SNAPSHOT COPY of the live store and counts the
// outcomes the harness actually wrote. The live store is never opened for write.
//
// Tranches (no key, no network, no spend):
//   --mode armed   extensions/continuity.mjs installed: beforeCompact supplies the summary, so pi-durable
//                  never builds a summariser request (dist/harness/compaction.js:82-89 -> place() :374).
//   --mode control no extension: the harness's own summariser runs against a faux provider whose reply is
//                  canned. --stopReason length reproduces the harness's own truncation branch
//                  (dist/harness/compaction.js:303) so the instrument is proven able to count a non-zero.
//
// Run: node docs/evidence/2026-11-08-context-window/compaction-acceptance.mjs --target 100
//      node docs/evidence/2026-11-08-context-window/compaction-acceptance.mjs --target 12 --mode control --stopReason length
//
// PROVENANCE: written in gitignored `.spike/` during the 2026-11-09/10 delegate session and preserved here
// so the measurement survives the next session (queue rows #6128/#6131 ask devtools to promote it into
// `tools/`; an unpromoted probe in `.spike/` is deleted with the scratch). Read-only against the live store:
// the snapshot is made with SQLite's own backup API.
// Exit 0 when the armed tranche placed >= target compactions with 0 truncated summaries, or when the
// control tranche reproduced the truncation it is meant to reproduce.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import { CompactionEntry, configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
const HERE = fileURLToPath(import.meta.url);
// Walk up to the repository root so the instrument runs from any depth (docs/evidence/... or tools/).
let ROOT = dirname(HERE);
while (!existsSync(join(ROOT, "package.json")) && ROOT !== "/") ROOT = dirname(ROOT);
// Root-relative dynamic imports: a static `../src/...` only resolves from one directory depth.
const { loadExtensions } = await import(pathToFileURL(join(ROOT, "src", "extensions.mjs")).href);
const { Router } = await import(pathToFileURL(join(ROOT, "src", "rig.mjs")).href);
const ctx = BACKGROUND_CONTEXT;

const args = process.argv.slice(2);
const arg = (name, dflt) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 ? args[i + 1] : dflt;
};
const TARGET = Number(arg("target", "100"));
const MODE = arg("mode", "armed");
const STOP_REASON = arg("stopReason", "stop");
const LIVE_DB = resolve(arg("db", join(ROOT, "selfdev.sqlite"))); // an absolute --db is used as given
const COPY_DIR = resolve(arg("copyDir", join(ROOT, ".spike", "acceptance")));
const COPY_DB = join(COPY_DIR, "acceptance-snapshot.sqlite");

const t0 = Date.now();
const secs = () => ((Date.now() - t0) / 1000).toFixed(1);

/* ---- 1. snapshot: the live store is read through SQLite's own backup API, never opened for write ---- */
mkdirSync(COPY_DIR, { recursive: true });
execFileSync("python3", ["-c", `
import sqlite3
src = sqlite3.connect(${JSON.stringify(LIVE_DB)})
dst = sqlite3.connect(${JSON.stringify(COPY_DB)})
src.backup(dst)
dst.close(); src.close()
`]);
console.log(`snapshot -> ${COPY_DB} (${secs()} s). The live store was never opened for write.`);
// max(id) is NULL on an empty store, and `id > NULL` matches nothing in SQLite: a snapshot taken from a
// store with no entries would then count zero summaries placed and still report "0 truncated" - a green
// that measured nothing. Coerce to 0 so the tranche's own entries are counted.
const baseline = new DatabaseSync(COPY_DB, { readOnly: true }).prepare("select max(id) m from entries").get().m ?? 0;

/* ---- 2. the seat compaction policy, read from the rig's own config ---- */
// `durig.config.json` is the operator's local config and is gitignored: a scratch worktree (the landing
// gate runs the suite in one) has only `durig.config.default.json`. Fall back rather than crash, and say
// which file the policy came from so the number can be attributed to a tree.
const CONFIG_FILE = existsSync(join(ROOT, "durig.config.json")) ? "durig.config.json" : "durig.config.default.json";
const cfg = JSON.parse(execFileSync("node", ["-e", "process.stdout.write(require('fs').readFileSync(process.argv[1],'utf8'))", join(ROOT, CONFIG_FILE)], { encoding: "utf8" }));
const overrides = cfg.DURIG_COMPACTION_MODEL_OVERRIDES ?? {};
const localPolicy = overrides["local/*"] ?? {};
const SETTINGS = {
	compaction: {
		enabled: true,
		reserveTokens: Number(localPolicy.reserveTokens ?? 16384),
		keepRecentTokens: Number(localPolicy.keepRecentTokens ?? 20000),
		backgroundTokens: Number(localPolicy.backgroundTokens ?? 32768),
	},
};
console.log(`policy used: ${JSON.stringify(SETTINGS.compaction)} (from ${CONFIG_FILE}; pi-durable defaults 16384/20000/32768)`);

/* ---- 3. open the copy; arm or not arm the extension ---- */
const storage = await openNodeSqliteStorage(COPY_DB);
const rosterRec = await storage.findDocument({ kind: "durig.seats", scope: { kind: "session" } }, "current", ctx);
const roster = rosterRec ? (await storage.document(rosterRec.id, "current", ctx))?.value?.seats ?? {} : {};
const seatNames = Object.keys(roster);
console.log(`seats in the snapshot roster: ${seatNames.length}`);

const faux = fauxProvider({ models: [{ id: "faux-seat", contextWindow: 204800 }] });
const models = createModels();
models.setProvider(faux.provider);

const registry = createRegistry();
registry.install(Router);
if (MODE === "armed") {
	const loaded = await loadExtensions(["extensions/continuity.mjs"], { cwd: ROOT });
	if (!loaded[0]?.extension) {
		console.error("FAIL: the continuity extension did not load");
		process.exit(1);
	}
	registry.install(loaded[0].extension);
	console.log(`extension installed: ${loaded[0].name}`);
} else {
	console.log(`control tranche: no extension; summariser reply stopReason=${STOP_REASON}`);
}

const harness = await Harness.open(storage, { models, registry, settings: SETTINGS }, ctx);

/* A snapshot taken while the broker has a seat mid-turn contains unsettled tasks. Unbounded waits on
 * those hang the run (exit 13: unsettled top-level await, measured 2026-11-10), so every wait here is
 * bounded and the unsettled ones are counted rather than trusted. */
const WAIT_BOUND_MS = Number(arg("waitBoundMs", "20000"));
const bounded = (p, label) => Promise.race([
	p,
	new Promise((res) => setTimeout(() => res({ __timeout: true, label }), WAIT_BOUND_MS)),
]);

// +1 slack per seat: a snapshot taken while the broker is live can carry a conversation with an
// in-flight task, and that seat's submits park. Slack lets the tranche still reach the target.
const PER_SEAT = Math.ceil(TARGET / Math.max(1, seatNames.length)) + 1;
let attempted = 0;
let growthTurns = 0;
let unsettled = 0;
const samples = [];

for (const seat of seatNames) {
	const convId = roster[seat]?.conversationId;
	if (convId == null) continue;
	const conv = await harness.conversation(convId, ctx);
	await harness.commit(async (tx) => {
		await configure(tx, convId, { model: { provider: "faux", modelId: "faux-seat" } });
	}, ctx);
	for (let i = 0; i < PER_SEAT && attempted < TARGET; i++) {
		attempted += 1;
		// Grow the visible context so a cut exists, then compact. One faux reply per provider request:
		// the growth turn, and (control only) the summariser request.
		faux.setResponses([
			fauxAssistantMessage(fauxText(`growth ${growthTurns++}`)),
			...(MODE === "control" ? [fauxAssistantMessage(fauxText("summarised the cut turns"), { stopReason: STOP_REASON })] : []),
		]);
		let run = null;
		for (let retry = 0; retry < 2; retry++) {
			run = await bounded((await conv.submit({ type: "input", content: `acceptance growth turn ${attempted} ${"x".repeat(4000)}` }, ctx)).wait(ctx), "growth turn");
			if (!run.__timeout && run.status === "done") break;
		}
		if (run.__timeout) {
			samples.push(`seat ${seat}: growth turn did not settle within ${WAIT_BOUND_MS} ms (skipped, retried 2x)`);
			attempted -= 1;
			continue;
		}
		if (run.status !== "done") {
			samples.push(`seat ${seat}: growth turn did not settle (${run.status})`);
			attempted -= 1;
			break;
		}
		const taskId = await conv.compact("N18 acceptance tranche", ctx);
		const settled = await bounded(harness.waitForTask(taskId, ctx), "compaction task");
		if (settled.__timeout) unsettled += 1;
		if (samples.length < 3) samples.push(`${seat}: ${JSON.stringify(settled?.state?.outcome ?? settled).slice(0, 160)}`);
		if (attempted % 25 === 0) console.log(`  ${attempted} compactions attempted, ${secs()} s`);
	}
	if (attempted >= TARGET) break;
}
await harness.close(ctx);

/* ---- 4. count what the store actually recorded, the same way the milestone gate counts it ---- */
const s = new DatabaseSync(COPY_DB, { readOnly: true });
const during = s.prepare(
	"select count(*) n, sum(record like ?) truncated, sum(record like ?) completed from tasks where kind=? and json_extract(record,'$.startedAt') >= ?",
).get("%hit the token limit%", "%\"status\":\"completed\"%", '"pi.compaction"', t0);
const getEntry = s.prepare("select record from entries where id=?");
const placedSummaries = s.prepare("select id, record from entries where id > ? and record like ?").all(baseline, "%was compacted into the following summary%");
const notePath = placedSummaries.filter((e) => String(e.record).includes("CONTINUITY NOTE")).length;
const digestPath = placedSummaries.filter((e) => String(e.record).includes("Deterministic digest of")).length;
s.close();

console.log(`\nRESULT mode=${MODE} target=${TARGET} providerCalls(faux)=${faux.state.callCount}`);
console.log(`  provider calls in the tranche: ${faux.state.callCount} (= ${attempted} growth turns + ${faux.state.callCount - attempted} summariser requests)`);
console.log(`  summary markers placed in this tranche: ${placedSummaries.length} (note-backed ${notePath}, digest-backed ${digestPath})`);
console.log(`  completed outcomes: ${during.completed ?? 0}`);
console.log(`  compaction tasks that did not settle within ${WAIT_BOUND_MS} ms: ${unsettled}`);
console.log(`  TRUNCATED summaries ("hit the token limit"): ${during.truncated ?? 0}`);
console.log(`  wall clock: ${secs()} s`);
for (const sample of samples) console.log(`  sample: ${sample}`);
const truncated = during.truncated ?? 0;
const ok = MODE === "armed" ? during.n >= TARGET && truncated === 0 : truncated > 0;
console.log(`VERDICT ${ok ? "PASS" : "FAIL"}`);
process.exit(ok ? 0 : 1);
