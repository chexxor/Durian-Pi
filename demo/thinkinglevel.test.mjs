// ROADMAP 43a: a per-seat `thinkingLevel` declared in the rig must reach the
// harness's agent state — the layer generation.ts consults to decide whether
// to send `reasoning`. Assert on what durian-pi passes through (the stored
// AgentState.thinkingLevel), NOT on a live model.
//
// before the fix: durian-pi's configure calls (cli.mjs) never set `thinkingLevel`,
// so every seat's agent state defaults to "off" and reasoning is never sent.
// after the fix: a seat declared with `thinkingLevel` carries it into the
// agent state; a seat with none stays "off".
//
// Run: node demo/thinkinglevel.test.mjs  (exit 0 = pass)
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { AgentDoc, createRegistry, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { Seats } from "../src/rig.mjs";

const dir = mkdtempSync(join(tmpdir(), "durig-thinkinglevel-"));
const db = join(dir, "rig.sqlite");
const rigFile = join(dir, "tlevel.rig.json");
const durigDir = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

// Minimal rig: one seat that asks for thinking ("high"), one that leaves it
// unset. A rig file must declare cwd so the seat has a legal boundary.
const rig = {
  version: 2,
  cwd: durigDir,
  constitutionInline: "# constitution\nP1 Grounding.",
  seats: [
    { name: "thinker", role: "implementation", thinkingLevel: "high" },
    { name: "plain", role: "implementation" },
  ],
};
writeFileSync(rigFile, JSON.stringify(rig, null, 2));

const up = (args) =>
  new Promise((resolve) => {
    const child = spawn(process.execPath, ["cli.mjs", "up", rigFile, ...args], {
      cwd: durigDir,
      env: { ...process.env, DURIG_PROVIDER: "faux", DURIG_DB: db },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (c) => (stdout += c));
    child.stderr.on("data", (c) => (stderr += c));
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });

/** Read each seat's stored AgentState.thinkingLevel through the durable API. */
function readThinkingLevels() {
  return (async () => {
    const storage = await openNodeSqliteStorage(db);
    const harness = await Harness.open(
      storage,
      { models: createModels(), registry: createRegistry() },
      BACKGROUND_CONTEXT,
    );
    try {
      const seatsDoc = await harness.documentState(Seats, undefined, BACKGROUND_CONTEXT);
      const out = new Map();
      for (const [name, seat] of Object.entries(seatsDoc.value.seats)) {
        const agent = await harness.documentState(
          AgentDoc,
          seat.conversationId,
          BACKGROUND_CONTEXT,
        );
        out.set(name, agent?.value?.thinkingLevel);
      }
      return out;
    } finally {
      await harness.close(BACKGROUND_CONTEXT);
    }
  })();
}

try {
  const r = await up([]);
  assert.equal(r.code, 0, `up failed: ${r.stderr.slice(0, 300)}`);

  const levels = await readThinkingLevels();

  // The graded assertion: a seat declared with `thinkingLevel: "high"` must
  // reach the agent state as "high" (generation.ts then sends reasoning).
  // FAILS before the fix (defaults to "off").
  assert.equal(
    levels.get("thinker"),
    "high",
    `thinker seat must carry thinkingLevel "high" into the agent state so reasoning reaches the model call; got ${JSON.stringify(levels.get("thinker"))}`,
  );

  // Regression guard: a seat with no thinkingLevel is left untouched (stored
  // value stays undefined), so the resolved agent default "off" still applies
  // and generation.ts keeps omitting `reasoning` for it.
  assert.equal(
    levels.get("plain"),
    undefined,
    `plain seat (unset) must keep no stored thinkingLevel; got ${JSON.stringify(levels.get("plain"))}`,
  );

  console.log(
    `THINKINGLEVEL TEST PASS (thinker=${JSON.stringify(levels.get("thinker"))}, plain=${JSON.stringify(levels.get("plain"))})`,
  );
} finally {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch (err) {
    console.error(`CLEANUP WARNING (temp dir kept): ${err?.message ?? err}`);
  }
}

process.exit(0);
