// Run: node demo/queue-filter-attention.test.mjs   (exit 0 = pass)
//
// #5016 — the filter half of the `queue` read surface, and the invariant that makes a filtered read SAFE.
//
// WHAT THIS PINS, in the order the failure modes were registered:
//  A. THE DEFAULT IS UNTOUCHED. No flags = `{ok, command, items}` and nothing else — the byte shape that every
//     existing parser (delegate projections, tools/queue-rows.mjs, the runbook's Diagnose step) depends on. A
//     feature that quietly adds keys to the default view breaks readers who never asked for it.
//  B. FILTER = TRUTH, SMALLER. For every state in the closed vocabulary and every addressee, the filtered read's
//     id set, the per-state `counts` and the `attention` lines EQUAL what the full read derives. Same truth, a
//     fraction of the bytes — measured on one fixture, both halves from the same rows.
//  C. ATTENTION IS NOT TRIMMED WITH THE BODY. `--no-body` is a viewer convenience; the danger the rig has
//     registered repeatedly is acting on a subject whose body you never read. So the counts/notices are derived
//     over the FULL, UN-PROJECTED rows BEFORE the projection, and this file asserts a deferred row still produces
//     its `deferred_awaiting_answer` notice with bodies dropped. A projection that hides the rows producing a
//     notice is a false green, not a smaller view.
//  D. THE VIEW ANNOUNCES ITSELF. `--no-body` prints a loud header in its own payload (first key) and on stderr.
//  E. A CLOSED VOCABULARY IS CLOSED. `--status done2` is refused by name with the legal states — an unrecognized
//     state answering "no rows" is the same defect class as an unknown flag: a typo rendered as an empty success.
//  F. MECHANISM HONESTY. The payload says `narrowed: "payload"`. The queue is ONE document
//     (`RigQueue.value.items`), so the storage read stays whole; only the answer shrinks. A small answer that
//     implies a small read is how a partial view gets mistaken for the census.
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

import { DEFERRED_TO_HUMAN, RigQueue, Router, enqueueItem, registerSeat } from "../src/rig.mjs";
import { dispatchRead, READ_VIEWS } from "../src/brokerread.mjs";
import { QUEUE_STATUSES, queueAttention, queueCounts, readQueueCensus, readQueueItems, readSeatList } from "../src/readapi.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-queue-filter-"));

// Bodies shaped like real rows (~2 KB): a 20-byte body would pass any byte assertion and prove nothing.
const ROWS = 60;
const SEATS = ["devtools", "lead", "qa", "impl"];
const bodyOf = (i) => `ROW-BODY-${i} ` + "quorum ".repeat(250);
// Deterministic state spread, one value per row, so every state in the vocabulary is exercised and the expected
// id sets are computable from the same table the fixture writes.
const SPREAD = ["queued", "claimed", "deferred", "held", "done", "cancelled"];
const statusOf = (i) => SPREAD[(i - 1) % SPREAD.length];
const seatOf = (i) => SEATS[(i - 1) % SEATS.length];

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

const dbPath = join(dir, "queue-filter.sqlite");
const sqlite = await openNodeSqliteStorage(dbPath);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(sqlite, { models, registry }, ctx);
await harness.commit(
  async (tx) => {
    for (let i = 1; i <= SEATS.length; i += 1) await registerSeat(tx, SEATS[i - 1], 100 + i, "worker");
    for (let i = 1; i <= ROWS; i += 1) {
      await enqueueItem(tx, "lead", seatOf(i), `subject ${i}`, bodyOf(i));
    }
    // Set the states on the same document the queue actually keeps, so the fixture's rows carry the fields the
    // real transitions leave behind (deferredTo, heldReason, cancelReason) rather than a parallel fiction.
    const queue = await tx.doc(RigQueue);
    for (const it of queue.items) {
      it.status = statusOf(it.id);
      if (it.status === "deferred") it.deferredTo = it.id % 2 === 1 ? DEFERRED_TO_HUMAN : "lead";
      if (it.status === "held") it.heldReason = "fixture: gated on an unlanded row";
      if (it.status === "cancelled") it.cancelReason = "fixture: superseded";
    }
  },
  ctx,
);
await harness.close(ctx);
await sqlite.close(ctx); // a child CLI cannot open the store while this process holds it

const cli = (argv) => {
  const r = spawnSync(process.execPath, [join(ROOT, "cli.mjs"), ...argv], {
    cwd: ROOT,
    env: { ...process.env, DURIG_DB: dbPath, DURIG_NO_SERVE: "1" },
    encoding: "utf8",
    timeout: 120000,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};
const bytes = (s) => Buffer.byteLength(s, "utf8");

try {
  // The truth, derived straight from the store — the oracle the CLI answers are compared to.
  const store = await openNodeSqliteStorage(dbPath);
  const allItems = await readQueueItems(store, ctx);
  const seats = await readSeatList(store, ctx);
  const truthCounts = queueCounts(allItems);
  const truthAttention = queueAttention(allItems, seats);
  assert.equal(allItems.length, ROWS, "the fixture really holds 60 rows");
  assert.ok(truthAttention.length > 0, "the fixture really produces at least one deferred notice — otherwise section C asserts nothing");
  await store.close(ctx);

  // ─── A. THE DEFAULT IS UNTOUCHED ───
  const bare = cli(["queue"]);
  assert.equal(bare.code, 0, `queue (bare) failed: ${bare.stderr.slice(0, 300)}`);
  const bareDoc = JSON.parse(bare.stdout);
  assert.deepEqual(
    Object.keys(bareDoc),
    ["ok", "command", "items"],
    "the no-flag view keeps EXACTLY its old keys — a filter feature must not add keys to the default bytes",
  );
  assert.equal(bareDoc.items.length, ROWS, "and still returns the whole store: the fix ADDS reads, it never shrinks the audit that wants everything");
  const bareBytes = bytes(bare.stdout);

  // ─── B. EVERY STATE AND EVERY ADDRESSEE: same truth, fewer bytes ───
  for (const status of QUEUE_STATUSES) {
    const r = cli(["queue", "--status", status]);
    assert.equal(r.code, 0, `queue --status ${status} must exit 0: ${r.stdout.slice(0, 200)}${r.stderr.slice(0, 200)}`);
    const j = JSON.parse(r.stdout);
    const want = allItems.filter((it) => it.status === status).map((it) => it.id);
    assert.deepEqual(j.items.map((it) => it.id), want, `--status ${status} returns exactly that state's rows`);
    assert.equal(j.rows, ROWS, "and still reports the store's row count, so a subset cannot read as the census");
    assert.deepEqual(j.counts, truthCounts, `the per-state counts travel with the filter unchanged: ${status}`);
    assert.deepEqual(j.attention, truthAttention, `the attention lines equal those derived from the FULL read: ${status}`);
    assert.equal(j.narrowed, "payload", "the answer states which half it narrowed (payload, not storage)");
    assert.ok(bytes(r.stdout) * 2 < bareBytes, `a filtered read is cheaper than the dump it replaces: ${bytes(r.stdout)} B vs ${bareBytes} B`);
    if (status === "deferred") {
      // Bodies included here: scoping never truncates, and the notice names the row it came from.
      assert.ok(j.attention.some((a) => a.kind === "deferred_awaiting_answer" && a.detail.includes(`#${j.items[0].id}`)), "the deferred notice names the row that produced it");
    }
  }
  for (const seat of SEATS) {
    const r = cli(["queue", "--to", seat]);
    assert.equal(r.code, 0, `queue --to ${seat} failed: ${r.stdout.slice(0, 200)}`);
    const j = JSON.parse(r.stdout);
    assert.deepEqual(
      j.items.map((it) => it.id),
      allItems.filter((it) => it.to === seat).map((it) => it.id),
      `--to ${seat} returns exactly that addressee's rows`,
    );
    assert.deepEqual(j.counts, truthCounts, `counts stay the whole store's through a --to filter: ${seat}`);
    assert.deepEqual(j.attention, truthAttention, `attention stays the whole store's through a --to filter: ${seat}`);
  }

  // Repeatable, AND across groups, OR within one — the same shape `--id` already has.
  const both = cli(["queue", "--status", "queued", "--status", "held", "--to", "devtools"]);
  assert.equal(both.code, 0, "a repeatable --status plus --to parses");
  const bothDoc = JSON.parse(both.stdout);
  assert.deepEqual(
    bothDoc.items.map((it) => it.id),
    allItems.filter((it) => ["queued", "held"].includes(it.status) && it.to === "devtools").map((it) => it.id),
    "values inside a flag OR, flags AND",
  );

  // ─── C. ATTENTION IS NOT TRIMMED WITH THE BODY ───
  // The pair is taken FROM the fixture rather than assumed: a filter combination that happens to match no row
  // would make every assertion below vacuously true.
  const deferredRow = allItems.find((it) => it.status === "deferred");
  const withBody = cli(["queue", "--to", deferredRow.to, "--status", "deferred"]);
  const noBody = cli(["queue", "--to", deferredRow.to, "--status", "deferred", "--no-body"]);
  assert.equal(noBody.code, 0, "`--no-body` is a known flag: exit 0");
  const wb = JSON.parse(withBody.stdout);
  const nb = JSON.parse(noBody.stdout);
  assert.ok(wb.items.length > 0, `the chosen pair (${deferredRow.to}, deferred) really matches rows — otherwise C asserts nothing`);
  assert.ok(wb.items[0].body.includes("ROW-BODY-"), "the with-body form really carries a body");
  for (const it of nb.items) {
    assert.ok(!("body" in it), `#${it.id}: the body field is GONE in --no-body`);
    assert.ok(it.subject && it.status && it.to, `#${it.id}: everything else is intact — this is a projection, not a truncation`);
  }
  assert.deepEqual(nb.attention, wb.attention, "THE CENTRAL ASSERTION: dropping bodies may not drop or change a notice — derivation runs over the full rows, then projects");
  assert.deepEqual(nb.counts, wb.counts, "and the per-state counts are identical with bodies dropped");
  assert.ok(
    nb.attention.some((a) => a.kind === "deferred_awaiting_answer"),
    "a notice-producing row still yields its notice with --no-body (this is the false-green the projection would cause)",
  );
  assert.ok(wb.attention.length > 0, "the same read with bodies yields the same notices (the pair is the test)");

  // ─── D. THE VIEW ANNOUNCES ITSELF ───
  assert.equal(nb.projection?.noBody, true, "the payload carries the projection header");
  assert.deepEqual(nb.projection.droppedFields, ["body"], "and names what it dropped");
  assert.ok(/do not act on a subject/i.test(nb.projection.warning), `the header is an instruction, not a footnote: ${nb.projection?.warning}`);
  assert.ok(/BODIES ARE OMITTED/.test(noBody.stderr), `stderr says it too: ${noBody.stderr.slice(0, 200)}`);
  assert.equal(Object.keys(nb)[0], "projection", "the header is the FIRST key, so it is met before any row");
  assert.ok(bytes(noBody.stdout) < bytes(withBody.stdout), `and it is cheaper: ${bytes(noBody.stdout)} B vs ${bytes(withBody.stdout)} B for the SAME rows`);
  // A filter with no `--no-body` prints no projection header at all — the header is not decoration.
  assert.ok(!("projection" in wb), "no --no-body, no projection header");

  // `--id` composes with the filters, and a filter that EXCLUDES a real row is not reported as `missing`.
  const kept = cli(["queue", "--id", "1", "--status", "queued"]);
  assert.equal(kept.code, 0, "`--id` plus `--status` parses");
  assert.deepEqual(JSON.parse(kept.stdout).items.map((it) => it.id), [1], "row 1 is queued, so it passes the filter");
  const excluded = cli(["queue", "--id", "1", "--status", "cancelled"]);
  assert.equal(excluded.code, 0, "a real row filtered out is NOT an error");
  const exDoc = JSON.parse(excluded.stdout);
  assert.deepEqual(exDoc.items, [], "the row is not printed");
  assert.ok(!("missing" in exDoc), "`missing` means the store has no such id — blurring the two would make a filter look like a typo");
  assert.equal(exDoc.rows, ROWS, "while the census stays visible in the same answer");

  // ─── E. A CLOSED VOCABULARY IS CLOSED ───
  const badState = cli(["queue", "--status", "done2"]);
  assert.equal(badState.code, 1, "`--status done2` exits 1 instead of answering \"no rows\" to a typo");
  const badDoc = JSON.parse(badState.stdout);
  assert.equal(badDoc.ok, false, "a structured refusal");
  assert.ok(String(badDoc.error).includes("done2"), "naming the bad value");
  for (const state of QUEUE_STATUSES) {
    assert.ok(String(badDoc.error).includes(state), `and printing the legal states (missing ${state}): ${badDoc.error}`);
  }
  assert.ok(!("items" in badDoc), "a refused filter never answers with rows");
  assert.ok(bytes(badState.stdout) < 4096, `and it costs almost nothing: ${bytes(badState.stdout)} B vs the ${bareBytes} B dump`);
  const noValue = cli(["queue", "--status"]);
  assert.equal(noValue.code, 1, "`--status` with no value exits 1");
  assert.ok(JSON.parse(noValue.stdout).error.includes("--status needs a value"), "and says what it needed");

  // ─── F. THE CENSUS IS A READ VIEW, so a broker serves it without shipping the document ───
  assert.ok(READ_VIEWS.includes("queue-census"), "queue-census is in the closed read-view vocabulary");
  const viewStore = await openNodeSqliteStorage(dbPath);
  const viaView = await dispatchRead(viewStore, { view: "queue-census" }, { dbPath });
  const direct = await readQueueCensus(viewStore);
  assert.deepEqual(viaView, direct, "the broker's `queue-census` view equals the direct readapi call (one derivation, two routes)");
  assert.deepEqual(viaView.counts, truthCounts, "and the view's counts are the store's");
  assert.ok(
    bytes(JSON.stringify(viaView)) * 20 < bareBytes,
    `the census is a few hundred bytes against the dump it lets a caller avoid: ${bytes(JSON.stringify(viaView))} B vs ${bareBytes} B`,
  );
  await viewStore.close(ctx);

  console.log(
    `\nQUEUE-FILTER-ATTENTION TEST PASS (${ROWS} rows, ${SEATS.length} seats: default bytes unchanged; every state and addressee filters to the same counts/attention as the full read; \`--no-body\` drops bodies but NOT the deferred notice (${truthAttention.length} notice(s) identical with and without bodies); the header is the first key and on stderr; \`--status done2\` refused against the closed vocabulary; \`queue-census\` a read view at ${bytes(JSON.stringify(viaView))} B vs a ${bareBytes} B dump)`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
