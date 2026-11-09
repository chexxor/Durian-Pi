// demo/queue-held-gates.test.mjs — #5770: the BOUNDED park census, and the class of row it exists to
// make visible.
//
// WHY THIS FILE EXISTS (a measurement, not a wish). The release census of parked rows cannot be run with
// the tools that exist: `claim_work` on a held row returns NO_QUEUED_WORK with no status/owner/gate;
// `revise_work` refuses a HELD row so the gate cannot be written into it; `release_work` refuses a row
// the caller neither sent nor received. The live store at the time of writing holds 438 held + 384
// deferred rows, and `cli.mjs queue --status held` prints them WITH bodies — the unbounded version of
// this read reached 25 MB in a devtools scratch export. A seat therefore cannot tell WHY a row is parked.
//
// THREE OUTCOMES, kept distinct, because collapsing them is the defect:
//   gate "authored"  — the row carries a written `block` (reason + resolver, validated on the write path)
//   gate "inferred"  — nothing was written; the legacy mapping DERIVES a park from the status. An
//                      inference must never be read as a recorded gate.
//   gate "none"      — nothing recorded at all: no blockedBy, no block, no heldReason, no deferredTo.
//                      THIS is the held row indistinguishable from a released row nobody claimed.
//
// FAILING-FIRST: before #5770 `--held`/`--with-gates`/`--limit` did not exist, so the only queue read a
// seat could run on parked rows was the full dump — and the assertions below (a bounded payload, bodies
// gone, `gate: "none"` reported by name) could not be written at all. The fixture deliberately contains
// BOTH gated and gateless held rows: a fixture with only gated rows would pass any "gate" assertion.
//
// Run: node demo/queue-held-gates.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { enqueueItem, Router, RigQueue } from "../src/rig.mjs";
import { gateView, GATE_VIEW_CAP } from "../src/queue-lifecycle.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-held-gates-"));

// Real-shaped bodies: a fixture with 20-byte bodies would pass any byte bound and prove nothing — the
// bound has to be demonstrated against bodies big enough to matter (#5016's reasoning, reused here).
const BIG_BODY = (i) => `BODY-${i} ` + "parked-row-context ".repeat(600); // ~9 KB each

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

const dbPath = join(dir, "held-gates.sqlite");
const sqlite = await openNodeSqliteStorage(dbPath);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(sqlite, { models, registry }, ctx);

const ids = {};
let next = 1;
await harness.commit(
  async (tx) => {
    // (1) held WITH a written block AND a structured gate — the fully-recorded park.
    ids.authored = await enqueueItem(tx, "lead", "devtools", "authored park", BIG_BODY(next++), null, false, "small", true, [7, 8], null, {
      reason: "dependency",
      resolver: "impl",
      constraints: [{ kind: "queue", ref: 7 }],
    });
    // (2) held with ONLY a structured gate, no block — a gate is not a park and vice versa.
    ids.gateOnly = await enqueueItem(tx, "lead", "devtools", "gate only", BIG_BODY(next++), null, false, "small", true, [9], null, null);
    // (3) held created by hold_work's shape: status held, a free-text reason, NO structured block.
    ids.reasonOnly = await enqueueItem(tx, "lead", "devtools", "reason only", BIG_BODY(next++), null, false, null, true, null, null, null);
    // (4) THE BUG CLASS: held with NOTHING recorded — no block, no blockedBy, no heldReason.
    ids.gateless = await enqueueItem(tx, "lead", "devtools", "gateless park", BIG_BODY(next++), null, false, null, true, null, null, null);
    ids.gateless2 = await enqueueItem(tx, "pm", "impl", "gateless park 2", BIG_BODY(next++), null, false, null, true, null, null, null);
    // (5) non-held rows, to prove the view does not mislabel them.
    ids.queued = await enqueueItem(tx, "lead", "devtools", "plain queued", BIG_BODY(next++));
    for (let i = 0; i < 40; i += 1) await enqueueItem(tx, "lead", "devtools", `filler ${i}`, BIG_BODY(next++), null, false, null, true, null, null, null);
  },
  ctx,
);

// Give row (3) the hold_work shape it is meant to model: status held + a free-text heldReason, no block.
await harness.commit(
  async (tx) => {
    const q = await tx.doc(RigQueue);
    const row = q.items.find((it) => it.id === ids.reasonOnly);
    row.heldReason = "waiting on the operator's window ruling";
  },
  ctx,
);
await harness.close(ctx);
await sqlite.close(ctx);

const cli = (args) => {
  const r = spawnSync(process.execPath, ["cli.mjs", ...args], {
    cwd: ROOT,
    env: { ...process.env, DURIG_DB: dbPath, DURIG_PI_DB: dbPath },
    encoding: "utf8",
    timeout: 120000,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

try {
  // ─── 1. THE VIEW IS BOUNDED BY CONSTRUCTION ───
  const bare = cli(["queue"]);
  const census = cli(["queue", "--held", "--with-gates"]);
  assert.equal(census.code, 0, `queue --held --with-gates failed: ${census.stderr.slice(0, 300)}`);
  const doc = JSON.parse(census.stdout);
  const bareBytes = Buffer.byteLength(bare.stdout, "utf8");
  const viewBytes = Buffer.byteLength(census.stdout, "utf8");
  check(
    `the gate view is ${viewBytes} B against the full dump's ${bareBytes} B (${(bareBytes / Math.max(viewBytes, 1)).toFixed(1)}x smaller)`,
    viewBytes < bareBytes / 4,
    "the bounded view is not actually smaller — it is the same dump wearing a hat",
  );
  check(
    "no row in the gate view carries a body",
    doc.items.every((it) => !("body" in it) && !("subject" in it)),
    `a gate-view row leaked a body/subject: ${JSON.stringify(doc.items[0])}`,
  );
  check(
    "the payload names its own bound: matched, shown, truncated, cap",
    doc.bounded && doc.bounded.cap === GATE_VIEW_CAP && doc.bounded.matched === 45 && doc.bounded.shown === 45 && doc.bounded.truncated === false,
    JSON.stringify(doc.bounded),
  );
  check(
    "truncation is reported when the match exceeds the limit (see the --limit 5 case below)",
    doc.bounded.truncated === (doc.bounded.matched > doc.bounded.limit),
    `matched=${doc.bounded.matched} limit=${doc.bounded.limit} truncated=${doc.bounded.truncated}`,
  );
  check("held rows with nothing recorded are counted by name", typeof doc.gatelessHeld === "number" && doc.gatelessHeld >= 2, `gatelessHeld=${doc.gatelessHeld}`);

  // ─── 2. EVERY HELD ROW IS CLASSIFIED, AND THE GATELESS ONE IS VISIBLE ───
  const byId = new Map(doc.items.map((it) => [it.id, it]));
  const a = byId.get(ids.authored);
  check("an authored park reports gate=recorded with its reason and resolver", a?.gate === "recorded" && a?.reason === "dependency" && a?.resolver === "impl" && a?.basis === "authored-block", JSON.stringify(a));
  check("a structured gate is reported even without a block", byId.get(ids.gateOnly)?.gate === "recorded" && byId.get(ids.gateOnly)?.blockedBy?.length === 1 && byId.get(ids.gateOnly)?.basis === "declared-fields", JSON.stringify(byId.get(ids.gateOnly)));
  check("a free-text heldReason is reported as a recorded park", byId.get(ids.reasonOnly)?.gate === "recorded" && byId.get(ids.reasonOnly)?.heldReason, JSON.stringify(byId.get(ids.reasonOnly)));
  const g = byId.get(ids.gateless);
  check("a held row with NOTHING written reports gate=none — the bug this instrument exists to show", g?.gate === "none" && g?.blockedBy === null && g?.heldReason === null && g?.resolver === null, JSON.stringify(g));
  check("the gateless rows are also listed by id so a census can act on them", Array.isArray(doc.gatelessIds) && doc.gatelessIds.includes(ids.gateless), JSON.stringify(doc.gatelessIds));
  check(
    "every emitted row is in the closed vocabulary {recorded, none}",
    doc.items.every((it) => ["recorded", "none"].includes(it.gate)),
    `unknown gate class: ${JSON.stringify(doc.items.map((it) => it.gate).filter((x) => !["recorded", "none"].includes(x)))}`,
  );
  const recordedCount = doc.items.filter((it) => it.gate === "recorded").length;
  const noneCount = doc.items.filter((it) => it.gate === "none").length;
  check(
    `the census splits the store honestly: ${recordedCount} recorded parks, ${noneCount} rows with nothing written`,
    recordedCount === 3 && noneCount === doc.items.length - 3,
    `expected 3 recorded and the rest none, got ${recordedCount}/${noneCount}`,
  );
  check("no gateless row is given a status-derived resolver it never had", doc.items.filter((it) => it.gate === "none").every((it) => it.resolver === null && it.reason === null), JSON.stringify(doc.items.find((it) => it.gate === "none")));

  // ─── 3. THE CAP IS ENFORCED, AND THE UNbounded REQUEST IS REFUSED ───
  const capped = cli(["queue", "--held", "--with-gates", "--limit", "5"]);
  const cappedDoc = JSON.parse(capped.stdout);
  check("--limit 5 shows 5 of the matched rows and says so", cappedDoc.items.length === 5 && cappedDoc.bounded.shown === 5 && cappedDoc.bounded.truncated, JSON.stringify(cappedDoc.bounded));
  check("the truncation is announced on stderr too", /capped at/.test(capped.stderr), capped.stderr.slice(0, 200));

  const zero = cli(["queue", "--held", "--with-gates", "--limit", "0"]);
  check("--limit 0 is REFUSED, not treated as 'all'", zero.code === 1 && /positive integer/.test(zero.stderr) && !/"items":\s*\[/.test(zero.stdout), `exit ${zero.code}: ${zero.stderr.slice(0, 200)}`);
  const over = cli(["queue", "--held", "--with-gates", "--limit", String(GATE_VIEW_CAP + 1)]);
  check(`--limit above the cap (${GATE_VIEW_CAP}) is REFUSED by name`, over.code === 1 && /exceeds the bounded park view's cap/.test(over.stderr), `exit ${over.code}: ${over.stderr.slice(0, 200)}`);
  const typo = cli(["queue", "--held", "--with-gates", "--zork"]);
  check("an unknown argument is still refused, and the refusal lists the known flags", typo.code === 1 && /--with-gates/.test(typo.stderr), `exit ${typo.code}: ${typo.stderr.slice(0, 200)}`);

  // ─── 4. THE UNIT LEVEL: gateView itself, no CLI, no store ───
  const bareHeld = gateView({ id: 1, from: "lead", to: "impl", status: "held", transitions: [{ event: "held", by: "impl" }] });
  check("gateView reports gate=none for a held row with no block, no gate and no reason", bareHeld.gate === "none" && bareHeld.resolver === null && bareHeld.basis === "none", JSON.stringify(bareHeld));
  check(
    "gateView reports recorded when a block was written", gateView({ id: 2, from: "lead", to: "impl", status: "held", block: { source: "declared", reason: "operator", resolver: "human", reviewBy: null }, transitions: [] }).gate === "recorded",
    "an authored block must be reported as recorded",
  );

  console.log(
    `HELD GATE CENSUS TEST PASS (bounded view ${viewBytes} B vs ${bareBytes} B full dump; cap ${GATE_VIEW_CAP}; gate classes recorded/none; ${doc.gatelessHeld} held rows with nothing written, listed by id)`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
process.exit(failures === 0 ? 0 : 1);
