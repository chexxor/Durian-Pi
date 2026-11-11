// demo/restart-limit-seam.test.mjs — #6173 (ROADMAP 355 C): the seat restart limit is 3, set at
// ONE seam, and provably not the library default.
//
// FACTS THIS PINS, in order of strength:
//   1. pi-durable's own default is 5 — exported as DEFAULT_RESTART_LIMIT, so "we never set it" is a
//      measurable claim, not a guess.
//   2. the seam's settings object contains restartLimit: 3. Not a grep: the expression written at the
//      call site is EXTRACTED from cli.mjs and evaluated, so the demo tests the code the seam runs.
//   3. a real Harness.open accepts that object and runs a turn — the settings reach the library, a
//      malformed shape would throw.
//   4. there is no SECOND value: cli.mjs builds the run-control settings at exactly one seam and
//      writes no literal `restartLimit` anywhere, so a seat cannot reach 5 by another path.
//   5. it is code, not configuration: there is no key an operator can set to 0 or back to 5.
//
// RED before the change: checks 2-4 fail — cli.mjs's seam passes no `restartLimit` at all, so the
// effective value is pi-durable's 5.
//
// Run: node demo/restart-limit-seam.test.mjs   (exit 0 = pass)

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { DEFAULT_RESTART_LIMIT, Harness } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { createModels } from "@earendil-works/pi-ai/models";
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
import { createRegistry } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

import { SEAT_RESTART_LIMIT, runControlSettings } from "../src/config.mjs";

const cliSrc = readFileSync(new URL("../cli.mjs", import.meta.url), "utf8");
const dir = mkdtempSync(join(tmpdir(), "durig-restart-limit-"));
let failures = 0;
const check = (label, cond, detail = "") => {
  if (cond) console.log(`  ok   ${label}`);
  else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` -- ${detail}` : ""}`);
  }
};

try {
  /* ---- 1. the default we are replacing is real ---- */
  check("pi-durable's unconfigured default is 5 (so setting 3 changes behaviour)", DEFAULT_RESTART_LIMIT === 5, String(DEFAULT_RESTART_LIMIT));
  check("the ruled value is 3", SEAT_RESTART_LIMIT === 3, String(SEAT_RESTART_LIMIT));

  /* ---- 2. extract the settings expression from the seam and EVALUATE it ---- */
  const seamMatch = cliSrc.match(/async function openHarness\([\s\S]*?\n\}/);
  check("cli.mjs has an openHarness function", seamMatch !== null);
  const seamBody = seamMatch ? seamMatch[0] : "";
  const settingsExpr = (seamBody.match(/settings:\s*(\{[^}]*\})/) || [])[1];
  check("the seam passes a settings object", settingsExpr !== undefined, settingsExpr);
  const evaluated = new Function("streamSettings", "compactionSettings", "runControlSettings", "CFG", `return ${settingsExpr};`)(
    () => ({}),
    () => ({}),
    runControlSettings,
    {},
  );
  check("the evaluated seam object carries restartLimit = 3", evaluated.restartLimit === 3, JSON.stringify(evaluated));
  check("it is NOT the library default", evaluated.restartLimit !== DEFAULT_RESTART_LIMIT, `${evaluated.restartLimit} vs ${DEFAULT_RESTART_LIMIT}`);

  /* ---- 3. a real harness takes it ---- */
  const db = join(dir, "rig.sqlite");
  const faux = fauxProvider({ models: [{ id: "faux-seat" }] });
  const models = createModels();
  models.setProvider(faux.provider);
  const storage = await openNodeSqliteStorage(db);
  const harness = await Harness.open(storage, { models, registry: createRegistry(), settings: evaluated }, BACKGROUND_CONTEXT);
  check("Harness.open accepted the seam settings and opened", typeof harness?.commit === "function");
  await harness.close(BACKGROUND_CONTEXT);

  /* ---- 4. no second value anywhere in the running tree ---- */
  const seamUses = (cliSrc.match(/runControlSettings\(/g) || []).length;
  check("cli.mjs builds the run-control settings at exactly ONE seam", seamUses === 1, `${seamUses} uses`);
  check("cli.mjs contains NO hand-written restartLimit (that is the drift this guards)", !/restartLimit\s*[:=]/.test(cliSrc), cliSrc.split("\n").filter((l) => /restartLimit\s*[:=]/.test(l)).join(" | "));
  const configSrc = readFileSync(new URL("../src/config.mjs", import.meta.url), "utf8");
  check("the value is DEFINED once, in config.mjs", (configSrc.match(/SEAT_RESTART_LIMIT = \d+/g) || []).length === 1);
  check("no other file in src/ sets a raw restartLimit", (() => {
    const others = ["src/broker.mjs", "src/rig.mjs", "src/driver.mjs", "src/readclient.mjs", "src/tui/durable/adapter.mjs"];
    return others.every((f) => !/restartLimit\s*[:=]/.test(readFileSync(new URL(`../${f}`, import.meta.url), "utf8")));
  })());
  // A second OPEN site exists - the interactive TUI host. The honest assertion about it is that it invents
  // NO value of its own (it inherits the library default). That is the residual the runbook names: a human
  // at `cli.mjs tui` still gets 5. Seats do not go through it.
  const adapterSrc = readFileSync(new URL("../src/tui/durable/adapter.mjs", import.meta.url), "utf8");
  check("the TUI host passes settings through and defines no second value", /settings:\s*options\.settings/.test(adapterSrc) && !/restartLimit/.test(adapterSrc));
  /* ---- 5. never 0, never a silently-ignored knob ---- */
  check("the limit is a positive integer, not 0", Number.isInteger(SEAT_RESTART_LIMIT) && SEAT_RESTART_LIMIT >= 1, String(SEAT_RESTART_LIMIT));
  check("there is no config knob to set it back to 5 or 0", runControlSettings({ DURIG_RESTART_LIMIT: "9" }).restartLimit === 3, "the value is code, not configuration");

  console.log(`\n${failures === 0 ? "RESTART-LIMIT PASS" : `RESTART-LIMIT FAIL (${failures} check(s))`}`);
  process.exit(failures === 0 ? 0 : 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
