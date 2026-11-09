// #5488 — DURIG_MAX_CONCURRENT_SEATS must gate `local/*` generations.
//
// WHAT THIS PINS, and why at THIS layer. The cap is a cross-process generation lease
// (`src/genlock.mjs`) taken at the PROVIDER seam, and the claim under test is about the
// POSITION of the wrapper, not the arithmetic of the lease: the rig's whole `local/*` family
// was registered with NO slot wrapper (`cli.mjs` local-provider loop), so with the config
// reading `DURIG_MAX_CONCURRENT_SEATS=1` the rig ran 9-10 generations at once and produced
// ZERO `<db>.genlock.<i>` files (docs/DECISIONS.md, the #5488 finding; reproduced in
// docs/NEXT.md: "`running` reached 10 while DURIG_MAX_CONCURRENT_SEATS=1"). A test that
// wrapped a provider with `wrapProviderWithSlots` itself would pass on the broken tree — it
// would pin the module, not the registration site. So this file drives the REAL `cli.mjs`
// (spawned, `up` + `send`) against a `local/stub-model` seat whose endpoint is a loopback
// stub started in this process. Nothing is paid for and nothing leaves the machine: the
// provider under test is a locally-served OpenAI-compatible endpoint, and the stub is the
// thing that counts requests.
//
// THREE CLAIMS, in the order the acceptance asks for them:
//   1. a `local/*` generation HOLDS a `<db>.genlock.<i>` lease FOR ITS DURATION — sampled
//      while the child is mid-response, and proven gone after it exits;
//   2. a second generation QUEUES — while another holder owns the only slot, the stub receives
//      NO request; the request lands only after that holder releases;
//   3. the COST, in seconds, measured in this run against the ungated baseline (the same
//      stub, cap disarmed) — "worse-but-narrower" is acceptable, unmeasured is not.
//
// Run: node demo/local-slot-gate.test.mjs   (exit 0 = pass; it FAILS on the unfixed tree)
import assert from "node:assert/strict";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { withGenerationSlot, readGenerationSlots } from "../src/genlock.mjs";

const repo = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const dir = mkdtempSync(join(tmpdir(), "durig-local-slot-gate-"));
const db = join(dir, "rig.sqlite");
const rigFile = join(dir, "rig.json");

// ------------------------------------------------------------------ the loopback stub
// It counts CONCURRENCY, which is the whole point: `inflight`/`maxInflight` is what a cap is
// a claim about. The hold time is what makes a generation long enough to sample.
let HOLD_MS = 600;
let requests = 0;
let inflight = 0;
let maxInflight = 0;
const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    requests += 1;
    inflight += 1;
    maxInflight = Math.max(maxInflight, inflight);
    await new Promise((r) => setTimeout(r, HOLD_MS));
    inflight -= 1;
    const chunk = (o) => `data: ${JSON.stringify(o)}\n\n`;
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(
      chunk({ id: "c1", object: "chat.completion.chunk", model: "stub-model", choices: [{ index: 0, delta: { role: "assistant", content: "gated" }, finish_reason: null }] }) +
        chunk({ id: "c1", object: "chat.completion.chunk", model: "stub-model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) +
        "data: [DONE]\n\n",
    );
  });
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const STUB = `http://127.0.0.1:${server.address().port}/v1`;

// Two seats, both on the LOCAL provider — the family the cap was never reaching.
writeFileSync(
  rigFile,
  JSON.stringify({
    version: 2,
    seats: [
      { name: "alpha", role: "author", instructions: "a", model: "local/stub-model" },
      { name: "beta", role: "author", instructions: "b", model: "local/stub-model" },
    ],
    edges: [{ from: "alpha", maySendTo: ["beta"] }],
  }),
);

const cliEnv = (over = {}) => ({
  ...process.env,
  DURIG_DB: db,
  // The DEFAULT provider stays the metered one: the local-provider loop lives in that
  // branch. No seat resolves to it (both seats say `local/stub-model`), so no paid call
  // is possible; the stub is loopback, so the spend guard forwards and does not ledger.
  DURIG_PROVIDER: "deepinfra",
  DURIG_MODEL: "zai-org/GLM-5.3-Flash",
  DURIG_LOCAL_BASE_URL: STUB,
  DURIG_LOCAL_MODEL: "stub-model",
  DURIG_LOCAL_CONTEXT: "32768",
  DURIG_LOCAL_MAX_TOKENS: "64",
  DURIG_MAX_CONCURRENT_SEATS: "1",
  ...over,
});

function runCli(args, env) {
  const res = spawnSync(process.execPath, ["cli.mjs", ...args], { cwd: repo, env, encoding: "utf8" });
  return { code: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}
/** A spawned `send` so the test can sample the lease while the generation is IN FLIGHT. */
function spawnSend(seat, env) {
  const child = spawn(process.execPath, ["cli.mjs", "send", seat, "hold the slot"], { cwd: repo, env });
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => (out.stdout += d));
  child.stderr.on("data", (d) => (out.stderr += d));
  const done = new Promise((resolve) => child.on("exit", (code) => resolve({ code, ...out })));
  return { child, done };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const slotFile = (i = 0) => `${db}.genlock.${i}`;
let failures = 0;
function check(label, ok, detail = "") {
  if (ok) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

try {
  const up = runCli(["up", rigFile], cliEnv());
  assert.equal(up.code, 0, `up must exit 0 to build the rig (stderr: ${up.stderr.slice(0, 400)})`);

  // =============================================================== 1. THE LEASE COVERS THE GENERATION
  HOLD_MS = 1500;
  {
    const before = requests;
    const t0 = Date.now();
    const send = spawnSend("alpha", cliEnv());
    let seen = null;
    while (!seen && Date.now() - t0 < 6000) {
      await sleep(100);
      const live = readGenerationSlots(db, 1).filter((s) => s.generatingSeat);
      if (live.length) seen = live[0];
      else if (!send.child.connected && existsSync(slotFile(0))) seen = { pid: null, generatingSeat: "unparsed" };
    }
    check(
      "a local/* generation HOLDS a <db>.genlock.0 lease while it runs",
      !!seen,
      `no ${db}.genlock.0 lease was observed in ${((Date.now() - t0) / 1000).toFixed(1)}s while the generation was mid-response — the local provider is NOT slot-gated`,
    );
    if (seen) {
      check(
        "the lease names the seat that is generating",
        seen.generatingSeat === "alpha",
        `got generatingSeat=${seen.generatingSeat}`,
      );
      check(
        "the lease is the generating process's own pid (cross-process, killable)",
        seen.pid === send.child.pid,
        `lease pid ${seen.pid} !== send pid ${send.child.pid}`,
      );
    }
    const res = await send.done;
    check("the gated generation still succeeds", res.code === 0, `send exit ${res.code}; stderr: ${res.stderr.slice(0, 400)}`);
    check("the generation reached the stub exactly once", requests === before + 1, `stub saw ${requests - before} request(s)`);
    check(
      "the lease is RELEASED when the generation ends",
      !existsSync(slotFile(0)),
      `${slotFile(0)} is still on disk after the generation finished`,
    );
  }

  // =============================================================== 2. A SECOND GENERATION QUEUES
  // The other holder is taken by THIS process through the same lease the rig uses, so the
  // claim under test is only about the queued side: a `local/*` generation must not reach the
  // wire while the only slot is owned. (One harness at a time — a second writing Harness on
  // the same store is the hazard NEXT-ARCHIVE warns about, so the concurrent holder is a
  // lease, not a second seat run.)
  HOLD_MS = 600;
  {
    const before = requests;
    let releasedAt = null;
    const heldSlot = withGenerationSlot({ dbPath: db, slots: 1, seat: "external-holder" }, async () => {
      const send = spawnSend("alpha", cliEnv());
      await sleep(900); // well past the stub's hold time: if it were NOT gated it would have landed by now
      const early = { requests: requests - before, inflight };
      releasedAt = Date.now();
      return { send, early };
    });
    const { send, early } = await heldSlot;
    check(
      "a second local/* generation QUEUES behind the live holder (no request reached the wire)",
      early.requests === 0,
      `the stub received ${early.requests} request(s) while the only slot was held by another process — the cap does not gate local/*`,
    );
    const res = await send.done;
    const after = requests - before;
    check("and it goes through once the slot is free", after === 1 && res.code === 0, `requests=${after}, send exit ${res.code}; stderr: ${res.stderr.slice(0, 300)}`);
    check(
      "the queued generation waited for the release, not for the wire",
      releasedAt !== null && Date.now() > releasedAt,
      "the release timestamp is not in the past",
    );
  }

  // =============================================================== 2b. THE CAP BITES AT THE OPERATOR'S NUMBER (4)
  // "11 assertions exit 0" is not the acceptance. The gate must be seen to REFUSE the (N+1)-th
  // generation at the cap the operator declared (4, D238). Four leases are held by THIS process
  // through the same `withGenerationSlot` the rig uses (one harness at a time on the store, so no
  // second writing Harness is opened), and a FIFTH `local/*` generation is launched from a spawned
  // `cli.mjs` while those four are live. If the gate works, the stub sees NO request until a holder
  // releases. The cap-0 CONTROL repeats the same shape with the gate disarmed: the request DOES
  // reach the wire. Without the control, a stub that serialised for its own reasons would look like
  // a working gate.
  {
    const HOLD = 2200;
    const burst = async (cap) => {
      const before = requests;
      const holds = Array.from({ length: 4 }, (_, i) =>
        withGenerationSlot({ dbPath: db, slots: 4, seat: `holder-${i}` }, () => sleep(HOLD)),
      );
      const leasesHeld = readGenerationSlots(db, 8).filter((s) => s.generatingSeat).length;
      const send = spawnSend("alpha", cliEnv({ DURIG_MAX_CONCURRENT_SEATS: String(cap) }));
      await sleep(HOLD - 500); // still inside the hold window: this is the sample that must be 0 at cap 4
      const during = requests - before;
      await Promise.all(holds);
      const res = await send.done;
      const after = requests - before;
      return { during, after, leasesHeld, code: res.code, stderr: res.stderr };
    };
    const capped = await burst(4);
    const control = await burst(0);
    check(
      "four live leases are visible to the rig (the precondition for the refusal)",
      capped.leasesHeld === 4,
      `readGenerationSlots saw ${capped.leasesHeld} live leases`,
    );
    check(
      "at cap 4 the 5th local generation is REFUSED the wire while the four slots are held",
      capped.during === 0,
      `the stub received ${capped.during} request(s) with four leases live — the cap does not bite`,
    );
    check(
      "refused means QUEUED, not dropped: the generation lands once a slot frees",
      capped.after === 1 && capped.code === 0,
      `requests=${capped.after}, send exit ${capped.code}; stderr: ${capped.stderr.slice(0, 200)}`,
    );
    check(
      "CONTROL (cap disarmed): the same generation reaches the wire while four leases are held, proving the refusal is the gate and not the stub",
      control.during === 1,
      `control reached the wire with ${control.during} request(s) during the hold; if this were also 0 the stub, not the gate, is serialising`,
    );
    console.log(
      `CAP-4 BITING (measured, hold ${HOLD}ms): cap 4 -> 0 requests during the hold, 1 after release | cap 0 control -> ${control.during} request(s) during the hold`,
    );
  }

  // =============================================================== 3. THE COST, IN SECONDS
  // The baseline is measured in the SAME run against the SAME stub with the cap DISARMED
  // (`DURIG_MAX_CONCURRENT_SEATS=0` means no limit, by `maxSeats()`'s own rule — a test
  // override, never a config default: `durig.config.default.json` keeps `1`).
  HOLD_MS = 600;
  {
    const timed = async (env) => {
      const t = Date.now();
      const res = spawnSend("beta", env);
      const out = await res.done;
      return { secs: (Date.now() - t) / 1000, code: out.code, stderr: out.stderr };
    };
    const ungated = await timed(cliEnv({ DURIG_MAX_CONCURRENT_SEATS: "0" }));
    const gated = await timed(cliEnv({ DURIG_MAX_CONCURRENT_SEATS: "1" }));
    check("both generations succeeded (the gate must not break the run)", ungated.code === 0 && gated.code === 0, `ungated exit ${ungated.code}, gated exit ${gated.code}`);
    const overhead = gated.secs - ungated.secs;
    check(
      "gating a local generation costs seconds, not minutes (acquire overhead < 2s)",
      overhead < 2,
      `gated ${gated.secs.toFixed(3)}s vs ungated ${ungated.secs.toFixed(3)}s — overhead ${overhead.toFixed(3)}s`,
    );
    console.log(
      `COST (measured here, stub hold ${HOLD_MS}ms): ungated ${ungated.secs.toFixed(3)}s | gated-and-free ${gated.secs.toFixed(3)}s | acquire overhead ${overhead.toFixed(3)}s. ` +
        `Serialisation cost per queued generation ~= one generation's own duration (${HOLD_MS}ms of model time here): at cap N, k queued generations cost about ${(((k, n) => (Math.ceil(k / n) - 1) * HOLD_MS / 1000)(2, 1)).toFixed(2)}s more than unbounded concurrency.`,
    );
  }

  check(
    failures === 0 ? "PASS — DURIG_MAX_CONCURRENT_SEATS gates the local/* providers (lease held for the duration, second generation queues, cost measured)" : `FAIL — ${failures} assertion(s) failed`,
    failures === 0,
  );
} finally {
  server.close();
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}
process.exit(failures === 0 ? 0 : 1);
