#!/usr/bin/env node
/*
 * Falsifiable probe for the broker RECEIVE path (architect ruling, item #6185).
 * Three questions, each answered by a printed row:
 *   1. Is the admission predicate TOTAL, or fail-open for anything undeclared?
 *   2. Does a DENY at the receive path terminate, or re-drain forever?
 *   3. Does a DENY reach the producer, or only the dead-letter directory nobody reads?
 * Runs against throwaway sqlite paths in a temp dir. Never opens the live store.
 */
import { mkdtempSync, writeFileSync, readdirSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
const SCRATCH = [];
import { SPOOL_OPS, authorizeSpoolRequest, drainIntentInbox } from "../../src/broker.mjs";

const rows = [];
const row = (scenario, expect, got) => rows.push({ scenario, expect, got, ok: expect === got });

/* 1. The predicate, in isolation. */
for (const op of ["pause", "unpause", "configure"]) {
  row(`declared control op "${op}" from a seat`, "DENY", authorizeSpoolRequest({ op, from: "impl" }).allowed ? "ALLOW" : "DENY");
}
row("cross-seat stop from a seat", "DENY", authorizeSpoolRequest({ op: "stop", from: "impl", to: "qa" }).allowed ? "ALLOW" : "DENY");
row("self-target stop from a seat", "ALLOW", authorizeSpoolRequest({ op: "stop", from: "impl", to: "impl" }).allowed ? "ALLOW" : "DENY");
row("op the spool has NEVER declared", "DENY", authorizeSpoolRequest({ op: "controll", from: "impl" }).allowed ? "ALLOW" : "DENY");
row("payload with no op field", "DENY", authorizeSpoolRequest({ body: "hello" }).allowed ? "ALLOW" : "DENY");
row("op field is not a string", "DENY", authorizeSpoolRequest({ op: 42, from: "impl" }).allowed ? "ALLOW" : "DENY");
row("from field absent", "DENY", authorizeSpoolRequest({ op: "pause" }).allowed ? "ALLOW" : "DENY");
row("SPOOL_OPS is the vocabulary the drain checks", "yes", String(SPOOL_OPS.includes("pause")));

/* 2+3. The drain, twice, against a store whose dead-letter sink is unusable. */
const stubHarness = { snapshot: async () => ({ seats: {} }) };
const context = { actor: { kind: "system", id: "probe" } };

const dir1 = mkdtempSync(join(process.cwd(), "probe-receive-")); SCRATCH.push(dir1);
const db = join(dir1, "store.sqlite");
mkdirSync(`${db}.broker.inbox`, { recursive: true });
writeFileSync(`${db}.broker.inbox/unparseable.json`, "this is not json{");
writeFileSync(`${db}.broker.inbox/undeclared-op.json`, JSON.stringify({ op: "controll", from: "impl" }));
const p1 = await drainIntentInbox(stubHarness, null, { dbPath: db, context });
const left1 = readdirSync(`${db}.broker.inbox`).filter((f) => f.endsWith(".json"));
row("undeliverable payload leaves the inbox", "empty", left1.length === 0 ? "empty" : `${left1.length} file(s) remain`);
row("undeliverable payload is dead-lettered", 2, p1.deadLettered);
row("dead-letter carries a readable reason", "yes", existsSync(`${db}.broker.inbox.error`) && readdirSync(`${db}.broker.inbox.error`).some((f) => f.endsWith(".reason")) ? "yes" : "no");
const outDir = existsSync(`${db}.broker.inbox.out`) ? readdirSync(`${db}.broker.inbox.out`).length : 0;
rows.push({ scenario: "a DENY writes a result the producer can poll", expect: ">=1 result row", got: `${outDir} result row(s) in .broker.inbox.out for 2 denied intents`, ok: outDir >= 1 });

const dir2 = mkdtempSync(join(process.cwd(), "probe-receive-2-")); SCRATCH.push(dir2);
const db2 = join(dir2, "store.sqlite");
writeFileSync(db2, "x"); // a file where the store should be: every apply fails
writeFileSync(`${db2}.broker.inbox.error`, "this path occupies the dead-letter directory");
mkdirSync(`${db2}.broker.inbox`, { recursive: true });
writeFileSync(`${db2}.broker.inbox/loop.json`, "this is not json{");
const a = await drainIntentInbox(stubHarness, null, { dbPath: db2, context });
const afterA = readdirSync(`${db2}.broker.inbox`).filter((f) => f.endsWith(".json")).length;
const b = await drainIntentInbox(stubHarness, null, { dbPath: db2, context });
const afterB = readdirSync(`${db2}.broker.inbox`).filter((f) => f.endsWith(".json")).length;
rows.push({
  scenario: "a deny terminates when its sink is unusable",
  expect: "payload removed after the first deny",
  got: `pass1 deadLettered=${a.deadLettered}, ${afterA} payload(s) still in the inbox; pass2 deadLettered=${b.deadLettered}, ${afterB} still there`,
  ok: afterA === 0,
});

console.log("probe: broker receive path  tree:", process.cwd());
for (const r of rows) console.log(`${r.ok ? "  PASS" : "  FAIL"}  ${r.scenario}  expect=${r.expect}  got=${r.got}`);
console.log(`${rows.length} cases; ${rows.filter((r) => !r.ok).length} measured failure(s).`);
for (const d of SCRATCH) rmSync(d, { recursive: true, force: true });
console.log("scratch removed:", readdirSync(process.cwd()).filter((n) => n.startsWith("probe-receive")).length === 0 ? "yes" : "NO");
process.exit(0);
