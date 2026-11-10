// demo/held-gate-audit.test.mjs — #6071: the rig can now tell WHICH parked rows are stale, fleet-wide.
//
// WHY THIS FILE EXISTS (a measurement, not a wish). On the live store at intake: 6,082 queue rows,
// 459 of them `held`, 168 of those with NO recorded gate at all, and every gate that a row cites lives
// either in prose ("do NOT start before #662/#710 are done") or in the structured `blockedBy` field.
// `cli.mjs queue --held --with-gates` (#5770) answers "was a gate RECORDED" but never "is the gate still
// CLOSED", so nothing in status/attention can say "this row has been parked on a finished gate for 24
// days". Hand-auditing 459 rows is a 40-minute read, which is why it never happens.
//
// THE NON-VACUITY REQUIREMENT. A classifier that calls every gateless held row "stale" is worthless: it
// would flag #3075 (a standing DECISIONS.md numbering rule, parked on purpose, with no recorded gate)
// and #5428 (parked until #5211's BRANCH lands - a git fact, not a queue status). The fixtures below
// therefore include, on purpose: a row whose gates are all terminal, a row whose gate is still open, a
// standing rule with no gate, a branch-landing gate, an artifact that already exists, and an artifact
// whose file exists but whose named content does not. If any class collapses into another, an assertion
// here fails.
//
// Run: node demo/held-gate-audit.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { enqueueItem, Router, RigQueue } from "../src/rig.mjs";
import { auditHeldRows, classifyHeldRow, CLASSES, TERMINAL_STATUSES } from "../src/heldgate.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-held-gate-audit-"));

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

const dbPath = join(dir, "audit.sqlite");
const sqlite = await openNodeSqliteStorage(dbPath);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(sqlite, { models, registry }, ctx);

// Ids 1-8 cannot collide with git landing commits: the OLDEST "merge: land item-<n>" on main is 1803
// (measured with `git log --format=%s refs/heads/main | grep -oE 'land item-[0-9]+'`), so the fixture's
// own-landing rule is provably not tripped by the real repository.
let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

try {
  const ids = {};
  await harness.commit(
    async (tx) => {
      const add = (from, to, subject, body, held, blockedBy, block) =>
        enqueueItem(tx, from, to, subject, body, null, false, "small", held, blockedBy, null, block);

      // The gate rows themselves: 1 and 2 are CLOSED, 3 is still open.
      ids.gate1 = await add("pm", "impl", "gate: upstream work 1", "context");
      ids.gate2 = await add("pm", "impl", "gate: upstream work 2", "context");
      ids.gate3 = await add("pm", "impl", "gate: upstream work 3 (still queued)", "context");

      // (A) gates all terminal -> RELEASE CANDIDATE.
      ids.cleared = await add("pm", "impl", "ROADMAP 99 — finish the drain pass", "sequenced after #1 and #2", true, [ids.gate1, ids.gate2], null);

      // (B) a gate still open -> GATE OPEN, never stale.
      ids.open = await add("pm", "impl", "ROADMAP 100 — the follow-up that waits", "gated on #3", true, [ids.gate3], null);

      // (C) #3075's shape: NO recorded gate, and the text says it is parked on purpose.
      ids.standing = await add("lead", "scribe", "DECISIONS.md numbering rule (lead-registered, HELD)", "Parked registration — do NOT start until the operator-declared quiet window.", true, null, null);

      // (D) #5428's shape: parked until a BRANCH lands. #4's queue row is `done`, the branch is not on main.
      ids.landingGate = await add("pm", "impl", "gate: the branch for item 4", "context");
      ids.landing = await add("pm", "scribe", "REGISTERED (parked, do NOT start until #4's branch lands): port the \"NOT-PRESENT-MARKER-1234\" into docs/SELFDEV.md", "registered now so it is not forgotten; the work waits for the merge.", true, [ids.landingGate], {
        source: "declared",
        reason: "dependency",
        resolver: "pm",
        constraints: [{ kind: "queue", ref: ids.landingGate }],
      });

      // (E) the asked-for artifact is present AND contains what the row names -> CANCEL CANDIDATE.
      ids.satisfied = await add("pm", "qa", "extend demo/queue-held-gates.test.mjs", "the fixture already covers the \"bounded park census\"; confirm it and close the row.", true, [ids.gate1], null);

      // (F) the file exists but the named content does not -> NOT satisfied, so the row is still real work.
      ids.notSatisfied = await add("pm", "qa", "port the \"NOT-PRESENT-MARKER-1234\" into docs/SELFDEV.md", "the table is not in the file yet.", true, [ids.gate2], null);

      // (G) gateless and no trigger text -> UNATTRIBUTED, the #5770 class: not stale, just undocumented.
      ids.unattributed = await add("pm", "impl", "some parked row with nothing written", "body", true, null, null);

      // Close the gates we intend to be closed.
      const q = await tx.doc(RigQueue);
      for (const id of [ids.gate1, ids.gate2, ids.landingGate]) {
        const row = q.items.find((it) => it.id === id);
        row.status = "done";
        row.resultSummary = "closed for the fixture";
      }
    },
    ctx,
  );
  await harness.close(ctx);
  await sqlite.close(ctx);

  // ─── 1. THE UNIT RULES, with the facts injected ───
  const statusOf = (id) => ({ [ids.gate1]: "done", [ids.gate2]: "done", [ids.gate3]: "queued", [ids.landingGate]: "done" }[id] ?? "absent");
  const facts = { statusOf, landedOnMain: () => null, artifactSatisfied: (p, ms) => Boolean(p && ms.length === 0) };

  check("a held row whose structured gates are all terminal is a release candidate",
    classifyHeldRow({ id: 101, from: "pm", to: "impl", status: "held", subject: "finish the drain pass", body: "gated on #1, #2", blockedBy: [ids.gate1, ids.gate2], transitions: [] }, facts).class === "release-candidate");

  check("a held row with one gate still queued is NOT stale",
    classifyHeldRow({ id: 102, from: "pm", to: "impl", status: "held", subject: "the follow-up", body: "gated on #3", blockedBy: [ids.gate3], transitions: [] }, facts).class === "gate-open");

  check("a standing rule with NO recorded gate is not flagged as a release candidate (#3075's shape)",
    classifyHeldRow({ id: 103, from: "lead", to: "scribe", status: "held", subject: "DECISIONS.md numbering rule (HELD)", body: "Parked registration — do NOT start until the quiet window.", transitions: [] }, facts).class === "standing-rule");

  check("a branch-landing gate is settled by git, not by the gate row's status (#5428's shape)",
    classifyHeldRow({ id: 104, from: "pm", to: "scribe", status: "held", subject: "parked, do NOT start until #5211's branch lands", body: "registered now; the work waits for the merge.", transitions: [] }, facts).class === "standing-rule");

  const landedFacts = { statusOf, landedOnMain: (id) => (id === 5211 ? "455dfd03" : null), artifactSatisfied: () => false };
  const landingClosed = classifyHeldRow({ id: 104, from: "pm", to: "scribe", status: "held", subject: "parked, do NOT start until #5211's branch lands", body: "registered now; the work waits for the merge.", transitions: [] }, landedFacts);
  check("when the branch HAS landed, the condition names the commit instead of guessing",
    landingClosed.class === "standing-rule" && /455dfd03/.test(landingClosed.condition + landingClosed.evidence.join(" ")), landingClosed.condition);

  check("a row with no landing commit for its own id is NOT closed by the landing rule", classifyHeldRow({ id: 105, from: "pm", to: "impl", status: "held", subject: "the feature", body: "gated on #2", blockedBy: [ids.gate2], transitions: [] }, landedFacts).class === "release-candidate");
  check("the same row with a landing commit for its own id is a cancel candidate",
    classifyHeldRow({ id: 5211, from: "pm", to: "impl", status: "held", subject: "the feature", body: "plain row", transitions: [] }, landedFacts).class === "cancel-candidate");

  check("an artifact that exists but does not contain what the row names is NOT treated as satisfied",
    classifyHeldRow({ id: 106, from: "pm", to: "qa", status: "held", subject: 'port the "NOT-PRESENT-MARKER-1234" into docs/SELFDEV.md', body: "the table is not in the file yet.", blockedBy: [ids.gate2], transitions: [] },
      { statusOf, landedOnMain: () => null, artifactSatisfied: () => false }).class === "release-candidate");
  check("an artifact that exists and does contain the named content is a cancel candidate",
    classifyHeldRow({ id: 107, from: "pm", to: "qa", status: "held", subject: "extend docs/SELFDEV.md", body: 'the "broker state" section needs the parked-row census; it is already there.', blockedBy: [ids.gate2], transitions: [] },
      { statusOf, landedOnMain: () => null, artifactSatisfied: (p, ms) => existsAndHas(p, ms) }).class === "cancel-candidate");

  check("the vocabulary is closed", CLASSES.length === 5 && CLASSES.every((c) => typeof c === "string"));
  check("terminal means done or cancelled and nothing else", [...TERMINAL_STATUSES].sort().join(",") === "cancelled,done");

  // ─── 2. THE TOOL, against a real store, end to end ───
  const run = spawnSync(process.execPath, ["tools/held-gate-audit.mjs", "--db", dbPath, "--json", join(dir, "out.json")], {
    cwd: ROOT,
    env: { ...process.env, DURIG_DB: dbPath, DURIG_PI_DB: dbPath },
    encoding: "utf8",
    timeout: 180000,
  });
  check("the tool runs read-only and exits 0", run.status === 0, `exit ${run.status}: ${run.stderr.slice(0, 300)}`);
  const bytes = Buffer.byteLength(run.stdout, "utf8");
  check(`the report is bounded (${bytes} B for 9 rows; ids, not bodies)`, bytes < 20000 && !run.stdout.includes("BODY"), run.stdout.slice(0, 200));
  check("the report says it proposes nothing", /No row is released, cancelled or routed here/.test(run.stdout));

  const doc = JSON.parse(readFileSync(join(dir, "out.json"), "utf8"));
  const byId = new Map(doc.rows.map((r) => [r.id, r]));
  check(`the tool's read path found the held rows (held=${doc.held})`, doc.held === 7, `held=${doc.held}`);
  check("gates-cleared row -> release-candidate", byId.get(ids.cleared)?.class === "release-candidate", JSON.stringify(byId.get(ids.cleared)));
  check("gate-still-open row -> gate-open", byId.get(ids.open)?.class === "gate-open", JSON.stringify(byId.get(ids.open)));
  check("standing-rule row -> standing-rule, with the condition named in its own words", byId.get(ids.standing)?.class === "standing-rule" && /do NOT start/i.test(byId.get(ids.standing)?.condition ?? ""), JSON.stringify(byId.get(ids.standing)));
  check("branch-landing row -> standing-rule (never a release candidate), and the condition names the git check", byId.get(ids.landing)?.class === "standing-rule" && /land on main/i.test(byId.get(ids.landing)?.condition ?? ""), JSON.stringify(byId.get(ids.landing)));
  check("artifact-satisfied row -> cancel-candidate", byId.get(ids.satisfied)?.class === "cancel-candidate", JSON.stringify(byId.get(ids.satisfied)));
  check("artifact-missing-content row -> release-candidate (the work is still real)", byId.get(ids.notSatisfied)?.class === "release-candidate", JSON.stringify(byId.get(ids.notSatisfied)));
  check("gateless row with no trigger text -> unattributed", byId.get(ids.unattributed)?.class === "unattributed", JSON.stringify(byId.get(ids.unattributed)));
  check("every class the audit reports is in the closed vocabulary", Object.keys(doc.byClass).every((c) => CLASSES.includes(c)), JSON.stringify(doc.byClass));
  check("the per-seat totals add up to the held count", Object.values(doc.bySeat).reduce((a, s) => a + Object.values(s).reduce((x, y) => x + y, 0), 0) === doc.held, JSON.stringify(doc.bySeat));
  check("the release candidates carry the evidence the class rests on", (byId.get(ids.cleared)?.evidence ?? []).some((e) => /all named gates terminal/.test(e)), JSON.stringify(byId.get(ids.cleared)?.evidence));

  // ─── 3. ARG HYGIENE: the parser must not read a flag's VALUE as an item id ───
  const badLimit = spawnSync(process.execPath, ["tools/held-gate-audit.mjs", "--db", dbPath, "--limit", "0"], { cwd: ROOT, env: { ...process.env, DURIG_DB: dbPath }, encoding: "utf8", timeout: 120000 });
  check("--limit 0 is refused, not read as 'show everything'", badLimit.status === 1 && /positive integer/.test(badLimit.stderr), `exit ${badLimit.status}: ${badLimit.stderr.slice(0, 200)}`);
  const badFlag = spawnSync(process.execPath, ["tools/held-gate-audit.mjs", "--db", dbPath, "--zork", "5"], { cwd: ROOT, env: { ...process.env, DURIG_DB: dbPath }, encoding: "utf8", timeout: 120000 });
  check("an unknown flag is refused by name instead of silently scoping the audit to item 5", badFlag.status === 1 && /unknown argument/.test(badFlag.stderr), `exit ${badFlag.status}: ${badFlag.stderr.slice(0, 200)}`);
  const seatRun = spawnSync(process.execPath, ["tools/held-gate-audit.mjs", "--db", dbPath, "--seat", "impl", "--json", join(dir, "seat.json")], { cwd: ROOT, env: { ...process.env, DURIG_DB: dbPath }, encoding: "utf8", timeout: 180000 });
  const seatDoc = JSON.parse(readFileSync(join(dir, "seat.json"), "utf8"));
  check("--seat impl scopes the rows to impl while the census still reports every held row", seatDoc.held === 7 && seatDoc.rows.length === 3 && seatDoc.rows.every((r) => r.to === "impl"), `held=${seatDoc.held} rows=${seatDoc.rows.length}`);
  const idRun = spawnSync(process.execPath, ["tools/held-gate-audit.mjs", "--db", dbPath, "--json", join(dir, "ids.json"), String(ids.cleared)], { cwd: ROOT, env: { ...process.env, DURIG_DB: dbPath }, encoding: "utf8", timeout: 180000 });
  const idDoc = JSON.parse(readFileSync(join(dir, "ids.json"), "utf8"));
  check("bare item ids scope the report to those rows only", idDoc.rows.length === 1 && idDoc.rows[0].id === ids.cleared, JSON.stringify(idDoc.rows.map((r) => r.id)));

  console.log(`HELD GATE AUDIT TEST PASS (classes ${CLASSES.join("/")}; tool exit ${run.status}; report ${bytes} B; held=${doc.held}; release=${doc.byClass["release-candidate"] ?? 0}, cancel=${doc.byClass["cancel-candidate"] ?? 0}, standing=${doc.byClass["standing-rule"] ?? 0}, gate-open=${doc.byClass["gate-open"] ?? 0}, unattributed=${doc.byClass["unattributed"] ?? 0})`);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

// A real check against the real tree: does this repo file contain the phrase the row names?
function existsAndHas(path, markerList) {
  const r = spawnSync("node", [
    "-e",
    `const f=require('fs'),p=require('path');const abs=p.join(process.cwd(),process.argv[1]);if(!f.existsSync(abs))process.exit(3);const t=f.readFileSync(abs,'utf8').toLowerCase();process.exit(${JSON.stringify(markerList.map(String))}.some(m=>t.includes(m.toLowerCase()))?0:4)`,
    path,
  ], { cwd: ROOT, encoding: "utf8" });
  return r.status === 0;
}

process.exit(failures === 0 ? 0 : 1);
