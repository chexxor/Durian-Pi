// demo/queue-row-read.test.mjs — read ONE queue row without paying for the whole store (#4986).
//
// THE DEFECT, with the number: `node cli.mjs queue` emitted **21,927,512 bytes** on this rig (measured in
// #4986; the same shape as `cli.mjs status` at 22 MB and docs/NEXT.md at 394 KB before its split). There was
// no `show`/`item` verb and no `--id` filter, so auditing 17 rows cost a 22 MB dump — the audit's own cost
// became the problem, and the rows the auditor needed were the reason it could not be read.
//
// WHAT THE FIX IS NOT: the queue is ONE document (`RigQueue.value.items`), so the STORAGE read cannot be
// narrowed; one row still reads the document. What is narrowed is the PAYLOAD — the bytes that reach a
// session, which is the half that costs context. A test that pretended otherwise would be a lie about the
// mechanism, so this file asserts the payload bound and says which half it proves.
//
// Run: node demo/queue-row-read.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry, Harness, MemoryStorage } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { READ_VIEWS, dispatchRead } from "../src/brokerread.mjs";
import { readQueueItems, readQueueRow } from "../src/readapi.mjs";
import { enqueueItem, Router } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-queue-row-"));

// Bodies are what make the dump huge, and bodies are what an audit needs. So the fixture uses REAL-SHAPED
// bodies (~2 KB each; the live store's run ~4.3 KB) rather than tiny ones — a fixture with 20-byte bodies
// would pass any byte-bound assertion and prove nothing.
const ROWS = 60;
const bodyOf = (i) => `ROW-BODY-${i} ` + "quorum ".repeat(250);
const bytes = (v) => Buffer.byteLength(JSON.stringify(v), "utf8");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

async function openHarness(storage) {
	const registry = createRegistry();
	registry.install(Router);
	const harness = await Harness.open(storage, { models, registry }, ctx);
	await harness.commit(
		async (tx) => {
			for (let i = 1; i <= ROWS; i += 1) {
				await enqueueItem(tx, "lead", "devtools", `subject ${i}`, bodyOf(i));
			}
		},
		ctx,
	);
	return harness;
}

try {
	// ─── A. THE BROKER SIDE: the view exists, is scoped, and says how narrow it is ───
	const memStorage = new MemoryStorage();
	const harness = await openHarness(memStorage);

	assert.ok(READ_VIEWS.includes("queue-row"), "queue-row is in the closed read-view vocabulary");
	assert.equal(
		new Set(READ_VIEWS).size,
		READ_VIEWS.length,
		"the read-view list stays a SET — a duplicated view name means the dispatch and the vocabulary drifted",
	);

	const full = await dispatchRead(memStorage, { view: "queue" }, { context: ctx });
	assert.equal(full.length, ROWS, "the fixture really has 60 rows — every byte bound below is against a full store");
	const one = await dispatchRead(memStorage, { view: "queue-row", id: 7 }, { context: ctx });
	assert.equal(one.item.id, 7, "the row-scoped read returns the requested row");
	assert.equal(one.item.body, bodyOf(7), "the row comes with its BODY — the fix is scoping, never truncation");
	assert.equal(one.rows, ROWS, "the narrow read reports how narrow it is (selectivity must be visible, not implied)");

	const fullBytes = bytes(full);
	const oneBytes = bytes(one);
	assert.ok(
		oneBytes * 10 < fullBytes,
		`one row must cost far less than the store: one=${oneBytes} B, full=${fullBytes} B (ratio ${(fullBytes / oneBytes).toFixed(1)}x)`,
	);
	assert.ok(oneBytes < 4096, `one row's payload is bounded in absolute bytes too: ${oneBytes} B`);
	const oneJson = JSON.stringify(one);
	assert.ok(oneJson.includes("ROW-BODY-7"), "the requested body is present");
	assert.ok(
		!oneJson.includes("ROW-BODY-8") && !oneJson.includes("ROW-BODY-6"),
		"NO neighbouring row leaks into a row-scoped read — the neighbours are the 22 MB",
	);
	assert.ok(
		JSON.stringify(full).includes("ROW-BODY-8") && JSON.stringify(full).includes("ROW-BODY-60"),
		"NOT-VACUOUS PAIR: the full view really carries the other bodies, so the narrow read is green because it scoped, not because the store is empty",
	);

	// Equivalence between the two routed paths, so a broker-less run and a broker-served run cannot drift.
	const direct = await readQueueRow(memStorage, 7, ctx);
	assert.deepEqual(one, direct, "the broker's `queue-row` view equals the direct readapi call");
	assert.deepEqual(
		one.item,
		(await readQueueItems(memStorage, ctx)).find((i) => i.id === 7),
		"the row the narrow read returns is BYTE-IDENTICAL to the row inside the full view — no rendering difference",
	);

	// An absent row is a RESULT at this layer (the caller decides), and a request with no id is an ERROR.
	const absent = await dispatchRead(memStorage, { view: "queue-row", id: 999999 }, { context: ctx });
	assert.equal(absent.item, null, "an absent row reads as `item: null`, not as an exception");
	assert.equal(absent.rows, ROWS, "and it still reports the store's size, so `null` cannot be read as `empty queue`");
	await assert.rejects(
		() => dispatchRead(memStorage, { view: "queue-row" }, { context: ctx }),
		/needs an item id/,
		"a `queue-row` request without an id is refused, never answered with the whole store",
	);

	// ─── B. THE CLI SIDE, against a real sqlite store the same library wrote ───
	const dbPath = join(dir, "queue-row.sqlite");
	const sqlite = await openNodeSqliteStorage(dbPath);
	await openHarness(sqlite);
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

	const dump = cli(["queue"]);
	assert.equal(dump.code, 0, `queue (full) failed: ${dump.stderr.slice(0, 300)}`);
	const dumpPayload = JSON.parse(dump.stdout);
	assert.equal(dumpPayload.items.length, ROWS, "`cli.mjs queue` still dumps everything — the fix ADDS a read, it does not break the audit that wants the whole store");
	const dumpBytes = Buffer.byteLength(dump.stdout, "utf8");

	const rowRead = cli(["queue", "--id", "7"]);
	assert.equal(rowRead.code, 0, `queue --id 7 failed: ${rowRead.stderr.slice(0, 300)}`);
	const rowPayload = JSON.parse(rowRead.stdout);
	assert.equal(rowPayload.ok, true, "a found row is ok:true");
	assert.equal(rowPayload.items.length, 1, "exactly one row printed");
	assert.equal(rowPayload.items[0].body, bodyOf(7), "the CLI prints the requested row's body verbatim");
	assert.equal(rowPayload.rows, ROWS, "the CLI's narrow read reports the store size it scoped against");
	const rowBytes = Buffer.byteLength(rowRead.stdout, "utf8");
	assert.ok(rowBytes * 10 < dumpBytes, `the CLI's one-row read is bounded against its own dump: ${rowBytes} B vs ${dumpBytes} B`);
	assert.ok(
		!rowRead.stdout.includes("ROW-BODY-8"),
		"the CLI's one-row read prints no other row — this is the byte the 22 MB audit was paying for",
	);

	// `show <id>` is the same code path, so the two entry points cannot drift.
	const showRead = cli(["show", "7"]);
	assert.equal(showRead.code, 0, `show 7 failed: ${showRead.stderr.slice(0, 300)}`);
	assert.equal(showRead.stdout, rowRead.stdout, "`show 7` and `queue --id 7` print BYTE-IDENTICAL payloads");

	// The scaling pair: scoping scales with the REQUESTED rows, not the STORE rows.
	const threeRead = cli(["show", "3", "5", "7"]);
	assert.equal(threeRead.code, 0, `show 3 5 7 failed: ${threeRead.stderr.slice(0, 300)}`);
	const threePayload = JSON.parse(threeRead.stdout);
	assert.equal(threePayload.items.length, 3, "a multi-row audit reads exactly the requested rows");
	const threeBytes = Buffer.byteLength(threeRead.stdout, "utf8");
	assert.ok(threeBytes * 10 < dumpBytes, `three rows still cost far less than the store: ${threeBytes} B vs ${dumpBytes} B`);
	assert.ok(threeBytes < rowBytes * 4, `three rows scale with the request (${threeBytes} B ≈ 3x ${rowBytes} B), not with the store`);

	// Loud failures, because a typo'd id must never look like an empty queue.
	const notFound = cli(["queue", "--id", "999999"]);
	assert.equal(notFound.code, 1, "an id that matches nothing exits 1, not 0-with-nothing");
	const notFoundPayload = JSON.parse(notFound.stdout);
	assert.equal(notFoundPayload.ok, false, "and it reports ok:false so a caller checking the flag sees the miss");
	assert.deepEqual(notFoundPayload.missing, ["999999"], "naming the id that was not found");
	assert.deepEqual(notFoundPayload.items, [], "and prints no rows");

	const partiallyMissing = cli(["show", "7", "999999"]);
	assert.equal(partiallyMissing.code, 1, "a partial miss is still a failure — an audit that silently loses a row is worse than one that stops");
	assert.deepEqual(JSON.parse(partiallyMissing.stdout).missing, ["999999"], "with the missing id named and the found row still printed");

	assert.equal(cli(["show"]).code, 1, "`show` with no id fails instead of dumping the store");
	assert.match(cli(["show"]).stderr + cli(["show"]).stdout, /show needs <item-id>/, "and says what it needed");
	const noValue = cli(["queue", "--id"]);
	assert.equal(noValue.code, 1, "`--id` with no value fails");
	assert.match(noValue.stderr + noValue.stdout, /--id needs a value/, "with the flag named");
	// #5016 flipped a pin in this file: when #4986 wrote it, `--status` was refused as an UNIMPLEMENTED filter (the
	// honest choice then — a flag that silently returned the unfiltered dump would have been the fail-open again).
	// demo/queue-row-read.test.mjs keeps its own contract; the full filter surface (per state, per addressee, the
	// census, `--no-body`) is pinned in demo/queue-filter-attention.test.mjs. These lines only keep this file honest.
	const filtered = cli(["queue", "--status", "done"]);
	assert.equal(filtered.code, 0, "a KNOWN filter exits 0 (#5016 implemented it)");
	const filteredPayload = JSON.parse(filtered.stdout);
	assert.deepEqual(filteredPayload.items, [], "this fixture has no `done` rows, and an empty answer is an honest empty answer");
	assert.equal(filteredPayload.rows, ROWS, "while the row count still travels with it, so an empty subset is never read as an empty queue");
	assert.ok(!("missing" in filteredPayload), "a filter that matches nothing is not reported as a missing id");
	const queuedAll = cli(["queue", "--status", "queued"]);
	assert.equal(queuedAll.code, 0, "the state the fixture does hold");
	assert.equal(JSON.parse(queuedAll.stdout).items.length, ROWS, "and returns exactly those rows");
	const bogus = cli(["queue", "--zork"]);
	assert.equal(bogus.code, 1, "an argument nobody implemented still fails loudly rather than returning the unfiltered dump");
	assert.match(bogus.stderr + bogus.stdout, /unknown argument --zork/, "and names the argument it refused");
} finally {
	rmSync(dir, { recursive: true, force: true });
}

console.log(
	`QUEUE ROW-READ TEST PASS (queue-row view + \`queue --id\` + \`show <id>\`: bodies verbatim, no neighbours, one row far under the dump, missing ids loud, both routed paths equal — #4986)`,
);
