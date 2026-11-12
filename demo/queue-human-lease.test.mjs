// demo/queue-human-lease.test.mjs — `node cli.mjs queue --human` shows the PRIORITY LEASE, and the
// DEFAULT `queue` bytes are provably untouched (#7113, D266).
//
// WHY THIS FILE EXISTS. `peek_queue` already renders a lease per row (`priority=now until=...`,
// `priority=now~lapsed@...`), but the operator's own `node cli.mjs queue` prints the raw JSON fields:
// `priority` and `prioritySet` sit in the dump with no statement of whether the lease is LIVE, LAPSED,
// or RECORDED-BUT-INERT. That is the gap this row names, and the danger is the fix: a derived string
// added to the JSON dump would break every script that diffs its bytes. So the pin here has three legs:
//   A. BYTE IDENTITY. The bare `queue` output is compared byte-for-byte against the SAME command run
//      against the SAME store by the PRE-change `cli.mjs` (the blob at BASE_REF, fetched from git).
//      Same store, same rows, only the code differs — so any drift in the default bytes is caught.
//   B. THE HUMAN VIEW EXISTS AND IS HONEST: live leases print level + `until=<instant>`; expired ones
//      print `~lapsed@<instant>` and say INERT; a value outside `now|next|later` prints `!invalid`; and
//      a live lease on a seat that resolves to `oldest_first` says INERT rather than pretending urgency.
//   C. THE TWO VIEWS CANNOT DISAGREE: every leased row in the JSON dump has a matching line in the
//      human view, with the same effective level, computed by the same `effectivePriority` the selector
//      uses (src/workstrategy.mjs) — not by a restatement in the CLI.
//
// Run: node demo/queue-human-lease.test.mjs   (exit 0 = pass)
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { configure, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

import { compilePersona, enqueueItem, registerSeat, RigQueue, Router, Seats } from "../src/rig.mjs";
import { effectivePriority } from "../src/workstrategy.mjs";

// The tree BEFORE #7113 touched cli.mjs. Pinned, not derived from HEAD^: after a merge `HEAD^` is a
// different commit, and a byte pin that quietly re-bases itself on the current tree compares the CLI
// with itself and proves nothing.
const BASE_REF = process.env.DURIG_QUEUE_BASE_REF || "ddcc0a23";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-queue-human-"));
const dbPath = join(dir, "queue-human.sqlite");
const bytes = (s) => Buffer.byteLength(s, "utf8");

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);
const registry = createRegistry();
registry.install(Router);

const sqlite = await openNodeSqliteStorage(dbPath);
const harness = await Harness.open(sqlite, { models, registry }, ctx);

// A rig with BOTH claim policies in force, so the readout has to say which seat honours a lease.
await harness.commit(
  async (tx) => {
    const mk = async (name, role, capabilities) => {
      const c = await tx.createConversation({ ownership: { kind: "ownerless" } });
      await configure(tx, c.id, { model: { provider: "faux", modelId: "faux-seat" }, instructions: compilePersona({ role }) });
      await registerSeat(tx, name, c.id, role);
      if (capabilities) (await tx.doc(Seats)).seats[name].capabilities = capabilities;
    };
    await mk("pm", "program manager");
    await mk("impl", "implementation engineer", ["implement"]); // resolves to the team default: oldest_first
    await mk("qa", "quality engineer", ["test"]); // declared priority_first below
    (await tx.doc(Seats)).seats.qa.workStrategy = "priority_first";
    for (const [subject, to] of [
      ["plain row A", "impl"],
      ["plain row B", "impl"],
      ["live lease", "qa"],
      ["lapsed lease", "qa"],
      ["corrupt priority", "qa"],
      ["lease on an oldest_first seat", "impl"],
      ["terminal row with a live lease", "qa"],
    ]) {
      await enqueueItem(tx, "pm", to, subject, `${subject} body ` + "quorum ".repeat(250));
    }
  },
  ctx,
);

// LEASES, written in the shape `set_priority` writes them: a live one (expires in 2 days), one already
// expired, one with a value outside the vocabulary, and one on a seat whose strategy ignores priority.
const iso = (offsetDays) => new Date(Date.now() + offsetDays * 86400000).toISOString();
await harness.commit(
  async (tx) => {
    const q = await tx.doc(RigQueue);
    const set = (id, priority, expiresAt) => {
      const row = q.items.find((it) => it.id === id);
      row.priority = priority;
      row.prioritySet = { at: "2026-11-12T00:00:00.000Z", by: "pm", reason: `fixture lease on #${id}`, expiresAt };
    };
    set(3, "now", iso(2)); // LIVE, honoured (qa is priority_first)
    set(4, "now", "2026-01-02T00:00:00.000Z"); // LAPSED
    set(5, "urgent", iso(3)); // not in now|next|later
    set(6, "later", iso(3)); // live, but impl claims oldest_first -> inert
    const done = q.items.find((it) => it.id === 7);
    done.status = "done"; // a lease on a terminal row orders nothing: the view must say so
    set(7, "now", iso(2));
  },
  ctx);
await harness.close(ctx);
await sqlite.close(ctx);

const cli = (args, script = "cli.mjs") => {
  const r = spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    env: { ...process.env, DURIG_DB: dbPath, DURIG_PI_DB: dbPath },
    encoding: "utf8",
    timeout: 120000,
  });
  return { code: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
};

let beforePath = null;
try {
  // ─── A. THE DEFAULT BYTES: same store, pre-change CLI, byte for byte ───
  const blob = spawnSync("git", ["show", `${BASE_REF}:cli.mjs`], { cwd: ROOT, encoding: "utf8" });
  assert.equal(blob.status, 0, `cannot read the pre-change cli.mjs at ${BASE_REF}: ${blob.stderr.slice(0, 200)}`);
  beforePath = join(ROOT, ".queue-cli-before.mjs");
  writeFileSync(beforePath, blob.stdout);

  const bare = cli(["queue"]);
  const before = cli(["queue"], ".queue-cli-before.mjs");
  assert.equal(bare.code, 0, `queue (bare) failed: ${bare.stderr.slice(0, 300)}`);
  assert.equal(before.code, 0, `the pre-change CLI failed: ${before.stderr.slice(0, 300)}`);
  assert.equal(
    Buffer.compare(Buffer.from(bare.stdout, "utf8"), Buffer.from(before.stdout, "utf8")),
    0,
    `the DEFAULT dump is byte-identical to the pre-change CLI (${bytes(bare.stdout)} B vs ${bytes(before.stdout)} B) — the human view is reachable only through --human`,
  );
  const jsonish = cli(["queue", "--json"]);
  assert.equal(Buffer.compare(Buffer.from(jsonish.stdout, "utf8"), Buffer.from(bare.stdout, "utf8")), 0, "--json stays a no-op beside the new flag");

  // And the default dump carries NO lease prose: a derived string in it is exactly what breaks byte-diffing scripts.
  for (const marker of ["~lapsed@", "INERT", "claim order", "leases:"]) {
    assert.ok(!bare.stdout.includes(marker), `the bare dump must not gain the human-view marker "${marker}"`);
  }
  const bareDoc = JSON.parse(bare.stdout);
  assert.deepEqual(Object.keys(bareDoc), ["ok", "command", "items"], `the bare answer's keys are unchanged: ${JSON.stringify(Object.keys(bareDoc))}`);
  assert.ok(!bareDoc.items.some((it) => "leaseText" in it || "priorityHuman" in it), "no row gains a derived lease field");

  // ─── B. THE HUMAN VIEW ───
  const human = cli(["queue", "--human"]);
  assert.equal(human.code, 0, `queue --human failed: ${human.stderr.slice(0, 300)}`);
  const out = human.stdout;
  assert.ok(!out.startsWith("{"), "the human view is NOT the JSON document — it is a readout, which is why the byte contract survives");
  assert.ok(out.includes("priority=now until="), `a LIVE lease prints its level and its expiry instant: ${out.slice(0, 400)}`);
  assert.ok(out.includes("~lapsed@2026-01-02T00:00:00.000Z"), "an expired lease prints ~lapsed@<instant>");
  assert.ok(/lapsed[^\n]*INERT/i.test(out), "a lapsed lease says it is inert, not urgent");
  assert.ok(out.includes("priority=urgent!invalid"), "a value outside the vocabulary is named as invalid");
  assert.ok(/INERT[^\n]*oldest_first/i.test(out), "a live lease on a seat that claims oldest_first says it changes nothing");
  assert.ok(/INERT: the row is done[^\n]*never claimed/i.test(out), "a live lease on a TERMINAL row is reported as ordering nothing, not as urgency");
  assert.ok(/rows \d+/.test(out), "the view states how many rows the store holds");
  assert.ok(bytes(out) < bytes(bare.stdout) / 5, `the view is bounded: ${bytes(out)} B vs the ${bytes(bare.stdout)} B dump`);

  // ─── C. THE TWO VIEWS AGREE, row by row ───
  const leased = bareDoc.items.filter((it) => it.priority);
  assert.equal(leased.length, 5, `the store holds 5 leased rows: ${JSON.stringify(leased.map((r) => r.id))}`);
  for (const it of leased) {
    const eff = effectivePriority(it);
    const line = out.split("\n").find((l) => l.includes(`#${it.id} `));
    assert.ok(line, `leased row #${it.id} appears in the human view`);
    if (eff.lapsed) assert.ok(line.includes(`~lapsed@${eff.expiresAt}`), `#${it.id} renders as lapsed, matching effectivePriority: ${line}`);
    else if (eff.invalid) assert.ok(line.includes(`!invalid`), `#${it.id} renders as invalid: ${line}`);
    else assert.ok(line.includes(`priority=${eff.priority} until=${eff.expiresAt}`), `#${it.id} renders live with its expiry: ${line}`);
  }

  // Scoping still scopes the human view, and a typo'd id still costs the caller a non-zero exit.
  const scoped = cli(["queue", "--human", "--to", "qa"]);
  assert.equal(scoped.code, 0, `queue --human --to qa failed: ${scoped.stderr.slice(0, 200)}`);
  assert.ok(!scoped.stdout.includes("#1 "), "rows addressed elsewhere are not printed");
  const missing = cli(["queue", "--human", "--id", "999999"]);
  assert.equal(missing.code, 1, "a nonexistent id in the human view exits 1, exactly as in the JSON view");
  assert.ok(missing.stderr.includes("999999"), "and names the id that matched nothing");

  // The flag is on the KNOWN set: it is refused for nothing, and an unknown flag beside it is still refused.
  const zork = cli(["queue", "--human", "--zork"]);
  assert.equal(zork.code, 1, "an unknown flag beside --human is still refused");
  assert.ok(zork.stderr.includes("--human"), "the refusal lists --human as a known flag: " + zork.stderr.slice(0, 300));
  assert.ok(!zork.stdout.includes('"items"'), "a refusal never prints the document");

  console.log(`PASS queue-human-lease: ${leased.length} leased rows, byte-identity vs ${BASE_REF}, human view ${bytes(out)} B`);
} finally {
  if (beforePath) rmSync(beforePath, { force: true });
  rmSync(dir, { recursive: true, force: true });
}
