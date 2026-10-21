// demo/control-plane-gate.test.mjs — #1966: control-plane spool ops are OPERATOR-ONLY.
//
// The gap (devtools #2198, security #2223): a broker spool request carries a PRODUCER-
// STAMPED `from`, and nothing checked it. Any seat that can drop a file in
// `<db>.broker.inbox` could therefore `configure` ANOTHER seat's model/provider, or
// `pause`/`unpause` the rig — privilege escalation. This adds ONE operator-only gate to
// every control-plane op (`pause`, `unpause`, `configure`) and to ops that act
// cross-seat (`stop`, `reset`, `compact`), plus a structured refusal and an audit row.
//
// DETECT-AND-LAYER, not a boundary: `from` is forgeable by the same OS user, so this is
// one layer; the spool-dir write denial (seatguard path-deny + readOnlyRoots) is the
// other. Same-user forgeability is a KNOWN RESIDUAL, named here, never claimed closed.
//
// Proves: (a) control-plane ops on an existing conversation are refused unless
// from=operator; (b) the refusal is STRUCTURED (a code, not prose); (c) the carve-out —
// the spool can never CREATE (isCreate refused), and `up` creation is unaffected;
// (d) the seatguard bypass is documented; (e) non-control-plane ops are unaffected;
// (f) the halt actuator is exempt (it never routes through the spool).
// Run: node demo/control-plane-gate.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";

import { RigControl, Router, Seats, registerSeat } from "../src/rig.mjs";
import { HALT_LABEL_PREFIX, haltSeat } from "../src/halt.mjs";
import { refusalForSpoolPath } from "../src/seatguard.mjs";
import {
  CONTROL_PLANE_OPS,
  CROSS_SEAT_OPS,
  OPERATOR,
  SPOOL_OPS,
  authorizeSpoolRequest,
  drainIntentInbox,
  intentResultDir,
  writeIntent,
} from "../src/broker.mjs";

const ctx = BACKGROUND_CONTEXT;

/* ----------------------------- (a)-(c),(e) pure gate ----------------------------- */

assert.ok(CONTROL_PLANE_OPS.has("pause") && CONTROL_PLANE_OPS.has("unpause") && CONTROL_PLANE_OPS.has("configure"),
  "the control-plane set names pause/unpause/configure");

// (a) a control-plane op is refused unless from=operator.
for (const op of ["pause", "unpause", "configure"]) {
  assert.equal(authorizeSpoolRequest({ op, from: "impl" }).allowed, false, `${op} from a seat is refused`);
  assert.equal(authorizeSpoolRequest({ op, from: "impl" }).code, "not-operator", `${op} refusal carries the code`);
  assert.equal(authorizeSpoolRequest({ op }).allowed, false, `${op} with NO from is refused`);
  assert.equal(authorizeSpoolRequest({ op, from: OPERATOR }).allowed, true, `${op} from the operator is allowed`);
}
// (b) the refusal is STRUCTURED: a stable code, not a sentence to parse.
assert.equal(authorizeSpoolRequest({ op: "pause", from: "impl" }).code, "not-operator");
assert.match(authorizeSpoolRequest({ op: "pause", from: "impl" }).detail, /pause/, "the detail names the op");

// (c) the CARVE-OUT: the spool can never CREATE. An isCreate bit on a spooled configure
//     is refused, so a seat cannot mint a seat's initial doc by spooling one.
assert.equal(
  authorizeSpoolRequest({ op: "configure", from: OPERATOR, to: "worker", isCreate: true }).code,
  "iscreate-not-permitted",
  "configure+isCreate through the spool is refused (creation is `up`'s)",
);
assert.equal(
  authorizeSpoolRequest({ op: "configure", from: OPERATOR, to: "worker" }).allowed,
  true,
  "a plain operator reconfigure is allowed (no isCreate)",
);

// (d)+(e) cross-seat ops are operator-only; a SELF-target stays allowed; content ops are
//         unaffected.
assert.equal(authorizeSpoolRequest({ op: "reset", from: "impl", to: "other" }).allowed, false, "cross-seat reset refused");
assert.equal(authorizeSpoolRequest({ op: "stop", from: "impl", to: "other" }).code, "not-operator");
assert.equal(authorizeSpoolRequest({ op: "compact", from: "impl", to: "other" }).allowed, false, "cross-seat compact refused");
assert.equal(authorizeSpoolRequest({ op: "reset", from: "impl", to: "impl" }).allowed, true, "a SELF-target reset stays allowed");
assert.equal(authorizeSpoolRequest({ op: "compact", from: OPERATOR, to: "worker" }).allowed, true, "operator compact is allowed");
assert.equal(authorizeSpoolRequest({ op: "message", from: "impl", to: "other" }).allowed, true, "a content op (message) is UNAFFECTED");

// (f) the halt actuator is EXEMPT: it is not a spool op, so it never passes through the
//     gate. The broker actuates it in-process (#1768 [B]); it self-records via its label.
assert.ok(typeof haltSeat === "function", "the halt actuator exists");
assert.ok(!SPOOL_OPS.includes("halt"), "there is no `halt` spool op — the actuator cannot be spooled");
assert.ok(!CONTROL_PLANE_OPS.has("halt"), "the halt actuator is not behind this gate");
assert.equal(HALT_LABEL_PREFIX, "aborted:", "a halt self-records through the `aborted:` label");

// (ii) the seatguard path-deny LAYER: a write/shell naming the spool dir is refused
//      (best-effort — the same-user bypass is documented below).
assert.match(String(refusalForSpoolPath("C:/x/rig.sqlite.broker.inbox/0001-abc.json")), /SPOOL directory/, "a write into the inbox is refused");
assert.match(String(refusalForSpoolPath("rig.sqlite.broker.inbox.error/x.error.json")), /SPOOL directory/, "the error dir is refused too");
assert.equal(refusalForSpoolPath("src/broker.mjs"), null, "an ordinary path is not refused");
assert.equal(refusalForSpoolPath("C:/x/rig.sqlite.broker.log"), null, "the broker LOG beside the spool is not the spool dir");

/* ----------------------------- realized: the drain ----------------------------- */

const dir = mkdtempSync(join(tmpdir(), "durig-cpgate-"));
const dbPath = join(dir, "rig.sqlite");
const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);
const storage = new MemoryStorage();
const harness = await Harness.open(storage, { models, registry }, ctx);

await harness.commit(async (tx) => {
  const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
  await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" } });
  await registerSeat(tx, "worker", c.id, "worker");
}, ctx);

const auditRows = () => {
  try {
    return readFileSync(`${dbPath}.broker.audit.log`, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
};
const drainOne = async (request) => {
  writeIntent(dbPath, request);
  return await drainIntentInbox(harness, storage, { dbPath, context: ctx });
};
const resultOf = (requestId) => {
  try {
    return JSON.parse(readFileSync(join(intentResultDir(dbPath), `${requestId}.json`), "utf8"));
  } catch {
    return null;
  }
};

try {
  // (a)+(b) a seat-sent `pause` is REFUSED, dead-lettered with the code, and audited.
  const refused = await drainOne({ op: "pause", to: null, from: "impl", requestId: "g-pause-refused" });
  assert.equal(refused.deadLettered, 1, "a seat-sent pause is dead-lettered");
  assert.equal(refused.delivered, 0, "a seat-sent pause is NOT applied");
  assert.equal(resultOf("g-pause-refused"), null, "no success result is recorded for a refusal");
  const pausedAfterRefusal = (await harness.documentState(RigControl, undefined, ctx))?.value?.paused ?? false;
  assert.equal(pausedAfterRefusal, false, "the rig was NOT paused by the refused request");
  const refusalRow = auditRows().find((r) => r.requestId === "g-pause-refused");
  assert.ok(refusalRow, "the refusal is AUDITED");
  assert.equal(refusalRow.decision, "refused");
  assert.equal(refusalRow.code, "not-operator");
  assert.equal(refusalRow.from, "impl");
  assert.ok(refusalRow.sourceFile.endsWith(".json"), "the audit row names the source spool file");

  // (a) the OPERATOR's pause is applied, and audited as allowed.
  const applied = await drainOne({ op: "pause", to: null, from: OPERATOR, reason: "gate demo", requestId: "g-pause-ok" });
  assert.equal(applied.delivered, 1, "the operator's pause is applied");
  assert.equal(resultOf("g-pause-ok").result.paused, true, "the pause result reports it applied");
  assert.equal((await harness.documentState(RigControl, undefined, ctx))?.value?.paused, true, "the rig is paused");
  const allowedRow = auditRows().find((r) => r.requestId === "g-pause-ok");
  assert.equal(allowedRow.decision, "allowed");
  assert.equal(allowedRow.code, "operator-control-plane");
  await drainOne({ op: "unpause", to: null, from: OPERATOR, requestId: "g-unpause-ok" });
  assert.equal((await harness.documentState(RigControl, undefined, ctx))?.value?.paused, false, "the operator's unpause is applied");

  // (a) a seat-sent `configure` of another seat's model is REFUSED (the escalation).
  const cfgRefused = await drainOne({ op: "configure", to: "worker", from: "impl", model: { provider: "evil", modelId: "evil-1" }, requestId: "g-cfg-refused" });
  assert.equal(cfgRefused.deadLettered, 1, "a seat-sent configure is refused");
  assert.equal(resultOf("g-cfg-refused"), null, "the escalation did not apply");

  // (c) the operator's reconfigure is allowed; the spool cannot CREATE (isCreate refused).
  const cfgOk = await drainOne({ op: "configure", to: "worker", from: OPERATOR, model: { provider: "faux", modelId: "faux-seat" }, requestId: "g-cfg-ok" });
  assert.equal(cfgOk.delivered, 1, "the operator's reconfigure is applied");
  assert.equal(resultOf("g-cfg-ok").result.provider, "faux", "the operator's reconfigure is applied (the result names the provider)");
  const cfgCreate = await drainOne({ op: "configure", to: "worker", from: OPERATOR, isCreate: true, model: { provider: "faux", modelId: "faux-seat" }, requestId: "g-cfg-create" });
  assert.equal(cfgCreate.deadLettered, 1, "configure+isCreate through the spool is refused");
  assert.equal(auditRows().find((r) => r.requestId === "g-cfg-create").code, "iscreate-not-permitted");

  // (e) a non-control-plane CONTENT op from a seat is UNAFFECTED.
  const msg = await drainOne({ op: "message", to: "worker", from: "impl", content: "CONTENT-OK", requestId: "g-msg" });
  assert.equal(msg.delivered, 1, "a seat-sent message is still delivered (content op unaffected)");

  // (d) the seatguard bypass is DOCUMENTED, not hidden: `from` is producer-stamped inside
  //     a spool file and all seats share one OS user, so a seat that can write the spool
  //     directory can forge from=operator. The layers (readOnlyRoots + seatguard path-deny)
  //     narrow it; this gate does not close it. Stated so no reader mistakes it for a boundary.
  const forged = authorizeSpoolRequest({ op: "pause", from: OPERATOR });
  assert.equal(forged.allowed, true, "a FORGED from=operator is indistinguishable here — the documented residual");
  assert.match(String(forged.code), /operator/, "the decision is recorded so an audit can see the allowed control-plane act");

  console.log(
    "CONTROL-PLANE GATE PASS (control-plane + cross-seat spool ops are operator-only, refused with a structured code and audited; the spool cannot create; content ops and self-targets unaffected; the halt actuator is exempt; the same-user bypass is documented as a known residual)",
  );
} finally {
  await harness.close(ctx);
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}
process.exit(0);
