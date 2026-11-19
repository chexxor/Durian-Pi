// demo/queue-compat-args.test.mjs — the `queue` argument surface, BOTH halves pinned (#5063).
//
// WHY THIS FILE EXISTS. The row-scoped read (#4986) replaced `cmdQueue()` — which took NO arguments, so
// `main` accepted literally everything — with a parser that refuses unknown arguments. That is the fix for the
// fail-open `docs/ROADMAP.md` 228 names (measured at `e3118fa0`: `queue`, `queue --json`, `queue --status held`,
// `queue --to pm --json`, `queue --ids`, `queue --no-body`, `queue --fields id`, `queue --zork`, `queue --id 5063`
// ALL exit 0 and print a byte-identical 22,417,821 B document — `--id` does not even exist there). But the first
// cut of that parser refused `--json`, which IS documented and used: `docs/runbooks/session-start-cost.md`
// Diagnose step 1, §15 and its own front-matter `evidence:` line, plus `docs/SELFDEV.md`, `tools/README.md` and
// `docs/ROADMAP.md` 228. Refusing a documented form is not a fail-open fix, it is a new break.
//
// LEAD RULING (option (a), #5063): `--json` is a KNOWN, accepted NO-OP — `out()` already prints JSON, so the
// bytes cannot change. Refusal applies to the genuinely UNKNOWN. This file is the enforcement mechanism: it
// asserts BOTH halves, because a demo that pins only the accept half cannot tell "unknown" apart from
// "documented" — and #5071 (the filter flags `--status`/`--to`/`--no-body`) must keep the ACCEPT lines green
// here while adding its own; if it changes what `--json` MEANS, the pin is updated deliberately in that row.
//
// Run: node demo/queue-compat-args.test.mjs   (exit 0 = pass)
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

import { enqueueItem, Router } from "../src/rig.mjs";

const ctx = BACKGROUND_CONTEXT;
const ROOT = join(new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const dir = mkdtempSync(join(tmpdir(), "durig-queue-compat-"));

// Real-shaped bodies: a fixture with 20-byte bodies would pass any byte assertion and prove nothing (the same
// choice demo/queue-row-read.test.mjs makes, so the two files' byte bounds mean the same thing).
const ROWS = 60;
const bodyOf = (i) => `ROW-BODY-${i} ` + "quorum ".repeat(250);

const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
const models = createModels();
models.setProvider(faux.provider);

const dbPath = join(dir, "queue-compat.sqlite");
const sqlite = await openNodeSqliteStorage(dbPath);
const registry = createRegistry();
registry.install(Router);
const harness = await Harness.open(sqlite, { models, registry }, ctx);
await harness.commit(
  async (tx) => {
    for (let i = 1; i <= ROWS; i += 1) await enqueueItem(tx, "lead", "devtools", `subject ${i}`, bodyOf(i));
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
const stdoutBytes = (r) => Buffer.byteLength(r.stdout, "utf8");

try {
  // ─── A. THE COMPAT HALF: a documented form must keep working, byte for byte ───
  const bare = cli(["queue"]);
  assert.equal(bare.code, 0, `queue (bare) failed: ${bare.stderr.slice(0, 300)}`);
  assert.equal(JSON.parse(bare.stdout).items.length, ROWS, "the bare dump still returns the whole store — the fix ADDS a read, it does not shrink the audit that wants everything");
  const bareBytes = stdoutBytes(bare);

  const json = cli(["queue", "--json"]);
  assert.equal(json.code, 0, `queue --json must exit 0 (it is a DOCUMENTED form: runbook Diagnose step 1, SELFDEV, tools/README, ROADMAP 228): ${json.stdout.slice(0, 200)}${json.stderr.slice(0, 200)}`);
  assert.equal(
    Buffer.compare(Buffer.from(json.stdout, "utf8"), Buffer.from(bare.stdout, "utf8")),
    0,
    "`queue --json` is byte-IDENTICAL to `queue` — the no-op is real, not a re-render that happens to look similar",
  );
  assert.equal(json.stderr, "", "the accepted form says nothing on stderr");

  const doubled = cli(["queue", "--json", "--json"]);
  assert.equal(doubled.code, 0, "`--json` twice is still a no-op (a flag is known or unknown, not counted)");
  assert.equal(Buffer.compare(Buffer.from(doubled.stdout, "utf8"), Buffer.from(bare.stdout, "utf8")), 0, "repeating the no-op changes no bytes either");

  // ─── B. THE NO-OP MUST NOT DISTURB THE SCOPED READ, in either flag order ───
  const idFirst = cli(["queue", "--id", "7", "--json"]);
  assert.equal(idFirst.code, 0, `queue --id 7 --json failed: ${idFirst.stdout.slice(0, 200)}${idFirst.stderr.slice(0, 200)}`);
  const idLast = cli(["queue", "--json", "--id", "7"]);
  assert.equal(idLast.code, 0, "`--json` before --id behaves the same");
  const scoped = JSON.parse(idFirst.stdout);
  assert.equal(scoped.ok, true, "a scoped read with an existing id is ok");
  assert.deepEqual(scoped.items.map((i) => i.id), [7], "exactly the requested row");
  assert.ok(scoped.items[0].body.includes("ROW-BODY-7"), "with its body — scoping, never truncation");
  assert.equal(Buffer.compare(Buffer.from(idLast.stdout, "utf8"), Buffer.from(idFirst.stdout, "utf8")), 0, "flag ORDER cannot change the bytes");
  assert.ok(
    stdoutBytes(idFirst) * 10 < bareBytes,
    `and it stays BOUNDED beside the dump it replaces: row=${stdoutBytes(idFirst)} B vs dump=${bareBytes} B (${(bareBytes / stdoutBytes(idFirst)).toFixed(1)}x)`,
  );

  // ─── B2. THE FILTER FLAGS ARE KNOWN, AND `--json` IS STILL A NO-OP BESIDE THEM (#5016) ───
  // A no-op must stay a no-op under the new surface: the same filter with and without `--json` is byte-identical.
  for (const form of [["--status", "queued"], ["--to", "devtools"], ["--no-body"], ["--status", "queued", "--to", "devtools"]]) {
    const plain = cli(["queue", ...form]);
    assert.equal(plain.code, 0, `queue ${form.join(" ")} is a KNOWN form and exits 0: ${plain.stdout.slice(0, 200)}`);
    const withJson = cli(["queue", "--json", ...form]);
    assert.equal(withJson.code, 0, `and stays known with the documented --json no-op in front: ${withJson.stdout.slice(0, 200)}`);
    assert.equal(
      Buffer.compare(Buffer.from(withJson.stdout, "utf8"), Buffer.from(plain.stdout, "utf8")),
      0,
      `--json changes NO bytes under the filter surface either (${form.join(" ")})`,
    );
  }

  // ─── C. THE REFUSAL HALF: the genuinely unknown stays refused, and pays nothing ───
  // `--zork` / `--jsonn` are nobody's planned flag; they are here so the ACCEPT lines above cannot be "fixed" by
  // accepting the world. On `main` these calls exit 0 and print the whole document — that is the fail-open being
  // closed. NOTE: `--status`, `--to` and `--no-body` were UNKNOWN when this file was written (#5063) and became
  // KNOWN in #5016 — in the same change that added the accept lines just above (B2) and the rows in
  // docs/COMMANDS-AND-THE-BROKER.md §4A. `--ids` stays refused: no call site uses it, and inventing a
  // flag because it looked likely is how a tool grows two spellings for one thing. `--fields` MOVED OUT of this
  // loop — ROADMAP 381 made it a KNOWN flag, but only inside `--list`; outside `--list` it is still refused, and
  // the refusal must NAME `--list` so the caller learns the missing half rather than guessing (section D below).
  for (const unknown of ["--zork", "--jsonn", "--ids"]) {
    const r = cli(["queue", unknown]);
    assert.equal(r.code, 1, `queue ${unknown} must exit 1 (unknown; not on the known list, and not a documented form)`);
    const j = JSON.parse(r.stdout);
    assert.equal(j.ok, false, `the refusal is a structured ok:false, not a bare red`);
    assert.ok(String(j.error).includes(unknown), `the refusal NAMES the flag it refused: ${j.error}`);
    assert.ok(!("items" in j), `a refused call never answers with the document — that is the fail-open's cost`);
    assert.ok(!r.stdout.includes("ROW-BODY-3"), "no row body escapes through a refused invocation");
    assert.ok(stdoutBytes(r) < 4096, `and it costs almost nothing: ${stdoutBytes(r)} B vs the ${bareBytes} B document`);
  }

  // `--human` (#7113) is a KNOWN form and must not disturb the default bytes it sits beside.
  const humanForm = cli(["queue", "--human"]);
  assert.equal(humanForm.code, 0, `queue --human is a known form and exits 0: ${humanForm.stderr.slice(0, 200)}`);
  assert.ok(!humanForm.stdout.startsWith("{"), "the human view prints text, which is how the JSON contract stays byte-identical");

  // A malformed VALUE for a known flag is refused too (a known flag is not a licence for anything after it).
  const missingValue = cli(["queue", "--id"]);
  assert.equal(missingValue.code, 1, "`--id` with no value exits 1");
  assert.ok(JSON.parse(missingValue.stdout).error.includes("--id needs a value"), "and names what it needed");

  // ─── C2. THE REFUSAL MUST BE CORRECTABLE (#5016) ───
  // Refusing is only useful if the caller can fix the typo without opening `cli.mjs`. So STDERR carries the
  // offending argument, EVERY known flag, and the usage line, while stdout keeps the machine contract. The known
  // set is pinned here as an exact list: adding a flag to `QUEUE_FLAGS` without adding it here (and to §4A of
  // docs/COMMANDS-AND-THE-BROKER.md, and to the accept lines above) goes RED, which is the point.
  const KNOWN_FLAGS = ["--json", "--id", "--human", "--list", "--sort", "--dir", "--fields", "--full-queue", "--manage", "--priority", "--reason", "--until", "--apply", "--confirm", "--discuss", "--revise"];
  const refused = cli(["queue", "--zork"]);
  assert.equal(refused.code, 1, "an unknown flag exits 1");
  assert.ok(refused.stderr.includes("--zork"), `stderr names the argument it refused: ${refused.stderr.slice(0, 300)}`);
  for (const flag of KNOWN_FLAGS) {
    assert.ok(refused.stderr.includes(flag), `stderr LISTS the known flag ${flag} so the caller can correct the call: ${refused.stderr.slice(0, 300)}`);
  }
  assert.ok(refused.stderr.includes("usage:"), `and prints the usage line: ${refused.stderr.slice(0, 300)}`);
  assert.ok(refused.stderr.length < 4096, `the correction itself is cheap: ${refused.stderr.length} B`);
  for (const flag of KNOWN_FLAGS) {
    assert.ok(String(JSON.parse(refused.stdout).error).includes(flag), "the machine half names the known set too");
  }

  // A bare positional is refused as well: `queue 5063` looks plausible, and on `main` it exited 0 and printed the
  // whole document. There is no positional form, so there is nothing to accept.
  const positional = cli(["queue", "7"]);
  assert.equal(positional.code, 1, "a bare positional exits 1");
  assert.ok(JSON.parse(positional.stdout).error.includes("7"), "and the refusal names the token it refused");
  assert.ok(!("items" in JSON.parse(positional.stdout)), "a refused positional never answers with the document");

  // ─── D. THE LIST VIEW (the compat half of ROADMAP 381) ───
  // This file pins only that the OLD documented forms still answer identically and that the FIVE new flags refuse
  // correctly. The view's own content — sort order, ties, per-row attributes, the cap — is demo/queue-list-sort.test.mjs.
  for (const narrow of [["--fields", "id"], ["--sort", "age"], ["--dir", "desc"], ["--full-queue"]]) {
    const orphan = cli(["queue", ...narrow]);
    assert.equal(orphan.code, 1, `queue ${narrow.join(" ")} outside --list exits 1: ${orphan.stderr.slice(0, 300)}`);
    const oj = JSON.parse(orphan.stdout);
    assert.equal(oj.ok, false, "the orphan is a structured ok:false");
    assert.ok(String(oj.error).includes(narrow[0]), `the refusal names the flag it refused: ${oj.error}`);
    assert.ok(String(oj.error).includes("--list"), `and it NAMES the missing half (--list), so the caller can correct the call: ${oj.error}`);
    assert.ok(!("items" in oj), `an orphaned narrow never answers with the document: ${orphan.stdout.slice(0, 200)}`);
    assert.ok(stdoutBytes(orphan) < 4096, `and it costs almost nothing: ${stdoutBytes(orphan)} B`);
  }

  const listForm = cli(["queue", "--list", "--sort", "age", "--limit", "5"]);
  assert.equal(listForm.code, 0, `queue --list --sort age --limit 5 is a KNOWN form and exits 0: ${listForm.stderr.slice(0, 300)}`);
  const listView = JSON.parse(listForm.stdout);
  assert.equal(listView.ok, true, "the list view is ok:true");
  assert.equal(listView.command, "queue", "it is the SAME verb, not a new one");
  assert.equal(listView.view, "list", "the document announces which view it is");
  assert.ok(listView.items.length <= 200, `the bounded view never exceeds the cap: ${listView.items.length} rows printed`);
  assert.equal(listView.items.length, 5, "--limit 5 printed exactly 5 of the 60-row fixture (bounded, not full-store)");
  assert.ok("sort" in listView.header, "the header names the sort, so the order is attributed before any row prints");
  assert.deepEqual(
    [listView.header.sort, listView.header.dir, listView.header.tieBreak],
    ["age", "asc", "id asc"],
    "sort key, direction and tie-break are all stated",
  );
  assert.ok(!(listView.items[0].body), "the list view carries no bodies — that is part of why it can carry 200 rows");
  assert.ok(listForm.stderr.includes("--list printed"), `the bound is PRINTED, not silent: ${listForm.stderr.slice(0, 300)}`);

  const badKey = cli(["queue", "--list", "--sort", "zork"]);
  assert.equal(badKey.code, 1, "an undeclared sort key exits 1");
  assert.ok(JSON.parse(badKey.stdout).error.includes("--sort"), "and the refusal names the bad flag BY NAME, not the vocabulary");
  assert.ok(!("items" in JSON.parse(badKey.stdout)), "an unknown key never prints a partially-sorted document");
  assert.ok(stdoutBytes(badKey) < 4096, `and it pays nothing: ${stdoutBytes(badKey)} B against the ${bareBytes} B dump`);

  // A KNOWN-but-absent id stays a loud RESULT+exit 1, not an empty queue (unchanged from #4986).
  const absent = cli(["queue", "--id", "999999"]);
  assert.equal(absent.code, 1, "an id matching nothing exits 1");
  assert.deepEqual(JSON.parse(absent.stdout).missing, ["999999"], "and reports it in `missing`");
  assert.equal(JSON.parse(absent.stdout).rows, ROWS, "while still reporting the store size, so `missing` is not read as `empty queue`");

  console.log(
    `\nQUEUE-COMPAT-ARGS TEST PASS (${ROWS}-row fixture: \`queue\` and \`queue --json\` byte-identical at exit 0, the no-op cannot disturb \`--id\` scoping in either order, the unknown stays refused and cheap (row=${stdoutBytes(idFirst)} B vs dump=${bareBytes} B), and a refusal names the flag, every known flag (${KNOWN_FLAGS.join(" ")}) and the usage)`,
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
