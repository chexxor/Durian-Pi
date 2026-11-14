#!/usr/bin/env node
/*
 * harness-view-freshness-6665.mjs - is the broker's own view of the queue fresh against a write made by
 * another connection? (#6665 - decides whether "derive from the store each turn" is even implementable)

If the wake layer's truth is `harness.snapshot(RigQueue)` (src/broker.mjs:1368), and a write made by a
second connection never appears in that snapshot, then a store-derived trigger cannot see it either -
the single-writer rule (D11) is load-bearing for wake correctness, not just for crash safety.

Run: node tools/probes/harness-view-freshness-6665.mjs    exit 1 if the broker's view is stale
*/
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Harness, createRegistry } from "@earendil-works/pi-durable";
import { createModels } from "@earendil-works/pi-ai";
import { RigQueue, Router } from "../../../src/rig.mjs";

const failures = [];
const check = (c, m) => { console.log(`  ${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures.push(m); };
const note = (m) => console.log(`  MEASURED  ${m}`);

const dir = mkdtempSync(join(process.cwd(), "tmp-fresh-6665-"));
const db = join(dir, "rig.sqlite");
spawnSync(process.execPath, ["cli.mjs", "up", "rig.starter.json", "--no-serve"], { env: { ...process.env, DURIG_DB: db, DURIG_PROVIDER: "faux" } });

const registry = createRegistry();
registry.install(Router);

const status = async (h) => (await h.snapshot(RigQueue, undefined, BACKGROUND_CONTEXT))?.items?.find((i) => i.id === 1)?.status;

const A = await Harness.open(await openNodeSqliteStorage(db), { models: createModels(), registry }, BACKGROUND_CONTEXT);
await A.commit(async (tx) => {
	const q = await tx.doc(RigQueue);
	q.items.push({ id: 1, from: "operator", to: "impl", subject: "the row", status: "held", blockedBy: [], transitions: [] });
}, BACKGROUND_CONTEXT);
note(`A's own view right after its write: ${await status(A)}`);

const B = await Harness.open(await openNodeSqliteStorage(db), { models: createModels(), registry }, BACKGROUND_CONTEXT);
await B.commit(async (tx) => {
	const q = await tx.doc(RigQueue);
	const row = q.items.find((i) => i.id === 1);
	row.status = "queued";
	row.transitions.push({ at: new Date().toISOString(), event: "released", by: "operator" });
}, BACKGROUND_CONTEXT);
note(`B's view after its write: ${await status(B)}`);
note(`A's view of the SAME row, after B's commit: ${await status(A)}`);
note(`A's view a second time: ${await status(A)}`);

const rawStorage = await openNodeSqliteStorage(db);
const raw = await rawStorage.findDocument({ kind: "durig.queue", scope: { kind: "session" } }, "current", BACKGROUND_CONTEXT);
const rawDoc = raw ? await rawStorage.document(raw.id, "current", BACKGROUND_CONTEXT) : null;
note(`raw store read (third connection): ${(rawDoc?.value?.items ?? []).find((i) => i.id === 1)?.status}`);

check(await status(A) === "queued", "the broker's harness view reflects a write made by another connection - a store-derived wake trigger can see it");

// Does the stale-cached writer CLOBBER the external write when it next commits?
await A.commit(async (tx) => {
	const q = await tx.doc(RigQueue);
	q.items.push({ id: 2, from: "operator", to: "impl", subject: "a later row from the broker", status: "queued", blockedBy: [], transitions: [] });
}, BACKGROUND_CONTEXT);
const after = await openNodeSqliteStorage(db);
const afterHarness = await Harness.open(after, { models: createModels(), registry }, BACKGROUND_CONTEXT);
const clobbered = await status(afterHarness);
note(`#1 status in the store after A committed again: ${clobbered} (B set it to queued)`);
check(clobbered === "queued", "an external write SURVIVES the broker's next commit: the cached writer does not clobber it");
await afterHarness.close(BACKGROUND_CONTEXT);
console.log("\nConsequence: if the harness view is stale, only the commit stream of the harness that wrote can trigger a pass, and D11 (one writer) is what makes the wake layer correct.");

await A.close(BACKGROUND_CONTEXT);
await B.close(BACKGROUND_CONTEXT);
await rawStorage.close(BACKGROUND_CONTEXT);
rmSync(dir, { recursive: true, force: true });
process.exit(failures.length ? 1 : 0);
