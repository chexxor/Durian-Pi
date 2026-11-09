#!/usr/bin/env node
// MILESTONE GATE — "does a seat's task fit inside its context window, and if not, does it have a note to
// resume from?" (D226 / ROADMAP 331, continuity leg added 2026-11-09)
// One command, no model spend, broker-down safe. Exit 0 = the MECHANISM is sound (the override reaches the harness
// and the note path is the one compaction takes); exit 1 = it is not, with the reason. Operational blockers can
// sit at exit 0 and still mean the milestone is not met: they are grants or a running broker the operator holds,
// not defects - the milestone's outcome (ROADMAP 331: "truncated summaries drop to zero over 100 compactions")
// is only measurable when real seats run, so read the blocker list before calling the milestone closed.
// usage: node docs/evidence/2026-11-08-context-window/milestone-check.mjs [--db ./selfdev.sqlite]
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let ROOT = dirname(fileURLToPath(import.meta.url));
while (!existsSync(join(ROOT, "src", "config.mjs")) && ROOT !== "/") ROOT = dirname(ROOT);
const cfg = await import(pathToFileURL(join(ROOT, "src", "config.mjs")).href);
const dur = await import(pathToFileURL(join(ROOT, "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "agent.js")).href);
const comp = await import(pathToFileURL(join(ROOT, "node_modules", "@earendil-works", "pi-durable", "dist", "harness", "compaction.js")).href);

const { DatabaseSync } = await import("node:sqlite");
// Accept BOTH `--db path` and `--db=path`. A gate whose flag is silently ignored falls back to the live store
// and reports numbers for a rig the operator never asked about - the accepted-and-ignored class (#5071).
const dbFlag = (() => {
  const i = process.argv.indexOf("--db");
  if (i >= 0 && process.argv[i + 1]) return process.argv[i + 1];
  return process.argv.find((a) => a.startsWith("--db="))?.split("=")[1];
})();
const DB = dbFlag || process.env.DURIG_DB || join(ROOT, "selfdev.sqlite");

const readFile = (p, e) => readFileSync(p, e);
const shipped = await cfg.loadShippedDefaults({ readFile, anchors: [join(ROOT, "durig.config.default.json")] });
const { config, source } = await cfg.loadConfig({ env: process.env, readFile, defaults: shipped.values, defaultsSource: shipped.source });
const settings = cfg.compactionSettings(config);

const failures = [];
// An operational blocker is not a defect in the mechanism: it is a grant or a running broker the operator
// holds. Separating them is what makes the gate usable - a wall of red over a mechanism that is finished
// reads the same as a mechanism that is broken.
const blockers = [];
// Advisory: a risk signal the instrument cannot prove without a real provider. Not a verdict.
const advisory = [];
const seen = new Set();
console.log("== ROADMAP 331: does the configured override reach the harness? ==");
console.log(`  store under inspection: ${DB}`);
console.log(`  config source: ${source}`);
console.log(`  compactionSettings() -> ${JSON.stringify(settings)}`);
if (settings.compaction === undefined) {
  failures.push("DURIG_COMPACTION_MODEL_OVERRIDES is emitted as `modelOverrides`, a sibling of the `compaction` key the harness reads; settings.compaction is undefined, so pi-durable's defaults apply.");
}
const stored = { compaction: { ...dur.DEFAULT_COMPACTION_POLICY, ...settings.compaction } };
const rigPath = join(ROOT, "rig.selfdev.json");
const rig = JSON.parse(readFileSync(rigPath, "utf8"));
const windows = {};
for (const seat of rig.seats ?? []) {
  // Resolve the seat model exactly as src/seatmodel.mjs:17-19 does: provider = up to the first slash,
  // modelId = the rest. The naive split read "verifier/openai/gpt-oss-120b" as model "openai", so this gate
  // looked up an override key that pi-durable can never match - a gate that mis-keys is a gate that lies.
  const modelString = String(seat.model ?? "");
  const slash = modelString.indexOf("/");
  const provider = slash > 0 ? modelString.slice(0, slash) : modelString;
  const modelId = slash > 0 ? modelString.slice(slash + 1) : modelString;
  const key = `${provider}/${modelId}`;
  windows[key] = cfg.declaredContextWindow(config, key) ?? windows[key];
  const p = comp.compactionPolicy(stored, { provider, modelId });
  console.log(`  ${key}: reserve=${p.reserveTokens} keepRecent=${p.keepRecentTokens} enabled=${p.enabled}`);
  if (key === "local/qwen3.8-flash-next-q2_0" && p.reserveTokens !== 20480 && !seen.has(key)) {
    seen.add(key);
    failures.push(`local family resolves reserve=${p.reserveTokens}, the config asks for 20480 — the override is being dropped.`);
  }
}

console.log("== per-window feasibility ==");
for (const [key, w] of Object.entries(windows)) {
  const family = key.startsWith("verifier/") ? "VERIFIER" : "LOCAL";
  const declared = w ?? Number(config[`DURIG_${family}_CONTEXT`] ?? 0);
  if (!declared) { console.log(`  ${key}: window not declared — cannot check`); continue; }
  const p = comp.compactionPolicy(stored, { provider: key.slice(0, key.indexOf("/")), modelId: key.slice(key.indexOf("/") + 1) });
  const headroom = declared - p.reserveTokens;
  const pct = (100 * p.keepRecentTokens / headroom).toFixed(0);
  // The floor a compaction can never get below: the kept recent turns plus the summary the harness
  // caps at min(floor(0.8 * reserveTokens), model.maxTokens). Verified in the pinned dist:
  // generation.js:238-243 (trigger at contextWindow - reserveTokens) and compaction.js:95 (the cap).
  const maxTokens = Number(config[family === "VERIFIER" ? "DURIG_VERIFIER_MAX_TOKENS" : "DURIG_LOCAL_MAX_TOKENS"] ?? Number.POSITIVE_INFINITY);
  const summaryCap = Math.min(Math.floor(0.8 * p.reserveTokens), Number.isFinite(maxTokens) ? maxTokens : Number.POSITIVE_INFINITY);
  const floor = p.keepRecentTokens + summaryCap;
  console.log(`  ${key}: window=${declared} headroom=${headroom} keepRecent=${p.keepRecentTokens} = ${pct}% of headroom`);
  console.log(`    post-compaction floor: ${p.keepRecentTokens} kept + ${summaryCap} summary cap = ${floor} tokens vs a ${declared} window (${floor > declared ? "FLOOR IS ABOVE THE WINDOW - compaction can never fit it" : `${Math.round(100 * floor / declared)}% of the window`})`);
  if (floor > declared) failures.push(`${key}: a compaction can never bring this seat under its window - keeping ${p.keepRecentTokens} recent tokens plus the ${summaryCap}-token summary floor is ${floor - declared} tokens above the declared ${declared}.`);
  if (p.keepRecentTokens > headroom) failures.push(`${key}: keepRecentTokens (${p.keepRecentTokens}) exceeds the headroom of a ${declared}-token window (${headroom}); any compaction attempt on this seat is guaranteed to truncate.`);
}

console.log("== observed failures in the store ==");
if (existsSync(DB)) {
  const db = new DatabaseSync(DB, { readOnly: true });
  const total = db.prepare("select count(*) n from tasks where kind=?").get('"pi.compaction"').n;
  const failed = db.prepare("select count(*) n from tasks where kind=? and json_extract(record,'$.state.outcome.status')='failed'").get('"pi.compaction"').n;
  const trunc = db.prepare("select count(*) n from tasks where kind=? and record like ?").get('"pi.compaction"', "%hit the token limit%").n;
  const cap = db.prepare("select count(*) n from tasks where kind=? and record like ?").get('"pi.compaction"', "%spend_cap_exceeded%").n;
  console.log(`  pi.compaction rows: ${total}; failed ${failed}; truncated summaries ${trunc}; refused by the run cap ${cap}`);
  if (trunc > 0) blockers.push(`${trunc} compaction attempts produced an incomplete summary — the window is too small for the policy.`);
  if (cap > 0) blockers.push(`${cap} compaction attempts were refused by DURIG_SPEND_CAP_RUN_USD before any request was sent — the summariser is starved by the rig's own budget.`);
  const since = Date.now() - 60 * 60000;
  const now = db.prepare("select count(*) n from tasks where kind=? and json_extract(record,'$.startedAt')>=?").get('"pi.compaction"', since).n;
  const nowFail = db.prepare("select count(*) n from tasks where kind=? and json_extract(record,'$.startedAt')>=? and record like ?").get('"pi.compaction"', since, "%hit the token limit%").n;
  console.log(`  last 60 min: ${now} compactions, ${nowFail} truncated`);
  const day = Date.now() - 24 * 3600000;
  const age = (pat) => db.prepare("select count(*) n, min(json_extract(record,'$.startedAt')) mn, max(json_extract(record,'$.startedAt')) mx from tasks where kind=? and record like ?").get('"pi.compaction"', pat);
  const truncAll = age("%hit the token limit%");
  const capAll = age("%spend_cap_exceeded%");
  const trunc24 = db.prepare("select count(*) n from tasks where kind=? and record like ? and json_extract(record,'$.startedAt')>=?").get('"pi.compaction"', "%hit the token limit%", day).n;
  const cap24 = db.prepare("select count(*) n from tasks where kind=? and record like ? and json_extract(record,'$.startedAt')>=?").get('"pi.compaction"', "%spend_cap_exceeded%", day).n;
  const split = db.prepare("select conversation_id, sum(record like ?) cap, sum(record like ?) trunc from tasks where kind=? group by 1 order by (cap+trunc) desc limit 6").all("%spend_cap_exceeded%", "%hit the token limit%", '"pi.compaction"');
  console.log("  by conversation (cap refusals | truncations):");
  for (const s of split) console.log(`    conv ${s.conversation_id}: ${s.cap} | ${s.trunc}`);
  const localTrunc = split.filter((s) => s.trunc > 0 && s.cap === 0).reduce((a, s) => a + s.trunc, 0);
  if (localTrunc > 0) blockers.push(`${localTrunc} truncations on seats with no cap refusals — their summary ceiling (0.8 x reserveTokens) is the binding constraint, not the budget.`);
  console.log(`  truncations: ${truncAll.n} lifetime, first ${new Date(truncAll.mn).toISOString()}, last ${new Date(truncAll.mx).toISOString()}; ${trunc24} in the last 24 h`);
  console.log(`  cap refusals: ${capAll.n} lifetime, first ${new Date(capAll.mn).toISOString()}, last ${new Date(capAll.mx).toISOString()}; ${cap24} in the last 24 h`);
  if (trunc24 > 0) blockers.push(`${trunc24} truncated summaries in the last 24 h — the window/policy mismatch is still live, not historical.`);
  db.close();
} else {
  console.log(`  no store at ${DB} — skipped (pass --db)`);
}

/* ---- and the other blocker: a seat whose turn SHAPE is refused before any window is reached ---- */
console.log("== run-cap headroom for the summariser (the budget that starves compaction) ==");
try {
  const defaults = JSON.parse(readFileSync(join(ROOT, "durig.config.default.json"), "utf8"));
  const capRun = Number(cfg.resolveConfig?.()?.DURIG_SPEND_CAP_RUN_USD ?? defaults.DURIG_SPEND_CAP_RUN_USD);
  const logPath = `${DB}.broker.log`;
  const lines = existsSync(logPath) ? readFileSync(logPath, "utf8").split("\n") : [];
  const start = lines.filter((l) => l.includes(" START pid=")).pop();
  const ledgerPath = join(ROOT, "selfdev.sqlite.spend.jsonl");
  if (start && existsSync(ledgerPath)) {
    const at = start.slice(0, 24);
    const rows = readFileSync(ledgerPath, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const spent = rows.filter((r) => r.at >= at).reduce((a, r) => a + (r.usd || 0), 0);
    const costs = rows.filter((r) => r.model === "openai/gpt-oss-120b").slice(-50).map((r) => r.usd || 0).filter((v) => v > 0);
    const mean = costs.length ? costs.reduce((a, v) => a + v, 0) / costs.length : 0.001384;
    const headroom = Math.max(0, Math.floor((capRun - spent) / mean));
    console.log(`  broker process since ${start.trim()}: spent $${spent.toFixed(6)} of the $${capRun} run cap; mean verifier call $${mean.toFixed(6)}`);
    console.log(`  summariser calls this process can still afford before EVERY compaction is refused: ~${headroom} (optimistic, at mean call cost)`);
    // conservative: use the actual projected summariser cost recorded in the refusal messages
    let proj = [];
    if (existsSync(DB)) {
      const s = new DatabaseSync(DB, { readOnly: true });
      proj = s.prepare("select record from tasks where kind=? and record like ? order by id desc limit 20").all('"pi.compaction"', "%spend_cap_exceeded%").map((r) => Number(/projects \$([0-9.]+)/.exec(r.record)?.[1] ?? 0)).filter((v) => v > 0);
      s.close();
    }
    if (proj.length) {
      const worst = Math.max(...proj);
      console.log(`  conservative: refusals projected summariser calls at $${Math.min(...proj).toFixed(6)}–$${worst.toFixed(6)}; at $${worst.toFixed(6)} this process has ~${Math.max(0, Math.floor((capRun - spent) / worst))} compactions left before every one is refused`);
    }
    if (capRun - spent < mean * 5) blockers.push("the resident broker is within 5 summariser calls of its run cap: compaction will be refused before any seat finishes its task.");
  } else {
    console.log("  no spend ledger or START line — headroom unmeasurable");
  }
} catch (e) { console.log(`  headroom probe failed: ${e.message}`); }

console.log("== turn shape (tools/seat-turn-shape.mjs, read-only) ==");
try {
  const out = execFileSync(process.execPath, ["tools/seat-turn-shape.mjs", "--db", DB], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "ignore"] });
  const seats = out.split("\n").filter((l) => l.startsWith("seat "));
  const risk = [];
  // pair each seat line with the "next send:" line that follows it
  const lines = out.split("\n");
  let current = null;
  for (const l of lines) {
    if (l.startsWith("seat ")) current = l.trim();
    if (l.includes("next send:") && current) {
      const v = l.split("next send:")[1].trim();
      if (v.startsWith("AT RISK")) risk.push(current.split("  ")[0]);
      current = null;
    }
  }
  console.log(`  ${risk.length} of ${seats.length} seats cannot be spoken to right now: ${risk.join(", ") || "none"}`);
  if (risk.length > 0) advisory.push(`${risk.length} seats are AT RISK on turn shape — a strict alternating template refuses a user turn before any window limit, so no window sizing can make them complete work.`);
} catch (e) {
  console.log(`  shape probe failed: ${e.message}`);
  failures.push("the shape instrument could not run, so the fleet's ability to be woken is unverified.");
}

console.log("== broker progress leg: alive vs healthy (src/broker.mjs:1628-1631, BROKER_HEARTBEAT_MS 20000) ==");
try {
  const stPath = `${DB}.broker.json`;
  if (!existsSync(stPath)) { console.log("  no broker state file — no resident broker"); }
  else {
    const st = JSON.parse(readFileSync(stPath, "utf8"));
    const hbAge = Math.round((Date.now() - st.heartbeatAt) / 1000);
    const passAge = Math.round((Date.now() - st.lastPassAt) / 1000);
    const inbox = existsSync(`${DB}.broker.inbox`) ? readdirSync(`${DB}.broker.inbox`).length : 0;
    const dead = existsSync(`${DB}.broker.inbox.error`) ? readdirSync(`${DB}.broker.inbox.error`).length : 0;
    let open = -1;
    if (existsSync(DB)) {
      const s = new DatabaseSync(DB, { readOnly: true });
      open = s.prepare("select count(*) n from tasks where json_extract(record,'$.state.status') != 'terminal'").get().n;
      s.close();
    }
    console.log(`  pid ${st.pid} since ${st.since}: heartbeat ${hbAge}s ago, last COMPLETED pass ${passAge}s ago (${new Date(st.lastPassAt).toISOString()})`);
    console.log(`  spool: ${inbox} pending intent(s), ${dead} dead letter(s); ${open} task(s) still in flight in the store`);
    if (dead) {
      const dir = `${DB}.broker.inbox.error`;
      const reasons = readdirSync(dir).filter((f) => f.endsWith(".reason")).map((f) => readFileSync(join(dir, f), "utf8").trim());
      const group = {};
      for (const r of reasons) group[r] = (group[r] || 0) + 1;
      const ops = readdirSync(dir).filter((f) => !f.endsWith(".reason")).map((f) => { try { return JSON.parse(readFileSync(join(dir, f), "utf8")).op; } catch { return "unknown"; } });
      const opGroup = {};
      for (const o of ops) opGroup[o] = (opGroup[o] || 0) + 1;
      console.log(`  dead letters by reason: ${Object.entries(group).map(([k, v]) => `${v} × ${k}`).join(" | ")}`);
      console.log(`  dead letters by op: ${Object.entries(opGroup).map(([k, v]) => `${k} ${v}`).join(" | ")}`);
      if (opGroup.read) advisory.push(`${opGroup.read} read intents were dead-lettered with "apply failed: SqliteStorage is closed" (pi-durable storage.js:670) — that is why cli.mjs status/queue print nothing and time out: the read is dead-lettered, so the CLI waits its whole cap for a result that will never arrive.`);
    }
    if (hbAge <= 2 * 20 && passAge > 120) {
      console.log("  verdict: WEDGED — the event loop is turning but the progress leg is frozen; only a pass drains the spool (src/broker.mjs:1698). “Busy” is ruled out only if the in-flight count is small and refreshes.");
      blockers.push(`the resident broker has not completed a pass in ${Math.round(passAge / 60)} minutes, so no intent, claim or wake can be routed — the milestone cannot advance while it is wedged.`);
    } else if (passAge <= 120) {
      console.log("  verdict: HEALTHY — passes are advancing.");
    } else {
      console.log("  verdict: DEGRADED — passes are slow; watch the trend.");
    }
  }
} catch (e) { console.log(`  broker progress probe failed: ${e.message}`); }

console.log("== continuity mechanism: can EVERY seat resume from a note, and did compaction stop costing a model call? ==");
/*
 * The gate has three parts, and each one is answered from the store, not from the docs:
 *   A. is the extension armed at all (DURIG_EXTENSIONS names it, and the file exists)?
 *   B. per seat: does a `durig.notes` document exist for that seat's conversation, and does it render into
 *      a body a fresh context could actually work from (a goal or a next action, plus evidence)?
 *   C. before/after the first note was written: how many compactions ran, how many still built a summariser
 *      request (a `submissionId` in the task result), and how many of those summaries were truncated.
 * "Before/after" is anchored on the first `write_note` in the transcript, because that is the moment the
 * mechanism became real on this rig - not the moment a file was written to disk.
 */
try {
  const exts = String(config.DURIG_EXTENSIONS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const present = exts.filter((p) => existsSync(isAbsolute(p) ? p : join(ROOT, p)));
  console.log(`  DURIG_EXTENSIONS: ${exts.length ? exts.join(", ") : "(unset) - no extension is loaded, so the mechanism cannot exist yet"}`);
  if (exts.length && present.length < exts.length) {
    console.log(`  ${exts.length - present.length} listed extension path(s) do not exist - the rig looks configured and is not.`);
    failures.push(`${exts.length - present.length} DURIG_EXTENSIONS path(s) do not exist; the rig reports an extension it never loaded.`);
  }
  const continuityListed = exts.some((p) => /continuity/.test(p));
  if (!continuityListed) {
    blockers.push("extensions/continuity.mjs exists but is not in DURIG_EXTENSIONS - by design it is never auto-discovered, so an unlisted extension is an absent one.");
    console.log("  to arm it (an operator grant - this changes the code that runs in every seat):");
    console.log("    1. stop the broker:  node tools/broker-serve.mjs --stop   (docs/runbooks/continuation-notes.md, Preconditions)");
    console.log("    2. add to durig.config.json:  \"DURIG_EXTENSIONS\": \"extensions/continuity.mjs\"");
    console.log("    3. set DURIG_NOTES_DIR if the default (<rig root>/.durig/notes, gitignored) is not what you want");
    console.log("    4. re-run this gate: expect every seat to print goal=yes next=yes with a non-zero resume body");
  }

  if (existsSync(DB)) {
    const s = new DatabaseSync(DB, { readOnly: true });
    const kinds = s.prepare("select kind, count(*) n from documents group by kind order by kind").all().map((r) => String(r.kind).replace(/"/g, ""));
    const notesDocs = kinds.filter((k) => /notes/i.test(k));
    console.log(`  note documents in the store: ${notesDocs.length ? notesDocs.join(", ") : "none - durig.notes is not defined"}`);
    if (!notesDocs.length) blockers.push("no continuation-note document exists in the store, so a seat forced into a fresh context has nothing to resume from - the mechanism is rows #5931-#5940.");
    let writes = 0;
    try { writes = s.prepare("select count(*) n from entries where record like ?").get("%write_note%").n; } catch { writes = 0; }
    console.log(`  transcript evidence of a note write: ${writes} entr(ies) mentioning write_note`);
    const sectionSeen = s.prepare("select count(*) n from entries where record like ?").get("%durig-continuity%").n;
    // The extension's tools are declared in the `pi.system` entry that offers them, so this counts requests in
    // which the extension was selected. Grounded, not assumed: with the extension installed the mocked-plane store
    // has 7 entries carrying the section and 9 declaring read_note; without it, 0 and 0
    // (DURIG_CONTINUITY_KEEP_DIR=.spike/continuity-proof node demo/continuity-note.test.mjs).
    const toolSeen = s.prepare("select count(*) n from entries where record like ?").get("%\"name\":\"read_note\"%").n;
    console.log(`  pi.system entries carrying the durig-continuity section: ${sectionSeen}`);
    console.log(`  requests offering the note tools (read_note declared): ${toolSeen}`);
    if (continuityListed && sectionSeen === 0) {
      // Two causes look identical from here and need different answers: the mechanism is broken, or the extension
      // was armed and no seat has run a request since. A gate that reports the second as the first sends the next
      // session chasing a bug that is not there. Tell them apart by running the mechanism on the mocked plane
      // (no key, no network, no broker, ~0.4 s).
      let proof = "";
      let proven = false;
      try {
        proof = execFileSync(process.execPath, [join(ROOT, "demo", "continuity-note.test.mjs")], { encoding: "utf8", cwd: ROOT, timeout: 60000, stdio: ["ignore", "pipe", "pipe"] });
        proven = proof.includes("CONTINUITY PASS");
      } catch (e) { proof = e?.message ?? String(e); }
      const newest = s.prepare("select max(json_extract(record,'$.model[0].timestamp')) ts from entries").get()?.ts;
      console.log(`  mechanism proof on the mocked plane (demo/continuity-note.test.mjs): ${proven ? "PASS" : "FAIL"}`);
      if (!proven) {
        failures.push(`the continuity mechanism does not work even on the mocked plane: ${proof.split("\n").filter((l) => l.includes("FAIL")).slice(0, 3).join(" | ") || proof.slice(0, 200)}`);
      } else if (toolSeen === 0) {
        blockers.push(`the extension is armed and loads, but no seat has run a request with it on this store (0 entries declare read_note or carry the section; newest transcript entry ${newest ? new Date(newest).toISOString() : "none"}) - the mechanism is proven offline, and proving it on a live fleet needs a provider that registers a model, which is an operator grant.`);
      } else {
        failures.push(`the note tools reached ${toolSeen} request(s) but the durig-continuity section reached none - the section is being dropped for these conversations.`);
      }
    }
    const rawDir = config.DURIG_NOTES_DIR || ".durig/notes";
    const mirrorPath = isAbsolute(rawDir) ? rawDir : join(ROOT, rawDir);
    console.log(`  DURIG_NOTES_DIR: ${config.DURIG_NOTES_DIR ? rawDir : "(unset) - default below"}`);
    const mirrorCount = existsSync(mirrorPath) ? readdirSync(mirrorPath).filter((f) => f.endsWith(".md")).length : 0;
    console.log(`  mirror files at ${mirrorPath}: ${mirrorCount}`);
    if (mirrorCount === 0 && notesDocs.length) failures.push(`the note is in the store but not mirrored to ${mirrorPath} - seats and humans cannot read it with ordinary file tools.`);
    const last24 = s.prepare("select count(*) n from tasks where kind='\"pi.compaction\"' and json_extract(record,'$.startedAt') >= ?").get(Date.now() - 86400000).n;
    console.log(`  compaction attempts in the last 24 h: ${last24} (each still costs a summariser call until the hook supplies the note)`);

    // B. per seat. The roster is read through pi-durable's own storage API, because the SQL rows for a
    // document hold only its header - the value is delta-encoded in `document_revisions` and reading it by
    // hand would be a second, wrong implementation of a decoder that already exists.
    try {
      const { renderNote } = await import(join(ROOT, "extensions", "continuity.mjs"));
      const { openNodeSqliteStorage } = await import("@earendil-works/pi-durable/storage/sqlite/node");
      const { BACKGROUND_CONTEXT } = await import("@earendil-works/chord/context");
      const ctx = BACKGROUND_CONTEXT;
      const store = await openNodeSqliteStorage(DB);
      const rosterRec = await store.findDocument({ kind: "durig.seats", scope: { kind: "session" } }, "current", ctx);
      const roster = rosterRec ? (await store.document(rosterRec.id, "current", ctx))?.value?.seats ?? {} : {};
      console.log(`  seats in the roster: ${Object.keys(roster).length}`);
      const seatsWithoutNote = [];
      const seatsNotResumable = [];
      for (const [name, entry] of Object.entries(roster)) {
        const conv = entry?.conversationId;
        if (conv == null) { seatsWithoutNote.push(`${name} (no conversation)`); continue; }
        const rec = await store.findDocument({ kind: "durig.notes", scope: { kind: "conversation", conversationId: conv } }, "current", ctx);
        if (!rec) { seatsWithoutNote.push(`${name} (conv ${conv})`); continue; }
        const note = (await store.document(rec.id, "current", ctx))?.value;
        const body = renderNote(note);
        const revisions = s.prepare("select count(*) n from document_revisions where document_id=?").get(rec.id).n;
        const boundary = s.prepare("select count(*) n from entries where conversation_id=? and record like ?").get(conv, "%\"type\":\"pi.reset\"%").n;
        const resumable = body.length > 0 && (note?.goal || note?.next);
        console.log(`  ${String(name).padEnd(9)} conv ${String(conv).padEnd(5)} note rev ${revisions} | ${body.length} chars of resume text | goal=${note?.goal ? "yes" : "no"} next=${note?.next ? "yes" : "no"} verified=${(note?.verified ?? []).length} fresh-boundaries=${boundary}`);
        // An empty note doc is not a broken note: reading the doc creates it with its initial value, so an
        // empty body means no seat has written one yet - an operational gap (no broker), not a mechanism defect.
        if (body.length === 0) seatsWithoutNote.push(`${name} (conv ${conv}, note doc empty - no write_note yet)`);
        else if (!resumable) seatsNotResumable.push(`${name}: note renders ${body.length} chars but names no goal or next action`);
      }
      if (seatsWithoutNote.length) blockers.push(`${seatsWithoutNote.length} of ${Object.keys(roster).length} seats have no continuity note (${seatsWithoutNote.slice(0, 12).join(", ")}) - a forced fresh context for those seats starts empty.`);
      if (seatsNotResumable.length) failures.push(seatsNotResumable.join("; "));
      await store.close(ctx);
    } catch (e) {
      console.log(`  per-seat note read failed: ${e.message}`);
      failures.push(`the gate could not read the notes: ${e.message}`);
    }

    // C. before/after the mechanism. The anchor is the first real `write_note` TOOL CALL (not the system
    // section, which also contains the string).
    const firstNoteRow = s.prepare("select min(json_extract(record,'$.model[0].timestamp')) ts from entries where record like ?").get("%\"name\":\"write_note\",\"arguments\"%");
    const boundaryTs = firstNoteRow?.ts ?? null;
    if (boundaryTs) {
      console.log(`  mechanism armed at the first write_note call: ${new Date(boundaryTs).toISOString()}`);
      // A compaction task record always carries a `submissionId` - the harness creates the submission even when
      // an extension supplies the summary - so "did the summariser run" cannot be read from the task row. What
      // CAN be read is the summary the boundary placed: a note-backed summary begins with CONTINUITY NOTE, and a
      // summariser-backed one is model output that truncates with "hit the token limit". The zero-model-call
      // claim itself is gated by demo/continuity-note.test.mjs, which counts the provider's own call counter.
      const window = (from, to) => s.prepare(
        "select count(*) n, sum(record like ?) summariser_calls, sum(record like ?) truncated from tasks where kind='\"pi.compaction\"' and json_extract(record,'$.startedAt') >= ? and json_extract(record,'$.startedAt') < ?",
      ).get("%hit the token limit%", "%hit the token limit%", from, to);
      const noteBacked = (from, to) => s.prepare(
        "select count(*) n from entries where record like ? and json_extract(record,'$.model[0].timestamp') >= ? and json_extract(record,'$.model[0].timestamp') < ?",
      ).get("%was compacted into the following summary%CONTINUITY NOTE%", from, to).n;
      const before = window(boundaryTs - 86400000, boundaryTs);
      const after = window(boundaryTs, Date.now());
      console.log(`  24 h before: ${before.n} compactions, ${before.truncated ?? 0} truncated summaries, 0 note-backed (the mechanism did not exist yet)`);
      console.log(`  since: ${after.n} compactions, ${after.truncated ?? 0} truncated summaries, ${noteBacked(boundaryTs, Date.now())} note-backed`);
      if ((after.truncated ?? 0) > 0) failures.push(`${after.truncated} compaction summaries truncated in the rolling 24 h since the first note - the note path is not yet the one compaction takes.`);
      if (after.n > 0 && noteBacked(boundaryTs, Date.now()) === 0) failures.push(`none of the ${after.n} compactions since the first note used a note as its summary - the beforeCompact hook is not supplying it.`);
    } else {
      console.log("  no write_note call in the transcript yet: the before/after comparison has no anchor - the mechanism has never run on this store.");
    }
    s.close();
  }
} catch (e) { console.log(`  continuity probe failed: ${e.message}`); }

console.log("== live window occupancy (entries after each seat's head marker) ==");try {
  const j = JSON.parse(execFileSync(process.execPath, ["tools/seat-turn-shape.mjs", "--db", DB, "--json"], { encoding: "utf8", timeout: 60000, stdio: ["ignore", "pipe", "ignore"] }));
  const s = new DatabaseSync(DB, { readOnly: true });
  const seatWindow = new Map((rig.seats ?? []).map((st) => [st.name, Number(config[String(st.model ?? "").startsWith("local/") ? "DURIG_LOCAL_CONTEXT" : "DURIG_VERIFIER_CONTEXT"])]));
  const nearFull = [];
  const stuck = [];
  for (const st of j.seats ?? []) {
    const mk = st.marker?.id;
    if (!mk) { console.log(`  ${String(st.seat).padEnd(9)} no head marker — the whole transcript is in the window`); continue; }
    const row = s.prepare("select count(*) n, coalesce(sum(length(record)),0) chars from entries where conversation_id=? and id>=?").get(st.conversationId, mk);
    const tok = Math.round((row.chars || 0) / 4);
    const win = seatWindow.get(st.seat) ?? 0;
    if (!win) { console.log(`  ${String(st.seat).padEnd(9)} window not declared for its model — occupancy unmeasurable`); continue; }
    const calls = {};
    for (const e of s.prepare("select record from entries where conversation_id=? and id>=?").all(st.conversationId, mk)) {
      for (const m of JSON.parse(e.record).model || []) for (const c of m.content || []) if (c.type === "toolCall") calls[c.name] = (calls[c.name] || 0) + 1;
    }
    const pct = Math.round((100 * tok) / win);
    console.log(`  ${String(st.seat).padEnd(9)} conv ${st.conversationId} head ${st.marker.kind}@${mk}: ${st.windowMessages} msgs, ~${tok} tokens = ${pct}% of its ${win}-token window | items completed in this window: ${calls.complete_work || 0} (claimed ${calls.claim_work || 0}, deferred ${calls.defer_work || 0}), bash ${calls.bash || 0}`);
    if (pct > 80) nearFull.push(`${st.seat} at ${pct}% of its declared window`);
    if ((calls.claim_work || 0) > 0 && (calls.complete_work || 0) === 0) stuck.push(`${st.seat} claimed ${(calls.claim_work || 0)} item(s) in its current window and completed none`);
  }
  if (nearFull.length) blockers.push(`${nearFull.join("; ")} — the window is nearly full, so the recent turns and the summary cannot both fit.`);
  if (stuck.length) blockers.push(`${stuck.join("; ")} — the window is spent on tool traffic that never lands an item.`);
  console.log("  note: token count is chars/4 over durable entries; the provider's own tokenizer is the ground truth.");
} catch (e) { console.log(`  occupancy probe failed: ${e.message}`); }

console.log("");
if (failures.length === 0) {
  console.log("PASS (mechanism) — the override reaches the harness, every declared window holds its policy, and the note path is the one compaction takes when a note exists.");
  if (blockers.length) {
    console.log(`\nOperational blockers (${blockers.length}) — none of these is a defect in the mechanism; each needs a grant, a broker, or a provider:`);
    for (const b of blockers) console.log("  · " + b);
  }
  if (advisory.length) {
    console.log(`\nAdvisory (${advisory.length}) — risk signals this instrument cannot prove without a real provider:`);
    for (const a of advisory) console.log("  · " + a);
  }
  process.exit(0);
}
console.log(`FAIL (${failures.length}) — the mechanism itself is not yet sound:`);
for (const f of failures) console.log("  · " + f);
if (blockers.length) {
  console.log(`\nOperational blockers (${blockers.length}):`);
  for (const b of blockers) console.log("  · " + b);
}
if (advisory.length) {
  console.log(`\nAdvisory (${advisory.length}):`);
  for (const a of advisory) console.log("  · " + a);
}
process.exit(1);
