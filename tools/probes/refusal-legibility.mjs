#!/usr/bin/env node
/*
 * refusal-legibility.mjs — can the PRODUCER tell it was refused? (#6372 review)

 The receive path dead-letters a refused intent and writes a structured `refusal` object on the
 dead-lettered record. The producer, meanwhile, polls the RESULT channel by `requestId`
 (`awaitIntentResult`, src/broker.mjs:363-390). This probe measures whether those two meet:
 it spools a genuinely refused request that carries a requestId, drains it, and asks what the
 producer learns. Exits 1 when the producer cannot distinguish "refused" from "still pending".

 Run: node tools/probes/refusal-legibility.mjs
*/
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { drainIntentInbox, readIntentError, readIntentResult, awaitIntentResult } from "../../src/broker.mjs";

const scratch = [];
const problems = [];
const note = (m) => console.log(`  MEASURED  ${m}`);
const check = (cond, m) => {
	console.log(`  ${cond ? "PASS" : "FAIL"}  ${m}`);
	if (!cond) problems.push(m);
};

const stubHarness = { snapshot: async () => ({ seats: {} }) };
const context = { actor: { kind: "system", id: "probe" } };

const dir = mkdtempSync(join(process.cwd(), "probe-refusal-"));
scratch.push(dir);
const db = join(dir, "store.sqlite");
mkdirSync(`${db}.broker.inbox`, { recursive: true });

const requestId = "req-refused-1";
writeFileSync(`${db}.broker.inbox/refused.json`, JSON.stringify({ op: "pause", from: "impl", to: "impl", requestId, createdAt: new Date().toISOString() }));

const drained = await drainIntentInbox(stubHarness, null, { dbPath: db, context });
note(`drain returned: ${JSON.stringify(drained)}`);
note(`inbox after drain: ${readdirSync(`${db}.broker.inbox`).length} file(s); error dir exists: ${existsSync(`${db}.broker.inbox.error`)}`);

const errorFiles = existsSync(`${db}.broker.inbox.error`) ? readdirSync(`${db}.broker.inbox.error`) : [];
check(errorFiles.some((f) => f.endsWith(".error.json")), "the refused intent was dead-lettered out of the inbox");

if (errorFiles.length) {
	const rec = JSON.parse(readFileSync(join(`${db}.broker.inbox.error`, errorFiles[0]), "utf8"));
	note(`dead-letter record keys: ${Object.keys(rec).join(", ")}`);
	note(`refusal object on the record: ${JSON.stringify(rec.refusal ?? null)}`);
	check(rec.requestId === requestId, "the dead-letter record carries the requestId, so a producer polling by requestId can find its own refusal");
}

check(readIntentResult(db, requestId) !== null, "a refusal writes a result row the producer can poll (today: refusals live only in the .error directory)");

const lookedUp = readIntentError(db, requestId);
note(`readIntentError(db, requestId) -> ${lookedUp === null ? "null (no match)" : JSON.stringify(lookedUp)}`);
check(lookedUp !== null, "the documented producer-side lookup by requestId returns the refusal reason");

const outcome = await awaitIntentResult(db, requestId, { timeoutMs: 1000, intervalMs: 200, sleep: () => Promise.resolve() });
note(`awaitIntentResult -> ${JSON.stringify(outcome)}`);
check(outcome.ok === false && /refus|not-operator/i.test(outcome.reason ?? ""), "a polling producer learns WHY it was refused rather than timing out");

const keys = Object.keys(drained);
check(keys.length > 3 || keys.includes("refused") || keys.includes("deadLetterFailed"),
	"the drain counter separates a POLICY refusal from a FAILURE to dead-letter (today both are one number, `deadLettered`)");

/* the fallback lookup scans every dead-letter record on every poll: measure the cost of the backlog */
for (let i = 0; i < 200; i++) writeFileSync(join(`${db}.broker.inbox.error`, `noise-${i}.error.json`), JSON.stringify({ requestId: `noise-${i}` }));
const t0 = Date.now();
for (let i = 0; i < 60; i++) readIntentError(db, "not-present");
const perLookup = (Date.now() - t0) / 60;
note(`60 fallback lookups against 200 dead-letter records: ${perLookup} ms each (a 120 s poll is 600 lookups)`);
check(perLookup < 5, "the producer-side refusal lookup stays cheap as the dead-letter backlog grows; today it re-reads every record on every poll");

console.log(`\nRESULT: ${problems.length} legibility gap(s)`);
for (const d of scratch) rmSync(d, { recursive: true, force: true });
console.log("scratch removed:", readdirSync(process.cwd()).filter((n) => n.startsWith("probe-refusal")).length === 0 ? "yes" : "NO");
process.exit(problems.length ? 1 : 0);
